// Scheduler reservations contain no robot commands. Held until explicit completion/reconciliation,
// including after browser disconnect or server restart: a lost heartbeat never means a Task stopped.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function createSchedulerRouter({ statePath, getAuthToken }) {
  const router = express.Router(); const held = new Map(); let storageError = false;
  try {
    if (fs.existsSync(statePath)) {
      const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (!Array.isArray(data.reservations)) throw new Error('Invalid reservations');
      for (const value of data.reservations) {
        if (!value || typeof value.robotKey !== 'string' || typeof value.runId !== 'string') throw new Error('Invalid reservation');
        held.set(value.robotKey, value);
      }
    }
  } catch (_error) { storageError = true; }
  const owner = req => crypto.createHash('sha256').update(getAuthToken(req)).digest('hex');
  const persist = () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath + '.tmp', JSON.stringify({ reservations: [...held.values()] }), { mode: 0o600 });
    fs.renameSync(statePath + '.tmp', statePath);
  };
  router.use((req, res, next) => {
    if (req.userRole !== 'engineer') return res.status(403).json({ error: '엔지니어 모드가 필요합니다.' });
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.headers.host}`) return res.status(403).json({ error: 'Origin not allowed' });
    if (storageError) return res.status(503).json({ error: '스케줄러 예약 기록을 읽을 수 없습니다. 실행을 차단했습니다.' });
    next();
  });
  router.get('/reservations', (_req, res) => res.json({ reservations: [...held.values()].map(({ owner: _owner, ...value }) => value) }));
  router.post('/:operation', (req, res) => {
    const { robotKey, runId, clientId, confirmed } = req.body || {};
    if (typeof robotKey !== 'string' || !/^(real|test)\|R_\d{3}\|[0-9.]+\|\d{1,5}$/.test(robotKey)
      || typeof runId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(runId)) return res.status(400).json({ error: '잘못된 대상 또는 실행 ID입니다.' });
    const operation = req.params.operation, previous = held.get(robotKey);
    if (!['acquire', 'release', 'reconcile'].includes(operation)) return res.sendStatus(404);
    if (operation === 'acquire') {
      if (typeof clientId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(clientId)) return res.status(400).json({ error: '잘못된 클라이언트 ID입니다.' });
      if (previous) {
        if (previous.runId === runId && previous.clientId === clientId && previous.owner === owner(req)) return res.json({ success: true });
        return res.status(409).json({ error: '이 로봇의 다른 예약 실행을 추적 중입니다. 완료 상태를 확인하세요.' });
      }
      if (held.size >= 256) return res.status(429).json({ error: '예약 실행 추적 한도를 초과했습니다.' });
      held.set(robotKey, { robotKey, runId, clientId, owner: owner(req), createdAt: Date.now() });
    } else {
      if (!previous) return res.json({ success: true });
      if (previous.runId !== runId) return res.status(409).json({ error: '현재 예약의 실행 ID와 다릅니다.' });
      if (operation === 'release' && previous.owner !== owner(req)) return res.status(403).json({ error: '다른 로그인 세션의 예약입니다.' });
      if (operation === 'reconcile' && confirmed !== true) return res.status(400).json({ error: '실제 로봇 상태를 확인한 명시적 해제가 필요합니다.' });
      held.delete(robotKey);
    }
    try { persist(); res.json({ success: true }); }
    catch (_error) {
      if (previous) held.set(robotKey, previous); else held.delete(robotKey);
      storageError = true; res.status(503).json({ error: '예약 기록을 저장하지 못해 실행을 차단했습니다.' });
    }
  });
  return router;
}
module.exports = { createSchedulerRouter };
