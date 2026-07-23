const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { Client } = require('ssh2');

// Store active SSH tunnels by tunnelId.
const tunnelProcesses = new Map();

function getSSHKeyPath() {
  return path.join(os.homedir(), '.ssh', 'id_rsa');
}

function parsePort(port, name = 'port') {
  const n = parseInt(port, 10);
  if (isNaN(n) || n < 1 || n > 65535) throw new Error(`Invalid ${name}: ${port}`);
  return n;
}

function parseRobotNumber(robotNumber) {
  const n = parseInt(robotNumber, 10);
  if (isNaN(n) || n < 1 || n > 254) {
    throw new Error(`Invalid robot number: ${robotNumber}. Must be 1-254.`);
  }
  return n;
}

function buildAuthConfig(config) {
  const sshKeyPath = getSSHKeyPath();
  const authConfig = {
    host: config.robotIp,
    port: parsePort(config.sshPort || 22, 'sshPort'),
    username: config.sshUser || 'syscon',
    readyTimeout: 10000,
    keepaliveInterval: 30000,
    keepaliveCountMax: 3
  };

  if (config.sshPassword) {
    authConfig.password = config.sshPassword;
  } else if (fs.existsSync(sshKeyPath)) {
    authConfig.privateKey = fs.readFileSync(sshKeyPath);
  } else if (process.env.SSH_AUTH_SOCK) {
    authConfig.agent = process.env.SSH_AUTH_SOCK;
  } else {
    throw new Error('No SSH password, key, or agent available for tunnel authentication.');
  }

  return authConfig;
}

function closeSocketSet(sockets) {
  for (const socket of sockets) {
    try {
      socket.destroy();
    } catch (err) {
      // Ignore cleanup errors.
    }
  }
  sockets.clear();
}

function stopTunnelRecord(tunnelId, tunnel) {
  closeSocketSet(tunnel.sockets);

  try {
    tunnel.server.close();
  } catch (err) {
    // Ignore cleanup errors.
  }

  try {
    tunnel.conn.end();
  } catch (err) {
    // Ignore cleanup errors.
  }

  tunnelProcesses.delete(tunnelId);
}

function stopExistingTunnelOnEndpoint(localIp, localPort) {
  for (const [tunnelId, tunnel] of tunnelProcesses) {
    if (tunnel.localIp === localIp && tunnel.localPort === localPort) {
      console.log(`[TunnelManager] Replacing existing tunnel on ${localIp}:${localPort}`);
      stopTunnelRecord(tunnelId, tunnel);
    }
  }
}

function createForwardServer(conn, tunnelId, remotePort, sockets) {
  return net.createServer((socket) => {
    sockets.add(socket);

    socket.on('close', () => {
      sockets.delete(socket);
    });

    socket.on('error', (err) => {
      console.warn(`[TunnelManager] ${tunnelId} local socket error: ${err.message}`);
    });

    const sourceIp = socket.remoteAddress || '127.0.0.1';
    const sourcePort = socket.remotePort || 0;

    conn.forwardOut(sourceIp, sourcePort, '127.0.0.1', remotePort, (err, stream) => {
      if (err) {
        console.warn(`[TunnelManager] ${tunnelId} forwardOut error: ${err.message}`);
        socket.destroy();
        return;
      }

      stream.on('error', (streamErr) => {
        console.warn(`[TunnelManager] ${tunnelId} SSH stream error: ${streamErr.message}`);
        socket.destroy();
      });

      socket.pipe(stream).pipe(socket);
    });
  });
}

/**
 * Start an SSH tunnel for ROS bridge port forwarding.
 * @param {string} tunnelId - Unique identifier for this tunnel
 * @param {object} config - Tunnel configuration
 * @param {string} config.robotIp - Remote robot IP address
 * @param {number} config.robotNumber - Robot number (used for local IP: 127.0.0.{robotNumber})
 * @param {number} config.sshPort - SSH port (default: 22)
 * @param {string} config.sshUser - SSH username (default: syscon)
 * @param {string} config.sshPassword - SSH password (optional)
 * @returns {Promise<object>} - Result with success status and local IP
 */
