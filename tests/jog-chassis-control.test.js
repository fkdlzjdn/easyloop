const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeClassList() {
  const values = new Set();
  return {
    add: jest.fn(name => values.add(name)),
    remove: jest.fn(name => values.delete(name)),
    toggle: jest.fn((name, enabled) => {
      if (enabled) values.add(name);
      else values.delete(name);
    }),
    contains: name => values.has(name)
  };
}

function makeElement(extra = {}) {
  return {
    value: '',
    textContent: '',
    className: '',
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    classList: makeClassList(),
    addEventListener: jest.fn(),
    setAttribute: jest.fn(),
    ...extra
  };
}

function loadJogControl(robotId = 'R_051', robotModel = null) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'jog-control.js'),
    'utf8'
  );
  const driveType = makeElement({ value: 'qd' });
  const liftControl = makeElement();
  const modelIoControl = makeElement({ hidden: true });
  const modelIoStatus = makeElement();
  const stlUlsanControl = makeElement({ hidden: true });
  const turntableStatus = makeElement();
  const chassisCurrent = makeElement();
  const chassisButtons = [
    makeElement({ dataset: { modelId: 'default_lift_dd' } }),
    makeElement({ dataset: { modelId: 'stl_ulsan' } }),
    makeElement({ dataset: { modelId: 'sr3_ls_1st' } })
  ];
  const commandButtons = [
    'frontDoorOpen',
    'frontDoorClose',
    'rearDoorOpen',
    'rearDoorClose',
    'frontIntake',
    'rearDischarge',
    'conveyorStop'
  ].map(command => makeElement({ dataset: { chassisCommand: command } }));
  const commandPreview = makeElement();
  const elements = {
    'jog-drive-type': driveType,
    'jog-model-io-control': modelIoControl,
    'jog-model-io-status': modelIoStatus,
    'jog-model-io-command-preview': commandPreview,
    'jog-chassis-current': chassisCurrent,
    'jog-stl-ulsan-control': stlUlsanControl,
    'jog-turntable-status': turntableStatus
  };
  const calls = [];

  class ServiceRequest {
    constructor(values) {
      Object.assign(this, values);
    }
  }

  class Service {
    constructor(options) {
      this.options = options;
    }

    callService(request, success) {
      calls.push({ options: this.options, request });
      success({ success: true, error_code: 0 });
    }
  }

  const storage = new Map();
  const context = {
    App: {
      activeSlotIndex: 0,
      robotSlots: [{ robotId, robotModel, ip: '192.168.20.51', connected: true, ros: {} }],
      toast: jest.fn()
    },
    RosManager: {
      getRos: jest.fn(() => ({ connected: true })),
      getRobotId: jest.fn(() => robotId)
    },
    ROSLIB: { Service, ServiceRequest },
    RobotCompatibility: {
      isStlUlsanModel: model => ['stl1000w', 'stl1500w'].includes(String(model || '').toLowerCase()),
      get: slot => slot.compatibilityProfile || {
        discovered: true,
        lift: { interface: 'topic' }
      }
    },
    ActionSender: {
      sendJogActionToSlot: jest.fn().mockResolvedValue({ result: { success: true } }),
      cancelTaskOnSlot: jest.fn().mockResolvedValue({ success: true })
    },
    localStorage: {
      getItem: jest.fn(key => storage.get(key) || null),
      setItem: jest.fn((key, value) => storage.set(key, String(value)))
    },
    document: {
      addEventListener: jest.fn(),
      getElementById: jest.fn(id => elements[id] || null),
      querySelector: jest.fn(selector =>
        selector === '.jog-manual-lift' ? liftControl : null
      ),
      querySelectorAll: jest.fn(selector => {
        if (selector === '.jog-chassis-option') return chassisButtons;
        if (selector === '[data-chassis-command]') return commandButtons;
        if (selector === '.jog-qd-only') return [];
        return [];
      })
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__JogControl = JogControl;`, context);
  const manager = context.__JogControl;
  manager._stopVel = jest.fn();
  manager._updateQuickTaskTarget = jest.fn();
  return {
    manager,
    context,
    calls,
    driveType,
    liftControl,
    modelIoControl,
    modelIoStatus,
    stlUlsanControl,
    turntableStatus,
    commandButtons,
    commandPreview,
    chassisCurrent
  };
}

function markSafetyReady(manager) {
  const at = Date.now();
  manager._safetyState = Object.fromEntries(
    ['manual', 'idle', 'emo', 'sto', 'lidar', 'brake'].map(key => [key, { value: true, at }])
  );
}

describe('Jog chassis model control', () => {
  test('sr3_ls_1st selects DD drive and swaps lift controls for conveyor controls', () => {
    const {
      manager,
      driveType,
      liftControl,
      modelIoControl,
      chassisCurrent
    } = loadJogControl();
    manager._chassisSelections = { R_051: 'sr3_ls_1st' };

    manager._syncChassisModelUi();

    expect(driveType.value).toBe('dd');
    expect(liftControl.hidden).toBe(true);
    expect(modelIoControl.hidden).toBe(false);
    expect(chassisCurrent.textContent).toBe('sr3_ls_1st · DD');
    expect(manager._stopVel).toHaveBeenCalled();
  });

  test('falls back to the unchanged basic lift UI when no model is selected', () => {
    const {
      manager,
      driveType,
      liftControl,
      modelIoControl,
      chassisCurrent
    } = loadJogControl();
    manager._chassisSelections = {};

    manager._syncChassisModelUi();

    expect(manager._getSelectedChassisModel().id).toBe('default_lift_dd');
    expect(driveType.value).toBe('dd');
    expect(liftControl.hidden).toBe(false);
    expect(modelIoControl.hidden).toBe(true);
    expect(chassisCurrent.textContent).toBe('선택 안 함 (기본) · DD');
  });

  test.each(['stl1000w', 'stl1500w'])('auto-selects stl_ulsan controls only for ROBOT_MODEL %s', robotModel => {
    const { manager, stlUlsanControl, modelIoControl, chassisCurrent } = loadJogControl(
      'R_051',
      robotModel
    );

    manager._syncChassisModelUi(false);

    expect(manager._getSelectedChassisModel().id).toBe('stl_ulsan');
    expect(stlUlsanControl.hidden).toBe(false);
    expect(modelIoControl.hidden).toBe(true);
    expect(chassisCurrent.textContent).toBe('stl_ulsan · Lift / Turntable · DD');
  });

  test('sends and cancels a Turntable Jog through the Task input/cancel API', async () => {
    const { manager, context, turntableStatus } = loadJogControl('R_051', 'stl1500w');
    markSafetyReady(manager);

    await manager._runStlTurntableTarget(-90);
    expect(context.ActionSender.sendJogActionToSlot).toHaveBeenCalledWith(
      0,
      0x22,
      [3, -90, 0],
      expect.stringMatching(/^easyloop_turntable_/)
    );
    expect(turntableStatus.className).toContain('success');

    await manager._cancelStlTurntable();
    expect(context.ActionSender.cancelTaskOnSlot).toHaveBeenCalledWith(0);
  });

  test('defines the requested sr3_ls_1st command codes', () => {
    const { manager } = loadJogControl();
    const commands = manager.CHASSIS_MODELS.find(model => model.id === 'sr3_ls_1st').commands;

    expect(commands.frontDoorOpen.cmdType).toBe(144);
    expect(commands.frontDoorClose.cmdType).toBe(145);
    expect(commands.rearDoorOpen.cmdType).toBe(146);
    expect(commands.rearDoorClose.cmdType).toBe(147);
    expect(commands.frontIntake).toMatchObject({ cmdType: 3, count: 0 });
    expect(commands.rearDischarge).toMatchObject({ cmdType: 6, count: 0 });
    expect(commands.conveyorStop).toMatchObject({ cmdType: 2, count: 0 });
    [
      commands.frontDoorOpen,
      commands.frontDoorClose,
      commands.rearDoorOpen,
      commands.rearDoorClose
    ].forEach(command => expect(command.count).toBe(1));
  });

  test.each([
    ['frontIntake', 3, 0],
    ['rearDischarge', 6, 0],
    ['conveyorStop', 2, 0]
  ])('sends %s through the active RID Conv/cmd service', async (commandKey, cmdType, count) => {
    const { manager, calls, modelIoStatus } = loadJogControl('R_051');
    manager._chassisSelections = { R_051: 'sr3_ls_1st' };

    await manager._callChassisCommand(commandKey);

    expect(calls).toHaveLength(1);
    expect(calls[0].options.name).toBe('/R_051/Conv/cmd');
    expect(calls[0].options.serviceType).toBe('syscon_msgs/conv_cmd');
    expect(calls[0].request.cmds).toEqual([{ cmd_type: cmdType, count }]);
    expect(modelIoStatus.className).toContain('success');
  });

  test('simulates chassis service commands without a real ROS service in Test Mode', async () => {
    const { manager, context, calls, modelIoStatus } = loadJogControl('R_TEST_1');
    context.App.robotSlots[0].virtualTestRobot = true;
    context.TestMode = { enabled: true };
    manager._chassisSelections = { R_TEST_1: 'sr3_ls_1st' };

    await manager._callChassisCommand('frontIntake');

    expect(calls).toHaveLength(0);
    expect(modelIoStatus.className).toContain('success');
    expect(modelIoStatus.textContent).toContain('Test Mode 실행 완료');
  });

  test('shows the description, service, type, and request on hover help', () => {
    const { manager, commandButtons, commandPreview } = loadJogControl('R_051');
    manager._chassisSelections = { R_051: 'sr3_ls_1st' };

    manager._refreshChassisCommandHelp();
    manager._showChassisCommandHelp('conveyorStop');

    const stopButton = commandButtons.find(button =>
      button.dataset.chassisCommand === 'conveyorStop'
    );
    expect(stopButton.title).toContain('현재 컨베이어 동작을 정지합니다.');
    expect(stopButton.title).toContain('Service: /R_051/Conv/cmd');
    expect(stopButton.title).toContain('Type: syscon_msgs/conv_cmd');
    expect(stopButton.title).toContain('"cmd_type":2,"count":0');
    expect(commandPreview.textContent).toBe(stopButton.title);
  });
});
