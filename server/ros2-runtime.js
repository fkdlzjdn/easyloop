const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { validateStringField, validateNumberField, VALIDATION_LIMITS, badRequest } = require('./validation');

const PROBE = "bash -ic 'echo EASYLOOP_ROS_VERSION=${ROS_VERSION:-}; echo EASYLOOP_ROS_DISTRO=${ROS_DISTRO:-}; echo EASYLOOP_ROS2_PATH=$(command -v ros2 || true); command -v ros2 >/dev/null && echo EASYLOOP_HAS_ROS2=1; command -v rostopic >/dev/null && echo EASYLOOP_HAS_ROS1=1'";
const SESSION_TTL_MS = 10 * 60 * 1000;
const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
const ENV_KEYS = ['ROS_DOMAIN_ID', 'RMW_IMPLEMENTATION', 'CYCLONEDDS_URI', 'ROS_AUTOMATIC_DISCOVERY_RANGE', 'ROS_LOCALHOST_ONLY', 'ROS_HOSTNAME'];
const RUNTIME_ENV_KEYS = new Set([...ENV_KEYS, 'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'PYTHONPATH', 'PYTHONHOME', 'PYTHONNOUSERSITE', 'LD_LIBRARY_PATH', 'AMENT_PREFIX_PATH', 'CMAKE_PREFIX_PATH',
  'COLCON_PREFIX_PATH', 'ROS_VERSION', 'ROS_DISTRO', 'ROS_STATIC_PEERS', 'ROS_DISCOVERY_SERVER',
  'FASTDDS_DEFAULT_PROFILES_FILE', 'FASTRTPS_DEFAULT_PROFILES_FILE', 'RMW_FASTRTPS_USE_QOS_FROM_XML',
  'ROS_SECURITY_ENABLE', 'ROS_SECURITY_KEYSTORE', 'ROS_SECURITY_STRATEGY']);
const liveProbe = `import os,pathlib
keys=${JSON.stringify(ENV_KEYS)}
env=dict(os.environ)
source='shell'
robot=''
pid=''
for entry in sorted(pathlib.Path('/proc').iterdir(), key=lambda p: int(p.name) if p.name.isdigit() else 0):
 if not entry.name.isdigit(): continue
 try:
  argv=[arg.decode(errors='replace') for arg in (entry/'cmdline').read_bytes().split(b'\\x00') if arg]
  if not any(os.path.basename(arg)=='ros2' and argv[i+1:i+3]==['launch','spx_bringup'] for i,arg in enumerate(argv)): continue
  env.update(dict(item.split('=',1) for item in (entry/'environ').read_bytes().decode().split('\\x00') if '=' in item))
  robot=next((arg.split(':=',1)[1] for arg in argv if arg.startswith('ns:=')),env.get('ROS_HOSTNAME',''))
  pid=entry.name
  source='bringup'
  break
 except (OSError,ValueError): pass
for key in keys:
 if key in env: print('EASYLOOP_ENV_'+key+'='+env[key])
print('EASYLOOP_ENV_SOURCE='+source)
print('EASYLOOP_LOCAL_ROBOT='+robot)
print('EASYLOOP_LOCAL_PID='+pid)
if source=='bringup': print('EASYLOOP_LOCAL_DISTRO='+env.get('ROS_DISTRO',''))`;

function execSsh(conn, command, timeoutMs = 12000, allowProbeExit = true) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) return reject(error);
      let output = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        stream.close();
        reject(new Error('ROS runtime probe timed out'));
      }, timeoutMs);
      stream.on('data', chunk => {
        output += chunk.toString();
        if (output.length > 65536) stream.close();
      });
      stream.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 512); });
      stream.on('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      stream.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0 && !(allowProbeExit && output.includes('EASYLOOP_'))) {
          reject(new Error(stderr.trim() || `probe exited ${code}`));
        } else resolve(output);
      });
    });
  });
}

