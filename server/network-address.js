'use strict';

function usableIpv4Addresses(networkInterfaces = {}) {
  return Object.values(networkInterfaces)
    .flatMap(entries => Array.isArray(entries) ? entries : [])
    .filter(entry => entry && entry.family === 'IPv4' && !entry.internal)
    .map(entry => entry.address)
    .filter(address => typeof address === 'string' && address.length > 0);
}

function isPrivateIpv4(address) {
  return address.startsWith('10.')
    || address.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

function selectPreferredNetworkAddress(networkInterfaces = {}, preferredPrefix = '192.168.30.') {
  const addresses = usableIpv4Addresses(networkInterfaces);
  return addresses.find(address => address.startsWith(preferredPrefix))
    || addresses.find(isPrivateIpv4)
    || addresses[0]
    || 'localhost';
}

module.exports = {
  usableIpv4Addresses,
  selectPreferredNetworkAddress
};
