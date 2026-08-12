const express = require('express');
const crypto = require('crypto');
const {
  AUTH_TOKEN_TTL_MS,
  getAuthToken,
  isAuthTokenValid,
  setAuthCookie,
  clearAuthCookie
} = require('../auth');

function createAuthRouter({ authSessions, getSharedPassword, authRateLimiter }) {
  const router = express.Router();

  router.post('/login', authRateLimiter, (req, res) => {
    const { password, role } = req.body || {};

    if (!password) {
      return res.status(400).json({ success: false, message: '비밀번호를 입력하세요.' });
    }

    const sharedPassword = getSharedPassword();
    if (!sharedPassword) {
      return res.status(503).json({
        success: false,
        message: '서버 로그인 비밀번호가 설정되지 않았습니다. .env의 SHARED_PASSWORD를 확인하세요.'
      });
    }
    if (password !== sharedPassword) {
      return res.status(401).json({ success: false, message: '비밀번호가 올바르지 않습니다.' });
    }

    const userRole = (role === 'engineer') ? 'engineer' : 'user';
    const token = crypto.randomBytes(24).toString('hex');
    authSessions.set(token, { createdAt: Date.now(), role: userRole });
    setAuthCookie(res, token, AUTH_TOKEN_TTL_MS);

    return res.json({ success: true, role: userRole });
  });

  router.post('/logout', (req, res) => {
    const token = getAuthToken(req);
    if (token) {
      authSessions.delete(token);
    }
    clearAuthCookie(res);
    return res.json({ success: true });
  });

  router.get('/status', (req, res) => {
    const token = getAuthToken(req);
    const valid = isAuthTokenValid(authSessions, token);
    const session = valid ? authSessions.get(token) : null;
    return res.json({
      authenticated: valid,
      role: session ? (session.role || 'user') : null
    });
  });

  return router;
}

module.exports = { createAuthRouter };
