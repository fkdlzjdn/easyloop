const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvironmentFile } = require('../server/env');

describe('local environment loader', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyloop-env-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('loads only approved settings from .env', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, [
      '# EasyLoop',
      'PORT=3100',
      'SHARED_PASSWORD="long password = supported"',
      'IGNORED_SECRET=do-not-load'
    ].join('\n'));
    const target = {};

    expect(loadEnvironmentFile(envPath, target, ['PORT', 'SHARED_PASSWORD']))
      .toEqual(['PORT', 'SHARED_PASSWORD']);
    expect(target).toEqual({
      PORT: '3100',
      SHARED_PASSWORD: 'long password = supported'
    });
  });

  test('explicit process settings take precedence over .env', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'SHARED_PASSWORD=file-password\n');
    const target = { SHARED_PASSWORD: 'process-password' };

    expect(loadEnvironmentFile(envPath, target, ['SHARED_PASSWORD'])).toEqual([]);
    expect(target.SHARED_PASSWORD).toBe('process-password');
  });

  test('missing .env is safe', () => {
    expect(loadEnvironmentFile(path.join(tempDir, 'missing.env'), {}, ['SHARED_PASSWORD']))
      .toEqual([]);
  });
});
