/**
 * CAN Diagnostics API Routes
 */

const express = require('express');
const {
  badRequest,
  validateStringField,
  validateNumberField,
  VALIDATION_LIMITS,
} = require('../validation');
const {
  CAN_INTERFACE,
  executeCanCommand,
  sdoRead,
  sdoWrite,
  scanAllNodes,
  readParams,
  checkDuplicate,
  getCanPortStatus,
} = require('../can/can-commands');
const {
  isProtectedNode,
  PROTECTED_NODES,
  SYNTRON_PARAMS,
} = require('../can/syntron-params');
const { decodeStatusword } = require('../can/can-parser');
const { lookupError } = require('../can/error-codes');

function createCanRouter() {
  const router = express.Router();

  // --- Helpers ---
  function validateRobotIp(req, res) {
    const { robotIp } = req.body;
    const err = validateStringField('robotIp', robotIp, { required: true, maxLength: VALIDATION_LIMITS.host });
    if (err) { badRequest(res, err); return null; }
    return robotIp;
  }

  function validateNodeId(req, res) {
    const { nodeId } = req.body;
    const err = validateNumberField('nodeId', nodeId, { min: 1, max: 127 });
    if (err) { badRequest(res, err); return null; }
    if (nodeId === undefined || nodeId === null) {
      badRequest(res, 'nodeId is required');
      return null;
    }
    if (!Number.isInteger(nodeId)) {
      badRequest(res, 'nodeId must be an integer');
      return null;
    }
    return nodeId;
  }

  function validateHexField(res, field, value, maxDigits) {
    const err = validateStringField(field, value, {
      required: true,
      maxLength: maxDigits + 2
    });
    if (err) { badRequest(res, err); return null; }
    const normalized = value.replace(/^0x/i, '');
    if (!new RegExp(`^[0-9a-fA-F]{1,${maxDigits}}$`).test(normalized)) {
      badRequest(res, `${field} must be a hexadecimal value`);
      return null;
    }
    return normalized;
  }

  function validateSubIndex(res, value) {
    const subIndex = value === undefined ? 0 : value;
    const err = validateNumberField('subIndex', subIndex, { min: 0, max: 255 });
    if (err) { badRequest(res, err); return null; }
    if (!Number.isInteger(subIndex)) {
      badRequest(res, 'subIndex must be an integer');
      return null;
    }
    return subIndex;
  }

  function validateNodeIds(res, nodeIds) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      badRequest(res, 'nodeIds must be a non-empty array');
      return null;
    }
    if (nodeIds.length > 127 || nodeIds.some(nodeId => (
      !Number.isInteger(nodeId) || nodeId < 1 || nodeId > 127
    ))) {
      badRequest(res, 'nodeIds must contain integers from 1 to 127');
      return null;
    }
    return nodeIds;
  }

  // ==================== POST /scan ====================
  router.post('/scan', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;

    try {
      const nodes = await scanAllNodes(robotIp);
      res.json({ success: true, nodes });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /sdo-read ====================
  router.post('/sdo-read', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;
    const nodeId = validateNodeId(req, res);
    if (nodeId === null) return;

    const indexHex = validateHexField(res, 'indexHex', req.body.indexHex, 4);
    if (indexHex === null) return;
    const subIndex = validateSubIndex(res, req.body.subIndex);
    if (subIndex === null) return;

    // Parse index into low/high bytes
    const idx = indexHex.replace(/^0x/i, '').padStart(4, '0');
    const indexHi = idx.slice(0, 2);
    const indexLo = idx.slice(2, 4);
    const sub = subIndex.toString(16).padStart(2, '0');

    try {
      const result = await sdoRead(robotIp, nodeId, indexLo, indexHi, sub);
      res.json({ success: true, result });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /sdo-write ====================
  router.post('/sdo-write', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;
    const nodeId = validateNodeId(req, res);
    if (nodeId === null) return;

    if (isProtectedNode(nodeId)) {
      return res.json({
        success: false,
        message: `Node ${nodeId}은(는) 보호 노드(${PROTECTED_NODES.join(',')})입니다. SDO Write가 차단되었습니다.`,
      });
    }

    const indexHex = validateHexField(res, 'indexHex', req.body.indexHex, 4);
    if (indexHex === null) return;
    const dataHex = validateHexField(res, 'dataHex', req.body.dataHex, 8);
    if (dataHex === null) return;
    const subIndex = validateSubIndex(res, req.body.subIndex);
    if (subIndex === null) return;

    const idx = indexHex.replace(/^0x/i, '').padStart(4, '0');
    const indexHi = idx.slice(0, 2);
    const indexLo = idx.slice(2, 4);
    const sub = subIndex.toString(16).padStart(2, '0');
    const dataSize = Math.ceil(dataHex.length / 2);

    try {
      const result = await sdoWrite(robotIp, nodeId, indexLo, indexHi, sub, dataHex, dataSize);

      // Check for rebootRequired params
      const matchParam = SYNTRON_PARAMS.find(p => p.reg.toUpperCase() === indexLo.toUpperCase() && indexHi.toUpperCase() === '20');
      const warnings = [];
      if (matchParam && matchParam.rebootRequired) {
        warnings.push('전원 재투입 필요');
      }

      res.json({ success: true, result, warnings });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /params ====================
  router.post('/params', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;

    const nodeIds = validateNodeIds(res, req.body.nodeIds);
    if (nodeIds === null) return;

    try {
      const results = {};
      for (const nid of nodeIds) {
        results[nid] = await readParams(robotIp, nid);
      }
      res.json({ success: true, params: results });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /compare ====================
  router.post('/compare', async (req, res) => {
    const { robotIp1, robotIp2 } = req.body;
    const err1 = validateStringField('robotIp1', robotIp1, { required: true, maxLength: VALIDATION_LIMITS.host });
    if (err1) return badRequest(res, err1);
    const err2 = validateStringField('robotIp2', robotIp2, { required: true, maxLength: VALIDATION_LIMITS.host });
    if (err2) return badRequest(res, err2);

    try {
      // Read params for drive motors (1~4) from both robots
      const driveNodes = [1, 2, 3, 4];
      const [params1, params2] = await Promise.all([
        Promise.all(driveNodes.map(n => readParams(robotIp1, n).then(p => ({ nodeId: n, params: p })))),
        Promise.all(driveNodes.map(n => readParams(robotIp2, n).then(p => ({ nodeId: n, params: p })))),
      ]);

      // Compare parameters
      const diffs = [];
      for (let i = 0; i < driveNodes.length; i++) {
        const p1 = params1[i].params;
        const p2 = params2[i].params;
        const nodeDiffs = [];

        for (let j = 0; j < p1.length; j++) {
          if (p1[j].value !== null && p2[j].value !== null && p1[j].value !== p2[j].value) {
            nodeDiffs.push({
              param: p1[j].fn || p1[j].index,
              name: p1[j].name,
              robot1: p1[j].value,
              robot2: p2[j].value,
            });
          }
        }

        if (nodeDiffs.length > 0) {
          diffs.push({ nodeId: driveNodes[i], diffs: nodeDiffs });
        }
      }

      res.json({ success: true, robotIp1, robotIp2, diffs });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /setup ====================
  router.post('/setup', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;
    const nodeId = validateNodeId(req, res);
    if (nodeId === null) return;

    if (isProtectedNode(nodeId)) {
      return res.json({
        success: false,
        message: `Node ${nodeId}은(는) 보호 노드입니다. 셋업 스크립트 실행이 차단되었습니다.`,
      });
    }

    try {
      const result = await executeCanCommand(robotIp, `bash /root/syntron_setup.sh ${nodeId}`, 30000);
      res.json({
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /id-change ====================
  router.post('/id-change', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;

    const { oldId, newId } = req.body;
    const oldErr = validateNumberField('oldId', oldId, { min: 1, max: 127 });
    if (oldErr) return badRequest(res, oldErr);
    const newErr = validateNumberField('newId', newId, { min: 1, max: 127 });
    if (newErr) return badRequest(res, newErr);
    if (oldId === undefined) return badRequest(res, 'oldId is required');
    if (newId === undefined) return badRequest(res, 'newId is required');
    if (!Number.isInteger(oldId) || !Number.isInteger(newId)) {
      return badRequest(res, 'oldId and newId must be integers');
    }

    try {
      // Write new Node ID to Fn0F4 (register F4, index 20F4h)
      const newIdHex = newId.toString(16).padStart(2, '0') + '00';
      const result = await sdoWrite(robotIp, oldId, 'F4', '20', '00', newIdHex, 2);

      const warnings = ['전원 재투입 필요 (Node ID 변경 적용)'];

      res.json({ success: true, result, warnings });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /drive-test ====================
  router.post('/drive-test', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;
    const nodeId = validateNodeId(req, res);
    if (nodeId === null) return;

    if (isProtectedNode(nodeId)) {
      return res.json({
        success: false,
        message: `Node ${nodeId}은(는) 보호 노드입니다. 구동 테스트가 차단되었습니다.`,
      });
    }

    const { dec, duration } = req.body;
    const decErr = validateNumberField('dec', dec, { min: -3000, max: 3000 });
    if (decErr) return badRequest(res, decErr);
    const durErr = validateNumberField('duration', duration, { min: 100, max: 10000 });
    if (durErr) return badRequest(res, durErr);

    if (dec === undefined) return badRequest(res, 'dec (speed) is required');
    if (duration === undefined) return badRequest(res, 'duration is required');

    const txCobId = (0x600 + nodeId).toString(16).toUpperCase();

    // Convert speed to little-endian hex (int32)
    const speedVal = dec < 0 ? dec + 4294967296 : dec;
    const speedHex = speedVal.toString(16).padStart(8, '0');
    const speedLE = speedHex.slice(6, 8) + speedHex.slice(4, 6) + speedHex.slice(2, 4) + speedHex.slice(0, 2);

    try {
      const steps = [
        // Set target velocity (60FFh)
        `cansend ${CAN_INTERFACE} ${txCobId}#23FF600000000000`,
        // Set controlword to enable (6040h = 000F)
        `cansend ${CAN_INTERFACE} ${txCobId}#2B40600F00000000`,
        // Small delay
        'sleep 0.1',
        // Set target velocity
        `cansend ${CAN_INTERFACE} ${txCobId}#23FF6000${speedLE}`,
        // Wait for duration
        `sleep ${(duration / 1000).toFixed(1)}`,
        // Stop: set velocity to 0
        `cansend ${CAN_INTERFACE} ${txCobId}#23FF600000000000`,
        'sleep 0.2',
        // Disable
        `cansend ${CAN_INTERFACE} ${txCobId}#2B40600600000000`,
      ];

      const cmd = steps.join('; ');
      const result = await executeCanCommand(robotIp, cmd, duration + 10000);

      res.json({
        success: true,
        stdout: result.stdout,
        stderr: result.stderr,
        params: { nodeId, speed: dec, duration },
      });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /fault-reset ====================
  router.post('/fault-reset', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;
    const nodeId = validateNodeId(req, res);
    if (nodeId === null) return;

    const txCobId = (0x600 + nodeId).toString(16).toUpperCase();

    try {
      // Write Controlword (6040h) = 0x0080 (Fault Reset)
      const cmd = [
        `cansend ${CAN_INTERFACE} ${txCobId}#2B40608000000000`,
        'sleep 0.5',
        `cansend ${CAN_INTERFACE} ${txCobId}#2B40600000000000`,
      ].join('; ');

      await executeCanCommand(robotIp, cmd, 5000);

      // Read back status
      const sw = await sdoRead(robotIp, nodeId, '41', '60', '00');
      const ec = await sdoRead(robotIp, nodeId, '3F', '60', '00');

      res.json({
        success: true,
        statusword: sw && !sw.abort ? decodeStatusword(sw.value) : null,
        errorCode: ec && !ec.abort ? lookupError(ec.value) : null,
      });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /sto ====================
  router.post('/sto', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;

    const nodeIds = validateNodeIds(res, req.body.nodeIds);
    if (nodeIds === null) return;
    const { value } = req.body;
    if (value !== 'on' && value !== 'off') {
      return badRequest(res, 'value must be "on" or "off"');
    }

    // STO: Fn035 (register 35h, index 2035h)
    // STO OFF = 0x55AA (disable STO safety), STO ON = 0x0000 (enable STO safety)
    const stoData = value === 'off' ? 'AA55' : '0000';  // little-endian

    const results = [];
    const warnings = [];

    for (const nodeId of nodeIds) {
      // Block STO changes for encoder nodes
      if ([5, 6].includes(nodeId)) {
        results.push({ nodeId, success: false, message: `Node ${nodeId} (조향 엔코더)은(는) STO 변경이 차단되었습니다.` });
        continue;
      }

      // Warn for lift node but allow
      if (nodeId === 7) {
        warnings.push(`Node 7 (리프트): STO 변경 허용되지만 주의 필요`);
      }

      // Protect against param writes on non-lift protected nodes
      if (isProtectedNode(nodeId) && nodeId !== 7) {
        results.push({ nodeId, success: false, message: `Node ${nodeId}은(는) 보호 노드입니다.` });
        continue;
      }

      try {
        // force: true for Node 7 (lift) to bypass generic protection
        const result = await sdoWrite(robotIp, nodeId, '35', '20', '00', stoData, 2, { force: nodeId === 7 });
        results.push({ nodeId, success: !result.abort, result });
      } catch (e) {
        results.push({ nodeId, success: false, message: e.message });
      }
    }

    res.json({ success: true, results, warnings });
  });

  // ==================== POST /busoff-check ====================
  router.post('/busoff-check', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;

    try {
      const status = await getCanPortStatus(robotIp);
      res.json({ success: true, status });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /busoff-recover ====================
  router.post('/busoff-recover', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;

    const { sudoPassword } = req.body;

    try {
      // Restart CAN interface
      const cmd = sudoPassword
        ? `echo '${sudoPassword.replace(/'/g, "'\\''")}' | sudo -S sh -c 'ip link set can0 down && ip link set can0 up type can bitrate 500000 && ip link set can0 up'`
        : 'ip link set can0 down && ip link set can0 up type can bitrate 500000 && ip link set can0 up';

      const result = await executeCanCommand(robotIp, cmd, 10000);

      // Check status after recovery
      const status = await getCanPortStatus(robotIp);

      res.json({
        success: !status.busOff,
        stdout: result.stdout,
        stderr: result.stderr,
        status,
      });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /dup-check ====================
  router.post('/dup-check', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;
    const nodeId = validateNodeId(req, res);
    if (nodeId === null) return;

    try {
      const result = await checkDuplicate(robotIp, nodeId);
      res.json({ success: true, ...result });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /enable ====================
  router.post('/enable', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;
    const nodeId = validateNodeId(req, res);
    if (nodeId === null) return;

    const txCobId = (0x600 + nodeId).toString(16).toUpperCase();

    try {
      // CiA 402 Enable sequence:
      // 1. Shutdown (0x0006)
      // 2. Switch On (0x0007)
      // 3. Enable Operation (0x000F)
      const cmd = [
        `cansend ${CAN_INTERFACE} ${txCobId}#2B40600600000000`,
        'sleep 0.1',
        `cansend ${CAN_INTERFACE} ${txCobId}#2B40600700000000`,
        'sleep 0.1',
        `cansend ${CAN_INTERFACE} ${txCobId}#2B40600F00000000`,
        'sleep 0.3',
      ].join('; ');

      await executeCanCommand(robotIp, cmd, 5000);

      // Read back status
      const sw = await sdoRead(robotIp, nodeId, '41', '60', '00');

      res.json({
        success: true,
        statusword: sw && !sw.abort ? decodeStatusword(sw.value) : null,
      });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  // ==================== POST /can-status ====================
  router.post('/can-status', async (req, res) => {
    const robotIp = validateRobotIp(req, res);
    if (!robotIp) return;

    try {
      const status = await getCanPortStatus(robotIp);
      res.json({ success: true, status });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  });

  return router;
}

module.exports = { createCanRouter };
