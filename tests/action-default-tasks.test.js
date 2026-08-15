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
  const session = new Map();
  const context = {
    App: { toast: jest.fn(), setButtonLoading: jest.fn() },
    ROSLIB: {},
    localStorage: {
      getItem: jest.fn(key => storage.has(key) ? storage.get(key) : null),
      setItem: jest.fn((key, value) => storage.set(key, String(value)))
    },
    sessionStorage: {
      getItem: jest.fn(key => session.has(key) ? session.get(key) : null),
      setItem: jest.fn((key, value) => session.set(key, String(value)))
    },
    document: {
      addEventListener: jest.fn(),
      getElementById: jest.fn(() => null)
    },
    window: {},
    confirm: jest.fn(() => true),
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__ActionSender = ActionSender;`, context);
  return { manager: context.__ActionSender, storage, session, context };
}

describe('built-in single-action tasks', () => {
  test('does not leave the current Docking step when its value is invalid', () => {
    const { manager } = loadActionSender();
    manager._quickDockWizard = { index: 2 };
    manager._saveQuickDockWizardValue = jest.fn(() => false);
    manager._renderQuickDockWizard = jest.fn();

    manager._backQuickDockWizard();

    expect(manager._quickDockWizard.index).toBe(2);
    expect(manager._renderQuickDockWizard).not.toHaveBeenCalled();
  });

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

  test('preserves purpose-specific values saved on a customized built-in task', () => {
    const customized = {
      '기본 - WayPoint': {
        queue: [{
          name: '기본 - WayPoint',
          actionType: '0x01',
          args: [12.5, -3, 90],
          params: [{ param_name: 'avoid_mode', type: 'bool', value: 'true' }]
        }],
        loopFlag: 4,
        builtin: true,
        builtinVersion: 2,
        builtinCustomized: true
      }
    };
    const { manager, storage } = loadActionSender(customized);

    expect(manager.ensureDefaultTasks()).toBe(7);
    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));

    expect(saved['기본 - WayPoint'].queue[0].args).toEqual([12.5, -3, 90]);
    expect(saved['기본 - WayPoint'].loopFlag).toBe(4);
    expect(saved['기본 - WayPoint'].builtinCustomized).toBe(true);
  });

  test('restores a customized built-in task to its recommended defaults', () => {
    const customized = {
      '기본 - Standby': {
        queue: [{ name: '기본 - Standby', actionType: '0x07', args: [99], params: [] }],
        loopFlag: 8,
        builtin: true,
        builtinVersion: 3,
        builtinCustomized: true
      }
    };
    const { manager, storage } = loadActionSender(customized);
    manager.refreshSavedQueueList = jest.fn();
    manager._notifyTaskStoreChanged = jest.fn();

    expect(manager.resetDefaultTask('기본 - Standby', false)).toBe(true);
    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));

    expect(saved['기본 - Standby'].queue[0].args).toEqual([5]);
    expect(saved['기본 - Standby'].loopFlag).toBe(1);
    expect(saved['기본 - Standby'].builtinCustomized).toBe(false);
  });

  test('saves built-in arguments, parameters, common options and loop locally', () => {
    const initial = {
      '기본 - WayPoint': {
        queue: [{
          name: '기본 - WayPoint',
          actionType: '0x01',
          args: [0, 0, 0],
          params: []
        }],
        loopFlag: 1,
        builtin: true,
        builtinVersion: 3
      }
    };
    const { manager, storage, context } = loadActionSender(initial);
    const controls = {
      args: [
        { value: '4.5', dataset: { index: '0' } },
        { value: '-2', dataset: { index: '1' } },
        { value: '90', dataset: { index: '2' } }
      ],
      params: [
        {
          value: 'true',
          dataset: { name: 'avoid_mode', type: 'bool', index: '0' }
        }
      ],
      common: [
        {
          value: 'true',
          dataset: { name: 'common/obstacle_enabled', type: 'bool', index: '2' }
        }
      ],
      loop: { value: '3', dataset: { builtinKind: 'loop' } }
    };
    const body = {
      querySelectorAll: jest.fn(selector => ({
        '[data-builtin-kind="arg"]': controls.args,
        '[data-builtin-kind="param"]': controls.params,
        '[data-builtin-kind="common"]': controls.common
      })[selector] || []),
      querySelector: jest.fn(selector =>
        selector === '[data-builtin-kind="loop"]' ? controls.loop : null
      )
    };
    context.document.getElementById.mockImplementation(id =>
      id === 'builtin-task-settings-body' ? body : null
    );
    manager._editingBuiltinTaskName = '기본 - WayPoint';
    manager.refreshSavedQueueList = jest.fn();
    manager._notifyTaskStoreChanged = jest.fn();
    manager.closeBuiltinTaskSettings = jest.fn();

    expect(manager.saveBuiltinTaskSettings()).toBe(true);
    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));
    const entry = saved['기본 - WayPoint'];

    expect(entry.queue[0].args).toEqual([4.5, -2, 90]);
    expect(entry.queue[0].params).toEqual([
      { param_name: 'avoid_mode', type: 'bool', value: 'true' },
      { param_name: 'common/obstacle_enabled', type: 'bool', value: 'true' }
    ]);
    expect(entry.loopFlag).toBe(3);
    expect(entry.builtinCustomized).toBe(true);
    expect(manager.closeBuiltinTaskSettings).toHaveBeenCalledTimes(1);
  });

  test('separates built-in and user Task controls in the Task library', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'),
      'utf8'
    );
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'action-sender.js'),
      'utf8'
    );

    [
      'builtin-task-toggle',
      'builtin-task-grid',
      'user-task-count',
      'builtin-task-settings-modal',
      'btn-builtin-task-settings-save',
      'btn-builtin-task-settings-reset'
    ].forEach(id => expect(html).toContain(`id="${id}"`));
    expect(source).toContain("BUILTIN_TASK_PANEL_KEY: 'actionSenderBuiltinTaskPanelOpen'");
    expect(source).toContain('openBuiltinTaskSettings(name)');
    expect(source).toContain('saveBuiltinTaskSettings()');
    expect(source).toContain('builtinCustomized: true');
    expect(source).toContain("builtinSection ? '용도별 설정' : '수정'");
    expect(source).toContain("builtinSection ? '내 Task로 복사' : '복사'");
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

    expect(html).toContain('id="btn-global-quick-task"');
    expect(html).toContain('class="header-primary-quick-task"');
    expect(html).toContain('id="btn-quick-task" class="btn quick-task-launch"');
    expect(html).toContain('⚡ QUICK TASK 생성');
    expect(html).toContain('id="recent-task-runs"');
    expect(html).toContain('id="recent-task-runs-list"');
    expect(html).toContain('직전에 실행한 Task 3개');
    expect(html).toContain('id="task-info-mini"');
    expect(html).toContain('id="btn-task-info-mini-open"');
    expect(html).toContain('id="btn-quick-task"');
    expect(html).toContain('id="btn-quick-waypoint"');
    expect(html).toContain('id="btn-quick-trajectory"');
    expect(html).toContain('id="btn-quick-docking"');
    expect(html).toContain('id="btn-quick-standby"');
    expect(html).toContain('id="quick-terminal-action-modal"');
    expect(html).toContain('id="btn-quick-terminal-none"');
    expect(html).toContain('id="btn-quick-terminal-docking"');
    expect(html).toContain('id="btn-quick-terminal-docking-out"');
    expect(html).toContain('id="btn-quick-terminal-standby"');
    expect(html).toContain('id="quick-task-map-hud"');
    expect(html).toContain('id="btn-run-quick-task"');
    expect(html).toContain('class="btn quick-task-run quick-task-run-primary"');
    expect(html).toContain('>저장 후 실행</button>');
    expect(source).toContain("document.getElementById('btn-global-quick-task')");
    expect(source).toContain('duplicateSavedQueue(name)');
    expect(source).toContain('duplicateAction(index)');
  });

  test('minimizes running Task Info into a live compact window', () => {
    const { manager, context } = loadActionSender();
    context.App.activeSlotIndex = 0;
    context.App.robotSlots = [{ robotId: 'R_001', connected: true, ros: {} }];
    const modalClasses = new Set(['show']);
    const elements = {
      'task-info-modal': {
        classList: {
          contains: jest.fn(name => modalClasses.has(name)),
          remove: jest.fn(name => modalClasses.delete(name))
        }
      },
      'task-info-mini': { hidden: true },
      'task-info-mini-title': { textContent: '' },
      'task-info-mini-robot': { textContent: '' },
      'task-info-mini-state': { textContent: '', dataset: {} },
      'task-info-mini-detail': { textContent: '' },
      'task-info-mini-progress-fill': { style: {} }
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    manager._runningTasks.set('R_001', {
      robotId: 'R_001',
      taskId: '현장 순찰',
      queue: [
        { name: 'go_1', actionType: '0x01', args: [1, 2, 0] },
        { name: 'wait', actionType: '0x07', args: [1] }
      ],
      loopFlag: 2,
      loopCount: 0,
      actionIndex: 0,
      state: 'work'
    });

    manager.closeTaskInfo();

    expect(elements['task-info-mini'].hidden).toBe(false);
    expect(elements['task-info-mini-title'].textContent).toBe('현장 순찰');
    expect(elements['task-info-mini-robot'].textContent).toContain('Action 1/2');
    expect(elements['task-info-mini-detail'].textContent).toContain('go_1');
    expect(elements['task-info-mini-progress-fill'].style.width).toBe('50.0%');

    manager._runningTasks.get('R_001').state = 'complete';
    manager._syncTaskInfoMiniWindow();
    expect(elements['task-info-mini'].hidden).toBe(true);
  });

  test('opens Quick Task from the global header without discarding an existing draft', () => {
    const { manager, context } = loadActionSender();
    const taskTabButton = { click: jest.fn() };
    const quickView = { hidden: false, scrollIntoView: jest.fn() };
    const mapPanel = {
      classList: { contains: jest.fn(() => false) }
    };
    context.document.querySelector = jest.fn(selector =>
      selector === '.tab-btn[data-tab="tab-action"]' ? taskTabButton : null
    );
    context.document.getElementById = jest.fn(id => ({
      'quick-task-builder-view': quickView,
      'panel-map': mapPanel
    })[id] || null);
    manager._builderMode = 'quick';
    manager.openQuickTaskBuilder = jest.fn();
    manager._setQuickTaskMapHudVisible = jest.fn();

    manager.openQuickTaskFromHeader();

    expect(taskTabButton.click).toHaveBeenCalledTimes(1);
    expect(manager.openQuickTaskBuilder).not.toHaveBeenCalled();
    expect(manager._setQuickTaskMapHudVisible).toHaveBeenCalledWith(true);
    expect(quickView.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  test('temporarily keeps exact snapshots of only the latest three Task runs', () => {
    const { manager, session } = loadActionSender();
    manager.renderRecentTaskRuns = jest.fn();
    const sourceEntry = {
      queue: [{ name: 'move', actionType: '0x01', args: [1, 2, 0] }],
      loopFlag: 2
    };

    for (let index = 1; index <= 4; index += 1) {
      manager._rememberRecentTaskRun({
        sourceQueue: `task_${index}`,
        taskId: `Task ${index}`,
        entry: sourceEntry,
        robotId: 'R_001',
        actionCount: 1,
        executedAt: 1000 + index
      });
    }
    sourceEntry.queue[0].args[0] = 99;

    expect(manager._recentTaskRuns).toHaveLength(3);
    expect(manager._recentTaskRuns.map(record => record.taskId)).toEqual([
      'Task 4',
      'Task 3',
      'Task 2'
    ]);
    expect(manager._recentTaskRuns[0].entry.queue[0].args[0]).toBe(1);
    expect(JSON.parse(session.get(manager.RECENT_TASK_RUNS_KEY))).toHaveLength(3);
  });

  test('replays a recent Task snapshot on the currently active robot', async () => {
    const { manager, context } = loadActionSender();
    const record = {
      id: 'recent-1',
      sourceQueue: 'patrol',
      taskId: '현장 순찰',
      robotId: 'R_001',
      actionCount: 2,
      entry: {
        queue: [
          { name: 'go', actionType: '0x01', args: [1, 2, 0] },
          { name: 'wait', actionType: '0x07', args: [1] }
        ],
        loopFlag: 2
      }
    };
    manager._recentTaskRuns = [record];
    context.App.robotSlots = [{ robotId: 'R_002', connected: true, ros: {} }];
    manager.getTargetSlot = jest.fn(() => 0);
    manager._setTaskExecutionFeedback = jest.fn();
    manager._sendQueueEntryToSlot = jest.fn(async () => ({
      robotId: 'R_002',
      actionCount: 2
    }));
    const button = { classList: { add: jest.fn(), remove: jest.fn() } };

    await expect(manager.replayRecentTask('recent-1', button)).resolves.toBe(true);

    expect(context.confirm).toHaveBeenCalledWith(expect.stringContaining('R_002'));
    expect(manager._sendQueueEntryToSlot).toHaveBeenCalledWith(
      record.entry,
      'patrol',
      0,
      2,
      '현장 순찰'
    );
    expect(context.App.toast).toHaveBeenCalledWith(
      expect.stringContaining('다시 실행 요청 완료'),
      'success'
    );
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

  test('Escape cancels Action edit first and then returns from Task edit to the list', () => {
    const { manager, context } = loadActionSender();
    const elements = {
      'task-builder-view': { hidden: false },
      'tab-action': { classList: { contains: jest.fn(() => true) } }
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    context.document.querySelector = jest.fn(() => null);
    manager._builderMode = 'edit';
    manager._editingActionIndex = 1;
    manager.renderQueue = jest.fn();
    manager._showEditorTaskPreview = jest.fn();
    manager._syncActionEditButtons = jest.fn();
    manager.closeTaskBuilder = jest.fn();

    const first = {
      key: 'Escape',
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn()
    };
    expect(manager._handleBuilderEscape(first)).toBe(true);
    expect(manager._editingActionIndex).toBe(-1);
    expect(manager.closeTaskBuilder).not.toHaveBeenCalled();

    const second = {
      key: 'Escape',
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn()
    };
    expect(manager._handleBuilderEscape(second)).toBe(true);
    expect(manager.closeTaskBuilder).toHaveBeenCalledTimes(1);
  });

  test('Escape cancels Quick Task and returns to its previous list screen', () => {
    const { manager, context } = loadActionSender();
    const elements = {
      'quick-task-builder-view': { hidden: false },
      'tab-action': { classList: { contains: jest.fn(() => true) } }
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    context.document.querySelector = jest.fn(() => null);
    manager._builderMode = 'quick';
    manager._quickTaskMode = '';
    manager.closeQuickTaskBuilder = jest.fn();
    const event = {
      key: 'Escape',
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn()
    };

    expect(manager._handleBuilderEscape(event)).toBe(true);
    expect(manager.closeQuickTaskBuilder).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
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

  test('round-trips the canonical wp1, wp2, docking, docking_out YAML form', () => {
    const { manager } = loadActionSender();
    const yaml = `
- task_id: WP_DOCKING_TASK
  loop_flag: 1
  missions:
    - mission_id: 1
      actions:
        - action_id: wp1
          action_type: 1
          action_args: [1.0, 2.0, 0.0]
          action_params:
            - [max_trans_vel, float, 0.7]
            - [prediction_horizon, int, 20]
        - action_id: wp2
          action_type: 1
          action_args: [3.0, 4.0, 1.57]
          action_params:
            - [max_trans_vel, float, 0.6]
            - [pause_on_qr_undetected, bool, false]
        - action_id: docking
          action_type: 8
          action_args: [0, 1, 7, 1]
          action_params:
            - [dock_dist, float, 0.2]
            - [dock_dist_flag, bool, false]
            - [target_id, string, "12,15"]
        - action_id: docking_out
          action_type: 16
          action_args: [-1.0]
          action_params:
            []
`;

    const imported = manager.parseTaskYaml(yaml);
    expect(imported).toHaveLength(1);
    expect(imported[0].queue.map(action => action.actionType)).toEqual([
      '0x01', '0x01', '0x08', '0x10'
    ]);
    expect(imported[0].queue[2].params[2]).toEqual({
      param_name: 'target_id',
      type: 'string',
      value: '12,15'
    });

    const exported = manager.serializeTaskYaml(imported);
    const reimported = manager.parseTaskYaml(exported);
    expect(reimported[0].taskId).toBe('WP_DOCKING_TASK');
    expect(reimported[0].queue.map(action => ({
      name: action.name,
      type: action.actionType,
      args: action.args,
      params: action.params,
      missionId: action.missionId
    }))).toEqual(imported[0].queue.map(action => ({
      name: action.name,
      type: action.actionType,
      args: action.args,
      params: action.params,
      missionId: action.missionId
    })));
  });

  const realTaskYamlPath = process.env.EASYLOOP_REAL_TASK_YAML ||
    path.join(process.env.HOME || '', 'ROS_DB', 'sp_task', 'rviz', 'task.yaml');
  const testRealTaskYaml = fs.existsSync(realTaskYamlPath) ? test : test.skip;

  testRealTaskYaml('round-trips the installed full task.yaml without semantic loss', () => {
    const { manager } = loadActionSender();
    const source = fs.readFileSync(realTaskYamlPath, 'utf8');
    const imported = manager.parseTaskYaml(source);

    expect(imported.length).toBeGreaterThan(0);
    expect(imported.reduce((count, task) => count + task.queue.length, 0)).toBeGreaterThan(0);

    const semanticShape = tasks => tasks.map(task => ({
      taskId: task.taskId,
      loopFlag: task.loopFlag,
      missionsEmpty: task.missionsEmpty,
      queue: task.queue.map(action => ({
        name: action.name,
        actionType: action.actionType,
        args: action.args,
        params: action.params,
        missionId: action.missionId,
        missionIndex: action.missionIndex
      }))
    }));

    const exported = manager.serializeTaskYaml(imported);
    const reimported = manager.parseTaskYaml(exported);

    expect(semanticShape(reimported)).toEqual(semanticShape(imported));
  });

  test('exposes every r51 registered action and the source-consumed detailed parameters', () => {
    const { manager } = loadActionSender();
    const r51Types = [
      '0x01', '0x02', '0x07', '0x08', '0x10', '0x15',
      '0x16', '0x17', '0x18', '0x19', '0x21', '0x22'
    ];
    r51Types.forEach(type => expect(manager.actionTypes[type]).toBeDefined());

    expect(manager.actionTypes['0x01'].params.map(param => param.name)).toEqual(
      expect.arrayContaining([
        'free_goal_vel', 'prediction_horizon', 'control_horizon',
        'qr_bottom_reading_mode', 'qr_target', 'pause_on_qr_undetected'
      ])
    );
    expect(manager.actionTypes['0x15'].params.map(param => param.name)).toEqual(
      expect.arrayContaining([
        'set_local_planner', 'model_type', 'motion_direction',
        'prediction_horizon', 'control_horizon', 'using_basic_footprint'
      ])
    );
    expect(manager.actionTypes['0x19'].params.map(param => param.name)).toContain('move_vel');
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

  test('saves only the selected Action immediately without saving the whole Task', () => {
    const original = {
      route: {
        yamlTaskId: 'route',
        queue: [
          {
            name: 'wp_1',
            actionType: '0x01',
            args: [1, 2, 0],
            params: [{ param_name: 'max_trans_vel', type: 'float', value: '0.3' }]
          },
          {
            name: 'wp_2',
            actionType: '0x01',
            args: [3, 4, 1],
            params: [{ param_name: 'max_trans_vel', type: 'float', value: '0.4' }]
          }
        ]
      }
    };
    const { manager, storage } = loadActionSender(original);
    manager.actionQueue = JSON.parse(JSON.stringify(original.route.queue));
    manager._editingTaskName = 'route';
    manager._editingActionIndex = 0;
    manager.readCurrentAction = jest.fn(() => ({
      actionType: '0x01',
      args: [1.5, 2.5, 0.2],
      params: [{ param_name: 'max_trans_vel', type: 'float', value: '0.9' }]
    }));
    manager.renderQueue = jest.fn();
    manager.refreshSavedQueueList = jest.fn();
    manager._notifyTaskStoreChanged = jest.fn();

    expect(manager.saveSelectedAction()).toBe(true);
    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));
    expect(saved.route.queue[0].args).toEqual([1.5, 2.5, 0.2]);
    expect(saved.route.queue[0].params[0].value).toBe('0.9');
    expect(saved.route.queue[1]).toEqual(original.route.queue[1]);
  });

  test('detects only real differences from the selected Action original', () => {
    const { manager } = loadActionSender();
    const original = {
      name: 'wp_1',
      actionType: '0x01',
      args: [1, 2, 0],
      params: [
        { param_name: 'max_trans_vel', type: 'float', value: '0.3' },
        { param_name: 'vendor_hidden', type: 'string', value: 'keep' }
      ],
      summary: 'old summary'
    };
    manager.actionQueue = [original];
    manager._editingActionIndex = 0;

    expect(manager._hasSelectedActionChanges({
      actionType: '0x01',
      args: [1, 2, 0],
      params: [{ param_name: 'max_trans_vel', type: 'float', value: '0.3' }]
    })).toBe(false);
    expect(manager._hasSelectedActionChanges({
      actionType: '0x01',
      args: [1, 2, 0],
      params: [{ param_name: 'max_trans_vel', type: 'float', value: '0.8' }]
    })).toBe(true);
  });

  test('applies parameters only to selected Actions with the same action_type', () => {
    const original = {
      route: {
        yamlTaskId: 'route',
        queue: [
          {
            name: 'wp_1',
            actionType: '0x01',
            args: [1, 2, 0],
            params: [{ param_name: 'max_trans_vel', type: 'float', value: '0.3' }]
          },
          {
            name: 'wait',
            actionType: '0x07',
            args: [5],
            params: [{ param_name: 'id', type: 'string', value: 'keep' }]
          },
          {
            name: 'wp_2',
            actionType: '0x01',
            args: [8, 9, 1],
            params: [{ param_name: 'max_trans_vel', type: 'float', value: '0.4' }]
          },
          {
            name: 'wp_3',
            actionType: '0x01',
            args: [10, 11, 2],
            params: [{ param_name: 'max_trans_vel', type: 'float', value: '0.5' }]
          }
        ]
      }
    };
    const { manager, storage } = loadActionSender(original);
    manager.actionQueue = JSON.parse(JSON.stringify(original.route.queue));
    manager._editingTaskName = 'route';
    manager._editingActionIndex = 0;
    manager.readCurrentAction = jest.fn(() => ({
      actionType: '0x01',
      args: [1, 2, 0],
      params: [
        { param_name: 'max_trans_vel', type: 'float', value: '1.1' },
        { param_name: 'passing_dist', type: 'float', value: '0.5' }
      ]
    }));
    manager.renderQueue = jest.fn();
    manager.refreshSavedQueueList = jest.fn();
    manager._notifyTaskStoreChanged = jest.fn();

    expect(manager.applyParamsToSameType([2])).toBe(true);
    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));
    expect(saved.route.queue[2].args).toEqual([8, 9, 1]);
    expect(saved.route.queue[2].params).toEqual(saved.route.queue[0].params);
    expect(saved.route.queue[1]).toEqual(original.route.queue[1]);
    expect(saved.route.queue[3]).toEqual(original.route.queue[3]);
    expect(manager._hasSelectedActionChanges(manager.readCurrentAction())).toBe(false);
    expect(manager.applyParamsToSameType([1])).toBe(false);
  });

  test('provides a checkbox target modal and highlighted dirty Action button', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'),
      'utf8'
    );
    const style = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'css', 'style.css'),
      'utf8'
    );

    expect(html).toContain('id="action-param-target-modal"');
    expect(html).toContain('id="action-param-target-list"');
    expect(html).toContain('id="btn-action-param-target-apply"');
    expect(style).toContain('#btn-save-selected-action.action-save-dirty');
    expect(style).toContain('.action-param-target-item:has(input:checked)');
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

  test('simplifies a freehand curve into a bounded TrajectoryFollowing action', () => {
    const { manager, context } = loadActionSender();
    context.document.getElementById.mockImplementation(id =>
      id === 'quick-freehand-spacing' ? { value: '0.2' } : null
    );
    const raw = Array.from({ length: 401 }, (_, index) => {
      const x = index / 100;
      return { x, y: Math.sin(x * Math.PI) * 0.7 };
    });

    const trajectory = manager._prepareFreehandTrajectory(raw);
    const [action] = manager.compileQuickTaskItems([{
      kind: 'trajectory',
      points: trajectory.points,
      trajectory: { laneName: 'drawn_curve', maxTransVel: 0.6, laneType: 1, laneDirection: 0 },
      source: 'freehand'
    }]);

    expect(trajectory.points.length).toBeGreaterThan(10);
    expect(trajectory.points.length).toBeLessThanOrEqual(120);
    expect(trajectory.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(trajectory.points.at(-1).x).toBe(4);
    expect(action.actionType).toBe('0x15');
    expect(action.args).toHaveLength(trajectory.points.length * 2 + 1);
    expect(action.params.find(param => param.param_name === 'lane_name').value)
      .toBe('drawn_curve');
  });

  test('freehand capture creates one trajectory item when drawing ends', () => {
    const { manager, context } = loadActionSender();
    let freehandOptions;
    const elements = {
      'quick-task-builder-view': { hidden: false },
      'tab-action': { classList: { contains: jest.fn(() => true) } },
      'quick-freehand-spacing': { value: '0.25' }
    };
    context.RosManager = {
      lastMapMsg: {},
      _enterFreehandPathMode: jest.fn(options => { freehandOptions = options; }),
      _exitFreehandPathMode: jest.fn(),
      _exitWaypointSelectMode: jest.fn(),
      setQuickTaskOverlay: jest.fn()
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    manager._builderMode = 'quick';
    manager.renderQuickTask = jest.fn();

    manager.startQuickFreehandCapture();
    freehandOptions.onUpdate([{ x: 0, y: 0 }, { x: 0.3, y: 0.2 }]);
    freehandOptions.onComplete([
      { x: 0, y: 0 },
      { x: 0.3, y: 0.2 },
      { x: 0.7, y: -0.1 },
      { x: 1.1, y: 0.1 }
    ]);

    expect(manager._quickTaskMode).toBe('');
    expect(manager._quickTaskItems).toHaveLength(1);
    expect(manager._quickTaskItems[0]).toMatchObject({
      kind: 'trajectory',
      source: 'freehand'
    });
    expect(manager._quickTerminalActionContext.label).toContain('곡선 Trajectory');
    expect(manager.compileQuickTaskItems()[0].actionType).toBe('0x15');
  });

  test('finishes continuous WayPoint input and allows no terminal Action', () => {
    const { manager, context } = loadActionSender();
    const modalClasses = new Set();
    const elements = {
      'quick-terminal-action-modal': {
        classList: {
          add: jest.fn(name => modalClasses.add(name)),
          remove: jest.fn(name => modalClasses.delete(name))
        }
      },
      'quick-terminal-action-context': { textContent: '' },
      'btn-quick-terminal-none': { focus: jest.fn() }
    };
    context.RosManager = {
      _exitWaypointSelectMode: jest.fn(),
      _exitFreehandPathMode: jest.fn()
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    manager._quickTaskItems = [
      { kind: 'waypoint', pose: { x: 1, y: 2, theta: 0.1 } },
      { kind: 'waypoint', pose: { x: 3, y: 4, theta: 0.2 } }
    ];
    manager._quickTaskMode = 'waypoint';
    manager._quickDriveCaptureStartIndex = 0;

    expect(manager.finishQuickDrivingInput()).toBe(true);
    expect(modalClasses.has('show')).toBe(true);
    expect(elements['quick-terminal-action-context'].textContent).toContain('WayPoint 2개');

    expect(manager._selectQuickTerminalAction('none')).toBe(true);
    expect(modalClasses.has('show')).toBe(false);
    expect(manager._quickTaskItems).toHaveLength(2);
    expect(manager._quickTerminalActionContext).toBeNull();
  });

  test('appends selected Standby after a finished Trajectory', () => {
    const { manager, context } = loadActionSender();
    const modal = {
      classList: {
        add: jest.fn(),
        remove: jest.fn()
      }
    };
    const elements = {
      'quick-terminal-action-modal': modal,
      'quick-terminal-action-context': { textContent: '' },
      'btn-quick-terminal-none': { focus: jest.fn() },
      'quick-trajectory-lane': { value: 'terminal_test' },
      'quick-trajectory-velocity': { value: '0.6' },
      'quick-trajectory-lane-type': { value: '1' },
      'quick-trajectory-direction': { value: '0' },
      'quick-standby-duration': { value: '7.5' }
    };
    context.RosManager = {
      _exitWaypointSelectMode: jest.fn(),
      _exitFreehandPathMode: jest.fn()
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    manager.renderQuickTask = jest.fn();
    manager._quickTaskMode = 'trajectory';
    manager._quickTrajectoryDraft = [
      { x: 0, y: 0, theta: 0 },
      { x: 2, y: 1, theta: 0.4 }
    ];

    expect(manager.finishQuickDrivingInput()).toBe(true);
    expect(manager._quickTaskItems.map(item => item.kind)).toEqual(['trajectory']);
    expect(manager._selectQuickTerminalAction('standby')).toBe(true);
    expect(manager._quickTaskItems.map(item => item.kind)).toEqual(['trajectory', 'standby']);
    expect(manager._quickTaskItems[1].duration).toBe(7.5);
    expect(manager.compileQuickTaskItems().map(action => action.actionType))
      .toEqual(['0x15', '0x07']);
  });

  test('appends terminal Docking directly without forcing another map WayPoint', () => {
    const { manager, context } = loadActionSender();
    context.document.getElementById.mockImplementation(id =>
      id === 'quick-terminal-action-modal'
        ? { classList: { remove: jest.fn() } }
        : null
    );
    manager._quickTerminalActionContext = { label: 'WayPoint 1개' };
    manager.addQuickDocking = jest.fn(() => true);

    expect(manager._selectQuickTerminalAction('docking')).toBe(true);
    expect(manager.addQuickDocking).toHaveBeenCalledWith('WayPoint 1개');
    expect(manager._quickTerminalActionContext).toBeNull();
  });

  test('appends selected DockingOut as the final Action', () => {
    const { manager, context } = loadActionSender();
    const elements = {
      'quick-terminal-action-modal': { classList: { remove: jest.fn() } },
      'quick-docking-out-distance': { value: '-1.25' }
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    manager.renderQuickTask = jest.fn();
    manager._quickTaskItems = [
      { kind: 'waypoint', pose: { x: 1, y: 2, theta: 0 } }
    ];
    manager._quickTerminalActionContext = { label: 'WayPoint 1개' };

    expect(manager._selectQuickTerminalAction('docking-out')).toBe(true);
    expect(manager._quickTaskItems.at(-1)).toEqual({
      kind: 'docking-out',
      distance: -1.25
    });
    expect(manager.compileQuickTaskItems().map(action => action.actionType))
      .toEqual(['0x01', '0x10']);
  });

  test('keeps WayPoint capture active until another Quick Task tool is selected', () => {
    const { manager, context } = loadActionSender();
    let capture;
    const exitWaypointSelectMode = jest.fn();
    const elements = {
      'quick-task-builder-view': { hidden: false },
      'tab-action': { classList: { contains: jest.fn(() => true) } }
    };
    context.RosManager = {
      lastMapMsg: {},
      _enterWaypointSelectMode: jest.fn(callback => {
        capture = callback;
      }),
      _exitWaypointSelectMode: exitWaypointSelectMode
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    manager._builderMode = 'quick';
    manager.renderQuickTask = jest.fn();

    manager.startQuickMapCapture('waypoint');
    exitWaypointSelectMode.mockClear();
    capture(1, 2, 0.1);
    capture(3, 4, 0.2);

    expect(manager._quickTaskItems).toHaveLength(2);
    expect(manager._quickTaskItems.map(item => item.pose)).toEqual([
      { x: 1, y: 2, theta: 0.1 },
      { x: 3, y: 4, theta: 0.2 }
    ]);
    expect(manager._quickTaskMode).toBe('waypoint');
    expect(exitWaypointSelectMode).not.toHaveBeenCalled();
    expect(context.RosManager._enterWaypointSelectMode).toHaveBeenCalledTimes(1);

    manager.startQuickMapCapture('docking');

    expect(exitWaypointSelectMode).toHaveBeenCalledTimes(1);
    expect(manager._quickTaskMode).toBe('docking');
  });

  test('Quick Task preserves every Action shortcut and adds authoring shortcuts', () => {
    const { manager, context } = loadActionSender();
    const buttons = {
      'btn-quick-waypoint': { click: jest.fn() },
      'btn-quick-trajectory': { click: jest.fn() },
      'btn-quick-freehand': { click: jest.fn() },
      'btn-quick-docking': { click: jest.fn() },
      'btn-quick-docking-inline': { click: jest.fn() },
      'btn-quick-docking-out': { click: jest.fn() },
      'btn-quick-docking-out-map': { click: jest.fn() },
      'btn-quick-standby': { click: jest.fn() },
      'btn-quick-trajectory-finish': { click: jest.fn() },
      'btn-quick-task-info': { click: jest.fn() },
      'btn-quick-task-edit': { click: jest.fn() },
      'btn-save-quick-task': { click: jest.fn() },
      'btn-run-quick-task': { click: jest.fn() }
    };
    const view = { hidden: false };
    const taskTab = { classList: { contains: jest.fn(() => true) } };
    context.document.getElementById.mockImplementation(id =>
      id === 'quick-task-builder-view'
        ? view
        : id === 'tab-action'
          ? taskTab
          : buttons[id] || null
    );
    manager._builderMode = 'quick';

    const shortcutEvent = (key, extra = {}) => ({
      key,
      target: { tagName: 'DIV' },
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn(),
      ...extra
    });
    const actionKeys = {
      w: 'btn-quick-waypoint',
      t: 'btn-quick-trajectory',
      g: 'btn-quick-freehand',
      d: 'btn-quick-docking',
      o: 'btn-quick-docking-out',
      s: 'btn-quick-standby',
      f: 'btn-quick-trajectory-finish'
    };
    Object.entries(actionKeys).forEach(([key, id]) => {
      expect(manager._handleQuickTaskShortcut(shortcutEvent(key))).toBe(true);
      expect(buttons[id].click).toHaveBeenCalledTimes(1);
    });
    expect(manager._handleQuickTaskShortcut(shortcutEvent('D', { shiftKey: true }))).toBe(true);
    expect(buttons['btn-quick-docking-inline'].click).toHaveBeenCalledTimes(1);
    expect(manager._handleQuickTaskShortcut(shortcutEvent('O', { shiftKey: true }))).toBe(true);
    expect(buttons['btn-quick-docking-out-map'].click).toHaveBeenCalledTimes(1);
    expect(manager._quickTaskItems).toHaveLength(0);

    ['i', 'e'].forEach((key, index) => {
      const id = index === 0 ? 'btn-quick-task-info' : 'btn-quick-task-edit';
      expect(manager._handleQuickTaskShortcut(shortcutEvent(key))).toBe(true);
      expect(buttons[id].click).toHaveBeenCalledTimes(1);
    });

    const saveEvent = shortcutEvent('s', {
      ctrlKey: true,
      target: { tagName: 'INPUT' }
    });
    expect(manager._handleQuickTaskShortcut(saveEvent)).toBe(true);
    expect(buttons['btn-save-quick-task'].click).toHaveBeenCalledTimes(1);

    const runEvent = {
      key: 'Enter',
      ctrlKey: true,
      target: { tagName: 'INPUT' },
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn()
    };
    expect(manager._handleQuickTaskShortcut(runEvent)).toBe(true);
    expect(buttons['btn-run-quick-task'].click).toHaveBeenCalledTimes(1);

    view.hidden = true;
    expect(manager._handleQuickTaskShortcut(shortcutEvent('w'))).toBe(false);
    expect(buttons['btn-quick-waypoint'].click).toHaveBeenCalledTimes(1);
  });

  test('Quick Task terminal chooser supports D O S and N or 0 shortcuts', () => {
    const { manager, context } = loadActionSender();
    const view = { hidden: false };
    const taskTab = { classList: { contains: jest.fn(() => true) } };
    context.document.getElementById.mockImplementation(id =>
      id === 'quick-task-builder-view'
        ? view
        : id === 'tab-action'
          ? taskTab
          : null
    );
    manager._builderMode = 'quick';
    manager._selectQuickTerminalAction = jest.fn(() => true);

    const expected = {
      d: 'docking',
      o: 'docking-out',
      s: 'standby',
      n: 'none',
      0: 'none'
    };
    Object.entries(expected).forEach(([key, action]) => {
      manager._quickTerminalActionContext = { label: 'WayPoint 1개' };
      const event = {
        key,
        target: { tagName: 'BUTTON' },
        preventDefault: jest.fn(),
        stopImmediatePropagation: jest.fn()
      };
      expect(manager._handleQuickTaskShortcut(event)).toBe(true);
      expect(manager._selectQuickTerminalAction).toHaveBeenLastCalledWith(action);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });
  });

  test('Quick Task yields overlapping shortcuts to an open Jog panel', () => {
    const { manager, context } = loadActionSender();
    const buttons = {
      'btn-quick-waypoint': { click: jest.fn() },
      'btn-quick-trajectory': { click: jest.fn() },
      'btn-quick-docking': { click: jest.fn() },
      'btn-quick-docking-inline': { click: jest.fn() },
      'btn-quick-docking-out': { click: jest.fn() },
      'btn-quick-standby': { click: jest.fn() },
      'btn-quick-trajectory-finish': { click: jest.fn() },
      'btn-quick-task-edit': { click: jest.fn() }
    };
    context.document.getElementById.mockImplementation(id => {
      if (id === 'quick-task-builder-view') return { hidden: false };
      if (id === 'tab-action') return { classList: { contains: () => true } };
      return buttons[id] || null;
    });
    context.JogControl = {
      _ownsKeyboardEvent: jest.fn(event => ['w', 'd', 'o', 's', 'f', 'e'].includes(
        String(event.key || '').toLowerCase()
      ))
    };
    manager._builderMode = 'quick';
    const shortcutEvent = (key, extra = {}) => ({
      key,
      target: { tagName: 'DIV' },
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn(),
      ...extra
    });

    ['w', 'd', 'o', 's', 'f', 'e'].forEach(key => {
      const event = shortcutEvent(key);
      expect(manager._handleQuickTaskShortcut(event)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    });
    expect(manager._handleQuickTaskShortcut(shortcutEvent('D', { shiftKey: true }))).toBe(false);
    Object.values(buttons).forEach(button => expect(button.click).not.toHaveBeenCalled());

    expect(manager._handleQuickTaskShortcut(shortcutEvent('t'))).toBe(true);
    expect(buttons['btn-quick-trajectory'].click).toHaveBeenCalledTimes(1);
  });

  test('compiles Docking alone or with a map-selected start WayPoint', () => {
    const { manager } = loadActionSender();

    const standalone = manager.compileQuickTaskItems([{
      kind: 'docking',
      docking: { args: [0, 1, 1, 1], params: {} }
    }]);
    const mapSelected = manager.compileQuickTaskItems([{
      kind: 'docking',
      pose: { x: 6, y: 7, theta: 1.2 },
      docking: { args: [0, 1, 1, 1], params: {} }
    }]);

    expect(standalone.map(action => action.actionType)).toEqual(['0x08']);
    expect(standalone[0].name).toBe('Docking_1');
    expect(mapSelected.map(action => action.actionType)).toEqual(['0x01', '0x08']);
    expect(mapSelected[0].name).toBe('Dock_Start_1');
    expect(mapSelected[0].args).toEqual([6, 7, 1.2]);
  });

  test('compiles DockingOut alone or with a map-selected start WayPoint', () => {
    const { manager } = loadActionSender();

    const standalone = manager.compileQuickTaskItems([
      { kind: 'waypoint', pose: { x: 1, y: 2, theta: 0.3 } },
      { kind: 'docking-out', distance: -1.5 }
    ]);
    const mapSelected = manager.compileQuickTaskItems([{
      kind: 'docking-out',
      distance: -1,
      pose: { x: 4, y: 5, theta: 0.7 }
    }]);

    expect(standalone.map(action => action.actionType)).toEqual(['0x01', '0x10']);
    expect(standalone[0].params.find(param => param.param_name === 'avoid_mode').value)
      .toBe('true');
    expect(standalone[0].params.find(param => param.param_name === 'straight_path').value)
      .toBe('false');
    expect(standalone[1].name).toBe('DockingOut_1');
    expect(standalone[1].args).toEqual([-1.5]);
    expect(mapSelected.map(action => action.actionType)).toEqual(['0x01', '0x10']);
    expect(mapSelected[0].name).toBe('DockingOut_Start_1');
    expect(mapSelected[0].args).toEqual([4, 5, 0.7]);
  });

  test('captures a map pose before appending DockingOut when requested', () => {
    const { manager, context } = loadActionSender();
    let capture;
    const elements = {
      'quick-task-builder-view': { hidden: false },
      'tab-action': { classList: { contains: jest.fn(() => true) } },
      'quick-docking-out-distance': { value: '-0.8' }
    };
    context.RosManager = {
      lastMapMsg: {},
      _enterWaypointSelectMode: jest.fn(callback => { capture = callback; }),
      _exitWaypointSelectMode: jest.fn(),
      _exitFreehandPathMode: jest.fn()
    };
    context.document.getElementById.mockImplementation(id => elements[id] || null);
    manager._builderMode = 'quick';
    manager.renderQuickTask = jest.fn();

    expect(manager.startQuickDockingOutMapCapture()).toBe(true);
    capture(2.5, 3.5, 1.1);

    expect(manager._quickTaskItems).toEqual([{
      kind: 'docking-out',
      distance: -0.8,
      pose: { x: 2.5, y: 3.5, theta: 1.1 }
    }]);
  });

  test('updates loop_flag directly from the Task list and preserves the Action queue', () => {
    const originalQueue = [{ name: 'move', actionType: '0x01', args: [1, 2, 0] }];
    const { manager, storage } = loadActionSender({
      patrol: { yamlTaskId: '현장 순찰', queue: originalQueue, loopFlag: 1 }
    });
    manager.refreshSavedQueueList = jest.fn();
    manager._notifyTaskStoreChanged = jest.fn();

    expect(manager.updateSavedTaskLoopFlag('patrol', 7)).toBe(7);
    const saved = JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY));
    expect(saved.patrol.loopFlag).toBe(7);
    expect(saved.patrol.queue).toEqual(originalQueue);
    expect(manager.refreshSavedQueueList).toHaveBeenCalledTimes(1);

    expect(manager.updateSavedTaskLoopFlag('patrol', 0)).toBe(0);
    expect(JSON.parse(storage.get(manager.QUEUE_STORAGE_KEY)).patrol.loopFlag).toBe(0);
  });

  test('renders the compiled ROS Actions as a compact live Quick Task list', () => {
    const { manager, context } = loadActionSender();
    const makeNode = tag => ({
      tag,
      children: [],
      className: '',
      textContent: '',
      classList: { add: jest.fn() },
      addEventListener: jest.fn(),
      appendChild(child) {
        this.children.push(child);
      }
    });
    const preview = makeNode('div');
    Object.defineProperty(preview, 'innerHTML', {
      set() {
        this.children = [];
      }
    });
    const count = { textContent: '' };
    context.document.createElement = jest.fn(makeNode);
    context.document.getElementById.mockImplementation(id => ({
      'quick-task-action-preview': preview,
      'quick-task-action-count': count
    })[id] || null);
    manager._quickTaskItems = [
      { kind: 'waypoint', pose: { x: 1, y: 2, theta: 0 } },
      {
        kind: 'docking',
        pose: { x: 3, y: 4, theta: 1.57 },
        docking: { args: [0, 1, 1, 1], params: {} }
      },
      { kind: 'docking-out', distance: -1 }
    ];

    manager._renderQuickActionPreview();

    expect(count.textContent).toBe('4');
    expect(preview.children).toHaveLength(4);
    expect(preview.children.map(chip => chip.children[1].textContent))
      .toEqual(['0x01', '0x01', '0x08', '0x10']);
  });

  test('deletes an Action source atomically and restores it with delete Undo', () => {
    const { manager } = loadActionSender();
    manager._quickTaskItems = [
      { kind: 'waypoint', pose: { x: 1, y: 2, theta: 0 } },
      {
        kind: 'docking',
        pose: { x: 3, y: 4, theta: 1.57 },
        docking: { args: [0, 1, 1, 1], params: {} }
      },
      { kind: 'standby', duration: 5 }
    ];
    manager.renderQuickTask = jest.fn();
    const dockingAction = manager._quickTaskPreviewEntries()
      .find(entry => entry.action.actionType === '0x08');

    manager.deleteQuickActionPreviewEntry(dockingAction);

    expect(manager._quickTaskItems.map(item => item.kind)).toEqual(['waypoint', 'standby']);
    expect(manager._quickTaskDeleteUndoStack).toHaveLength(1);

    manager.undoQuickActionDelete();

    expect(manager._quickTaskItems.map(item => item.kind))
      .toEqual(['waypoint', 'docking', 'standby']);
    expect(manager._quickTaskDeleteUndoStack).toHaveLength(0);
  });

  test('selecting a live Action marks its map points and shows Action information', () => {
    const { manager, context } = loadActionSender();
    const panel = { hidden: true };
    const title = { textContent: '' };
    const detail = { textContent: '' };
    context.document.getElementById.mockImplementation(id => ({
      'quick-task-map-action-selection': panel,
      'quick-task-map-action-title': title,
      'quick-task-map-action-detail': detail
    })[id] || null);
    context.RosManager = { setQuickTaskOverlay: jest.fn() };
    manager._quickTaskItems = [
      { kind: 'waypoint', pose: { x: 7, y: 8, theta: 0.5 } }
    ];
    const entry = manager._quickTaskPreviewEntries()[0];
    manager._quickTaskSelectedAction = {
      key: entry.key,
      sourceItemIndex: entry.sourceItemIndex,
      actionOffset: entry.actionOffset,
      isDraft: false
    };

    manager._syncQuickTaskOverlay();
    manager._updateQuickTaskMapActionSelection();

    expect(context.RosManager.setQuickTaskOverlay).toHaveBeenCalledWith([
      expect.objectContaining({ x: 7, y: 8, selected: true })
    ]);
    expect(panel.hidden).toBe(false);
    expect(title.textContent).toContain('0x01');
    expect(detail.textContent).toContain('x=7, y=8');
  });

  test('keeps the docking wizard arguments and user-entered parameters in the compiled Task', () => {
    const { manager } = loadActionSender();
    const actions = manager.compileQuickTaskItems([{
      kind: 'docking',
      pose: { x: 3, y: 4, theta: 0.75 },
      docking: {
        args: [1, -1, 4, 3],
        params: {
          dock_dist: '1.45',
          scan_view: '2',
          center_offset: '360',
          target_cfg: 'docking_rack.cfg'
        }
      }
    }]);

    const docking = actions[1];
    expect(docking.args).toEqual([1, -1, 4, 3]);
    expect(docking.params.find(param => param.param_name === 'dock_dist').value).toBe('1.45');
    expect(docking.params.find(param => param.param_name === 'scan_view').value).toBe('2');
    expect(docking.params.find(param => param.param_name === 'center_offset').value).toBe('360');
    expect(docking.params.find(param => param.param_name === 'target_cfg').value)
      .toBe('docking_rack.cfg');
  });

  test('extracts WayPoint and Trajectory coordinates for the running Task map overlay', () => {
    const { manager } = loadActionSender();

    const route = manager._extractTaskRoute([
      { name: 'first_waypoint', actionType: '0x01', args: [1, 2, 0.5] },
      { actionType: '0x07', args: [3] },
      { name: 'route', actionType: '0x15', args: [2, 3, 4, 5, 1.25] },
      { name: 'map_change', actionType: '0x17', args: [8, 9, 0.25] }
    ]);

    expect(route).toHaveLength(4);
    expect(route[0]).toMatchObject({
      x: 1,
      y: 2,
      theta: 0.5,
      actionIndex: 0,
      actionId: 'first_waypoint',
      typeKey: '0x01',
      kind: 'waypoint',
      label: 'A1'
    });
    expect(route[1]).toMatchObject({
      x: 2,
      y: 3,
      actionIndex: 2,
      pointIndex: 0,
      label: 'A3.1'
    });
    expect(route[1].theta).toBeCloseTo(Math.atan2(2, 2));
    expect(route[2]).toMatchObject({
      x: 4,
      y: 5,
      theta: 1.25,
      actionIndex: 2,
      pointIndex: 1,
      label: 'A3.2'
    });
    expect(route[3]).toMatchObject({
      x: 8,
      y: 9,
      theta: 0.25,
      actionIndex: 3,
      kind: 'change-map',
      label: 'A4'
    });
  });

  test('previews a whole saved Task and highlights one selected Action on the map', () => {
    const queue = [
      { name: 'wp_1', actionType: '0x01', args: [1, 2, 0.5] },
      { name: 'wait', actionType: '0x07', args: [3] },
      { name: 'route', actionType: '0x15', args: [2, 3, 4, 5, 1.25] }
    ];
    const { manager, context } = loadActionSender({
      patrol: { yamlTaskId: '현장 순찰', queue }
    });
    context.RosManager = { setTaskPreviewOverlay: jest.fn() };

    const preview = manager.showSavedTaskPreview('patrol', 2);

    expect(preview).toMatchObject({
      taskName: '현장 순찰',
      selectedActionIndex: 2,
      source: 'library',
      storageKey: 'patrol'
    });
    expect(preview.points).toHaveLength(3);
    expect(context.RosManager.setTaskPreviewOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        taskName: '현장 순찰',
        selectedActionIndex: 2,
        showRoute: true,
        points: expect.arrayContaining([
          expect.objectContaining({ actionIndex: 2, label: 'A3.1' }),
          expect.objectContaining({ actionIndex: 2, label: 'A3.2' })
        ])
      })
    );

    manager.clearTaskPreview();
    expect(context.RosManager.setTaskPreviewOverlay).toHaveBeenLastCalledWith(null);
  });

  test('includes Task selection and Action map preview controls in the Task UI', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'),
      'utf8'
    );
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'action-sender.js'),
      'utf8'
    );
    const style = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'css', 'style.css'),
      'utf8'
    );

    expect(html).toContain('id="task-preview-map-panel"');
    expect(html).toContain('id="btn-task-preview-map-all"');
    expect(source).toContain('showSavedTaskPreview(taskName, selectedActionIndex = null)');
    expect(source).toContain("data-task-preview-action");
    expect(source).toContain("this._showEditorTaskPreview(idx)");
    expect(style).toContain('.task-library-card.map-preview-selected');
    expect(style).toContain('.task-detail-action.map-selected');
    expect(style).toContain('.action-queue-item.map-selected');
  });

  test('exposes Task Info, route visibility controls, and sequential docking questions', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'),
      'utf8'
    );
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'action-sender.js'),
      'utf8'
    );
    const style = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'css', 'style.css'),
      'utf8'
    );

    expect(html).toContain('id="btn-builder-task-info"');
    expect(html).toContain('id="btn-quick-task-info"');
    expect(html).toContain('id="btn-running-task-info"');
    expect(html).toContain('id="active-task-show-route"');
    expect(html).toContain('id="active-task-show-summary"');
    expect(html).toContain('id="quick-dock-wizard"');
    expect(html).toContain('id="btn-quick-dock-defaults"');
    expect(html).toContain('id="btn-quick-docking-out"');
    expect(html).toContain('id="btn-quick-docking-inline"');
    expect(html).toContain('id="btn-quick-docking-out-map"');
    expect(html).toContain('id="quick-task-action-preview"');
    expect(html).toContain('class="quick-task-shortcut-help"');
    expect(html).toContain('⌨ Quick Task 단축키 전체 보기');
    expect(html).toContain('<kbd>W</kbd> WayPoint 연속');
    expect(html).toContain('<kbd>O</kbd> DockingOut');
    expect(html).toContain('<kbd>Shift+D</kbd> Docking만 추가');
    expect(html).toContain('<kbd>Shift+O</kbd> 맵 지정 + DockingOut');
    expect(html).toContain('<kbd>N</kbd> 또는 <kbd>0</kbd> 추가 없음');
    expect(html).toContain('<kbd>Ctrl</kbd>+<kbd>S</kbd> Task 저장');
    expect(html).toContain('<kbd>Ctrl</kbd>+<kbd>Enter</kbd> 저장 후 실행');
    expect(source).toContain('updateSavedTaskLoopFlag(taskName, rawValue)');
    expect(style).toContain('.task-library-loop-editor');
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
