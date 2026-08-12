const {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_TTL_MS,
  parseCookies,
  getAuthToken,
  isAuthTokenValid,
  setAuthCookie,
  clearAuthCookie,
  createAuthMiddleware
} = require('../server/auth');

describe('authentication session helpers', () => {
  test('parses cookies and accepts Bearer auth before cookie auth', () => {
    expect(parseCookies('a=1; encoded=hello%20robot; empty=')).toEqual({
      a: '1',
      encoded: 'hello robot',
      empty: ''
    });
    expect(getAuthToken({
      headers: {
        authorization: 'Bearer bearer-token',
        cookie: `${AUTH_COOKIE_NAME}=cookie-token`
      }
    })).toBe('bearer-token');
  });

  test('sets and clears secure session cookie attributes', () => {
    const res = { setHeader: jest.fn() };
    setAuthCookie(res, 'token', 5000);
    expect(res.setHeader).toHaveBeenLastCalledWith(
      'Set-Cookie',
      expect.stringContaining(`${AUTH_COOKIE_NAME}=token; HttpOnly; SameSite=Strict; Path=/; Max-Age=5`)
    );

    clearAuthCookie(res);
    expect(res.setHeader).toHaveBeenLastCalledWith(
      'Set-Cookie',
      expect.stringContaining(`${AUTH_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
    );
  });

  test('expires stale sessions and removes them from the store', () => {
    const sessions = new Map([
      ['fresh', { createdAt: Date.now() }],
      ['stale', { createdAt: Date.now() - AUTH_TOKEN_TTL_MS - 1 }]
    ]);

    expect(isAuthTokenValid(sessions, 'fresh')).toBe(true);
    expect(isAuthTokenValid(sessions, 'stale')).toBe(false);
    expect(sessions.has('stale')).toBe(false);
    expect(isAuthTokenValid(sessions, '')).toBe(false);
  });

  test('middleware rejects missing sessions and exposes the stored role', () => {
    const sessions = new Map([
      ['valid', { createdAt: Date.now(), role: 'engineer' }]
    ]);
    const middleware = createAuthMiddleware(sessions);
    const unauthorizedRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    middleware({ path: '/robots', headers: {} }, unauthorizedRes, jest.fn());
    expect(unauthorizedRes.status).toHaveBeenCalledWith(401);

    const req = {
      path: '/robots',
      headers: { cookie: `${AUTH_COOKIE_NAME}=valid` }
    };
    const next = jest.fn();
    middleware(req, {}, next);
    expect(req.userRole).toBe('engineer');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
