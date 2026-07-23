const VALIDATION_LIMITS = {
  robotId: 64,
  robotName: 128,
  robotIp: 64,
  host: 255,
  username: 64,
  sessionId: 128,
  command: 8192,
  remotePath: 1024,
  stepCmd: 8192,
  stepsMax: 200,
  waitMaxMs: 600000
};

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a string field with basic length and empty checks.
 * @param {string} field
 * @param {unknown} value
 * @param {{required?: boolean, maxLength?: number, allowEmpty?: boolean}} options
 * @returns {string|null}
 */
function validateStringField(field, value, options = {}) {
  const {
    required = false,
    maxLength = 256,
    allowEmpty = false
  } = options;

  if (value === undefined || value === null) {
    return required ? `${field} is required` : null;
  }

  if (typeof value !== 'string') {
    return `${field} must be a string`;
  }

  if (!allowEmpty && value.trim().length === 0) {
    return `${field} must not be empty`;
  }

  if (value.length > maxLength) {
    return `${field} is too long`;
  }

  return null;
}

/**
 * Validate a numeric field with range checks.
 * @param {string} field
 * @param {unknown} value
 * @param {{min?: number, max?: number}} options
 * @returns {string|null}
 */
function validateNumberField(field, value, options = {}) {
  const {
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER
  } = options;

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${field} must be a number`;
  }

  if (value < min || value > max) {
    return `${field} out of range`;
  }

  return null;
}

/**
 * Validate a sequential command list.
 * @param {unknown} steps
 * @returns {string|null}
 */
function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return 'steps must be a non-empty array';
  }

  if (steps.length > VALIDATION_LIMITS.stepsMax) {
    return 'steps too long';
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!isPlainObject(step)) {
      return `steps[${i}] must be an object`;
    }

    const cmdError = validateStringField(`steps[${i}].cmd`, step.cmd, {
      required: true,
      maxLength: VALIDATION_LIMITS.stepCmd
    });
    if (cmdError) return cmdError;

    const waitError = validateNumberField(`steps[${i}].wait`, step.wait, {
      min: 0,
      max: VALIDATION_LIMITS.waitMaxMs
    });
    if (waitError) return waitError;
  }

  return null;
}

module.exports = {
  VALIDATION_LIMITS,
  badRequest,
  isPlainObject,
  validateStringField,
  validateNumberField,
  validateSteps
};
