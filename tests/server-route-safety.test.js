const express = require('express');
const http = require('http');
const EventEmitter = require('events');
const { Readable } = require('stream');
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../server/can/can-commands', () => ({
  CAN_INTERFACE: 'can0',
  executeCanCommand: jest.fn(),
  candump: jest.fn(),
  cansend: jest.fn(),
  sdoRead: jest.fn(async () => ({ abort: false, value: 0 })),
  sdoWrite: jest.fn(async () => ({ abort: false })),
  scanAllNodes: jest.fn(async () => []),
  readParams: jest.fn(async () => []),
  checkDuplicate: jest.fn(async () => ({ duplicate: false })),
  getCanPortStatus: jest.fn(async () => ({ state: 'ERROR-ACTIVE' }))
}));

const canCommands = require('../server/can/can-commands');
const { createCanRouter } = require('../server/routes/can');
const { createSftpRouter } = require('../server/routes/sftp');
const { createSshRouter } = require('../server/routes/ssh');

function requestJson(port, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : undefined
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: JSON.parse(responseBody)
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

describe('server route safety without hardware access', () => {
  let server;
  let port;
  let createSSHConnection;
  let sshConnections;
  let uploadFixture;
  let uploadTempDir;

  beforeEach(done => {
    jest.clearAllMocks();
    createSSHConnection = jest.fn();
    sshConnections = new Map();
    uploadFixture = null;
    uploadTempDir = null;
    const app = express();
    app.use(express.json());
    app.use('/api/can', createCanRouter());
    app.use('/api/ssh', createSshRouter({ sshConnections, createSSHConnection }));
    app.use('/api/sftp', createSftpRouter({
      sshConnections,
      upload: {
        single: () => (req, res, next) => {
          if (uploadFixture) req.file = uploadFixture;
          next();
        }
      }
    }));
    server = app.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      done();
    });
  });

  afterEach(done => {
    if (uploadFixture?.path && fs.existsSync(uploadFixture.path)) {
      fs.unlinkSync(uploadFixture.path);
    }
    if (uploadTempDir && fs.existsSync(uploadTempDir)) {
      fs.rmdirSync(uploadTempDir);
    }
    server.close(done);
  });

  test('rejects incomplete SSH connection requests before opening a socket', async () => {
    const response = await requestJson(port, 'POST', '/api/ssh/connect', {
      host: '192.168.20.51'
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(createSSHConnection).not.toHaveBeenCalled();
  });

  test('returns a safe failure for unknown SSH and SFTP sessions', async () => {
    const execResponse = await requestJson(port, 'POST', '/api/ssh/exec', {
      sessionId: 'missing',
      command: 'hostname'
    });
    const listResponse = await requestJson(port, 'POST', '/api/sftp/list', {
      sessionId: 'missing',
      remotePath: '/home/syscon'
    });

    expect(execResponse.body).toMatchObject({ success: false, message: 'Not connected' });
    expect(listResponse.body).toMatchObject({ success: false, message: 'Not connected' });
  });

  test('reuses an existing SSH session without opening another connection', async () => {
    sshConnections.set('existing', { conn: { end: jest.fn() } });

    const response = await requestJson(port, 'POST', '/api/ssh/connect', {
      host: '192.168.20.51',
      port: 22,
      username: 'syscon',
      password: '',
      sessionId: 'existing'
    });

    expect(response.body).toEqual({ success: true, message: 'Already connected' });
    expect(createSSHConnection).not.toHaveBeenCalled();
  });

  test('returns mocked SSH exec errors and stops a failed sequence', async () => {
    const connection = {
      exec: jest.fn((command, callback) => callback(new Error(`blocked: ${command}`))),
      end: jest.fn()
    };
    sshConnections.set('error-session', { conn: connection });

    const execResponse = await requestJson(port, 'POST', '/api/ssh/exec', {
      sessionId: 'error-session', command: 'hostname'
    });
    const sequenceResponse = await requestJson(port, 'POST', '/api/ssh/exec-sequence', {
      sessionId: 'error-session',
      steps: [{ cmd: 'first', wait: 0 }, { cmd: 'second', wait: 0 }]
    });

    expect(execResponse.body).toEqual({ success: false, message: 'blocked: hostname' });
    expect(sequenceResponse.body).toEqual({
      success: true,
      results: [{ cmd: 'first', error: 'blocked: first' }]
    });
    expect(connection.exec).toHaveBeenCalledTimes(2);
  });

  test('runs SSH exec/sequence and SFTP read paths through a mocked connection', async () => {
    const sftpEnd = jest.fn();
    const connection = {
      exec: jest.fn((command, callback) => {
        const stream = new EventEmitter();
        stream.stderr = new EventEmitter();
        stream.close = jest.fn();
        callback(null, stream);
        process.nextTick(() => {
          stream.emit('data', Buffer.from(`${command}\n`));
          stream.stderr.emit('data', Buffer.from(''));
          stream.emit('close', 0);
        });
      }),
      sftp: jest.fn(callback => callback(null, {
        end: sftpEnd,
        readdir: (remotePath, done) => done(null, [{
          filename: 'task.yaml',
          attrs: {
            size: 12,
            mtime: 123,
            mode: 0o100644,
            isDirectory: () => false
          }
        }]),
        stat: (remotePath, done) => done(null, { size: 12 }),
        createReadStream: () => Readable.from([Buffer.from('task-content')])
      })),
      end: jest.fn()
    };
    createSSHConnection.mockImplementation((config, onReady) => {
      process.nextTick(onReady);
      return connection;
    });

    const connectResponse = await requestJson(port, 'POST', '/api/ssh/connect', {
      host: '192.168.20.51',
      port: 22,
      username: 'syscon',
      password: '',
      sessionId: 'mock-session'
    });
    const execResponse = await requestJson(port, 'POST', '/api/ssh/exec', {
      sessionId: 'mock-session',
      command: 'hostname'
    });
    const sequenceResponse = await requestJson(port, 'POST', '/api/ssh/exec-sequence', {
      sessionId: 'mock-session',
      steps: [
        { cmd: 'hostname', wait: 0 },
        { cmd: 'uptime -p', wait: 0 }
      ]
    });
    const listResponse = await requestJson(port, 'POST', '/api/sftp/list', {
      sessionId: 'mock-session',
      remotePath: '/home/syscon'
    });
    const downloadResponse = await requestJson(port, 'POST', '/api/sftp/download', {
      sessionId: 'mock-session',
      remotePath: '/home/syscon/task.yaml'
    });
    const disconnectResponse = await requestJson(port, 'POST', '/api/ssh/disconnect', {
      sessionId: 'mock-session'
    });

    expect(connectResponse.body.success).toBe(true);
    expect(execResponse.body).toMatchObject({ success: true, exitCode: 0 });
    expect(sequenceResponse.body.results).toHaveLength(2);
    expect(listResponse.body.files).toEqual([
      expect.objectContaining({ name: 'task.yaml', size: 12, isDirectory: false })
    ]);
    expect(downloadResponse.body).toMatchObject({
      success: true,
      filename: 'task.yaml',
      content: Buffer.from('task-content').toString('base64')
    });
    expect(sftpEnd).toHaveBeenCalledTimes(2);
    expect(disconnectResponse.body.success).toBe(true);
    expect(connection.end).toHaveBeenCalledTimes(1);
    expect(sshConnections.has('mock-session')).toBe(false);
  });

  test('uploads through mocked SFTP and always removes the exact temporary file', async () => {
    uploadTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyloop-sftp-test-'));
    const localPath = path.join(uploadTempDir, 'upload.tmp');
    fs.writeFileSync(localPath, 'task-content');
    uploadFixture = {
      path: localPath,
      originalname: 'task.yaml'
    };
    const fastPut = jest.fn((source, destination, callback) => callback(null));
    const sftpEnd = jest.fn();
    sshConnections.set('upload-session', {
      conn: { sftp: callback => callback(null, { fastPut, end: sftpEnd }) }
    });

    const response = await requestJson(port, 'POST', '/api/sftp/upload', {
      sessionId: 'upload-session',
      remotePath: '/home/syscon/ROS_DB/sp_task/rviz'
    });

    expect(response.body).toEqual({ success: true, message: 'File uploaded successfully' });
    expect(fastPut).toHaveBeenCalledWith(
      localPath,
      '/home/syscon/ROS_DB/sp_task/rviz/task.yaml',
      expect.any(Function)
    );
    expect(sftpEnd).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(localPath)).toBe(false);
  });

  test('rejects oversized SFTP downloads before creating a read stream', async () => {
    const createReadStream = jest.fn();
    const sftpEnd = jest.fn();
    sshConnections.set('large-file-session', {
      conn: {
        sftp: callback => callback(null, {
          end: sftpEnd,
          stat: (remotePath, done) => done(null, { size: 101 * 1024 * 1024 }),
          createReadStream
        })
      }
    });

    const response = await requestJson(port, 'POST', '/api/sftp/download', {
      sessionId: 'large-file-session',
      remotePath: '/home/syscon/large.bag'
    });

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('File too large');
    expect(createReadStream).not.toHaveBeenCalled();
    expect(sftpEnd).toHaveBeenCalledTimes(1);
  });

  test('closes an SFTP channel after a list error', async () => {
    const sftpEnd = jest.fn();
    sshConnections.set('list-error-session', {
      conn: {
        sftp: callback => callback(null, {
          end: sftpEnd,
          readdir: (remotePath, done) => done(new Error(`blocked: ${remotePath}`))
        })
      }
    });

    const response = await requestJson(port, 'POST', '/api/sftp/list', {
      sessionId: 'list-error-session',
      remotePath: '/home/syscon/ROS_DB/map'
    });

    expect(response.body).toEqual({
      success: false,
      message: 'blocked: /home/syscon/ROS_DB/map'
    });
    expect(sftpEnd).toHaveBeenCalledTimes(1);
  });

  test('removes an upload temporary file when opening the SFTP channel fails', async () => {
    uploadTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyloop-sftp-test-'));
    const localPath = path.join(uploadTempDir, 'upload.tmp');
    fs.writeFileSync(localPath, 'map-content');
    uploadFixture = {
      path: localPath,
      originalname: 'map.pgm'
    };
    sshConnections.set('channel-error-session', {
      conn: {
        sftp: callback => callback(new Error('Channel open failure: open failed'))
      }
    });

    const response = await requestJson(port, 'POST', '/api/sftp/upload', {
      sessionId: 'channel-error-session',
      remotePath: '/home/syscon/ROS_DB/map'
    });

    expect(response.body).toEqual({
      success: false,
      message: 'Channel open failure: open failed'
    });
    expect(fs.existsSync(localPath)).toBe(false);
  });

  test.each([
    [{ robotIp: '192.168.20.51', nodeId: 1, indexHex: '6041;reboot', subIndex: 0 }, 'indexHex'],
    [{ robotIp: '192.168.20.51', nodeId: 1, indexHex: '0x6041', subIndex: '0;reboot' }, 'subIndex'],
    [{ robotIp: '192.168.20.51', nodeId: 1.5, indexHex: '6041', subIndex: 0 }, 'nodeId']
  ])('rejects unsafe SDO read input %#', async (body, field) => {
    const response = await requestJson(port, 'POST', '/api/can/sdo-read', body);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain(field);
    expect(canCommands.sdoRead).not.toHaveBeenCalled();
  });

  test('normalizes a valid SDO read without touching hardware', async () => {
    const response = await requestJson(port, 'POST', '/api/can/sdo-read', {
      robotIp: '192.168.20.51',
      nodeId: 1,
      indexHex: '0x6041',
      subIndex: 0
    });

    expect(response.body.success).toBe(true);
    expect(canCommands.sdoRead).toHaveBeenCalledWith(
      '192.168.20.51', 1, '41', '60', '00'
    );
  });

  test('rejects shell metacharacters in SDO write data', async () => {
    const response = await requestJson(port, 'POST', '/api/can/sdo-write', {
      robotIp: '192.168.20.51',
      nodeId: 1,
      indexHex: '2035',
      subIndex: 0,
      dataHex: 'AA55;id'
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('dataHex');
    expect(canCommands.sdoWrite).not.toHaveBeenCalled();
  });

  test('normalizes a valid SDO write without touching hardware', async () => {
    const response = await requestJson(port, 'POST', '/api/can/sdo-write', {
      robotIp: '192.168.20.51',
      nodeId: 1,
      indexHex: '0x2035',
      subIndex: 0,
      dataHex: '0x55AA'
    });

    expect(response.body.success).toBe(true);
    expect(canCommands.sdoWrite).toHaveBeenCalledWith(
      '192.168.20.51', 1, '35', '20', '00', '55AA', 2
    );
  });

  test('blocks protected-node writes before CAN access', async () => {
    const response = await requestJson(port, 'POST', '/api/can/sdo-write', {
      robotIp: '192.168.20.51',
      nodeId: 5,
      indexHex: '2035',
      subIndex: 0,
      dataHex: '55AA'
    });

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('보호 노드');
    expect(canCommands.sdoWrite).not.toHaveBeenCalled();
  });

  test.each([
    ['/api/can/params', { robotIp: '192.168.20.51', nodeIds: [1, '2'] }],
    ['/api/can/sto', { robotIp: '192.168.20.51', nodeIds: [0], value: 'on' }]
  ])('rejects invalid node arrays at %s', async (requestPath, body) => {
    const response = await requestJson(port, 'POST', requestPath, body);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('nodeIds');
  });

  test('exercises every CAN route with mocked commands only', async () => {
    canCommands.executeCanCommand.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0
    });
    canCommands.sdoRead.mockResolvedValue({ abort: false, value: 0x0027 });
    canCommands.sdoWrite.mockResolvedValue({ abort: false });
    canCommands.scanAllNodes.mockResolvedValue([{ nodeId: 1 }]);
    canCommands.readParams.mockResolvedValue([]);
    canCommands.checkDuplicate.mockResolvedValue({ duplicate: false });
    canCommands.getCanPortStatus.mockResolvedValue({
      state: 'ERROR-ACTIVE',
      busOff: false
    });

    const cases = [
      ['/api/can/scan', { robotIp: '192.168.20.51' }],
      ['/api/can/params', { robotIp: '192.168.20.51', nodeIds: [1, 2] }],
      ['/api/can/compare', { robotIp1: '192.168.20.51', robotIp2: '192.168.20.52' }],
      ['/api/can/setup', { robotIp: '192.168.20.51', nodeId: 1 }],
      ['/api/can/id-change', { robotIp: '192.168.20.51', oldId: 1, newId: 2 }],
      ['/api/can/drive-test', {
        robotIp: '192.168.20.51', nodeId: 1, dec: 100, duration: 100
      }],
      ['/api/can/fault-reset', { robotIp: '192.168.20.51', nodeId: 1 }],
      ['/api/can/sto', { robotIp: '192.168.20.51', nodeIds: [1], value: 'on' }],
      ['/api/can/busoff-check', { robotIp: '192.168.20.51' }],
      ['/api/can/busoff-recover', { robotIp: '192.168.20.51' }],
      ['/api/can/dup-check', { robotIp: '192.168.20.51', nodeId: 1 }],
      ['/api/can/enable', { robotIp: '192.168.20.51', nodeId: 1 }],
      ['/api/can/can-status', { robotIp: '192.168.20.51' }]
    ];

    for (const [requestPath, body] of cases) {
      const response = await requestJson(port, 'POST', requestPath, body);
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    }
  });
});
