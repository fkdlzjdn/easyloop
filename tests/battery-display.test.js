const fs = require('fs'), path = require('path'), vm = require('vm');

function harness(active = true) {
  const nodes = new Map();
  const document = { addEventListener() {}, getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', style: {}, classList: {
      add: jest.fn(), remove: jest.fn(), toggle: jest.fn()
    }, parentElement: { classList: { add: jest.fn(), remove: jest.fn() } } });
    return nodes.get(id);
  } };
  const app = { activeSlotIndex: active ? 0 : -1, robotSlots: [{}] };
  const context = { App: app, document, console, setTimeout, clearTimeout, setInterval, clearInterval };
  const manager = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/ros-manager.js'), 'utf8') + '\nRosManager', context);
  manager._renderBmsTrend = jest.fn(); manager._refreshBmsEtaDisplay = jest.fn(); manager._bmsEtaTimer = 1;
  return { manager, app, document, nodes, context };
}

describe('battery telemetry validity and display', () => {
  test('actual R_006 BatteryState displays the measured 87% without changing its value', () => {
    const { manager, app, document } = harness();
    manager._handleSlotBmsData(0, { voltage: 52.847, current: -1.58, percentage: 0.8700000047683716, power_supply_status: 3 });
    expect(app.robotSlots[0].bms.soc).toBeCloseTo(87);
    expect(app.robotSlots[0].bms).toMatchObject({ socValid: true, charging: false, receivedAt: expect.any(Number) });
    expect(document.getElementById('bms-gauge-text').textContent).toBe('87%');
    expect(document.getElementById('bms-soc').textContent).toBe('87.0 %');
  });

  test.each([null, undefined, false, true, '', '0.2', NaN, Infinity, -1, 1.1])('unknown percentage %p cannot become a low-battery trigger or a displayed 0%', percentage => {
    const { manager, app, document } = harness();
    manager._handleSlotBmsData(0, { voltage: 52, current: 0, percentage });
    expect(app.robotSlots[0].bms.socValid).toBe(false);
    expect(document.getElementById('bms-gauge-text').textContent).toBe('--%');
    expect(document.getElementById('bms-soc').textContent).toBe('--');
    expect(manager._bmsTrend).toHaveLength(0);
  });

  test.each([0, 1])('a genuine numeric percentage %p remains valid', percentage => {
    const { manager, app, document } = harness();
    manager._handleSlotBmsData(0, { voltage: 52, current: 0, percentage });
    expect(app.robotSlots[0].bms.socValid).toBe(true);
    expect(document.getElementById('bms-gauge-text').textContent).toBe(`${percentage * 100}%`);
  });

  test('ROS2 CHARGING status reaches the gauge even when current is below its threshold', () => {
    const { manager, app, document } = harness();
    manager._handleSlotBmsData(0, { voltage: 52, current: 0, percentage: 0.3, power_supply_status: 1 });
    expect(app.robotSlots[0].bms.charging).toBe(true);
    expect(document.getElementById('bms-gauge-fill').parentElement.classList.add).toHaveBeenCalledWith('charging');
    expect(manager._bmsIsCharging).toBe(true);
  });

  test('ROS1 percentage and current-based charging retain their original units', () => {
    const { manager, app, document } = harness();
    manager._handleSlotBmsData(0, { data: [52, 3, 30, 25, 6, 20] });
    expect(app.robotSlots[0].bms).toMatchObject({ soc: 30, socValid: true, charging: true });
    expect(document.getElementById('bms-gauge-text').textContent).toBe('30%');
    expect(manager._bmsTotalAh).toBe(20);
  });

  test('switching robots preserves an unknown SOC instead of showing 0%', () => {
    const { app, document, context } = harness();
    const actual = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8') + '\nApp',
      { ...context, window: { addEventListener() {} } });
    actual.activeSlotIndex = 0; actual.robotSlots = app.robotSlots;
    app.robotSlots[0].bms = { soc: 0, socValid: false, charging: false };
    actual.refreshActiveBmsDisplay();
    expect(document.getElementById('bms-gauge-text').textContent).toBe('--%');
    app.robotSlots[0].bms = { soc: 0, socValid: true, charging: false };
    actual.refreshActiveBmsDisplay();
    expect(document.getElementById('bms-gauge-text').textContent).toBe('0%');
  });
});
