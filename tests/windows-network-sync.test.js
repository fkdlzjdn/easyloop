const {
  isWslEnvironment,
  normalizeMac,
  normalizeWindowsEntries,
  parseWindowsWlanInterfaces,
  syncWindowsStaticIpv4,
  isWindowsInteropAvailable
} = require('../server/windows-network-sync');

const SYSCON_WLAN_OUTPUT = `
    이름                   : Wi-Fi
    물리적 주소            : C6:B2:96:A9:CC:F0
    상태                   : 연결됨
    SSID                   : SYSCON_AP
    AP BSSID               : 06:90:E8:CE:5F:D3

    이름                   : Wi-Fi 2
    물리적 주소            : 44:01:BB:91:D3:D4
    상태                   : 연결됨
    SSID                   : iPhone
    AP BSSID               : 02:94:29:8A:13:69
`;

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

  test('parses the connected SSID and adapter MAC from localized netsh output', () => {
    expect(parseWindowsWlanInterfaces(SYSCON_WLAN_OUTPUT)).toEqual([
      { ssid: 'SYSCON_AP', macAddress: 'c6b296a9ccf0' },
      { ssid: 'iPhone', macAddress: '4401bb91d3d4' }
    ]);
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
      if (file === 'netsh.exe') return '';
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
    expect(runProcessFn).toHaveBeenCalledTimes(2);
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

  test('applies the SYSCON_AP default and removes APIPA when Windows has no manual IP', async () => {
    const commands = [];
    const runProcessFn = jest.fn(async (file, args) => {
      commands.push([file, args]);
      if (file === 'powershell.exe') return '';
      if (file === 'netsh.exe') return SYSCON_WLAN_OUTPUT;
      return '';
    });

    const result = await syncWindowsStaticIpv4({
      platform: 'linux',
      release: '6.6.0-microsoft-standard-WSL2',
      fsImpl: fakeFs({ eth0: 'c6:b2:96:a9:cc:f0' }),
      networkInterfacesFn: () => ({
        eth0: [{
          family: 'IPv4',
          address: '169.254.205.77',
          cidr: '169.254.205.77/16'
        }]
      }),
      runProcessFn
    });

    expect(result.changed).toEqual([
      expect.objectContaining({
        interfaceAlias: 'SYSCON_AP',
        ipAddress: '192.168.30.39',
        prefixLength: 24,
        linuxInterface: 'eth0',
        source: 'ssid-default'
      })
    ]);
    expect(commands).toContainEqual([
      'sudo',
      ['-n', 'ip', 'address', 'replace', '192.168.30.39/24', 'dev', 'eth0']
    ]);
    expect(commands).toContainEqual([
      'sudo',
      ['-n', 'ip', 'address', 'delete', '169.254.205.77/16', 'dev', 'eth0']
    ]);
  });

  test('keeps a Windows manual IP as the override for SYSCON_AP', async () => {
    const commands = [];
    const runProcessFn = jest.fn(async (file, args) => {
      commands.push([file, args]);
      if (file === 'powershell.exe') {
        return JSON.stringify([{
          interfaceAlias: 'Wi-Fi',
          macAddress: 'C6-B2-96-A9-CC-F0',
          ipAddress: '192.168.77.39',
          prefixLength: 24
        }]);
      }
      if (file === 'netsh.exe') return SYSCON_WLAN_OUTPUT;
      return '';
    });

    const result = await syncWindowsStaticIpv4({
      platform: 'linux',
      release: '6.6.0-microsoft-standard-WSL2',
      fsImpl: fakeFs({ eth0: 'c6:b2:96:a9:cc:f0' }),
      networkInterfacesFn: () => ({ eth0: [] }),
      runProcessFn
    });

    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].ipAddress).toBe('192.168.77.39');
    expect(commands).not.toContainEqual([
      'sudo',
      ['-n', 'ip', 'address', 'replace', '192.168.30.39/24', 'dev', 'eth0']
    ]);
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
