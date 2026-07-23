/**
 * CAN Commands Module
 * Executes CAN bus commands on robots via SSH (cansend/candump).
 */

const { Client } = require('ssh2');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseCandumpLine, parseSdoResponse, parseTpdo2Drive, parseTpdo1Encoder, decodeStatusword } = require('./can-parser');
const { lookupError } = require('./error-codes');
const { SYNTRON_PARAMS, CANOPEN_PARAMS, isProtectedNode, isDriveMotor, isEncoder } = require('./syntron-params');

const SSH_USER = 'root';
const SSH_PORT = 22;
const CAN_INTERFACE = 'can0';

/**
 * Create a one-shot SSH connection and execute a command.
 * Uses key-based auth first, falls back to password.
 * @param {string} robotIp
 * @param {string} command
 * @param {number} [timeout=10000]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
function executeCanCommand(robotIp, command, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const sshKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');

    const authConfig = {
      host: robotIp,
      port: SSH_PORT,
      username: SSH_USER,
      readyTimeout: 10000,
    };

    if (fs.existsSync(sshKeyPath)) {
      authConfig.privateKey = fs.readFileSync(sshKeyPath);
    }

    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { conn.end(); } catch (e) { /* ignore */ }
        reject(new Error(`SSH command timeout (${timeout}ms): ${command}`));
      }
    }, timeout);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          done = true;
          clearTimeout(timer);
          conn.end();
          return reject(err);
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });

        stream.on('close', (code) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            conn.end();
            resolve({ stdout, stderr, exitCode: code });
          }
        });
      });
    });

    conn.on('error', (err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new Error(`SSH connection failed (${robotIp}): ${err.message}`));
      }
    });

    conn.connect(authConfig);
  });
}

/**
 * Run candump, collect frames matching given CAN IDs, return parsed lines.
 * @param {string} robotIp
 * @param {string[]} canIds - CAN IDs to filter (hex, e.g. ['181', '281'])
 * @param {number} [count=10] - Max frames to collect
 * @param {number} [timeout=5000] - Timeout in ms
 * @returns {Promise<Array<{ canId: string, dataLen: number, data: string[] }>>}
 */
async function candump(robotIp, canIds, count = 10, timeout = 5000) {
  const filters = canIds.map(id => `${CAN_INTERFACE},${id}:7FF`).join(' ');
  const cmd = `timeout ${(timeout / 1000).toFixed(1)} candump ${filters} -n ${count} 2>/dev/null || true`;

  const result = await executeCanCommand(robotIp, cmd, timeout + 3000);
  const lines = result.stdout.split('\n').filter(l => l.trim());
  const parsed = [];

  for (const line of lines) {
    const p = parseCandumpLine(line);
    if (p) parsed.push(p);
  }

  return parsed;
}

/**
 * Send a single CAN frame via cansend.
 * @param {string} robotIp
 * @param {string} canFrame - e.g. "601#2B17200000000000"
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
async function cansend(robotIp, canFrame) {
  const cmd = `cansend ${CAN_INTERFACE} ${canFrame}`;
  return executeCanCommand(robotIp, cmd, 5000);
}

/**
 * SDO Read: send SDO upload request and capture response.
 * SDO Read request COB-ID = 0x600 + nodeId
 * SDO Read response COB-ID = 0x580 + nodeId
 * @param {string} robotIp
 * @param {number} nodeId - 1~7
 * @param {string} indexLo - Low byte of index (hex, e.g. '00')
 * @param {string} indexHi - High byte of index (hex, e.g. '20')
 * @param {string} sub - Sub-index (hex, e.g. '00')
 * @returns {Promise<object>}
 */
async function sdoRead(robotIp, nodeId, indexLo, indexHi, sub) {
  const txCobId = (0x600 + nodeId).toString(16).toUpperCase();
  const rxCobId = (0x580 + nodeId).toString(16).toUpperCase();

  // SDO Upload request: 40 indexLo indexHi sub 00 00 00 00
  const frame = `${txCobId}#40${indexLo}${indexHi}${sub}00000000`;

  // Start candump in background, then send frame
  const cmd = [
    `candump ${CAN_INTERFACE},${rxCobId}:7FF -n 1 -T 3000 &`,
    'DUMP_PID=$!',
    'sleep 0.05',
    `cansend ${CAN_INTERFACE} ${frame}`,
    'wait $DUMP_PID 2>/dev/null || true',
  ].join('; ');

  const result = await executeCanCommand(robotIp, cmd, 8000);
  const lines = result.stdout.split('\n').filter(l => l.trim());

  for (const line of lines) {
    const parsed = parseCandumpLine(line);
    if (parsed && parsed.canId === rxCobId) {
      return parseSdoResponse(parsed.data);
    }
  }

  return { abort: true, errorCode: 'NO_RESPONSE', timeout: true };
}

