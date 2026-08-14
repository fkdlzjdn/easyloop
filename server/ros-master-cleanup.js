const fs = require('fs');
const { spawnSync } = require('child_process');

function parsePidLines(value) {
  return Array.from(new Set(
    String(value || '')
      .split(/\s+/)
      .map(item => Number(item))
      .filter(pid => Number.isInteger(pid) && pid > 1)
  ));
}

function findListeningPids(port, options = {}) {
  const run = options.spawnSync || spawnSync;
  const targetPort = Number(port);
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) return [];
  if (process.platform === 'win32' && !options.allowWindowsCommands) return [];

  const lsof = run(
    'lsof',
    ['-nP', '-t', `-iTCP:${targetPort}`, '-sTCP:LISTEN'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const lsofPids = parsePidLines(lsof?.stdout);
  if (lsofPids.length > 0 || !lsof?.error) return lsofPids;

  // Minimal Linux fallback for installations without lsof.
  const ss = run(
    'ss',
    ['-H', '-ltnp', `sport = :${targetPort}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const matches = String(ss?.stdout || '').matchAll(/pid=(\d+)/g);
  return Array.from(new Set(Array.from(matches, match => Number(match[1]))))
    .filter(pid => Number.isInteger(pid) && pid > 1);
}

function readProcessCommand(pid, options = {}) {
  const fileSystem = options.fs || fs;
  try {
    const cmdline = fileSystem.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .replace(/\0/g, ' ')
      .trim();
    if (cmdline) return cmdline;
  } catch (_error) {
    // Fall through to comm, which remains readable for short command lines.
  }
  try {
    return fileSystem.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
  } catch (_error) {
    return '';
  }
}

function isRosMasterCommand(command) {
  return /(^|[/\s])(roscore|rosmaster|roslaunch)([.\s/]|$)/i
    .test(String(command || ''));
}

function stopLocalRosMaster(options = {}) {
  const port = Number(options.port) || 11311;
  const logger = options.logger || console;
  if (options.owned !== true) {
    logger.log?.(
      `[TestMode] Local ROS master on port ${port} is not owned by Test Mode; leaving it running.`
    );
    return {
      port,
      terminated: [],
      skipped: [],
      errors: [],
      skippedOwnership: true
    };
  }
  const kill = options.kill || process.kill.bind(process);
  const pids = findListeningPids(port, options);
  const terminated = [];
  const skipped = [];
  const errors = [];

  pids.forEach(pid => {
    if (pid === process.pid) return;
    const command = readProcessCommand(pid, options);
    if (!isRosMasterCommand(command)) {
      skipped.push({ pid, command });
      logger.warn?.(
        `[TestMode] ${port} listener PID ${pid} is not a ROS master; leaving it running.`
      );
      return;
    }
    try {
      kill(pid, 'SIGTERM');
      terminated.push({ pid, command });
      logger.log?.(`[TestMode] Stopped local ROS master PID ${pid} on port ${port}.`);
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        errors.push({ pid, message: error?.message || String(error) });
        logger.warn?.(
          `[TestMode] Failed to stop local ROS master PID ${pid}: `
          + `${error?.message || error}`
        );
      }
    }
  });

  return { port, terminated, skipped, errors };
}

module.exports = {
  findListeningPids,
  isRosMasterCommand,
  readProcessCommand,
  stopLocalRosMaster
};
