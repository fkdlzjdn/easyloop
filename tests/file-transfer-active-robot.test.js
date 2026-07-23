const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadFileTransfer() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'file-transfer.js'),
    'utf8'
  );
  let activeIp = '192.168.20.51';
  let sequence = 0;
  const context = {
    App: {
      getConnectionInfo: () => ({
        ip: activeIp,
        sshPort: 22,
        sshUser: 'syscon',
        sshPassword: ''
      }),
      generateSessionId: () => `session-${++sequence}`,
      showPasswordModal: jest.fn()
    },
    fetchWithTimeout: jest.fn(async () => ({
      json: async () => ({ success: true })
    })),
    document: {
      addEventListener: jest.fn()
    },
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__FileTransfer = FileTransfer;`, context);
  return {
    manager: context.__FileTransfer,
    context,
    setActiveIp: ip => { activeIp = ip; }
  };
}

describe('SFTP active robot session', () => {
  test('reconnects instead of reusing the previous robot session', async () => {
    const { manager, context, setActiveIp } = loadFileTransfer();

    await expect(manager.ensureConnection()).resolves.toEqual({ success: true });
    expect(manager.sessionHost).toBe('192.168.20.51');
    expect(manager.sessionId).toBe('session-1');

    setActiveIp('192.168.20.52');
    await expect(manager.ensureConnection()).resolves.toEqual({ success: true });

    expect(manager.sessionHost).toBe('192.168.20.52');
    expect(manager.sessionId).toBe('session-2');
    expect(context.fetchWithTimeout).toHaveBeenCalledTimes(3);
    expect(context.fetchWithTimeout.mock.calls[1][0]).toBe('/api/ssh/disconnect');
  });
});
