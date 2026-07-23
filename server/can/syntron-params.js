/**
 * Syntron Motor Parameter Definitions
 * Drive motors: Node 1~4
 * Steering encoders: Node 5, 6 (Briter, read-only)
 * Lift motor: Node 7 (read-only)
 */

const SYNTRON_PARAMS = [
  { fn: '000', reg: '00', name: 'Protocol', type: 'uint16' },
  { fn: '001', reg: '01', name: 'Control Mode Select', type: 'uint16' },
  { fn: '003', reg: '03', name: 'Bus Control Mode', type: 'uint16' },
  { fn: '004', reg: '04', name: 'Direction', type: 'uint16' },
  { fn: '005', reg: '05', name: 'Display', type: 'uint16' },
  { fn: '006', reg: '06', name: 'Motor Code', type: 'uint16' },
  { fn: '007', reg: '07', name: 'Load Ex-works', type: 'uint16' },
  { fn: '009', reg: '09', name: 'Reserved', type: 'uint16' },
  { fn: '00B', reg: '0B', name: 'Feedback Inversion', type: 'uint16' },
  { fn: '010', reg: '10', name: 'SON (Servo Enable)', type: 'int16' },
  { fn: '011', reg: '11', name: 'ARST (Alarm Reset)', type: 'int16' },
  { fn: '012', reg: '12', name: 'EMG (Emergency Stop)', type: 'int16' },
  { fn: '013', reg: '13', name: 'Work Allowed', type: 'int16' },
  { fn: '035', reg: '35', name: 'STO', type: 'uint16', special: true },
  { fn: '037', reg: '37', name: 'Brake', type: 'int16' },
  { fn: '084', reg: '84', name: 'Inertia', type: 'uint16' },
  { fn: '087', reg: '87', name: 'Kv1 (Speed Gain)', type: 'uint16' },
  { fn: '088', reg: '88', name: 'Ti (Integral Time)', type: 'uint16' },
  { fn: '0B8', reg: 'B8', name: 'Accel Time', type: 'uint16', unit: 'ms' },
  { fn: '0B9', reg: 'B9', name: 'Decel Time', type: 'uint16', unit: 'ms' },
  { fn: '0D0', reg: 'D0', name: 'Overvoltage', type: 'uint16' },
  { fn: '0D1', reg: 'D1', name: 'Undervoltage', type: 'uint16' },
  { fn: '0D2', reg: 'D2', name: 'Undervoltage Mode', type: 'uint16' },
  { fn: '0E2', reg: 'E2', name: 'Overload Enable', type: 'uint16' },
  { fn: '0E3', reg: 'E3', name: 'Bus Comm Check', type: 'uint16' },
  { fn: '0F3', reg: 'F3', name: 'CAN Baudrate', type: 'uint16', unit: 'KHz' },
  { fn: '0F4', reg: 'F4', name: 'CAN Node ID', type: 'uint16', rebootRequired: true },
  { fn: '0FD', reg: 'FD', name: 'Phase Voltage Check', type: 'uint16' },
];

const CANOPEN_PARAMS = [
  { index: '6083', name: 'Acceleration', type: 'uint32', sdoCmd: '23' },
  { index: '6084', name: 'Deceleration', type: 'uint32', sdoCmd: '23' },
  { index: '6086', name: 'Motion Profile Type', type: 'uint16', sdoCmd: '2B' },
];

const DRIVE_MOTOR_NODES = [1, 2, 3, 4];
const ENCODER_NODES = [5, 6];
const LIFT_NODE = 7;
const PROTECTED_NODES = [5, 6, 7];

/**
 * Check if a node is protected (no parameter writes allowed).
 * @param {number} nodeId
 * @returns {boolean}
 */
function isProtectedNode(nodeId) {
  return PROTECTED_NODES.includes(nodeId);
}

/**
 * Check if a node is a drive motor.
 * @param {number} nodeId
 * @returns {boolean}
 */
function isDriveMotor(nodeId) {
  return DRIVE_MOTOR_NODES.includes(nodeId);
}

/**
 * Check if a node is an encoder.
 * @param {number} nodeId
 * @returns {boolean}
 */
function isEncoder(nodeId) {
  return ENCODER_NODES.includes(nodeId);
}

module.exports = {
  SYNTRON_PARAMS,
  CANOPEN_PARAMS,
  DRIVE_MOTOR_NODES,
  ENCODER_NODES,
  LIFT_NODE,
  PROTECTED_NODES,
  isProtectedNode,
  isDriveMotor,
  isEncoder,
};
