/**
 * CAN Response Parsing Utilities
 */

const { lookupError } = require('./error-codes');

/**
 * Parse a single candump output line.
 * Format: "  can0  181   [8]  00 00 00 00 00 00 00 00"
 * @param {string} line
 * @returns {{ canId: string, dataLen: number, data: string[] } | null}
 */
function parseCandumpLine(line) {
  // candump format: "  can0  1A1   [8]  01 02 03 04 05 06 07 08"
  const match = line.match(/can\d\s+([0-9A-Fa-f]+)\s+\[(\d+)\]\s+(.*)/);
  if (!match) return null;

  const canId = match[1].toUpperCase();
  const dataLen = parseInt(match[2], 10);
  const dataStr = match[3].trim();
  const data = dataStr ? dataStr.split(/\s+/) : [];

  return { canId, dataLen, data };
}

/**
 * Parse SDO response data bytes.
 * SDO Read response (server -> client): command byte tells data size.
 *   0x4F = 1 byte, 0x4B = 2 bytes, 0x47 = 3 bytes, 0x43 = 4 bytes
 *   0x80 = SDO Abort
 * @param {string[]} data - 8 bytes as hex strings
 * @returns {{ command: string, index: string, sub: string, value: number } | { abort: true, errorCode: string }}
 */
function parseSdoResponse(data) {
  if (!data || data.length < 4) return null;

  const cmd = parseInt(data[0], 16);

  // SDO Abort: command byte = 0x80
  if (cmd === 0x80) {
    const errorCode = data[7] + data[6] + data[5] + data[4];
    return { abort: true, errorCode };
  }

  const indexLo = data[1];
  const indexHi = data[2];
  const sub = data[3];
  const index = indexHi + indexLo;

  // Determine data size from command byte
  let value;
  if (cmd === 0x4F) {
    // 1 byte
    value = parseInt(data[4], 16);
  } else if (cmd === 0x4B) {
    // 2 bytes (little-endian)
    value = parseInt(data[5], 16) * 256 + parseInt(data[4], 16);
  } else if (cmd === 0x47) {
    // 3 bytes
    value = parseInt(data[6], 16) * 65536 + parseInt(data[5], 16) * 256 + parseInt(data[4], 16);
  } else if (cmd === 0x43) {
    // 4 bytes (little-endian)
    value = (parseInt(data[7], 16) * 16777216) +
            (parseInt(data[6], 16) * 65536) +
            (parseInt(data[5], 16) * 256) +
            parseInt(data[4], 16);
  } else if (cmd === 0x60) {
    // SDO Write confirmation
    return { command: 'write-ok', index, sub, value: 0 };
  } else {
    return { command: data[0], index, sub, value: null };
  }

  return { command: data[0], index, sub, value };
}

/**
 * Decode CiA 402 Statusword.
 * @param {number} sw - 16-bit statusword value
 * @returns {{ state: string, bits: object }}
 */
function decodeStatusword(sw) {
  const bits = {
    readyToSwitchOn: !!(sw & 0x0001),
    switchedOn: !!(sw & 0x0002),
    operationEnabled: !!(sw & 0x0004),
    fault: !!(sw & 0x0008),
    voltageEnabled: !!(sw & 0x0010),
    quickStop: !!(sw & 0x0020),
    switchOnDisabled: !!(sw & 0x0040),
    warning: !!(sw & 0x0080),
    remote: !!(sw & 0x0200),
    targetReached: !!(sw & 0x0400),
    internalLimitActive: !!(sw & 0x0800),
  };

  let state;
  const masked = sw & 0x006F;

  if (sw & 0x0008) {
    state = 'FAULT';
  } else if (masked === 0x0027) {
    state = 'ENABLE';
  } else if (masked === 0x0023) {
    state = 'SWITCHED_ON';
  } else if (masked === 0x0021) {
    state = 'READY';
  } else if (masked === 0x0040) {
    state = 'DISABLED';
  } else if (masked === 0x0007) {
    state = 'QUICK_STOP';
  } else {
    state = 'OFFLINE';
  }

  return { state, bits };
}

/**
 * Parse TPDO1 from drive motor (Node 1~4).
 * TPDO1 COB-ID = 0x180 + nodeId
 * Data: position (4 bytes, int32) + velocity (4 bytes, int32), little-endian
 * @param {string[]} data - 8 hex bytes
 * @returns {{ position: number, velocity: number }}
 */
function parseTpdo1Drive(data) {
  if (!data || data.length < 8) return null;

  const position = readInt32LE(data, 0);
  const velocity = readInt32LE(data, 4);

  return { position, velocity };
}

/**
 * Parse TPDO2 from drive motor (Node 1~4).
 * TPDO2 COB-ID = 0x280 + nodeId
 * Data: statusword (2 bytes) + errorCode (2 bytes) + current (2 bytes)
 * @param {string[]} data - 8 hex bytes
 * @returns {{ statusword: number, statusDecoded: object, errorCode: number, errorInfo: object, current: number }}
 */
function parseTpdo2Drive(data) {
  if (!data || data.length < 6) return null;

  const statusword = readUint16LE(data, 0);
  const errorCode = readUint16LE(data, 2);
  const current = readInt16LE(data, 4);

  return {
    statusword,
    statusDecoded: decodeStatusword(statusword),
    errorCode,
    errorInfo: lookupError(errorCode),
    current,
  };
}

/**
 * Parse TPDO1 from Briter encoder (Node 5, 6).
 * TPDO1 COB-ID = 0x180 + nodeId
 * Data: raw angle value (4 bytes, uint32), little-endian
 * @param {string[]} data - 8 hex bytes
 * @returns {{ rawValue: number, angleDeg: number }}
 */
function parseTpdo1Encoder(data) {
  if (!data || data.length < 4) return null;

  const rawValue = readUint32LE(data, 0);
  // Briter encoder: 14-bit = 16384 counts per revolution
  const angleDeg = (rawValue % 16384) / 16384 * 360;

  return { rawValue, angleDeg: Math.round(angleDeg * 100) / 100 };
}

// --- Little-endian helpers ---

function readUint16LE(data, offset) {
  return parseInt(data[offset + 1], 16) * 256 + parseInt(data[offset], 16);
}

function readInt16LE(data, offset) {
  const val = readUint16LE(data, offset);
  return val > 32767 ? val - 65536 : val;
}

function readUint32LE(data, offset) {
  return (parseInt(data[offset + 3], 16) * 16777216) +
         (parseInt(data[offset + 2], 16) * 65536) +
         (parseInt(data[offset + 1], 16) * 256) +
         parseInt(data[offset], 16);
}

function readInt32LE(data, offset) {
  const val = readUint32LE(data, offset);
  return val > 2147483647 ? val - 4294967296 : val;
}

module.exports = {
  parseCandumpLine,
  parseSdoResponse,
  decodeStatusword,
  parseTpdo1Drive,
  parseTpdo2Drive,
  parseTpdo1Encoder,
};
