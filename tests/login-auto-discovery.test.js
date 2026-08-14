const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement() {
  return {
    style: {},
    value: '',
    textContent: '',
    disabled: false,
    dataset: {},
    hidden: true,
    focus: jest.fn(),
    addEventListener: jest.fn(),
    appendChild: jest.fn(),
    setAttribute: jest.fn(),
    contains: jest.fn(() => false),
    querySelectorAll: jest.fn(() => []),
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
    documentElement: { dataset: {} },
    createElement: jest.fn(() => createElement()),
    getElementById: jest.fn(id => elements[id] || null),
    querySelector: jest.fn(() => null),
    querySelectorAll: jest.fn(() => [])
  };
  const context = {
    document,
    window: {
      addEventListener: jest.fn(),
      dispatchEvent: jest.fn()
    },
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
  test('map tool menus are mutually exclusive and close on outside click', () => {
    const { App, document } = loadApp();
    const menus = [createElement(), createElement(), createElement(), createElement()];
    menus.forEach(menu => { menu.open = false; });
    document.querySelectorAll.mockImplementation(selector => (
      selector === '.map-tool-menu' ? menus : []
    ));

    App.setupMapToolMenus();

    menus[1].open = true;
    menus[0].open = true;
    const firstToggle = menus[0].addEventListener.mock.calls
      .find(([eventName]) => eventName === 'toggle')[1];
    firstToggle();

    expect(menus[0].open).toBe(true);
    expect(menus[1].open).toBe(false);

    const outsideClick = document.addEventListener.mock.calls
      .find(([eventName]) => eventName === 'click')[1];
    outsideClick({ target: {} });

    expect(menus.every(menu => menu.open === false)).toBe(true);
  });

  test('header summary buttons open their detail popovers', () => {
    const { App, elements } = loadApp();
    [
      'btn-connection-summary',
      'connection-popover',
      'btn-test-mode-menu',
      'test-mode-popover',
      'btn-hdr-more',
      'hdr-more-menu'
    ].forEach(id => { elements[id] = createElement(); });

    App.setupHeaderPopovers();
    const connectionClick = elements['btn-connection-summary'].addEventListener.mock.calls
      .find(([eventName]) => eventName === 'click')[1];
    connectionClick({ stopPropagation: jest.fn() });

    expect(elements['connection-popover'].hidden).toBe(false);
    expect(elements['btn-connection-summary'].setAttribute)
      .toHaveBeenCalledWith('aria-expanded', 'true');
    expect(elements['test-mode-popover'].hidden).toBe(true);
  });

  test('the compact connection summary reports live data without a long label', () => {
    const { App, elements } = loadApp();
    [
      'active-robot-status',
      'btn-connection-summary',
      'connection-detail-state',
      'connection-detail-robot',
      'connection-detail-ip',
      'robot-model-name',
      'ros-latency'
    ].forEach(id => { elements[id] = createElement(); });
    App.robotSlots = [{
      robotId: 'R_001',
      ip: '192.168.20.51',
      robotModel: 'Scorpion',
      connected: true,
      ros: {}
    }];
    App.activeSlotIndex = 0;
    App.updateActionTargetLabel = jest.fn();

    App.updateActiveRobotStatus();

    expect(elements['active-robot-status'].textContent).toBe('수신');
    expect(elements['btn-connection-summary'].dataset.state).toBe('live');
    expect(elements['connection-detail-state'].textContent).toBe('연결됨 · 데이터 수신 중');
    expect(elements['connection-detail-ip'].textContent).toBe('192.168.20.51');
  });

  test('the compact BMS button opens one detail modal', () => {
    const { App, elements } = loadApp();
    [
      'btn-bms-detail',
      'bms-detail-modal',
      'btn-bms-modal-close',
      'btn-bms-set-target',
      'btn-bms-test-charge'
    ].forEach(id => { elements[id] = createElement(); });

    App.setupBmsDetails();
    const detailClick = elements['btn-bms-detail'].addEventListener.mock.calls
      .find(([eventName]) => eventName === 'click')[1];
    detailClick();

    expect(elements['bms-detail-modal'].classList.add).toHaveBeenCalledWith('show');
  });

  test('a failed optional initializer does not disable map or workspace controls', () => {
    const { App, document } = loadApp();
    App.initToastSystem = jest.fn();
    App.setupTabs = jest.fn();
    App.setupHeader = jest.fn(() => { throw new Error('header fixture failure'); });
    App.setupThemeToggle = jest.fn();
    App.setupMapControls = jest.fn();
    App.setupRobotManager = jest.fn();
    App.loadRobots = jest.fn();
    App._setupBeforeUnload = jest.fn();
    App.cleanupOldLogs = jest.fn();
    App.updateMultiRobotButtons = jest.fn();

    App.init();

    expect(App.setupTabs).toHaveBeenCalledTimes(1);
    expect(App.setupMapControls).toHaveBeenCalledTimes(1);
    expect(App.setupRobotManager).toHaveBeenCalledTimes(1);
    expect(App._initializationResults.header).toBe(false);
    expect(App._initializationResults['map-controls']).toBe(true);
    expect(document.documentElement.dataset.easyloopCoreReady).toBe('true');
  });

  test('the login button submits 0000 and opens the main UI', async () => {
    const { App, context, elements, document } = loadApp();
    ['password-overlay', 'password-input', 'password-submit', 'password-error', 'main-content', 'btn-logout']
      .forEach(id => { elements[id] = createElement(); });
    context.fetch
      .mockResolvedValueOnce({
        json: async () => ({ authenticated: false, role: null })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, role: 'user' })
      });
    App._applyRoleRestrictions = jest.fn();
    App.startLoginRobotDiscovery = jest.fn();

    App.setupPasswordAuth();
    await new Promise(resolve => setImmediate(resolve));
    elements['password-input'].value = '0000';
    const clickHandler = elements['password-submit'].addEventListener.mock.calls
      .find(([eventName]) => eventName === 'click')[1];

    await clickHandler({ preventDefault: jest.fn() });

    expect(context.fetch).toHaveBeenLastCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ password: '0000', role: 'user' })
      })
    );
    expect(document.querySelector).toHaveBeenCalledWith('input[name="login-role"]:checked');
    expect(elements['password-overlay'].style.display).toBe('none');
    expect(elements['main-content'].style.display).toBe('flex');
    expect(App.startLoginRobotDiscovery).toHaveBeenCalledTimes(1);
  });

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
      replaceCurrent: true,
      discoveryMode: 'rosbridge',
      scanPort: 9090,
      persistPreferences: false
    });
  });

  test('login RID discovery ignores a saved SSH forwarding mode and port', () => {
    const { App, storage } = loadApp();
    storage.set('easyloopScanMode', 'ssh');
    storage.set('easyloopScanPort', '2222');
    storage.set('easyloopSshScanPort', '2222');
    App.runNetworkScan = jest.fn();

    App.startLoginRobotDiscovery();

    expect(App.runNetworkScan).toHaveBeenCalledWith({
      autoConnect: true,
      background: true,
      replaceCurrent: true,
      discoveryMode: 'rosbridge',
      scanPort: 9090,
      persistPreferences: false
    });
  });

  test('switching from a saved SSH scan restores the ROS Bridge RID port', () => {
    const { App, elements, storage } = loadApp();
    ['btn-rm-scan', 'rm-scan-subnet', 'rm-scan-mode', 'rm-scan-port']
      .forEach(id => { elements[id] = createElement(); });
    elements['rm-scan-subnet'].value = '192.168.20';
    elements['rm-scan-mode'].value = 'rosbridge';
    elements['rm-scan-port'].value = '9090';
    storage.set('easyloopScanMode', 'ssh');
    storage.set('easyloopScanPort', '2222');

    App.setupNetworkScan();

    expect(elements['rm-scan-mode'].value).toBe('ssh');
    expect(elements['rm-scan-port'].value).toBe('2222');

    elements['rm-scan-mode'].value = 'rosbridge';
    const changeHandler = elements['rm-scan-mode'].addEventListener.mock.calls
      .find(([eventName]) => eventName === 'change')[1];
    changeHandler();

    expect(elements['rm-scan-port'].value).toBe('9090');
  });

  test('an SSH forwarding scan discovers endpoints without auto-starting a tunnel', async () => {
    const { App, context, elements } = loadApp();
    [
      'btn-rm-scan',
      'btn-robot-scan',
      'rm-scan-subnet',
      'rm-scan-mode',
      'rm-scan-port',
      'rm-scan-status',
      'rm-scan-results',
      'rm-scan-list'
    ].forEach(id => { elements[id] = createElement(); });
    elements['rm-scan-subnet'].value = '192.168.20';
    elements['rm-scan-mode'].value = 'ssh';
    elements['rm-scan-port'].value = '2222';
    context.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        subnet: '192.168.20',
        fixedTarget: '192.168.3.5',
        hosts: [{
          ip: '192.168.20.63',
          port: 2222,
          sshPort: 2222,
          portForwarded: true,
          robotId: null
        }]
      })
    });
    App._readManualRobotConfigs = jest.fn(() => [{
      ip: '192.168.20.63',
      robotId: 'R_063',
      sshPort: 2222,
      robotNumber: 63
    }]);
    App.stageDiscoveredRobots = jest.fn();

    await App.runNetworkScan({
      autoConnect: true,
      replaceCurrent: true
    });

    expect(App.stageDiscoveredRobots).not.toHaveBeenCalled();
    expect(elements['rm-scan-status'].textContent).toBe('1대 발견 · RID 1대 확인');
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

  test('replacement scans preserve manually added robot settings and persistent storage', () => {
    const { App, context, storage } = loadApp();
    context.RosManager = {
      ros: null,
      _autoReconnect: {},
      _clearAutoReconnect: jest.fn(),
      disconnectSlot: jest.fn()
    };
    App.connectSlot = jest.fn();
    App.renderActiveRobotSelector = jest.fn();
    App.renderRobotManagerList = jest.fn();
    App.renderMonitoringCards = jest.fn();
    App.updateActiveRobotStatus = jest.fn();
    App.updateActionTargetLabel = jest.fn();
    App.updateMultiRobotButtons = jest.fn();
    App.addRobotSlot(
      '192.168.20.63',
      'R_063',
      2222,
      true,
      'robot-password',
      63,
      null,
      { manualAdded: true, deferRender: true, silent: true }
    );

    App.stageDiscoveredRobots([
      { ip: '192.168.20.52', robotId: 'R_052' }
    ], { replaceCurrent: true, silent: true });

    const manual = App.robotSlots.find(slot => slot.ip === '192.168.20.63');
    expect(manual).toMatchObject({
      robotId: 'R_063',
      sshPort: 2222,
      tunnelMode: true,
      manualAdded: true,
      source: 'manual'
    });
    expect(manual.sshPassword).toBe('robot-password');
    expect(App.robotSlots.map(slot => slot.ip)).toEqual([
      '192.168.20.63',
      '192.168.20.52'
    ]);
    const persisted = JSON.parse(storage.get(App.MANUAL_ROBOTS_STORAGE_KEY));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      ip: '192.168.20.63',
      robotId: 'R_063',
      sshPort: 2222,
      tunnelMode: true
    });
    expect(persisted[0].sshPassword).not.toBe('robot-password');
  });

  test('a discovered forwarding endpoint keeps its SSH port and tunnel mode', () => {
    const { App, context } = loadApp();
    context.RosManager = { ros: null, _autoReconnect: {} };
    App.connectSlot = jest.fn();
    App.renderActiveRobotSelector = jest.fn();
    App.renderRobotManagerList = jest.fn();
    App.renderMonitoringCards = jest.fn();
    App.updateActiveRobotStatus = jest.fn();
    App.updateActionTargetLabel = jest.fn();
    App.updateMultiRobotButtons = jest.fn();

    App.stageDiscoveredRobots([{
      ip: '192.168.20.63',
      robotId: 'R_063',
      sshPort: 2222,
      portForwarded: true,
      discoveryMode: 'ssh'
    }], { replaceCurrent: false, silent: true });

    expect(App.robotSlots[0]).toMatchObject({
      ip: '192.168.20.63',
      robotId: 'R_063',
      sshPort: 2222,
      tunnelMode: true,
      wsPort: 9090
    });
  });

  test('an unidentified forwarding endpoint prefills the manual robot form', () => {
    const { App, elements } = loadApp();
    ['rm-new-ip', 'rm-new-id', 'rm-new-ssh-port', 'rm-new-tunnel-mode']
      .forEach(id => { elements[id] = createElement(); });
    App.toast = jest.fn();

    App.prefillForwardedRobot({
      ip: '192.168.20.63',
      sshPort: 2222,
      portForwarded: true
    });

    expect(elements['rm-new-ip'].value).toBe('192.168.20.63');
    expect(elements['rm-new-ssh-port'].value).toBe('2222');
    expect(elements['rm-new-tunnel-mode'].checked).toBe(true);
    expect(elements['rm-new-id'].focus).toHaveBeenCalled();
  });

  test('forwarding discovery matches IP and SSH port instead of IP alone', () => {
    const { App } = loadApp();
    App.robotSlots = [
      {
        ip: '192.168.20.63',
        robotId: 'R_063',
        sshPort: 22,
        tunnelMode: false
      },
      {
        ip: '192.168.20.63',
        robotId: 'R_063',
        sshPort: 2222,
        tunnelMode: true
      }
    ];

    expect(App._findDiscoveredSlotIndex({
      ip: '192.168.20.63',
      sshPort: 2222,
      portForwarded: true
    })).toBe(1);
    expect(App._findDiscoveredSlotIndex({
      ip: '192.168.20.63',
      sshPort: 2200,
      portForwarded: true
    })).toBe(-1);
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

  test('a late login scan cannot replace the active Test Mode virtual fleet', () => {
    const { App, context } = loadApp();
    App.robotSlots = [
      { ip: '127.0.0.1', robotId: 'R_TEST_1', virtualTestRobot: true }
    ];
    App.activeSlotIndex = 0;
    context.TestMode = { _starting: false, enabled: true };
    App.clearCurrentRobotSlots = jest.fn();
    App.connectSlot = jest.fn();

    const result = App.stageDiscoveredRobots([
      { ip: '192.168.20.52', robotId: 'R_002' }
    ], { replaceCurrent: true, silent: true });

    expect(App.clearCurrentRobotSlots).not.toHaveBeenCalled();
    expect(App.connectSlot).not.toHaveBeenCalled();
    expect(App.robotSlots[0].robotId).toBe('R_TEST_1');
    expect(App.activeSlotIndex).toBe(0);
    expect(result.testModePreserved).toBe(true);
  });
});
