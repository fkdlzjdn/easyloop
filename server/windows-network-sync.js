const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const DEFAULT_INTERVAL_MS = 30000;
const POWERSHELL_STATIC_IPV4_QUERY = [
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;',
  '@(Get-NetAdapter | Where-Object Status -eq "Up" | ForEach-Object {',
  '  $adapter = $_;',
  '  Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4',
  '    -PolicyStore ActiveStore -ErrorAction SilentlyContinue |',
  '    Where-Object {',
  '      $_.PrefixOrigin -eq "Manual" -and',
  '      $_.AddressState -eq "Preferred" -and',
  '      $_.IPAddress -notlike "169.254.*"',
  '    } | ForEach-Object {',
  '      [PSCustomObject]@{',
  '        interfaceAlias = $adapter.Name;',
  '        macAddress = $adapter.MacAddress;',
  '        ipAddress = $_.IPAddress;',
  '        prefixLength = $_.PrefixLength',
  '      }',
  '    }',
  '}) | ConvertTo-Json -Compress'
].join(' ');

function isWslEnvironment(platform = process.platform, release = os.release()) {
  return platform === 'linux' && /microsoft|wsl/i.test(String(release || ''));
}

/**
 * WSL's Windows executable interop is provided by a binfmt_misc handler.
 * A distro can still report a Microsoft kernel after interop has been
 * disabled or failed to initialize, so checking only os.release() is not
 * sufficient before invoking powershell.exe.
 */
function isWindowsInteropAvailable(fsImpl = fs) {
  try {
    return typeof fsImpl.existsSync !== 'function'
      || fsImpl.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop');
  } catch (_error) {
    return false;
  }
}

function normalizeMac(value) {
  return String(value || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

function normalizeWindowsEntries(rawOutput) {
  const text = String(rawOutput || '').trim().replace(/^\uFEFF/, '');
  if (!text) return [];
  const parsed = JSON.parse(text);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.filter(entry => {
    const prefixLength = Number(entry?.prefixLength);
    return normalizeMac(entry?.macAddress).length === 12
      && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(entry?.ipAddress || ''))
      && Number.isInteger(prefixLength)
      && prefixLength >= 1
      && prefixLength <= 32;
  }).map(entry => ({
    interfaceAlias: String(entry.interfaceAlias || ''),
    macAddress: normalizeMac(entry.macAddress),
    ipAddress: String(entry.ipAddress),
    prefixLength: Number(entry.prefixLength)
  }));
}

function readLinuxInterfaces(fsImpl = fs, sysClassNet = '/sys/class/net') {
  const interfaces = [];
  let names = [];
  try {
    names = fsImpl.readdirSync(sysClassNet);
  } catch (_error) {
    return interfaces;
  }

  names.forEach(name => {
    if (name === 'lo') return;
    try {
      const address = fsImpl
        .readFileSync(`${sysClassNet}/${name}/address`, 'utf8')
        .trim();
      const macAddress = normalizeMac(address);
      if (macAddress.length === 12) interfaces.push({ name, macAddress });
    } catch (_error) {
      // Interfaces may disappear during a Windows network reconnect.
    }
  });
  return interfaces;
}

function runProcess(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      timeout: options.timeout || 8000,
      maxBuffer: options.maxBuffer || 1024 * 1024,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message || '').trim();
        reject(new Error(detail || `${file} failed`));
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

async function queryWindowsStaticIpv4(runProcessFn = runProcess) {
  const output = await runProcessFn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    POWERSHELL_STATIC_IPV4_QUERY
  ]);
  return normalizeWindowsEntries(output);
}

async function syncWindowsStaticIpv4(options = {}) {
  const {
    platform = process.platform,
    release = os.release(),
    fsImpl = fs,
    networkInterfacesFn = os.networkInterfaces,
    runProcessFn = runProcess,
    windowsInteropAvailableFn = () => isWindowsInteropAvailable(fsImpl),
    logger = console
  } = options;

  if (!isWslEnvironment(platform, release)) {
    return { supported: false, changed: [], alreadySynced: [], unmatched: [] };
  }

  if (!windowsInteropAvailableFn()) {
    return {
      supported: true,
      interopUnavailable: true,
      changed: [],
      alreadySynced: [],
      unmatched: []
    };
  }

  const windowsEntries = await queryWindowsStaticIpv4(runProcessFn);
  const linuxInterfaces = readLinuxInterfaces(fsImpl, options.sysClassNet);
  const linuxAddresses = networkInterfacesFn();
  const changed = [];
  const alreadySynced = [];
  const unmatched = [];

  for (const entry of windowsEntries) {
    const target = linuxInterfaces.find(item => item.macAddress === entry.macAddress);
    if (!target) {
      unmatched.push(entry);
      continue;
    }

    const cidr = `${entry.ipAddress}/${entry.prefixLength}`;
    const current = Array.from(linuxAddresses[target.name] || []).some(address =>
      address.family === 'IPv4'
      && address.address === entry.ipAddress
      && Number(address.cidr?.split('/')[1]) === entry.prefixLength
    );
    if (current) {
      alreadySynced.push({ ...entry, linuxInterface: target.name });
      continue;
    }

    await runProcessFn('sudo', ['-n', 'ip', 'link', 'set', 'dev', target.name, 'up']);
    await runProcessFn('sudo', [
      '-n',
      'ip',
      'address',
      'replace',
      cidr,
      'dev',
      target.name
    ]);
    const result = { ...entry, linuxInterface: target.name };
    changed.push(result);
    logger.info?.(
      `[WindowsNetworkSync] ${entry.interfaceAlias} ${cidr} -> ${target.name}`
    );
  }

  return { supported: true, changed, alreadySynced, unmatched };
}

function startWindowsNetworkSync(options = {}) {
  const intervalMs = Number(options.intervalMs) || DEFAULT_INTERVAL_MS;
  let running = false;
  let timer = null;

  const syncNow = async () => {
    if (running) return { skipped: true, reason: 'sync-in-progress' };
    running = true;
    try {
      return await syncWindowsStaticIpv4(options);
    } catch (error) {
      options.logger?.warn?.(`[WindowsNetworkSync] ${error.message}`);
      return { supported: true, error: error.message };
    } finally {
      running = false;
    }
  };

  if (isWslEnvironment(options.platform, options.release)) {
    syncNow();
    timer = setInterval(syncNow, intervalMs);
    timer.unref?.();
  }

  return {
    syncNow,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  POWERSHELL_STATIC_IPV4_QUERY,
  isWslEnvironment,
  normalizeMac,
  isWindowsInteropAvailable,
  normalizeWindowsEntries,
  readLinuxInterfaces,
  queryWindowsStaticIpv4,
  syncWindowsStaticIpv4,
  startWindowsNetworkSync
};