/**
 * SDO Write: send SDO download request and capture confirmation.
 * @param {string} robotIp
 * @param {number} nodeId
 * @param {string} indexLo
 * @param {string} indexHi
 * @param {string} sub
 * @param {string} data - Data bytes as hex (e.g. 'AA550000')
 * @param {number} dataSize - 1, 2, or 4 bytes
 * @param {{ force: boolean }} [options] - force: true to bypass protected node check
 * @returns {Promise<object>}
 */
async function sdoWrite(robotIp, nodeId, indexLo, indexHi, sub, data, dataSize, options = {}) {
  if (isProtectedNode(nodeId) && !options.force) {
    return { abort: true, errorCode: 'PROTECTED_NODE', message: `Node ${nodeId}은(는) 보호 노드입니다. 파라미터 쓰기가 차단되었습니다.` };
  }

  const txCobId = (0x600 + nodeId).toString(16).toUpperCase();
  const rxCobId = (0x580 + nodeId).toString(16).toUpperCase();

  // SDO Download command byte depends on data size
  let cmdByte;
  switch (dataSize) {
    case 1: cmdByte = '2F'; break;
    case 2: cmdByte = '2B'; break;
    case 4: cmdByte = '23'; break;
    default: cmdByte = '23'; break;
  }

  // Pad data to 8 hex chars (4 bytes)
  const paddedData = data.padEnd(8, '0');

  const frame = `${txCobId}#${cmdByte}${indexLo}${indexHi}${sub}${paddedData}`;

  const cmd = [
    `candump ${CAN_INTERFACE},${rxCobId}:7FF -n 1 -T 3000 &`,
    'DUMP_PID=$!',
    'sleep 0.05',
    `cansend ${CAN_INTERFACE} ${frame}`,
    'wait $DUMP_PID 2>/dev/null || true',
  ].join('; ');

  const result = await executeCanCommand(robotIp, cmd, 8000);
  const lines = result.stdout.split('\n').filter(l => l.trim());

  for (const line of lines) {
    const parsed = parseCandumpLine(line);
    if (parsed && parsed.canId === rxCobId) {
      return parseSdoResponse(parsed.data);
    }
  }

  return { abort: true, errorCode: 'NO_RESPONSE', timeout: true };
}

/**
 * Scan all nodes 1~7: read TPDO + SDO Statusword + SDO Error Code.
 * @param {string} robotIp
 * @returns {Promise<object[]>}
 */
async function scanAllNodes(robotIp) {
  const nodes = [];

  // Collect TPDO frames for 5 seconds
  const tpdoIds = [];
  for (let n = 1; n <= 7; n++) {
    tpdoIds.push((0x180 + n).toString(16).toUpperCase()); // TPDO1
    tpdoIds.push((0x280 + n).toString(16).toUpperCase()); // TPDO2
  }
  const tpdoFrames = await candump(robotIp, tpdoIds, 100, 5000);

  // Group frames by node
  const tpdoByNode = {};
  for (const f of tpdoFrames) {
    const cobId = parseInt(f.canId, 16);
    let nodeId, tpdoNum;
    if (cobId >= 0x181 && cobId <= 0x187) {
      nodeId = cobId - 0x180;
      tpdoNum = 1;
    } else if (cobId >= 0x281 && cobId <= 0x287) {
      nodeId = cobId - 0x280;
      tpdoNum = 2;
    } else continue;

    if (!tpdoByNode[nodeId]) tpdoByNode[nodeId] = {};
    tpdoByNode[nodeId][`tpdo${tpdoNum}`] = f;
  }

  // For each node, read SDO Statusword (6041h) and Error Code (603Fh)
  for (let nodeId = 1; nodeId <= 7; nodeId++) {
    const nodeInfo = {
      nodeId,
      online: false,
      type: isDriveMotor(nodeId) ? 'drive' : isEncoder(nodeId) ? 'encoder' : 'lift',
      tpdo: tpdoByNode[nodeId] || null,
      statusword: null,
      errorCode: null,
    };

    // Check if node responded with TPDO
    if (tpdoByNode[nodeId]) {
      nodeInfo.online = true;

      // Parse TPDO2 for drive motors
      if (isDriveMotor(nodeId) && tpdoByNode[nodeId].tpdo2) {
        const tpdo2 = parseTpdo2Drive(tpdoByNode[nodeId].tpdo2.data);
        if (tpdo2) {
          nodeInfo.statusword = tpdo2.statusDecoded;
          nodeInfo.errorCode = tpdo2.errorInfo;
        }
      }
    }

    // SDO read Statusword (6041h sub 00) for drives
    if (isDriveMotor(nodeId)) {
      try {
        const sw = await sdoRead(robotIp, nodeId, '41', '60', '00');
        if (sw && !sw.abort) {
          nodeInfo.online = true;
          nodeInfo.statusword = decodeStatusword(sw.value);
        }
      } catch (e) { /* node offline */ }

      // SDO read Error Code (603Fh sub 00)
      try {
        const ec = await sdoRead(robotIp, nodeId, '3F', '60', '00');
        if (ec && !ec.abort) {
          nodeInfo.errorCode = lookupError(ec.value);
        }
      } catch (e) { /* ignore */ }
    }

    nodes.push(nodeInfo);
  }

  return nodes;
}

