const fs = require('fs');
const path = require('path');
const { createSSHConnection } = require('./ssh');
const source = fs.readFileSync(path.join(__dirname, 'robot-discovery-probe.py'), 'utf8');
// Fixed source only. No shell startup files, ROS processes, agents or packages are started.
const discoveryCommand = `python3 -B -c 'import base64;exec(compile(base64.b64decode("${Buffer.from(source).toString('base64')}"),"easyloop_discovery_probe","exec"))'`;

function probeRobotOverSsh(ip, port, config = {}, options = {}) {
  return new Promise(resolve => {
    const createConnection = options.createConnection || createSSHConnection;
    let conn, stream, settled = false, retried = false;
    const finish = result => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { stream?.close(); } catch (_error) { /* closed */ }
      try { conn?.end(); conn?.destroy?.(); } catch (_error) { /* closed */ }
      resolve({ ip, sshPort: port, ...result });
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), options.timeout || 4500);
    const connect = password => {
      if (settled) return;
      try {
        conn = createConnection({ host: ip, port, username: config.username || 'syscon', ...(password ? { password } : {}) }, () => {
          if (settled) { conn?.end(); return; }
          conn.exec(discoveryCommand, (error, channel) => {
            if (error) return finish({ ok: false, error: 'probe_failed' });
            stream = channel; let output = '';
            stream.on('data', chunk => {
              output += chunk.toString();
              if (Buffer.byteLength(output) > 65536) finish({ ok: false, error: 'probe_output_limit' });
            });
            stream.stderr?.on('data', () => {});
            stream.on('error', () => finish({ ok: false, error: 'probe_failed' }));
            stream.on('close', code => {
              if (settled) return;
              if (code !== 0) return finish({ ok: false, error: code === 127 ? 'python_unavailable' : 'probe_failed' });
              try {
                const value = JSON.parse(output.trim());
                if (value.schemaVersion !== 1 || ![null, 1, 2].includes(value.rosMajor)
                  || (value.robotId !== null && !/^R_\d{3}$/.test(value.robotId))
                  || typeof value.robotEvidence !== 'boolean' || !Array.isArray(value.installedDistros)) throw new Error('invalid probe');
                // Explicit allowlist. Never forward arbitrary remote stdout or authentication settings.
                finish({ ok: true, robotId: value.robotId, rosMajor: value.rosMajor,
                  distro: String(value.distro || '').slice(0, 100), model: typeof value.model === 'string' ? value.model.slice(0, 100) : null,
                  installedDistros: value.installedDistros.filter(v => typeof v === 'string').slice(0, 20),
                  identityConflict: Boolean(value.identityConflict), rosConflict: Boolean(value.rosConflict),
                  bringupRunning: Boolean(value.bringupRunning), robotEvidence: value.robotEvidence,
                  evidence: ['bringup', 'process', 'config', 'installed', 'none'].includes(value.evidence) ? value.evidence : 'none' });
              } catch (_error) { finish({ ok: false, error: 'probe_failed' }); }
            });
          });
        }, error => {
          if (settled) return;
          if (error.needPassword && config.password && !retried) {
            retried = true; try { conn?.end(); } catch (_error) { /* rejected key */ }
            // Missing-key errors may be synchronous; defer until the first assignment returns.
            setImmediate(() => connect(config.password)); return;
          }
          finish({ ok: false, error: error.needPassword ? 'auth_required' : 'connection_failed', needPassword: Boolean(error.needPassword) });
        });
      } catch (_error) { finish({ ok: false, error: 'connection_failed' }); }
    };
    connect();
  });
}
module.exports = { discoveryCommand, probeRobotOverSsh };
