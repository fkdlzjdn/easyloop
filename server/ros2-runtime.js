const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { validateStringField, validateNumberField, VALIDATION_LIMITS, badRequest } = require('./validation');

const PROBE = "bash -ic 'echo EASYLOOP_ROS_VERSION=${ROS_VERSION:-}; echo EASYLOOP_ROS_DISTRO=${ROS_DISTRO:-}; echo EASYLOOP_ROS2_PATH=$(command -v ros2 || true); command -v ros2 >/dev/null && echo EASYLOOP_HAS_ROS2=1; command -v rostopic >/dev/null && echo EASYLOOP_HAS_ROS1=1'";
const SESSION_TTL_MS = 10 * 60 * 1000;
const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;

function execSsh(conn, command, timeoutMs = 12000) {
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
      stream.on('data', chunk => { output += chunk.toString(); });
      stream.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 512); });
      stream.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0 && !output.includes('EASYLOOP_')) {
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
  const rosMajor = values.EASYLOOP_ROS_VERSION === '2' ? 2
    : values.EASYLOOP_ROS_VERSION === '1' ? 1
      : values.EASYLOOP_HAS_ROS2 === '1' && values.EASYLOOP_HAS_ROS1 !== '1' ? 2
        : values.EASYLOOP_HAS_ROS1 === '1' && values.EASYLOOP_HAS_ROS2 !== '1' ? 1 : null;
  const ros2Path = values.EASYLOOP_ROS2_PATH || '';
  const ros2Distro = /^\/opt\/ros\/([a-z0-9_-]+)\/bin\/ros2$/.exec(ros2Path)?.[1] || '';
  return {
    rosMajor,
    distro: values.EASYLOOP_ROS_DISTRO || '',
    hasRos1: values.EASYLOOP_HAS_ROS1 === '1',
    hasRos2: values.EASYLOOP_HAS_ROS2 === '1',
    ros2Distro
  };
}

function createRos2Runtime({ createSSHConnection, WebSocket, getAuthToken }) {
  const router = express.Router();
  const sessions = new Map();
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const script = fs.readFileSync(path.join(__dirname, 'ros2-ssh-bridge.py'), 'utf8');
  const encodedScript = Buffer.from(script).toString('base64');
  const runner = `import base64;exec(compile(base64.b64decode("${encodedScript}"),"easyloop_ros2_bridge","exec"))`;
  const startCommand = session => {
    const setup = session.ros2Distro
      ? `source /opt/ros/${session.ros2Distro}/setup.bash; ` : '';
    const workspace = 'if [ -f "$HOME/ros2_ws/install/setup.bash" ]; then source "$HOME/ros2_ws/install/setup.bash"; fi; ';
    return `bash -ic ${shellQuote(`${setup}${workspace}python3 -u -c ${shellQuote(runner)}`)}`;
  };

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
    const { host, port = 22, username = 'syscon', password = '', mode = 'auto' } = req.body || {};
    const hostError = validateStringField('host', host, { required: true, maxLength: VALIDATION_LIMITS.host });
    const userError = validateStringField('username', username, { required: true, maxLength: VALIDATION_LIMITS.username });
    const portError = validateNumberField('port', port, { min: 1, max: 65535 });
    const passwordError = validateStringField('password', password, { maxLength: VALIDATION_LIMITS.command, allowEmpty: true });
    if (hostError || userError || portError || passwordError || !['auto', 'ros2'].includes(mode)) {
      return badRequest(res, hostError || userError || portError || passwordError || 'Invalid ROS mode');
    }
    if (sessions.size >= 32) return res.status(429).json({ success: false, message: 'ROS2 session limit reached' });
    let conn;
    try {
      conn = await new Promise((resolve, reject) => {
        const client = createSSHConnection(
          { host, port, username, password },
          () => resolve(client),
          error => reject(new Error(error.message || 'SSH authentication failed'))
        );
      });
      const info = parseProbe(await execSsh(conn, PROBE));
      if (mode === 'ros2' && info.hasRos2) info.rosMajor = 2;
      if (!info.rosMajor) throw new Error('ROS1/ROS2 runtime을 확정할 수 없습니다. 수동 모드를 선택하세요.');
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, {
        conn, owner: getAuthToken(req), ...info, createdAt: Date.now(), channels: new Set()
      });
      return res.json({ success: true, sessionId, ...info });
    } catch (error) {
      try { conn?.end(); } catch (closeError) { /* ignore */ }
      return res.json({ success: false, message: error.message });
    }
  });

  router.post('/close', (req, res) => {
    const session = sessions.get(req.body?.sessionId);
    if (session && session.owner !== getAuthToken(req)) return res.sendStatus(403);
    closeSession(req.body?.sessionId);
    return res.json({ success: true });
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

module.exports = { createRos2Runtime, parseProbe, execSsh };
