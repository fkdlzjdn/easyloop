const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadActionSender() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'action-sender.js'), 'utf8');
  const calls = [];
  const saved = {
    patrol: {
      queue: [{
        name: 'go-1',
        actionType: '0x01',
        args: [1, 2, 0.5],
        params: [{ param_name: 'max_trans_vel', type: 'float', value: '0.5' }]
      }],
      savedAt: Date.now()
    }
  };

  class FakeService {
    constructor(options) {
      this.options = options;
    }

    callService(request, success) {
      calls.push({ options: this.options, request });
      if (this.options.name === '/rosapi/services') {
        success({ services: ['/R_002/spx/task/goal'] });
        return;
      }
      success({ success: true, message: 'accepted' });
    }
  }

  class FakeServiceRequest {
    constructor(values) {
      Object.assign(this, values);
    }
  }

  const slot = {
    robotId: 'R_002',
    connected: true,
    ros: {},
    taskInterface: {
      goalName: '/R_002/TARU/goal',
      goalType: 'sp_task/TaskGoal',
      pauseName: '/R_002/TARU/pause',
      pauseType: 'sp_task/Int32_srv',
      pauseArgs: { data: 0 },
      resumeName: '/R_002/TARU/resume',
      resumeType: 'sp_task/Int32_srv',
      resumeArgs: { data: 0 },
      cancelName: '/R_002/TARU/cancel',
      cancelType: 'sp_task/String_srv',
      cancelArgs: { data: '' }
    }
  };
  const context = {
    App: {
      robotSlots: [slot],
      logAudit: jest.fn(),
      toast: jest.fn()
    },
    ROSLIB: { Service: FakeService, ServiceRequest: FakeServiceRequest },
    localStorage: {
      getItem: jest.fn(key => key === 'actionSenderSavedQueues' ? JSON.stringify(saved) : null),
      setItem: jest.fn()
    },
    document: { addEventListener: jest.fn(), getElementById: jest.fn() },
    confirm: jest.fn(() => true),
    window: {},
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__ActionSender = ActionSender;`, context);
  return {
    manager: context.__ActionSender,
    context,
    calls,
    saved,
    slot,
    App: context.App,
    confirm: context.confirm,
    document: context.document
  };
}

describe('fleet saved task sending', () => {
  test('sends a saved task to the clicked robot connection without switching active data', async () => {
    const { manager, calls, App } = loadActionSender();

    const sent = await manager.sendSavedQueueToSlot('patrol', 0, 2, '현장 순찰');

    expect(sent.robotId).toBe('R_002');
    expect(sent.actionCount).toBe(1);
    expect(calls[0].options.name).toBe('/R_002/TARU/goal');
    expect(calls[0].request.task_id).toBe('현장 순찰');
    expect(calls[0].request.loop_flag).toBe(2);
    expect(calls[0].request.missions[0].actions[0].action_args).toEqual([1, 2, 0.5]);
    expect(App.logAudit).toHaveBeenCalledWith('fleet_task_send', expect.objectContaining({
      robotId: 'R_002',
      taskId: '현장 순찰',
      sourceQueue: 'patrol'
    }));
  });

  test('preserves imported mission boundaries when sending a saved Task', async () => {
    const { manager, calls, saved } = loadActionSender();
    saved.multi = {
      queue: [
        {
          name: 'go',
          actionType: '0x01',
          args: [1, 2, 0],
          params: [],
          missionId: 'navigation',
          missionIndex: 0
        },
        {
          name: 'wait',
          actionType: '0x07',
          args: [5],
          params: [],
          missionId: 'work',
          missionIndex: 1
        }
      ]
    };

    await manager.sendSavedQueueToSlot('multi', 0, 1, 'multi');

    expect(calls[0].request.missions).toHaveLength(2);
    expect(calls[0].request.missions[0].mission_id).toBe('navigation');
    expect(calls[0].request.missions[0].actions[0].action_id).toBe('go');
    expect(calls[0].request.missions[1].mission_id).toBe('work');
    expect(calls[0].request.missions[1].actions[0].action_id).toBe('wait');
    const running = manager._runningTasks.get('R_002');
    expect(running.queue.map(action => action.missionId)).toEqual(['navigation', 'work']);
    expect(manager._flattenTaskActionIndex(running, 1, 0)).toBe(1);
  });

  test('runs a saved task through the virtual robot engine in Test Mode', async () => {
    const { manager, context, calls, slot } = loadActionSender();
    const runTask = jest.fn().mockResolvedValue({ success: true });
    slot.virtualTestRobot = true;
    context.TestMode = { enabled: true, runTask };

    const sent = await manager.sendSavedQueueToSlot('patrol', 0, 3, '가상 순찰');

    expect(runTask).toHaveBeenCalledWith(0, expect.objectContaining({
      task_id: '가상 순찰',
      loop_flag: 3
    }));
    expect(calls).toHaveLength(0);
    expect(sent.serviceName).toBe('[TestMode virtual task]');
  });

  test('uses the detected legacy services for pause, resume, and cancel', async () => {
    const { manager, calls } = loadActionSender();

    await manager.pauseTaskOnSlot(0);
    await manager.resumeTaskOnSlot(0);
    await manager.cancelTaskOnSlot(0);

    expect(calls.map(call => call.options.name)).toEqual([
      '/R_002/TARU/pause',
      '/R_002/TARU/resume',
      '/R_002/TARU/cancel'
    ]);
    expect(calls[0].request.data).toBe(0);
    expect(calls[1].request.data).toBe(0);
    expect(calls[2].request.data).toBe('');
  });

  test('detects the modern spx task control and telemetry interface', async () => {
    const { manager, slot } = loadActionSender();
    delete slot.taskInterface;

    const taskInterface = await manager._resolveTaskInterface(slot);

    expect(taskInterface.variant).toBe('spx');
    expect(taskInterface.pauseName).toBe('/R_002/spx/task/pause');
    expect(taskInterface.resumeName).toBe('/R_002/spx/task/resume');
    expect(taskInterface.feedbackName).toBe('/R_002/spx/task/feedback');
    expect(taskInterface.resultType).toBe('spx_task_msgs/TaskResult');
  });

  test('keeps the emergency task cancel control enabled while the cancel request runs', async () => {
    const { manager, calls, confirm } = loadActionSender();
    manager.getTargetSlot = jest.fn(() => 0);
    manager._setTaskExecutionFeedback = jest.fn();
    const cancelButton = { disabled: false };

    await manager._controlActiveTask('cancel', cancelButton);

    expect(confirm).toHaveBeenCalled();
    expect(cancelButton.disabled).toBe(false);
    expect(calls.at(-1).options.name).toBe('/R_002/TARU/cancel');
  });

  test('shows completed task results and re-enables task controls from live telemetry', () => {
    const { manager, document } = loadActionSender();
    manager.getTargetSlot = jest.fn(() => 0);
    const badge = { textContent: '' };
    const message = { textContent: '' };
    const feedback = {
      dataset: {},
      querySelector: jest.fn(selector =>
        selector === '.task-state-badge' ? badge : message
      )
    };
    const controls = ['btn-pause-task', 'btn-resume-task', 'btn-cancel-task']
      .reduce((result, id) => {
        result[id] = {
          disabled: true,
          classList: { contains: jest.fn(() => false) }
        };
        return result;
      }, {});
    document.getElementById.mockImplementation(id =>
      id === 'task-execution-feedback' ? feedback : controls[id] || null
    );

    manager._handleTaskResult('R_002', {
      task_id: '기본 - 도킹',
      success: true,
      total_elapsed_time: 4.2
    }, 'spx');

    expect(feedback.dataset.state).toBe('complete');
    expect(badge.textContent).toBe('COMPLETE');
    expect(message.textContent).toContain('완료');
    expect(message.textContent).toContain('4.2s');
    expect(controls['btn-cancel-task'].disabled).toBe(false);
  });

  test('shows user-cancelled tasks as IDLE instead of ABORT', () => {
    const { manager, document } = loadActionSender();
    manager.getTargetSlot = jest.fn(() => 0);
    const badge = { textContent: '' };
    const message = { textContent: '' };
    const feedback = {
      dataset: {},
      querySelector: jest.fn(selector =>
        selector === '.task-state-badge' ? badge : message
      )
    };
    const control = {
      disabled: false,
      classList: { contains: jest.fn(() => false) }
    };
    document.getElementById.mockImplementation(id =>
      id === 'task-execution-feedback' ? feedback : control
    );
    manager._taskCancelRequests.set('R_002', Date.now());

    manager._handleTaskResult('R_002', {
      task_id: '기본 - 도킹',
      success: false,
      error_code: 1,
      message: ''
    }, 'spx');

    expect(feedback.dataset.state).toBe('idle');
    expect(badge.textContent).toBe('IDLE');
    expect(message.textContent).toContain('취소됨');
    expect(message.textContent).not.toContain('실패');

    manager._handleTaskFeedback('R_002', {
      task_id: '기본 - 도킹',
      state: 4
    }, 'spx');

    expect(feedback.dataset.state).toBe('idle');
    expect(badge.textContent).toBe('IDLE');
  });
});
