const EventEmitter = require('events');
const { createWebSocketForwarder } = require('../server/ws-backpressure');

function socketState() {
  const socket = new EventEmitter();
  socket.writableNeedDrain = false;
  socket.pause = jest.fn();
  socket.resume = jest.fn();
  return socket;
}

function websocket(socket = socketState()) {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.bufferedAmount = 0;
  ws._socket = socket;
  ws.send = jest.fn((_data, _options, callback) => callback?.());
  return ws;
}

describe('WebSocket proxy backpressure', () => {
  test('pauses the source until the destination drains', () => {
    const source = websocket();
    const destination = websocket();
    let sendCallback;
    destination.send.mockImplementation((_data, _options, callback) => {
      destination.bufferedAmount = 3 * 1024 * 1024;
      destination._socket.writableNeedDrain = true;
      sendCallback = callback;
    });
    const forwarder = createWebSocketForwarder(source, destination);

    source.emit('message', Buffer.from('map'), true);

    expect(source._socket.pause).toHaveBeenCalledTimes(1);
    expect(forwarder.isPaused()).toBe(true);
    destination.bufferedAmount = 0;
    destination._socket.writableNeedDrain = false;
    sendCallback();
    expect(source._socket.resume).toHaveBeenCalledTimes(1);
    expect(forwarder.isPaused()).toBe(false);
    forwarder.cleanup();
  });

  test('closes a proxy direction instead of growing an unbounded queue', () => {
    const source = websocket();
    const destination = websocket();
    const onFatal = jest.fn();
    destination.bufferedAmount = 33 * 1024 * 1024;
    const forwarder = createWebSocketForwarder(source, destination, { onFatal });

    source.emit('message', Buffer.from('next-map'), true);

    expect(destination.send).not.toHaveBeenCalled();
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'maximum buffered amount exceeded'
    }));
    forwarder.cleanup();
  });
});
