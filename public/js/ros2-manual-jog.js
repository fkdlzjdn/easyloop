// Bounded ROS2 ManualJog client. The robot gate retains the final velocity owner,
// physical IO checks, 250 ms lease expiry and post-stop odometry confirmation.
const Ros2ManualJog = {
  validLimits(limits) {
    const keys = ['max_translation_m', 'max_rotation_rad', 'max_linear_speed_mps', 'max_angular_speed_radps',
      'max_linear_accel_mps2', 'max_angular_accel_radps2', 'max_duration_sec', 'max_stop_wait_sec',
      'position_tolerance', 'linear_stop_tolerance_mps', 'angular_stop_tolerance_radps'];
    return Boolean(limits) && keys.every(key => typeof limits[key] === 'number' && Number.isFinite(limits[key]) && limits[key] > 0)
      && limits.max_rotation_rad < Math.PI
      && limits.position_tolerance < Math.min(limits.max_translation_m, limits.max_rotation_rad);
  },

  start({ ros, robotId, contract, axis, displacement, speed, createAction, canContinue, onState = () => {} }) {
    if (!ros || !/^R_\d{3,}$/.test(robotId) || contract?.actionName !== `/${robotId}/manual_jog/execute`) {
      throw new Error('선택한 로봇의 ManualJog Action이 아닙니다.');
    }
    if (contract?.enabled !== true || contract?.actionVerified !== true || !this.validLimits(contract?.limits)) {
      throw new Error('ROS2 ManualJog 활성화·Action·허용 범위를 먼저 확인하세요.');
    }
    if (!['x', 'theta'].includes(axis) || !Number.isFinite(displacement) || displacement === 0
        || !Number.isFinite(speed) || speed <= 0 || !canContinue()) throw new Error('Jog 입력 또는 안전 상태를 확인하세요.');
    const limits = contract.limits;
    const maximum = axis === 'x' ? limits.max_translation_m : limits.max_rotation_rad;
    const speedLimit = axis === 'x' ? limits.max_linear_speed_mps : limits.max_angular_speed_radps;
    if (Math.abs(displacement) > maximum || speed > speedLimit) throw new Error('Jog 입력이 로봇에 설정된 허용 범위를 초과합니다.');
    const commandId = `jog_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const run = { phase: 'starting', commandId, stopped: false, finished: false, handle: null, leaseTimer: null, deadline: null };
    const lease = new ROSLIB.Topic({ ros, name: `/${robotId}/manual_jog/lease`, messageType: 'std_msgs/msg/String' });
    const notify = () => {
      try { onState({ phase: run.phase, commandId, remaining: run.remaining }); }
      catch (error) { console.warn('[ManualJog] status display failed:', error); }
    };
    const stopLease = () => { clearInterval(run.leaseTimer); run.leaseTimer = null; };
    run.stop = () => {
      if (run.finished || run.stopped) return;
      run.stopped = true; run.phase = 'stopping'; stopLease(); notify();
      // Cancel only this connection's own action; lease expiry also stops the
      // gate independently if cancellation cannot reach it.
      if (run.handle) Promise.resolve().then(() => run.handle.cancel()).catch(() => {});
    };
    const renew = () => {
      if (run.finished || run.stopped) return;
      try {
        if (!canContinue() || typeof document !== 'undefined' && document.hidden) { run.stop(); return; }
        lease.publish(new ROSLIB.Message({ data: commandId }));
      } catch (_error) { run.stop(); }
    };
    const cleanup = () => {
      stopLease(); clearTimeout(run.deadline);
      try { lease.unadvertise?.(); } catch (_error) { /* stale socket */ }
    };
    try {
      run.handle = createAction(contract.actionName, 'spx_task_msgs/action/ManualJog', {
        axis, displacement, max_speed: speed, timeout_sec: limits.max_duration_sec, command_id: commandId
      }, feedback => {
        if (!run.stopped && !run.finished) run.phase = 'running';
        if (Number.isFinite(feedback?.remaining)) run.remaining = feedback.remaining;
        notify();
      }, { terminalResult: true, timeoutMs: Math.ceil((limits.max_duration_sec + limits.max_stop_wait_sec + 2) * 1000) });
      run.phase = 'waiting'; notify();
      run.leaseTimer = setInterval(renew, 50);
      run.deadline = setTimeout(run.stop, limits.max_duration_sec * 1000);
      renew();
      run.result = run.handle.result.then(terminal => {
        const result = terminal?.result;
        if (result?.stop_confirmed !== true || ![4, 5, 6].includes(terminal?.status)) {
          run.phase = 'unknown';
          return { phase: 'unknown', stopConfirmed: false, message: result?.error_code || '물리 정지 결과 미확인' };
        }
        run.phase = terminal.status === 4 && result.success === true ? 'completed' : 'stopped';
        return { phase: run.phase, stopConfirmed: true, message: result.error_code || result.message || '' };
      }).catch(error => {
        run.phase = 'unknown';
        return { phase: 'unknown', stopConfirmed: false, message: error?.message || String(error) };
      }).finally(() => { run.finished = true; cleanup(); notify(); });
      return run;
    } catch (error) { cleanup(); throw error; }
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = Ros2ManualJog;
