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

const { loadEnvironmentFile } = require('./server/env');
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
const { startWindowsNetworkSync } = require('./server/windows-network-sync');
const { stopLocalRosMaster } = require('./server/ros-master-cleanup');
const { validateRosProxyTarget } = require('./server/ws-proxy-target');
const { waitForRosService } = require('./server/ros-service-wait');
const { createWebSocketForwarder } = require('./server/ws-backpressure');

// npm start/start.sh/package 실행 모두 동일하게 로컬 인증 설정을 사용한다.
// 셸에서 명시한 환경 변수는 .env보다 우선하며 비밀번호 값은 로그에 남기지 않는다.
loadEnvironmentFile(path.join(APP_DIR, '.env'), process.env, ['PORT', 'SHARED_PASSWORD']);
// pkg 빌드는 .env를 바이너리 내부 asset으로 포함한다. 실행 파일 옆에
// 외부 .env가 없는 경우에만 포함된 설정을 fallback으로 사용한다.
if (process.pkg) {
  loadEnvironmentFile(path.join(__dirname, '.env'), process.env, ['PORT', 'SHARED_PASSWORD']);
}

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
const windowsNetworkSync = startWindowsNetworkSync({ logger: console });

function getSharedPassword() {
  return process.env.SHARED_PASSWORD || '';
}

const authMiddleware = createAuthMiddleware(authSessions);
let testModeProcess = null;
let rosapiProcess = null;
let roscoreProcess = null;
let roscoreStartedByUs = false;
const TEST_MODE_ROSBRIDGE_PORT = 19090;
const TEST_MODE_ROS_LOG_DIR = path.join(os.tmpdir(), 'easyloop-ros-log');

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
  // Test Mode uses a dedicated port so its wildcard listener cannot block
  // real-robot SSH tunnels on 127.0.0.{RID}:9090.
  const alreadyUp = await waitForPort(TEST_MODE_ROSBRIDGE_PORT, 1000);
  if (alreadyUp) {
    return {
      started: true,
      message: 'rosbridge already running',
      port: TEST_MODE_ROSBRIDGE_PORT
    };
  }

  // Check if roscore is running (port 11311)
  let roscoreUp = await waitForPort(11311, 1500);
  fs.mkdirSync(TEST_MODE_ROS_LOG_DIR, { recursive: true });
  if (!roscoreUp) {
    // Auto-start roscore
    console.log('[TestMode] roscore not running, starting automatically...');
    const rosEnvForCore = Object.assign({}, process.env, {
      HOME: os.homedir(),
      ROS_MASTER_URI: 'http://localhost:11311',
      ROS_HOSTNAME: '127.0.0.1',
      ROS_IP: '127.0.0.1',
      ROS_LOG_DIR: TEST_MODE_ROS_LOG_DIR,
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
      // Keep the ownership flag until Test Mode cleanup. The tracked shell can
      // exit before its rosmaster child, which still needs owned cleanup.
    });
    roscoreStartedByUs = true;

    // Wait for roscore to be ready (up to 10s)
    roscoreUp = await waitForPort(11311, 10000);
    if (!roscoreUp) {
      try { if (roscoreProcess) roscoreProcess.kill('SIGTERM'); } catch (_error) {}
      roscoreProcess = null;
      stopLocalRosMaster({ port: 11311, owned: true, logger: console });
      roscoreStartedByUs = false;
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
    ROS_LOG_DIR: TEST_MODE_ROS_LOG_DIR,
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
    `_port:=${TEST_MODE_ROSBRIDGE_PORT}`
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

  // Wait until the dedicated Test Mode port is listening
  const ready = await waitForPort(TEST_MODE_ROSBRIDGE_PORT, 15000);
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

    const rosapiReady = await waitForRosService('/rosapi/nodes', 5000, rosEnv);
    if (!rosapiReady) {
      try { if (rosapiProcess) rosapiProcess.kill('SIGTERM'); } catch (_error) {}
      try { if (testModeProcess) testModeProcess.kill('SIGTERM'); } catch (_error) {}
      rosapiProcess = null;
      testModeProcess = null;
      stopTestModeProcess();
      return { started: false, message: 'rosapi 시작 timeout' };
    }

    return {
      started: true,
      message: 'rosbridge ready',
      port: TEST_MODE_ROSBRIDGE_PORT
    };
  } else {
    stopTestModeProcess();
    return { started: false, message: 'rosbridge 시작 timeout' };
  }
}

