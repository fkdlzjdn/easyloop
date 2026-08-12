const express = require('express');
const net = require('net');
const WebSocket = require('ws');
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
    discoveryMode = 'rosbridge',
    timeout = 650,
    start = 1,
    end = 254,
    checkHostFn = checkHost,
    discoverRobotIdFn = discoverRobotId
  } = options;

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
  syncWindowsNetwork
}) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const config = loadRobotsConfig();
    res.json(config.robots);
  });

  // Scan reachability of all configured robots
  router.get('/scan', async (req, res) => {
    const config = loadRobotsConfig();
    const timeout = 1500;
    const results = await Promise.all(
      config.robots.map(async (robot) => {
        const reachable = await checkHost(robot.ip, robot.rosBridgePort || 9090, timeout);
        return { id: robot.id, name: robot.name, ip: robot.ip, reachable };
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

    const nameError = validateStringField('name', robot.name, {
      maxLength: VALIDATION_LIMITS.robotName
    });
    if (nameError) return badRequest(res, nameError);

    const ipError = validateStringField('ip', robot.ip, {
      maxLength: VALIDATION_LIMITS.robotIp
    });
    if (ipError) return badRequest(res, ipError);

    const existingIndex = config.robots.findIndex(r => r.id === robot.id);
    if (existingIndex >= 0) {
      config.robots[existingIndex] = robot;
    } else {
      config.robots.push(robot);
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

    const config = loadRobotsConfig();
    config.robots = config.robots.filter(r => r.id !== req.params.id);
    saveRobotsConfig(config);
    res.json({ success: true });
  });

  // Scan subnet for potential robots
  router.get('/scan-subnet', async (req, res) => {
    const baseIp = req.query.base || DEFAULT_SCAN_SUBNET;
    const portToCheck = Number.parseInt(req.query.port, 10) || DEFAULT_ROSBRIDGE_PORT;
    const discoveryMode = req.query.mode === 'ssh' ? 'ssh' : 'rosbridge';
    const startRange = Math.max(Number.parseInt(req.query.start, 10) || 1, 1);
    const endRange = Math.min(Number.parseInt(req.query.end, 10) || 254, 254);

    if (!normalizeSubnetBase(baseIp)) {
      return badRequest(res, 'base must be an IPv4 /24 subnet (e.g. 192.168.20)');
    }
    if (portToCheck < 1 || portToCheck > 65535) {
      return badRequest(res, 'port out of range');
    }
    if (startRange > endRange) {
      return badRequest(res, 'start must be less than or equal to end');
    }

    try {
      if (typeof syncWindowsNetwork === 'function') {
        await syncWindowsNetwork();
      }
      const result = await scanSubnet({
        baseIp,
        port: portToCheck,
        discoveryMode,
        start: startRange,
        end: endRange
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

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
  extractRobotIdFromValues,
  scanSubnet,
  createRobotsRouter
};
