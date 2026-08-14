const {
  isWslEnvironment,
  normalizeMac,
  normalizeWindowsEntries,
  syncWindowsStaticIpv4,
  isWindowsInteropAvailable
} = require('../server/windows-network-sync');

function fakeFs(macByInterface) {
  return {
    readdirSync: jest.fn(() => Object.keys(macByInterface)),
    readFileSync: jest.fn(path => {
      const interfaceName = path.split('/').at(-2);
      return `${macByInterface[interfaceName]}\n`;
    })
  };
}

describe('Windows static IPv4 to WSL synchronization', () => {
  test('detects WSL without hardcoding an IP address', () => {
    expect(isWslEnvironment('linux', '6.6.0-microsoft-standard-WSL2')).toBe(true);
    expect(isWslEnvironment('linux', '6.8.0-generic')).toBe(false);
    expect(isWslEnvironment('win32', 'Windows')).toBe(false);
    expect(normalizeMac('34-FD-70-98-A3-AA')).toBe('34fd7098a3aa');
  });

  test('normalizes either one or multiple Windows manual IPv4 records', () => {
    expect(normalizeWindowsEntries(JSON.stringify({
      interfaceAlias: 'Wi-Fi',
      macAddress: '34-FD-70-98-A3-AA',
      ipAddress: '10.20.30.44',
      prefixLength: 24
    }))).toEqual([{
      interfaceAlias: 'Wi-Fi',
      macAddress: '34fd7098a3aa',
      ipAddress: '10.20.30.44',
      prefixLength: 24
    }]);
    expect(normalizeWindowsEntries('')).toEqual([]);
  });

  test('does nothing when Windows and WSL already have the same static IP', async () => {
    const runProcessFn = jest.fn(async file => {
      if (file === 'powershell.exe') {
        return JSON.stringify([{
          interfaceAlias: 'Wi-Fi',
          macAddress: '34-FD-70-98-A3-AA',
          ipAddress: '192.168.77.39',
          prefixLength: 24
        }]);
      }
      throw new Error(`unexpected command: ${file}`);
    });

    const result = await syncWindowsStaticIpv4({
      platform: 'linux',
      release: 'microsoft-standard-WSL2',
      fsImpl: fakeFs({ eth0: '34:fd:70:98:a3:aa' }),
      networkInterfacesFn: () => ({
        eth0: [{
          family: 'IPv4',
          address: '192.168.77.39',
          cidr: '192.168.77.39/24'
        }]
      }),
      runProcessFn
    });

    expect(result.changed).toEqual([]);
    expect(result.alreadySynced).toHaveLength(1);
    expect(runProcessFn).toHaveBeenCalledTimes(1);
  });

  test('repairs WSL with the arbitrary Preferred static IP reported by Windows', async () => {
    const commands = [];
    const runProcessFn = jest.fn(async (file, args) => {
      commands.push([file, args]);
      if (file === 'powershell.exe') {
        return JSON.stringify([{
          interfaceAlias: '현장 Wi-Fi',
          macAddress: 'AA-BB-CC-DD-EE-FF',
          ipAddress: '10.42.7.88',
          prefixLength: 21
        }]);
      }
      return '';
    });
    const logger = { info: jest.fn(), warn: jest.fn() };

    const result = await syncWindowsStaticIpv4({
      platform: 'linux',
      release: '6.6.0-microsoft-standard-WSL2',
      fsImpl: fakeFs({ eth7: 'aa:bb:cc:dd:ee:ff' }),
      networkInterfacesFn: () => ({
        eth7: [{ family: 'IPv4', address: '169.254.10.20', cidr: '169.254.10.20/16' }]
      }),
      runProcessFn,
      logger
    });

    expect(result.changed).toEqual([
      expect.objectContaining({
        ipAddress: '10.42.7.88',
        prefixLength: 21,
        linuxInterface: 'eth7'
      })
    ]);
    expect(commands).toContainEqual([
      'sudo',
      ['-n', 'ip', 'address', 'replace', '10.42.7.88/21', 'dev', 'eth7']
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('10.42.7.88/21 -> eth7')
    );
  });

  test('skips synchronization outside WSL', async () => {
    const runProcessFn = jest.fn();
    const result = await syncWindowsStaticIpv4({
      platform: 'linux',
      release: 'generic',
      runProcessFn
    });

    expect(result.supported).toBe(false);
    expect(runProcessFn).not.toHaveBeenCalled();
  });

  test('skips PowerShell invocation when WSL Windows interop is unavailable', async () => {
    const runProcessFn = jest.fn();
    const result = await syncWindowsStaticIpv4({
      platform: 'linux',
      release: 'microsoft-standard-WSL2',
      runProcessFn,
      windowsInteropAvailableFn: () => false
    });

    expect(result).toEqual(expect.objectContaining({
      supported: true,
      interopUnavailable: true
    }));
    expect(runProcessFn).not.toHaveBeenCalled();
  });

  test('detects the WSL interop binfmt entry', () => {
    expect(isWindowsInteropAvailable({ existsSync: () => true })).toBe(true);
    expect(isWindowsInteropAvailable({ existsSync: () => false })).toBe(false);
  });
});
