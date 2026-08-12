const {
  parseCandumpLine,
  parseSdoResponse,
  decodeStatusword,
  parseTpdo1Drive,
  parseTpdo2Drive,
  parseTpdo1Encoder
} = require('../server/can/can-parser');
const { lookupError } = require('../server/can/error-codes');

describe('CAN parser without bus access', () => {
  test('parses candump text and rejects unrelated output', () => {
    expect(parseCandumpLine('  can0  181   [8]  01 02 03 04 05 06 07 08')).toEqual({
      canId: '181',
      dataLen: 8,
      data: ['01', '02', '03', '04', '05', '06', '07', '08']
    });
    expect(parseCandumpLine('interface is down')).toBe(null);
  });

  test.each([
    [['4F', '41', '60', '00', '7F', '00', '00', '00'], 0x7F],
    [['4B', '41', '60', '00', '34', '12', '00', '00'], 0x1234],
    [['47', '41', '60', '00', '56', '34', '12', '00'], 0x123456],
    [['43', '41', '60', '00', '78', '56', '34', '12'], 0x12345678]
  ])('decodes expedited SDO upload size %#', (bytes, value) => {
    expect(parseSdoResponse(bytes)).toMatchObject({
      index: '6041',
      sub: '00',
      value
    });
  });

  test('recognizes SDO write confirmation and abort response', () => {
    expect(parseSdoResponse(['60', '35', '20', '00', '00', '00', '00', '00']))
      .toEqual({ command: 'write-ok', index: '2035', sub: '00', value: 0 });
    expect(parseSdoResponse(['80', '35', '20', '00', '00', '00', '02', '06']))
      .toEqual({ abort: true, errorCode: '06020000' });
  });

  test.each([
    [0x0040, 'DISABLED'],
    [0x0021, 'READY'],
    [0x0023, 'SWITCHED_ON'],
    [0x0027, 'ENABLE'],
    [0x0007, 'QUICK_STOP'],
    [0x0008, 'FAULT'],
    [0x0000, 'OFFLINE']
  ])('decodes CiA 402 statusword 0x%s as %s', (value, state) => {
    expect(decodeStatusword(value).state).toBe(state);
  });

  test('decodes signed drive position and velocity', () => {
    expect(parseTpdo1Drive([
      'FF', 'FF', 'FF', 'FF',
      '00', '01', '00', '00'
    ])).toEqual({ position: -1, velocity: 256 });
  });

  test('decodes drive status, known error and signed current', () => {
    const parsed = parseTpdo2Drive(['27', '00', '98', '08', '9C', 'FF', '00', '00']);

    expect(parsed.statusDecoded.state).toBe('ENABLE');
    expect(parsed.errorInfo.name).toBe('저전압');
    expect(parsed.current).toBe(-100);
  });

  test('converts Briter encoder counts into wrapped degrees', () => {
    expect(parseTpdo1Encoder(['00', '20', '00', '00'])).toEqual({
      rawValue: 8192,
      angleDeg: 180
    });
    expect(parseTpdo1Encoder(['00', '40', '00', '00']).angleDeg).toBe(0);
  });

  test('returns a useful fallback for unknown motor errors', () => {
    expect(lookupError(0x1234)).toMatchObject({
      code: 0x1234,
      level: 'UNKNOWN'
    });
  });
});
