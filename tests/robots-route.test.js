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

  beforeEach(done => {
    config = {
      robots: [{ id: 'R_001', name: 'base', ip: '192.168.20.51' }]
    };
    saveRobotsConfig = jest.fn(nextConfig => { config = nextConfig; });
    syncWindowsNetwork = jest.fn();

    const app = express();
    app.use(express.json());
    app.use('/api/robots', createRobotsRouter({
      loadRobotsConfig: () => config,
      saveRobotsConfig,
      syncWindowsNetwork
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
});
