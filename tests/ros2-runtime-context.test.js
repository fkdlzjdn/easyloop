const { EventEmitter } = require('events');
const { createRos2Runtime, parseFastProbe } = require('../server/ros2-runtime');

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
        if (command.includes('EASYLOOP_FAST_RUNTIME=') && probe.startsWith('EASYLOOP_FAST_RUNTIME=')) stream.emit('data', Buffer.from(probe));
        else if (command.includes('EASYLOOP_ROS_VERSION')) stream.emit('data', Buffer.from(probe));
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
const fastSnapshot = () => 'EASYLOOP_FAST_RUNTIME=' + JSON.stringify({ pid: '1234', robotId: 'R_006', distro: 'jazzy',
  python: '/usr/bin/python3.12', runtimeEnvironment: { ROS_VERSION: '2', ROS_DISTRO: 'jazzy', ROS_DOMAIN_ID: '6',
    PATH: '/usr/bin', PYTHONPATH: '/opt/ros/jazzy/lib/python3.12/site-packages',
    LD_LIBRARY_PATH: '/opt/ros/jazzy/lib', UNRELATED_SECRET: 'must-not-copy',
    CYCLONEDDS_URI: "file:///tmp/robot config 'quoted'.xml" } });

describe('ROS2 local runtime identity and DDS context', () => {
  test('the verified process environment avoids repeated setup and never exposes runtime paths or unrelated variables', async () => {
    const { runtime, invoke, commands } = harness(fastSnapshot());
    const prepared = await invoke('/prepare', config);
    expect(prepared).toMatchObject({ success: true, startupMethod: 'bringup-environment', controlEnabled: true });
    expect(prepared.runtimeEnvironment).toBeUndefined(); expect(prepared.runtimePython).toBeUndefined();
    expect(commands).toHaveLength(1);
    expect(runtime.sessions.get(prepared.sessionId).runtimeEnvironment.UNRELATED_SECRET).toBeUndefined();
    await invoke('/exec', { sessionId: prepared.sessionId, command: 'ros2 node list' });
    expect(commands.at(-1)).toContain('/bin/bash --noprofile --norc');
    expect(commands.at(-1)).not.toContain('source '); expect(commands.at(-1)).not.toContain('must-not-copy');
    expect(commands.at(-1)).toContain("'\\''quoted'\\''");
    await invoke('/close', { sessionId: prepared.sessionId });
  });
  test('fast startup keeps RID and Domain mismatches blocked', async () => {
    const h = harness(fastSnapshot());
    expect((await h.invoke('/prepare', { ...config, robotId: 'R_025' })).success).toBe(false);
    expect((await h.invoke('/prepare', { ...config, domainId: 25 })).success).toBe(false);
    expect(h.runtime.sessions.size).toBe(0);
  });
  test('an incomplete, ambiguous or malformed fast probe falls back to established shell discovery', () => {
    expect(parseFastProbe('EASYLOOP_FAST_RUNTIME=null')).toBeNull();
    expect(parseFastProbe(fastSnapshot().replace('python3.12', 'python3;bad'))).toBeNull();
    expect(parseFastProbe(fastSnapshot().replace('"ROS_VERSION":"2"', '"ROS_VERSION":"1"'))).toBeNull();
  });
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
