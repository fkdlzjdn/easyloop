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

  test('includes the SPX IO manager charge relay service used by newer software', () => {
    const { manager } = loadJogControl();

    const candidates = manager._chargeServiceCandidates('R_001');
    expect(candidates[0]).toBe('/R_001/io/set/auto_charge_relay');
    expect(candidates).toContain('/R_001/io/set/charge_relay');
  });

  test('detects the available charge service instead of reusing a stale software-version cache', async () => {
    const { manager, slot, context } = loadJogControl();
    slot.chargeServiceName = '/R_001/SUBCON_/charge_relay_cmd';
    context.ROSLIB.ServiceRequest = class ServiceRequest {};
    context.ROSLIB.Service = class Service {
      callService(request, success) {
        success({
          services: [
            '/R_001/io/set/charge_relay',
            '/R_001/io/set/auto_charge_relay'
          ]
        });
      }
    };

    await expect(manager._resolveChargeService({}, 'R_001', slot))
      .resolves.toBe('/R_001/io/set/auto_charge_relay');
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
});