function parseProbe(output) {
  const values = Object.fromEntries(String(output).split(/\r?\n/)
    .filter(line => line.startsWith('EASYLOOP_'))
    .map(line => line.split(/=(.*)/s).slice(0, 2)));
  const rosMajor = values.EASYLOOP_ENV_SOURCE === 'bringup' ? 2 : values.EASYLOOP_ROS_VERSION === '2' ? 2
    : values.EASYLOOP_ROS_VERSION === '1' ? 1
      : values.EASYLOOP_HAS_ROS2 === '1' && values.EASYLOOP_HAS_ROS1 !== '1' ? 2
        : values.EASYLOOP_HAS_ROS1 === '1' && values.EASYLOOP_HAS_ROS2 !== '1' ? 1 : null;
  const ros2Path = values.EASYLOOP_ROS2_PATH || '';
  const liveDistro = /^[a-z0-9_-]+$/.test(values.EASYLOOP_LOCAL_DISTRO || '') ? values.EASYLOOP_LOCAL_DISTRO : '';
  const ros2Distro = liveDistro || /^\/opt\/ros\/([a-z0-9_-]+)\/bin\/ros2$/.exec(ros2Path)?.[1] || '';
  return {
    rosMajor,
    distro: liveDistro || values.EASYLOOP_ROS_DISTRO || '',
    hasRos1: values.EASYLOOP_HAS_ROS1 === '1',
    hasRos2: values.EASYLOOP_HAS_ROS2 === '1',
    ros2Distro,
    environment: Object.fromEntries(ENV_KEYS.filter(key => values[`EASYLOOP_ENV_${key}`] !== undefined)
      .map(key => [key, values[`EASYLOOP_ENV_${key}`]])),
    environmentSource: values.EASYLOOP_ENV_SOURCE || 'shell',
    localRobotId: values.EASYLOOP_LOCAL_ROBOT || '',
    localPid: /^\d+$/.test(values.EASYLOOP_LOCAL_PID || '') ? values.EASYLOOP_LOCAL_PID : '',
    controlEnabled: values.EASYLOOP_ENV_SOURCE === 'bringup' && Boolean(values.EASYLOOP_LOCAL_ROBOT)
  };
}

function parseFastProbe(output) {
  try {
    const line = String(output).split(/\r?\n/).find(item => item.startsWith('EASYLOOP_FAST_RUNTIME='));
    const result = JSON.parse(line?.slice('EASYLOOP_FAST_RUNTIME='.length) || 'null');
    if (!result || !/^\d+$/.test(result.pid) || !/^R_\d{3,}$/.test(result.robotId)
        || !/^[a-z0-9_-]+$/.test(result.distro) || !/^\/[\w/.-]+$/.test(result.python)
        || !result.runtimeEnvironment || result.runtimeEnvironment.ROS_VERSION !== '2'
        || result.runtimeEnvironment.ROS_DISTRO !== result.distro) return null;
    const runtimeEnvironment = Object.fromEntries(Object.entries(result.runtimeEnvironment)
      .filter(([key, value]) => RUNTIME_ENV_KEYS.has(key) && typeof value === 'string' && !value.includes('\0')));
    if (typeof runtimeEnvironment.PATH !== 'string' || typeof runtimeEnvironment.PYTHONPATH !== 'string') return null;
    return { rosMajor: 2, hasRos2: true, hasRos1: false, distro: result.distro, ros2Distro: result.distro,
      environment: Object.fromEntries(ENV_KEYS.filter(key => runtimeEnvironment[key] !== undefined).map(key => [key, runtimeEnvironment[key]])),
      environmentSource: 'bringup', localRobotId: result.robotId, localPid: result.pid, controlEnabled: true,
      runtimeEnvironment, runtimePython: result.python, startupMethod: 'bringup-environment' };
  } catch (_error) { return null; }
}

