function validateRosProxyTarget(target, options = {}) {
  const testModePort = Number(options.testModePort) || 19090;

  if (!target || !/^[\w.-]+:\d+$/.test(target)) {
    return { ok: false, statusCode: 400, message: 'Invalid target' };
  }

  const [host, rawPort] = target.split(':');
  const port = Number(rawPort);
  const isLocal = /^127\./.test(host) || host === 'localhost';
  const isPrivate = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host);

  if (!isLocal && !isPrivate) {
    return { ok: false, statusCode: 403, message: 'Target is not private' };
  }

  const isRobotRosbridgePort = port >= 9000 && port <= 9100;
  const isTestModeRosbridgePort = isLocal && port === testModePort;
  if (!isRobotRosbridgePort && !isTestModeRosbridgePort) {
    return { ok: false, statusCode: 403, message: 'Target port is not allowed' };
  }

  return { ok: true, target, host, port, isLocal };
}

module.exports = { validateRosProxyTarget };
