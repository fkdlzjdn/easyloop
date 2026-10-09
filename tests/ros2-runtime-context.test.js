const { EventEmitter } = require('events');
const { createRos2Runtime } = require('../server/ros2-runtime');

class Socket extends EventEmitter {
  constructor() { super(); this.readyState = 1; }
  close() { this.readyState = 3; this.emit('close'); }
}
Socket.OPEN = 1;
Socket.Server = class { handleUpgrade(_req, _socket, _head, done) { done(new Socket()); } };

function harness(probe = '') {
  const commands = [];
  const conn = {
    end: jest.fn(),
    exec: (command, callback) => {
      commands.push(command);
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.close = jest.fn(() => stream.emit('close', 0));
      stream.write = jest.fn();
      callback(null, stream);
      if (!command.includes('easyloop_ros2_bridge')) process.nextTick(() => {
        if (command.includes('EASYLOOP_ROS_VERSION')) stream.emit('data', Buffer.from(probe));
        else if (command.includes('EASYLOOP_BRIDGE_READY')) stream.emit('data', Buffer.from('EASYLOOP_BRIDGE_READY=1\n'));
        else stream.emit('data', Buffer.from('query result\n'));
        stream.emit('close', 0);
      });
    }
  };
  const runtime = createRos2Runtime({
    createSSHConnection: (_config, ready) => { process.nextTick(ready); return conn; },
    WebSocket: Socket, getAuthToken: req => req.owner || 'owner'
  });
  const invoke = (path, body, owner = 'owner') => new Promise(resolve => {
    const handler = runtime.router.stack.find(layer => layer.route?.path === path).route.stack[0].handle;
    let status;
    handler({ body, owner }, { status: code => { status = code; return { json: value => resolve({ ...value, status }) }; },
      sendStatus: code => resolve({ status: code }), json: resolve });
  });
  return { runtime, invoke, conn, commands };
}

const snapshot = [
  'EASYLOOP_ROS_VERSION=2', 'EASYLOOP_ROS_DISTRO=jazzy', 'EASYLOOP_HAS_ROS2=1',
  'EASYLOOP_ROS2_PATH=/opt/ros/jazzy/bin/ros2', 'EASYLOOP_ENV_SOURCE=bringup',
  'EASYLOOP_ENV_ROS_DOMAIN_ID=6', 'EASYLOOP_ENV_RMW_IMPLEMENTATION=rmw_cyclonedds_cpp',
  'EASYLOOP_ENV_CYCLONEDDS_URI=file:///home/syscon/.config/cyclonedds/r6.xml',
  'EASYLOOP_LOCAL_ROBOT=R_006', 'EASYLOOP_LOCAL_PID=1234'
].join('\n');
const config = { host: '192.168.20.56', robotId: 'R_006', mode: 'ros2' };

describe('ROS2 local runtime identity and DDS context', () => {
  test('binds channels and exec commands to the live namespace/domain rather than shell defaults', async () => {
    const { runtime, invoke, conn, commands } = harness(snapshot);
    const prepared = await invoke('/prepare', config);
    expect(prepared).toMatchObject({ success: true, localRobotId: 'R_006', controlEnabled: true, environmentSource: 'bringup' });
    expect(prepared.environment.ROS_DOMAIN_ID).toBe('6');
    await expect(invoke('/exec', { sessionId: prepared.sessionId, command: 'ros2 node list' }))
      .resolves.toMatchObject({ success: true, stdout: 'query result\n' });
    expect(commands.at(-1)).toContain('ROS_DOMAIN_ID');
    expect(commands.at(-1)).toContain('EASYLOOP_ROBOT_ID');
    expect(commands.at(-1)).toContain('EASYLOOP_CONTROL_ENABLED');
    expect(commands.at(-1)).toContain('r6.xml');
    await invoke('/close', { sessionId: prepared.sessionId });
    expect(runtime.sessions.size).toBe(0);
    expect(conn.end).toHaveBeenCalledTimes(1);
  });

  test('rejects a different RID even if it is discoverable on the same DDS domain', async () => {
    const { invoke, conn, runtime } = harness(snapshot);
    const response = await invoke('/prepare', { ...config, robotId: 'R_001' });
    expect(response.success).toBe(false);
    expect(response.message).toContain('namespace R_006');
    expect(conn.end).toHaveBeenCalledTimes(1);
    expect(runtime.sessions.size).toBe(0);
  });

  test('rejects a domain override that could control an unrelated graph', async () => {
    const { invoke, runtime } = harness(snapshot);
    const response = await invoke('/prepare', { ...config, domainId: 7 });
    expect(response.success).toBe(false);
    expect(response.message).toContain('bringup Domain 6');
    expect(runtime.sessions.size).toBe(0);
  });

  test('keeps a stopped local bringup in observation mode', async () => {
    const { invoke } = harness(snapshot.replace('EASYLOOP_ENV_SOURCE=bringup', 'EASYLOOP_ENV_SOURCE=shell')
      .replace('EASYLOOP_LOCAL_ROBOT=R_006', 'EASYLOOP_LOCAL_ROBOT=').replace('EASYLOOP_LOCAL_PID=1234', 'EASYLOOP_LOCAL_PID='));
    const response = await invoke('/prepare', config);
    expect(response).toMatchObject({ success: true, controlEnabled: false });
    await invoke('/close', { sessionId: response.sessionId });
  });

  test('another browser owner cannot execute or close the ROS2 SSH session', async () => {
    const { invoke } = harness(snapshot);
    const prepared = await invoke('/prepare', config);
    await expect(invoke('/exec', { sessionId: prepared.sessionId, command: 'ros2 node list' }, 'someone-else')).resolves.toEqual({ status: 403 });
    await expect(invoke('/close', { sessionId: prepared.sessionId }, 'someone-else')).resolves.toEqual({ status: 403 });
    await invoke('/close', { sessionId: prepared.sessionId });
  });
});
