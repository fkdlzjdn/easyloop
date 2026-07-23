function normalizePort(value, fallback = 3000) {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

function listenOnAvailablePort(server, options = {}) {
  const host = options.host || '0.0.0.0';
  const startPort = normalizePort(options.startPort);
  const onPortInUse = typeof options.onPortInUse === 'function'
    ? options.onPortInUse
    : () => {};

  return new Promise((resolve, reject) => {
    let port = startPort;

    const tryListen = () => {
      const handleListening = () => {
        server.removeListener('error', handleError);
        resolve(port);
      };

      const handleError = (error) => {
        server.removeListener('listening', handleListening);

        if (error.code !== 'EADDRINUSE') {
          reject(error);
          return;
        }

        const occupiedPort = port;
        port += 1;
        if (port > 65535) {
          const noPortError = new Error(`No available port after ${occupiedPort}`);
          noPortError.code = 'EADDRINUSE';
          reject(noPortError);
          return;
        }

        onPortInUse(occupiedPort, port);
        setImmediate(tryListen);
      };

      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen(port, host);
    };

    tryListen();
  });
}

module.exports = { listenOnAvailablePort, normalizePort };
