const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('dedicated Jog publisher worker', () => {
  test('publishes at its own interval and sends zero when the heartbeat lease expires', () => {
    jest.useFakeTimers();
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'jog-publisher-worker.js'),
      'utf8'
    );
    const sockets = [];
    class FakeWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        sockets.push(this);
      }
      send(payload) { this.sent.push(JSON.parse(payload)); }
      close() { this.readyState = 3; }
      open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }
    }
    FakeWebSocket.OPEN = 1;
    const self = {
      postMessage: jest.fn(),
      close: jest.fn(),
      onmessage: null
    };
    const context = {
      self,
      WebSocket: FakeWebSocket,
      Date,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    self.onmessage({ data: {
      type: 'configure',
      url: 'ws://localhost/ws-proxy?target=robot:9090',
      topic: '/R_013/cmd_vel',
      messageType: 'geometry_msgs/Twist',
      intervalMs: 50,
      leaseMs: 350,
      reconnectMs: 750
    } });
    sockets[0].open();
    self.onmessage({ data: {
      type: 'command',
      active: true,
      velocity: { lx: 0.2, ly: 0, az: 0 }
    } });

    jest.advanceTimersByTime(150);
    const moving = sockets[0].sent.filter(message =>
      message.op === 'publish' && message.msg.linear.x === 0.2
    );
    expect(moving.length).toBeGreaterThanOrEqual(3);

    jest.advanceTimersByTime(250);
    const publishes = sockets[0].sent.filter(message => message.op === 'publish');
    expect(publishes[publishes.length - 1].msg.linear.x).toBe(0);
    expect(self.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'status',
      state: 'lease-expired'
    }));
    jest.useRealTimers();
  });
});
