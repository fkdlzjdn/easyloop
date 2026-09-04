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
  const compatibilityProfile = {
    discovered: true,
    controlReady: true,
    id: 'ros1_legacy',
    task: { verified: true, protocol: 'ros1_legacy', goalName: '/R_013/TARU/goal' },
    mapping: { verified: true, protocol: 'ros1_legacy' },
    lift: {
      verified: true,
      interface: 'service',
      service: '/R_013/Lift/cmd',
      serviceType: 'syscon_msgs/lift_cmd',
      feedbackTopic: '/R_013/Lift/feedback',
      feedbackType: 'syscon_msgs/LiftFeedback',
      commands: { stop: 0, up: 1, down: 2 }
    },
    actions: {
      turntable: {
        verified: true,
        service: '/R_013/Turntable/cmd',
        serviceType: 'syscon_msgs/turntable_cmd',
        feedbackTopic: '/R_013/Turntable/feedback',
        feedbackType: 'syscon_msgs/LiftFeedback',
        syncService: '/R_013/Turntable/sync_mode',
        syncType: 'std_srvs/SetBool'
      }
    },
    chassis: {
      verified: true,
      drive: { verified: true, topic: '/R_013/cmd_vel', topicType: 'geometry_msgs/Twist' },
      conveyor: { verified: false, reason: '미지원' }
    },
    monitoring: {
      verified: true,
      topics: {
        manualSelect: { name: '/R_013/io/select', type: 'std_msgs/Bool' },
        robotState: { name: '/R_013/robot_state', type: 'syscon_msgs/RobotState' },
        emergency: { name: '/R_013/emergency_sensor', type: 'std_msgs/Int32MultiArray' },
        sto: { name: '/R_013/sto_stop', type: 'std_msgs/Bool' },
        lidarField: { name: '/R_013/io/lidar_field', type: 'std_msgs/UInt8' },
        brakeReleased: { name: '/R_013/io/break_released', type: 'std_msgs/Bool' },
        motorStatus: { name: '/R_013/motor_status', type: 'syscon_msgs/MotorState' },
        odom: { name: '/R_013/odom', type: 'nav_msgs/Odometry' }
      }
    }
  };
  slot.compatibilityProfile = compatibilityProfile;
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
      get: () => compatibilityProfile,
      requireCapability: (profile, name) => {
        const capability = name === 'turntable' ? profile.actions.turntable : profile[name];
        if (!capability?.verified) throw new Error(`${name} 미검증`);
        return capability;
      }
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

  test('holds drive input with pointer capture until release', () => {
    const { manager, getElement } = loadJog();
    const button = getElement('jog-fwd');
    button.setPointerCapture = jest.fn();
    button.hasPointerCapture = jest.fn(() => true);
    button.releasePointerCapture = jest.fn();
    manager._setVel = jest.fn(() => true);
    manager._stopVel = jest.fn();
    manager._setupButtons();
    const listener = name => button.addEventListener.mock.calls
      .find(([event]) => event === name)?.[1];

    listener('pointerdown')({ pointerId: 7, preventDefault: jest.fn() });
    expect(button.setPointerCapture).toHaveBeenCalledWith(7);
    expect(manager._setVel).toHaveBeenCalledTimes(1);
    expect(manager._stopVel).not.toHaveBeenCalled();

    listener('pointerup')({ pointerId: 7 });
    expect(button.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(manager._stopVel).toHaveBeenCalledTimes(1);
  });

  test('fails closed until every required STL safety signal is fresh and safe', () => {
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

  test('treats unavailable event safety topics as N/A but blocks an explicit unsafe event', () => {
    const { manager, getElement } = loadJog();
    const at = Date.now();
    manager._safetyState = manager._emptySafetyState();
    ['manual', 'idle', 'sto', 'brake'].forEach(key => {
      manager._safetyState[key] = { value: true, at };
    });

    expect(manager._safetyEvaluation()).toMatchObject({ safe: true, strict: true });
    manager._refreshSafetyUi();
    expect(getElement('jog-safety-emo').textContent).toBe('EMO N/A');
    expect(getElement('jog-safety-lidar').textContent).toBe('LIDAR N/A');

    manager._safetyState.emo = { value: false, at };
    expect(manager._safetyEvaluation().reasons).toContain('EMO 정상 미확인');
  });

  test('routes cmd_vel through the dedicated worker when it is ready', () => {
    const { manager } = loadJog();
    manager._jogWorker = { postMessage: jest.fn() };
    manager._jogWorkerReady = true;
    manager._publishing = true;
    manager._currentLx = 0.2;
    manager._currentLy = 0;
    manager._currentAz = -0.1;

    expect(manager._publishOnce()).toBe(true);
    expect(manager._jogWorker.postMessage).toHaveBeenCalledWith({
      type: 'command',
      active: true,
      velocity: { lx: 0.2, ly: 0, az: -0.1 }
    });
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
    ['/R_013/motor_status', '/R_013/odom'].forEach(name => {
      const topic = topics.find(item => item.options.name === name);
      expect(topic.options.throttle_rate).toBe(manager.VELOCITY_THROTTLE_MS);
      expect(topic.options.queue_length).toBe(1);
    });
    expect(getElement('jog-actual-velocity').textContent).toContain('Lx 0.12');
    expect(getElement('jog-lift-height').textContent).toBe('12.34°');
    expect(getElement('jog-lift-feedback-status').textContent).toBe('RUNNING');
    expect(getElement('jog-turntable-angle').textContent).toBe('-90.00°');
    expect(getElement('jog-turntable-sync-state').textContent).toBe('ON');
    expect(getElement('jog-turntable-error').textContent).toBe('0x0002');
    manager._stopTelemetry();
    expect(topics.every(topic => topic.unsubscribed)).toBe(true);
  });

  test('uses fresh odometry instead of holding a slower motor velocity sample', () => {
    const { manager, getElement } = loadJog();
    const now = Date.now();
    manager._actualVelocity = {
      motor: { lx: 0.05, ly: 0, az: 0, at: now - 500 },
      odom: { lx: 0.42, ly: 0, az: -0.1, at: now }
    };

    manager._renderVelocityComparison();

    expect(getElement('jog-actual-velocity').textContent).toContain('Lx 0.42');
    expect(getElement('jog-velocity-source').textContent).toContain('odom.twist');
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
