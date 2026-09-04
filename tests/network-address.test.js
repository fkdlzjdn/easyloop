const {
  usableIpv4Addresses,
  selectPreferredNetworkAddress
} = require('../server/network-address');

describe('LAN address selection', () => {
  const interfaces = {
    loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    vpn: [{ family: 'IPv4', internal: false, address: '100.64.0.10' }],
    ethernet: [{ family: 'IPv4', internal: false, address: '192.168.30.39' }]
  };

  test('lists only usable non-loopback IPv4 addresses', () => {
    expect(usableIpv4Addresses(interfaces)).toEqual(['100.64.0.10', '192.168.30.39']);
  });

  test('prefers the requested 192.168.30 subnet', () => {
    expect(selectPreferredNetworkAddress(interfaces, '192.168.30.')).toBe('192.168.30.39');
  });

  test('falls back to a private address and finally localhost', () => {
    expect(selectPreferredNetworkAddress({
      ethernet: [{ family: 'IPv4', internal: false, address: '10.20.0.5' }]
    }, '192.168.30.')).toBe('10.20.0.5');
    expect(selectPreferredNetworkAddress({}, '192.168.30.')).toBe('localhost');
  });
});
