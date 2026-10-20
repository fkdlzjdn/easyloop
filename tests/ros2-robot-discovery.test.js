const { scanSubnet } = require('../server/routes/robots');
const { probeRobotOverSsh, discoveryCommand } = require('../server/robot-discovery-ssh');
const { EventEmitter } = require('events');
const identified = (extra = {}) => ({ ok: true, robotEvidence: true, robotId: 'R_006', rosMajor: 2,
  distro: 'jazzy', model: 'sl400_vri', installedDistros: ['jazzy'], bringupRunning: true, evidence: 'process', ...extra });

describe('ROS1 + ROS2 automatic robot discovery without robot network access', () => {
  test('finds native ROS2 without rosbridge and preserves 2222 or configured SSH ports', async () => {
    const open = { '192.168.20.51': [9090], '192.168.20.56': [22], '192.168.20.75': [2222], '192.168.20.80': [2233] };
    const probeSshFn = jest.fn(async (ip, port) => identified({ ip, sshPort: port, robotId: ip.endsWith('.75') ? 'R_025' : ip.endsWith('.80') ? 'R_030' : 'R_006' }));
    const result = await scanSubnet({ start: 51, end: 80,
      checkHostFn: async (ip, port) => (open[ip] || []).includes(port),
      discoverRobotIdFn: async () => 'R_001', probeSshFn,
      knownRobots: [{ ip: '192.168.20.80', sshPort: 2233 }] });
    expect(result.discoveryMode).toBe('auto'); expect(result.hosts).toHaveLength(4);
    expect(result.hosts.find(host => host.ip.endsWith('.51'))).toMatchObject({ robotId: 'R_001', discoverySource: 'rosbridge', wsPort: 9090 });
    expect(result.hosts.find(host => host.ip.endsWith('.56'))).toMatchObject({ robotId: 'R_006', rosMode: 'ros2', sshPort: 22, model: 'sl400_vri', portForwarded: false });
    expect(result.hosts.find(host => host.ip.endsWith('.75'))).toMatchObject({ robotId: 'R_025', rosMode: 'ros2', sshPort: 2222 });
    expect(result.hosts.find(host => host.ip.endsWith('.80'))).toMatchObject({ sshPort: 2233 });
    expect(result.scanned).toBe(31); expect(probeSshFn).toHaveBeenCalledTimes(3);
  });

  test('detects stopped ROS2 from config, keeps auth failures unknown, and excludes an ordinary SSH host', async () => {
    const result = await scanSubnet({ start: 51, end: 54,
      checkHostFn: async (ip, port) => !ip.startsWith('192.168.3.') && port === 22,
      discoverRobotIdFn: jest.fn(), probeSshFn: async (ip, port) => ip.endsWith('.51') ? identified({ sshPort: port, bringupRunning: false, evidence: 'config' })
        : ip.endsWith('.52') ? { ok: false, sshPort: port, error: 'auth_required', needPassword: true }
          : ip.endsWith('.53') ? identified({ robotId: null, sshPort: port, rosMajor: null, evidence: 'installed' })
            : { ok: true, sshPort: port, robotEvidence: false } });
    expect(result.hosts).toHaveLength(3);
    expect(result.hosts[0]).toMatchObject({ rosMode: 'ros2', observationOnly: true, evidence: 'config' });
    expect(result.hosts[1]).toMatchObject({ robotId: null, rosMajor: null, authenticationRequired: true, sshStatus: 'auth_required' });
    expect(result.hosts[2]).toMatchObject({ robotId: null, rosMajor: null, rosMode: 'auto' });
  });

  test('conflicting local identity and rosbridge namespace never auto-selects an RID', async () => {
    const result = await scanSubnet({ start: 56, end: 56,
      checkHostFn: async (ip, port) => ip.endsWith('.56') && [22, 9090].includes(port),
      discoverRobotIdFn: async () => 'R_999', probeSshFn: async () => identified({ sshPort: 22 }) });
    expect(result.hosts[0]).toMatchObject({ robotId: null, identityConflict: true, identitySource: 'conflict' });
  });

  test('SSH probes are bounded and only an explicit per-IP credential is used', async () => {
    let active = 0, peak = 0;
    const probeSshFn = jest.fn(async (ip, port, config) => {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 3)); active--;
      if (ip.endsWith('.51')) expect(config).toEqual({ username: 'operator', password: 'private-password' });
      else expect(config.password).toBe('');
      return identified({ sshPort: port });
    });
    const result = await scanSubnet({ start: 51, end: 70, checkHostFn: async (ip, port) => ip.startsWith('192.168.20.') && port === 22,
      probeSshFn, knownRobots: [{ ip: '192.168.20.51', sshPort: 22, sshUser: 'operator', sshPassword: 'private-password' }] });
    expect(peak).toBe(8); expect(probeSshFn).toHaveBeenCalledTimes(20);
    expect(JSON.stringify(result)).not.toContain('private-password'); expect(JSON.stringify(result)).not.toContain('operator');
  });
});

