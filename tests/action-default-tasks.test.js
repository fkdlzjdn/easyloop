const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadActionSender(initialQueues = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'action-sender.js'),
    'utf8'
  );
  const storage = new Map([
    ['actionSenderSavedQueues', JSON.stringify(initialQueues)]
  ]);
  const context = {
    App: { toast: jest.fn() },
    ROSLIB: {},
    localStorage: {
      getItem: jest.fn(key => storage.has(key) ? storage.get(key) : null),
      setItem: jest.fn((key, value) => storage.set(key, String(value)))
    },
    document: {
      addEventListener: jest.fn(),
      getElementById: jest.fn(() => null)
    },
    window: {},
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__ActionSender = ActionSender;`, context);
  return { manager: context.__ActionSender, storage, context };
}

describe('built-in single-action tasks', () => {
  test('seeds the eight required defaults as one-action tasks', () => {
    const { manager, storage } = loadActionSender();

    expect(manager.ensureDefaultTasks()).toBe(8);
    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));

    expect(Object.keys(saved)).toHaveLength(8);
    Object.entries(saved).forEach(([taskName, entry]) => {
      expect(entry.queue).toHaveLength(1);
      expect(entry.queue[0].name).toBe(taskName);
      expect(entry.loopFlag).toBe(1);
      expect(entry.builtin).toBe(true);
      expect(entry.builtinVersion).toBe(manager.BUILTIN_TASK_VERSION);
    });
    expect(saved['기본 - 도킹'].queue[0].actionType).toBe('0x08');
    expect(saved['기본 - 도킹아웃'].queue[0].actionType).toBe('0x10');
    expect(saved['기본 - WayPoint'].queue[0].actionType).toBe('0x01');
    expect(saved['기본 - Standby'].queue[0].actionType).toBe('0x07');
    expect(saved['기본 - TrajectoryFollowing'].queue[0].actionType).toBe('0x15');
    expect(saved['기본 - 리프트 업'].queue[0].args).toEqual([1, 0]);
    expect(saved['기본 - 리프트 다운'].queue[0].args).toEqual([2, 0]);
    expect(saved['기본 - 컨베이어 구동'].queue[0].args).toEqual([3, 1]);
    expect(saved['기본 - 컨베이어 구동'].queue[0].conveyorFloor).toBe(1);
  });

  test('preserves a user task when its name matches a built-in task', () => {
    const custom = {
      '기본 - 도킹': {
        queue: [{ name: 'custom-dock', actionType: '0x08', args: [1, -1, 5, 3] }],
        savedAt: 123
      }
    };
    const { manager, storage } = loadActionSender(custom);

    expect(manager.ensureDefaultTasks()).toBe(7);
    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));

    expect(saved['기본 - 도킹']).toEqual(custom['기본 - 도킹']);
    expect(Object.keys(saved)).toHaveLength(8);
  });

  test('migrates previous built-ins so task_id and action_id match', () => {
    const previousBuiltin = {
      '기본 - 도킹': {
        queue: [{ name: 'Docking', actionType: '0x08', args: [0, 1, 1, 1] }],
        builtin: true,
        builtinVersion: 2
      }
    };
    const { manager, storage } = loadActionSender(previousBuiltin);

    expect(manager.ensureDefaultTasks()).toBe(8);
    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));

    expect(saved['기본 - 도킹'].queue[0].name).toBe('기본 - 도킹');
    expect(saved['기본 - 도킹'].loopFlag).toBe(1);
    expect(saved['기본 - 도킹'].builtinVersion).toBe(3);
  });

  test('shows hexadecimal action numbers in the action selector', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'),
      'utf8'
    );

    expect(html).toContain('<option value="0x01">0x01 · WayPoint</option>');
    expect(html).toContain('<option value="0x08">0x08 · 도킹</option>');
    expect(html).toContain('<option value="0x18">0x18 · 컨베이어 구동</option>');
  });

  test('removes the redundant parameter preset feature from the Task tab', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'),
      'utf8'
    );
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'action-sender.js'),
      'utf8'
    );

    expect(html).not.toContain('param-preset-section');
    expect(html).not.toContain('btn-preset-save');
    expect(source).not.toContain('const ParamPresets');
    expect(source).not.toContain('ParamPresets.init()');
  });

  test('removes Action favorites and exposes YAML file-level controls', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'),
      'utf8'
    );
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'action-sender.js'),
      'utf8'
    );

    expect(html).not.toContain('Action 즐겨찾기');
    expect(html).not.toContain('btn-save-favorite');
    expect(source).not.toContain('const ActionFavorites');
    expect(source).not.toContain('ActionFavorites.init()');
    expect(html).toContain('id="task-yaml-file-select"');
    expect(html).toContain('YAML 전체 저장');
  });

  test('exposes Task copy, Action copy, and map-based Quick Task controls', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'),
      'utf8'
    );
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'action-sender.js'),
      'utf8'
    );

    expect(html).toContain('id="btn-quick-task"');
    expect(html).toContain('id="btn-quick-waypoint"');
    expect(html).toContain('id="btn-quick-trajectory"');
    expect(html).toContain('id="btn-quick-docking"');
    expect(html).toContain('id="btn-quick-standby"');
    expect(html).toContain('id="quick-task-map-hud"');
    expect(html).toContain('id="btn-run-quick-task"');
    expect(source).toContain('duplicateSavedQueue(name)');
    expect(source).toContain('duplicateAction(index)');
  });

  test('refreshes Task telemetry and controls when the active ROS slot connects', () => {
    const { manager, context } = loadActionSender();
    const slot = { connected: true, ros: {}, taskInterface: { variant: 'stale' } };
    context.App.robotSlots = [slot];
    manager.getTargetSlot = jest.fn(() => 0);
    manager.updateTargetStatus = jest.fn();
    manager._subscribeTaskTelemetry = jest.fn();

    manager.onSlotConnectionChanged(0, true);

    expect(slot.taskInterface).toBeUndefined();
    expect(manager.updateTargetStatus).toHaveBeenCalled();
    expect(manager._subscribeTaskTelemetry).toHaveBeenCalled();
  });

  test('conveyor floor selection supports only floors 1 and 2 and defaults to floor 1', () => {
    const { manager } = loadActionSender();
    const floorArg = manager.actionTypes['0x18'].args[1];

    expect(floorArg.name).toBe('floor');
    expect(floorArg.default).toBe(1);
    expect(Array.from(floorArg.enumValues, option => option.value)).toEqual([1, 2]);
  });

  test('uses Setup-style guided choices for docking and lift codes', () => {
    const { manager } = loadActionSender();
    const docking = manager.actionTypes['0x08'];
    const lift = manager.actionTypes['0x16'];

    expect(Array.from(docking.args[1].enumValues, option => option.value)).toEqual([1, -1, 2, 3]);
    expect(Array.from(docking.args[2].enumValues, option => option.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(Array.from(docking.args[3].enumValues, option => option.value)).toEqual([1, 2, 3]);
    expect(Array.from(lift.args[0].enumValues, option => option.value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('keeps friendly Korean labels together with the real ROS parameter names', () => {
    const { manager } = loadActionSender({
      sample: {
        queue: [{
          name: 'move',
          actionType: '0x01',
          args: [1, 2, 0],
          params: [{ param_name: 'max_trans_vel', type: 'float', value: '0.7' }]
        }],
        loopFlag: 1
      }
    });

    const detail = manager.getTaskDetailModel('sample');

    expect(detail.actions[0].args[0]).toEqual({ name: 'x', label: '목표 X', value: 1 });
    expect(detail.actions[0].params[0]).toEqual({
      name: 'max_trans_vel',
      label: '최대 직진 속도',
      type: 'float',
      value: '0.7'
    });
    expect(manager._fieldLabelMarkup({ name: 'target_cfg' })).toContain('도킹 설정 파일');
    expect(manager._fieldLabelMarkup({ name: 'target_cfg' })).toContain('target_cfg');
  });

  test('switches between the task list and dedicated create/edit screens', () => {
    const { manager, context } = loadActionSender();
    const elements = {
      'task-library-view': { hidden: false, scrollIntoView: jest.fn() },
      'task-builder-view': { hidden: true, scrollIntoView: jest.fn() },
      'task-builder-title': { textContent: '' },
      'action-queue-save-name': { value: 'old' },
      'action-work-id': { value: 'old' },
      'action-loop-count': { value: '3' },
      'action-queue-load-select': { value: 'old' }
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    manager.renderQueue = jest.fn();
    manager._updateUndoRedoButtons = jest.fn();
    manager.refreshSavedQueueList = jest.fn();
    manager.loadSavedQueue = jest.fn();

    manager.openTaskBuilder();
    expect(elements['task-library-view'].hidden).toBe(true);
    expect(elements['task-builder-view'].hidden).toBe(false);
    expect(elements['task-builder-title'].textContent).toBe('새 Task 만들기');
    expect(elements['action-queue-save-name'].value).toBe('');

    manager.closeTaskBuilder();
    expect(elements['task-library-view'].hidden).toBe(false);
    expect(elements['task-builder-view'].hidden).toBe(true);

    manager.openTaskBuilder('기본 - 도킹');
    expect(elements['task-builder-title'].textContent).toContain('기본 - 도킹');
    expect(manager.loadSavedQueue).toHaveBeenCalledWith('기본 - 도킹', { silent: true });
  });

  test('expands a floor conveyor command to the robot conveyor pair count', async () => {
    const { manager } = loadActionSender();
    const actions = [
      { action_type: 0x18, action_args: [3, 1], action_params: [], conveyorFloor: 1 },
      { action_type: 0x18, action_args: [6, 2], action_params: [], conveyorFloor: 2 }
    ];

    const prepared = await manager._prepareActionsForSlot(actions, {
      robotId: 'R_002',
      ros: {},
      conveyorCount: 2
    });

    expect(prepared[0].action_args).toEqual([3, 1, 0, 0]);
    expect(prepared[1].action_args).toEqual([0, 0, 6, 1]);
    expect(prepared[0].conveyorFloor).toBeUndefined();
  });

  test('blocks a second-floor command on a one-conveyor robot', async () => {
    const { manager } = loadActionSender();

    await expect(manager._prepareActionsForSlot([
      { action_type: 0x18, action_args: [3, 2], conveyorFloor: 2 }
    ], {
      robotId: 'R_001',
      ros: {},
      conveyorCount: 1
    })).rejects.toThrow('2층을 구동할 수 없습니다');
  });

  test('serializes tasks using the ROS rviz YAML task structure', () => {
    const { manager } = loadActionSender();
    const yaml = manager.serializeTaskYaml([{
      taskId: 'Dock Test',
      loopFlag: 2,
      queue: [{
        name: 'dock',
        actionType: '0x08',
        args: [0, 1, 7, 1],
        params: [
          { param_name: 'dock_dist', type: 'float', value: '0.2' },
          { param_name: 'dock_dist_flag', type: 'bool', value: 'false' }
        ]
      }]
    }]);

    expect(yaml).toContain('- task_id: "Dock Test"');
    expect(yaml).toContain('  loop_flag: 2');
    expect(yaml).toContain('    - mission_id: 1');
    expect(yaml).toContain('          action_type: 8');
    expect(yaml).toContain('          action_args: [0, 1, 7, 1]');
    expect(yaml).toContain('            - [dock_dist, float, 0.2]');
    expect(yaml).toContain('            - [dock_dist_flag, bool, false]');
  });

  test('serializes several Tasks into one YAML document', () => {
    const { manager } = loadActionSender();
    const yaml = manager.serializeTaskYaml([
      {
        taskId: 'move',
        loopFlag: 1,
        queue: [{ name: 'wp', actionType: '0x01', args: [1, 2, 3], params: [] }]
      },
      {
        taskId: 'wait',
        loopFlag: 2,
        queue: [{ name: 'standby', actionType: '0x07', args: [5], params: [] }]
      }
    ]);

    expect(yaml.match(/^- task_id:/gm)).toHaveLength(2);
    expect(yaml).toContain('- task_id: move');
    expect(yaml).toContain('- task_id: wait');
  });

  test('imports multiple missions from an rviz YAML task as one ordered task queue', () => {
    const { manager } = loadActionSender();
    const yaml = `
- task_id: sample_task
  loop_flag: 3
  missions:
    - mission_id: first
      actions:
        - action_id: waypoint
          action_type: 1
          action_args: [1.2, -0.5, 3.14]
          action_params:
            - [max_trans_vel, float, 0.7]
    - mission_id: second
      actions:
        - action_id: standby
          action_type: 7
          action_args: [5]
          action_params:
            []
`;

    const tasks = manager.parseTaskYaml(yaml);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].taskId).toBe('sample_task');
    expect(tasks[0].loopFlag).toBe(3);
    expect(tasks[0].queue).toHaveLength(2);
    expect(tasks[0].queue[0].actionType).toBe('0x01');
    expect(tasks[0].queue[0].missionId).toBe('first');
    expect(tasks[0].queue[0].missionIndex).toBe(0);
    expect(tasks[0].queue[0].params[0]).toEqual({
      param_name: 'max_trans_vel',
      type: 'float',
      value: '0.7'
    });
    expect(tasks[0].queue[1].args).toEqual([5]);
    expect(tasks[0].queue[1].missionId).toBe('second');
    expect(tasks[0].queue[1].missionIndex).toBe(1);

    const roundTrip = manager.serializeTaskYaml(tasks);
    expect(roundTrip).toContain('    - mission_id: first');
    expect(roundTrip).toContain('    - mission_id: second');
  });

  test('groups imported Tasks by YAML filename without mixing local Tasks', () => {
    const { manager } = loadActionSender({
      local_task: { queue: [{ actionType: '0x07', args: [1] }] },
      first: {
        yamlTaskId: 'move_a',
        importedFrom: 'factory.yaml',
        queue: [{ actionType: '0x01', args: [1, 2, 3] }]
      },
      second: {
        yamlTaskId: 'move_b',
        importedFrom: 'factory.yaml',
        queue: [{ actionType: '0x01', args: [4, 5, 6] }]
      },
      other: {
        yamlTaskId: 'dock',
        importedFrom: 'dock.yaml',
        queue: [{ actionType: '0x08', args: [0, 1, 7, 1] }]
      }
    });

    manager._activeTaskSource = 'factory.yaml';
    expect(Array.from(manager._getVisibleTaskKeys())).toEqual(['first', 'second']);

    manager._activeTaskSource = manager.LOCAL_TASK_SOURCE;
    expect(Array.from(manager._getVisibleTaskKeys())).toEqual(['local_task']);
  });

  test('copies a Task inside the same YAML file with an independent Action queue', () => {
    const { manager, storage } = loadActionSender({
      original: {
        yamlTaskId: 'move',
        importedFrom: 'factory.yaml',
        queue: [{ name: 'wp', actionType: '0x01', args: [1, 2, 3], params: [] }],
        loopFlag: 2,
        builtin: true,
        builtinVersion: 3
      }
    });

    const copiedKey = manager.duplicateSavedQueue('original');
    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));

    expect(copiedKey).toBe('move_copy');
    expect(saved[copiedKey].yamlTaskId).toBe('move_copy');
    expect(saved[copiedKey].importedFrom).toBe('factory.yaml');
    expect(saved[copiedKey].loopFlag).toBe(2);
    expect(saved[copiedKey].builtin).toBe(false);
    expect(saved[copiedKey].builtinVersion).toBeUndefined();
    expect(saved[copiedKey].queue).toEqual(saved.original.queue);
    expect(saved[copiedKey].queue).not.toBe(saved.original.queue);
  });

  test('copies an Action directly after its source and gives it a unique action_id', () => {
    const { manager } = loadActionSender();
    manager.actionQueue = [
      { name: 'move', actionType: '0x01', args: [1, 2, 3], params: [] },
      { name: 'move_copy', actionType: '0x07', args: [5], params: [] }
    ];
    manager.renderQueue = jest.fn();

    manager.duplicateAction(0);

    expect(manager.actionQueue).toHaveLength(3);
    expect(manager.actionQueue[1].name).toBe('move_copy2');
    expect(manager.actionQueue[1].args).toEqual([1, 2, 3]);
    expect(manager.actionQueue[1]).not.toBe(manager.actionQueue[0]);
    expect(manager.renderQueue).toHaveBeenCalled();
  });

  test('compiles a Quick Task with WayPoint, Trajectory, Standby, and docking start', () => {
    const { manager } = loadActionSender();
    const actions = manager.compileQuickTaskItems([
      { kind: 'waypoint', pose: { x: 1, y: 2, theta: 0.1 } },
      {
        kind: 'trajectory',
        points: [
          { x: 2, y: 3, theta: 0 },
          { x: 4, y: 5, theta: 1.57 }
        ],
        trajectory: {
          laneName: 'quick_lane',
          maxTransVel: 0.8,
          laneType: 1,
          laneDirection: 3
        }
      },
      { kind: 'standby', duration: 4.5 },
      {
        kind: 'docking',
        pose: { x: 6, y: 7, theta: 3.14 },
        docking: { isCharge: 1, direction: -1, scanType: 2, endCondition: 3 }
      }
    ]);

    expect(actions.map(action => action.actionType)).toEqual([
      '0x01', '0x15', '0x07', '0x01', '0x08'
    ]);
    expect(actions[1].args).toEqual([2, 3, 4, 5, 1.57]);
    expect(actions[1].params.find(param => param.param_name === 'lane_name').value)
      .toBe('quick_lane');
    expect(actions[1].params.find(param => param.param_name === 'backward_driving').value)
      .toBe('true');
    expect(actions[2].args).toEqual([4.5]);
    expect(actions[3].name).toBe('Dock_Start_1');
    expect(actions[3].args).toEqual([6, 7, 3.14]);
    expect(actions[4].args).toEqual([1, -1, 2, 3]);
    expect(actions.every(action => action.missionId === 'quick_mission')).toBe(true);

    const yaml = manager.serializeTaskYaml([{
      taskId: 'quick_route',
      loopFlag: 1,
      queue: actions
    }]);
    expect(yaml).toContain('          action_type: 21');
    expect(yaml).toContain('          action_args: [2, 3, 4, 5, 1.57]');
  });

  test('labels every Trajectory coordinate pair and the final theta in Task details', () => {
    const { manager } = loadActionSender({
      trajectory: {
        queue: [{
          name: 'route',
          actionType: '0x15',
          args: [1, 2, 3, 4, 1.57],
          params: []
        }]
      }
    });

    const args = manager.getTaskDetailModel('trajectory').actions[0].args;

    expect(args.map(arg => arg.name)).toEqual(['x0', 'y0', 'x1', 'y1', 'theta']);
    expect(args.at(-1)).toEqual({
      name: 'theta',
      label: '최종 방향',
      value: 1.57
    });
  });

  test('saves and immediately runs a Quick Task on the active connected robot', async () => {
    const { manager, context } = loadActionSender();
    context.App.robotSlots = [{ robotId: 'R_051', connected: true, ros: {} }];
    manager.getTargetSlot = jest.fn(() => 0);
    manager.finishQuickTask = jest.fn(() => true);
    manager.runSavedTask = jest.fn().mockResolvedValue();
    context.document.getElementById.mockImplementation(id =>
      id === 'action-queue-load-select' ? { value: 'quick_route' } : null
    );
    const button = {};

    await manager.saveAndRunQuickTask(button);

    expect(manager.finishQuickTask).toHaveBeenCalledWith(true);
    expect(manager.runSavedTask).toHaveBeenCalledWith('quick_route', button);
  });

  test('imports every Task from one YAML file as one selectable file collection', () => {
    const { manager, storage, context } = loadActionSender();
    const elements = {
      'action-queue-save-name': { value: '' },
      'action-work-id': { value: '' },
      'action-loop-count': { value: '' },
      'action-queue-load-select': { value: '' }
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    context.confirm = jest.fn(() => true);
    context.FileReader = class {
      readAsText(file) {
        this.onload({ target: { result: file.contents } });
      }
    };
    manager._saveSnapshot = jest.fn();
    manager.renderQueue = jest.fn();
    manager.refreshSavedQueueList = jest.fn();
    manager.renderTaskDetail = jest.fn();
    manager._notifyTaskStoreChanged = jest.fn();

    manager.importMission({
      name: 'factory.yaml',
      contents: `
- task_id: move
  loop_flag: 1
  missions:
    - mission_id: nav
      actions:
        - action_id: wp
          action_type: 1
          action_args: [1, 2, 3]
          action_params:
            []
- task_id: wait
  loop_flag: 2
  missions:
    - mission_id: work
      actions:
        - action_id: standby
          action_type: 7
          action_args: [5]
          action_params:
            []
`
    });

    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));
    const imported = Object.values(saved).filter(entry => entry.importedFrom === 'factory.yaml');
    expect(imported).toHaveLength(2);
    expect(imported.map(entry => entry.yamlTaskId)).toEqual(['move', 'wait']);
    expect(imported[0].queue[0].missionId).toBe('nav');
    expect(manager._activeTaskSource).toBe('factory.yaml');
    expect(storage.get(manager.TASK_FILE_SELECTION_KEY)).toBe('factory.yaml');
  });

  test('resolves docking cfg model from the active robot ROS namespace', async () => {
    const { manager } = loadActionSender();
    manager._readRosParam = jest.fn(async (_ros, name) =>
      name === '/R_051/robot_type' ? 'sl3000_mspe' : undefined
    );
    const slot = { robotId: 'R_051', ros: {} };

    await expect(manager._resolveDockingRobotType(slot)).resolves.toBe('sl3000_mspe');
    expect(slot.robotType).toBe('sl3000_mspe');
  });

  test('lists only cfg files from the current robot model directory', async () => {
    const { manager, context } = loadActionSender();
    context.FileTransfer = {
      sessionId: 'sftp-current-robot',
      ensureConnection: jest.fn(async () => ({ success: true }))
    };
    context.fetchWithTimeout = jest.fn()
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          stdout: '/home/syscon\n'
        })
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          files: [
            { name: 'docking_common.cfg', isDirectory: false },
            { name: 'docking_direct.cfg', isDirectory: false },
            { name: 'notes.txt', isDirectory: false },
            { name: 'archive.cfg', isDirectory: true }
          ]
        })
      });

    const result = await manager._fetchDockingCfgFiles(
      { ip: '192.168.20.51', robotId: 'R_051' }
    );

    expect(manager.DOCKING_TARGET_CFG_MODEL).toBe('sl400_vri');
    expect(Array.from(result.files)).toEqual(['docking_common.cfg', 'docking_direct.cfg']);
    expect(result.path).toBe(
      '/home/syscon/catkin_ws/src/ros_parameters_group/param/sl400_vri/docking/cfg'
    );
    const homeRequest = JSON.parse(context.fetchWithTimeout.mock.calls[0][1].body);
    expect(homeRequest.command).toContain('$HOME');
    const listRequest = JSON.parse(context.fetchWithTimeout.mock.calls[1][1].body);
    expect(listRequest.remotePath).toBe(
      '/home/syscon/catkin_ws/src/ros_parameters_group/param/sl400_vri/docking/cfg'
    );
  });

  test('loads the complete selectable cfg list from the core_docking detail path', async () => {
    const { manager, context } = loadActionSender();
    context.FileTransfer = {
      sessionId: 'sftp-current-robot',
      ensureConnection: jest.fn(async () => ({ success: true }))
    };
    context.fetchWithTimeout = jest.fn()
      .mockResolvedValueOnce({
        json: async () => ({ success: true, stdout: '/home/syscon\n' })
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          files: [
            { name: 'docking_direct.cfg', isDirectory: false },
            { name: 'docking_rack.cfg', isDirectory: false },
            { name: 'README.md', isDirectory: false }
          ]
        })
      });

    const result = await manager._fetchDockingCoreCfgFiles({
      ip: '192.168.20.51',
      robotId: 'R_051'
    });

    expect(Array.from(result.files)).toEqual(['docking_direct.cfg', 'docking_rack.cfg']);
    expect(result.path).toBe(
      '/home/syscon/catkin_ws/src/core_docking/sp2_docking/src/sp2_docking/cfg'
    );
    const request = JSON.parse(context.fetchWithTimeout.mock.calls[1][1].body);
    expect(request.remotePath).toBe(
      '/home/syscon/catkin_ws/src/core_docking/sp2_docking/src/sp2_docking/cfg'
    );
  });
});
