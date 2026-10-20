const fs = require('fs'), path = require('path'), vm = require('vm');

function harness(ros2 = true) {
  const sockets = [], wire = [], statuses = [];
  class Socket {
    constructor() { this.readyState = 1; sockets.push(this); }
    send(raw) { wire.push(JSON.parse(raw)); }
    close() { this.readyState = 3; }
  }
  Socket.OPEN = 1;
  const context = { WebSocket: Socket, self: { postMessage: m => statuses.push(m), close: jest.fn() },
    setInterval: jest.fn(() => 1), clearInterval: jest.fn(), setTimeout: jest.fn(), clearTimeout: jest.fn(), Date };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/jog-publisher-worker.js'), 'utf8'), context);
  const send = data => context.self.onmessage({ data });
  send({ type: 'configure', url: 'ws://mock-only/ws-ros2', topic: '/R_006/cmd_vel_teleop',
    messageType: 'geometry_msgs/msg/Twist', waitForRos2Ready: ros2 });
  return { send, socket: sockets[0], wire, statuses, tick: () => context.setInterval.mock.calls.at(-1)[0]() };
}

describe('Jog Worker ROS2 transport readiness', () => {
  test('an open SSH WebSocket must not queue a held command or a stop before rclpy is ready', () => {
    const h = harness(); h.socket.onopen();
    h.send({ type: 'command', active: true, velocity: { lx: 0.05 } });
    h.send({ type: 'stop' });
    expect(h.wire).toEqual([]);
    expect(h.statuses.at(-1).state).toBe('bridge-starting');
    h.socket.onmessage({ data: JSON.stringify({ op: 'status', level: 'info', msg: 'ROS2 bridge ready' }) });
    expect(h.statuses.at(-1).state).toBe('ready');
    expect(h.wire.filter(m => m.op === 'publish')).toEqual([]);
    h.send({ type: 'command', active: true, velocity: { lx: 0.05 } });
    expect(h.wire.at(-1)).toMatchObject({ op: 'publish', type: 'geometry_msgs/msg/Twist',
      topic: '/R_006/cmd_vel_teleop', msg: { linear: { x: 0.05 } } });
  });
  test('a bridge rejection is surfaced and disables further publications', () => {
    const h = harness(); h.socket.onopen();
    h.socket.onmessage({ data: JSON.stringify({ op: 'status', level: 'info', msg: 'ROS2 bridge ready' }) });
    h.send({ type: 'command', active: true, velocity: { lx: 0.05 } });
    h.socket.onmessage({ data: JSON.stringify({ op: 'status', level: 'error', msg: 'Local bringup has ended' }) });
    const count = h.wire.length;
    h.send({ type: 'command', active: true, velocity: { lx: 0.05 } });
    expect(h.wire).toHaveLength(count);
    expect(h.statuses.at(-1)).toMatchObject({ state: 'error', detail: 'Local bringup has ended' });
  });
  test('ROS1 keeps its established rosbridge open behavior', () => {
    const h = harness(false); h.socket.onopen();
    expect(h.statuses.at(-1).state).toBe('ready');
    h.send({ type: 'command', active: true, velocity: { az: 0.1 } });
    expect(h.wire.at(-1).msg.angular.z).toBe(0.1);
  });
});

describe('Jog Worker owns release deceleration', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  function moving() {
    const h = harness(false); h.socket.onopen();
    h.send({ type: 'command', active: true, velocity: { lx: 0.2, ly: -0.1, az: 0.5 } });
    h.send({ type: 'decelerate', id: 1, durationMs: 500, velocity: { lx: 0.2, ly: -0.1, az: 0.5 } });
    return h;
  }
  test('keeps ramping at 20Hz using only heartbeat messages from the UI, and ends at exact zero', () => {
    const h = moving(); let last = 0.2;
    for (let t = 50; t < 500; t += 50) {
      jest.advanceTimersByTime(50); h.send({ type: 'heartbeat' }); h.tick();
      const value = h.wire.at(-1).msg;
      expect(value.linear.x).toBeGreaterThan(0); expect(value.linear.x).toBeLessThan(last);
      expect(value.linear.y / value.linear.x).toBeCloseTo(-0.5);
      expect(value.angular.z / value.linear.x).toBeCloseTo(2.5); last = value.linear.x;
    }
    jest.advanceTimersByTime(50); h.tick(); expect(h.wire.at(-1).msg.linear.x).toBe(0);
    expect(h.statuses.at(-1)).toEqual({ type: 'deceleration-complete', id: 1 });
    const count = h.wire.length; h.tick(); expect(h.wire).toHaveLength(count);
  });
  test('a stalled UI cannot suspend the ramp, and the original 350ms heartbeat watchdog still forces zero', () => {
    const h = moving();
    jest.advanceTimersByTime(250); h.tick(); expect(h.wire.at(-1).msg.linear.x).toBeCloseTo(0.1);
    jest.advanceTimersByTime(150); h.tick(); expect(h.wire.at(-1).msg.linear.x).toBe(0);
    expect(h.statuses.at(-1).state).toBe('lease-expired');
  });
  test('repeated release cannot extend the ramp and STOP or fresh input cancels it', () => {
    const h = moving(); jest.advanceTimersByTime(250); h.tick();
    h.send({ type: 'decelerate', durationMs: 500, velocity: { lx: 0.2 } });
    h.send({ type: 'heartbeat' }); jest.advanceTimersByTime(250); h.tick();
    expect(h.wire.at(-1).msg.linear.x).toBe(0);
    h.send({ type: 'command', active: true, velocity: { lx: 0.1 } });
    expect(h.wire.at(-1).msg.linear.x).toBe(0.1);
    h.send({ type: 'stop' }); expect(h.wire.at(-1).msg.linear.x).toBe(0);
    const count = h.wire.length; h.tick(); expect(h.wire).toHaveLength(count);
  });
});
