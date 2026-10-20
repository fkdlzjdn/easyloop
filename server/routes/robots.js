const express = require('express');
const net = require('net');
const WebSocket = require('ws');
const { probeRobotOverSsh } = require('../robot-discovery-ssh');
const {
  VALIDATION_LIMITS,
  badRequest,
  isPlainObject,
  validateStringField
} = require('../validation');

const DEFAULT_SCAN_SUBNET = '192.168.20';
const FIXED_DISCOVERY_IP = '192.168.3.5';
const DEFAULT_ROSBRIDGE_PORT = 9090;
const SCAN_CONCURRENCY = 64;

function normalizeSubnetBase(value) {
  const input = String(value || DEFAULT_SCAN_SUBNET).trim();
  const [rawAddress, cidr] = input.split('/');
  // 현장에서 흔히 입력하는 "192.168.20."도 /24 대역으로 허용한다.
  const address = rawAddress.replace(/\.$/, '');
  if (cidr !== undefined && cidr !== '24') return null;

  const parts = address.split('.');
  if (parts.length !== 3 && parts.length !== 4) return null;
  if (!parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;

  return parts.slice(0, 3).map(Number).join('.');
}

function normalizeRobotId(value, allowNumeric = false) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  const ridMatch = text.match(/R[_-]?(\d{1,3})/i);
  if (ridMatch) return `R_${ridMatch[1].padStart(3, '0')}`;

  if (allowNumeric) {
    const numericMatch = text.match(/^["']?(\d{1,3})["']?$/);
    if (numericMatch) return `R_${numericMatch[1].padStart(3, '0')}`;
  }
  return null;
}

function normalizeConfiguredRobotId(value) {
  const text = String(value || '').trim();
  const match = text.match(/^R[_-]?(\d{1,3})$/i) || text.match(/^(\d{1,3})$/);
  return match ? `R_${match[1].padStart(3, '0')}` : null;
}

function extractRobotIdFromValues(values) {
  try {
    return normalizeRobotId(JSON.stringify(values));
  } catch (e) {
    return null;
  }
}

function discoverRobotId(ip, port = DEFAULT_ROSBRIDGE_PORT, timeout = 1600) {
  return new Promise((resolve) => {
    const requestIds = new Set([
      'easyloop-discovery-topics',
      'easyloop-discovery-param-robot-id',
      'easyloop-discovery-param-robot-id-upper',
      'easyloop-discovery-param-rid',
      'easyloop-discovery-param-name'
    ]);
    let settled = false;
    let socket;

    const finish = (robotId = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) {
        try { socket.close(); } catch (e) { /* socket is already closed */ }
      }
      resolve(robotId);
    };

    const timer = setTimeout(() => finish(null), timeout);

    try {
      socket = new WebSocket(`ws://${ip}:${port}`, { handshakeTimeout: timeout });
    } catch (e) {
      finish(null);
      return;
    }

    socket.once('error', () => finish(null));
    socket.once('close', () => finish(null));

    socket.once('open', () => {
      const requests = [
        {
          id: 'easyloop-discovery-topics',
          service: '/rosapi/topics',
          args: {}
        },
        {
          id: 'easyloop-discovery-param-robot-id',
          service: '/rosapi/get_param',
          args: { name: '/robot_id', default: '' }
        },
        {
          id: 'easyloop-discovery-param-robot-id-upper',
          service: '/rosapi/get_param',
          args: { name: '/ROBOT_ID', default: '' }
        },
        {
          id: 'easyloop-discovery-param-rid',
          service: '/rosapi/get_param',
          args: { name: '/rid', default: '' }
        },
        {
          id: 'easyloop-discovery-param-name',
          service: '/rosapi/get_param',
          args: { name: '/robot_name', default: '' }
        }
      ];

      requests.forEach(request => {
        socket.send(JSON.stringify({ op: 'call_service', ...request }));
      });
    });

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (e) {
        return;
      }

      if (message.op !== 'service_response' || !requestIds.has(message.id)) return;

      let robotId = extractRobotIdFromValues(message.values);
      if (!robotId && message.id.startsWith('easyloop-discovery-param-')) {
        robotId = normalizeRobotId(message.values && message.values.value, true);
      }
      if (robotId) {
        finish(robotId);
        return;
      }

      requestIds.delete(message.id);
      if (requestIds.size === 0) finish(null);
    });
  });
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function scanSubnet(options = {}) {
  const {
    baseIp = DEFAULT_SCAN_SUBNET,
    port = DEFAULT_ROSBRIDGE_PORT,
    discoveryMode = 'auto',
    timeout = 650,
    start = 1,
    end = 254,
    checkHostFn = checkHost,
    discoverRobotIdFn = discoverRobotId
  } = options;

  if (discoveryMode === 'auto') return scanAutomatic(options);

  const subnet = normalizeSubnetBase(baseIp);
  if (!subnet) throw new Error('Invalid /24 subnet');

  const targets = [];
  for (let host = start; host <= end; host += 1) {
    targets.push({ ip: `${subnet}.${host}`, fixed: false });
  }
  if (!targets.some(target => target.ip === FIXED_DISCOVERY_IP)) {
    targets.push({ ip: FIXED_DISCOVERY_IP, fixed: true });
  } else {
    targets.find(target => target.ip === FIXED_DISCOVERY_IP).fixed = true;
  }

  const reachability = await mapWithConcurrency(
    targets,
    SCAN_CONCURRENCY,
    async target => ({ ...target, reachable: await checkHostFn(target.ip, port, timeout) })
  );
  const reachableHosts = reachability.filter(target => target.reachable);

  const hosts = await Promise.all(reachableHosts.map(async target => {
    const portForwarded = discoveryMode === 'ssh';
    return {
      ip: target.ip,
      port,
      robotId: portForwarded ? null : await discoverRobotIdFn(target.ip, port),
      fixed: target.fixed,
      ...(portForwarded
        ? { sshPort: port, portForwarded: true, discoveryMode: 'ssh' }
        : { wsPort: port, discoveryMode: 'rosbridge' })
    };
  }));

  return {
    subnet,
    port,
    discoveryMode,
    fixedTarget: FIXED_DISCOVERY_IP,
    scanned: targets.length,
    hosts
  };
}

