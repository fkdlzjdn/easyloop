const {
  DEFAULT_SCAN_SUBNET,
  FIXED_DISCOVERY_IP,
  normalizeSubnetBase,
  normalizeRobotId,
  extractRobotIdFromValues,
  scanSubnet
} = require('../server/routes/robots');

describe('robot discovery helpers', () => {
  test('uses and normalizes /24 subnet input', () => {
    expect(normalizeSubnetBase()).toBe(DEFAULT_SCAN_SUBNET);
    expect(normalizeSubnetBase('192.168.20')).toBe('192.168.20');
    expect(normalizeSubnetBase('192.168.20.')).toBe('192.168.20');
    expect(normalizeSubnetBase('192.168.20.0/24')).toBe('192.168.20');
    expect(normalizeSubnetBase('10.0.4.37')).toBe('10.0.4');
    expect(normalizeSubnetBase('192.168.20.0/16')).toBe(null);
    expect(normalizeSubnetBase('192.168.999')).toBe(null);
  });

  test('normalizes RID values from topics and parameters', () => {
    expect(normalizeRobotId('R_9')).toBe('R_009');
    expect(normalizeRobotId('robot/R-044/status')).toBe('R_044');
    expect(normalizeRobotId('51')).toBe(null);
    expect(normalizeRobotId('51', true)).toBe('R_051');
    expect(extractRobotIdFromValues({ topics: ['/R_001/map', '/rosout'] })).toBe('R_001');
  });

  test('always scans 192.168.3.5 and returns discovered RID', async () => {
    const checkedIps = [];
    const checkHostFn = jest.fn(async (ip) => {
      checkedIps.push(ip);
      return ip === '192.168.20.51' || ip === FIXED_DISCOVERY_IP;
    });
    const discoverRobotIdFn = jest.fn(async (ip) => (
      ip === '192.168.20.51' ? 'R_001' : 'R_999'
    ));

    const result = await scanSubnet({
      baseIp: '192.168.20',
      start: 50,
      end: 52,
      checkHostFn,
      discoverRobotIdFn
    });

    expect(checkedIps).toEqual(expect.arrayContaining([
      '192.168.20.50',
      '192.168.20.51',
      '192.168.20.52',
      FIXED_DISCOVERY_IP
    ]));
    expect(result.hosts).toEqual([
      { ip: '192.168.20.51', port: 9090, robotId: 'R_001', fixed: false },
      { ip: FIXED_DISCOVERY_IP, port: 9090, robotId: 'R_999', fixed: true }
    ]);
  });

  test('does not duplicate fixed target when scanning 192.168.3', async () => {
    const checkHostFn = jest.fn(async () => false);
    const result = await scanSubnet({
      baseIp: '192.168.3',
      start: 4,
      end: 6,
      checkHostFn,
      discoverRobotIdFn: jest.fn()
    });

    expect(checkHostFn).toHaveBeenCalledTimes(3);
    expect(result.scanned).toBe(3);
    expect(result.hosts).toEqual([]);
  });
});
