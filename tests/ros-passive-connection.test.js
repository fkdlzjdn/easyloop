const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRosManager(activeSlotIndex = -1) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ros-manager.js'), 'utf8');
  const rosInstances = [];
  const elements = {};

  class FakeRos {
    constructor() {
      this.handlers = {};
      rosInstances.push(this);
    }

    on(event, callback) {
      this.handlers[event] = callback;
    }

    emit(event, value) {
      if (this.handlers[event]) this.handlers[event](value);
    }

    close() {}
  }

  const slot = {
    ip: '192.168.20.51',
    robotId: 'R_001',
    connected: false,
    ros: null,
    subscriptions: {},
    bms: { voltage: 0, current: 0, soc: 0, charging: false },
    workState: null,
    pose: null
  };

  const App = {
    activeSlotIndex,
    robotSlots: [slot],
    alarmSystem: { resetTopicTimes: jest.fn() },
    renderActiveRobotSelector: jest.fn(),
    renderRobotManagerList: jest.fn(),
    renderMonitoringCards: jest.fn(),
    saveRobotSlots: jest.fn(),
    updateMultiRobotButtons: jest.fn(),
    updateActiveRobotStatus: jest.fn(),
    refreshActiveBmsDisplay: jest.fn(),
    refreshActiveWorkStateDisplay: jest.fn(),
    refreshActivePoseDisplay: jest.fn(),
    toast: jest.fn()
  };
  const ActionSender = {
    onSlotConnectionChanged: jest.fn()
  };

  const context = {
    App,
    ActionSender,
    ROSLIB: { Ros: FakeRos },
    location: { protocol: 'http:', host: 'localhost:3000' },
    document: {
      addEventListener: jest.fn(),
      getElementById: jest.fn(id => elements[id] || null),
      querySelectorAll: jest.fn(() => [])
    },
    window: {
      listeners: {},
      addEventListener(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
      }
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__RosManager = RosManager;`, context);

  return {
    manager: context.__RosManager,
    App,
    slot,
    rosInstances,
    elements,
    ActionSender,
    window: context.window
  };
}

function makeElement() {
  const classes = new Set();
  return {
    textContent: '',
    title: '',
    style: {},
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      remove(...names) {
        names.forEach(name => classes.delete(name));
      },
      add(...names) {
        names.forEach(name => classes.add(name));
      },
      contains(name) {
        return classes.has(name);
      }
    }
  };
}

describe('ROS passive fleet connections', () => {
  test('a non-active connected robot does not subscribe to any topic data', () => {
    const { manager, slot, rosInstances } = loadRosManager(-1);
    manager.subscribeSlotMonitoring = jest.fn();
    manager.subscribeActiveSlotUI = jest.fn();
    manager.startLatencyMonitor = jest.fn();

    manager.connectSlot(0, slot.ip, slot.robotId);
    rosInstances[0].emit('connection');

    expect(slot.connected).toBe(true);
    expect(manager.subscribeSlotMonitoring).not.toHaveBeenCalled();
    expect(manager.subscribeActiveSlotUI).not.toHaveBeenCalled();
    expect(manager.startLatencyMonitor).not.toHaveBeenCalled();
  });

  test('the active connected robot starts monitoring and UI subscriptions', () => {
    const { manager, slot, rosInstances, ActionSender } = loadRosManager(0);
    manager.subscribeSlotMonitoring = jest.fn();
    manager.subscribeActiveSlotUI = jest.fn();
    manager.startLatencyMonitor = jest.fn();
    manager._fetchRobotModel = jest.fn();

    manager.connectSlot(0, slot.ip, slot.robotId);
    rosInstances[0].emit('connection');

    expect(manager.subscribeSlotMonitoring).toHaveBeenCalledWith(0);
    expect(manager.subscribeActiveSlotUI).toHaveBeenCalledWith(0);
    expect(manager.startLatencyMonitor).toHaveBeenCalledWith(0);
    expect(ActionSender.onSlotConnectionChanged).toHaveBeenCalledWith(0, true);
  });

  test('Quick Task waypoint selection uses the first click for position and the second for direction', () => {
    const { manager } = loadRosManager(0);
    const callback = jest.fn();
    const onPhaseChange = jest.fn();
    manager.requestRender = jest.fn();
    manager._canvasToWorld = jest.fn(() => ({ x: 1.25, y: -2.5 }));
    manager._waypointSelectCallback = callback;
    manager._waypointSelectionOptions = { twoClick: true, onPhaseChange };
    manager._waypointStartX = 10;
    manager._waypointStartY = 10;
    manager._waypointCurrentX = 10;
    manager._waypointCurrentY = 10;

    manager._commitWaypointSelect({});

    expect(manager._waypointDirectionPending).toBe(true);
    expect(onPhaseChange).toHaveBeenCalledWith('direction', { x: 1.25, y: -2.5 });
    expect(callback).not.toHaveBeenCalled();

    manager._waypointCurrentX = 10;
    manager._waypointCurrentY = 0;
    manager._commitWaypointSelect({});

    expect(callback).toHaveBeenCalledWith(1.25, -2.5, Math.PI / 2);
    expect(manager._waypointDirectionPending).toBe(false);
  });

  test('continuous WayPoint capture re-arms at the next clicked position', () => {
    const { manager } = loadRosManager(0);
    const callback = jest.fn();
    manager.requestRender = jest.fn();
    manager._waypointSelectMode = true;
    manager._waypointSelectCallback = callback;
    manager._waypointSelectionOptions = { twoClick: true };
    manager._canvasToWorld = jest.fn((x, y) => ({ x: x / 10, y: y / 10 }));

    manager._waypointStartX = 10;
    manager._waypointStartY = 20;
    manager._waypointCurrentX = 10;
    manager._waypointCurrentY = 20;
    manager._commitWaypointSelect({});
    manager._waypointCurrentX = 20;
    manager._waypointCurrentY = 20;
    manager._commitWaypointSelect({});

    expect(callback.mock.calls[0].slice(0, 2)).toEqual([1, 2]);
    expect(callback.mock.calls[0][2]).toBeCloseTo(0);
    expect(manager._waypointDirectionPending).toBe(false);

    manager._waypointStartX = 50;
    manager._waypointStartY = 60;
    manager._waypointCurrentX = 50;
    manager._waypointCurrentY = 60;
    manager._commitWaypointSelect({});
    manager._waypointCurrentX = 50;
    manager._waypointCurrentY = 50;
    manager._commitWaypointSelect({});

    expect(callback).toHaveBeenNthCalledWith(2, 5, 6, Math.PI / 2);
    expect(manager._waypointDirectionPending).toBe(false);
  });

  test('real map mouse events move the next WayPoint start to a different location', () => {
    const { manager, elements, window } = loadRosManager(0);
    const canvasListeners = {};
    const callback = jest.fn();
    const canvas = {
      style: {},
      addEventListener(event, listener) {
        if (!canvasListeners[event]) canvasListeners[event] = [];
        canvasListeners[event].push(listener);
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 })
    };
    elements['map-canvas'] = canvas;
    manager.startHzMonitor = jest.fn();
    manager.setupPOIControls = jest.fn();
    manager.requestRender = jest.fn();
    manager._canvasToWorld = jest.fn((x, y) => ({ x, y }));
    manager.setupMapInteraction();
    manager._enterWaypointSelectMode(callback, { twoClick: true });

    const click = (x, y) => {
      canvasListeners.mousedown[0]({ clientX: x, clientY: y, button: 0 });
      window.listeners.mouseup[0]({ clientX: x, clientY: y, button: 0 });
    };

    click(100, 120);
    click(130, 120);
    expect(callback).toHaveBeenNthCalledWith(1, 100, 120, expect.any(Number));

    window.listeners.mousemove[0]({ clientX: 320, clientY: 340 });
    expect(manager._waypointHoverActive).toBe(true);
    expect(manager._waypointCurrentX).toBe(320);
    expect(manager._waypointCurrentY).toBe(340);

    click(350, 380);
    expect(manager._waypointStartX).toBe(350);
    expect(manager._waypointStartY).toBe(380);
    expect(manager._waypointDirectionPending).toBe(true);
    expect(manager._waypointHoverActive).toBe(false);

    click(350, 330);
    expect(callback).toHaveBeenNthCalledWith(2, 350, 380, expect.any(Number));
  });

  test('next WayPoint candidate visibly follows the mouse before its position click', () => {
    const { manager } = loadRosManager(0);
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      stroke: jest.fn(),
      setLineDash: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn()
    };
    manager._waypointHoverActive = true;
    manager._waypointDragging = false;
    manager._waypointDirectionPending = false;
    manager._waypointCurrentX = 275;
    manager._waypointCurrentY = 315;

    manager._drawWaypointSelectPreview(ctx);

    expect(ctx.arc).toHaveBeenCalledWith(275, 315, 10, 0, Math.PI * 2);
    expect(ctx.moveTo).toHaveBeenCalledWith(261, 315);
    expect(ctx.moveTo).toHaveBeenCalledWith(275, 301);
  });

  test('selected Quick Action point receives a visible map highlight', () => {
    const { manager } = loadRosManager(0);
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      setLineDash: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      closePath: jest.fn(),
      fillText: jest.fn()
    };
    manager.mapZoom = 1;
    manager._quickTaskOverlay = [{
      x: 1,
      y: 2,
      theta: 0,
      kind: 'waypoint',
      label: '1',
      group: 'item-0',
      selected: true
    }];

    manager._drawQuickTaskOverlay(ctx, 100, 100, 0.1, {
      position: { x: 0, y: 0 }
    });

    expect(ctx.arc).toHaveBeenCalledWith(0, 0, 15, 0, Math.PI * 2);
    expect(ctx.arc).toHaveBeenCalledWith(0, 0, 8, 0, Math.PI * 2);
  });

  test('switching active robots removes all data subscriptions from the previous robot', () => {
    const { manager, App, slot } = loadRosManager(1);
    const topicSubscription = { unsubscribe: jest.fn() };
    const tfSubscription = { unsubscribe: jest.fn() };
    slot.connected = true;
    slot.ros = {};
    slot.subscriptions = { bms: topicSubscription };
    slot.tfTopic = tfSubscription;
    slot.dataSubscribed = true;

    App.robotSlots.push({
      ip: '192.168.20.52',
      robotId: 'R_002',
      connected: true,
      ros: {},
      subscriptions: {},
      bms: { voltage: 0, current: 0, soc: 0, charging: false },
      workState: null,
      pose: null
    });

    manager.subscribeSlotMonitoring = jest.fn();
    manager.subscribeActiveSlotUI = jest.fn();
    manager.startLatencyMonitor = jest.fn();
    manager.stopLatencyMonitor = jest.fn();
    manager._fetchRobotModel = jest.fn();
    manager._resetBmsEtaState = jest.fn();
    manager._updateSlamButtons = jest.fn();
    manager._updateLifelongButtons = jest.fn();

    manager.switchActiveSlot(1, 0);

    expect(topicSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(tfSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(slot.subscriptions).toEqual({});
    expect(slot.dataSubscribed).toBe(false);
    expect(manager.subscribeSlotMonitoring).toHaveBeenCalledWith(1);
    expect(manager.subscribeActiveSlotUI).toHaveBeenCalledWith(1);
  });

  test('header battery estimate switches between full-charge and usable-time output', () => {
    const { manager, elements } = loadRosManager(0);
    const now = Date.now();
    elements['bms-time-estimate'] = makeElement();

    manager._bmsLastSoc = 60;
    manager._bmsIsCharging = true;
    manager._bmsChargeStartTime = now - 110000;
    manager._bmsSocHistory = Array.from({ length: 12 }, (_, i) => ({
      time: now - 110000 + (i * 10000),
      soc: 49 + i
    }));
    manager._refreshBmsEtaDisplay();

    expect(elements['bms-time-estimate'].textContent).toMatch(/^완충 /);
    expect(elements['bms-time-estimate'].classList.contains('charging')).toBe(true);

    manager._bmsLastSoc = 49;
    manager._bmsIsCharging = false;
    manager._bmsDischargeStartTime = now - 110000;
    manager._bmsDischargeHistory = Array.from({ length: 12 }, (_, i) => ({
      time: now - 110000 + (i * 10000),
      soc: 60 - i
    }));
    manager._refreshBmsEtaDisplay();

    expect(elements['bms-time-estimate'].textContent).toMatch(/^사용 가능 /);
    expect(elements['bms-time-estimate'].classList.contains('discharging')).toBe(true);
  });

  test('BMS Ah and current values provide immediate estimates without SOC warmup', () => {
    const { manager, elements } = loadRosManager(0);
    elements['bms-time-estimate'] = makeElement();

    manager._bmsLastSoc = 80;
    manager._bmsIsCharging = true;
    manager._bmsCurrentA = 10;
    manager._bmsCurrentAh = 80;
    manager._bmsTotalAh = 100;
    manager._refreshBmsEtaDisplay();

    expect(elements['bms-time-estimate'].textContent).toBe('완충 2시간 0분');
    expect(elements['bms-time-estimate'].title).toContain('BMS 용량/전류');

    manager._bmsIsCharging = false;
    manager._bmsCurrentA = -20;
    manager._refreshBmsEtaDisplay();

    expect(elements['bms-time-estimate'].textContent).toBe('사용 가능 4시간 0분');
    expect(elements['bms-time-estimate'].title).toContain('BMS 용량/전류');
  });

  test('camera layout supports 1, 2, 3, and 4 visible panes with 2 as fallback', () => {
    const { manager, elements } = loadRosManager(0);
    elements['camera-tab-grid'] = makeElement();
    elements['cam-layout-select'] = { value: '' };
    manager.updateCameraPanes = jest.fn();

    [1, 2, 3, 4].forEach(count => {
      manager.setCameraLayout(count);
      expect(manager._camLayoutCount).toBe(count);
      expect(elements['camera-tab-grid'].classList.contains(`layout-${count}`)).toBe(true);
      expect(elements['cam-layout-select'].value).toBe(String(count));
    });

    manager.setCameraLayout('invalid');
    expect(manager._camLayoutCount).toBe(2);
    expect(elements['camera-tab-grid'].classList.contains('layout-2')).toBe(true);
  });

  test('active monitoring always includes map correction and charge relay feedback', () => {
    const { manager, slot } = loadRosManager(0);
    slot.ros = {};
    slot.connected = true;
    manager._subscribeSlotTopic = jest.fn();
    manager._subscribeSlotTf = jest.fn();
    manager._fetchFootprintParam = jest.fn();

    manager.subscribeSlotMonitoring(0);

    const subscriptions = manager._subscribeSlotTopic.mock.calls.map(call => ({
      key: call[1],
      name: call[2],
      type: call[3]
    }));
    expect(subscriptions).toContainEqual({
      key: 'map-correction',
      name: '/R_001/map_correction',
      type: 'syscon_msgs/Map_correction'
    });
    expect(subscriptions).toContainEqual({
      key: 'charge-relay-state',
      name: '/R_001/charge_relay_state',
      type: 'std_msgs/Bool'
    });
    expect(subscriptions).toContainEqual({
      key: 'spx-io-charge-relay-state',
      name: '/R_001/io/do/charge_relay',
      type: 'std_msgs/Bool'
    });
  });

  test('map correction updates the always-visible quality badge', () => {
    const { manager, slot, elements } = loadRosManager(0);
    elements['map-correction-badge'] = makeElement();
    elements['map-correction-level'] = makeElement();
    elements['map-correction-value'] = makeElement();

    manager._handleMapCorrection(0, {
      map_correction: 94.25,
      level: 2,
      description: 'stable'
    });

    expect(slot.mapCorrection.value).toBe(94.25);
    expect(elements['map-correction-level'].textContent).toBe('● Lv.2 Good');
    expect(elements['map-correction-value'].textContent).toBe('94.3%');
    expect(elements['map-correction-badge'].title).toBe('stable');
  });
});
