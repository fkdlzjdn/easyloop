const http = require('http');
const { listenOnAvailablePort, normalizePort } = require('../server/available-port');

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

describe('available server port', () => {
  test('normalizes valid and invalid configured ports', () => {
    expect(normalizePort('3100')).toBe(3100);
    expect(normalizePort('invalid', 3000)).toBe(3000);
    expect(normalizePort('70000', 3000)).toBe(3000);
  });

  test('uses a later port when the requested port is occupied', async () => {
    const blocker = http.createServer();
    await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
    const occupiedPort = blocker.address().port;
    const candidate = http.createServer();
    const retries = [];

    try {
      const selectedPort = await listenOnAvailablePort(candidate, {
        startPort: occupiedPort,
        host: '127.0.0.1',
        onPortInUse: (occupied, next) => retries.push({ occupied, next })
      });

      expect(selectedPort).toBeGreaterThan(occupiedPort);
      expect(retries[0]).toEqual({ occupied: occupiedPort, next: occupiedPort + 1 });
      expect(candidate.address().port).toBe(selectedPort);
    } finally {
      if (candidate.listening) await closeServer(candidate);
      await closeServer(blocker);
    }
  });
});
