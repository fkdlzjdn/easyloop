const fs = require('fs');

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Load selected keys from a local .env file without overwriting values that
 * were explicitly supplied by the process environment.
 *
 * @param {string} filePath
 * @param {NodeJS.ProcessEnv} target
 * @param {string[]} allowedKeys
 * @returns {string[]} loaded keys
 */
function loadEnvironmentFile(filePath, target = process.env, allowedKeys = []) {
  if (!filePath || !fs.existsSync(filePath)) return [];

  const allowed = new Set(allowedKeys);
  const loaded = [];
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');

  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) return;

    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    if (allowed.size > 0 && !allowed.has(key)) return;
    if (Object.prototype.hasOwnProperty.call(target, key)) return;

    target[key] = parseEnvValue(trimmed.slice(separator + 1));
    loaded.push(key);
  });

  return loaded;
}

module.exports = { loadEnvironmentFile };