function stopTestModeProcess() {
  const ownsRosMaster = roscoreStartedByUs;
  const hadTestModeProcess = Boolean(
    testModeProcess || rosapiProcess || roscoreProcess || roscoreStartedByUs
  );
  try { if (testModeProcess) testModeProcess.kill('SIGTERM'); } catch (e) {}
  try { if (rosapiProcess) rosapiProcess.kill('SIGTERM'); } catch (e) {}
  testModeProcess = null;
  rosapiProcess = null;
  if (roscoreProcess) {
    console.log('[TestMode] Stopping tracked roscore process');
    try { roscoreProcess.kill('SIGTERM'); } catch (_error) {}
    roscoreProcess = null;
  }
  roscoreStartedByUs = false;

  // The tracked shell may exit while its rosmaster child still owns 11311.
  // Resolve and stop that listener only when this Test Mode started it. A
  // pre-existing developer ROS master must survive Test Mode shutdown.
  const rosMaster = stopLocalRosMaster({
    port: 11311,
    owned: ownsRosMaster,
    logger: console
  });
  const masterStopped = rosMaster.terminated.length > 0;
  return {
    stopped: hadTestModeProcess || masterStopped,
    rosMasterStopped: masterStopped,
    message: hadTestModeProcess || masterStopped
      ? 'Test mode process and local ROS master stopped'
      : 'Test mode and local ROS master were not running'
  };
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
    console.warn('[TestMode] Start rejected: password mismatch');
    return res.json({ success: false, authFailed: true, message: '비밀번호가 올바르지 않습니다.' });
  }
  try {
    console.log('[TestMode] Start requested');
    const result = await startTestModeProcess();
    console.log(`[TestMode] Start result: ${result.started ? 'ready' : 'failed'} (${result.message})`);
    res.json({ success: result.started, ...result });
  } catch (e) {
    console.error(`[TestMode] Start error: ${e.message}`);
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
  saveRobotsConfig: robotsStore.save,
  syncWindowsNetwork: windowsNetworkSync.syncNow
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
    const validation = validateRosProxyTarget(target, {
      testModePort: TEST_MODE_ROSBRIDGE_PORT
    });
    if (!validation.ok) {
      console.warn(`[WS-Proxy] Blocked: ${target || '(missing)'} (${validation.message})`);
      const reason = validation.statusCode === 400 ? 'Bad Request' : 'Forbidden';
      socket.write(`HTTP/1.1 ${validation.statusCode} ${reason}\r\n\r\n`);
      socket.destroy();
      return;
    }

    // Connect to robot FIRST, only complete client upgrade after robot is reachable
    console.log(`[WS-Proxy] Connecting to ws://${target} ...`);
    const robotWs = new WebSocket(`ws://${target}`, {
      maxPayload: 50 * 1024 * 1024,
      handshakeTimeout: 5000,
      perMessageDeflate: false
    });
    let robotOpened = false;

    robotWs.on('open', () => {
      robotOpened = true;
      console.log(`[WS-Proxy] Robot reachable: ${target}, completing client upgrade`);
      // Robot confirmed reachable — now complete the client WS upgrade
      rosProxyWss.handleUpgrade(req, socket, head, (clientWs) => {
        // A stale browser tab or a remote network drop can leave the robot
        // side in FIN-WAIT while rosbridge is back-pressured. Terminate the
        // peer socket instead of waiting for a graceful close handshake.
        const terminatePeer = (ws) => {
          try {
            if (ws && ws.readyState !== WebSocket.CLOSED) ws.terminate();
          } catch (e) { /* ignore stale socket cleanup */ }
        };
        // Pause the upstream socket when its peer cannot drain quickly enough.
        // Without this, repeated OccupancyGrid frames are retained by ws.send()
        // and can grow the EasyLoop process to several GB while pose is delayed.
        let proxyClosed = false;
        const forwarders = [];
        const closeProxy = (reason = '') => {
          if (proxyClosed) return;
          proxyClosed = true;
          forwarders.forEach(forwarder => forwarder.cleanup());
          if (reason) console.warn(`[WS-Proxy] Closing ${target}: ${reason}`);
          terminatePeer(clientWs);
          terminatePeer(robotWs);
        };
        const onBackpressureFailure = event => {
          closeProxy(`${event.label}: ${event.reason} (${event.bufferedAmount} buffered bytes)`);
        };
        forwarders.push(createWebSocketForwarder(robotWs, clientWs, {
          label: 'robot->browser',
          openState: WebSocket.OPEN,
          onFatal: onBackpressureFailure
        }));
        forwarders.push(createWebSocketForwarder(clientWs, robotWs, {
          label: 'browser->robot',
          openState: WebSocket.OPEN,
          onFatal: onBackpressureFailure
        }));
        robotWs.on('close', () => closeProxy());
        clientWs.on('close', () => closeProxy());
        robotWs.on('error', () => closeProxy('robot WebSocket error'));
        clientWs.on('error', () => closeProxy('browser WebSocket error'));
      });
    });

    robotWs.on('error', (e) => {
      if (robotOpened) return;
      console.error(`[WS-Proxy] Robot unreachable (${target}):`, e.message);
      // Robot connection failed — reject the client upgrade
      if (!socket.destroyed) {
        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        socket.destroy();
      }
      try { robotWs.terminate(); } catch (closeError) { /* ignore */ }
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
  windowsNetworkSync.stop();
  stopTestModeProcess();
}

process.on('SIGTERM', () => { cleanupProcesses(); process.exit(0); });
process.on('SIGINT', () => { cleanupProcesses(); process.exit(0); });
process.on('exit', () => { cleanupProcesses(); });

// Start server. If the requested port is occupied, continue with the next port.
const serverReady = listenOnAvailablePort(server, {
  startPort: REQUESTED_PORT,
  host: '0.0.0.0',
  // The Windows sharing launcher pins port 3000 so every department can use
  // the same LAN URL. Development keeps the existing next-port fallback.
  allowPortFallback: process.env.EASYLOOP_STRICT_PORT !== '1',
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
