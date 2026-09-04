const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeElement() {
  const classes = new Set();
  return {
    textContent: '',
    className: '',
    disabled: false,
    classList: {
      add(...names) {
        names.forEach(name => classes.add(name));
      },
      remove(...names) {
        names.forEach(name => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      }
    }
  };
}

function loadJogControl() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'jog-control.js'), 'utf8');
  const elements = {
    'jog-charge-relay-state': makeElement(),
    'jog-charge-progress': makeElement(),
    'jog-charge-on': makeElement(),
    'jog-charge-off': makeElement()
  };
  const slot = {
    robotId: 'R_001',
    connected: true,
    ros: {},
    chargeRelayOn: true,
    chargeRelayAssumed: false,
    bms: { current: 0, charging: false }
  };
  const context = {
    App: { activeSlotIndex: 0, robotSlots: [slot], toast: jest.fn() },
    RosManager: {
      getRos: jest.fn(() => slot.ros),
      getRobotId: jest.fn(() => slot.robotId)
    },
    RobotCompatibility: {
      get: target => target.compatibilityProfile || {
        discovered: true,
        chassis: { charge: { verified: false, reason: '미검증' } }
      }
    },
    ROSLIB: {},
    document: {
      addEventListener: jest.fn(),
      getElementById: jest.fn(id => elements[id] || null)
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    confirm: jest.fn(() => true)
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__JogControl = JogControl;`, context);
  return { manager: context.__JogControl, slot, elements, context };
}

describe('Jog charging control status', () => {
  test('shows normal charging only when BMS current confirms it', () => {
    const { manager, slot, elements } = loadJogControl();
    slot.bms = { current: 6.4, charging: true };

    manager.updateChargeStatus(slot);

    expect(elements['jog-charge-relay-state'].textContent).toBe('ON');
    expect(elements['jog-charge-progress'].className).toContain('charging');
    expect(elements['jog-charge-progress'].textContent).toContain('정상적으로 진행 중');
    expect(elements['jog-charge-progress'].textContent).toContain('6.4 A');
  });

  test('warns when relay is on but charging current is absent', () => {
    const { manager, slot, elements } = loadJogControl();
    slot.chargeRelayCommandAt = Date.now() - 9000;
    slot.bms = { current: 0, charging: false };

    manager.updateChargeStatus(slot);

    expect(elements['jog-charge-progress'].className).toContain('error');
    expect(elements['jog-charge-progress'].textContent).toContain('충전 전류가 확인되지 않습니다');
  });

  test('keeps charge endpoint candidates in the central compatibility resolver', () => {
    const compatibility = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'robot-compatibility.js'), 'utf8'
    );
    expect(compatibility).toContain('`${ns}/io/set/auto_charge_relay`');
    expect(compatibility).toContain('`${ns}/io/set/charge_relay`');
    expect(compatibility).toContain("['std_srvs/SetBool', 'std_srvs/srv/SetBool']");
  });

  test('detects the available charge service instead of reusing a stale software-version cache', async () => {
    const { manager, slot } = loadJogControl();
    slot.chargeServiceName = '/R_001/SUBCON_/charge_relay_cmd';
    slot.compatibilityProfile = {
      discovered: true,
      chassis: {
        charge: {
          verified: true,
          service: '/R_001/io/set/auto_charge_relay',
          serviceType: 'std_srvs/SetBool'
        }
      }
    };

    await expect(manager._resolveChargeService({}, 'R_001', slot))
      .resolves.toEqual({
        verified: true,
        service: '/R_001/io/set/auto_charge_relay',
        serviceType: 'std_srvs/SetBool'
      });
  });

  test('does not construct a ROSLIB service when charge endpoint/type is unverified', async () => {
    const { manager, context } = loadJogControl();
    context.ROSLIB.Service = jest.fn();

    await manager._setChargeRelay(true);

    expect(context.ROSLIB.Service).not.toHaveBeenCalled();
    expect(context.App.toast).toHaveBeenCalledWith(expect.stringContaining('충전 명령 차단'), 'error');
  });

  test('changes the active virtual robot charge state in Test Mode', async () => {
    const { manager, slot, context, elements } = loadJogControl();
    const setActiveCharging = jest.fn();
    slot.virtualTestRobot = true;
    context.TestMode = { enabled: true, setActiveCharging };

    await manager._setChargeRelay(true);

    expect(setActiveCharging).toHaveBeenCalledWith(true);
    expect(slot.chargeRelayOn).toBe(true);
    expect(slot.chargeServiceName).toContain('TestMode');
    expect(elements['jog-charge-on'].disabled).toBe(false);
    expect(elements['jog-charge-off'].disabled).toBe(false);
  });

  test('requires confirmation for charge ON and explains the real relay risk', async () => {
    const { manager, slot, context } = loadJogControl();
    const setActiveCharging = jest.fn();
    slot.virtualTestRobot = true;
    context.TestMode = { enabled: true, setActiveCharging };
    context.confirm.mockReturnValue(false);

    await manager._setChargeRelay(true);

    expect(context.confirm).toHaveBeenCalledTimes(1);
    expect(context.confirm.mock.calls[0][0]).toContain('실제 충전 릴레이');
    expect(context.confirm.mock.calls[0][0]).toContain('정말 충전을 시작');
    expect(setActiveCharging).not.toHaveBeenCalled();
    expect(manager._chargeCommandPending).toBe(false);
  });

  test('turns charge OFF immediately without confirmation', async () => {
    const { manager, slot, context } = loadJogControl();
    const setActiveCharging = jest.fn();
    slot.virtualTestRobot = true;
    context.TestMode = { enabled: true, setActiveCharging };

    await manager._setChargeRelay(false);

    expect(context.confirm).not.toHaveBeenCalled();
    expect(setActiveCharging).toHaveBeenCalledWith(false);
    expect(slot.chargeRelayOn).toBe(false);
  });
});
