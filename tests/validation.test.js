const {
  validateStringField,
  validateNumberField,
  validateSteps
} = require('../server/validation');

describe('validation helpers', () => {
  test('validateStringField enforces required and length', () => {
    expect(validateStringField('name', '', { required: true })).toBe('name must not be empty');
    expect(validateStringField('name', 'ok', { required: true })).toBe(null);
    expect(validateStringField('name', 'x'.repeat(5), { maxLength: 4 })).toBe('name is too long');
  });

  test('validateNumberField checks range', () => {
    expect(validateNumberField('count', '1', { min: 0, max: 10 })).toBe('count must be a number');
    expect(validateNumberField('count', 5, { min: 0, max: 10 })).toBe(null);
    expect(validateNumberField('count', 11, { min: 0, max: 10 })).toBe('count out of range');
  });

  test('validateSteps enforces schema', () => {
    expect(validateSteps([])).toBe('steps must be a non-empty array');
    expect(validateSteps([{ cmd: 'ls', wait: 0 }])).toBe(null);
    expect(validateSteps([{ cmd: '', wait: 0 }])).toBe('steps[0].cmd must not be empty');
  });
});
