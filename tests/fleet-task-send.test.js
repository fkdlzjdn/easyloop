const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadActionSender() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'action-sender.js'), 'utf8');
  const calls = [];
  const availableServices = ['/R_002/spx/task/goal'];
  const unresponsiveServices = new Set();
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
      if (unresponsiveServices.has(this.options.name)) return;
      if (this.options.name === '/rosapi/services') {
        success({ services: availableServices });
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
    availableServices,
    unresponsiveServices,
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

  test('serializes numeric legacy mission IDs as ROS strings', async () => {
    const { manager, calls, saved } = loadActionSender();
    saved.legacy = {
      queue: [{
        name: 'legacy waypoint',
        actionType: '0x01',
        args: [1, 2, 0],
        params: [],
        missionId: 1,
        missionIndex: 0
      }]
    };

    await manager.sendSavedQueueToSlot('legacy', 0, 1, 'legacy');

    expect(calls[0].request.missions[0].mission_id).toBe('1');
    expect(typeof calls[0].request.missions[0].mission_id).toBe('string');
  });

  test('adds the Turntable async-mode argument only for the r63-compatible profile', async () => {
    const { manager, context, slot } = loadActionSender();
    context.RobotCompatibility = {
      get: jest.fn(() => ({
        discovered: true,
        actions: { turntable: { argCount: 3, asyncModeArg: true } }
      }))
    };

    const prepared = await manager._prepareActionsForSlot([{
      action_type: 0x22,
      action_args: [3, 90]
    }], slot);

    expect(prepared[0].action_args).toEqual([3, 90, 0]);
    expect(manager._actionArgDefinitions('0x22', null, slot)).toHaveLength(3);
    expect(manager._actionArgDefinitions('0x22')[2]).toMatchObject({
      name: 'async_mode',
      type: 'bool'
    });
  });

  test.each(['stl1000w', 'stl1500w'])('always sends three Turntable args for ROBOT_MODEL %s', async robotModel => {
    const { manager, context, slot } = loadActionSender();
    slot.robotModel = robotModel;
    context.RobotCompatibility = {
      isStlUlsanModel: model => ['stl1000w', 'stl1500w'].includes(String(model).toLowerCase()),
      get: jest.fn(() => ({
        discovered: true,
        actions: { turntable: { argCount: 2, asyncModeArg: false } }
      }))
    };

    const prepared = await manager._prepareActionsForSlot([{
      action_type: 0x22,
      action_args: [3, 45]
    }], slot);

    expect(prepared[0].action_args).toEqual([3, 45, 0]);
    expect(manager._actionArgDefinitions('0x22', null, slot)).toHaveLength(3);
  });

  test('sends stl_ulsan Turntable Jog through Task goal with mode, target, asyncmode', async () => {
    const { manager, context, slot, calls } = loadActionSender();
    slot.robotModel = 'stl1500w';
    context.RobotCompatibility = {
      isStlUlsanModel: model => model === 'stl1500w',
      get: jest.fn(() => ({
        discovered: true,
        actions: { turntable: { argCount: 3, asyncModeArg: true } }
      }))
    };

    const sent = await manager.sendJogActionToSlot(0, 0x22, [3, -90], 'easyloop_turntable_test');

    expect(sent.request.task_id).toBe('easyloop_turntable_test');
    expect(calls[0].options.name).toBe('/R_002/TARU/goal');
    expect(calls[0].request.missions[0].actions[0]).toMatchObject({
      action_type: 0x22,
      action_args: [3, -90, 0]
    });
  });

  test('keeps the existing two-argument Turntable payload for legacy profiles', async () => {
    const { manager, context, slot } = loadActionSender();
    context.RobotCompatibility = {
      get: jest.fn(() => ({
        discovered: true,
        actions: { turntable: { argCount: 2, asyncModeArg: false } }
      }))
    };

    const prepared = await manager._prepareActionsForSlot([{
      action_type: 0x22,
      action_args: [3, 90, 1]
    }], slot);

    expect(prepared[0].action_args).toEqual([3, 90]);
    expect(manager._actionArgDefinitions('0x22')).toHaveLength(2);
  });

  test('waits for compatibility discovery before preparing an r63 Turntable payload', async () => {
    const { manager, context, slot } = loadActionSender();
    slot.compatibilityProfile = { discovered: false };
    slot.compatibilityPromise = Promise.resolve().then(() => {
      slot.compatibilityProfile = {
        discovered: true,
        actions: { turntable: { argCount: 3, asyncModeArg: true } }
      };
    });
    context.RobotCompatibility = {
      get: jest.fn(target => target.compatibilityProfile)
    };

    const prepared = await manager._prepareActionsForSlot([{
      action_type: 0x22,
      action_args: [3, -90, 1]
    }], slot);

    expect(prepared[0].action_args).toEqual([3, -90, 1]);
  });

  test('serializes the r63 Turntable checkbox as asyncmode 1 or 0', () => {
    const { manager, context, document } = loadActionSender();
    context.RobotCompatibility = {
      get: jest.fn(() => ({
        discovered: true,
        actions: { turntable: { argCount: 3, asyncModeArg: true } }
      }))
    };
    const inputs = {
      'action-type': { value: '0x22' },
      'action-arg-0': { value: '3' },
      'action-arg-1': { value: '45' },
      'action-arg-2': { checked: true }
    };
    document.getElementById.mockImplementation(id => inputs[id] || null);

    expect(manager.readCurrentAction().args).toEqual([3, 45, 1]);
    inputs['action-arg-2'].checked = false;
    expect(manager.readCurrentAction().args).toEqual([3, 45, 0]);
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

  test('uses robot-local TARU telemetry for legacy Task state', () => {
    const { manager, slot } = loadActionSender();
    const legacy = manager._taskInterfaceDefinitions(slot).legacy;

    expect(legacy.feedbackName).toBe('/R_002/TARU/feedback');
    expect(legacy.resultName).toBe('/R_002/TARU/result');
    expect(legacy.stateName).toBe('/R_002/taru_state');
  });

  test('coalesces duplicate cancel clicks while the first request is pending', async () => {
    const { manager } = loadActionSender();
    let finish;
    manager._controlTaskOnSlot = jest.fn(() => new Promise(resolve => { finish = resolve; }));

    const first = manager.cancelTaskOnSlot(0);
    const second = manager.cancelTaskOnSlot(0);

    expect(second).toBe(first);
    expect(manager._controlTaskOnSlot).toHaveBeenCalledTimes(1);
    finish({ success: true });
    await first;
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

  test('allows a per-robot Legacy override only when TARU exists', async () => {
    const { manager, slot, availableServices } = loadActionSender();
    availableServices.push('/R_002/TARU/goal');
    manager._taskInterfaceModes = { R_002: 'legacy' };
    delete slot.taskInterface;

    const taskInterface = await manager._resolveTaskInterface(slot);

    expect(taskInterface.variant).toBe('sp_task');
    expect(taskInterface.goalName).toBe('/R_002/TARU/goal');
    expect(slot.taskInterfaceModeResolved).toBe('legacy');
  });

  test('rejects a manual interface override when its goal service is absent', async () => {
    const { manager, slot } = loadActionSender();
    manager._taskInterfaceModes = { R_002: 'legacy' };
    delete slot.taskInterface;

    await expect(manager._resolveTaskInterface(slot)).rejects.toThrow(
      'Legacy (TARU) 서비스가 로봇에 없습니다.'
    );
    expect(slot.taskInterface).toBeUndefined();
  });

  test('does not guess an interface when service discovery succeeds with no Task service', async () => {
    const { manager, slot, availableServices } = loadActionSender();
    availableServices.splice(0, availableServices.length);
    delete slot.taskInterface;

    await expect(manager._resolveTaskInterface(slot)).rejects.toThrow(
      'SPX 또는 Legacy Task 서비스가 로봇에 없습니다.'
    );
  });

  test('uses a longer Task discovery window for SSH tunnel robots', () => {
    const { manager, slot } = loadActionSender();
    slot.tunnelMode = true;

    expect(manager._taskInterfaceDiscoveryTimeout(slot)).toBe(6000);
    expect(manager._taskInterfaceDiscoveryTimeout({ tunnelMode: false })).toBe(2500);
  });

  test('does not report a manual interface as absent when rosapi discovery timed out', async () => {
    const { manager, slot, unresponsiveServices } = loadActionSender();
    manager._taskInterfaceModes = { R_002: 'legacy' };
    manager._taskInterfaceDiscoveryTimeout = () => 5;
    unresponsiveServices.add('/rosapi/services');
    delete slot.taskInterface;

    await expect(manager._resolveTaskInterface(slot)).rejects.toThrow(
      'Task 서비스 목록 응답 시간이 초과되었습니다.'
    );
  });

  test('shares compatibility discovery instead of duplicating the rosapi service request', async () => {
    const { manager, context, calls, slot } = loadActionSender();
    delete slot.taskInterface;
    slot.compatibilityPromise = Promise.resolve();
    context.RobotCompatibility = {
      get: jest.fn(() => ({
        discovered: true,
        services: ['/R_002/TARU/goal'],
        task: { variant: 'sp_task', goalName: '/R_002/TARU/goal' }
      }))
    };

    const taskInterface = await manager._resolveTaskInterface(slot);

    expect(taskInterface.variant).toBe('sp_task');
    expect(calls.some(call => call.options.name === '/rosapi/services')).toBe(false);
  });

  test('forces a fresh service check when the operator changes the interface mode', async () => {
    const { manager, context, slot, availableServices } = loadActionSender();
    context.RobotCompatibility = {
      get: jest.fn(() => ({
        discovered: true,
        services: ['/R_002/TARU/goal'],
        task: { variant: 'sp_task', goalName: '/R_002/TARU/goal' }
      }))
    };
    manager._taskInterfaceModes = { R_002: 'spx' };
    delete slot.taskInterface;

    const taskInterface = await manager._resolveTaskInterface(slot, { forceDiscovery: true });

    expect(taskInterface.variant).toBe('spx');
    expect(availableServices).toEqual(['/R_002/spx/task/goal']);
  });

  test('sends emergency Task cancel immediately and keeps the control enabled', async () => {
    const { manager, calls, confirm } = loadActionSender();
    manager.getTargetSlot = jest.fn(() => 0);
    manager._setTaskExecutionFeedback = jest.fn();
    const cancelButton = { disabled: false };

    await manager._controlActiveTask('cancel', cancelButton);

    expect(confirm).not.toHaveBeenCalled();
    expect(cancelButton.disabled).toBe(false);
    expect(calls.at(-1).options.name).toBe('/R_002/TARU/cancel');
    expect(manager._setTaskExecutionFeedback.mock.calls[0]).toEqual([
      'cancel',
      'R_002 · Task 취소 요청 전송 중…'
    ]);
  });

  test('times out an unresponsive legacy cancel service instead of waiting forever', async () => {
    const { manager, slot, unresponsiveServices } = loadActionSender();
    unresponsiveServices.add('/R_002/TARU/cancel');

    await expect(
      manager._callTaskService(
        slot.ros,
        '/R_002/TARU/cancel',
        'sp_task/String_srv',
        { data: '' },
        5
      )
    ).rejects.toMatchObject({ code: 'TASK_CONTROL_TIMEOUT' });
  });

  test('keeps cancel intent long enough to classify a late legacy result after timeout', async () => {
    const { manager, slot } = loadActionSender();
    manager._callTaskService = jest.fn(async () => {
      const error = new Error('timeout');
      error.code = 'TASK_CONTROL_TIMEOUT';
      throw error;
    });

    await expect(manager.cancelTaskOnSlot(0)).rejects.toMatchObject({
      code: 'TASK_CONTROL_TIMEOUT'
    });
    expect(manager._taskCancelRequests.has(slot.robotId)).toBe(true);
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

  test('uses taru_state to show CANCELLING and confirm IDLE after cancel', () => {
    const { manager, document } = loadActionSender();
    const badge = { textContent: '' };
    const message = { textContent: '' };
    const feedback = {
      dataset: {},
      querySelector: jest.fn(selector => selector === '.task-state-badge' ? badge : message)
    };
    const control = { disabled: false, classList: { contains: jest.fn(() => false) } };
    document.getElementById.mockImplementation(id =>
      id === 'task-execution-feedback' ? feedback : control
    );

    manager._handleTaskState('R_002', { data: 4 });
    expect(feedback.dataset.state).toBe('cancel');
    expect(message.textContent).toContain('취소 처리 중');

    manager._handleTaskState('R_002', { data: 0 });
    expect(feedback.dataset.state).toBe('idle');
    expect(message.textContent).toContain('취소 완료');
    expect(message.textContent).toContain('IDLE');
  });
});
