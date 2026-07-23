const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement() {
  return {
    style: {},
    value: '',
    textContent: '',
    disabled: false,
    focus: jest.fn(),
    addEventListener: jest.fn(),
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      contains: jest.fn(() => false)
    }
  };
}

function loadApp() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const storage = new Map();
  const elements = {};
  const document = {
    addEventListener: jest.fn(),
    getElementById: jest.fn(id => elements[id] || null),
    querySelector: jest.fn(() => null),
    querySelectorAll: jest.fn(() => [])
  };
  const context = {
    document,
    window: { addEventListener: jest.fn() },
    navigator: { sendBeacon: jest.fn() },
    localStorage: {
      getItem: jest.fn(key => storage.has(key) ? storage.get(key) : null),
      setItem: jest.fn((key, value) => storage.set(key, String(value))),
      removeItem: jest.fn(key => storage.delete(key))
    },
    fetch: jest.fn(),
    AbortController,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Blob,
    URL: { createObjectURL: jest.fn() },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary')
  };

  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__App = App;`, context);
  return { App: context.__App, context, document, elements, storage };
}

describe('login robot auto-discovery', () => {
  test('an authenticated login starts a background replacement scan', async () => {
    const { App, context, elements } = loadApp();
    ['password-overlay', 'password-input', 'password-submit', 'password-error', 'main-content', 'btn-logout']
      .forEach(id => { elements[id] = createElement(); });
    context.fetch.mockResolvedValue({
      json: async () => ({ authenticated: true, role: 'user' })
    });
    App._applyRoleRestrictions = jest.fn();
    App.runNetworkScan = jest.fn();

    App.setupPasswordAuth();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    expect(App.runNetworkScan).toHaveBeenCalledTimes(1);
    expect(App.runNetworkScan).toHaveBeenCalledWith({
      autoConnect: true,
      background: true,
      replaceCurrent: true
    });
  });

  test('a successful replacement scan activates the lowest-numbered current robot first', () => {
    const { App, context, storage } = loadApp();
    App.robotSlots = [
      { ip: '192.168.20.51', robotId: 'R_001', connected: true, ros: {}, tunnelActive: false }
    ];
    App.activeSlotIndex = 0;
    context.RosManager = {
      ros: {},
      _autoReconnect: {},
      _clearAutoReconnect: jest.fn(),
      disconnectSlot: jest.fn()
    };
    App.connectSlot = jest.fn();
    App.renderActiveRobotSelector = jest.fn();
    App.renderRobotManagerList = jest.fn();
    App.renderMonitoringCards = jest.fn();
    App.updateActiveRobotStatus = jest.fn();
    App.updateMultiRobotButtons = jest.fn();
    storage.set(App.SLOTS_STORAGE_KEY, '{"old":true}');

    App.stageDiscoveredRobots([
      { ip: '192.168.20.57', robotId: 'R_007' },
      { ip: '192.168.20.52', robotId: 'R_002' }
    ], { replaceCurrent: true, silent: true });

    expect(context.RosManager.disconnectSlot).toHaveBeenCalledWith(0);
    expect(App.robotSlots.map(slot => slot.ip)).toEqual(['192.168.20.52', '192.168.20.57']);
    expect(App.activeSlotIndex).toBe(0);
    expect(App.connectSlot.mock.calls.map(call => call[0])).toEqual([0, 1]);
    expect(storage.has(App.SLOTS_STORAGE_KEY)).toBe(false);
    expect(JSON.parse(storage.get(App.LAST_ACTIVE_ROBOT_KEY))).toEqual({
      robotId: 'R_002',
      ip: '192.168.20.52'
    });
  });

  test('a currently discovered previous RID/IP resumes before lower-numbered robots', () => {
    const { App, context, storage } = loadApp();
    context.RosManager = { ros: null, _autoReconnect: {} };
    App.connectSlot = jest.fn();
    App.renderActiveRobotSelector = jest.fn();
    App.renderRobotManagerList = jest.fn();
    App.renderMonitoringCards = jest.fn();
    App.updateActiveRobotStatus = jest.fn();
    App.updateMultiRobotButtons = jest.fn();
    storage.set(App.LAST_ACTIVE_ROBOT_KEY, JSON.stringify({
      robotId: 'R_007',
      ip: '192.168.20.57'
    }));

    const result = App.stageDiscoveredRobots([
      { ip: '192.168.20.57', robotId: 'R_007' },
      { ip: '192.168.20.52', robotId: 'R_002' }
    ], { replaceCurrent: true, silent: true });

    expect(App.robotSlots.map(slot => slot.robotId)).toEqual(['R_002', 'R_007']);
    expect(App.activeSlotIndex).toBe(1);
    expect(result.activeRobotId).toBe('R_007');
    expect(App.connectSlot.mock.calls.map(call => call[0])).toEqual([1, 0]);
  });
});