function createRos2Runtime({ createSSHConnection, WebSocket, getAuthToken }) {
  const router = express.Router();
  const sessions = new Map();
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const script = fs.readFileSync(path.join(__dirname, 'ros2-ssh-bridge.py'), 'utf8');
  const encodedScript = Buffer.from(script).toString('base64');
  const runner = `import base64;exec(compile(base64.b64decode("${encodedScript}"),"easyloop_ros2_bridge","exec"))`;
  const fastProbe = fs.readFileSync(path.join(__dirname, 'ros2-runtime-probe.py'), 'utf8');
  const environmentCommand = session => {
    const setup = session.ros2Distro
      ? `source /opt/ros/${session.ros2Distro}/setup.bash; ` : '';
    const workspace = 'if [ -f "$HOME/ros2_ws/install/setup.bash" ]; then source "$HOME/ros2_ws/install/setup.bash"; fi; ';
    const environment = { ...session.environment, EASYLOOP_ROBOT_ID: session.robotId || '',
      EASYLOOP_CONTROL_ENABLED: session.controlEnabled ? '1' : '0', EASYLOOP_LOCAL_PID: session.localPid || '' };
    const exports = Object.entries(environment).map(([key, value]) => `export ${key}=${shellQuote(value)}; `).join('');
    return `${setup}${workspace}${exports}`;
  };
  const runtimeCommand = (session, command) => {
    if (!session.runtimeEnvironment) return `bash -ic ${shellQuote(environmentCommand(session) + command)}`;
    const env = { ...session.runtimeEnvironment, ...session.environment, EASYLOOP_ROBOT_ID: session.robotId || '',
      EASYLOOP_CONTROL_ENABLED: session.controlEnabled ? '1' : '0', EASYLOOP_LOCAL_PID: session.localPid || '' };
    return `env -i ${Object.entries(env).map(([key, value]) => shellQuote(`${key}=${value}`)).join(' ')} /bin/bash --noprofile --norc -c ${shellQuote(command)}`;
  };
  const startCommand = session => runtimeCommand(session, `exec ${shellQuote(session.runtimePython || 'python3')} -u -c ${shellQuote(runner)}`);

  function closeSession(id) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    for (const channel of session.channels) {
      if (channel.ws.readyState === WebSocket.OPEN) channel.ws.close();
      try { channel.stream?.close(); } catch (error) { /* already closed */ }
    }
    try { session.conn.end(); } catch (error) { /* already closed */ }
  }

  router.post('/prepare', async (req, res) => {
    const { host, port = 22, username = 'syscon', password = '', mode = 'auto', robotId = '', domainId } = req.body || {};
    const hostError = validateStringField('host', host, { required: true, maxLength: VALIDATION_LIMITS.host });
    const userError = validateStringField('username', username, { required: true, maxLength: VALIDATION_LIMITS.username });
    const portError = validateNumberField('port', port, { min: 1, max: 65535 });
    const passwordError = validateStringField('password', password, { maxLength: VALIDATION_LIMITS.command, allowEmpty: true });
    const robotError = robotId && !/^R_\d{3,}$/.test(robotId) ? 'Invalid robotId' : null;
    const domainError = domainId === undefined ? null : validateNumberField('domainId', domainId, { min: 0, max: 232 });
    if (hostError || userError || portError || passwordError || robotError || domainError || !['auto', 'ros2'].includes(mode)) {
      return badRequest(res, hostError || userError || portError || passwordError || robotError || domainError || 'Invalid ROS mode');
    }
    if (sessions.size >= 32) return res.status(429).json({ success: false, message: 'ROS2 session limit reached' });
    let conn;
    try {
      conn = await new Promise((resolve, reject) => {
        const client = createSSHConnection(
          { host, port, username, password },
          () => resolve(client),
          error => reject(Object.assign(new Error(error.message || 'SSH authentication failed'), { needPassword: error.needPassword }))
        );
      });
      const probeCommand = `${PROBE}; bash -ic ${shellQuote(`python3 -c ${shellQuote(liveProbe)}`)}`;
      let info = null;
      try { info = parseFastProbe(await execSsh(conn, `python3 -B -c ${shellQuote(fastProbe)}`)); } catch (_error) { /* legacy shell fallback */ }
      if (!info) info = parseProbe(await execSsh(conn, probeCommand));
      if (mode === 'ros2' && info.hasRos2) info.rosMajor = 2;
      if (!info.rosMajor) throw new Error('ROS1/ROS2 runtime을 확정할 수 없습니다. 수동 모드를 선택하세요.');
      const selectedRobotId = robotId || info.localRobotId;
      if (info.rosMajor === 2 && !selectedRobotId) throw new Error('ROS2 연결에는 RID를 지정해야 합니다.');
      if (info.rosMajor === 2 && info.localRobotId && selectedRobotId !== info.localRobotId) {
        throw new Error(`선택한 RID ${selectedRobotId}와 IPC bringup namespace ${info.localRobotId}가 다릅니다.`);
      }
      if (domainId !== undefined) {
        if (info.controlEnabled && String(domainId) !== (info.environment.ROS_DOMAIN_ID || '0')) {
          throw new Error(`입력한 Domain ${domainId}와 IPC bringup Domain ${info.environment.ROS_DOMAIN_ID || '0'}가 다릅니다.`);
        }
        info.environment.ROS_DOMAIN_ID = String(domainId);
      }
      if (info.rosMajor === 2 && !info.runtimeEnvironment) {
        const preflight = `import rclpy; from rclpy.action import ActionClient; from rosidl_runtime_py.utilities import get_message; print('EASYLOOP_BRIDGE_READY=1')`;
        const ready = await execSsh(conn, `bash -ic ${shellQuote(`${environmentCommand({ ...info, robotId: selectedRobotId })}python3 -c ${shellQuote(preflight)}`)}`);
        if (!ready.includes('EASYLOOP_BRIDGE_READY=1')) throw new Error('ROS2 Python runtime을 불러올 수 없습니다. ROS2 workspace 환경을 확인하세요.');
      }
      const sessionId = crypto.randomUUID();
      if (sessions.size >= 32) throw new Error('ROS2 session limit reached');
      sessions.set(sessionId, {
        conn, owner: getAuthToken(req), ...info, robotId: selectedRobotId, createdAt: Date.now(), channels: new Set()
      });
      conn.on?.('close', () => closeSession(sessionId));
      // Runtime paths stay server-side; only the established DDS context is public.
      const publicInfo = Object.fromEntries(Object.entries(info)
        .filter(([key]) => !['runtimeEnvironment', 'runtimePython'].includes(key)));
      return res.json({ success: true, sessionId, ...publicInfo });
    } catch (error) {
      try { conn?.end(); } catch (closeError) { /* ignore */ }
      return res.json({ success: false, message: error.message, needPassword: Boolean(error.needPassword) });
    }
  });

  router.post('/close', (req, res) => {
    const session = sessions.get(req.body?.sessionId);
    if (session && session.owner !== getAuthToken(req)) return res.sendStatus(403);
    closeSession(req.body?.sessionId);
    return res.json({ success: true });
  });

  // Execute ROS2 inspection/bag commands using exactly the connected domain,
  // workspace and SSH owner. Never accidentally use another selected robot.
  router.post('/exec', async (req, res) => {
    const session = sessions.get(req.body?.sessionId);
    if (!session || session.owner !== getAuthToken(req) || session.rosMajor !== 2) return res.sendStatus(403);
    const error = validateStringField('command', req.body?.command, { required: true, maxLength: VALIDATION_LIMITS.command });
    if (error) return badRequest(res, error);
    try {
      const output = await execSsh(session.conn,
        runtimeCommand(session, req.body.command), 30000, false);
      return res.json({ success: true, stdout: output, stderr: '', exitCode: 0 });
    } catch (failure) {
      return res.json({ success: false, message: failure.message });
    }
  });

  function handleUpgrade(req, socket, head) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session');
    const session = sessions.get(sessionId);
    if (!session || session.owner !== getAuthToken(req) || session.rosMajor !== 2) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (session.channels.size >= 8) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    session.createdAt = Date.now();
    wss.handleUpgrade(req, socket, head, ws => {
      const channel = { ws, stream: null };
      session.channels.add(channel);
      const queued = [];
      session.conn.exec(startCommand(session), (error, stream) => {
        if (error) return ws.close(1011, 'ROS2 SSH bridge start failed');
        if (ws.readyState !== WebSocket.OPEN) return stream.close();
        channel.stream = stream;
        queued.splice(0).forEach(message => stream.write(message));
        let buffer = '';
        stream.on('data', chunk => {
          buffer += chunk.toString();
          let split;
          while ((split = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, split);
            buffer = buffer.slice(split + 1);
            if (line.length > 50 * 1024 * 1024) return ws.close(1009, 'ROS2 frame too large');
            if (line && ws.readyState === WebSocket.OPEN) {
              if (ws.bufferedAmount > 32 * 1024 * 1024) {
                ws.close(1013, 'ROS2 stream backpressure');
                return;
              }
              if (ws.bufferedAmount > 8 * 1024 * 1024) stream.pause();
              ws.send(line, sendError => {
                if (sendError) ws.close(1011, 'ROS2 stream send failed');
                else if (stream.isPaused() && ws.bufferedAmount < 4 * 1024 * 1024) stream.resume();
              });
            }
          }
          if (buffer.length > 55 * 1024 * 1024) ws.close(1009, 'ROS2 frame too large');
        });
        stream.stderr.on('data', chunk => {
          const message = chunk.toString().trim();
          if (message && !message.includes('no job control')) console.warn('[ROS2 bridge]', message.slice(0, 300));
        });
        stream.on('error', () => ws.close(1011, 'ROS2 SSH stream failed'));
        stream.on('close', () => {
          channel.stream = null;
          if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'ROS2 SSH bridge exited');
        });
      });
      ws.on('message', data => {
        const message = data.toString();
        if (message.length > 4 * 1024 * 1024) return ws.close(1009);
        if (channel.stream) channel.stream.write(message + '\n');
        else if (queued.length < 100) queued.push(message + '\n');
      });
      ws.on('error', () => {
        try { channel.stream?.close(); } catch (error) { /* already closed */ }
      });
      ws.on('close', () => {
        try { channel.stream?.close(); } catch (error) { /* ignore */ }
        channel.stream = null;
        session.channels.delete(channel);
        session.createdAt = Date.now();
      });
    });
  }

  const cleanup = setInterval(() => {
    for (const [id, session] of sessions) {
      if (session.channels.size === 0 && Date.now() - session.createdAt > SESSION_TTL_MS) {
        closeSession(id);
      }
    }
  }, 60000);
  cleanup.unref?.();

  return { router, handleUpgrade, closeSession, parseProbe, sessions };
}

module.exports = { createRos2Runtime, parseProbe, parseFastProbe, execSsh };
