const express = require('express');
const http = require('http');
const { createRobotsRouter } = require('../server/routes/robots');

function requestJson(port, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : undefined
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: JSON.parse(responseBody)
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

describe('robot configuration routes without network access', () => {
  let server;
  let port;
  let config;
  let saveRobotsConfig;
  let syncWindowsNetwork;
  let scanSubnetFn;

  beforeEach(done => {
    config = {
      robots: [{ id: 'R_001', name: 'base', ip: '192.168.20.51' }]
    };
    saveRobotsConfig = jest.fn(nextConfig => { config = nextConfig; });
    syncWindowsNetwork = jest.fn();
    scanSubnetFn = jest.fn(async options => ({ discoveryMode: options.discoveryMode, hosts: [{ robotId: 'R_006', rosMode: 'ros2' }] }));

    const app = express();
    app.use(express.json());
    app.use('/api/robots', createRobotsRouter({
      loadRobotsConfig: () => config,
      saveRobotsConfig,
      syncWindowsNetwork,
      scanSubnetFn
    }));
    server = app.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      done();
    });
  });

  afterEach(done => {
    server.close(done);
  });

  test('lists, adds, updates, and deletes robots in the supplied config store', async () => {
    const initial = await requestJson(port, 'GET', '/api/robots');
    const added = await requestJson(port, 'POST', '/api/robots', {
      id: 'R_002', name: 'second', ip: '192.168.20.52', rosBridgePort: 9090
    });
    await requestJson(port, 'POST', '/api/robots', {
      id: 'R_002', name: 'updated', ip: '192.168.20.57', rosBridgePort: 19090
    });
    const afterUpdate = await requestJson(port, 'GET', '/api/robots');
    const removed = await requestJson(port, 'DELETE', '/api/robots/R_001');
    const afterDelete = await requestJson(port, 'GET', '/api/robots');

    expect(initial.body).toEqual([{ id: 'R_001', name: 'base', ip: '192.168.20.51' }]);
    expect(added.body).toEqual({ success: true });
    expect(afterUpdate.body).toEqual([
      { id: 'R_001', name: 'base', ip: '192.168.20.51' },
      { id: 'R_002', name: 'updated', ip: '192.168.20.57', rosBridgePort: 19090 }
    ]);
    expect(removed.body).toEqual({ success: true });
    expect(afterDelete.body.map(robot => robot.id)).toEqual(['R_002']);
    expect(saveRobotsConfig).toHaveBeenCalledTimes(3);
  });

  test('normalizes configured lowercase robot IDs and deletes them canonically', async () => {
    const added = await requestJson(port, 'POST', '/api/robots', {
      id: 'r_105', name: 'BMA', ip: '172.25.20.105', rosBridgePort: 9090
    });
    const afterAdd = await requestJson(port, 'GET', '/api/robots');
    const removed = await requestJson(port, 'DELETE', '/api/robots/r_105');
    const afterDelete = await requestJson(port, 'GET', '/api/robots');

    expect(added.status).toBe(200);
    expect(afterAdd.body).toContainEqual(expect.objectContaining({ id: 'R_105' }));
    expect(removed.status).toBe(200);
    expect(afterDelete.body.map(robot => robot.id)).toEqual(['R_001']);
  });

  test('rejects malformed robot and subnet requests before any scan', async () => {
    const malformedRobot = await requestJson(port, 'POST', '/api/robots', []);
    const missingId = await requestJson(port, 'POST', '/api/robots', {
      name: 'missing-id', ip: '192.168.20.99'
    });
    const badSubnet = await requestJson(
      port, 'GET', '/api/robots/scan-subnet?base=192.168.999&start=1&end=1'
    );
    const reversedRange = await requestJson(
      port, 'GET', '/api/robots/scan-subnet?base=192.168.20&start=20&end=10'
    );

    expect(malformedRobot.status).toBe(400);
    expect(missingId.status).toBe(400);
    expect(badSubnet.status).toBe(400);
    expect(reversedRange.status).toBe(400);
    expect(saveRobotsConfig).not.toHaveBeenCalled();
    expect(syncWindowsNetwork).not.toHaveBeenCalled();
  });

  test('serves bundled robot templates without mutating config', async () => {
    const response = await requestJson(port, 'GET', '/api/robots/templates');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('templates');
    expect(saveRobotsConfig).not.toHaveBeenCalled();
  });
  test('GET and POST default to automatic ROS1/ROS2 scanning and preserve per-IP SSH settings', async () => {
    const get = await requestJson(port, 'GET', '/api/robots/scan-subnet?start=51&end=56');
    expect(get.status).toBe(200); expect(get.body.discoveryMode).toBe('auto');
    const post = await requestJson(port, 'POST', '/api/robots/scan-subnet', {
      base: '192.168.20', start: 51, end: 75, robots: [{ ip: '192.168.20.75', robotId: 'R_025', sshPort: 2222, sshUser: 'operator', sshPassword: 'private-per-host' }]
    });
    expect(post.status).toBe(200); expect(scanSubnetFn.mock.calls[1][0].knownRobots).toContainEqual(expect.objectContaining({ ip: '192.168.20.75', sshPort: 2222, sshPassword: 'private-per-host' }));
    expect(JSON.stringify(post.body)).not.toContain('private-per-host');
    expect(saveRobotsConfig).not.toHaveBeenCalled();
  });
  test('rejects malformed ranges, modes and unrelated credentials before scanning', async () => {
    for (const body of [
      { mode: 'unsupported' }, { port: 0 }, { start: 0 }, { end: 255 }, { start: 1.5 },
      { robots: [{ ip: '10.1.1.2', sshPassword: 'must-not-use' }] },
      { robots: [{ ip: '192.168.20.56', sshPort: 0 }] }
    ]) expect((await requestJson(port, 'POST', '/api/robots/scan-subnet', body)).status).toBe(400);
    expect(scanSubnetFn).not.toHaveBeenCalled(); expect(syncWindowsNetwork).not.toHaveBeenCalled();
  });
  test('does not run duplicate concurrent subnet scans', async () => {
    let release;
    scanSubnetFn.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = requestJson(port, 'POST', '/api/robots/scan-subnet', {});
    while (!release) await new Promise(resolve => setImmediate(resolve));
    expect((await requestJson(port, 'POST', '/api/robots/scan-subnet', {})).status).toBe(409);
    release({ hosts: [] }); expect((await first).status).toBe(200); expect(scanSubnetFn).toHaveBeenCalledTimes(1);
  });

});