function sshHarness(result, failKey = false) {
  const calls = [], connection = { end: jest.fn(), destroy: jest.fn() };
  const channel = new EventEmitter(); channel.stderr = new EventEmitter(); channel.close = jest.fn();
  connection.exec = jest.fn((_command, callback) => {
    callback(null, channel);
    process.nextTick(() => { channel.emit('data', Buffer.from(JSON.stringify(result))); channel.emit('close', 0); });
  });
  const createConnection = (config, ready, error) => {
    calls.push(config); process.nextTick(() => { if (failKey && !config.password) error({ needPassword: true }); else ready(); }); return connection;
  };
  return { calls, connection, createConnection };
}

describe('fixed SSH discovery probe', () => {
  test('executes only the fixed read script, closes the connection and filters remote output fields', async () => {
    const harness = sshHarness({ schemaVersion: 1, ...identified(), sshPassword: 'must-not-leak' });
    const value = await probeRobotOverSsh('192.168.20.56', 22, {}, harness);
    expect(value).toMatchObject({ ok: true, robotId: 'R_006', rosMajor: 2 });
    expect(harness.connection.exec).toHaveBeenCalledWith(discoveryCommand, expect.any(Function));
    expect(harness.connection.end).toHaveBeenCalledTimes(1); expect(harness.connection.destroy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(value)).not.toContain('must-not-leak');
    expect(discoveryCommand).toMatch(/^python3 -B -c /); expect(discoveryCommand).not.toContain('bash -ic');
  });
  test('tries the key first and only retries with the supplied password for that IP', async () => {
    const harness = sshHarness({ schemaVersion: 1, ...identified() }, true);
    const value = await probeRobotOverSsh('192.168.20.56', 2222, { username: 'operator', password: 'only-for-this-host' }, harness);
    expect(value.ok).toBe(true); expect(harness.calls).toHaveLength(2);
    expect(harness.calls[0].password).toBeUndefined(); expect(harness.calls[1].password).toBe('only-for-this-host');
  });
  test('a synchronous no-key failure can still retry the supplied password without losing its client', async () => {
    const harness = sshHarness({ schemaVersion: 1, ...identified() });
    const createConnection = (config, ready, error) => {
      if (!config.password) { error({ needPassword: true }); return null; }
      return harness.createConnection(config, ready, error);
    };
    const value = await probeRobotOverSsh('192.168.20.56', 22, { password: 'per-host-password' }, { createConnection });
    expect(value.ok).toBe(true); expect(harness.connection.exec).toHaveBeenCalledTimes(1);
  });
  test('timeout destroys a stalled SSH client instead of leaving a connection outside the limit', async () => {
    const connection = { end: jest.fn(), destroy: jest.fn() };
    const value = await probeRobotOverSsh('192.168.20.56', 22, {}, { timeout: 10, createConnection: () => connection });
    expect(value).toMatchObject({ ok: false, error: 'timeout' }); expect(connection.destroy).toHaveBeenCalledTimes(1);
  });
});
