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
    classList: { add: jest.fn(), remove: jest.fn() },
    setAttribute: jest.fn()
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
  const published = [];
  const topics = [];
  const documentListeners = {};
  class Topic {
    constructor(options) {
      this.options = options;
      topics.push(this);
    }

    publish(message) {
      published.push({ topic: this.options.name, message });
    }
  }
  class Message {
    constructor(values) {
      Object.assign(this, values);
    }
  }
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
    RosManager: {
      getRos: jest.fn(() => context.App.robotSlots[0].ros),
      getRobotId: jest.fn(() => context.App.robotSlots[0].robotId)
    },
    ROSLIB: { Topic, Message },
    localStorage: {
      getItem: jest.fn(key => storage.get(key) || null),
      setItem: jest.fn((key, value) => storage.set(key, String(value)))
    },
    document: {
      activeElement: null,
      hidden: false,
      addEventListener: jest.fn((name, callback) => {
        documentListeners[name] = callback;
      }),
      getElementById: jest.fn(id => {
        if (id === 'jog-quick-task-status') return status;
        if (id === 'jog-manual-lift-status') return liftStatus;
        if (id === 'jog-lift-up') return liftUpButton;
        if (id === 'jog-lift-down') return liftDownButton;
        if (id === 'jog-panel') return { style: { display: 'flex' } };
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
    liftDownButton,
    published,
    topics,
    documentListeners
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

  test('manual lift publishes UP while held and STOP when released', () => {
    const {
      manager,
      sendSavedQueueToSlot,
      liftStatus,
      liftUpButton,
      published,
      topics
    } = loadJogControl();
    manager._stopVel = jest.fn();

    manager._startManualLift('up', liftUpButton);

    expect(manager._stopVel).toHaveBeenCalled();
    expect(topics[0].options).toMatchObject({
      name: '/R_051/Lift/manual_cmd',
      messageType: 'std_msgs/Int8'
    });
    expect(published[0]).toMatchObject({
      topic: '/R_051/Lift/manual_cmd',
      message: { data: 1 }
    });
    expect(liftStatus.className).toContain('running');
    expect(sendSavedQueueToSlot).not.toHaveBeenCalled();

    manager._stopManualLift();

    expect(published.at(-1).message.data).toBe(0);
    expect(liftStatus.className).toContain('success');
  });

  test('Z is lift up and C is lift down only until keyup', () => {
    const { manager, documentListeners, published } = loadJogControl();
    manager._stopVel = jest.fn();
    manager._setupKeyboard();

    const zDown = { key: 'z', repeat: false, preventDefault: jest.fn() };
    documentListeners.keydown(zDown);
    expect(zDown.preventDefault).toHaveBeenCalled();
    expect(published.at(-1).message.data).toBe(1);

    documentListeners.keyup({ key: 'z', preventDefault: jest.fn() });
    expect(published.at(-1).message.data).toBe(0);

    documentListeners.keydown({ key: 'c', repeat: false, preventDefault: jest.fn() });
    expect(published.at(-1).message.data).toBe(-1);

    documentListeners.keyup({ key: 'c', preventDefault: jest.fn() });
    expect(published.at(-1).message.data).toBe(0);
  });
});
