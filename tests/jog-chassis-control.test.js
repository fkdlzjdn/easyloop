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
    setAttribute: jest.fn(),
    ...extra
  };
}

function loadJogControl(robotId = 'R_051') {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'jog-control.js'),
    'utf8'
  );
  const driveType = makeElement({ value: 'qd' });
  const liftControl = makeElement();
  const modelIoControl = makeElement({ hidden: true });
  const modelIoStatus = makeElement();
  const chassisCurrent = makeElement();
  const chassisButtons = [
    makeElement({ dataset: { modelId: 'default_lift_dd' } }),
    makeElement({ dataset: { modelId: 'sr3_ls_1st' } })
  ];
  const commandButtons = Array.from({ length: 6 }, () => makeElement());
  const elements = {
    'jog-drive-type': driveType,
    'jog-model-io-control': modelIoControl,
    'jog-model-io-status': modelIoStatus,
    'jog-chassis-current': chassisCurrent
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
      robotSlots: [{ robotId, ip: '192.168.20.51', connected: true, ros: {} }],
      toast: jest.fn()
    },
    RosManager: {
      getRos: jest.fn(() => ({ connected: true })),
      getRobotId: jest.fn(() => robotId)
    },
    ROSLIB: { Service, ServiceRequest },
    ActionSender: {},
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
    chassisCurrent
  };
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

  test('defines the requested sr3_ls_1st command codes', () => {
    const { manager } = loadJogControl();
    const commands = manager.CHASSIS_MODELS.find(model => model.id === 'sr3_ls_1st').commands;

    expect(commands.frontDoorOpen.cmdType).toBe(144);
    expect(commands.frontDoorClose.cmdType).toBe(145);
    expect(commands.rearDoorOpen.cmdType).toBe(146);
    expect(commands.rearDoorClose.cmdType).toBe(147);
    expect(commands.frontDischarge.cmdType).toBe(3);
    expect(commands.rearDischarge.cmdType).toBe(6);
    Object.values(commands).forEach(command => expect(command.count).toBe(1));
  });

  test('builds Conv/cmd from the active RID instead of hardcoding R_014', async () => {
    const { manager, calls, modelIoStatus } = loadJogControl('R_051');
    manager._chassisSelections = { R_051: 'sr3_ls_1st' };

    await manager._callChassisCommand('frontDoorOpen');

    expect(calls).toHaveLength(1);
    expect(calls[0].options.name).toBe('/R_051/Conv/cmd');
    expect(calls[0].options.serviceType).toBe('syscon_msgs/conv_cmd');
    expect(calls[0].request.cmds).toEqual([{ cmd_type: 144, count: 1 }]);
    expect(modelIoStatus.className).toContain('success');
  });
});
