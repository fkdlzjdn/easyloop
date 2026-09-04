const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeMap(data = [0, 0, 100, -1]) {
  return {
    info: {
      width: 2,
      height: 2,
      resolution: 0.05,
      origin: {
        position: { x: -1, y: -2, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 }
      }
    },
    data
  };
}

function loadFleetControl(slotCount = 2) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'fleet-control.js'), 'utf8');
  const topics = [];
  const services = [];
  const elements = {};

  class FakeTopic {
    constructor(options) {
      this.options = options;
      this.callback = null;
      this.unsubscribe = jest.fn();
      topics.push(this);
    }

    subscribe(callback) {
      this.callback = callback;
    }

    emit(message) {
      if (this.callback) this.callback(message);
    }
  }

  class FakeService {
    constructor(options) {
      this.options = options;
      this.success = null;
      this.failure = null;
      services.push(this);
    }

    callService(request, success, failure) {
      this.request = request;
      this.success = success;
      this.failure = failure;
    }

    succeed(result) {
      if (this.success) this.success(result);
    }
  }

  const robotSlots = Array.from({ length: slotCount }, (_, index) => ({
    ip: `192.168.20.${51 + index}`,
    robotId: `R_${String(index + 1).padStart(3, '0')}`,
    robotNumber: index + 1,
    connected: true,
    ros: { id: index }
  }));
  const App = {
    robotSlots,
    activeSlotIndex: 0,
    getRobotUnitNumber: slot => slot.robotNumber
  };
  const context = {
    App,
    ROSLIB: { Topic: FakeTopic, Service: FakeService, ServiceRequest: class ServiceRequest {} },
    RobotCompatibility: {
      get: slot => ({
        monitoring: {
          topics: {
            robotState: {
              name: `/${slot.robotId}/robot_state`,
              type: 'syscon_msgs/RobotState'
            }
          }
        }
      })
    },
    document: {
      addEventListener: jest.fn(),
      getElementById: jest.fn(id => elements[id] || null),
      querySelector: jest.fn(() => null),
      createElement: jest.fn()
    },
    window: { devicePixelRatio: 1 },
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__FleetControl = FleetControl;`, context);
  return { manager: context.__FleetControl, App, topics, services, elements, context };
}

describe('fleet control map', () => {
  test('map fingerprint detects different map content and metadata', () => {
    const { manager } = loadFleetControl();
    const base = makeMap();
    const same = makeMap();
    const changedData = makeMap([0, 100, 100, -1]);
    const changedOrigin = makeMap();
    changedOrigin.info.origin.position.x = -1.5;

    expect(manager.mapFingerprint(base)).toBe(manager.mapFingerprint(same));
    expect(manager.mapFingerprint(base)).not.toBe(manager.mapFingerprint(changedData));
    expect(manager.mapFingerprint(base)).not.toBe(manager.mapFingerprint(changedOrigin));
  });

  test('activation subscribes only lightweight poses and checks at most two maps concurrently', () => {
    const { manager, topics } = loadFleetControl(3);
    manager.activate();

    const poseTopics = topics.filter(topic => topic.options.messageType !== 'nav_msgs/OccupancyGrid');
    let mapTopics = topics.filter(topic => topic.options.messageType === 'nav_msgs/OccupancyGrid');
    expect(poseTopics).toHaveLength(6);
    expect(poseTopics.every(topic =>
      topic.options.throttle_rate === manager.POSITION_THROTTLE_MS
      && topic.options.queue_length === 1
    )).toBe(true);
    expect(mapTopics).toHaveLength(2);
    expect(mapTopics.map(topic => topic.options.name).sort()).toEqual(['/R_001/map', '/map']);
    expect(manager._mapInFlight).toBe(1);

    mapTopics[0].emit(makeMap());
    mapTopics = topics.filter(topic => topic.options.messageType === 'nav_msgs/OccupancyGrid');
    expect(mapTopics).toHaveLength(6);
    expect(manager._mapInFlight).toBe(2);
    expect(manager._referenceMap).toBeTruthy();

    manager.deactivate();
    expect(poseTopics.every(topic => topic.unsubscribe.mock.calls.length > 0)).toBe(true);
  });

  test('one active robot immediately reuses its already received map', () => {
    const { manager, App, topics, context } = loadFleetControl(1);
    const cachedMap = makeMap();
    App.robotSlots[0].pose = { x: 1, y: 2, yaw: 0.5 };
    context.RosManager = { lastMapMsg: cachedMap };

    manager.activate();

    expect(manager._referenceMap).toBe(cachedMap);
    expect(manager._referenceSlotIndex).toBe(0);
    expect(manager._poses.get(0)).toMatchObject({ x: 1, y: 2, yaw: 0.5 });
    expect(topics.filter(topic => topic.options.messageType === 'nav_msgs/OccupancyGrid')).toHaveLength(0);
    manager.deactivate();
  });

  test('prefers the pose-graph namespaced map over an earlier root map', () => {
    jest.useFakeTimers();
    const { manager, topics } = loadFleetControl(1);
    manager.activate();
    const mapTopics = topics.filter(topic =>
      topic.options.messageType === 'nav_msgs/OccupancyGrid'
    );
    const rootTopic = mapTopics.find(topic => topic.options.name === '/map');
    const namespacedTopic = mapTopics.find(topic => topic.options.name === '/R_001/map');
    const pgmMap = makeMap([0, 0, 0, -1]);
    const poseGraphMap = makeMap([0, 100, 0, -1]);

    rootTopic.emit(pgmMap);
    namespacedTopic.emit(poseGraphMap);

    expect(manager._referenceMap).toBe(poseGraphMap);
    manager.deactivate();
    jest.useRealTimers();
  });

  test('switching the active robot prioritizes and promotes that robot map', () => {
    const { manager, App, topics, elements } = loadFleetControl(2);
    elements['fleet-active-map-source'] = {
      textContent: '',
      classList: { toggle: jest.fn() }
    };
    manager._active = true;
    manager._acceptMap(0, makeMap());
    App.activeSlotIndex = 1;

    expect(manager.syncActiveRobotMap(false, 1)).toBe(true);
    expect(manager._selectedSlotIndex).toBe(1);
    expect(manager._activeMapSyncIndex).toBe(1);

    const activeMapTopic = topics.find(topic =>
      topic.options.messageType === 'nav_msgs/OccupancyGrid'
      && topic.options.name === '/R_002/map'
    );
    const activeMap = makeMap([0, 100, 0, -1]);
    activeMapTopic.emit(activeMap);

    expect(manager._referenceMap).toBe(activeMap);
    expect(manager._referenceSlotIndex).toBe(1);
    expect(manager._activeMapSyncIndex).toBe(-1);
    manager._renderStatus();
    expect(elements['fleet-active-map-source'].textContent).toContain('002번 활성 맵');
  });

  test('falls back to namespaced static_map service when latched map topic is silent', () => {
    jest.useFakeTimers();
    const { manager, services } = loadFleetControl(1);

    manager.activate();
    jest.advanceTimersByTime(1200);

    expect(services.map(service => service.options.name).sort()).toEqual(['/R_001/static_map', '/static_map']);
    services.find(service => service.options.name === '/R_001/static_map').succeed({ map: makeMap() });
    expect(manager._referenceMap).toBeTruthy();
    expect(manager._mapStates.get(0).status).toBe('ok');

    manager.deactivate();
    jest.useRealTimers();
  });

  test('warning names robots whose map fingerprint differs from the reference', () => {
    const { manager, elements } = loadFleetControl(2);
    elements['fleet-control-summary'] = { textContent: '' };
    elements['fleet-map-warning'] = {
      textContent: '',
      classList: { toggle: jest.fn() }
    };
    manager._active = true;
    manager._referenceSignature = 'map-a';
    manager._referenceSlotIndex = 0;
    manager._mapStates.set(0, { status: 'ok', signature: 'map-a' });
    manager._mapStates.set(1, { status: 'ok', signature: 'map-b' });

    manager._renderStatus();

    expect(elements['fleet-map-warning'].textContent).toContain('맵 불일치 로봇: 002');
    expect(elements['fleet-map-warning'].classList.toggle).toHaveBeenCalledWith('hidden', false);
    manager.deactivate();
  });

  test('selecting a fleet robot changes only the task target, not the active data slot', () => {
    const { manager, App } = loadFleetControl(2);
    manager._active = true;
    manager._selectRobot(1);

    expect(manager._selectedSlotIndex).toBe(1);
    expect(App.activeSlotIndex).toBe(0);
    manager.deactivate();
  });

  test('Ctrl+number in mini control opens the matching sorted Task for the selected robot', () => {
    const { manager, context } = loadFleetControl(2);
    context.ActionSender = {
      getSavedQueues: jest.fn(() => ({
        Zebra: { queue: [{}] },
        Alpha: { queue: [{}] },
        Middle: { queue: [{}] }
      }))
    };
    manager._active = true;
    manager._selectedSlotIndex = 1;
    manager._requestShortcutTask = jest.fn();
    const event = {
      key: '2',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn()
    };

    expect(manager._handleTaskShortcut(event)).toBe(true);

    expect(manager._requestShortcutTask).toHaveBeenCalledWith('Middle', 2);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
  });

  test('Ctrl+number does nothing outside mini control', () => {
    const { manager } = loadFleetControl(1);
    manager._requestShortcutTask = jest.fn();

    expect(manager._handleTaskShortcut({
      key: '1',
      ctrlKey: true,
      preventDefault: jest.fn()
    })).toBe(false);
    expect(manager._requestShortcutTask).not.toHaveBeenCalled();
  });

  test('confirmed shortcut sends the selected Task without a second confirmation', async () => {
    const { manager, App, context, elements } = loadFleetControl(1);
    elements['fleet-shortcut-task-modal'] = {
      classList: { remove: jest.fn() }
    };
    manager._pendingShortcutTask = {
      taskName: 'Alpha',
      shortcutNumber: 1,
      slotIndex: 0,
      robotId: App.robotSlots[0].robotId,
      loopCount: 3
    };
    manager._selectedTaskName = 'Alpha';
    manager._runSelectedTask = jest.fn().mockResolvedValue();

    await manager._confirmShortcutTask();

    expect(manager._runSelectedTask).toHaveBeenCalledWith(true, 3);
    expect(elements['fleet-shortcut-task-modal'].classList.remove).toHaveBeenCalledWith('show');
    expect(context.confirm).toBeUndefined();
  });

  test('Enter confirms the open shortcut Task window and consumes the key', () => {
    const { manager } = loadFleetControl(1);
    manager._pendingShortcutTask = { taskName: 'Alpha' };
    manager._confirmShortcutTask = jest.fn();
    const event = {
      key: 'Enter',
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn()
    };

    expect(manager._handleShortcutTaskModalKey(event)).toBe(true);
    expect(manager._confirmShortcutTask).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
  });

  test('Escape cancels the open shortcut Task window and IME input is ignored', () => {
    const { manager } = loadFleetControl(1);
    manager._pendingShortcutTask = { taskName: 'Alpha' };
    manager._closeShortcutTaskConfirm = jest.fn();
    const escapeEvent = {
      key: 'Escape',
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn()
    };

    expect(manager._handleShortcutTaskModalKey(escapeEvent)).toBe(true);
    expect(manager._closeShortcutTaskConfirm).toHaveBeenCalledTimes(1);
    expect(manager._handleShortcutTaskModalKey({
      key: 'Enter',
      isComposing: true
    })).toBe(false);
  });

  test('one shared robot icon size is adjustable and clamped to the supported range', () => {
    const { manager } = loadFleetControl(1);

    manager._setRobotIconSize(58);
    expect(manager._robotIconSize).toBe(58);

    manager._setRobotIconSize(100);
    expect(manager._robotIconSize).toBe(72);

    manager._setRobotIconSize(5);
    expect(manager._robotIconSize).toBe(24);
  });

  test('robot icon uses a rectangular body with a front arrow', () => {
    const { manager } = loadFleetControl(1);
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      fillRect: jest.fn(),
      strokeRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      strokeText: jest.fn(),
      fillText: jest.fn()
    };

    manager._drawRobot(ctx, 100, 80, 0, 0, Date.now());

    expect(ctx.fillRect).toHaveBeenCalledWith(-18, -13, 36, 26);
    expect(ctx.strokeRect).toHaveBeenCalledWith(-18, -13, 36, 26);
    expect(ctx.moveTo).toHaveBeenCalledWith(5, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(14, 0);
  });

  test('draws an optional running Task route for every connected robot', () => {
    const { manager, App, context } = loadFleetControl(1);
    context.ActionSender = {
      _runningTasks: new Map([[
        App.robotSlots[0].robotId,
        {
          actionIndex: 1,
          points: [
            { x: 0, y: 0, actionIndex: 0 },
            { x: 1, y: 1, actionIndex: 1 }
          ]
        }
      ]])
    };
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      setLineDash: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn()
    };

    manager._drawRunningTaskRoutes(ctx, makeMap().info, 10, 0, 0);

    expect(ctx.lineTo).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    expect(ctx.fill).toHaveBeenCalledTimes(2);

    manager._showTaskRoutes = false;
    ctx.lineTo.mockClear();
    manager._drawRunningTaskRoutes(ctx, makeMap().info, 10, 0, 0);
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });

  test('side panel renders the complete saved task list with action counts', () => {
    const { manager, elements, context } = loadFleetControl(1);
    const makeNode = tag => ({
      tag,
      children: [],
      className: '',
      textContent: '',
      value: '',
      appendChild(child) { this.children.push(child); },
      addEventListener: jest.fn()
    });
    const list = makeNode('div');
    Object.defineProperty(list, 'innerHTML', {
      set() { this.children = []; }
    });
    elements['fleet-task-list'] = list;
    context.document.createElement.mockImplementation(makeNode);
    context.ActionSender = {
      getSavedQueues: () => ({
        dock: { queue: [{}, {}] },
        patrol: { queue: [{}] }
      })
    };

    manager._selectedTaskName = 'dock';
    manager._refreshTaskOptions();

    expect(list.children).toHaveLength(2);
    expect(list.children[0].children[0].textContent).toBe('dock');
    expect(list.children[0].children[1].textContent).toBe('2 actions');
    expect(list.children[0].className).toContain('selected');
  });
});
