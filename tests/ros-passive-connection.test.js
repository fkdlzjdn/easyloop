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
    alarmSystem: { resetTopicTimes: jest.fn(), recordTopicActivity: jest.fn() },
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
      dispatchEvent: jest.fn(),
      getElementById: jest.fn(id => elements[id] || null),
      querySelectorAll: jest.fn(() => [])
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
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
    window: context.window,
    context
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
  test('does not treat robot_state.type as the ROBOT_MODEL environment value', () => {
    const { manager, slot } = loadRosManager(0);

    manager._handleSlotWorkState(0, { workstate: 1, type: 'stl1500w' });

    expect(slot.reportedRobotType).toBe('stl1500w');
    expect(slot.robotModel).toBeUndefined();
  });

  test('reads ROBOT_MODEL through a valid short-lived SSH session', async () => {
    const { manager, context, slot } = loadRosManager(0);
    const responses = {
      '/api/ssh/connect': { success: true },
      '/api/ssh/exec': { success: true, stdout: 'stl1500w\n' },
      '/api/ssh/disconnect': { success: true }
    };
    context.fetchWithTimeout = jest.fn(async url => ({
      json: async () => responses[url]
    }));

    await manager._fetchRobotModel(0);

    expect(slot.robotModel).toBe('stl1500w');
    expect(context.fetchWithTimeout.mock.calls.map(call => call[0])).toEqual([
      '/api/ssh/connect',
      '/api/ssh/exec',
      '/api/ssh/disconnect'
    ]);
    const connectRequest = JSON.parse(context.fetchWithTimeout.mock.calls[0][1].body);
    const execRequest = JSON.parse(context.fetchWithTimeout.mock.calls[1][1].body);
    expect(connectRequest).toMatchObject({
      host: '192.168.20.51',
      username: 'syscon',
      sessionId: expect.stringMatching(/^robot_model_0_/)
    });
    expect(execRequest).toMatchObject({
      sessionId: connectRequest.sessionId,
      command: 'printenv ROBOT_MODEL'
    });
    expect(context.document.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'amr:robot-model-changed',
      detail: expect.objectContaining({ robotModel: 'stl1500w' })
    }));
  });

  test('mapping controls bind independently and include map save', () => {
    const { manager, elements } = loadRosManager(0);
    const listeners = {};
    [
      'btn-slam-start',
      'btn-slam-stop',
      'btn-lifelong-start',
      'btn-lifelong-stop',
      'btn-save-map'
    ].forEach(id => {
      elements[id] = {
        addEventListener(event, listener) {
          listeners[`${id}:${event}`] = listener;
        }
      };
    });
    manager._startSlam = jest.fn();
    manager._stopSlam = jest.fn();
    manager._startLifelong = jest.fn();
    manager._stopLifelong = jest.fn();
    manager._openMappingSaveConfirm = jest.fn();

    manager.setupMappingControls();
    listeners['btn-slam-start:click']();
    listeners['btn-lifelong-start:click']();
    listeners['btn-save-map:click']();

    expect(manager._startSlam).toHaveBeenCalledTimes(1);
    expect(manager._startLifelong).toHaveBeenCalledTimes(1);
    expect(manager._openMappingSaveConfirm).toHaveBeenCalledWith('SAVE_ONLY');
  });

  test('asks to save before stopping unsaved SLAM and Lifelong sessions', () => {
    const { manager } = loadRosManager(0);
    manager._openMappingSaveConfirm = jest.fn();
    manager._publishRoutineMode = jest.fn();

    manager._slamRunning = true;
    manager._mappingSessionSaved = false;
    manager._stopSlam();
    expect(manager._openMappingSaveConfirm).toHaveBeenCalledWith('SLAM');
    expect(manager._publishRoutineMode).not.toHaveBeenCalled();

    manager._slamRunning = false;
    manager._lifelongRunning = true;
    manager._stopLifelong();
    expect(manager._openMappingSaveConfirm).toHaveBeenCalledWith('LIFELONG');
    expect(manager._publishRoutineMode).not.toHaveBeenCalled();

    manager._mappingSessionSaved = true;
    manager._stopLifelong();
    expect(manager._publishRoutineMode).toHaveBeenCalledWith(
      'NAV',
      null,
      'Off',
      expect.any(Function)
    );
  });

  test('save confirmation stops only after save succeeds and No skips saving', () => {
    const { manager, elements } = loadRosManager(0);
    [
      'btn-mapping-save-yes',
      'btn-mapping-save-no',
      'btn-mapping-save-cancel',
      'btn-mapping-save-close'
    ].forEach(id => { elements[id] = makeElement(); });
    manager._stopSlam = jest.fn();
    manager._stopLifelong = jest.fn();
    manager._closeMappingSaveConfirm = jest.fn(() => {
      manager._mappingSavePendingMode = null;
      manager._mappingSaveBusy = false;
    });
    manager._saveMap = jest.fn(options => options.onSuccess());

    manager._mappingSavePendingMode = 'SLAM';
    manager._confirmMappingSave();
    expect(manager._saveMap).toHaveBeenCalledWith(expect.objectContaining({
      onSuccess: expect.any(Function),
      onFailure: expect.any(Function)
    }));
    expect(manager._stopSlam).toHaveBeenCalledWith(true);

    manager._mappingSavePendingMode = 'LIFELONG';
    manager._discardMappingSaveAndStop();
    expect(manager._stopLifelong).toHaveBeenCalledWith(true);
    expect(manager._saveMap).toHaveBeenCalledTimes(1);

    manager._stopSlam.mockClear();
    manager._saveMap.mockImplementationOnce(options => options.onFailure('save failed'));
    manager._mappingSavePendingMode = 'SLAM';
    manager._confirmMappingSave();
    expect(manager._stopSlam).not.toHaveBeenCalled();
    expect(manager._mappingSaveBusy).toBe(false);
  });

  test('shows a fixed-path Yes/No dialog for partial Mapping and manual save', () => {
    const { manager, elements } = loadRosManager(0);
    [
      'mapping-save-confirm-modal',
      'mapping-save-confirm-title',
      'mapping-save-confirm-message',
      'btn-mapping-save-no',
      'btn-mapping-save-yes',
      'save-map-status',
      'btn-mapping-save-cancel',
      'btn-mapping-save-close'
    ].forEach(id => { elements[id] = makeElement(); });
    manager._openMappingSaveConfirm('LIFELONG');
    expect(elements['mapping-save-confirm-title'].textContent).toBe('맵을 저장하시겠습니까?');
    expect(elements['mapping-save-confirm-message'].textContent).toContain('부분맵핑');
    expect(elements['btn-mapping-save-no'].hidden).toBe(false);
    expect(elements['btn-mapping-save-yes'].textContent).toBe('예, 저장 후 종료');
    expect(elements['mapping-save-confirm-modal'].classList.contains('show')).toBe(true);

    manager._openMappingSaveConfirm('SAVE_ONLY');
    expect(elements['mapping-save-confirm-title'].textContent).toBe('현재 맵 저장');
    expect(elements['mapping-save-confirm-message'].textContent).toContain('map.pgm');
    expect(elements['btn-mapping-save-no'].hidden).toBe(true);
    expect(elements['btn-mapping-save-yes'].textContent).toBe('맵 저장');
  });

  test('backs up map components and saves pose graph plus canonical map', async () => {
    const { manager, slot, elements, context } = loadRosManager(0);
    elements['save-map-status'] = makeElement();
    slot.ros = { connected: true };
    slot.compatibilityProfile = { discovered: true };
    const profile = {
      map: {
        baseName: 'map',
        directory: '/home/syscon/ROS_DB/map',
        poseGraphSaveService: '/R_001/slam_toolbox/serialize_map',
        poseGraphSaveType: 'slam_toolbox_msgs/SerializePoseGraph',
        saveService: '/R_001/save_map',
        saveType: 'syscon_msgs/SaveMap',
        saveUsesName: false
      }
    };
    context.RobotCompatibility = {
      get: jest.fn(() => profile),
      mapPoseGraphSaveRequest: jest.fn(() => ({
        filename: '/home/syscon/ROS_DB/map/map'
      })),
      mapSaveRequest: jest.fn(() => ({ save_in_db: true }))
    };
    manager._backupCanonicalMap = jest.fn().mockResolvedValue('/home/syscon/ROS_DB/map_backup');
    manager._callRosServicePromise = jest.fn().mockResolvedValue({ success: true });
    const onSuccess = jest.fn();

    await manager._saveMap({ onSuccess });

    expect(manager._backupCanonicalMap).toHaveBeenCalledWith(profile);
    expect(manager._callRosServicePromise).toHaveBeenNthCalledWith(
      1,
      slot.ros,
      '/R_001/slam_toolbox/serialize_map',
      'slam_toolbox_msgs/SerializePoseGraph',
      { filename: '/home/syscon/ROS_DB/map/map' }
    );
    expect(manager._callRosServicePromise).toHaveBeenNthCalledWith(
      2,
      slot.ros,
      '/R_001/save_map',
      'syscon_msgs/SaveMap',
      { save_in_db: true }
    );
    expect(manager._mappingMapCommitted).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  test('backs up the complete canonical map set before overwriting', async () => {
    const { manager } = loadRosManager(0);
    manager._mappingBackupSuffix = jest.fn(() => '20260806_120000_001');
    manager._mapExec = jest.fn().mockResolvedValue({ success: true });

    await manager._backupCanonicalMap({
      map: { directory: '/home/syscon/ROS_DB/map' }
    });

    expect(manager._mapExec).toHaveBeenCalledWith(expect.stringContaining(
      'cp -p /home/syscon/ROS_DB/map/map.* /home/syscon/ROS_DB/map_20260806_120000_001/'
    ));
  });

  test('reloads the NAV namespaced map after a committed Mapping save', async () => {
    const { manager } = loadRosManager(0);
    manager._mappingMapCommitted = true;
    manager._preMapModeBackup = { info: {}, data: [0] };
    manager._killSlamToolbox = jest.fn().mockResolvedValue();
    manager._resubscribeMapTopic = jest.fn();
    manager._restorePreMapModeBackup = jest.fn();

    manager._finishMappingMapTransition();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(manager._preMapModeBackup).toBe(null);
    expect(manager._resubscribeMapTopic).toHaveBeenCalledTimes(1);
    expect(manager._restorePreMapModeBackup).not.toHaveBeenCalled();
  });

  test('the main map wheel changes zoom and requests a render', () => {
    const { manager, elements } = loadRosManager(0);
    const canvasListeners = {};
    const canvas = {
      style: {},
      addEventListener(event, listener) {
        if (!canvasListeners[event]) canvasListeners[event] = [];
        canvasListeners[event].push(listener);
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 })
    };
    elements['map-canvas'] = canvas;
    elements['map-zoom-value'] = makeElement();
    manager.mapZoom = 1;
    manager.startHzMonitor = jest.fn();
    manager.setupPOIControls = jest.fn();
    manager.requestRender = jest.fn();

    manager.setupMapInteraction();
    const wheelEvent = { deltaY: -120, preventDefault: jest.fn() };
    canvasListeners.wheel[0](wheelEvent);

    expect(wheelEvent.preventDefault).toHaveBeenCalled();
    expect(manager.mapZoom).toBeCloseTo(1.1);
    expect(elements['map-zoom-value'].textContent).toBe('110%');
    expect(manager.requestRender).toHaveBeenCalledTimes(1);
  });

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
    const callbackPhases = [];
    const callback = jest.fn(() => {
      callbackPhases.push(manager._waypointDirectionPending);
    });
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
    expect(callbackPhases).toEqual([false]);
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
    expect(callbackPhases).toEqual([false, false]);
    expect(manager._waypointDirectionPending).toBe(false);
  });

  test('freehand map capture streams world points and completes one stroke', () => {
    const { manager } = loadRosManager(0);
    const onUpdate = jest.fn();
    const onComplete = jest.fn();
    manager.requestRender = jest.fn();
    manager._canvasToWorld = jest.fn((x, y) => ({ x: x / 10, y: y / 10 }));

    manager._enterFreehandPathMode({ onUpdate, onComplete });
    manager._startFreehandPath(10, 20, {});
    manager._appendFreehandPathPoint(20, 30, {});
    manager._appendFreehandPathPoint(30, 25, {});
    manager._finishFreehandPath();

    expect(onUpdate).toHaveBeenLastCalledWith([
      { x: 1, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 2.5 }
    ]);
    expect(onComplete).toHaveBeenCalledWith([
      { x: 1, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 2.5 }
    ]);
    expect(manager._freehandPathMode).toBe(true);
    expect(manager._freehandPathDrawing).toBe(false);
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
    expect(callback).toHaveBeenCalledTimes(1);
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

  test('selected saved Task Action receives a distinct map route and point highlight', () => {
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
      fillText: jest.fn(),
      measureText: jest.fn(() => ({ width: 60 })),
      roundRect: jest.fn()
    };
    manager.mapZoom = 1;
    manager.requestRender = jest.fn();
    manager.setTaskPreviewOverlay({
      taskName: '현장 순찰',
      selectedActionIndex: 1,
      showRoute: true,
      points: [
        { x: 1, y: 2, theta: 0, actionIndex: 0, kind: 'waypoint', label: 'A1' },
        { x: 2, y: 3, theta: 0.5, actionIndex: 1, kind: 'trajectory', label: 'A2.1' },
        { x: 3, y: 4, theta: 1, actionIndex: 1, kind: 'trajectory', label: 'A2.2' }
      ]
    });

    manager._drawTaskPreviewOverlay(ctx, 100, 100, 0.1, {
      position: { x: 0, y: 0 }
    });

    expect(manager.requestRender).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledWith(0, 0, 16, 0, Math.PI * 2);
    expect(ctx.arc).toHaveBeenCalledWith(0, 0, 10, 0, Math.PI * 2);
    expect(ctx.fillText).toHaveBeenCalledWith('A2.1', 0, 0);
    expect(ctx.fillText).toHaveBeenCalledWith('현장 순찰', expect.any(Number), expect.any(Number), 60);
  });

  test('View Reset clears transient map content but preserves the running Task overlay', () => {
    const { manager, elements, ActionSender, App } = loadRosManager(0);
    [
      'btn-follow-robot',
      'btn-set-pose-mode',
      'btn-nav-goal-mode',
      'nav-goal-popup',
      'map-zoom-value',
      'map-rotation-value',
      'map-canvas'
    ].forEach(id => {
      elements[id] = makeElement();
    });
    ActionSender.clearTaskPreview = jest.fn();
    manager.requestRender = jest.fn();
    manager.mapZoom = 2.4;
    manager.mapPanX = 120;
    manager.mapPanY = -60;
    manager.mapRotation = 90;
    manager._followRobot = true;
    manager._taskPreviewOverlay = { taskName: '선택 Task' };
    manager._quickTaskOverlay = [{ x: 1, y: 2 }];
    manager._activeTaskOverlay = { taskId: '실행 Task', currentActionIndex: 1 };

    manager.resetMapView();

    expect(manager.mapZoom).toBe(1);
    expect(manager.mapPanX).toBe(0);
    expect(manager.mapPanY).toBe(0);
    expect(manager.mapRotation).toBe(0);
    expect(manager._taskPreviewOverlay).toBeNull();
    expect(manager._quickTaskOverlay).toEqual([]);
    expect(manager._activeTaskOverlay).toEqual({
      taskId: '실행 Task',
      currentActionIndex: 1
    });
    expect(ActionSender.clearTaskPreview).toHaveBeenCalledTimes(1);
    expect(App.toast).toHaveBeenCalledWith(
      '화면 정리 완료 · 실행 중인 Task 표시는 유지됩니다.',
      'info'
    );
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
      key: 'slam-graph',
      name: '/R_001/slam_toolbox/karto_graph_visualization',
      type: 'visualization_msgs/MarkerArray'
    });
    expect(subscriptions).toContainEqual({
      key: 'lio-loop-constraints',
      name: '/R_001/lio_sam/mapping/loop_closure_constraints',
      type: 'visualization_msgs/MarkerArray'
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
