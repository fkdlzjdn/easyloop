const { Client } = require('ssh2');
const fs = require('fs');
const os = require('os');
const path = require('path');

function getSSHKeyPath() {
  return path.join(os.homedir(), '.ssh', 'id_rsa');
}

/**
 * Create an SSH connection with key-first fallback to password.
 * @param {{host: string, port?: number, username: string, password?: string}} config
 * @param {Function} onReady
 * @param {Function} onError
 * @returns {import('ssh2').Client|null}
 */
function createSSHConnection(config, onReady, onError) {
  const conn = new Client();
  const sshKeyPath = getSSHKeyPath();
  let errorHandled = false;

  const handleError = (err) => {
    if (errorHandled) return;
    errorHandled = true;
    onError(err);
  };

  // Try key-based auth first
  const authConfig = {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    readyTimeout: 10000
  };

  console.log(`[SSH] Connecting to ${config.host}:${authConfig.port} as ${config.username}`);

  // Check if SSH key exists
  if (fs.existsSync(sshKeyPath) && !config.password) {
    console.log('[SSH] Using key-based authentication');
    authConfig.privateKey = fs.readFileSync(sshKeyPath);

    conn.on('ready', () => {
      console.log('[SSH] Connected with key');
      onReady();
    });
    conn.on('error', (err) => {
      console.log('[SSH] Key auth error:', err.message);
      if (err.level === 'client-authentication') {
        handleError({ needPassword: true, message: 'SSH key authentication failed. Password required.' });
      } else {
        handleError({ needPassword: false, message: err.message });
      }
    });
    conn.on('timeout', () => {
      console.log('[SSH] Connection timeout');
      handleError({ needPassword: false, message: 'Connection timeout' });
    });
    conn.on('close', () => {
      console.log('[SSH] Connection closed');
    });

    conn.connect(authConfig);
  } else if (config.password) {
    console.log('[SSH] Using password authentication');
    authConfig.password = config.password;

    conn.on('ready', () => {
      console.log('[SSH] Connected with password');
      onReady();
    });
    conn.on('error', (err) => {
      console.log('[SSH] Password auth error:', err.message);
      handleError({ needPassword: false, message: err.message });
    });
    conn.on('timeout', () => {
      console.log('[SSH] Connection timeout');
      handleError({ needPassword: false, message: 'Connection timeout' });
    });
    conn.on('close', () => {
      console.log('[SSH] Connection closed');
    });

    conn.connect(authConfig);
  } else {
    console.log('[SSH] No key found, requesting password');
    handleError({ needPassword: true, message: 'No SSH key found. Password required.' });
    return null;
  }

  return conn;
}

module.exports = { createSSHConnection };
