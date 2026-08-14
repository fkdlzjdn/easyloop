const { spawn } = require('child_process');

function listRosServices(environment, options = {}) {
  const spawnFn = options.spawnFn || spawn;
  const timeoutMs = Number(options.commandTimeoutMs) || 2000;

  return new Promise(resolve => {
    let settled = false;
    let stdout = '';
    const child = spawnFn('rosservice', ['list'], {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const finish = services => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(services);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (_error) {}
      finish([]);
    }, timeoutMs);

    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.resume?.();
    child.once('error', () => finish([]));
    child.once('close', () => finish(
      stdout.split('\n').map(line => line.trim()).filter(Boolean)
    ));
  });
}

async function waitForRosService(serviceName, timeoutMs, environment, options = {}) {
  const listServicesFn = options.listServicesFn
    || (env => listRosServices(env, options));
  const delayFn = options.delayFn
    || (delay => new Promise(resolve => setTimeout(resolve, delay)));
  const pollIntervalMs = Number(options.pollIntervalMs) || 250;
  const deadline = Date.now() + timeoutMs;

  do {
    const services = await listServicesFn(environment);
    if (services.includes(serviceName)) return true;
    if (Date.now() >= deadline) return false;
    await delayFn(pollIntervalMs);
  } while (Date.now() < deadline);

  return false;
}

module.exports = { listRosServices, waitForRosService };
