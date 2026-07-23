const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadJogControl(savedConfig = null) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'jog-control.js'),
    'utf8'
  );
  const storage = new Map();
  if (savedConfig) storage.set('jogQuickTasks', JSON.stringify(savedConfig));

  const status = { className: '', textContent: '' };
  const liftStatus = { className: '', textContent: '' };
  const makeButton = () => ({
    disabled: false,
    classList: { add: jest.fn(), remove: jest.fn() }
  });
  const liftUpButton = makeButton();
  const liftDownButton = makeButton();
  const taskSelect = { value: '기본 - 도킹' };
  const nameInput = { value: '충전기 도킹' };
  const row = {
    querySelector: jest.fn(selector => {
      if (selector === '.jog-quick-task-select') return taskSelect;
      if (selector === '.jog-quick-task-name') return nameInput;
      return null;
    })
  };
  const sendSavedQueueToSlot = jest.fn().mockResolvedValue({ result: { success: true } });
  const context = {
    App: {
      activeSlotIndex: 0,
      robotSlots: [{ robotId: 'R_051', connected: true, ros: {} }],
      toast: jest.fn()
    },
    ActionSender: {
      sendSavedQueueToSlot,
      getSavedQueues: () => ({
        '기본 - 리프트 업': { queue: [{}] },
        '기본 - 리프트 다운': { queue: [{}] }
      })
    },
    RosManager: {},
    ROSLIB: {},
    localStorage: {
      getItem: jest.fn(key => storage.get(key) || null),
      setItem: jest.fn((key, value) => storage.set(key, String(value)))
    },
    document: {
      addEventListener: jest.fn(),
      getElementById: jest.fn(id => {
        if (id === 'jog-quick-task-status') return status;
        if (id === 'jog-manual-lift-status') return liftStatus;
        if (id === 'jog-lift-up') return liftUpButton;
        if (id === 'jog-lift-down') return liftDownButton;
        return null;
      }),
      querySelector: jest.fn(() => row)
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__JogControl = JogControl;`, context);
  return {
    manager: context.__JogControl,
    storage,
    status,
    sendSavedQueueToSlot,
    button: { disabled: false },
    liftStatus,
    liftUpButton,
    liftDownButton
  };
}

describe('Jog Quick Task', () => {
  test('provides five persistent quick task slots', () => {
    const { manager } = loadJogControl([
      { taskName: '기본 - 도킹', displayName: '도킹' }
    ]);

    const configs = manager._loadQuickTaskConfigs();

    expect(configs).toHaveLength(5);
    expect(configs[0]).toEqual({ taskName: '기본 - 도킹', displayName: '도킹' });
    expect(configs[4]).toEqual({ taskName: '', displayName: '' });
  });

  test('sends the selected saved task to the current active robot with its quick name', async () => {
    const { manager, sendSavedQueueToSlot, button, status } = loadJogControl();
    manager._quickTaskConfigs = Array.from({ length: 5 }, () => ({
      taskName: '',
      displayName: ''
    }));
    manager._stopVel = jest.fn();

    await manager._runQuickTask(0, button);

    expect(manager._stopVel).toHaveBeenCalled();
    expect(sendSavedQueueToSlot).toHaveBeenCalledWith('기본 - 도킹', 0, 1, '충전기 도킹');
    expect(status.className).toContain('success');
    expect(button.disabled).toBe(false);
  });

  test('manual lift up uses the shared built-in lift task on the active robot', async () => {
    const {
      manager,
      sendSavedQueueToSlot,
      liftStatus,
      liftUpButton
    } = loadJogControl();
    manager._stopVel = jest.fn();

    await manager._runManualLift('up', liftUpButton);

    expect(manager._stopVel).toHaveBeenCalled();
    expect(sendSavedQueueToSlot).toHaveBeenCalledWith(
      '기본 - 리프트 업',
      0,
      1,
      'Manual_LiftUp'
    );
    expect(liftStatus.className).toContain('success');
    expect(liftUpButton.disabled).toBe(false);
  });
});
