jest.mock('net', () => ({
  createServer: jest.fn((_handler) => {
    const EventEmitter = require('events');
    const server = new EventEmitter();
    server.listen = jest.fn((_port, _host, callback) => {
      setImmediate(callback);
      return server;
    });
    server.close = jest.fn();
    return server;
  })
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => Buffer.from('mock-private-key'))
}));

jest.mock('ssh2', () => {
  const EventEmitter = require('events');

  class Client extends EventEmitter {
    connect(config) {
      this.config = config;
      Client.instances.push(this);
      const nextError = Client.nextError;
      Client.nextError = null;
      setImmediate(() => {
        if (nextError) this.emit('error', nextError);
        else this.emit('ready');
      });
    }

    forwardOut(_sourceIp, _sourcePort, _destIp, _destPort, callback) {
      callback(null, new EventEmitter());
    }

    end() {
      this.ended = true;
      setImmediate(() => this.emit('close'));
    }
  }

  Client.instances = [];
  Client.nextError = null;

  return { Client };
});

const net = require('net');
const fs = require('fs');
const { Client } = require('ssh2');
const tunnelManager = require('../server/tunnel-manager');

describe('tunnel manager', () => {
  beforeEach(() => {
    tunnelManager.stopAllTunnels();
    net.createServer.mockClear();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(Buffer.from('mock-private-key'));
    Client.instances.length = 0;
    Client.nextError = null;
  });

  afterEach(() => {
    tunnelManager.stopAllTunnels();
  });

  test('starts a password-authenticated local ROS bridge tunnel with ssh2', async () => {
    const result = await tunnelManager.startTunnel('tunnel-0-R_051', {
      robotIp: '192.168.20.51',
      robotNumber: 51,
      sshPort: 2222,
      sshUser: 'syscon',
      sshPassword: 'secret'
    });

    expect(result).toMatchObject({
      success: true,
      localIp: '127.0.0.51',
      localPort: 9090
    });
    expect(Client.instances[0].config).toMatchObject({
      host: '192.168.20.51',
      port: 2222,
      username: 'syscon',
      password: 'secret'
    });
    expect(net.createServer.mock.results[0].value.listen)
      .toHaveBeenCalledWith(9090, '127.0.0.51', expect.any(Function));
  });

  test('marks a rejected key as requiring a password retry', async () => {
    Client.nextError = Object.assign(
      new Error('All configured authentication methods failed'),
      { level: 'client-authentication' }
    );

    await expect(tunnelManager.startTunnel('key-rejected', {
      robotIp: '192.168.20.63',
      robotNumber: 13,
      sshPort: 2222,
      sshUser: 'syscon'
    })).rejects.toMatchObject({
      needPassword: true,
      message: 'SSH key authentication failed. Password required.'
    });
    expect(Client.instances[0].config).toHaveProperty('privateKey');
    expect(Client.instances[0].config).not.toHaveProperty('password');
  });

  test('requests a password when Windows has no id_rsa or SSH agent', async () => {
    const previousAgent = process.env.SSH_AUTH_SOCK;
    delete process.env.SSH_AUTH_SOCK;
    fs.existsSync.mockReturnValue(false);

    try {
      await expect(tunnelManager.startTunnel('no-key', {
        robotIp: '192.168.20.63',
        robotNumber: 13,
        sshPort: 2222,
        sshUser: 'syscon'
      })).rejects.toMatchObject({
        needPassword: true,
        message: 'No SSH key or agent available. Password required.'
      });
    } finally {
      if (previousAgent === undefined) delete process.env.SSH_AUTH_SOCK;
      else process.env.SSH_AUTH_SOCK = previousAgent;
    }
  });

  test('does not request another password after a password retry is rejected', async () => {
    Client.nextError = Object.assign(
      new Error('All configured authentication methods failed'),
      { level: 'client-authentication' }
    );

    await expect(tunnelManager.startTunnel('password-rejected', {
      robotIp: '192.168.20.63',
      robotNumber: 13,
      sshPort: 2222,
      sshUser: 'syscon',
      sshPassword: 'incorrect'
    })).rejects.toMatchObject({ needPassword: false });
  });

  test('allows multiple robots on the same port using different loopback IPs', async () => {
    await tunnelManager.startTunnel('tunnel-0-R_051', {
      robotIp: '192.168.20.51',
      robotNumber: 51,
      sshPassword: 'secret'
    });
    await tunnelManager.startTunnel('tunnel-1-R_052', {
      robotIp: '192.168.20.52',
      robotNumber: 52,
      sshPassword: 'secret'
    });

    expect(tunnelManager.getAllTunnels().map(t => t.localIp).sort()).toEqual([
      '127.0.0.51',
      '127.0.0.52'
    ]);
  });

  test('replaces only the tunnel using the same local endpoint', async () => {
    await tunnelManager.startTunnel('old-tunnel', {
      robotIp: '192.168.20.51',
      robotNumber: 51,
      sshPassword: 'secret'
    });
    const oldClient = Client.instances[0];

    await tunnelManager.startTunnel('new-tunnel', {
      robotIp: '192.168.20.67',
      robotNumber: 51,
      sshPassword: 'secret'
    });

    expect(oldClient.ended).toBe(true);
    expect(tunnelManager.getTunnelStatus('old-tunnel')).toBe(null);
    expect(tunnelManager.getTunnelStatus('new-tunnel')).toMatchObject({
      localIp: '127.0.0.51',
      robotIp: '192.168.20.67'
    });
  });

  test('rejects invalid robot numbers', async () => {
    await expect(tunnelManager.startTunnel('bad-tunnel', {
      robotIp: '192.168.20.51',
      robotNumber: 300,
      sshPassword: 'secret'
    })).rejects.toThrow('Invalid robot number');
  });
});
