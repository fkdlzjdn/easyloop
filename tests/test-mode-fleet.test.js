const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadTestMode(robotCount = 3) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'test-mode.js'),
    'utf8'
  );
  const events = [];
  const originalSlots = [
    {
      ip: '192.168.20.51',
      robotId: 'R_001',
      sshPort: 22,
      tunnelMode: false,
      sshPassword: '',
      robotNumber: 1,
      connected: false,
      ros: null,
      subscriptions: {}
    },
    {
      ip: '192.168.20.52',
      robotId: 'R_002',
      sshPort: 22,
      tunnelMode: false,
      sshPassword: '',
      robotNumber: 2,
      connected: false,
      ros: null,
      subscriptions: {}
    }
  ];
  const App = {
    robotSlots: originalSlots.map(slot => ({ ...slot })),
    activeSlotIndex: 1,
    addRobotSlot(ip, robotId, sshPort, tunnelMode, sshPassword, unitNumber) {
      this.robotSlots.push({
        ip,
        robotId,
        sshPort,
        tunnelMode,
        sshPassword,
        robotNumber: unitNumber,
        connected: false,
        ros: null,
        subscriptions: {},
        bms: { voltage: 0, current: 0, soc: 0, charging: false },
        workState: null,
        pose: null
      });
      if (this.activeSlotIndex < 0) this.activeSlotIndex = 0;
    },
    renderActiveRobotSelector: jest.fn(),
    renderRobotManagerList: jest.fn(),
    renderMonitoringCards: jest.fn(),
    updateActiveRobotStatus: jest.fn(),
    updateMultiRobotButtons: jest.fn(),
    refreshActiveBmsDisplay: jest.fn(),
    addEvent: jest.fn((...args) => events.push(args)),
    toast: jest.fn()
  };
  const RosManager = {
    ros: null,
    robotPose: null,
    lastMapMsg: null,
    disconnectSlot: jest.fn(),
    displayPose: jest.fn(),
    displayWorkState: jest.fn(),
    requestRender: jest.fn(),
    _handleSlotWorkState: jest.fn(),
    getRobotId: jest.fn(index => App.robotSlots[index ?? App.activeSlotIndex]?.robotId),
    getRos: jest.fn(index => App.robotSlots[index ?? App.activeSlotIndex]?.ros)
  };
  const ActionSender = {
    _setTaskExecutionFeedback: jest.fn()
  };
  class Message {
    constructor(values) {
      Object.assign(this, values);
    }
  }
  class Topic {
    constructor(options = {}) {
      Object.assign(this, options);
      this.published = [];
    }
    subscribe() {}
    unsubscribe() {}
    publish(message) {
      this.published.push(message);
    }
  }
  const elements = {
    'test-mode-robot-count': { value: String(robotCount), disabled: false },
    'test-mode-drive-model': { value: 'dd', disabled: false }
  };
  const context = {
    App,
    RosManager,
    ActionSender,
    ROSLIB: { Message, Topic },
    document: {
      getElementById: jest.fn(id => elements[id] || null),
      createElement: jest.fn(),
      body: { appendChild: jest.fn() }
    },
    location: { protocol: 'http:', host: 'localhost:3000' },
    fetch: jest.fn(),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__TestMode = TestMode;`, context);
  return {
    manager: context.__TestMode,
    App,
    RosManager,
    ActionSender,
    originalSlots,
    events,
    elements
  };
}

function taskRequest(taskId, actions, loopFlag = 1) {
  return {
    task_id: taskId,
    loop_flag: loopFlag,
    missions: [{ mission_id: `${taskId}_mission`, actions }]
  };
}

function actionParam(paramName, value, type = 'string') {
  return {
    param_name: paramName,
    type,
    value: String(value)
  };
}

describe('Test Mode virtual fleet', () => {
  test('initial mapping UI accepts a missing active robot before Test Mode starts', () => {
    const { manager, elements } = loadTestMode(1);
    elements['test-mapping-status'] = { hidden: false };

    expect(() => manager._updateVirtualMappingUi(null)).not.toThrow();
    expect(elements['test-mapping-status'].hidden).toBe(true);
  });

  test('startup watchdog releases the UI when a startup phase never resolves', async () => {
    const { manager, App } = loadTestMode(1);
    manager.STARTUP_TIMEOUT_MS = 10;
    manager.startRosBridgeOnly = jest.fn(() => new Promise(() => {}));
    manager.updateUi = jest.fn();
    manager.showLoading = jest.fn();
    manager.requestStopRosBridge = jest.fn();

    manager.start('0000');
    expect(manager._starting).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 30));

    expect(manager._starting).toBe(false);
    expect(manager.enabled).toBe(false);
    expect(manager.showLoading).toHaveBeenLastCalledWith(false);
    expect(App.toast).toHaveBeenCalledWith(
      expect.stringContaining('시간이 초과'),
      'error'
    );
    expect(manager._lastFailure).toMatchObject({
      phase: 'startup',
      title: 'Test Mode 시작 실패'
    });
    expect(manager._lastFailure.cause).toContain('시간이 초과');
    expect(manager._lastFailure.action).toContain('다시 시도');
  });

  test('classifies startup and driving failures with a cause and corrective action', () => {
    const { manager } = loadTestMode(1);

    const auth = manager._diagnoseFailure('비밀번호가 올바르지 않습니다.', 'startup');
    const bridge = manager._diagnoseFailure('rosbridge 시작 timeout', 'startup');
    const collision = manager._diagnoseFailure(
      'collision_detect_range 0.30m 내 장애물을 감지해 안전 정지했습니다.',
      'task'
    );

    expect(auth.cause).toContain('비밀번호');
    expect(auth.action).toContain('다시 입력');
    expect(bridge.cause).toContain('19090');
    expect(bridge.action).toContain('rosbridge_server');
    expect(collision.title).toBe('Test Mode 안전 정지');
    expect(collision.cause).toContain('장애물');
    expect(collision.action).toContain('collision_detect_range');
  });

  test('renders failure reason, action, and technical detail in the Test Mode menu', () => {
    const { manager, elements } = loadTestMode(1);
    elements['test-mode-status'] = {
      textContent: '',
      classList: { toggle: jest.fn() }
    };
    elements['test-mode-detail-status'] = {
      textContent: '',
      classList: { toggle: jest.fn() }
    };
    elements['test-mode-failure-guide'] = { hidden: true };
    elements['test-mode-failure-title'] = { textContent: '' };
    elements['test-mode-failure-cause'] = { textContent: '' };
    elements['test-mode-failure-action'] = { textContent: '' };
    elements['test-mode-failure-detail'] = { textContent: '' };
    manager._lastFailure = manager._diagnoseFailure(
      'Publisher ROS connection timeout',
      'startup'
    );
    manager._lastStartError = manager._lastFailure.detail;

    manager.updateUi();

    expect(elements['test-mode-detail-status'].textContent).toBe('시작 실패');
    expect(elements['test-mode-failure-guide'].hidden).toBe(false);
    expect(elements['test-mode-failure-title'].textContent).toBe('Test Mode 시작 실패');
    expect(elements['test-mode-failure-cause'].textContent).toContain('Publisher');
    expect(elements['test-mode-failure-action'].textContent).toContain('19090');
    expect(elements['test-mode-failure-detail'].textContent)
      .toBe('Publisher ROS connection timeout');
  });

  test('creates at most three temporary robots and restores the previous fleet', () => {
    const { manager, App, originalSlots, elements } = loadTestMode(9);

    expect(manager._requestedRobotCount()).toBe(3);
    manager.prepareVirtualFleet(9);

    expect(App.robotSlots).toHaveLength(3);
    expect(App.robotSlots.map(slot => slot.robotId)).toEqual([
      'R_TEST_1',
      'R_TEST_2',
      'R_TEST_3'
    ]);
    expect(App.robotSlots.every(slot => slot.virtualTestRobot)).toBe(true);
    expect(App.robotSlots.every(slot => slot.wsPort === 19090)).toBe(true);
    expect(manager.virtualRobots.size).toBe(3);
    expect(new Set(
      Array.from(manager.virtualRobots.values()).map(robot => `${robot.pose.x},${robot.pose.y}`)
    ).size).toBe(3);

    manager.restoreVirtualFleet();
    expect(App.robotSlots.map(slot => slot.robotId)).toEqual(
      originalSlots.map(slot => slot.robotId)
    );
    expect(App.activeSlotIndex).toBe(1);

    elements['test-mode-robot-count'].value = '0';
    expect(manager._requestedRobotCount()).toBe(3);
  });

  test('inflates black map cells and plans a clear route around walls', () => {
    const { manager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    const robot = manager.virtualRobots.get(0);
    const target = { x: -3.0, y: -1.5, theta: Math.PI / 2 };

    expect(manager._isPoseTraversable(robot.pose.x, robot.pose.y)).toBe(true);
    expect(manager._isPoseTraversable(-3.0, -2.0)).toBe(false);

    const route = manager._planNavigationPath(robot.pose, target);
    expect(route).not.toBeNull();
    expect(route.length).toBeGreaterThan(1);
    expect(Math.max(...route.map(point => point.x))).toBeGreaterThan(-1.4);
    route.forEach(point => {
      expect(manager._isPoseTraversable(point.x, point.y)).toBe(true);
    });
    expect(route.at(-1).x).toBeCloseTo(target.x, 6);
    expect(route.at(-1).y).toBeCloseTo(target.y, 6);
  });

  test('rejects a navigation goal placed on a black obstacle', () => {
    const { manager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    const robot = manager.virtualRobots.get(0);

    expect(manager._planNavigationPath(robot.pose, {
      x: -3.0,
      y: -2.0,
      theta: 0
    })).toBeNull();
    expect(manager._lastPlanError).toContain('검은 장애물');
  });

  test('uses newly painted black cells from the visible map for avoidance', () => {
    const { manager, RosManager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    const robot = manager.virtualRobots.get(0);
    const goal = { x: -2.0, y: -2.5, theta: 0 };
    const goalCell = manager._worldToMapCell(goal.x, goal.y);
    const edited = Array.from(manager._mapData);
    edited[goalCell.index] = 100;
    RosManager.lastMapMsg = { data: edited };

    expect(manager._planNavigationPath(robot.pose, goal)).toBeNull();
    expect(manager._lastPlanError).toContain('검은 장애물');
  });

  test('drives a Task around black obstacles without entering occupied clearance cells', async () => {
    const { manager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    manager.enabled = true;

    await manager.runTask(0, taskRequest('avoid_black_wall', [{
      action_id: 'go_across_wall',
      action_type: 0x01,
      action_args: [-3.0, -1.5, Math.PI / 2],
      action_params: []
    }]));

    const robot = manager.virtualRobots.get(0);
    let traversable = true;
    for (let tick = 0; tick < 900 && robot.task; tick += 1) {
      manager._tickVirtualFleet(0.05);
      traversable = traversable
        && manager._isPoseTraversable(robot.pose.x, robot.pose.y);
    }
    expect(traversable).toBe(true);
    expect(robot.task).toBeNull();
    expect(robot.pose.x).toBeCloseTo(-3.0, 2);
    expect(robot.pose.y).toBeCloseTo(-1.5, 2);
  });

  test('applies SR-AMR-Base WayPoint defaults and parameter tendencies', () => {
    const { manager } = loadTestMode(1);
    const nextWaypoint = { action_type: 0x01 };
    const action = {
      action_params: [
        actionParam('max_trans_vel', 1.2, 'float'),
        actionParam('max_rot_vel', 0.9, 'float'),
        actionParam('xy_goal_tolerance', 0.2, 'float'),
        actionParam('yaw_goal_tolerance', 0.1, 'float'),
        actionParam('passing_flag', true, 'bool'),
        actionParam('passing_dist', 0.12, 'float'),
        actionParam('straight_path', true, 'bool'),
        actionParam('avoid_mode', true, 'bool'),
        actionParam('road_width', 3, 'float'),
        actionParam('backward_driving', true, 'bool'),
        actionParam('set_local_planner', 2, 'int'),
        actionParam('motion_direction', 2, 'int')
      ]
    };

    const profile = manager._buildWaypointProfile(action, nextWaypoint);

    expect(profile).toMatchObject({
      maxTransVel: 1.2,
      maxRotVel: 0.9,
      xyGoalTolerance: 0.2,
      yawGoalTolerance: 0.1,
      passingFlag: true,
      passingDist: 0.12,
      straightPath: true,
      avoidMode: true,
      roadWidth: 3,
      backwardDriving: true,
      plannerName: 'MPC',
      motionDirection: 2,
      routeMode: 'STRAIGHT+ROLLOUT'
    });
    expect(manager._buildWaypointProfile(action, null).passingFlag).toBe(false);
    expect(manager._buildWaypointProfile({ action_params: [] }, null)).toMatchObject({
      maxTransVel: 0.7,
      maxRotVel: 0.6,
      straightPath: false,
      avoidMode: true,
      roadWidth: 4,
      plannerName: 'Pure',
      routeMode: 'GLOBAL+ROLLOUT',
      maxTransAcc: 0.3,
      maxTransDeacc: 0.3,
      maxRotAcc: 0.3,
      maxRotDeacc: 0.3,
      arrivingDistance: 1,
      responseTime: 0.6,
      wpTolerance: 1,
      headingYaw: 0.8,
      controllerSource: 'SR-AMR-Base'
    });
  });

  test('maps TrajectoryFollowing parameters to the lightweight software controller', () => {
    const { manager } = loadTestMode(1);
    const profile = manager._buildTrajectoryProfile({
      action_params: [
        actionParam('max_trans_vel', 1.1, 'float'),
        actionParam('max_rot_vel', 0.8, 'float'),
        actionParam('lane_direction', 3, 'int'),
        actionParam('lane_type', 1, 'int'),
        actionParam('road_width', 2.5, 'float')
      ]
    }, { action_type: 0x01 });

    expect(profile).toMatchObject({
      maxTransVel: 1.1,
      maxRotVel: 0.8,
      backwardDriving: true,
      laneDirection: 3,
      laneType: 1,
      roadWidth: 2.5,
      routeMode: 'SMOOTH+ROLLOUT',
      controllerSource: 'SR-AMR-Base'
    });
  });

  test('selects DD or QD independently from the Action model_type', () => {
    const { manager, elements } = loadTestMode(1);
    const qdAction = {
      action_params: [actionParam('model_type', 1, 'int')]
    };

    elements['test-mode-drive-model'].value = 'dd';
    expect(manager._buildWaypointProfile(qdAction, null)).toMatchObject({
      actionModelType: 1,
      modelType: 0,
      driveModelSelection: 'dd',
      driveModelName: 'DD'
    });

    elements['test-mode-drive-model'].value = 'qd';
    expect(manager._buildWaypointProfile({ action_params: [] }, null)).toMatchObject({
      actionModelType: 0,
      modelType: 1,
      driveModelSelection: 'qd',
      driveModelName: 'QD'
    });

    elements['test-mode-drive-model'].value = 'action';
    expect(manager._buildWaypointProfile(qdAction, null)).toMatchObject({
      actionModelType: 1,
      modelType: 1,
      driveModelSelection: 'action',
      driveModelName: 'QD'
    });
  });

  test('DD turns its body toward the path while QD keeps a fixed heading', () => {
    const { manager, elements } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    const start = manager.virtualRobots.get(0).pose;
    const target = {
      x: start.x,
      y: start.y - 0.5,
      theta: -Math.PI / 2,
      isGoal: true
    };

    elements['test-mode-drive-model'].value = 'dd';
    const ddRobot = { pose: { ...start } };
    const ddState = {
      profile: manager._buildWaypointProfile({ action_params: [] }, null),
      currentSpeed: 0,
      currentAngularSpeed: 0,
      navQueue: []
    };
    manager._moveVirtualRobot(ddRobot, target, 0.1, ddState);

    elements['test-mode-drive-model'].value = 'qd';
    const qdRobot = { pose: { ...start } };
    const qdState = {
      profile: manager._buildWaypointProfile({ action_params: [] }, null),
      currentSpeed: 0,
      currentAngularSpeed: 0,
      navQueue: []
    };
    manager._moveVirtualRobot(qdRobot, target, 0.1, qdState);

    expect(ddState.controllerMode).toBe('ROTATE');
    expect(ddRobot.pose.yaw).toBeLessThan(start.yaw);
    expect(qdRobot.pose.yaw).toBe(start.yaw);
    expect(qdRobot.pose.y).toBeLessThan(start.y);
  });

  test('DD translates on its body axis while QD can translate on the path vector', () => {
    const { manager, elements } = loadTestMode(1);
    manager._isPoseTraversable = jest.fn(() => true);
    const target = { x: 2, y: 2, theta: Math.PI / 4, isGoal: true };

    elements['test-mode-drive-model'].value = 'dd';
    const ddRobot = { pose: { x: 0, y: 0, yaw: 0 } };
    const ddState = {
      profile: {
        ...manager._buildWaypointProfile({ action_params: [] }, null),
        headingYaw: Math.PI,
        departureThreshold: 0
      },
      currentSpeed: 0.4,
      currentAngularSpeed: 0,
      navQueue: []
    };
    manager._moveVirtualRobot(ddRobot, target, 0.1, ddState);

    elements['test-mode-drive-model'].value = 'qd';
    const qdRobot = { pose: { x: 0, y: 0, yaw: 0 } };
    const qdState = {
      profile: manager._buildWaypointProfile({ action_params: [] }, null),
      currentSpeed: 0.4,
      currentAngularSpeed: 0,
      navQueue: []
    };
    manager._moveVirtualRobot(qdRobot, target, 0.1, qdState);

    expect(ddRobot.pose.x).toBeGreaterThan(ddRobot.pose.y * 3);
    expect(qdRobot.pose.x).toBeCloseTo(qdRobot.pose.y, 5);
    expect(ddRobot.pose.yaw).toBeGreaterThan(0);
    expect(qdRobot.pose.yaw).toBe(0);
  });

  test('maps every TrajectoryFollowing mode and sensor-related parameter', () => {
    const { manager } = loadTestMode(1);
    const profile = manager._buildTrajectoryProfile({
      action_params: [
        actionParam('lane_name', 'factory_lane'),
        actionParam('driving_type', 3, 'int'),
        actionParam('lane_direction', 5, 'int'),
        actionParam('lane_type', 2, 'int'),
        actionParam('passing_flag', true, 'bool'),
        actionParam('passing_dist', 0.45, 'float'),
        actionParam('qr_correction_mode', true, 'bool'),
        actionParam('sync_mode_enabled', true, 'bool'),
        actionParam('using_basic_footprint', true, 'bool'),
        actionParam('collision_detect_range', 0.8, 'float')
      ]
    }, { action_type: 0x01 });

    expect(profile).toMatchObject({
      laneName: 'factory_lane',
      drivingType: 3,
      drivingTypeName: 'OBSTACLE_AVOIDANCE',
      laneDirection: 5,
      laneDirectionName: 'BACKWARD_RIGHT',
      laneType: 2,
      laneTypeName: 'OFF_LANE',
      backwardDriving: true,
      passingFlag: true,
      passingDist: 0.45,
      qrCorrectionMode: true,
      syncModeEnabled: true,
      usingBasicFootprint: true,
      safetyFootprint: 'BASIC',
      collisionDetectRange: 0.8,
      routeMode: 'OFF_LANE+COSTMAP'
    });
  });

  test('applies Engineer A/B profile overrides only to Test Mode controllers', () => {
    const { manager } = loadTestMode(1);
    manager.setDriveSimulationOverride({
      maxTransVel: 0.55,
      maxTransDeacc: 0.7,
      collisionDetectRange: 0.45,
      modelType: 0
    });

    const profile = manager._buildTrajectoryProfile(
      {
        action_params: [
          actionParam('max_trans_vel', 1.2, 'float'),
          actionParam('collision_detect_range', 0.1, 'float')
        ]
      },
      null
    );

    expect(profile).toMatchObject({
      maxTransVel: 0.55,
      maxTransDeacc: 0.7,
      collisionDetectRange: 0.45,
      modelType: 0,
      controllerSource: 'SR-AMR-Base + Engineer A/B override'
    });

    manager.setDriveSimulationOverride(null);
    expect(manager._buildTrajectoryProfile({ action_params: [] }, null).controllerSource)
      .toBe('SR-AMR-Base');
  });

  test('reverses backward Trajectory order and smooths only SMOOTH lanes', () => {
    const { manager } = loadTestMode(1);
    const strictBackward = manager._buildTrajectoryProfile({
      action_params: [
        actionParam('lane_direction', 4, 'int'),
        actionParam('lane_type', 0, 'int')
      ]
    }, null);
    const strict = manager._trajectoryTargetsFromArgs(
      [1, 1, 2, 2, 3, 1, 1.57],
      strictBackward
    );

    expect(strict.map(point => [point.x, point.y])).toEqual([
      [3, 1], [2, 2], [1, 1]
    ]);
    expect(strict.at(-1).theta).toBeCloseTo(1.57);

    const smooth = manager._buildTrajectoryProfile({
      action_params: [actionParam('lane_type', 1, 'int')]
    }, null);
    const smoothed = manager._trajectoryTargetsFromArgs(
      [1, 1, 2, 2, 3, 1, 0],
      smooth
    );
    expect(smoothed.length).toBeGreaterThan(3);
    expect(smoothed[0]).toMatchObject({ x: 1, y: 1 });
    expect(smoothed.at(-1)).toMatchObject({ x: 3, y: 1, theta: 0 });
  });

  test('uses map Navigation Goal velocity and passing options in Test Mode', () => {
    const { manager } = loadTestMode(1);
    const state = manager._createStandaloneNavigationState({
      maxVel: 0.42,
      passing: true
    });

    expect(state.profile.maxTransVel).toBe(0.42);
    expect(state.profile.passingFlag).toBe(true);
    expect(state.profile.controllerSource).toBe('SR-AMR-Base');
    expect(state.currentSpeed).toBe(0);
    expect(state.currentAngularSpeed).toBe(0);
  });

  test('straight path without rollout safety-stops at a black wall', async () => {
    const { manager, events } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    manager.enabled = true;

    await manager.runTask(0, taskRequest('straight_non_avoid', [{
      action_id: 'straight_into_wall',
      action_type: 0x01,
      action_args: [-3.0, -1.5, Math.PI / 2],
      action_params: [
        actionParam('straight_path', true, 'bool'),
        actionParam('avoid_mode', false, 'bool')
      ]
    }]));

    const robot = manager.virtualRobots.get(0);
    for (let tick = 0; tick < 300 && robot.task; tick += 1) {
      manager._tickVirtualFleet(0.05);
    }

    expect(robot.task).toBeNull();
    expect(robot.pose.y).toBeLessThan(-2.25);
    expect(manager._isPoseTraversable(robot.pose.x, robot.pose.y)).toBe(true);
    expect(events.some(event => String(event.join(' ')).includes('안전 정지'))).toBe(true);
  });

  test('straight path with rollout detours inside road_width and reaches the goal', async () => {
    const { manager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    manager.enabled = true;

    await manager.runTask(0, taskRequest('straight_rollout', [{
      action_id: 'rollout_around_wall',
      action_type: 0x01,
      action_args: [-3.0, -1.5, Math.PI / 2],
      action_params: [
        actionParam('straight_path', true, 'bool'),
        actionParam('avoid_mode', true, 'bool'),
        actionParam('road_width', 4, 'float')
      ]
    }]));

    const robot = manager.virtualRobots.get(0);
    manager._tickVirtualFleet(0.05);
    expect(robot.currentAction.profile.routeMode).toBe('STRAIGHT+ROLLOUT');
    expect(Math.max(...robot.plannedPath.map(point => point.x))).toBeGreaterThan(-1.55);

    for (let tick = 0; tick < 900 && robot.task; tick += 1) {
      manager._tickVirtualFleet(0.05);
      expect(manager._isPoseTraversable(robot.pose.x, robot.pose.y)).toBe(true);
    }

    expect(robot.task).toBeNull();
    expect(robot.pose.x).toBeCloseTo(-3.0, 2);
    expect(robot.pose.y).toBeCloseTo(-1.5, 2);
  });

  test('max_trans_vel changes the lightweight WayPoint driving speed', () => {
    const { manager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    const start = manager.virtualRobots.get(0).pose;
    const target = { x: -2.0, y: -2.5, theta: 0, isGoal: true };
    const slow = { pose: { ...start } };
    const fast = { pose: { ...start } };
    const slowCurrent = {
      currentSpeed: 0,
      profile: manager._buildWaypointProfile({
        action_params: [actionParam('max_trans_vel', 0.2, 'float')]
      }, null)
    };
    const fastCurrent = {
      currentSpeed: 0,
      profile: manager._buildWaypointProfile({
        action_params: [actionParam('max_trans_vel', 1.2, 'float')]
      }, null)
    };

    // SR-AMR-Base acceleration limiting intentionally makes both profiles
    // similar during the initial ramp. Compare after the slow profile has
    // saturated instead of expecting an instantaneous velocity jump.
    for (let tick = 0; tick < 60; tick += 1) {
      manager._moveVirtualRobot(slow, target, 0.05, slowCurrent);
      manager._moveVirtualRobot(fast, target, 0.05, fastCurrent);
    }

    expect(fast.pose.x - start.x).toBeGreaterThan(slow.pose.x - start.x + 0.3);
  });

  test('uses SR-AMR-Base braking distance and smooth angular acceleration', () => {
    const { manager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    const start = manager.virtualRobots.get(0).pose;
    const profile = manager._buildWaypointProfile({ action_params: [] }, null);

    const arrivingRobot = { pose: { ...start, yaw: 0 } };
    const arriving = {
      profile,
      currentSpeed: 0.7,
      currentAngularSpeed: 0,
      previousHeadingError: 0,
      navQueue: []
    };
    manager._moveVirtualRobot(
      arrivingRobot,
      { x: start.x + 0.5, y: start.y, theta: 0, isGoal: true },
      0.05,
      arriving
    );

    expect(arriving.controllerMode).toBe('ARRIVE');
    expect(arriving.targetSpeed).toBeLessThan(profile.maxTransVel);
    expect(arriving.currentSpeed).toBeLessThan(0.7);
    expect(arriving.lookaheadDistance).toBeGreaterThan(profile.wpTolerance);

    const turningRobot = { pose: { ...start, yaw: 0 } };
    const turning = {
      profile,
      currentSpeed: 0,
      currentAngularSpeed: 0,
      previousHeadingError: null,
      navQueue: []
    };
    for (let tick = 0; tick < 5; tick += 1) {
      manager._moveVirtualRobot(
        turningRobot,
        { x: start.x, y: start.y + 1, theta: Math.PI / 2, isGoal: true },
        0.05,
        turning
      );
    }

    expect(turning.controllerMode).toBe('ROTATE');
    expect(turningRobot.pose.yaw).toBeGreaterThan(0);
    expect(turningRobot.pose.yaw).toBeLessThan(Math.PI / 2);
    expect(Math.abs(turning.currentAngularSpeed)).toBeLessThanOrEqual(profile.maxRotVel);
  });

  test('passes intermediate planner points without resetting translational speed', () => {
    const { manager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    const start = manager.virtualRobots.get(0).pose;
    const current = {
      profile: manager._buildWaypointProfile({ action_params: [] }, null),
      currentSpeed: 0.4,
      currentAngularSpeed: 0.1,
      navQueue: [{ x: start.x + 1, y: start.y, theta: 0, isGoal: true }]
    };

    const reached = manager._moveVirtualRobot(
      { pose: { ...start } },
      { x: start.x + 0.02, y: start.y, theta: 0, isGoal: false },
      0.05,
      current
    );

    expect(reached).toBe(true);
    expect(current.controllerMode).toBe('PASS');
    expect(current.currentSpeed).toBe(0.4);
  });

  test('passing_dist changes early handoff distance and passing keeps velocity', async () => {
    const runPassing = distance => {
      const { manager } = loadTestMode(1);
      manager.prepareVirtualFleet(1);
      manager._buildMapCache();
      const start = manager.virtualRobots.get(0).pose;
      const robot = { pose: { ...start } };
      const current = {
        profile: manager._buildWaypointProfile({
          action_params: [
            actionParam('passing_flag', true, 'bool'),
            actionParam('passing_dist', distance, 'float'),
            actionParam('straight_path', true, 'bool'),
            actionParam('avoid_mode', false, 'bool')
          ]
        }, { action_type: 0x01 }),
        currentSpeed: 0.5,
        currentAngularSpeed: 0,
        navQueue: []
      };
      const target = {
        x: start.x + 1,
        y: start.y,
        theta: 0,
        isGoal: true
      };
      let reached = false;
      for (let tick = 0; tick < 100 && !reached; tick += 1) {
        reached = manager._moveVirtualRobot(robot, target, 0.05, current);
      }
      return { remaining: target.x - robot.pose.x, speed: current.currentSpeed };
    };

    const closePass = runPassing(0.08);
    const earlyPass = runPassing(0.45);
    expect(earlyPass.remaining).toBeGreaterThan(closePass.remaining + 0.25);
    expect(earlyPass.speed).toBeGreaterThan(0.4);

    const { manager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    manager.enabled = true;
    const robot = manager.virtualRobots.get(0);
    const start = { ...robot.pose };
    await manager.runTask(0, taskRequest('passing_chain', [
      {
        action_id: 'pass_1',
        action_type: 0x01,
        action_args: [start.x + 0.8, start.y, 0],
        action_params: [
          actionParam('passing_flag', true, 'bool'),
          actionParam('passing_dist', 0.3, 'float')
        ]
      },
      {
        action_id: 'pass_2',
        action_type: 0x01,
        action_args: [start.x + 1.6, start.y, 0],
        action_params: []
      }
    ]));
    for (let tick = 0; tick < 200 && robot.task?.actionIndex === 0; tick += 1) {
      manager._tickVirtualFleet(0.05);
    }
    expect(robot.task.actionIndex).toBe(1);
    expect(robot.motionCarry.speed).toBeGreaterThan(0.1);
    const carriedSpeed = robot.motionCarry.speed;
    manager._tickVirtualFleet(0.01);
    expect(robot.currentAction.currentSpeed).toBeGreaterThan(carriedSpeed * 0.8);
  });

  test('STOP_AND_GO marks intermediate stops and collision_detect_range changes stop distance', async () => {
    const { manager } = loadTestMode(1);
    const profile = manager._buildTrajectoryProfile({
      action_params: [actionParam('driving_type', 2, 'int')]
    }, null);
    const points = manager._trajectoryTargetsFromArgs(
      [-3, -2.5, -2, -2.5, -1, -2.5, 0],
      profile
    );
    expect(points[0].stopPoint).toBe(true);
    expect(points[1].stopPoint).toBe(true);
    expect(points.at(-1).stopPoint).toBe(false);

    const runTowardWall = async detectRange => {
      const runtime = loadTestMode(1);
      runtime.manager.prepareVirtualFleet(1);
      runtime.manager._buildMapCache();
      runtime.manager.enabled = true;
      await runtime.manager.runTask(0, taskRequest(`range_${detectRange}`, [{
        action_id: 'wall',
        action_type: 0x15,
        action_args: [-3, -1.5, Math.PI / 2],
        action_params: [
          actionParam('lane_type', 2, 'int'),
          actionParam('driving_type', 0, 'int'),
          actionParam('collision_detect_range', detectRange, 'float')
        ]
      }]));
      const robot = runtime.manager.virtualRobots.get(0);
      for (let tick = 0; tick < 300 && robot.task; tick += 1) {
        runtime.manager._tickVirtualFleet(0.05);
      }
      return robot.pose.y;
    };
    const shortRangeY = await runTowardWall(0.15);
    const longRangeY = await runTowardWall(0.8);
    expect(longRangeY).toBeLessThan(shortRangeY - 0.1);
  });

  test('simulates trajectory, standby, and docking while reporting the moving pose', async () => {
    const { manager, App, RosManager, events } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    manager.enabled = true;

    await manager.runTask(0, taskRequest('quick_repeat', [
      {
        action_id: 'trajectory',
        action_type: 0x15,
        action_args: [-2.4, -2.5, -1.5, -2.5, 0.4],
        action_params: []
      },
      {
        action_id: 'standby',
        action_type: 0x07,
        action_args: [0.2],
        action_params: []
      },
      {
        action_id: 'dock',
        action_type: 0x08,
        action_args: [1],
        action_params: []
      }
    ]));

    for (let tick = 0; tick < 500; tick += 1) {
      manager._tickVirtualFleet(0.05);
    }
    manager._publishVirtualFleetTelemetry();

    const robot = manager.virtualRobots.get(0);
    expect(robot.task).toBeNull();
    expect(robot.pose.x).toBeCloseTo(-1.5, 2);
    expect(robot.pose.y).toBeCloseTo(-2.5, 2);
    expect(robot.pose.yaw).toBeCloseTo(0.4, 2);
    expect(robot.charging).toBe(true);
    expect(App.robotSlots[0].pose.x).toBeCloseTo(-1.5, 2);
    expect(RosManager.robotPose.x).toBeCloseTo(-1.5, 2);
    expect(events.some(event => String(event[1]).includes('Task 완료'))).toBe(true);
  });

  test('moves multiple robots independently and supports pause, resume, and cancel', async () => {
    const { manager } = loadTestMode(3);
    manager.prepareVirtualFleet(3);
    manager._buildMapCache();
    manager.enabled = true;

    await Promise.all([
      manager.runTask(0, taskRequest('robot_1', [{
        action_id: 'go_1',
        action_type: 0x01,
        action_args: [-2.0, -2.5, 0],
        action_params: []
      }])),
      manager.runTask(1, taskRequest('robot_2', [{
        action_id: 'go_2',
        action_type: 0x01,
        action_args: [-0.75, -1.0, Math.PI / 2],
        action_params: []
      }]))
    ]);

    for (let tick = 0; tick < 8; tick += 1) manager._tickVirtualFleet(0.05);
    await manager.controlTask(0, 'pause');
    const pausedPose = { ...manager.virtualRobots.get(0).pose };
    for (let tick = 0; tick < 20; tick += 1) manager._tickVirtualFleet(0.05);
    expect(manager.virtualRobots.get(0).pose).toEqual(pausedPose);

    await manager.controlTask(0, 'resume');
    for (let tick = 0; tick < 300; tick += 1) manager._tickVirtualFleet(0.05);
    expect(manager.virtualRobots.get(0).task).toBeNull();
    expect(manager.virtualRobots.get(1).task).toBeNull();
    expect(manager.virtualRobots.get(0).pose.x).toBeCloseTo(-2.0, 2);
    expect(manager.virtualRobots.get(1).pose.y).toBeCloseTo(-1.0, 2);

    await manager.runTask(2, taskRequest('cancel_me', [{
      action_id: 'long_go',
      action_type: 0x01,
      action_args: [-4, 4, 0],
      action_params: []
    }]));
    manager._tickVirtualFleet(0.05);
    await manager.controlTask(2, 'cancel');
    expect(manager.virtualRobots.get(2).task).toBeNull();
    expect(manager.virtualRobots.get(2).workState).toBe(0);
  });

  test('builds a lightweight map from virtual LiDAR and publishes Mapping products', () => {
    const { manager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    manager.enabled = true;
    const robot = manager.virtualRobots.get(0);
    const publishers = manager.createPublishers({}, robot.robotId);
    manager.publisherSets.set(robot.robotId, publishers);

    manager._setVirtualMappingMode(robot, 'SLAM');
    expect(robot.mappingMode).toBe('SLAM');
    expect(Array.from(robot.mapping.mapData).every(value => value === -1)).toBe(false);

    const route = [
      [-2.4, -2.5, 0],
      [-1.8, -2.5, 0],
      [-1.8, -3.1, -Math.PI / 2],
      [-1.8, -3.7, -Math.PI / 2],
      [-2.4, -3.7, Math.PI],
      [-3.0, -3.7, Math.PI],
      [-3.0, -3.1, Math.PI / 2],
      [-3.0, -2.5, 0]
    ];
    route.forEach(([x, y, yaw]) => {
      robot.pose = { x, y, yaw };
      manager._updateVirtualMappingRobot(robot);
    });
    manager._publishVirtualScans();
    manager._publishVirtualMappingProducts();

    expect(robot.mapping.coverage).toBeGreaterThan(0);
    expect(robot.mapping.path.length).toBeGreaterThan(5);
    expect(robot.mapping.graphNodes.length).toBeGreaterThan(6);
    expect(robot.mapping.loopEdges).toHaveLength(1);
    expect(publishers.scan.published.length).toBeGreaterThan(0);
    expect(publishers.map.published.length).toBeGreaterThan(0);
    expect(publishers.mappingPath.published.at(-1).poses.length).toBeGreaterThan(5);
    expect(
      publishers.slamGraph.published.at(-1).markers
        .find(marker => marker.ns === 'loop_slam_edges').points
    ).toHaveLength(2);
    expect(publishers.mappingFootprint.published.at(-1).header.frame_id)
      .toBe('base_footprint');
  });

  test('saves Mapping for NAV and keeps path, Vertex and Graph for Lifelong', () => {
    const { manager, RosManager } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager._buildMapCache();
    manager.enabled = true;
    const robot = manager.virtualRobots.get(0);
    const publishers = manager.createPublishers({}, robot.robotId);
    manager.publisherSets.set(robot.robotId, publishers);

    manager._setVirtualMappingMode(robot, 'SLAM');
    [
      [-1.8, -1.4, 0],
      [-1.2, -1.4, 0],
      [-1.2, -0.8, Math.PI / 2],
      [-1.8, -0.8, Math.PI],
      [-1.8, -1.4, -Math.PI / 2]
    ].forEach(([x, y, yaw]) => {
      robot.pose = { x, y, yaw };
      manager._updateVirtualMappingRobot(robot);
    });
    const knownBefore = Array.from(robot.mapping.mapData)
      .filter(value => value >= 0).length;
    const pathBefore = robot.mapping.path.length;
    const verticesBefore = robot.mapping.graphNodes.length;
    const graphEdgesBefore = robot.mapping.graphEdges.length;

    expect(manager.saveActiveMap()).toBe(true);
    const savedMap = robot.savedNavMap;

    manager._setVirtualMappingMode(robot, 'NAV');
    expect(robot.mappingMode).toBe('NAV');
    expect(robot.workState).toBe(0);
    expect(robot.savedMapName).toBe('map');
    expect(robot.lastMappingSession.path).toHaveLength(pathBefore);
    expect(robot.lastMappingSession.graphNodes).toHaveLength(verticesBefore);
    expect(robot.lastMappingSession.graphEdges).toHaveLength(graphEdgesBefore);
    expect(publishers.map.published.at(-1).data).toEqual(Array.from(savedMap));
    expect(RosManager.lastMapMsg.data).toEqual(Array.from(savedMap));

    manager._setVirtualMappingMode(robot, 'LIFELONG');
    const knownAfter = Array.from(robot.mapping.mapData)
      .filter(value => value >= 0).length;

    expect(robot.mappingMode).toBe('LIFELONG');
    expect(robot.workState).toBe(10);
    expect(knownAfter).toBeGreaterThanOrEqual(knownBefore);
    expect(robot.mapping.path.length).toBeGreaterThanOrEqual(pathBefore);
    expect(robot.mapping.graphNodes.length).toBeGreaterThanOrEqual(verticesBefore);
    expect(robot.mapping.graphEdges.length).toBeGreaterThanOrEqual(graphEdgesBefore);
  });

  test('prioritizes active robot Mapping work and throttles background robots', () => {
    const { manager, App, RosManager } = loadTestMode(3);
    manager.prepareVirtualFleet(3);
    manager._buildMapCache();
    manager.enabled = true;
    manager.virtualRobots.forEach(robot => {
      manager.publisherSets.set(robot.robotId, manager.createPublishers({}, robot.robotId));
    });

    const active = manager.virtualRobots.get(0);
    const backgroundMapping = manager.virtualRobots.get(1);
    const backgroundNav = manager.virtualRobots.get(2);
    manager._setVirtualMappingMode(active, 'SLAM');
    manager._setVirtualMappingMode(backgroundMapping, 'SLAM');
    manager._virtualScanCycle = 0;
    manager._mappingProductCycle = 0;
    manager.publisherSets.forEach(publishers => {
      publishers.scan.published.length = 0;
      publishers.map.published.length = 0;
    });

    for (let cycle = 0; cycle < 4; cycle += 1) manager._publishVirtualScans();

    expect(manager.publisherSets.get(active.robotId).scan.published).toHaveLength(4);
    expect(manager.publisherSets.get(backgroundMapping.robotId).scan.published).toHaveLength(1);
    expect(manager.publisherSets.get(backgroundNav.robotId).scan.published).toHaveLength(0);

    for (let cycle = 0; cycle < 4; cycle += 1) manager._publishVirtualMappingProducts();

    const activeMaps = manager.publisherSets.get(active.robotId).map.published;
    const backgroundMaps = manager.publisherSets.get(backgroundMapping.robotId).map.published;
    expect(activeMaps).toHaveLength(4);
    expect(backgroundMaps).toHaveLength(1);
    expect(RosManager.lastMapMsg.data).toBe(activeMaps.at(-1).data);
    expect(App.activeSlotIndex).toBe(0);
  });

  test('serializes a shared navigation map only once per fleet publish', () => {
    const { manager, RosManager } = loadTestMode(3);
    manager.prepareVirtualFleet(3);
    manager._buildMapCache();
    manager.enabled = true;
    manager.virtualRobots.forEach(robot => {
      manager.publisherSets.set(robot.robotId, manager.createPublishers({}, robot.robotId));
    });

    manager._publishVirtualMaps();
    const mapMessages = Array.from(manager.virtualRobots.values()).map(robot =>
      manager.publisherSets.get(robot.robotId).map.published.at(-1)
    );

    expect(mapMessages[0].data).toBe(mapMessages[1].data);
    expect(mapMessages[1].data).toBe(mapMessages[2].data);
    expect(RosManager.lastMapMsg.data).toBe(mapMessages[0].data);
  });
});
