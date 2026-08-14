const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeClassList() {
  const values = new Set();
  return {
    add: jest.fn(name => values.add(name)),
    remove: jest.fn(name => values.delete(name)),
    toggle: jest.fn((name, enabled) => enabled ? values.add(name) : values.delete(name)),
    contains: name => values.has(name)
  };
}

function makeElement(extra = {}) {
  return {
    textContent: '',
    className: '',
    disabled: false,
    value: '0',
    style: {},
    dataset: {},
    classList: makeClassList(),
    addEventListener: jest.fn(),
    setAttribute: jest.fn(),
    ...extra
  };
}

function loadJog() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'jog-control.js'),
    'utf8'
  );
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  getElement('jog-panel').style.display = 'flex';
  getElement('jog-drive-type').value = 'dd';
  getElement('jog-topic').value = '/cmd_vel';
  getElement('jog-linear-speed').value = '0.10';
  getElement('jog-angular-speed').value = '0.20';
  getElement('jog-turntable-target').value = '10';

  const listeners = {};
  const topics = [];
  const serviceCalls = [];
  class Topic {
    constructor(options) {
      this.options = options;
      topics.push(this);
    }
    subscribe(callback) { this.callback = callback; }
    unsubscribe() { this.unsubscribed = true; }
    publish() {}
  }
  class Message {
    constructor(values) { Object.assign(this, values); }
  }
  class ServiceRequest {
    constructor(values) { Object.assign(this, values); }
  }
  class Service {
    constructor(options) { this.options = options; }
    callService(request, success) {
      serviceCalls.push({ options: this.options, request });
      success({ success: true });
    }
  }

  const slot = {
    robotId: 'R_013',
    robotModel: 'stl1500w',
    connected: true,
    ros: {}
  };
  const context = {
    App: {
      activeSlotIndex: 0,
      robotSlots: [slot],
      toast: jest.fn()
    },
    RosManager: {
      getRos: jest.fn(() => slot.ros),
      getRobotId: jest.fn(() => slot.robotId)
    },
    RobotCompatibility: {
      isStlUlsanModel: model => String(model).toLowerCase() === 'stl1500w',
      get: () => ({
        task: { goalName: '/R_013/TARU/goal' },
        actions: { turntable: { syncService: '/R_013/Turntable/sync_mode' } }
      })
    },
    ActionSender: {
      sendJogActionToSlot: jest.fn().mockResolvedValue({}),
      cancelTaskOnSlot: jest.fn().mockResolvedValue({})
    },
    ROSLIB: { Topic, Message, Service, ServiceRequest },
    localStorage: { getItem: jest.fn(() => null), setItem: jest.fn() },
    confirm: jest.fn(() => true),
    document: {
      activeElement: null,
      hidden: false,
      addEventListener: jest.fn((name, callback) => { listeners[name] = callback; }),
      getElementById: jest.fn(getElement),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => [])
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__JogControl = JogControl;`, context);
  return { manager: context.__JogControl, context, slot, topics, serviceCalls, listeners, getElement };
}

describe('HMI-derived Jog safety and telemetry', () => {
  test('renders the requested controls without an analog joystick', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    [
      'jog-safety-summary',
      'jog-command-velocity',
      'jog-actual-velocity',
      'jog-lift-height',
      'jog-turntable-angle',
      'jog-turntable-sync-on',
      'jog-turntable-sync-off'
    ].forEach(id => expect(html).toContain(`id="${id}"`));
    expect(html).not.toContain('id="jog-analog-joystick"');
    expect(html).toContain('<kbd>R</kbd><kbd>V</kbd><kbd>T</kbd>');
  });

  test('fails closed until every STL safety signal is fresh and safe', () => {
    const { manager } = loadJog();
    manager._stopVel = jest.fn();
    manager._safetyState = manager._emptySafetyState();

    expect(manager._requireSafety('주행 Jog')).toBe(false);
    expect(manager._stopVel).toHaveBeenCalled();

    const at = Date.now();
    manager._safetyState = Object.fromEntries(
      ['manual', 'idle', 'emo', 'sto', 'lidar', 'brake'].map(key => [key, { value: true, at }])
    );
    expect(manager._safetyEvaluation()).toMatchObject({ safe: true, strict: true });

    manager._safetyState.sto.at = at - manager.SAFETY_STALE_MS - 1;
    expect(manager._safetyEvaluation().reasons).toContain('STO 정상 미확인');
  });

  test('subscribes safety, feedback, and actual velocity topics and renders values', () => {
    const { manager, topics, getElement } = loadJog();
    manager._startTelemetry();
    const send = (name, message) => topics.find(topic => topic.options.name === name).callback(message);

    send('/R_013/io/select', { data: false });
    send('/R_013/robot_state', { workstate: 0 });
    send('/R_013/emergency_sensor', { data: [0, 0, 0, 0] });
    send('/R_013/sto_stop', { data: false });
    send('/R_013/io/lidar_field', { data: 0 });
    send('/R_013/io/break_released', { data: true });
    send('/R_013/motor_status', {
      feed_vel: { linear: { x: 0.12, y: 0 }, angular: { z: -0.2 } }
    });
    send('/R_013/Lift/feedback', { height: 1234, status: 1, error_code: 0 });
    send('/R_013/Turntable/feedback', { height: -9000, status: 6, error_code: 2 });

    expect(manager._safetyEvaluation().safe).toBe(true);
    expect(getElement('jog-actual-velocity').textContent).toContain('Lx 0.12');
    expect(getElement('jog-lift-height').textContent).toBe('12.34°');
    expect(getElement('jog-lift-feedback-status').textContent).toBe('RUNNING');
    expect(getElement('jog-turntable-angle').textContent).toBe('-90.00°');
    expect(getElement('jog-turntable-sync-state').textContent).toBe('ON');
    expect(getElement('jog-turntable-error').textContent).toBe('0x0002');
    manager._stopTelemetry();
    expect(topics.every(topic => topic.unsubscribed)).toBe(true);
  });

  test('maps R, V, T shortcuts to target, cancel, and Sync toggle', () => {
    const { manager, listeners } = loadJog();
    manager._runStlTurntableTarget = jest.fn();
    manager._cancelStlTurntable = jest.fn();
    manager._setTurntableSync = jest.fn();
    manager._setupKeyboard();
    const event = key => ({
      key,
      repeat: false,
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn()
    });

    listeners.keydown(event('r'));
    listeners.keydown(event('v'));
    listeners.keydown(event('t'));

    expect(manager._runStlTurntableTarget).toHaveBeenCalledWith(10);
    expect(manager._cancelStlTurntable).toHaveBeenCalled();
    expect(manager._setTurntableSync).toHaveBeenCalledWith(true);
  });

  test('stops an active Jog as soon as a safety input becomes unsafe', () => {
    const { manager } = loadJog();
    const at = Date.now();
    manager._safetyState = Object.fromEntries(
      ['manual', 'idle', 'emo', 'sto', 'lidar', 'brake'].map(key => [key, { value: true, at }])
    );
    manager._publishing = true;
    manager._stopJogControls = jest.fn(() => { manager._publishing = false; });

    manager._recordSafety('sto', false);

    expect(manager._stopJogControls).toHaveBeenCalledTimes(1);
    expect(manager._safetyEvaluation().safe).toBe(false);
  });

  test('calls the RID-scoped Turntable Sync service after confirmation', async () => {
    const { manager, context, serviceCalls } = loadJog();
    const at = Date.now();
    manager._safetyState = Object.fromEntries(
      ['manual', 'idle', 'emo', 'sto', 'lidar', 'brake'].map(key => [key, { value: true, at }])
    );
    manager._stopVel = jest.fn();
    manager._stopManualLift = jest.fn();

    await manager._setTurntableSync(true);

    expect(serviceCalls[0]).toMatchObject({
      options: {
        name: '/R_013/Turntable/sync_mode',
        serviceType: 'std_srvs/SetBool'
      },
      request: { data: true }
    });
    expect(context.confirm.mock.calls[0][0]).toContain('대상 RID: R_013');
  });

  test('risk confirmation includes RID, endpoint, and payload', () => {
    const { manager, context } = loadJog();
    expect(manager._confirmRiskyCommand('시험 명령', {
      rid: 'R_013',
      endpoint: '/R_013/Turntable/sync_mode',
      payload: '{ data: true }'
    })).toBe(true);
    const text = context.confirm.mock.calls[0][0];
    expect(text).toContain('대상 RID: R_013');
    expect(text).toContain('ROS endpoint: /R_013/Turntable/sync_mode');
    expect(text).toContain('Payload: { data: true }');
  });
});
