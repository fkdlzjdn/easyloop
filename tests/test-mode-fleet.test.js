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
    subscribe() {}
    unsubscribe() {}
    publish() {}
  }
  const elements = {
    'test-mode-robot-count': { value: String(robotCount), disabled: false }
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

describe('Test Mode virtual fleet', () => {
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

  test('simulates trajectory, standby, and docking while reporting the moving pose', async () => {
    const { manager, App, RosManager, events } = loadTestMode(1);
    manager.prepareVirtualFleet(1);
    manager.enabled = true;

    await manager.runTask(0, taskRequest('quick_repeat', [
      {
        action_id: 'trajectory',
        action_type: 0x15,
        action_args: [-2.0, -2.0, -1.5, -1.2, 0.4],
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
    expect(robot.pose.y).toBeCloseTo(-1.2, 2);
    expect(robot.pose.yaw).toBeCloseTo(0.4, 2);
    expect(robot.charging).toBe(true);
    expect(App.robotSlots[0].pose.x).toBeCloseTo(-1.5, 2);
    expect(RosManager.robotPose.x).toBeCloseTo(-1.5, 2);
    expect(events.some(event => String(event[1]).includes('Task 완료'))).toBe(true);
  });

  test('moves multiple robots independently and supports pause, resume, and cancel', async () => {
    const { manager } = loadTestMode(3);
    manager.prepareVirtualFleet(3);
    manager.enabled = true;

    await Promise.all([
      manager.runTask(0, taskRequest('robot_1', [{
        action_id: 'go_1',
        action_type: 0x01,
        action_args: [-1.0, -2.0, 0],
        action_params: []
      }])),
      manager.runTask(1, taskRequest('robot_2', [{
        action_id: 'go_2',
        action_type: 0x01,
        action_args: [0, -1.0, Math.PI / 2],
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
    expect(manager.virtualRobots.get(0).pose.x).toBeCloseTo(-1.0, 2);
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
});
