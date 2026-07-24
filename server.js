const express = require('express');
const compression = require('compression');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const { spawn } = require('child_process');

// pkg support: use exe directory for assets if running as packaged binary
const APP_DIR = (function() {
  // pkg sets process.pkg when running as packaged exe
  if (process.pkg) {
    return path.dirname(process.execPath); // directory where .exe lives
  }
  return __dirname;
})();

const { createRateLimiterStore } = require('./server/rate-limit');
const { createAuthMiddleware, getAuthToken, isAuthTokenValid } = require('./server/auth');
const { createAuthRouter } = require('./server/routes/auth');
const { createRobotsRouter } = require('./server/routes/robots');
const { createSshRouter } = require('./server/routes/ssh');
const { createSftpRouter } = require('./server/routes/sftp');
const { createTunnelRouter } = require('./server/routes/tunnel');
const { createCanRouter } = require('./server/routes/can');
const { createSSHConnection } = require('./server/ssh');
const { createRobotsConfigStore } = require('./server/robots-config');
const { listenOnAvailablePort, normalizePort } = require('./server/available-port');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const REQUESTED_PORT = normalizePort(process.env.PORT, 3000);

const RATE_LIMIT_CONFIG = {
  auth: { windowMs: 60 * 1000, max: 5 },
  commands: { windowMs: 60 * 1000, max: 60 },
  cleanupInterval: 200,
  staleMultiplier: 2
};

// Middleware
app.use(compression()); // P4 fix: gzip compression
app.use(express.json());
// Serve static files: try exe directory first (pkg), then __dirname (dev)
const publicDir = fs.existsSync(path.join(APP_DIR, 'public')) ? path.join(APP_DIR, 'public') : path.join(__dirname, 'public');
app.use(express.static(publicDir));
console.log(`[Static] Serving from: ${publicDir}`);

// File upload configuration
const upload = multer({ dest: os.tmpdir() });

// Store active SSH connections
const sshConnections = new Map();

// Store active auth sessions
const authSessions = new Map();

const robotsStore = createRobotsConfigStore(APP_DIR);
const rateLimiterStore = createRateLimiterStore({
  cleanupInterval: RATE_LIMIT_CONFIG.cleanupInterval,
  staleMultiplier: RATE_LIMIT_CONFIG.staleMultiplier
});
const authRateLimiter = rateLimiterStore.createRateLimiter(RATE_LIMIT_CONFIG.auth);
const commandRateLimiter = rateLimiterStore.createRateLimiter(RATE_LIMIT_CONFIG.commands);

function getSharedPassword() {
  return process.env.SHARED_PASSWORD || '';
}

const authMiddleware = createAuthMiddleware(authSessions);
let testModeProcess = null;
let rosapiProcess = null;
let roscoreProcess = null;
let roscoreStartedByUs = false;

function waitForPort(port, timeout) {
  const net = require('net');
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeout) resolve(false);
        else setTimeout(check, 500);
      });
      sock.once('timeout', () => {
        sock.destroy();
        if (Date.now() - start > timeout) resolve(false);
        else setTimeout(check, 500);
      });
      sock.connect(port, '127.0.0.1');
    };
    check();
  });
}