async function scanAutomatic(options = {}) {
  const { baseIp = DEFAULT_SCAN_SUBNET, port = DEFAULT_ROSBRIDGE_PORT, timeout = 650,
    start = 1, end = 254, checkHostFn = checkHost, discoverRobotIdFn = discoverRobotId,
    probeSshFn = probeRobotOverSsh, knownRobots = [] } = options;
  const subnet = normalizeSubnetBase(baseIp);
  if (!subnet) throw new Error('Invalid /24 subnet');
  const ips = Array.from({ length: end - start + 1 }, (_, i) => `${subnet}.${start + i}`);
  if (!ips.includes(FIXED_DISCOVERY_IP)) ips.push(FIXED_DISCOVERY_IP);
  const targets = ips.map(ip => {
    const known = knownRobots.filter(robot => robot.ip === ip);
    const ports = [...new Set([...known.map(robot => Number(robot.sshPort) || 22), 22, 2222])];
    return { ip, known, ports, openPorts: new Set() };
  });
  const checks = targets.flatMap(target => [...new Set([port, ...target.ports])].map(candidate => ({ target, candidate })));
  await mapWithConcurrency(checks, SCAN_CONCURRENCY, async ({ target, candidate }) => {
    if (await checkHostFn(target.ip, candidate, timeout)) target.openPorts.add(candidate);
  });
  const reachable = targets.filter(target => target.openPorts.size);
  const records = await mapWithConcurrency(reachable, 8, async target => {
    const wsPromise = target.openPorts.has(port) ? discoverRobotIdFn(target.ip, port) : Promise.resolve(null);
    const sshPromise = (async () => {
      let last = null;
      for (const sshPort of target.ports.filter(candidate => target.openPorts.has(candidate))) {
        const registered = target.known.find(robot => Number(robot.sshPort || 22) === sshPort);
        const result = await probeSshFn(target.ip, sshPort, {
          username: registered?.sshUser || registered?.username || 'syscon',
          password: registered?.sshPassword || registered?.password || ''
        });
        if (result.ok && result.robotEvidence) return result;
        if (!last || result.needPassword) last = result;
      }
      return last;
    })();
    const [bridgeId, ssh] = await Promise.all([wsPromise, sshPromise]);
    const wsOpen = target.openPorts.has(port);
    const registered = target.known.find(robot => Number(robot.sshPort || 22) === ssh?.sshPort);
    const registeredId = normalizeConfiguredRobotId(registered?.robotId || registered?.id);
    if (!wsOpen && ssh?.ok && !ssh.robotEvidence) return null;
    const conflict = Boolean(ssh?.identityConflict || (bridgeId && ssh?.robotId && bridgeId !== ssh.robotId));
    const observedId = ssh?.robotId || bridgeId;
    const robotId = conflict ? null : observedId || registeredId;
    const major = ssh?.ok ? ssh.rosMajor : null;
    const sshPort = ssh?.sshPort || target.ports.find(candidate => target.openPorts.has(candidate)) || 22;
    const authenticated = Boolean(ssh?.ok);
    return {
      ip: target.ip, port: wsOpen ? port : sshPort, wsPort: port, sshPort,
      robotId, rosMajor: major, rosMode: major ? `ros${major}` : 'auto',
      distro: ssh?.distro || '', model: ssh?.model || null,
      installedDistros: ssh?.installedDistros || [],
      bringupRunning: Boolean(ssh?.bringupRunning),
      fixed: target.ip === FIXED_DISCOVERY_IP, discoveryMode: 'auto',
      discoverySource: authenticated ? 'ssh' : wsOpen ? 'rosbridge' : 'ssh-candidate',
      identitySource: conflict ? 'conflict' : observedId ? (ssh?.robotId ? 'ssh' : 'rosbridge') : registeredId ? 'registered' : 'unknown',
      identityConflict: conflict, rosConflict: Boolean(ssh?.rosConflict),
      sshStatus: authenticated ? 'authenticated' : ssh?.error || 'unavailable',
      authenticationRequired: !wsOpen && !authenticated,
      observationOnly: major === 2 && !ssh?.bringupRunning,
      evidence: ssh?.evidence || (bridgeId ? 'rosbridge' : 'port'),
      portForwarded: false
    };
  });
  return { subnet, port, discoveryMode: 'auto', fixedTarget: FIXED_DISCOVERY_IP,
    scanned: targets.length, hosts: records.filter(Boolean), readOnly: true };
}

