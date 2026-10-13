const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Route = require('../public/js/ros2-route');

function load(native = true) {
  const storage = new Map();
  const elements = new Map();
  const slot = { robotId: 'R_025', rosMode: native ? 'ros2' : 'ros1', connected: true, ros: {} };
  const profile = { discovered: true, task: { protocol: native ? 'ros2_spx' : 'ros1_legacy',
    actionCatalog: { attempted: true, verified: true, types: [48, 7], actions: [
      { type: 48, name: 'RouteNavigation', key: 'route_navigation' }, { type: 7, name: 'StandBy', key: 'standby' }
    ] }, routeContext: { verified: true, schema: 'spx.route_contract.v2', mapId: 'normal', frameId: 'map', maximumSpeed: 0.25,
      robot: { manufacturer: 'SysconRobotics', serial_number: 'R_025' } } } };
  slot.compatibilityProfile = profile;
  const context = { App: { activeSlotIndex: 0, robotSlots: [slot], toast: jest.fn() },
    Ros2Route: Route, RobotCompatibility: { get: target => target.compatibilityProfile },
    document: { addEventListener: jest.fn(), getElementById: id => elements.get(id) || null },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    console, setTimeout, clearTimeout, setInterval, clearInterval };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/action-sender.js'), 'utf8');
  const sender = vm.runInNewContext(source + '\nActionSender', context);
  const standby = () => {
    elements.set('action-type', { value: '0x07' });
    elements.set('action-arg-0', { value: '5' });
    elements.set('action-param-0', { value: 'station-ready', dataset: { name: 'id', type: 'string' } });
    elements.set('common-param-0', { value: 'true' });
    elements.set('action-work-id', { value: 'review-task' });
  };
  return { sender, slot, profile, elements, storage, standby, context };
}

test('ROS2 transport selects native forms before asynchronous graph discovery finishes', () => {
  const { sender, slot } = load();
  slot.rosMode = 'auto'; slot.ros2SessionId = 'pending';
  slot.compatibilityProfile = { task: { actionCatalog: { attempted: false } } };
  expect(sender._isRos2TaskForm()).toBe(true);
  expect(sender._actionDefinition('0x07').args[0].name).toBe('timeout');
  expect(sender._actionDefinition('0x01')).toBeUndefined();
  expect(sender._actionTypeSupported(48)).toBe(false);
});

test('native StandBy never inherits changed ROS1 common parameters', () => {
  const { sender, standby, slot, profile } = load(); standby();
  const action = sender.readCurrentAction();
  expect(action.params.map(param => param.param_name)).toEqual(['id']);
  expect(action.args).toEqual([5]);
  slot.rosMode = 'ros1'; profile.task.protocol = 'ros1_legacy';
  expect(sender.readCurrentAction().params.map(param => param.param_name)).toEqual(['id', 'common/sound_trigger']);
});

test('native defaults preserve all existing ROS1 tasks and only native built-ins are shown', () => {
  const { sender, slot, profile, storage } = load(false);
  sender.ensureDefaultTasks();
  const legacy = JSON.parse(storage.get(sender.QUEUE_STORAGE_KEY));
  slot.rosMode = 'ros2'; profile.task.protocol = 'ros2_spx';
  expect(sender.ensureDefaultTasks()).toBe(2);
  const combined = sender.getSavedQueues();
  for (const [name, value] of Object.entries(legacy)) expect(combined[name]).toEqual(value);
  expect(sender._getVisibleTaskKeys()).toEqual(['ROS2 - RouteNavigation', 'ROS2 - StandBy']);
  expect(sender._taskQueueCompatibility(combined['ROS2 - RouteNavigation']).runnable).toBe(false);
  slot.rosMode = 'ros1'; profile.task.protocol = 'ros1_legacy';
  expect(sender._getVisibleTaskKeys()).toHaveLength(8);
});

test('native form persistence does not overwrite a saved ROS1 StandBy', () => {
  const { sender, standby, slot, profile, storage } = load(false); standby();
  sender.saveLastParams('0x07');
  const original = sender.loadLastParams('0x07');
  slot.rosMode = 'ros2'; profile.task.protocol = 'ros2_spx';
  expect(sender.loadLastParams('0x07')).toBeNull();
  sender.saveLastParams('0x07');
  const persisted = JSON.parse(storage.get(sender.STORAGE_KEY));
  expect(persisted['0x07']).toEqual(original);
  expect(persisted['ros2:0x07']).toBeDefined();
});

test('legacy interface preference is ignored only while the target transport is ROS2', () => {
  const { sender, slot, profile } = load(false);
  sender._setTaskInterfaceMode(slot, 'legacy');
  slot.rosMode = 'ros2'; profile.task.protocol = 'ros2_spx';
  expect(sender._getTaskInterfaceMode(slot)).toBe('auto');
  slot.rosMode = 'ros1'; profile.task.protocol = 'ros1_legacy';
  expect(sender._getTaskInterfaceMode(slot)).toBe('legacy');
});

test('ROS2 task cards block legacy actions, excess speed, repetition and unknown schemas', () => {
  const { sender, profile } = load();
  expect(sender._taskQueueCompatibility({ queue: [{ actionType: '0x01', args: [1, 2, 0] }] }).runnable).toBe(false);
  const action = Route.action(Route.build({ routeId: 'review', mapId: 'normal', robotId: 'R_025', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), 'RouteNavigation', { maximumSpeed: 0.3 });
  expect(sender._taskQueueCompatibility({ queue: [action] }).reason).toContain('속도 범위');
  expect(sender._taskQueueCompatibility({ queue: [{ actionType: '0x07', args: [5] }], loopFlag: 0 }).runnable).toBe(false);
  profile.task.actionCatalog.types.push(99);
  expect(sender._taskQueueCompatibility({ queue: [{ actionType: '0x63', args: [] }] }).runnable).toBe(false);
});

test('native task preview preserves Mission boundaries and parameter triples without ROS calls', () => {
  const { sender, slot } = load();
  const queue = [{ actionType: '0x07', name: 'wait', missionId: 'm1', args: [5], params: [{ param_name: 'id', type: 'string', value: 'ready' }] }];
  const before = JSON.stringify(queue);
  const request = sender._buildTaskFormPayload({ queue, loopFlag: 1 }, 'inspection');
  expect(request).toMatchObject({ task_id: 'inspection', loop_flag: 1, missions: [{ mission_id: 'm1', actions: [{ action_id: 'wait', action_type: 7, action_args: [5], action_params: queue[0].params }] }] });
  expect(JSON.stringify(queue)).toBe(before);
  expect(Object.keys(slot.ros)).toEqual([]);
});

test('form reads are skipped while controls are being replaced during a robot switch', () => {
  const { sender, standby } = load(); standby();
  sender._updatingActionForm = true;
  expect(sender.readCurrentAction()).toBeNull();
});
