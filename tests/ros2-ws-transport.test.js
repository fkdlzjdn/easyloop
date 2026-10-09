const express = require('express');
const http = require('http');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { createRos2Runtime } = require('../server/ros2-runtime');

// Exercise the real HTTP/WebSocket transport with a fake SSH peer. The peer's
// split stdout frames reproduce how ssh2 actually delivers bridge JSON.
test('ROS2 graph RPC survives real WebSocket upgrade and split SSH stdout frames', async () => {
  const conn = {
    end: jest.fn(),
    exec(command, callback) {
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.close = () => stream.emit('close', 0);
      stream.isPaused = () => false;
      stream.write = input => {
        const request = JSON.parse(input.trim());
        const packet = JSON.stringify({ op: 'service_response', id: request.id, service: request.service,
          result: true, values: { topics: ['/R_006/map'], types: ['nav_msgs/msg/OccupancyGrid'] } }) + '\n';
        stream.emit('data', Buffer.from(packet.slice(0, 17)));
        setImmediate(() => stream.emit('data', Buffer.from(packet.slice(17))));
      };
      callback(null, stream);
      if (command.includes('EASYLOOP_ROS_VERSION')) process.nextTick(() => {
        stream.emit('data', Buffer.from('EASYLOOP_ROS_VERSION=2\nEASYLOOP_ROS_DISTRO=jazzy\nEASYLOOP_HAS_ROS2=1\nEASYLOOP_ROS2_PATH=/opt/ros/jazzy/bin/ros2\n'));
        stream.emit('close', 0);
      });
      else if (command.includes('EASYLOOP_BRIDGE_READY')) process.nextTick(() => {
        stream.emit('data', Buffer.from('EASYLOOP_BRIDGE_READY=1\n'));
        stream.emit('close', 0);
      });
    }
  };
  const runtime = createRos2Runtime({ createSSHConnection: (_config, ready) => { process.nextTick(ready); return conn; },
    WebSocket, getAuthToken: () => 'test-owner' });
  const app = express();
  app.use(express.json());
  app.use('/runtime', runtime.router);
  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => runtime.handleUpgrade(req, socket, head));
  let ws;
  let sessionId;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/runtime/prepare`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: '127.0.0.1', robotId: 'R_006', mode: 'ros2' }) });
    const prepared = await response.json();
    expect(prepared.success).toBe(true);
    sessionId = prepared.sessionId;
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws-ros2?session=${sessionId}`);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const result = new Promise(resolve => ws.once('message', data => resolve(JSON.parse(data.toString()))));
    ws.send(JSON.stringify({ op: 'call_service', service: '/rosapi/topics', id: 'graph-query', args: {} }));
    await expect(result).resolves.toMatchObject({ id: 'graph-query', result: true,
      values: { topics: ['/R_006/map'], types: ['nav_msgs/msg/OccupancyGrid'] } });
  } finally {
    if (ws) { const closed = new Promise(resolve => ws.once('close', resolve)); ws.close(); await closed; }
    if (sessionId) runtime.closeSession(sessionId);
    await new Promise(resolve => server.close(resolve));
  }
  expect(conn.end).toHaveBeenCalledTimes(1);
});