function checkHost(ip, port, timeout) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeout);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, ip);
  });
}

function createRobotsRouter({
  loadRobotsConfig,
  saveRobotsConfig,
  syncWindowsNetwork,
  scanSubnetFn = scanSubnet,
  checkHostFn = checkHost
}) {
  const router = express.Router();
  let scanInProgress = false;

  router.get('/', (req, res) => {
    const config = loadRobotsConfig();
    res.json(config.robots.map(robot => ({
      ...robot,
      id: normalizeConfiguredRobotId(robot.id) || robot.id
    })));
  });

  // Scan reachability of all configured robots
  router.get('/scan', async (req, res) => {
    const config = loadRobotsConfig();
    const timeout = 1500;
    const results = await Promise.all(
      config.robots.map(async (robot) => {
        const ports = [...new Set([robot.rosBridgePort || robot.wsPort || 9090, Number(robot.sshPort) || 22, 22, 2222])];
        const reachable = (await Promise.all(ports.map(port => checkHostFn(robot.ip, port, timeout)))).some(Boolean);
        return {
          id: normalizeConfiguredRobotId(robot.id) || robot.id,
          name: robot.name,
          ip: robot.ip,
          reachable
        };
      })
    );
    res.json(results);
  });

  router.post('/', (req, res) => {
    const config = loadRobotsConfig();
    const robot = req.body;

    if (!isPlainObject(robot)) {
      return badRequest(res, 'Robot payload required');
    }

    const idError = validateStringField('id', robot.id, {
      required: true,
      maxLength: VALIDATION_LIMITS.robotId
    });
    if (idError) return badRequest(res, idError);
    const normalizedId = normalizeConfiguredRobotId(robot.id);
    if (!normalizedId) return badRequest(res, 'id must be R_### or a number from 0 to 999');

    const nameError = validateStringField('name', robot.name, {
      maxLength: VALIDATION_LIMITS.robotName
    });
    if (nameError) return badRequest(res, nameError);

    const ipError = validateStringField('ip', robot.ip, {
      maxLength: VALIDATION_LIMITS.robotIp
    });
    if (ipError) return badRequest(res, ipError);

    const normalizedRobot = { ...robot, id: normalizedId };
    const existingIndex = config.robots.findIndex(r => normalizeConfiguredRobotId(r.id) === normalizedId);
    if (existingIndex >= 0) {
      config.robots[existingIndex] = normalizedRobot;
    } else {
      config.robots.push(normalizedRobot);
    }

    saveRobotsConfig(config);
    res.json({ success: true });
  });

  router.delete('/:id', (req, res) => {
    const idError = validateStringField('id', req.params.id, {
      required: true,
      maxLength: VALIDATION_LIMITS.robotId
    });
    if (idError) return badRequest(res, idError);

    const normalizedId = normalizeConfiguredRobotId(req.params.id);
    if (!normalizedId) return badRequest(res, 'id must be R_### or a number from 0 to 999');
    const config = loadRobotsConfig();
    config.robots = config.robots.filter(r => normalizeConfiguredRobotId(r.id) !== normalizedId);
    saveRobotsConfig(config);
    res.json({ success: true });
  });

  // Auto detection reads metadata over SSH; never starts a ROS runtime or bridge.
  const handleScan = async (req, res) => {
    const input = req.method === 'POST' ? req.body : req.query;
    if (!isPlainObject(input)) return badRequest(res, 'Scan settings required');
    const baseIp = input.base || DEFAULT_SCAN_SUBNET;
    const portToCheck = input.port === undefined ? DEFAULT_ROSBRIDGE_PORT : Number(input.port);
    const discoveryMode = input.mode || 'auto';
    const startRange = input.start === undefined ? 1 : Number(input.start);
    const endRange = input.end === undefined ? 254 : Number(input.end);
    if (!normalizeSubnetBase(baseIp)) return badRequest(res, 'base must be an IPv4 /24 subnet (e.g. 192.168.20)');
    if (!Number.isInteger(portToCheck) || portToCheck < 1 || portToCheck > 65535) return badRequest(res, 'port out of range');
    if (!['auto', 'ssh', 'rosbridge'].includes(discoveryMode)) return badRequest(res, 'Invalid discovery mode');
    if (!Number.isInteger(startRange) || !Number.isInteger(endRange) || startRange < 1 || endRange > 254 || startRange > endRange) return badRequest(res, 'start/end must be ordered integers from 1 to 254');
    const hints = input.robots || [];
    if (!Array.isArray(hints) || hints.length > 256) return badRequest(res, 'Invalid robot settings');
    const subnet = normalizeSubnetBase(baseIp);
    for (const hint of hints) {
      if (!isPlainObject(hint) || net.isIP(hint.ip) !== 4
        || (!hint.ip.startsWith(subnet + '.') && hint.ip !== FIXED_DISCOVERY_IP)
        || (hint.sshPort !== undefined && (!Number.isInteger(hint.sshPort) || hint.sshPort < 1 || hint.sshPort > 65535))
        || (hint.sshUser !== undefined && (typeof hint.sshUser !== 'string' || hint.sshUser.length > 64))
        || (hint.sshPassword !== undefined && (typeof hint.sshPassword !== 'string' || hint.sshPassword.length > 4096))) return badRequest(res, 'Invalid robot SSH settings');
    }
    if (scanInProgress) return res.status(409).json({ success: false, message: '로봇 검색이 진행 중입니다. 완료 후 다시 검색하세요.' });
    scanInProgress = true;
    try {
      if (typeof syncWindowsNetwork === 'function') await syncWindowsNetwork();
      // Only server-owned configuration and the caller's explicitly supplied per-IP credentials.
      const stored = (loadRobotsConfig().robots || []).filter(robot => robot.ip?.startsWith(subnet + '.') || robot.ip === FIXED_DISCOVERY_IP);
      const knownRobots = [...hints, ...stored.filter(robot => !hints.some(hint => hint.ip === robot.ip && (hint.sshPort || 22) === (robot.sshPort || 22)))];
      const result = await scanSubnetFn({ baseIp, port: portToCheck, discoveryMode, start: startRange, end: endRange, knownRobots });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    } finally { scanInProgress = false; }
  };
  router.get('/scan-subnet', handleScan);
  router.post('/scan-subnet', handleScan);

  // Get robot templates
  router.get('/templates', (req, res) => {
    const path = require('path');
    const fs = require('fs');
    const templatePath = path.join(__dirname, '..', '..', 'config', 'robot-templates.json');
    try {
      const data = fs.readFileSync(templatePath, 'utf8');
      res.json(JSON.parse(data));
    } catch (e) {
      res.json({ templates: [] });
    }
  });

  return router;
}

module.exports = {
  DEFAULT_SCAN_SUBNET,
  FIXED_DISCOVERY_IP,
  normalizeSubnetBase,
  normalizeRobotId,
  normalizeConfiguredRobotId,
  extractRobotIdFromValues,
  scanSubnet,
  scanAutomatic,
  createRobotsRouter
};
