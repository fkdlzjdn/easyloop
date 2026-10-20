const fs = require('fs'), path = require('path'), vm = require('vm');

function harness() {
  const sockets = [], topics = [], elements = new Map();
  class Ros {
    constructor(options) { this.options = options; this.handlers = {}; sockets.push(this); }
    on(event, callback) { this.handlers[event] = callback; }
    emit(event) { this.handlers[event]?.(); }
    close() { this.closed = true; this.emit('close'); }
  }
  class Topic {
    constructor(options) { Object.assign(this, options); this.options = options; topics.push(this); }
    subscribe(callback) { this.callback = callback; }
    unsubscribe() { this.unsubscribed = true; }
  }
  const main = {}, slot = { robotId: 'R_006', ip: '192.168.20.56', connected: true, ros: main,
    rosUrl: 'ws://localhost:3000/ws-ros2?session=readonly-test', subscriptions: {} };
  const app = { activeSlotIndex: 0, robotSlots: [slot] };
  const context = { App: app, ROSLIB: { Ros, Topic }, Date, console, setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem() { return null; }, setItem() {} },
    document: { addEventListener() {}, getElementById: id => elements.get(id) || null } };
  const manager = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/ros-manager.js'), 'utf8') + '\nRosManager', context);
  manager.requestRender = jest.fn();
  const subscribe = (key, callback = jest.fn()) => {
    manager._subscribeSlotTopic(0, key, `/R_006/${key}`, 'sensor_msgs/LaserScan', callback);
    return callback;
  };
  return { manager, slot, main, app, sockets, topics, elements, subscribe };
}

describe('low-latency LaserScan subscriptions', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('all three scan sources use one dedicated channel with a bounded visual queue', () => {
    const h = harness();
    for (const key of ['lidar', 'lidar-front', 'lidar-rear']) h.subscribe(key);
    expect(h.sockets).toHaveLength(1);
    const old = { ...h.slot.subscriptions };
    h.sockets[0].emit('connection');
    for (const key of ['lidar', 'lidar-front', 'lidar-rear']) {
      expect(old[key].unsubscribed).toBe(true);
      expect(h.slot.subscriptions[key]).toMatchObject({ ros: h.sockets[0], throttle_rate: 25, queue_length: 1 });
    }
    h.manager._subscribeSlotTopic(0, 'map', '/R_006/map', 'nav_msgs/OccupancyGrid', jest.fn());
    expect(h.slot.subscriptions.map.ros).toBe(h.main);
  });

  test('late messages from a replaced subscription and connection cannot overwrite current data', () => {
    const h = harness(), callback = h.subscribe('lidar');
    const old = h.slot.subscriptions.lidar;
    h.sockets[0].emit('connection');
    const current = h.slot.subscriptions.lidar;
    old.callback({ header: { stamp: { sec: 10, nanosec: 0 } } });
    expect(callback).not.toHaveBeenCalled();
    current.callback({ header: { stamp: { sec: 11, nanosec: 0 } } });
    expect(callback).toHaveBeenCalledTimes(1);
    h.slot.ros = {};
    current.callback({ header: { stamp: { sec: 12, nanosec: 0 } } });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('rejects duplicate/out-of-order stamps without freezing after a ROS clock reset', () => {
    const h = harness(), callback = h.subscribe('lidar');
    const send = seconds => h.slot.subscriptions.lidar.callback({ header: { stamp: { secs: seconds, nsecs: 0 } } });
    send(10); send(10); send(9); send(11);
    expect(callback).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1001); send(1); send(2);
    expect(callback).toHaveBeenCalledTimes(4);
  });

  test('a channel failure falls back to the current main connection and retries only while active', () => {
    const h = harness(); h.subscribe('lidar'); h.sockets[0].emit('connection');
    h.sockets[0].emit('close');
    expect(h.slot.subscriptions.lidar.ros).toBe(h.main);
    jest.advanceTimersByTime(h.manager.SCAN_RECONNECT_MS);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].emit('connection'); h.sockets[1].emit('close'); h.app.activeSlotIndex = -1;
    jest.advanceTimersByTime(h.manager.SCAN_RECONNECT_MS);
    expect(h.sockets).toHaveLength(2);
  });

  test('turning off the last scan closes its socket and prevents reconnecting it', () => {
    const h = harness();
    for (const key of ['lidar', 'lidar-front', 'lidar-rear']) {
      h.elements.set(`chk-${key}`, { checked: true }); h.subscribe(key);
    }
    h.sockets[0].emit('connection'); h.manager.setupCheckboxHandlers();
    for (const key of ['lidar', 'lidar-front', 'lidar-rear']) {
      const box = h.elements.get(`chk-${key}`); box.checked = false; box.onchange();
    }
    expect(h.slot.scanRos).toBeNull(); expect(h.sockets[0].closed).toBe(true);
    jest.advanceTimersByTime(5000); expect(h.sockets).toHaveLength(1);
  });

  test('making a robot passive closes its scan socket and clears subscription history', () => {
    const h = harness(); h.subscribe('lidar'); h.sockets[0].emit('connection');
    h.manager.unsubscribeSlotData(0, false);
    expect(h.sockets[0].closed).toBe(true); expect(h.slot.subscriptions).toEqual({});
    expect(h.slot.scanMessageState).toEqual({});
    jest.advanceTimersByTime(5000); expect(h.sockets).toHaveLength(1);
  });
});
