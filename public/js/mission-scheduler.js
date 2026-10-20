// Browser-session scheduler. All robot writes go through ActionSender's verified ROS1/ROS2 path.
const MissionScheduler = {
  STORAGE_KEY: 'missionScheduler', LOG_KEY: 'missionSchedulerLog', RUN_KEY: 'missionSchedulerRuns',
  BATTERY_LATCH_VERSION: 3, FRESH_MS: 15000,
  _armed: false, _runs: new Map(), _watchers: new Map(), _reservations: [], _editingMissionId: null,
  _clientId: null, _initialized: false, _storageFault: false,
  _id() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}_${Math.random().toString(36).slice(2)}`; },
  _engineer() { return App._userRole === 'engineer'; },
  target(slot) { return slot ? { robotId: slot.robotId, ip: slot.ip, sshPort: Number(slot.sshPort) || 22, virtual: Boolean(slot.virtualTestRobot) } : null; },
  key(target) { return target ? `${target.virtual ? 'test' : 'real'}|${target.robotId}|${target.ip}|${target.sshPort || 22}` : ''; },
  _slot(target) { return App.robotSlots?.findIndex(slot => this.key(this.target(slot)) === this.key(target)) ?? -1; },
  _signature(entry) { return JSON.stringify([entry?.queue, entry?.loopFlag ?? 1]); },
  _definition(m) { return JSON.stringify([m?.target, m?.queueName, m?.taskSignature, m?.mode, m?.intervalSec, m?.cronTime, m?.batteryThreshold, m?.batteryCondition, m?.timeoutSec]); },
  getAll() {
    try {
      const list = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
      if (!Array.isArray(list) || list.length > 200) throw new Error('미션 저장 형식이 올바르지 않습니다.');
      return list.filter(m => m && /^[a-zA-Z0-9_-]{1,96}$/.test(String(m.id))).map(m => ({ ...m, id: String(m.id), name: String(m.name || '').slice(0, 100), queueName: String(m.queueName || '').slice(0, 200), enabled: Boolean(m.enabled) && Boolean(m.target), batteryArmed: m.batteryArmed !== false }));
    } catch (_error) { this._storageFault = true; return []; }
  },
  saveAll(list) {
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list)); }
    catch (error) { this._storageFault = true; this._armed = false; throw error; }
  },
  _update(id, patch) { const list = this.getAll(), m = list.find(m => m.id === String(id)); if (m) { Object.assign(m, patch); this.saveAll(list); } },
  getLogs() { try { const list = JSON.parse(localStorage.getItem(this.LOG_KEY) || '[]'); return Array.isArray(list) ? list.slice(0, 100) : []; } catch (_error) { return []; } },
  saveLogs(list) { localStorage.setItem(this.LOG_KEY, JSON.stringify(list.slice(0, 100))); },
  addLog(msg) { try { this.saveLogs([{ msg: String(msg).slice(0, 1000), at: Date.now() }, ...this.getLogs()]); } catch (_error) { /* log failure never permits a Task */ } this.renderLog(); },
  _saveRuns() { localStorage.setItem(this.RUN_KEY, JSON.stringify([...this._runs.values()].map(r => ({ id: r.id, missionId: r.missionId, target: r.target, taskId: r.taskId, startedAt: r.startedAt, phase: r.phase })))); },
  async api(operation, body) {
    const response = await fetchWithTimeout(`/api/scheduler/${operation}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}, 8000);
    const value = await response.json(); if (!response.ok) throw new Error(value.error || '예약 서버 응답을 확인할 수 없습니다.'); return value;
  },
  init() {
    if (this._initialized) return; this._initialized = true; this._clientId = this._id();
    try {
      const stored = JSON.parse(localStorage.getItem(this.RUN_KEY) || '[]');
      if (!Array.isArray(stored)) throw new Error('Invalid runtime');
      for (const value of stored) if (value?.id && value?.target && value?.taskId) this._runs.set(value.id, { ...value, phase: 'unknown', restored: true });
    } catch (_error) { this._storageFault = true; }
    const bind = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    bind('btn-scheduler-add', () => this.openAddMissionModal()); bind('btn-scheduler-clear', () => this.clearAll());
    bind('btn-scheduler-clear-log', () => this.clearLog()); bind('btn-scheduler-cancel', () => this.closeAddMissionModal());
    bind('btn-scheduler-save', () => this.saveMissionFromModal()); bind('btn-scheduler-arm', () => this._armed ? this.disarm('예약 실행 중지') : this.arm());
    bind('btn-scheduler-reservations', () => this.refreshReservations());
    for (const id of ['scheduler-execution-mode', 'scheduler-battery-condition']) document.getElementById(id)?.addEventListener('change', () => this.updateAddMissionForm());
    document.getElementById('scheduler-queue-name')?.addEventListener('change', () => this.updateSelectedTaskHelp());
    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-sched-action]'); if (!button) return;
      const id = button.dataset.missionId;
      const actions = { run: () => this.executeMission(id, true), edit: () => this.openAddMissionModal(id), toggle: () => this.toggleMission(id), remove: () => this.removeMission(id), cancel: () => this.cancelMission(id), validate: () => this.validateMission(id), reconcile: () => this.reconcile(button.dataset.robotKey, button.dataset.runId) };
      try { Promise.resolve(actions[button.dataset.schedAction]?.()).catch(error => App.toast(error.message, 'error')); }
      catch (error) { App.toast(error.message, 'error'); }
    });
    document.getElementById('scheduler-add-modal')?.addEventListener('click', event => { if (event.target.id === 'scheduler-add-modal') this.closeAddMissionModal(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.closeAddMissionModal(); });
    document.addEventListener('easyloop:task-result', event => {
      for (const run of this._runs.values()) if (run.target.robotId === event.detail?.robotId) this._onResult(run, event.detail);
    });
    document.addEventListener('amr:active-robot-changed', () => this.disarm('활성 로봇 변경 · 대상은 각 미션에 고정됩니다.'));
    document.addEventListener('storage', () => { this.render(); this.renderLog(); });
    window.addEventListener('pagehide', () => this.disarm('화면 종료'));
    OpMode.onChange(() => { if (!OpMode.isAuto) this.disarm('MANUAL 모드'); this.render(); });
    this._timer = setInterval(() => this.tick(), 1000);
    this.render(); this.renderLog();
  },
  async refreshReservations() {
    if (!this._engineer()) return;
    try { this._reservations = (await this.api('reservations')).reservations || []; this._serverError = ''; }
    catch (error) { this._serverError = error.message; }
    this.render();
  },
  async arm() {
    if (!this._engineer() || !OpMode.isAuto || this._storageFault) return App.toast('엔지니어 AUTO 모드와 정상 저장 상태가 필요합니다.', 'warning');
    await this.refreshReservations(); if (this._serverError) return App.toast(this._serverError, 'error');
    const list = this.getAll();
    for (const m of list) m.nextDue = m.mode === 'interval' ? Date.now() + Number(m.intervalSec) * 1000 : null;
    try { this.saveAll(list); } catch (_error) { return App.toast('미션을 저장하지 못해 예약 시작을 차단했습니다.', 'error'); }
    this._armed = true; this.addLog('예약 시작 · 브라우저가 열려 있는 동안 실행합니다.'); this.render();
  },
  disarm(reason = '예약 중지') {
    const was = this._armed; this._armed = false;
    for (const watch of this._watchers.values()) try { watch.topic.unsubscribe(); } catch (_error) { /* closed */ }
    this._watchers.clear();
    if (was) this.addLog(`${reason} · 이미 전송한 Task는 개별 취소가 필요합니다.`);
    this.render();
  },
  _entry(m) {
    const entry = ActionSender.getSavedQueues()[m.queueName];
    if (!entry || !Array.isArray(entry.queue) || !entry.queue.length) throw new Error('저장 Task가 없거나 비어 있습니다.');
    const loop = Number(entry.loopFlag ?? 1);
    if (!Number.isInteger(loop) || loop < 1 || loop > 9999) throw new Error('Scheduler는 유한 반복 Task만 지원합니다.');
    if (m.taskSignature !== this._signature(entry)) throw new Error('저장 Task가 변경됐습니다. 미션을 수정해 확인·저장하세요.');
    return entry;
  },
  _battery(slot) {
    const bms = slot?.bms, value = bms?.soc;
    return bms?.socValid === true && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
      && Number.isFinite(bms.receivedAt) && Date.now() - bms.receivedAt >= 0 && Date.now() - bms.receivedAt <= this.FRESH_MS ? value : null;
  },
  _batteryConditionMatches(m, value) { return ['above', 'gte'].includes(m.batteryCondition) ? value >= Number(m.batteryThreshold) : value <= Number(m.batteryThreshold); },
  _isDockingOutEntry(entry) { const first = entry?.queue?.[0]; return Number(first?.actionType ?? first?.action_type) === 16; },
  _readiness(m, isManualRun, run = null) {
    if (!this._engineer()) throw new Error('엔지니어 로그인 상태가 아닙니다.');
    if (this._storageFault) throw new Error('저장 데이터를 확인할 수 없어 실행을 차단했습니다.');
    if (!m || !m.enabled || !m.target) throw new Error('미션이 중지됐거나 대상 로봇이 지정되지 않았습니다.');
    if (!['once', 'interval', 'cron', 'battery'].includes(m.mode)) throw new Error('실행 조건이 올바르지 않습니다.');
    if (!isManualRun && !OpMode.isAuto) throw new Error('AUTO 모드가 아닙니다.');
    if (!isManualRun && !this._armed) throw new Error('예약 실행이 중지됐습니다.');
    const index = this._slot(m.target), slot = App.robotSlots?.[index];
    if (!slot?.connected || !slot.ros) throw new Error('지정한 로봇이 연결되지 않았습니다.');
    if (run && (slot !== run.slot || slot.ros !== run.ros || run.cancelRequested || run.phase === 'unknown' || !this._runs.has(run.id))) throw new Error('전송 준비 중 대상 연결 또는 실행 상태가 바뀌었습니다.');
    if (slot.rosControlEnabled === false) throw new Error('연결 시 로컬 bringup 미확인 · 조회 전용입니다. bringup 상태 확인 후 재연결하세요.');
    const entry = this._entry(m), soc = this._battery(slot);
    const compatibility = ActionSender._taskQueueCompatibility?.(entry, slot);
    if (compatibility && !compatibility.runnable) throw new Error(compatibility.reason || '이 로봇의 Task 형식을 확인하세요.');
    if (soc === null) throw new Error('배터리 정보가 없거나 15초 이상 갱신되지 않았습니다.');
    if (m.mode === 'battery' && !this._batteryConditionMatches(m, soc)) throw new Error('배터리 실행 조건을 충족하지 않습니다.');
    if (slot.bms.charging && !this._isDockingOutEntry(entry)) throw new Error('충전 중에는 DockingOut으로 시작하는 Task만 허용합니다.');
    const running = ActionSender._runningTasks?.get(slot.robotId);
    if (running && !running.finishedAt && ['work', 'pause', 'cancel', 'recovery'].includes(running.state) && running.taskId !== run?.taskId) throw new Error('다른 Task가 실행 중입니다.');
    return { index, slot, entry };
  },
  async _watchTargets() {
    const missions = this.getAll().filter(m => m.enabled && m.target);
    const needed = new Set(missions.map(m => this.key(m.target)));
    for (const [key, watch] of this._watchers) if (!needed.has(key)) { watch.topic.unsubscribe(); this._watchers.delete(key); }
    for (const m of missions) {
      const index = this._slot(m.target), slot = App.robotSlots?.[index], key = this.key(m.target);
      const old = this._watchers.get(key);
      if (old && (old.ros !== slot?.ros || old.index !== index)) { old.topic.unsubscribe(); this._watchers.delete(key); }
      if (!slot?.connected || !slot.ros || this._watchers.has(key) || slot.virtualTestRobot) continue;
      const profile = typeof RobotCompatibility !== 'undefined' ? RobotCompatibility.get(slot) : null;
      const endpoint = profile?.monitoring?.topics?.bms;
      if (!endpoint?.name || !endpoint?.type || typeof ROSLIB === 'undefined') continue;
      const topic = new ROSLIB.Topic({ ros: slot.ros, name: endpoint.name, messageType: endpoint.type });
      topic.subscribe(msg => { if (this._armed && App.robotSlots?.[index] === slot && slot.ros === this._watchers.get(key)?.ros) RosManager._handleSlotBmsData(index, msg); });
      this._watchers.set(key, { topic, ros: slot.ros, index });
    }
  },
  _date(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; },
  tick() {
    try { this._tickOnce(); }
    catch (error) { this._storageFault = true; this.disarm('예약 데이터 오류'); this.addLog(`예약 데이터/저장 오류 · ${error.message}`); }
  },
  _tickOnce() {
    for (const run of this._runs.values()) if (run.phase !== 'unknown' && Date.now() - run.startedAt > (run.sent ? run.timeoutSec * 1000 : 20000)) this._unknown(run, '실행 확인 시간 초과 · 실제 Task 종료로 판정하지 않습니다.');
    if (!this._engineer() || !OpMode.isAuto) { if (this._armed) this.disarm('권한 또는 운영 모드 변경'); return; }
    if (!this._armed) return;
    this._watchTargets().catch(() => {});
    const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const m of this.getAll()) {
      if (!m.enabled || !m.target || Date.now() - (m.lastAttemptAt || 0) < 10000) continue;
      const slot = App.robotSlots?.[this._slot(m.target)], soc = this._battery(slot);
      if (m.mode === 'battery' && soc !== null && !this._batteryConditionMatches(m, soc) && !m.batteryArmed) this._update(m.id, { batteryArmed: true });
      const due = m.mode === 'interval' ? Number.isFinite(m.nextDue) && Date.now() >= m.nextDue
        : m.mode === 'cron' ? m.cronTime === hhmm && m.lastCronDate !== this._date(now)
          : m.mode === 'battery' && m.batteryArmed && soc !== null && this._batteryConditionMatches(m, soc);
      if (due) this.executeMission(m.id, false);
    }
    this.render();
  },
  async _observe(run) {
    if (run.slot.virtualTestRobot) return;
    const task = await ActionSender._resolveTaskInterface(run.slot);
    if (!task.resultName || !task.resultType) throw new Error('Task 결과 토픽이 확인되지 않아 예약 실행을 차단했습니다.');
    if (run.cancelRequested || !this._runs.has(run.id)) throw new Error('준비가 취소됐습니다.');
    run.topic = new ROSLIB.Topic({ ros: run.ros, name: task.resultName, messageType: task.resultType });
    run.topic.subscribe(message => this._onResult(run, message));
  },
  _onResult(run, message) {
    if (!this._runs.has(run.id) || message.task_id !== run.taskId) return;
    if (!run.accepted) { run.earlyResult = message; return; }
    const success = message.success === true;
    const state = success ? 'completed' : run.cancelRequested || /cancel|취소/i.test(message.message || '') ? 'cancelled' : 'failed';
    this._finish(run, state, message.message || (success ? 'Task 완료 결과 수신' : 'Task 실패 결과 수신'));
  },
  async executeMission(id, isManualRun = false) {
    const m = this.getAll().find(m => m.id === String(id));
    if (m?.target && [...this._runs.values()].some(run => this.key(run.target) === this.key(m.target))) return { ok: false, reason: '같은 로봇의 실행을 추적 중입니다.' };
    let info;
    try { info = this._readiness(m, isManualRun); }
    catch (error) { if (m) this._waiting(m, error.message); return { ok: false, reason: error.message }; }
    const key = this.key(m.target);
    if ([...this._runs.values()].some(run => this.key(run.target) === key)) return { ok: false, reason: '같은 로봇의 실행을 추적 중입니다.' };
    const runId = this._id(), run = { id: runId, missionId: m.id, target: m.target, taskId: `sch_${runId}`, slot: info.slot, ros: info.slot.ros, startedAt: Date.now(), phase: 'preparing', definition: this._definition(m), timeoutSec: m.timeoutSec || 1800, manual: isManualRun };
    this._runs.set(run.id, run);
    try {
      await this.api('acquire', { robotKey: key, runId, clientId: this._clientId }); run.reserved = true;
      this._saveRuns(); await this._observe(run);
      const beforeSend = slot => {
        const latest = this.getAll().find(value => value.id === m.id);
        if (run.definition !== this._definition(latest)) throw new Error('전송 준비 중 미션 정의가 변경되어 전송하지 않았습니다.');
        this._readiness(latest, isManualRun, run);
        if (!isManualRun && (latest.mode === 'cron' && latest.lastCronDate === this._date() || latest.mode === 'battery' && !latest.batteryArmed || latest.mode === 'interval' && latest.nextDue > Date.now())) throw new Error('다른 실행에서 처리했거나 아직 도래하지 않은 예약입니다.');
        if (slot !== run.slot) throw new Error('대상 로봇 연결이 교체됐습니다.');
        this._update(m.id, { lastAttemptAt: Date.now(), lastStatus: 'sending', lastTaskId: run.taskId,
          lastCronDate: m.mode === 'cron' ? this._date() : m.lastCronDate,
          nextDue: m.mode === 'interval' ? Date.now() + m.intervalSec * 1000 : m.nextDue,
          batteryArmed: m.mode === 'battery' ? false : m.batteryArmed });
        run.phase = 'sending'; this._saveRuns(); run.sent = true;
      };
      // ActionSender rechecks after asynchronous discovery/conversion and immediately before the write.
      await ActionSender.sendSavedQueueToSlot(m.queueName, info.index, info.entry.loopFlag ?? 1, run.taskId, { beforeSend, timeoutMs: 10000 });
      run.accepted = true;
      if (run.phase !== 'unknown') run.phase = 'running';
      this._update(m.id, { lastStatus: run.phase, lastRun: Date.now(), lastReason: '전송 승인 · 완료 결과 대기' }); this._saveRuns();
      this.addLog(`[${m.name}] ${m.target.robotId} · 전송 승인 · ${run.taskId} · 완료 대기`);
      if (run.earlyResult) this._onResult(run, run.earlyResult);
      else if (run.cancelRequested) await this._cancelOwned(run);
      this.render(); return { ok: true, taskId: run.taskId };
    } catch (error) {
      if (run.sent && error.code !== 'TASK_REJECTED') this._unknown(run, error.message);
      else await this._finish(run, run.cancelRequested ? 'cancelled' : 'failed', error.message);
      return { ok: false, reason: error.message };
    }
  },
  _waiting(m, reason) {
    if (m.lastReason !== reason || Date.now() - (m.lastAttemptAt || 0) >= 30000) {
      try { this._update(m.id, { lastStatus: 'waiting', lastReason: reason, lastAttemptAt: Date.now() }); } catch (_error) { this._storageFault = true; this.disarm('저장 실패'); }
      this.addLog(`[${m.name}] 대기 · ${reason}`);
    }
    this.render();
  },
  _unknown(run, reason) {
    if (!this._runs.has(run.id)) return;
    run.phase = 'unknown'; this.disarm('실행 결과 미확인');
    try { this._update(run.missionId, { lastStatus: 'unknown', lastReason: reason, enabled: false }); this._saveRuns(); } catch (_error) { this._storageFault = true; }
    this.addLog(`[${run.target.robotId}] ${run.taskId} · 상태 미확인 · ${reason}`); this.refreshReservations(); this.render();
  },
  async _finish(run, state, reason) {
    if (!this._runs.has(run.id)) return;
    try { run.topic?.unsubscribe(); } catch (_error) { /* closed */ }
    this._runs.delete(run.id);
    const record = ActionSender._runningTasks?.get(run.target.robotId);
    if (record?.taskId === run.taskId && ['completed', 'cancelled', 'failed'].includes(state)) { record.finishedAt = Date.now(); record.state = state === 'completed' ? 'complete' : state === 'cancelled' ? 'cancel' : 'abort'; ActionSender._syncActiveRunningTask?.(); }
    try {
      this._update(run.missionId, { lastStatus: state, lastReason: reason, ...(state === 'completed' ? { lastSuccessAt: Date.now() } : {}) });
      this._saveRuns();
      if (run.reserved) await this.api('release', { robotKey: this.key(run.target), runId: run.id });
    } catch (error) { this._serverError = `추적 기록 확인 필요: ${error.message}`; this.disarm('추적 기록 확인 필요'); }
    this.addLog(`[${run.target.robotId}] ${run.taskId} · ${state} · ${reason}`); this.render();
  },
  async cancelMission(id) {
    if (!this._engineer()) return;
    const run = [...this._runs.values()].find(run => run.missionId === String(id)); if (!run) return;
    if (run.restored || run.phase === 'unknown' && !run.accepted) { App.toast('이 연결에서는 실행 소유권이 확인되지 않습니다. 실제 Task 상태를 확인하세요.', 'warning'); return; }
    run.cancelRequested = true;
    if (!run.sent) { this.addLog(`${run.taskId} · 전송 준비 취소`); return; }
    if (run.accepted) await this._cancelOwned(run);
    else this.addLog(`${run.taskId} · 전송 응답 후 취소할 예정입니다.`);
  },
  async _cancelOwned(run) {
    if (run.cancelling) return;
    const slot = App.robotSlots?.[this._slot(run.target)];
    if (!this._engineer() || slot !== run.slot || slot?.ros !== run.ros || ActionSender._runningTasks?.get(slot.robotId)?.taskId !== run.taskId) return this._unknown(run, '동일한 로봇의 이 Task가 실행 중인지 확인되지 않아 전체 Task 취소를 보내지 않았습니다.');
    run.cancelling = true; run.phase = 'cancelling';
    try { await ActionSender.cancelTaskOnSlot(this._slot(run.target)); this._update(run.missionId, { lastStatus: 'cancelling', lastReason: '취소 요청 승인 · 종료 결과 대기' }); }
    catch (error) { run.cancelling = false; this._unknown(run, `취소 응답 미확인: ${error.message}`); }
    this.render();
  },
  async reconcile(robotKey, runId) {
    if (!this._engineer() || !confirm('실제 로봇의 Task가 종료된 것을 확인했습니까?\n이 동작은 예약 추적만 해제하며 로봇을 정지/취소하지 않습니다. 해당 미션은 중지됩니다.')) return;
    this.disarm('운영자 추적 해제');
    try {
      await this.api('reconcile', { robotKey, runId, confirmed: true });
      const run = this._runs.get(runId);
      if (run) { this._update(run.missionId, { enabled: false, lastStatus: 'reconciled', lastReason: '운영자 상태 확인 후 추적 해제' }); await this._finish({ ...run, reserved: false }, 'reconciled', '운영자 확인'); }
      await this.refreshReservations();
    } catch (error) { App.toast(error.message, 'error'); }
  },
  validateMission(id) {
    if (!this._engineer()) return false;
    try {
      const m = this.getAll().find(value => value.id === String(id)), entry = this._entry(m), slot = App.robotSlots?.[this._slot(m.target)];
      if (!slot) throw new Error('지정한 로봇이 목록에 없습니다.');
      const result = ActionSender._taskQueueCompatibility?.(entry, slot);
      if (result && !result.runnable) throw new Error(result.reason);
      App.toast('저장 Task 형식 확인 완료 · 전송하지 않았습니다.', 'success'); return true;
    } catch (error) { App.toast(error.message, 'warning'); return false; }
  },
  removeMission(id) {
    if (!this._engineer() || [...this._runs.values()].some(run => run.missionId === String(id))) return App.toast('실행 추적 중인 미션은 취소/상태 확인 후 삭제하세요.', 'warning');
    this.saveAll(this.getAll().filter(m => m.id !== String(id))); this.render();
  },
  toggleMission(id) { if (!this._engineer()) return; const list = this.getAll(), m = list.find(m => m.id === String(id)); if (!m || !m.target) return; if (!m.enabled && [...this._runs.values()].some(run => run.missionId === m.id)) return App.toast('진행 중인 실행의 상태를 먼저 확인하세요.', 'warning'); m.enabled = !m.enabled; m.nextDue = Date.now() + Number(m.intervalSec || 300) * 1000; m.batteryArmed = true; this.saveAll(list); this.render(); },
  clearAll() { if (!this._engineer() || this._runs.size) return App.toast('실행 추적을 완료한 뒤 삭제하세요.', 'warning'); if (confirm('등록된 미션을 모두 삭제할까요?')) { this.disarm(); this.saveAll([]); this.render(); } },
  clearLog() { if (!this._engineer()) return; this.saveLogs([]); this.renderLog(); },
  closeAddMissionModal() { document.getElementById('scheduler-add-modal')?.classList.remove('show'); this._editingMissionId = null; },
  openAddMissionModal(id = null) {
    if (!this._engineer()) return;
    const m = this.getAll().find(m => m.id === String(id)); this._editingMissionId = m?.id || null;
    const set = (id, value) => { const node = document.getElementById(id); if (node) node.value = value; };
    const select = document.getElementById('scheduler-target'); select.innerHTML = '<option value="">대상 로봇 선택</option>';
    for (const slot of App.robotSlots || []) { const option = document.createElement('option'); option.value = this.key(this.target(slot)); option.textContent = `${slot.robotId} · ${slot.ip}:${slot.sshPort || 22}${slot.virtualTestRobot ? ' · Test Mode' : ''}`; select.appendChild(option); }
    set('scheduler-target', m?.target ? this.key(m.target) : this.key(this.target(App.robotSlots?.[App.activeSlotIndex])));
    const tasks = document.getElementById('scheduler-queue-name'); tasks.innerHTML = '<option value="">저장된 Task 선택</option>';
    for (const [name, entry] of Object.entries(ActionSender.getSavedQueues())) if (entry?.queue?.length) { const option = document.createElement('option'); option.value = name; option.textContent = `${name} (${entry.queue.length} Actions)`; tasks.appendChild(option); }
    set('scheduler-queue-name', m?.queueName || ''); set('scheduler-mission-name', m?.name || ''); set('scheduler-execution-mode', m?.mode || 'once');
    set('scheduler-battery-threshold', m?.batteryThreshold ?? 20); set('scheduler-battery-condition', m?.batteryCondition || 'below');
    set('scheduler-interval-sec', m?.intervalSec || 300); set('scheduler-cron-time', m?.cronTime || '09:00'); set('scheduler-timeout-sec', m?.timeoutSec || 1800);
    document.getElementById('scheduler-add-title').textContent = m ? '미션 수정 · Task 변경 확인' : '미션 추가';
    this.updateAddMissionForm(); this.updateSelectedTaskHelp(); document.getElementById('scheduler-add-modal').classList.add('show'); document.getElementById('scheduler-mission-name').focus();
  },
  updateSelectedTaskHelp() { const entry = ActionSender.getSavedQueues()[document.getElementById('scheduler-queue-name')?.value]; const node = document.getElementById('scheduler-task-help'); if (node) node.textContent = entry?.queue?.length ? `실행 순서: ${entry.queue.map(a => a.name || a.actionType).join(' → ')} · 반복 ${entry.loopFlag ?? 1}` : '작업 탭에서 저장한 Task를 선택하세요.'; },
  updateAddMissionForm() {
    const mode = document.getElementById('scheduler-execution-mode')?.value;
    for (const kind of ['battery', 'interval', 'cron']) { const node = document.getElementById(`scheduler-${kind}-row`); if (node) node.hidden = mode !== kind; }
    const node = document.getElementById('scheduler-condition-help'); if (node) node.textContent = mode === 'once' ? '실행 버튼을 누를 때만 한 번 전송합니다.' : 'AUTO + 예약 시작에서 동작합니다. 중지 중 놓친 예약은 나중에 몰아서 실행하지 않습니다.';
  },
  saveMissionFromModal() {
    if (!this._engineer()) return false;
    const value = id => document.getElementById(id)?.value || '';
    const list = this.getAll(), old = list.find(m => m.id === this._editingMissionId);
    if (old && [...this._runs.values()].some(run => run.missionId === old.id)) return App.toast('실행 추적 중에는 미션을 수정할 수 없습니다.', 'warning');
    const target = (App.robotSlots || []).map(slot => this.target(slot)).find(t => this.key(t) === value('scheduler-target'));
    const name = value('scheduler-mission-name').trim(), queueName = value('scheduler-queue-name'), mode = value('scheduler-execution-mode');
    const entry = ActionSender.getSavedQueues()[queueName], threshold = Number(value('scheduler-battery-threshold')), interval = Number(value('scheduler-interval-sec')), timeout = Number(value('scheduler-timeout-sec')), cron = value('scheduler-cron-time');
    let error = !name || name.length > 100 ? '미션 이름을 1~100자로 입력하세요.' : !target ? '대상 로봇을 선택하세요.' : !entry?.queue?.length ? '저장 Task를 선택하세요.' : !['once','battery','interval','cron'].includes(mode) ? '실행 조건을 선택하세요.' : '';
    if (mode === 'battery' && (!value('scheduler-battery-threshold').trim() || !Number.isFinite(threshold) || threshold < 0 || threshold > 100)) error = '배터리 임계값을 0~100으로 입력하세요.';
    if (mode === 'interval' && (!Number.isInteger(interval) || interval < 10 || interval > 86400)) error = '반복 간격은 10~86400초 정수입니다.';
    if (mode === 'cron' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cron)) error = '매일 실행 시각이 올바르지 않습니다.';
    if (!Number.isInteger(timeout) || timeout < 10 || timeout > 86400) error = '결과 확인 제한은 10~86400초 정수입니다.';
    if (!Number.isInteger(Number(entry?.loopFlag ?? 1)) || Number(entry?.loopFlag ?? 1) < 1) error = '무한 반복 Task는 예약할 수 없습니다.';
    if (error) { App.toast(error, 'error'); return false; }
    const m = { ...old, id: old?.id || this._id(), name, queueName, target, mode, enabled: old?.enabled ?? true, intervalSec: interval,
      cronTime: cron, batteryThreshold: threshold, batteryCondition: value('scheduler-battery-condition') === 'above' ? 'above' : 'below', batteryArmed: true,
      timeoutSec: timeout, taskSignature: this._signature(entry), nextDue: Date.now() + interval * 1000, lastStatus: 'ready', lastReason: '' };
    if (old) list[list.indexOf(old)] = m; else list.push(m);
    try { this.saveAll(list); } catch (_error) { App.toast('미션을 저장하지 못했습니다.', 'error'); return false; }
    this.closeAddMissionModal(); this.render(); return true;
  },
  render() {
    const node = document.getElementById('scheduler-list'); if (!node) return;
    const esc = _escapeHtml, states = { ready:'대기', waiting:'조건 대기', sending:'전송 중', running:'실행 중', cancelling:'취소 확인 중', completed:'완료', failed:'실패', cancelled:'취소됨', unknown:'상태 미확인', reconciled:'추적 해제' };
    const badge = document.getElementById('scheduler-mode-badge'); if (badge) { badge.textContent = `${OpMode.mode.toUpperCase()} · 예약 ${this._armed ? '동작 중' : '중지'}`; badge.className = `scheduler-mode-badge ${this._armed ? 'auto' : 'manual'}`; }
    const arm = document.getElementById('btn-scheduler-arm'); if (arm) { arm.textContent = this._armed ? '예약 중지' : '예약 시작'; arm.disabled = !this._engineer() || !OpMode.isAuto || this._storageFault; }
    const list = this.getAll();
    node.innerHTML = list.length ? list.map(m => {
      const run = [...this._runs.values()].find(r => r.missionId === m.id);
      const mode = m.mode === 'interval' ? `${m.intervalSec}초 간격` : m.mode === 'cron' ? `매일 ${m.cronTime} · 이 브라우저 시간대` : m.mode === 'battery' ? `SOC ${m.batteryCondition === 'above' ? '≥' : '≤'} ${m.batteryThreshold}%` : '수동 1회';
      const next = this._armed && m.enabled && m.mode === 'interval' && m.nextDue ? new Date(m.nextDue).toLocaleTimeString() : m.mode === 'cron' ? m.cronTime : '—';
      const button = (action, label, disabled = false) => `<button type="button" class="btn btn-small" data-sched-action="${action}" data-mission-id="${esc(m.id)}" ${disabled ? 'disabled' : ''}>${label}</button>`;
      return `<div class="scheduler-item ${m.enabled ? '' : 'sched-disabled'}${run?.phase === 'unknown' || m.lastStatus === 'unknown' ? ' sched-unknown' : ''}"><div class="sched-info"><strong class="sched-name">${esc(m.name)}</strong><div class="sched-detail">${esc(m.target ? `${m.target.robotId} · ${m.target.ip}:${m.target.sshPort}${m.target.virtual ? ' · Test Mode' : ''}` : '대상 미지정 · 수정 필요')}</div><div class="sched-detail">Task: ${esc(m.queueName)} · ${esc(mode)} · 다음: ${esc(next)}</div><div class="sched-status">${esc(states[run?.phase || m.lastStatus] || '대기')} · ${esc(m.lastReason || '')}${m.lastSuccessAt ? ` · 최근 완료 ${esc(new Date(m.lastSuccessAt).toLocaleString())}` : ''}</div></div><div class="sched-actions">${button('run','한 번 실행',!this._engineer() || !m.enabled || Boolean(run))}${button('cancel','실행 취소',!run || !this._engineer() || run.restored || run.phase === 'unknown' && !run.accepted)}${button('validate','형식 확인')}${button('edit','수정',Boolean(run))}${button('toggle',m.enabled ? '미션 중지' : '미션 활성화',!m.target || Boolean(run && !m.enabled))}${button('remove','삭제',Boolean(run))}</div></div>`;
    }).join('') : '<span class="scheduler-empty">저장된 미션이 없습니다.</span>';
    const reservations = document.getElementById('scheduler-reservations');
    if (reservations) reservations.innerHTML = `${this._storageFault ? '<p>저장 데이터 오류 · 실행 차단</p>' : ''}${this._serverError ? `<p>${esc(this._serverError)}</p>` : ''}` + this._reservations.map(r => `<div class="scheduler-reservation">추적 중: ${esc(r.robotKey)} · ${esc(r.runId)} <button class="btn btn-small" data-sched-action="reconcile" data-robot-key="${esc(r.robotKey)}" data-run-id="${esc(r.runId)}">실제 종료 확인 후 추적 해제</button></div>`).join('');
  },
  renderLog() { const node = document.getElementById('scheduler-log'); if (node) node.innerHTML = this.getLogs().slice(0, 30).map(log => `<div class="scheduler-log-item"><time>${_escapeHtml(new Date(log.at).toLocaleString())}</time> ${_escapeHtml(log.msg)}</div>`).join('') || '<span>실행 기록이 없습니다.</span>'; }
};
if (typeof module !== 'undefined' && module.exports) module.exports = MissionScheduler;
