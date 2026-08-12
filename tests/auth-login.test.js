const express = require('express');
const http = require('http');
const { createAuthRouter } = require('../server/routes/auth');

function requestJson(port, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: JSON.parse(responseBody)
        });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function requestAuthRoute(port, method, requestPath, body, cookie) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (cookie) headers.Cookie = cookie;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: JSON.parse(responseBody)
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

describe('login API', () => {
  let server;
  let port;
  let sharedPassword;
  let authSessions;

  beforeEach(done => {
    sharedPassword = 'test-password-over-ten-characters';
    authSessions = new Map();
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter({
      authSessions,
      getSharedPassword: () => sharedPassword,
      authRateLimiter: (req, res, next) => next()
    }));
    server = app.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      done();
    });
  });

  afterEach(done => {
    server.close(done);
  });

  test('accepts a configured password longer than the former UI limit', async () => {
    const response = await requestJson(port, {
      password: sharedPassword,
      role: 'engineer'
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, role: 'engineer' });
    expect(response.headers['set-cookie'][0]).toContain('amr_auth=');
  });

  test('returns a Korean message for an incorrect password', async () => {
    const response = await requestJson(port, {
      password: 'wrong-password',
      role: 'user'
    });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('비밀번호가 올바르지 않습니다.');
  });

  test('explains a missing server password configuration', async () => {
    sharedPassword = '';
    const response = await requestJson(port, {
      password: 'any-password',
      role: 'user'
    });

    expect(response.status).toBe(503);
    expect(response.body.message).toContain('SHARED_PASSWORD');
  });

  test('reports the authenticated role and invalidates it on logout', async () => {
    const login = await requestJson(port, {
      password: sharedPassword,
      role: 'engineer'
    });
    const cookie = login.headers['set-cookie'][0].split(';', 1)[0];

    const authenticated = await requestAuthRoute(
      port, 'GET', '/api/auth/status', undefined, cookie
    );
    const logout = await requestAuthRoute(
      port, 'POST', '/api/auth/logout', undefined, cookie
    );
    const loggedOut = await requestAuthRoute(
      port, 'GET', '/api/auth/status', undefined, cookie
    );

    expect(authenticated.body).toEqual({ authenticated: true, role: 'engineer' });
    expect(logout.body).toEqual({ success: true });
    expect(logout.headers['set-cookie'][0]).toContain('Max-Age=0');
    expect(authSessions.size).toBe(0);
    expect(loggedOut.body).toEqual({ authenticated: false, role: null });
  });
});
