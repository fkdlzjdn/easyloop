const { validateRosProxyTarget } = require('../server/ws-proxy-target');

describe('ROS WebSocket proxy target validation', () => {
  test.each([
    [null, 400],
    ['', 400],
    ['192.168.20.51', 400],
    ['192.168.20.51:not-a-port', 400],
    ['8.8.8.8:9090', 403],
    ['example.com:9090', 403],
    ['192.168.20.51:22', 403],
    ['127.0.0.1:19091', 403]
  ])('rejects unsafe target %p', (target, statusCode) => {
    expect(validateRosProxyTarget(target)).toMatchObject({
      ok: false,
      statusCode
    });
  });

  test.each([
    ['192.168.20.51:9090', '192.168.20.51', 9090],
    ['10.10.0.5:9000', '10.10.0.5', 9000],
    ['172.16.0.10:9100', '172.16.0.10', 9100],
    ['127.0.0.51:9090', '127.0.0.51', 9090],
    ['localhost:19090', 'localhost', 19090]
  ])('accepts scoped rosbridge target %s', (target, host, port) => {
    expect(validateRosProxyTarget(target)).toMatchObject({
      ok: true,
      target,
      host,
      port
    });
  });
});