function startTunnel(tunnelId, config) {
  return new Promise((resolve, reject) => {
    const localIpNum = parseRobotNumber(config.robotNumber);
    const localIp = `127.0.0.${localIpNum}`;
    const localPort = 9090;
    const remotePort = 9090;

    if (tunnelProcesses.has(tunnelId)) {
      return resolve({
        success: true,
        message: 'Tunnel already exists',
        localIp,
        localPort,
        alreadyExists: true
      });
    }

    let authConfig;
    try {
      authConfig = buildAuthConfig(config);
    } catch (err) {
      return reject(err);
    }

    stopExistingTunnelOnEndpoint(localIp, localPort);

    const conn = new Client();
    const sockets = new Set();
    let server = null;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (server) {
        try { server.close(); } catch (_closeErr) { /* ignore */ }
      }
      closeSocketSet(sockets);
      try { conn.end(); } catch (_endErr) { /* ignore */ }
      reject(err);
    };

    console.log(`[TunnelManager] Starting tunnel ${tunnelId}: ${localIp}:${localPort} -> ${config.robotIp}:${remotePort}`);

    conn.on('ready', () => {
      server = createForwardServer(conn, tunnelId, remotePort, sockets);

      server.on('error', (err) => {
        fail(new Error(`Failed to bind local tunnel ${localIp}:${localPort}: ${err.message}`));
      });

      server.listen(localPort, localIp, () => {
        const tunnel = {
          conn,
          server,
          sockets,
          localIp,
          localPort,
          robotIp: config.robotIp,
          sshPort: authConfig.port,
          startedAt: Date.now()
        };

        tunnelProcesses.set(tunnelId, tunnel);
        settled = true;
        resolve({
          success: true,
          message: 'Tunnel started',
          localIp,
          localPort
        });
      });
    });

    conn.on('error', (err) => {
      fail(new Error(`SSH tunnel connection failed: ${err.message}`));
    });

    conn.on('close', () => {
      const tunnel = tunnelProcesses.get(tunnelId);
      if (tunnel) {
        console.log(`[TunnelManager] ${tunnelId} SSH connection closed`);
        stopTunnelRecord(tunnelId, tunnel);
      }
    });

    conn.connect(authConfig);
  });
}

/**
 * Stop an SSH tunnel.
 * @param {string} tunnelId - Tunnel identifier
 * @returns {object} - Result with success status
 */
function stopTunnel(tunnelId) {
  const tunnel = tunnelProcesses.get(tunnelId);
  if (!tunnel) {
    return { success: true, message: 'Tunnel not found or already stopped' };
  }

  console.log(`[TunnelManager] Stopping tunnel ${tunnelId}`);
  stopTunnelRecord(tunnelId, tunnel);
  return { success: true, message: 'Tunnel stopped' };
}

/**
 * Stop all active tunnels.
 * @returns {object} - Result with count of stopped tunnels
 */
function stopAllTunnels() {
  const count = tunnelProcesses.size;
  console.log(`[TunnelManager] Stopping all ${count} tunnels`);

  for (const [tunnelId, tunnel] of Array.from(tunnelProcesses.entries())) {
    stopTunnelRecord(tunnelId, tunnel);
  }

  return { success: true, stoppedCount: count };
}

/**
 * Get status of a tunnel.
 * @param {string} tunnelId - Tunnel identifier
 * @returns {object|null} - Tunnel info or null if not found
 */
function getTunnelStatus(tunnelId) {
  const tunnel = tunnelProcesses.get(tunnelId);
  if (!tunnel) return null;

  return {
    tunnelId,
    localIp: tunnel.localIp,
    localPort: tunnel.localPort,
    robotIp: tunnel.robotIp,
    sshPort: tunnel.sshPort,
    startedAt: tunnel.startedAt,
    uptime: Date.now() - tunnel.startedAt
  };
}

/**
 * Get all active tunnels.
 * @returns {Array} - List of active tunnel info
 */
function getAllTunnels() {
  const tunnels = [];
  for (const [tunnelId, tunnel] of tunnelProcesses) {
    tunnels.push({
      tunnelId,
      localIp: tunnel.localIp,
      localPort: tunnel.localPort,
      robotIp: tunnel.robotIp,
      sshPort: tunnel.sshPort,
      startedAt: tunnel.startedAt,
      uptime: Date.now() - tunnel.startedAt
    });
  }
  return tunnels;
}

process.on('exit', () => {
  stopAllTunnels();
});

process.on('SIGINT', () => {
  stopAllTunnels();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopAllTunnels();
  process.exit(0);
});

module.exports = {
  startTunnel,
  stopTunnel,
  stopAllTunnels,
  getTunnelStatus,
  getAllTunnels
};