async function startTestModeProcess() {
  // First check if port 9090 is already listening (rosbridge already up)
  const alreadyUp = await waitForPort(9090, 1000);
  if (alreadyUp) {
    return { started: true, message: 'rosbridge already running' };
  }

  // Check if roscore is running (port 11311)
  let roscoreUp = await waitForPort(11311, 1500);
  if (!roscoreUp) {
    // Auto-start roscore
    console.log('[TestMode] roscore not running, starting automatically...');
    const rosEnvForCore = Object.assign({}, process.env, {
      HOME: os.homedir(),
      ROS_MASTER_URI: 'http://localhost:11311',
      ROS_HOSTNAME: '127.0.0.1',
      ROS_IP: '127.0.0.1',
      ROS_DISTRO: 'noetic',
      PYTHONPATH: '/opt/ros/noetic/lib/python3/dist-packages' + (process.env.PYTHONPATH ? ':' + process.env.PYTHONPATH : ''),
      LD_LIBRARY_PATH: '/opt/ros/noetic/lib:/opt/ros/noetic/lib/x86_64-linux-gnu' + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''),
      PATH: '/opt/ros/noetic/bin:' + (process.env.PATH || ''),
      ROS_PACKAGE_PATH: '/opt/ros/noetic/share'
    });
    if (roscoreProcess) {
      try { roscoreProcess.kill('SIGTERM'); } catch (e) {}
      roscoreProcess = null;
    }
    // B3 fix: detached/unref 제거 → 서버 종료 시 자식 프로세스도 함께 종료
    roscoreProcess = spawn('bash', ['-c', 'source /opt/ros/noetic/setup.bash && roscore'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: rosEnvForCore
    });
    roscoreProcess.stdout.resume();
    roscoreProcess.stderr.resume();
    roscoreProcess.on('exit', (code) => {
      console.log(`[TestMode] roscore exited with code ${code}`);
      roscoreProcess = null;
      roscoreStartedByUs = false;
    });
    roscoreStartedByUs = true;

    // Wait for roscore to be ready (up to 10s)
    roscoreUp = await waitForPort(11311, 10000);
    if (!roscoreUp) {
      return { started: false, message: 'roscore 자동 시작 실패. 수동으로 roscore를 실행해주세요.' };
    }
    console.log('[TestMode] roscore started successfully');
  }

  // Kill stale process if any
  if (testModeProcess) {
    try { testModeProcess.kill('SIGTERM'); } catch (e) {}
    testModeProcess = null;
    await new Promise(r => setTimeout(r, 500));
  }

  // Build ROS environment
  const rosEnv = Object.assign({}, process.env, {
    HOME: os.homedir(),
    ROS_MASTER_URI: 'http://localhost:11311',
    ROS_HOSTNAME: '127.0.0.1',
    ROS_IP: '127.0.0.1',
    ROS_DISTRO: 'noetic',
    PYTHONPATH: '/opt/ros/noetic/lib/python3/dist-packages' + (process.env.PYTHONPATH ? ':' + process.env.PYTHONPATH : ''),
    LD_LIBRARY_PATH: '/opt/ros/noetic/lib:/opt/ros/noetic/lib/x86_64-linux-gnu' + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : ''),
    PATH: '/opt/ros/noetic/bin:' + (process.env.PATH || ''),
    ROS_PACKAGE_PATH: '/opt/ros/noetic/share'
  });

  // Directly run rosbridge_websocket.py (bypass roslaunch/script issues)
  // Keep as child of server process (not detached) — server stays alive so child persists.
  // twisted/python needs writable stdout, so use 'pipe' and drain.
  testModeProcess = spawn('python3', [
    '/opt/ros/noetic/lib/rosbridge_server/rosbridge_websocket.py',
    '_port:=9090'
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: rosEnv
  });
  // Drain stdout/stderr to prevent buffer blocking
  testModeProcess.stdout.resume();
  testModeProcess.stderr.resume();
  testModeProcess.on('exit', (code) => {
    console.log(`[TestMode] rosbridge exited with code ${code}`);
    testModeProcess = null;
  });

  // Wait until port 9090 is listening
  const ready = await waitForPort(9090, 15000);
  if (ready) {
    // Start rosapi_node for ROS Info queries (nodes, topics, services, params)
    if (rosapiProcess) {
      try { rosapiProcess.kill('SIGTERM'); } catch (e) {}
      rosapiProcess = null;
    }
    rosapiProcess = spawn('python3', [
      '/opt/ros/noetic/lib/rosapi/rosapi_node'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: rosEnv
    });
    rosapiProcess.stdout.resume();
    rosapiProcess.stderr.resume();
    rosapiProcess.on('exit', (code) => {
      console.log(`[TestMode] rosapi exited with code ${code}`);
      rosapiProcess = null;
    });

    return { started: true, message: 'rosbridge ready' };
  } else {
    return { started: false, message: 'rosbridge 시작 timeout' };
  }
}

function stopTestModeProcess() {
  if (!testModeProcess && !rosapiProcess) {
    return { stopped: false, message: 'Test mode not running' };
  }
  try { if (testModeProcess) testModeProcess.kill('SIGTERM'); } catch (e) {}
  try { if (rosapiProcess) rosapiProcess.kill('SIGTERM'); } catch (e) {}
  testModeProcess = null;
  rosapiProcess = null;
  // Also stop roscore if we started it
  if (roscoreStartedByUs && roscoreProcess) {
    console.log('[TestMode] Stopping roscore (started by us)');
    try { process.kill(-roscoreProcess.pid, 'SIGTERM'); } catch (e) {
      try { roscoreProcess.kill('SIGTERM'); } catch (e2) {}
    }
    roscoreProcess = null;
    roscoreStartedByUs = false;
  }
  return { stopped: true, message: 'Test mode process stopped' };
}