/**
 * Read all Syntron parameters for a given node.
 * @param {string} robotIp
 * @param {number} nodeId
 * @returns {Promise<object[]>}
 */
async function readParams(robotIp, nodeId) {
  const results = [];

  // Read Fn parameters (Syntron vendor-specific: index 20xxh)
  for (const param of SYNTRON_PARAMS) {
    try {
      const resp = await sdoRead(robotIp, nodeId, param.reg, '20', '00');
      results.push({
        fn: param.fn,
        name: param.name,
        type: param.type,
        unit: param.unit || '',
        rebootRequired: param.rebootRequired || false,
        value: resp && !resp.abort ? resp.value : null,
        error: resp && resp.abort ? resp.errorCode : null,
      });
    } catch (e) {
      results.push({
        fn: param.fn,
        name: param.name,
        value: null,
        error: e.message,
      });
    }
  }

  // Read CANopen standard parameters
  for (const param of CANOPEN_PARAMS) {
    const indexLo = param.index.slice(2, 4);
    const indexHi = param.index.slice(0, 2);
    try {
      const resp = await sdoRead(robotIp, nodeId, indexLo, indexHi, '00');
      results.push({
        index: param.index,
        name: param.name,
        type: param.type,
        value: resp && !resp.abort ? resp.value : null,
        error: resp && resp.abort ? resp.errorCode : null,
      });
    } catch (e) {
      results.push({
        index: param.index,
        name: param.name,
        value: null,
        error: e.message,
      });
    }
  }

  return results;
}

/**
 * Check for duplicate node on CAN bus by analyzing TPDO pattern.
 * Two nodes with the same ID will produce collision artifacts.
 * @param {string} robotIp
 * @param {number} nodeId
 * @returns {Promise<{ duplicate: boolean, evidence: string }>}
 */
async function checkDuplicate(robotIp, nodeId) {
  const cobId = (0x180 + nodeId).toString(16).toUpperCase();
  const frames = await candump(robotIp, [cobId], 20, 3000);

  if (frames.length === 0) {
    return { duplicate: false, evidence: 'No frames received (node offline)' };
  }

  // Check for varying data patterns that indicate collision
  const dataSet = new Set();
  for (const f of frames) {
    dataSet.add(f.data.join(''));
  }

  // If we see many different patterns in a short time, likely duplicate
  if (dataSet.size > 10) {
    return { duplicate: true, evidence: `${dataSet.size} unique patterns in ${frames.length} frames - collision detected` };
  }

  return { duplicate: false, evidence: `${dataSet.size} unique patterns in ${frames.length} frames - normal` };
}

/**
 * Get CAN port status via ip link show.
 * @param {string} robotIp
 * @returns {Promise<object>}
 */
async function getCanPortStatus(robotIp) {
  const result = await executeCanCommand(robotIp, `ip -d link show ${CAN_INTERFACE} 2>/dev/null; cat /sys/class/net/${CAN_INTERFACE}/statistics/rx_errors 2>/dev/null; cat /sys/class/net/${CAN_INTERFACE}/statistics/tx_errors 2>/dev/null`, 5000);

  const output = result.stdout;
  const lines = output.split('\n');

  const status = {
    interface: CAN_INTERFACE,
    state: 'UNKNOWN',
    bitrate: null,
    rxErrors: 0,
    txErrors: 0,
    busOff: false,
    raw: output,
  };

  for (const line of lines) {
    const stateMatch = line.match(/state\s+(ERROR-ACTIVE|ERROR-PASSIVE|BUS-OFF|STOPPED)/i);
    if (stateMatch) {
      status.state = stateMatch[1].toUpperCase();
      status.busOff = status.state === 'BUS-OFF';
    }

    const bitrateMatch = line.match(/bitrate\s+(\d+)/);
    if (bitrateMatch) {
      status.bitrate = parseInt(bitrateMatch[1], 10);
    }

    const linkStateMatch = line.match(/state\s+(UP|DOWN)/);
    if (linkStateMatch && status.state === 'UNKNOWN') {
      status.state = linkStateMatch[1];
    }
  }

  // rx/tx errors from sysfs (last two lines)
  const numericLines = lines.filter(l => /^\d+$/.test(l.trim()));
  if (numericLines.length >= 2) {
    status.rxErrors = parseInt(numericLines[0].trim(), 10);
    status.txErrors = parseInt(numericLines[1].trim(), 10);
  }

  return status;
}

module.exports = {
  executeCanCommand,
  candump,
  cansend,
  sdoRead,
  sdoWrite,
  scanAllNodes,
  readParams,
  checkDuplicate,
  getCanPortStatus,
};