// ==================== Download API (no auth, for Windows portable) ====================
app.get('/api/download', (req, res) => {
  const { execSync } = require('child_process');
  const tmpFile = '/tmp/easyloop.zip';
  try {
    const dirName = require('path').basename(__dirname);
    execSync(`cd ${__dirname}/.. && zip -r ${tmpFile} ${dirName} -x '${dirName}/node_modules/*' '${dirName}/.git/*' '${dirName}/.claude/*' '${dirName}/__pycache__/*' '${dirName}/.env'`, { timeout: 30000 });
    res.download(tmpFile, 'easyloop.zip');
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== API Routes ====================
app.use('/api/auth', createAuthRouter({
  authSessions,
  getSharedPassword,
  authRateLimiter
}));
app.use('/api', authMiddleware);
app.post('/api/testmode/start', async (req, res) => {
  // This route is already protected by the authenticated session middleware.
  // Verify the shared password again because starting local ROS processes is privileged.
  const { password } = req.body || {};
  const sharedPw = getSharedPassword();
  if (sharedPw && password !== sharedPw) {
    return res.json({ success: false, authFailed: true, message: '비밀번호가 올바르지 않습니다.' });
  }
  try {
    const result = await startTestModeProcess();
    res.json({ success: result.started, ...result });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/testmode/stop', (req, res) => {
  const result = stopTestModeProcess();
  res.json({ success: true, ...result });
});
app.use('/api/ssh', commandRateLimiter, createSshRouter({
  sshConnections,
  createSSHConnection
}));
app.use('/api/sftp', commandRateLimiter, createSftpRouter({
  sshConnections,
  upload
}));
app.use('/api/robots', createRobotsRouter({
  loadRobotsConfig: robotsStore.load,
  saveRobotsConfig: robotsStore.save
}));
app.use('/api/tunnel', createTunnelRouter());
app.use('/api/can', commandRateLimiter, createCanRouter());

// ==================== ROS WebSocket Proxy ====================
// Proxies browser ↔ rosbridge so remote users don't need direct robot access
const rosProxyWss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/ws-proxy') {
    // Auth check: validate cookie-based auth token
    const token = getAuthToken(req);
    if (!isAuthTokenValid(authSessions, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Validate target before attempting robot connection
    const target = url.searchParams.get('target');
    if (!target || !/^[\w.\-]+:\d+$/.test(target)) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const [targetHost, targetPort] = target.split(':');
    const isLocal = /^127\./.test(targetHost) || targetHost === 'localhost';
    const isPrivate = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(targetHost);
    if (!isLocal && !isPrivate) {
      console.warn(`[WS-Proxy] Blocked: ${target} (not private network)`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const port = parseInt(targetPort, 10);
    if (port < 9000 || port > 9100) {
      console.warn(`[WS-Proxy] Blocked: ${target} (port out of range)`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Connect to robot FIRST, only complete client upgrade after robot is reachable
    console.log(`[WS-Proxy] Connecting to ws://${target} ...`);
    const robotWs = new WebSocket(`ws://${target}`, {
      maxPayload: 50 * 1024 * 1024,
      handshakeTimeout: 5000
    });

    robotWs.on('open', () => {
      console.log(`[WS-Proxy] Robot reachable: ${target}, completing client upgrade`);
      // Robot confirmed reachable — now complete the client WS upgrade
      rosProxyWss.handleUpgrade(req, socket, head, (clientWs) => {
        // Wire up bidirectional proxy
        robotWs.on('message', (data, isBinary) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data, { binary: isBinary });
          }
        });
        clientWs.on('message', (data, isBinary) => {
          if (robotWs.readyState === WebSocket.OPEN) {
            robotWs.send(data, { binary: isBinary });
          }
        });
        robotWs.on('close', () => { try { clientWs.close(); } catch(e) {} });
        clientWs.on('close', () => { try { robotWs.close(); } catch(e) {} });
        robotWs.on('error', () => { try { clientWs.close(); } catch(e) {} });
        clientWs.on('error', () => { try { robotWs.close(); } catch(e) {} });
      });
    });

    robotWs.on('error', (e) => {
      console.error(`[WS-Proxy] Robot unreachable (${target}):`, e.message);
      // Robot connection failed — reject the client upgrade
      if (!socket.destroyed) {
        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        socket.destroy();
      }
    });

  } else {
    // Default: terminal WebSocket
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});

// ==================== WebSocket Terminal ====================
wss.on('connection', (ws, req) => {
  const token = getAuthToken(req);
  if (!isAuthTokenValid(authSessions, token)) {
    try {
      ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
    } catch (e) {
      console.error('WebSocket auth error:', e);
    }
    // B10 fix: ws.close() 도 try/catch로 보호
    try { ws.close(1008, 'Unauthorized'); } catch (e) { /* ignore */ }
    return;
  }

  let sshConn = null;
  let sshStream = null;

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.type === 'connect') {
        const { host, port, username, password } = msg;

        sshConn = createSSHConnection(
          { host, port, username, password },
          () => {
            sshConn.shell({ term: 'xterm-256color' }, (err, stream) => {
              if (err) {
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
                return;
              }

              sshStream = stream;
              ws.send(JSON.stringify({ type: 'connected' }));

              stream.on('data', (data) => {
                ws.send(JSON.stringify({ type: 'data', data: data.toString('base64') }));
              });

              stream.on('close', () => {
                ws.send(JSON.stringify({ type: 'disconnected' }));
              });
            });
          },
          (err) => {
            ws.send(JSON.stringify({ type: 'error', needPassword: err.needPassword, message: err.message }));
          }
        );
      } else if (msg.type === 'data' && sshStream) {
        sshStream.write(Buffer.from(msg.data, 'base64'));
      } else if (msg.type === 'resize' && sshStream) {
        sshStream.setWindow(msg.rows, msg.cols);
      } else if (msg.type === 'disconnect') {
        if (sshStream) sshStream.close();
        if (sshConn) sshConn.end();
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });

  ws.on('close', () => {
    if (sshStream) sshStream.close();
    if (sshConn) sshConn.end();
  });
});

// B3 fix: 서버 종료 시 모든 자식 프로세스 정리
function cleanupProcesses() {
  console.log('[Server] Cleaning up child processes...');
  if (testModeProcess) { try { testModeProcess.kill('SIGTERM'); } catch (e) {} testModeProcess = null; }
  if (rosapiProcess) { try { rosapiProcess.kill('SIGTERM'); } catch (e) {} rosapiProcess = null; }
  if (roscoreProcess) {
    try { process.kill(-roscoreProcess.pid, 'SIGTERM'); } catch (e) {
      try { roscoreProcess.kill('SIGTERM'); } catch (e2) {}
    }
    roscoreProcess = null;
    roscoreStartedByUs = false;
  }
}

process.on('SIGTERM', () => { cleanupProcesses(); process.exit(0); });
process.on('SIGINT', () => { cleanupProcesses(); process.exit(0); });
process.on('exit', () => { cleanupProcesses(); });

// Start server. If the requested port is occupied, continue with the next port.
const serverReady = listenOnAvailablePort(server, {
  startPort: REQUESTED_PORT,
  host: '0.0.0.0',
  onPortInUse: (occupiedPort, nextPort) => {
    console.warn(`[Server] Port ${occupiedPort} is already in use. Trying ${nextPort}...`);
  }
}).then((port) => {
  // Launchers use this value to open the browser on the port actually selected.
  process.env.PORT = String(port);

  // Find all network interfaces for display
  const ifaces = os.networkInterfaces();
  const urls = [];
  Object.values(ifaces).forEach(list => {
    list.forEach(i => {
      if (i.family === 'IPv4' && !i.internal) {
        urls.push(`http://${i.address}:${port}`);
      }
    });
  });

  console.log(`\n========================================`);
  console.log(`  EasyLoop Server (v1.3.0)`);
  console.log(`========================================`);
  console.log(`  Local:    http://localhost:${port}`);
  urls.forEach(u => console.log(`  Network:  ${u}`));
  console.log(`========================================\n`);
  return port;
});

serverReady.catch((error) => {
  console.error(`[Server] Failed to start: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { app, server, serverReady };
