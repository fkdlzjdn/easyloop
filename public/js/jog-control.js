// Jog Control - Publish cmd_vel for manual robot movement (floating panel)
const JogControl = {
  _pubInterval: null,
  _currentLx: 0,
  _currentLy: 0,  // QD strafe
  _currentAz: 0,
  _publishing: false,
  _cmdVelTopic: null,
  _activeKeys: new Set(),
  _manualLiftState: null,
  _manualLiftHeldKey: null,
  _manualLiftPubInterval: null,
  _chargeStatusTimer: null,
  _chargeCommandPending: false,
  _stlTurntableTaskPending: false,
  _telemetrySubscriptions: [],
  _telemetryTimer: null,
  _telemetrySlotIndex: -1,
  _safetyState: null,
  _lidarSafetyInputs: null,
  _actualVelocity: null,
  _liftFeedback: null,
  _turntableFeedback: null,
  _lastSafetyBlockSignature: '',
  QUICK_TASK_STORAGE_KEY: 'jogQuickTasks',
  QUICK_TASK_COUNT: 5,
  _quickTaskConfigs: [],
  CHASSIS_STORAGE_KEY: 'jogChassisModelByRobot',
  DEFAULT_CHASSIS_MODEL: 'default_lift_dd',
  _chassisSelections: {},
  // 새 차상은 이 목록에 모델, 주행 타입, 제어 프로필/명령만 하드코딩해서 추가한다.
  CHASSIS_MODELS: [
    {
      id: 'default_lift_dd',
      label: '선택 안 함 (기본)',
      driveType: 'dd',
      controlProfile: 'lift',
      commands: {}
    },
    {
      id: 'stl_ulsan',
      label: 'stl_ulsan · Lift / Turntable',
      driveType: 'dd',
      controlProfile: 'lift_service',
      commands: {}
    },
    {
      id: 'sr3_ls_1st',
      label: 'sr3_ls_1st',
      driveType: 'dd',
      controlProfile: 'sr3_ls_1st_conveyor',
      commands: {
        frontDoorOpen: { label: '전방 도어 OPEN', description: '전방 도어를 엽니다.', cmdType: 144, count: 1 },
        frontDoorClose: { label: '전방 도어 CLOSE', description: '전방 도어를 닫습니다.', cmdType: 145, count: 1 },
        rearDoorOpen: { label: '후방 도어 OPEN', description: '후방 도어를 엽니다.', cmdType: 146, count: 1 },
        rearDoorClose: { label: '후방 도어 CLOSE', description: '후방 도어를 닫습니다.', cmdType: 147, count: 1 },
        frontIntake: { label: '컨베이어 전방 투입', description: '컨베이어를 전방 투입 방향으로 동작시킵니다.', cmdType: 3, count: 0 },
        rearDischarge: { label: '컨베이어 후방 배출', description: '컨베이어를 후방 배출 방향으로 동작시킵니다.', cmdType: 6, count: 0 },
        conveyorStop: { label: '컨베이어 정지', description: '현재 컨베이어 동작을 정지합니다.', cmdType: 2, count: 0 }
      }
    }
  ],
  PUB_RATE: 100,
  MANUAL_LIFT_PUB_RATE: 75,
  SAFETY_STALE_MS: 1200,
  TELEMETRY_STALE_MS: 2500,
  FEEDBACK_STATUS_LABELS: {
    0: 'READY',
    1: 'RUNNING',
    2: 'COMPLETE',
    3: 'READY_TO_COMPLETE',
    4: 'ERROR',
    5: 'ABORT',
    6: 'SYNC'
  },

  _getDriveType() {
    return (document.getElementById('jog-drive-type') || {}).value || 'dd';
  },

  init() {
    this._setupSliders();
    this._setupButtons();
    this._setupKeyboard();
    this._setupPanel();
    this._setupChassisSelector();
    this._setupDriveTypeSwitch();
    this._setupChassisCommandButtons();
    this._setupStlUlsanControls();
    this._setupQuickTasks();
  },

  _setupDriveTypeSwitch() {
    const sel = document.getElementById('jog-drive-type');
    if (!sel) return;
    sel.addEventListener('change', () => this._applyDriveType(sel.value));
    this._applyDriveType(this._getSelectedChassisModel().driveType, false);
  },

  _applyDriveType(driveType, stop = true) {
    const normalized = driveType === 'qd' ? 'qd' : 'dd';
    const sel = document.getElementById('jog-drive-type');
    if (sel) sel.value = normalized;
    document.querySelectorAll('.jog-qd-only').forEach(el => {
      el.style.display = normalized === 'qd' ? '' : 'none';
    });
    if (stop) this._stopVel();
  },

  _activeChassisKey() {
    const slot = App.robotSlots?.[App.activeSlotIndex];
    return slot?.robotId || slot?.ip || 'default';
  },

  _isStlUlsanSlot(slot = App.robotSlots?.[App.activeSlotIndex]) {
    return typeof RobotCompatibility !== 'undefined'
      && RobotCompatibility.isStlUlsanModel?.(slot?.robotModel) === true;
  },

  _loadChassisSelections() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.CHASSIS_STORAGE_KEY));
      this._chassisSelections = saved && typeof saved === 'object' ? saved : {};
    } catch (error) {
      this._chassisSelections = {};
    }
  },

  _saveChassisSelections() {
    try {
      localStorage.setItem(this.CHASSIS_STORAGE_KEY, JSON.stringify(this._chassisSelections));
    } catch (error) {
      console.warn('Jog 차상 선택 저장 실패:', error.message);
    }
  },

  _getSelectedChassisModel() {
    const savedId = this._chassisSelections[this._activeChassisKey()];
    const slot = App.robotSlots?.[App.activeSlotIndex];
    const isStlUlsan = this._isStlUlsanSlot(slot);
    const autoId = isStlUlsan
      ? 'stl_ulsan'
      : this.DEFAULT_CHASSIS_MODEL;
    const selectedId = isStlUlsan
      ? autoId
      : (savedId === 'stl_ulsan' ? this.DEFAULT_CHASSIS_MODEL : (savedId || autoId));
    return this.CHASSIS_MODELS.find(model => model.id === selectedId)
      || this.CHASSIS_MODELS.find(model => model.id === this.DEFAULT_CHASSIS_MODEL)
      || this.CHASSIS_MODELS[0];
  },

  _setupChassisSelector() {
    const container = document.getElementById('jog-chassis-options');
    if (!container) return;
    this._loadChassisSelections();
    container.innerHTML = '';
    this.CHASSIS_MODELS.forEach(model => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'jog-chassis-option';
      button.dataset.modelId = model.id;
      button.setAttribute('role', 'radio');
      button.innerHTML = `<strong>${model.label}</strong><small>${model.driveType.toUpperCase()}</small>`;
      button.addEventListener('click', () => this._setChassisModel(model.id));
      container.appendChild(button);
    });
    this._syncChassisModelUi(false);
    document.addEventListener('amr:active-robot-changed', () => this._syncChassisModelUi());
    document.addEventListener('amr:robot-model-changed', () => this._syncChassisModelUi(false));
  },

  _setChassisModel(modelId) {
    const model = this.CHASSIS_MODELS.find(entry => entry.id === modelId);
    if (!model) return;
    if (model.id === 'stl_ulsan' && !this._isStlUlsanSlot()) {
      App.toast('ROBOT_MODEL이 stl1000w 또는 stl1500w인 로봇에서만 선택할 수 있습니다.', 'error');
      return;
    }
    this._chassisSelections[this._activeChassisKey()] = model.id;
    this._saveChassisSelections();
    this._syncChassisModelUi();
    const picker = document.getElementById('jog-chassis-picker');
    if (picker) picker.open = false;
    App.toast(`Jog 차상: ${model.label} · ${model.driveType.toUpperCase()}`, 'info');
  },

  _syncChassisModelUi(stop = true) {
    const model = this._getSelectedChassisModel();
    document.querySelectorAll('.jog-chassis-option').forEach(button => {
      const selected = button.dataset.modelId === model.id;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-checked', String(selected));
    });

    const current = document.getElementById('jog-chassis-current');
    if (current) current.textContent = `${model.label} · ${model.driveType.toUpperCase()}`;

    const liftControl = document.querySelector('.jog-manual-lift');
    const stlUlsanControl = document.getElementById('jog-stl-ulsan-control');
    const modelIoControl = document.getElementById('jog-model-io-control');
    const isSr3Conveyor = model.controlProfile === 'sr3_ls_1st_conveyor';
    const isStlUlsan = this._isStlUlsanSlot();
    if (isSr3Conveyor) this._stopManualLift();
    if (liftControl) liftControl.hidden = isSr3Conveyor;
    if (stlUlsanControl) stlUlsanControl.hidden = !isStlUlsan;
    if (modelIoControl) modelIoControl.hidden = !isSr3Conveyor;
    document.querySelectorAll('.jog-chassis-option').forEach(button => {
      if (button.dataset.modelId === 'stl_ulsan') button.hidden = !isStlUlsan;
    });
    this._applyDriveType(model.driveType, stop);
    this._updateQuickTaskTarget();
    this._refreshChassisCommandHelp();
    this._setChassisCommandStatus('', '명령 대기');
  },

  // --- Panel open/close/drag ---
  _setupPanel() {
    const toggleBtn = document.getElementById('btn-jog-toggle');
    const toggleBtnMap = document.getElementById('btn-jog-toggle-map'); // Fullscreen map toggle
    const panel = document.getElementById('jog-panel');
    const closeBtn = document.getElementById('jog-panel-close');
    const header = document.getElementById('jog-panel-header');

    // Open panel helper
    const openPanel = () => {
      panel.style.display = 'flex';
      toggleBtn.classList.add('active');
      if (toggleBtnMap) toggleBtnMap.classList.add('active');
      // Default position: bottom-right
      if (!panel.dataset.positioned) {
        panel.style.right = '20px';
        panel.style.bottom = '20px';
        panel.style.left = 'auto';
        panel.style.top = 'auto';
        panel.dataset.positioned = '1';
      }
      this.updateChargeStatus(App.robotSlots[App.activeSlotIndex] || null);
      this.refreshQuickTaskOptions();
      this._updateQuickTaskTarget();
      this._syncChassisModelUi(false);
      this._startTelemetry();
    };

    // Toggle handler
    const handleToggle = () => {
      const isOpen = panel.style.display !== 'none';
      if (isOpen) {
        this._closePanel();
      } else {
        openPanel();
      }
    };

    // Toggle buttons
    toggleBtn.addEventListener('click', handleToggle);
    if (toggleBtnMap) toggleBtnMap.addEventListener('click', handleToggle);

    // Close button
    closeBtn.addEventListener('click', () => this._closePanel());

    // Dragging
    let dragging = false, offsetX = 0, offsetY = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target === closeBtn) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      // Switch to top/left positioning for drag
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = Math.max(0, e.clientX - offsetX) + 'px';
      panel.style.top = Math.max(0, e.clientY - offsetY) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  },

  _closePanel() {
    const panel = document.getElementById('jog-panel');
    const toggleBtn = document.getElementById('btn-jog-toggle');
    const toggleBtnMap = document.getElementById('btn-jog-toggle-map');
    panel.style.display = 'none';
    toggleBtn.classList.remove('active');
    if (toggleBtnMap) toggleBtnMap.classList.remove('active');
    this._stopJogControls();
    this._stopTelemetry();
  },

  _isPanelOpen() {
    const panel = document.getElementById('jog-panel');
    return panel && panel.style.display !== 'none';
  },

  _normalizeKeyboardKey(key) {
    const value = String(key || '');
    return value.length === 1 ? value.toLowerCase() : value;
  },

  _ownsKeyboardEvent(event = {}) {
    if (!this._isPanelOpen()) return false;
    const target = event.target || document.activeElement;
    const tag = String(target?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
      return false;
    }
    const key = this._normalizeKeyboardKey(event.key);
    return [
      'ArrowUp', 'w', 'ArrowDown', 'x',
      'ArrowLeft', 'a', 'ArrowRight', 'd',
      'q', 'e', 's', ' ', 'z', 'c', 'o', 'f',
      'r', 'v', 't'
    ].includes(key);
  },

  _getLinearSpeed() {
    return parseFloat(document.getElementById('jog-linear-speed').value) || 0.2;
  },

  _getAngularSpeed() {
    return parseFloat(document.getElementById('jog-angular-speed').value) || 0.5;
  },

  _getTopicName() {
    const slotIndex = App.activeSlotIndex;
    const rid = RosManager.getRobotId(slotIndex);
    const topicSuffix = document.getElementById('jog-topic').value || '/cmd_vel';
    return rid ? `/${rid}${topicSuffix}` : topicSuffix;
  },

  _emptySafetyState() {
    const item = () => ({ value: null, at: 0 });
    return {
      manual: item(),
      idle: item(),
      emo: item(),
      sto: item(),
      lidar: item(),
      brake: item()
    };
  },

  _startTelemetry() {
    this._stopTelemetry(false);
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots?.[slotIndex];
    const ros = typeof RosManager.getRos === 'function' ? RosManager.getRos(slotIndex) : slot?.ros;
    const rid = typeof RosManager.getRobotId === 'function' ? RosManager.getRobotId(slotIndex) : slot?.robotId;
    this._telemetrySlotIndex = slotIndex;
    this._safetyState = this._emptySafetyState();
    this._lidarSafetyInputs = {
      field: { value: null, at: 0 },
      emergency: { value: null, at: 0 }
    };
    this._actualVelocity = { motor: null, odom: null };
    this._liftFeedback = null;
    this._turntableFeedback = null;
    this._lastSafetyBlockSignature = '';
    this._refreshTelemetryUi();
    if (!slot?.connected || !ros || !rid) return;

    const subscribe = (suffix, messageType, callback) => {
      try {
        const topic = new ROSLIB.Topic({
          ros,
          name: `/${rid}${suffix}`,
          messageType,
          throttle_rate: 100
        });
        topic.subscribe(message => {
          if (this._telemetrySlotIndex !== slotIndex || App.activeSlotIndex !== slotIndex) return;
          callback(message || {});
        });
        this._telemetrySubscriptions.push(topic);
      } catch (error) {
        console.warn(`[Jog] ${rid}${suffix} 구독 실패:`, error.message || error);
      }
    };

    subscribe('/io/select', 'std_msgs/Bool', msg => this._recordSafety('manual', !msg.data));
    subscribe('/robot_state', 'syscon_msgs/RobotState', msg => {
      const state = Number(msg.workstate ?? msg.data);
      this._recordSafety('idle', Number.isFinite(state) && state === 0);
    });
    subscribe('/emergency_sensor', 'std_msgs/Int32MultiArray', msg => {
      const data = Array.isArray(msg.data) ? msg.data : [];
      this._recordSafety('emo', data.length > 0 ? Number(data[0]) === 0 : null);
      this._lidarSafetyInputs.emergency = {
        value: data.length >= 4 ? Number(data[2]) === 0 && Number(data[3]) === 0 : null,
        at: Date.now()
      };
      this._mergeLidarSafety();
    });
    subscribe('/sto_stop', 'std_msgs/Bool', msg => this._recordSafety('sto', !msg.data));
    subscribe('/io/lidar_field', 'std_msgs/UInt8', msg => {
      this._lidarSafetyInputs.field = {
        // HMI contract: field value 1 means a Lidar stop condition.
        value: Number(msg.data) !== 1,
        at: Date.now()
      };
      this._mergeLidarSafety();
    });
    subscribe('/io/break_released', 'std_msgs/Bool', msg => this._recordSafety('brake', Boolean(msg.data)));
    subscribe('/motor_status', 'syscon_msgs/MotorState', msg => {
      const twist = msg.feed_vel;
      if (twist) this._recordActualVelocity('motor', twist);
    });
    subscribe('/odom', 'nav_msgs/Odometry', msg => {
      const twist = msg.twist?.twist;
      if (twist) this._recordActualVelocity('odom', twist);
    });
    subscribe('/Lift/feedback', 'syscon_msgs/LiftFeedback', msg => {
      this._liftFeedback = { ...msg, at: Date.now() };
      this._renderLiftFeedback();
    });
    subscribe('/Turntable/feedback', 'syscon_msgs/LiftFeedback', msg => {
      this._turntableFeedback = { ...msg, at: Date.now() };
      this._renderTurntableFeedback();
    });

    this._telemetryTimer = setInterval(() => {
      this._refreshTelemetryUi();
      this._enforceSafetyGate();
    }, 500);
  },

  _stopTelemetry(resetUi = true) {
    this._telemetrySubscriptions.forEach(topic => {
      try { topic.unsubscribe(); } catch (error) { /* ignore stale ROS subscription */ }
    });
    this._telemetrySubscriptions = [];
    if (this._telemetryTimer) clearInterval(this._telemetryTimer);
    this._telemetryTimer = null;
    this._telemetrySlotIndex = -1;
    if (resetUi) {
      this._safetyState = this._emptySafetyState();
      this._actualVelocity = null;
      this._liftFeedback = null;
      this._turntableFeedback = null;
      this._refreshTelemetryUi();
    }
  },

  _recordSafety(key, value) {
    if (!this._safetyState?.[key]) return;
    this._safetyState[key] = { value, at: Date.now() };
    this._refreshSafetyUi();
    this._enforceSafetyGate();
  },

  _mergeLidarSafety() {
    const field = this._lidarSafetyInputs?.field;
    const emergency = this._lidarSafetyInputs?.emergency;
    if (!field || !emergency) return;
    const known = field.value !== null && emergency.value !== null;
    this._safetyState.lidar = {
      value: known ? field.value && emergency.value : null,
      at: known ? Math.min(field.at, emergency.at) : 0
    };
    this._refreshSafetyUi();
    this._enforceSafetyGate();
  },

  _recordActualVelocity(source, twist) {
    if (!this._actualVelocity) this._actualVelocity = { motor: null, odom: null };
    this._actualVelocity[source] = {
      lx: Number(twist.linear?.x) || 0,
      ly: Number(twist.linear?.y) || 0,
      az: Number(twist.angular?.z) || 0,
      at: Date.now()
    };
    this._renderVelocityComparison();
  },

  _safetyEvaluation() {
    const slot = App.robotSlots?.[App.activeSlotIndex];
    if (!this._isStlUlsanSlot(slot)) {
      return { safe: true, strict: false, reasons: [] };
    }
    if (typeof TestMode !== 'undefined' && TestMode.enabled && slot?.virtualTestRobot) {
      return { safe: true, strict: true, reasons: [], virtual: true };
    }
    const labels = {
      manual: 'MANUAL 모드 미확인',
      idle: 'IDLE 상태 미확인',
      emo: 'EMO 정상 미확인',
      sto: 'STO 정상 미확인',
      lidar: 'Lidar 정상 미확인',
      brake: 'Brake Release 미확인'
    };
    const now = Date.now();
    const reasons = [];
    if (!slot?.connected || !slot?.ros) reasons.push('활성 로봇 미연결');
    Object.entries(labels).forEach(([key, label]) => {
      const state = this._safetyState?.[key];
      if (!state || state.value !== true || now - state.at > this.SAFETY_STALE_MS) {
        reasons.push(label);
      }
    });
    return { safe: reasons.length === 0, strict: true, reasons };
  },

  _requireSafety(actionLabel = 'Jog 명령') {
    const evaluation = this._safetyEvaluation();
    if (evaluation.safe) return true;
    const reason = evaluation.reasons.join(', ');
    this._stopVel();
    this._setSafetyDetail(`${actionLabel} 차단: ${reason}`);
    App.toast?.(`${actionLabel} 차단 · ${reason}`, 'error');
    return false;
  },

  _enforceSafetyGate() {
    const evaluation = this._safetyEvaluation();
    this._refreshSafetyUi(evaluation);
    if (!evaluation.strict || evaluation.safe) {
      this._lastSafetyBlockSignature = '';
      return;
    }
    const moving = this._publishing || this._manualLiftState
      || this._currentLx !== 0 || this._currentLy !== 0 || this._currentAz !== 0;
    if (!moving) return;
    this._stopJogControls();
    const signature = evaluation.reasons.join('|');
    if (signature !== this._lastSafetyBlockSignature) {
      this._lastSafetyBlockSignature = signature;
      App.toast?.(`안전 상태 변경으로 Jog 정지 · ${evaluation.reasons.join(', ')}`, 'error');
    }
  },

  _refreshTelemetryUi() {
    this._refreshSafetyUi();
    this._renderVelocityComparison();
    this._renderLiftFeedback();
    this._renderTurntableFeedback();
  },

  _setSafetyDetail(message) {
    const detail = document.getElementById('jog-safety-detail');
    if (detail) detail.textContent = message;
  },

  _refreshSafetyUi(evaluation = this._safetyEvaluation()) {
    const summary = document.getElementById('jog-safety-summary');
    const gate = document.getElementById('jog-safety-gate');
    if (summary) {
      summary.className = evaluation.strict
        ? (evaluation.safe ? 'safe' : 'blocked')
        : 'checking';
      summary.textContent = evaluation.strict
        ? (evaluation.safe ? 'READY · 명령 허용' : 'BLOCKED · 명령 차단')
        : 'LEGACY · 표시 전용';
    }
    if (gate) gate.classList.toggle('blocked', evaluation.strict && !evaluation.safe);

    const chipLabels = {
      manual: ['MANUAL', 'AUTO'],
      idle: ['IDLE', 'NOT IDLE'],
      emo: ['EMO CLEAR', 'EMO ACTIVE'],
      sto: ['STO CLEAR', 'STO ACTIVE'],
      lidar: ['LIDAR CLEAR', 'LIDAR STOP'],
      brake: ['BRAKE RELEASE', 'BRAKE ON']
    };
    const now = Date.now();
    Object.entries(chipLabels).forEach(([key, labels]) => {
      const el = document.getElementById(`jog-safety-${key}`);
      if (!el) return;
      const item = this._safetyState?.[key];
      const fresh = item && item.value !== null && now - item.at <= this.SAFETY_STALE_MS;
      el.className = `jog-safety-chip ${fresh ? (item.value ? 'safe' : 'blocked') : 'unknown'}`;
      el.textContent = fresh ? labels[item.value ? 0 : 1] : `${key.toUpperCase()} --`;
    });
    if (evaluation.strict) {
      this._setSafetyDetail(evaluation.safe
        ? '모든 안전 상태가 최신·정상입니다.'
        : evaluation.reasons.join(' · '));
    } else {
      this._setSafetyDetail('stl_ulsan 이외 모델은 안전 상태를 표시하지만 strict gate를 적용하지 않습니다.');
    }

    const disabled = evaluation.strict && !evaluation.safe;
    [
      'jog-fwd', 'jog-bwd', 'jog-left', 'jog-right', 'jog-rot-left', 'jog-rot-right',
      'jog-lift-up', 'jog-lift-down', 'jog-turntable-go',
      'jog-turntable-sync-on'
    ].forEach(id => {
      const button = document.getElementById(id);
      if (button) button.disabled = disabled;
    });
    document.querySelectorAll('[data-turntable-target]').forEach(button => { button.disabled = disabled; });
  },

  _renderVelocityComparison() {
    const command = document.getElementById('jog-command-velocity');
    if (command) {
      command.textContent = `Lx ${this._currentLx.toFixed(2)} · Ly ${this._currentLy.toFixed(2)} · Az ${this._currentAz.toFixed(2)}`;
    }
    const actual = document.getElementById('jog-actual-velocity');
    const sourceEl = document.getElementById('jog-velocity-source');
    if (!actual) return;
    const now = Date.now();
    const motor = this._actualVelocity?.motor;
    const odom = this._actualVelocity?.odom;
    const selected = motor && now - motor.at <= this.TELEMETRY_STALE_MS
      ? { ...motor, source: 'motor_status.feed_vel' }
      : (odom && now - odom.at <= this.TELEMETRY_STALE_MS
        ? { ...odom, source: 'odom.twist' }
        : null);
    actual.textContent = selected
      ? `Lx ${selected.lx.toFixed(2)} · Ly ${selected.ly.toFixed(2)} · Az ${selected.az.toFixed(2)}`
      : '수신 대기 / stale';
    if (sourceEl) sourceEl.textContent = selected ? `Source: ${selected.source}` : 'Source: motor_status → odom fallback';
  },

  _feedbackStatus(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? (this.FEEDBACK_STATUS_LABELS[numeric] || `UNKNOWN(${numeric})`) : '--';
  },

  _renderLiftFeedback() {
    const height = document.getElementById('jog-lift-height');
    const status = document.getElementById('jog-lift-feedback-status');
    const error = document.getElementById('jog-lift-error');
    const feedback = this._liftFeedback;
    const fresh = feedback && Date.now() - feedback.at <= this.TELEMETRY_STALE_MS;
    if (height) height.textContent = fresh ? `${(Number(feedback.height || 0) / 100).toFixed(2)}°` : '--';
    if (status) status.textContent = fresh ? this._feedbackStatus(feedback.status) : '--';
    if (error) error.textContent = fresh ? `0x${Number(feedback.error_code || 0).toString(16).toUpperCase().padStart(4, '0')}` : '--';
  },

  _renderTurntableFeedback() {
    const angle = document.getElementById('jog-turntable-angle');
    const status = document.getElementById('jog-turntable-feedback-status');
    const error = document.getElementById('jog-turntable-error');
    const sync = document.getElementById('jog-turntable-sync-state');
    const feedback = this._turntableFeedback;
    const fresh = feedback && Date.now() - feedback.at <= this.TELEMETRY_STALE_MS;
    const numericStatus = Number(feedback?.status);
    if (angle) angle.textContent = fresh ? `${(Number(feedback.height || 0) / 100).toFixed(2)}°` : '--';
    if (status) status.textContent = fresh ? this._feedbackStatus(numericStatus) : '--';
    if (error) error.textContent = fresh ? `0x${Number(feedback.error_code || 0).toString(16).toUpperCase().padStart(4, '0')}` : '--';
    if (sync) sync.textContent = fresh ? (numericStatus === 6 ? 'ON' : 'OFF') : '확인 중';
  },

  _confirmRiskyCommand(title, { rid, endpoint, payload = '', warning = '' } = {}) {
    const lines = [
      `⚠ ${title}`,
      '',
      `대상 RID: ${rid || '--'}`,
      `ROS endpoint: ${endpoint || '--'}`
    ];
    if (payload) lines.push(`Payload: ${payload}`);
    if (warning) lines.push('', warning);
    lines.push('', '대상과 상태를 확인했습니까?');
    return typeof confirm === 'function' ? confirm(lines.join('\n')) : true;
  },

  _setupSliders() {
    const linSlider = document.getElementById('jog-linear-speed');
    const angSlider = document.getElementById('jog-angular-speed');
    const linVal = document.getElementById('jog-linear-speed-val');
    const angVal = document.getElementById('jog-angular-speed-val');

    linSlider.addEventListener('input', () => {
      linVal.textContent = parseFloat(linSlider.value).toFixed(2);
    });
    angSlider.addEventListener('input', () => {
      angVal.textContent = parseFloat(angSlider.value).toFixed(2);
    });
  },

  _setupButtons() {
    const btnMap = {
      'jog-fwd':       () => this._setVel(this._getLinearSpeed(), 0, 0),
      'jog-bwd':       () => this._setVel(-this._getLinearSpeed(), 0, 0),
      'jog-left':      () => {
        if (this._getDriveType() === 'qd') this._setVel(0, this._getLinearSpeed(), 0);
        else this._setVel(0, 0, this._getAngularSpeed());
      },
      'jog-right':     () => {
        if (this._getDriveType() === 'qd') this._setVel(0, -this._getLinearSpeed(), 0);
        else this._setVel(0, 0, -this._getAngularSpeed());
      },
      'jog-rot-left':  () => this._setVel(0, 0, this._getAngularSpeed()),
      'jog-rot-right': () => this._setVel(0, 0, -this._getAngularSpeed()),
      'jog-stop':      () => this._stopJogControls()
    };

    Object.entries(btnMap).forEach(([id, action]) => {
      const btn = document.getElementById(id);
      if (!btn) return;

      if (id === 'jog-stop') {
        btn.addEventListener('click', action);
        return;
      }

      // Hold to move, release to stop
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); action(); });
      btn.addEventListener('mouseup', () => this._stopVel());
      btn.addEventListener('mouseleave', () => this._stopVel());
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); action(); }, { passive: false });
      btn.addEventListener('touchend', () => this._stopVel());
      btn.addEventListener('touchcancel', () => this._stopVel());
    });

    // Motor reset service buttons
    const motorResetBtn = document.getElementById('jog-motor-reset');
    const liftMotorResetBtn = document.getElementById('jog-lift-motor-reset');
    if (motorResetBtn) motorResetBtn.addEventListener('click', () => this._callMotorReset('/motor_reset'));
    if (liftMotorResetBtn) liftMotorResetBtn.addEventListener('click', () => this._callMotorReset('/Lift/motor_reset'));

    const chargeOnBtn = document.getElementById('jog-charge-on');
    const chargeOffBtn = document.getElementById('jog-charge-off');
    if (chargeOnBtn) chargeOnBtn.addEventListener('click', () => this._setChargeRelay(true));
    if (chargeOffBtn) chargeOffBtn.addEventListener('click', () => this._setChargeRelay(false));

    const liftUpBtn = document.getElementById('jog-lift-up');
    const liftDownBtn = document.getElementById('jog-lift-down');
    this._bindManualLiftHoldButton(liftUpBtn, 'up');
    this._bindManualLiftHoldButton(liftDownBtn, 'down');
  },

  _setupChassisCommandButtons() {
    document.querySelectorAll('[data-chassis-command]').forEach(button => {
      const showHelp = () => this._showChassisCommandHelp(button.dataset.chassisCommand);
      button.addEventListener('mouseenter', showHelp);
      button.addEventListener('focus', showHelp);
      button.addEventListener('click', () => {
        this._callChassisCommand(button.dataset.chassisCommand, button);
      });
    });
    this._refreshChassisCommandHelp();
  },

  _chassisCommandServiceName() {
    const rid = RosManager.getRobotId(App.activeSlotIndex);
    return `/${rid || '{RID}'}/Conv/cmd`;
  },

  _formatChassisCommandHelp(command) {
    if (!command) return '';
    const request = JSON.stringify({
      cmds: [{ cmd_type: command.cmdType, count: command.count }]
    });
    return [
      command.description || command.label,
      `Service: ${this._chassisCommandServiceName()}`,
      'Type: syscon_msgs/conv_cmd',
      `Request: ${request}`
    ].join('\n');
  },

  _showChassisCommandHelp(commandKey) {
    const command = this._getSelectedChassisModel().commands?.[commandKey];
    const preview = document.getElementById('jog-model-io-command-preview');
    if (preview && command) preview.textContent = this._formatChassisCommandHelp(command);
  },

  _refreshChassisCommandHelp() {
    const model = this._getSelectedChassisModel();
    const buttons = Array.from(document.querySelectorAll('[data-chassis-command]'));
    buttons.forEach(button => {
      const command = model.commands?.[button.dataset.chassisCommand];
      const help = this._formatChassisCommandHelp(command);
      button.title = help;
      if (command) button.setAttribute('aria-label', `${command.label}. ${help.replace(/\n/g, ' ')}`);
    });

    const firstCommand = buttons
      .map(button => model.commands?.[button.dataset.chassisCommand])
      .find(Boolean);
    const preview = document.getElementById('jog-model-io-command-preview');
    if (preview) {
      preview.textContent = firstCommand
        ? '버튼에 마우스를 올리거나 포커스하면 설명과 서비스 명령을 확인할 수 있습니다.'
        : '선택한 차상에서 사용할 수 있는 명령이 없습니다.';
    }
  },

  async _callChassisCommand(commandKey, sourceButton = null) {
    const model = this._getSelectedChassisModel();
    const command = model.commands?.[commandKey];
    if (!command) {
      this._setChassisCommandStatus('error', `${model.label}에서 지원하지 않는 명령입니다.`);
      return;
    }
    this._showChassisCommandHelp(commandKey);

    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots?.[slotIndex];
    const ros = RosManager.getRos(slotIndex);
    const rid = RosManager.getRobotId(slotIndex);
    if (!slot?.connected || !ros || !rid) {
      this._setChassisCommandStatus('error', '활성 로봇이 연결되어 있지 않습니다.');
      return;
    }

    const serviceName = `/${rid}/Conv/cmd`;
    const buttons = Array.from(document.querySelectorAll('[data-chassis-command]'));
    this._stopVel();
    buttons.forEach(button => { button.disabled = true; });
    if (sourceButton) sourceButton.classList.add('active');
    this._setChassisCommandStatus(
      'running',
      `${rid} · ${command.label} (${command.cmdType},${command.count}) 명령 중...`
    );

    if (typeof TestMode !== 'undefined' && TestMode.enabled && slot.virtualTestRobot) {
      this._setChassisCommandStatus(
        'success',
        `${rid} · ${command.label} (${command.cmdType},${command.count}) Test Mode 실행 완료`
      );
      App.toast(`${rid} ${command.label} Test Mode 실행 완료`, 'success');
      App.addEvent?.(
        'action',
        `[TestMode] ${command.label}`,
        `${rid} · /${rid}/Conv/cmd · (${command.cmdType},${command.count})`,
        'success'
      );
      buttons.forEach(button => { button.disabled = false; });
      if (sourceButton) sourceButton.classList.remove('active');
      return;
    }

    try {
      const service = new ROSLIB.Service({
        ros,
        name: serviceName,
        serviceType: 'syscon_msgs/conv_cmd'
      });
      const request = new ROSLIB.ServiceRequest({
        cmds: [{ cmd_type: command.cmdType, count: command.count }]
      });
      const result = await new Promise((resolve, reject) => {
        service.callService(
          request,
          resolve,
          error => reject(new Error(String(error || `${serviceName} 호출 실패`)))
        );
      });
      if (result?.success === false) {
        throw new Error(`로봇 거부 (error_code=${result.error_code ?? '-'})`);
      }
      this._setChassisCommandStatus(
        'success',
        `${rid} · ${command.label} (${command.cmdType},${command.count}) 요청 완료`
      );
      App.toast(`${rid} ${command.label} 요청 완료`, 'success');
    } catch (error) {
      this._setChassisCommandStatus('error', `${command.label} 실패: ${error.message || error}`);
      App.toast(`${command.label} 실패: ${error.message || error}`, 'error');
    } finally {
      buttons.forEach(button => { button.disabled = false; });
      if (sourceButton) sourceButton.classList.remove('active');
    }
  },

  _setChassisCommandStatus(state, message) {
    const status = document.getElementById('jog-model-io-status');
    if (!status) return;
    status.className = `jog-model-io-status ${state || ''}`.trim();
    status.textContent = message;
  },

  _callMotorReset(serviceSuffix) {
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots?.[slotIndex];
    const ros = typeof RosManager.getRos === 'function'
      ? RosManager.getRos(slotIndex)
      : slot?.ros;
    if (!ros) {
      App.toast('ROS not connected', 'error');
      return;
    }
    const rid = RosManager.getRobotId(slotIndex);
    const serviceName = rid ? `/${rid}${serviceSuffix}` : serviceSuffix;

    if (!this._requireSafety('Motor Reset')) return;
    if (!this._confirmRiskyCommand('Motor Reset을 실행합니다.', {
      rid,
      endpoint: serviceName,
      payload: '{}',
      warning: '모터 드라이버가 재초기화되며 예상치 못한 상태 변화가 발생할 수 있습니다.'
    })) return;

    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      App.toast(`[TestMode] ${serviceName}: OK`, 'success');
      App.addEvent?.('action', '[TestMode] Motor reset', serviceName, 'success');
      return;
    }

    const service = new ROSLIB.Service({
      ros: ros,
      name: serviceName,
      serviceType: 'std_srvs/Trigger'
    });
    const request = new ROSLIB.ServiceRequest({});

    App.toast(`Calling ${serviceName}...`, 'info');
    service.callService(request, (result) => {
      App.toast(`${serviceName}: ${result.success ? 'OK' : 'Failed'} - ${result.message || ''}`, result.success ? 'success' : 'error');
    }, (error) => {
      App.toast(`${serviceName} failed: ${error}`, 'error');
    });
  },

  async _setChargeRelay(enabled) {
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots[slotIndex];
    const ros = RosManager.getRos(slotIndex);
    const rid = RosManager.getRobotId(slotIndex);
    if (!slot || !ros || !rid || !slot.connected) {
      App.toast('활성 로봇이 연결되어 있지 않습니다', 'error');
      return;
    }
    if (this._chargeCommandPending) return;
    if (enabled && !this._confirmRiskyCommand('충전을 ON으로 전환합니다.', {
      rid,
      endpoint: `/${rid}/io/charge_relay (runtime discovery)`,
      payload: '{ data: true }',
      warning: '실제 충전 릴레이가 동작할 수 있습니다. 정말 충전을 시작하시겠습니까?'
    })) return;

    const onBtn = document.getElementById('jog-charge-on');
    const offBtn = document.getElementById('jog-charge-off');
    this._chargeCommandPending = true;
    if (onBtn) onBtn.disabled = true;
    if (offBtn) offBtn.disabled = true;
    slot.chargeRelayCommand = enabled;
    slot.chargeRelayCommandAt = Date.now();
    slot.chargeRelayOn = null;
    slot.chargeRelayAssumed = false;
    this.updateChargeStatus(slot);

    try {
      if (typeof TestMode !== 'undefined' && TestMode.enabled && slot.virtualTestRobot) {
        TestMode.setActiveCharging(enabled);
        slot.chargeRelayOn = enabled;
        slot.chargeRelayAssumed = true;
        slot.chargeServiceName = '[TestMode] virtual charge relay';
        this.updateChargeStatus(slot);
        App.toast(`${rid} 충전 ${enabled ? 'ON' : 'OFF'} Test Mode 실행 완료`, 'success');
        return;
      }

      const serviceName = await this._resolveChargeService(ros, rid, slot);
      const result = await this._callSetBool(ros, serviceName, enabled);
      if (result && result.success === false) {
        throw new Error(result.message || '로봇이 명령을 거부했습니다');
      }
      slot.chargeRelayOn = enabled;
      slot.chargeRelayAssumed = true;
      slot.chargeServiceName = serviceName;
      App.toast(`${rid} 충전 ${enabled ? 'ON' : 'OFF'} 명령 완료`, 'success');
      this.updateChargeStatus(slot);
      if (this._chargeStatusTimer) clearTimeout(this._chargeStatusTimer);
      this._chargeStatusTimer = setTimeout(() => {
        if (App.robotSlots[App.activeSlotIndex] === slot) this.updateChargeStatus(slot);
      }, 8000);
    } catch (error) {
      slot.chargeRelayCommand = null;
      slot.chargeRelayOn = null;
      App.toast(`충전 명령 실패: ${error.message || error}`, 'error');
      this._setChargeProgress('error', `충전 명령 실패: ${error.message || error}`);
      this.updateChargeStatus(slot, true);
    } finally {
      this._chargeCommandPending = false;
      if (onBtn) onBtn.disabled = false;
      if (offBtn) offBtn.disabled = false;
    }
  },

  _chargeServiceCandidates(rid) {
    return [
      // New SPX software: use the same safety-aware relay service as the
      // docking/docking-out actions. The direct output remains a fallback.
      `/${rid}/io/set/auto_charge_relay`,
      `/${rid}/io/set/auto_charge`,
      `/${rid}/SUBCON_/charge_relay_cmd`,
      `/${rid}/device_manager/charge_relay_cmd`,
      `/${rid}/io/set/charge_relay`,
      `/${rid}/io/charge_relay`,
      `/${rid}/set_charging_switch`
    ];
  },

  _resolveChargeService(ros, rid, slot) {
    const candidates = this._chargeServiceCandidates(rid);
    return new Promise(resolve => {
      let settled = false;
      const done = services => {
        if (settled) return;
        settled = true;
        const list = Array.isArray(services) ? services : [];
        const exact = candidates.find(name => list.includes(name));
        const discovered = list.find(name =>
          name.startsWith(`/${rid}/`) && (
            name.endsWith('/io/set/auto_charge_relay')
            || name.endsWith('/io/set/auto_charge')
            || name.endsWith('/io/set/charge_relay')
            || name.endsWith('/charge_relay_cmd')
            || name.endsWith('/set_charging_switch')
          )
        );
        const cached = list.includes(slot.chargeServiceName) ? slot.chargeServiceName : null;
        const offlineFallback = list.length === 0 ? slot.chargeServiceName : null;
        resolve(exact || discovered || cached || offlineFallback || candidates[0]);
      };
      const timer = setTimeout(() => done([]), 1500);
      try {
        const service = new ROSLIB.Service({
          ros,
          name: '/rosapi/services',
          serviceType: 'rosapi/Services'
        });
        service.callService(new ROSLIB.ServiceRequest({}), result => {
          clearTimeout(timer);
          done(result?.services || []);
        }, () => {
          clearTimeout(timer);
          done([]);
        });
      } catch (error) {
        clearTimeout(timer);
        done([]);
      }
    });
  },

  _callSetBool(ros, serviceName, enabled) {
    return new Promise((resolve, reject) => {
      const service = new ROSLIB.Service({
        ros,
        name: serviceName,
        serviceType: 'std_srvs/SetBool'
      });
      service.callService(
        new ROSLIB.ServiceRequest({ data: enabled }),
        resolve,
        error => reject(new Error(String(error || `${serviceName} 호출 실패`)))
      );
    });
  },

  updateChargeStatus(slot, preserveError = false) {
    const relayEl = document.getElementById('jog-charge-relay-state');
    if (!relayEl) return;
    relayEl.className = '';
    if (!slot || !slot.connected) {
      relayEl.classList.add('unknown');
      relayEl.textContent = '로봇 미연결';
      if (!preserveError) this._setChargeProgress('idle', '활성 로봇 연결을 기다리는 중입니다.');
      return;
    }

    const relayOn = slot.chargeRelayOn;
    const pending = relayOn === null && typeof slot.chargeRelayCommand === 'boolean';
    if (pending) {
      relayEl.classList.add('pending');
      relayEl.textContent = `${slot.chargeRelayCommand ? 'ON' : 'OFF'} 명령 중`;
    } else if (relayOn === true) {
      relayEl.classList.add('on');
      relayEl.textContent = slot.chargeRelayAssumed ? 'ON (명령 응답)' : 'ON';
    } else if (relayOn === false) {
      relayEl.classList.add('off');
      relayEl.textContent = slot.chargeRelayAssumed ? 'OFF (명령 응답)' : 'OFF';
    } else {
      relayEl.classList.add('unknown');
      relayEl.textContent = '상태 확인 중';
    }

    if (preserveError) return;
    const current = Number(slot.bms?.current) || 0;
    const charging = Boolean(slot.bms?.charging) || current > 0.1;
    if (charging) {
      this._setChargeProgress('charging', `✓ 충전이 정상적으로 진행 중입니다. (${current.toFixed(1)} A)`);
      return;
    }
    if (relayOn === true || (pending && slot.chargeRelayCommand === true)) {
      const elapsed = Date.now() - (slot.chargeRelayCommandAt || Date.now());
      if (elapsed < 8000) {
        this._setChargeProgress('waiting', '충전 릴레이 ON · BMS 충전 전류 확인 중...');
      } else {
        this._setChargeProgress('error', '충전 릴레이는 ON이지만 충전 전류가 확인되지 않습니다.');
      }
      return;
    }
    this._setChargeProgress('idle', '충전이 꺼져 있습니다.');
  },

  _setChargeProgress(state, message) {
    const el = document.getElementById('jog-charge-progress');
    if (!el) return;
    el.className = `jog-charge-progress ${state}`;
    el.textContent = message;
  },

  _bindManualLiftHoldButton(button, direction) {
    if (!button) return;
    const start = event => {
      event.preventDefault();
      if (typeof button.setPointerCapture === 'function' && event.pointerId !== undefined) {
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture is only an extra guard; document-level release still stops the lift.
        }
      }
      this._startManualLift(direction, button, 'pointer');
    };
    const stop = event => {
      if (event) event.preventDefault();
      if (this._manualLiftState?.source === 'pointer') this._stopManualLift();
    };
    button.addEventListener('pointerdown', start);
    button.addEventListener('pointerup', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('lostpointercapture', stop);
    button.addEventListener('pointerleave', stop);
    button.addEventListener('contextmenu', event => event.preventDefault());
  },

  _startManualLift(direction, button = null, source = 'programmatic') {
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots?.[slotIndex];
    const ros = typeof RosManager.getRos === 'function'
      ? RosManager.getRos(slotIndex)
      : slot?.ros;
    const rid = typeof RosManager.getRobotId === 'function'
      ? RosManager.getRobotId(slotIndex)
      : slot?.robotId;
    const isUp = direction === 'up';
    const label = isUp ? '리프트 UP' : '리프트 DOWN';
    if (!this._requireSafety(label)) return false;
    const model = this._getSelectedChassisModel();
    if (!['lift', 'lift_service'].includes(model.controlProfile)) {
      this._setManualLiftStatus('error', '현재 차상 모델은 수동 리프트를 지원하지 않습니다.');
      return false;
    }
    if (!slot?.connected || !ros || !rid) {
      this._setManualLiftStatus('error', '활성 로봇이 연결되어 있지 않습니다.');
      return false;
    }
    if (typeof RobotCompatibility !== 'undefined'
        && !slot.compatibilityProfile?.discovered
        && !this._isStlUlsanSlot(slot)) {
      this._setManualLiftStatus('running', `${rid} · 리프트 인터페이스 확인 중 · 확인 후 다시 누르세요.`);
      RobotCompatibility.discover(slot).then(() => this._syncChassisModelUi(false));
      return false;
    }
    if (this._manualLiftState?.direction === direction
        && this._manualLiftState.ros === ros
        && this._manualLiftState.rid === rid) {
      return true;
    }

    this._stopManualLift();
    const upButton = document.getElementById('jog-lift-up');
    const downButton = document.getElementById('jog-lift-down');
    this._stopVel();
    const slotProfile = typeof RobotCompatibility !== 'undefined'
      ? RobotCompatibility.get(slot)
      : null;
    const useService = model.controlProfile === 'lift_service'
      || slotProfile?.lift?.interface === 'service';
    const liftConfig = useService
      ? (slotProfile?.lift || {
        interface: 'service',
        service: `/${rid}/Lift/cmd`,
        serviceType: 'syscon_msgs/lift_cmd',
        cancelService: `/${rid}/Lift/cancel`,
        cancelType: 'syscon_msgs/string_srv',
        cancelArgs: { data: '' },
        commands: { stop: 0, up: 1, down: 2 }
      })
      : (slotProfile?.lift || {
        interface: 'topic',
        topic: `/${rid}/Lift/manual_cmd`,
        topicType: 'std_msgs/Int8',
        commands: { stop: 0, up: 1, down: -1 }
      });
    const transport = useService
      ? new ROSLIB.Service({
        ros,
        name: liftConfig.service || `/${rid}/Lift/cmd`,
        serviceType: liftConfig.serviceType || 'syscon_msgs/lift_cmd'
      })
      : new ROSLIB.Topic({
        ros,
        name: liftConfig.topic || `/${rid}/Lift/manual_cmd`,
        messageType: liftConfig.topicType || 'std_msgs/Int8'
      });
    const cancelTransport = useService && liftConfig.cancelService
      ? new ROSLIB.Service({
        ros,
        name: liftConfig.cancelService,
        serviceType: liftConfig.cancelType || 'syscon_msgs/string_srv'
      })
      : null;
    this._manualLiftState = {
      direction,
      value: isUp ? liftConfig.commands.up : liftConfig.commands.down,
      stopValue: liftConfig.commands.stop,
      label,
      rid,
      ros,
      interface: useService ? 'service' : 'topic',
      transport,
      cancelTransport,
      cancelArgs: liftConfig.cancelArgs || { data: '' },
      button,
      source
    };
    if (upButton) upButton.setAttribute('aria-pressed', String(isUp));
    if (downButton) downButton.setAttribute('aria-pressed', String(!isUp));
    if (button) button.classList.add('active');
    if (!this._publishManualLiftCommand(this._manualLiftState.value, this._manualLiftState)) {
      this._manualLiftState = null;
      [upButton, downButton].forEach(control => {
        if (!control) return;
        control.classList.remove('active');
        control.setAttribute('aria-pressed', 'false');
      });
      this._setManualLiftStatus('error', `${rid} · ${label} 명령 전송 실패`);
      return false;
    }
    if (!useService) {
      this._manualLiftPubInterval = setInterval(() => {
        if (this._manualLiftState) {
          this._publishManualLiftCommand(this._manualLiftState.value, this._manualLiftState);
        }
      }, this.MANUAL_LIFT_PUB_RATE);
    }
    this._setManualLiftStatus('running', `${rid} · ${label} 동작 중 · 떼면 정지`);
    return true;
  },

  // 이전 내부 호출과의 호환을 유지하되, 이제는 hold 시작 동작만 수행한다.
  _runManualLift(direction, button) {
    return this._startManualLift(direction, button);
  },

  _publishManualLiftCommand(value, state = this._manualLiftState) {
    if (!state?.transport) return false;
    try {
      if (state.interface === 'service') {
        const stopping = value === state.stopValue && state.cancelTransport;
        const service = stopping ? state.cancelTransport : state.transport;
        const request = stopping
          ? new ROSLIB.ServiceRequest(state.cancelArgs || { data: '' })
          : new ROSLIB.ServiceRequest({ mode: value, height: 0 });
        service.callService(
          request,
          result => {
            if (result?.success === false) {
              const message = `${state.rid} · 리프트 명령 거부 (err_code=${result.err_code ?? '-'})`;
              this._setManualLiftStatus('error', message);
              App.toast(message, 'error');
            }
          },
          error => {
            const message = `${state.rid} · 리프트 서비스 실패: ${error || 'unknown error'}`;
            this._setManualLiftStatus('error', message);
            App.toast(message, 'error');
          }
        );
      } else {
        state.transport.publish(new ROSLIB.Message({ data: value }));
      }
      return true;
    } catch (error) {
      console.warn(`수동 리프트 명령 전송 실패 (${state.rid}):`, error.message || error);
      return false;
    }
  },

  _stopManualLift() {
    const state = this._manualLiftState;
    if (this._manualLiftPubInterval) {
      clearInterval(this._manualLiftPubInterval);
      this._manualLiftPubInterval = null;
    }
    this._manualLiftHeldKey = null;
    if (!state) return false;

    // 활성 로봇이 바뀐 경우에도 동작을 시작한 기존 로봇의 topic으로 STOP을 보낸다.
    const stopSent = this._publishManualLiftCommand(state.stopValue ?? 0, state);
    this._manualLiftState = null;
    const upButton = document.getElementById('jog-lift-up');
    const downButton = document.getElementById('jog-lift-down');
    [upButton, downButton].forEach(button => {
      if (!button) return;
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    });
    this._setManualLiftStatus(
      stopSent ? 'success' : 'error',
      stopSent ? `${state.rid} · 리프트 정지` : `${state.rid} · 정지 명령 전송 실패`
    );
    return stopSent;
  },

  _setManualLiftStatus(state, message) {
    const status = document.getElementById('jog-manual-lift-status');
    if (!status) return;
    status.className = `jog-manual-lift-status ${state || ''}`.trim();
    status.textContent = message;
  },

  _setupStlUlsanControls() {
    document.querySelectorAll('[data-turntable-target]').forEach(button => {
      button.addEventListener('click', () => {
        this._runStlTurntableTarget(Number(button.dataset.turntableTarget), button);
      });
    });
    document.getElementById('jog-turntable-go')?.addEventListener('click', event => {
      const input = document.getElementById('jog-turntable-target');
      this._runStlTurntableTarget(Number(input?.value), event.currentTarget);
    });
    document.getElementById('jog-turntable-cancel')?.addEventListener('click', event => {
      this._cancelStlTurntable(event.currentTarget);
    });
    document.getElementById('jog-turntable-sync-on')?.addEventListener('click', event => {
      this._setTurntableSync(true, event.currentTarget);
    });
    document.getElementById('jog-turntable-sync-off')?.addEventListener('click', event => {
      this._setTurntableSync(false, event.currentTarget);
    });
  },

  async _runStlTurntableTarget(target, button = null) {
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots?.[slotIndex];
    if (!this._isStlUlsanSlot(slot)) {
      this._setStlTurntableStatus('error', 'stl_ulsan ROBOT_MODEL에서만 사용할 수 있습니다.');
      return false;
    }
    if (!slot?.connected || !slot.ros) {
      this._setStlTurntableStatus('error', '활성 로봇이 연결되어 있지 않습니다.');
      return false;
    }
    if (!Number.isFinite(target) || target < -180 || target > 180) {
      this._setStlTurntableStatus('error', '목표 각도는 -180°~180°로 입력하세요.');
      return false;
    }
    if (this._stlTurntableTaskPending) return false;
    if (typeof ActionSender === 'undefined' || !ActionSender.sendJogActionToSlot) {
      this._setStlTurntableStatus('error', 'Task 입력 기능을 사용할 수 없습니다.');
      return false;
    }
    if (!this._requireSafety('Turntable 이동')) return false;
    const rid = RosManager.getRobotId(slotIndex) || slot.robotId;
    const profile = typeof RobotCompatibility !== 'undefined' ? RobotCompatibility.get(slot) : null;
    if (!this._confirmRiskyCommand('Turntable을 이동합니다.', {
      rid,
      endpoint: profile?.task?.goalName || `/${rid}/TARU/goal`,
      payload: `action_type=0x22, action_args=[3, ${target}, 0]`,
      warning: '턴테이블 회전 반경에 사람과 적재물이 없는지 확인하세요.'
    })) return false;

    this._stopVel();
    this._stopManualLift();
    this._stlTurntableTaskPending = true;
    if (button) button.disabled = true;
    this._setStlTurntableStatus('running', `${slot.robotId} · ${target}° Task 입력 중...`);
    try {
      await ActionSender.sendJogActionToSlot(
        slotIndex,
        0x22,
        [3, target, 0],
        `easyloop_turntable_${Date.now()}`
      );
      this._setStlTurntableStatus('success', `${slot.robotId} · ${target}° Turntable 실행 요청 완료`);
      App.toast(`${slot.robotId} Turntable ${target}° 실행`, 'success');
      return true;
    } catch (error) {
      this._setStlTurntableStatus('error', `Turntable 실행 실패: ${error.message || error}`);
      App.toast(`Turntable 실행 실패: ${error.message || error}`, 'error');
      return false;
    } finally {
      this._stlTurntableTaskPending = false;
      if (button) button.disabled = false;
    }
  },

  async _cancelStlTurntable(button = null) {
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots?.[slotIndex];
    if (!this._isStlUlsanSlot(slot)) {
      this._setStlTurntableStatus('error', 'stl_ulsan ROBOT_MODEL에서만 사용할 수 있습니다.');
      return false;
    }
    if (!slot?.connected || !slot.ros || typeof ActionSender === 'undefined') {
      this._setStlTurntableStatus('error', '활성 로봇의 Task 취소 기능을 사용할 수 없습니다.');
      return false;
    }

    this._stopVel();
    this._stopManualLift();
    if (button) button.disabled = true;
    this._setStlTurntableStatus('running', `${slot.robotId} · TARU Task 취소 요청 중...`);
    try {
      await ActionSender.cancelTaskOnSlot(slotIndex);
      this._setStlTurntableStatus('success', `${slot.robotId} · Turntable Task 취소 요청 완료`);
      App.toast(`${slot.robotId} Turntable Task 취소`, 'success');
      return true;
    } catch (error) {
      this._setStlTurntableStatus('error', `Task 취소 실패: ${error.message || error}`);
      App.toast(`Turntable Task 취소 실패: ${error.message || error}`, 'error');
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  },

  async _setTurntableSync(enabled, button = null) {
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots?.[slotIndex];
    const ros = typeof RosManager.getRos === 'function' ? RosManager.getRos(slotIndex) : slot?.ros;
    const rid = typeof RosManager.getRobotId === 'function' ? RosManager.getRobotId(slotIndex) : slot?.robotId;
    if (!this._isStlUlsanSlot(slot) || !slot?.connected || !ros || !rid) {
      this._setStlTurntableStatus('error', '연결된 stl_ulsan 로봇에서만 Sync를 변경할 수 있습니다.');
      return false;
    }
    // Sync OFF is a risk-reducing command and must remain available during a safety stop.
    if (enabled && !this._requireSafety('Turntable Sync ON')) return false;
    const profile = typeof RobotCompatibility !== 'undefined' ? RobotCompatibility.get(slot) : null;
    const serviceName = profile?.actions?.turntable?.syncService || `/${rid}/Turntable/sync_mode`;
    const serviceType = profile?.actions?.turntable?.syncType || 'std_srvs/SetBool';
    if (!this._confirmRiskyCommand(`Turntable Sync를 ${enabled ? 'ON' : 'OFF'}으로 전환합니다.`, {
      rid,
      endpoint: serviceName,
      payload: `{ data: ${enabled} }`,
      warning: enabled
        ? 'Sync ON은 Turntable 추종 제어를 활성화합니다.'
        : 'Sync OFF는 Turntable 추종 제어를 해제합니다.'
    })) return false;

    if (button) button.disabled = true;
    this._stopVel();
    this._stopManualLift();
    this._setStlTurntableStatus('running', `${rid} · Sync ${enabled ? 'ON' : 'OFF'} 요청 중...`);
    try {
      const result = await new Promise((resolve, reject) => {
        const service = new ROSLIB.Service({ ros, name: serviceName, serviceType });
        service.callService(
          new ROSLIB.ServiceRequest({ data: enabled }),
          resolve,
          error => reject(new Error(String(error || `${serviceName} 호출 실패`)))
        );
      });
      if (result?.success === false) throw new Error(result.message || '로봇이 Sync 변경을 거부했습니다.');
      this._setStlTurntableStatus('success', `${rid} · Sync ${enabled ? 'ON' : 'OFF'} 요청 완료 · feedback 확인 중`);
      App.toast(`${rid} Turntable Sync ${enabled ? 'ON' : 'OFF'}`, 'success');
      return true;
    } catch (error) {
      this._setStlTurntableStatus('error', `Sync 변경 실패: ${error.message || error}`);
      App.toast(`Turntable Sync 변경 실패: ${error.message || error}`, 'error');
      return false;
    } finally {
      if (button) button.disabled = false;
      this._refreshSafetyUi();
    }
  },

  _setStlTurntableStatus(state, message) {
    const status = document.getElementById('jog-turntable-status');
    if (!status) return;
    status.className = `jog-turntable-status ${state || ''}`.trim();
    status.textContent = message;
  },

  _setupQuickTasks() {
    const container = document.getElementById('jog-quick-task-list');
    if (!container) return;
    this._quickTaskConfigs = this._loadQuickTaskConfigs();
    container.innerHTML = '';

    for (let index = 0; index < this.QUICK_TASK_COUNT; index += 1) {
      const row = document.createElement('div');
      row.className = 'jog-quick-task-row';
      row.dataset.index = String(index);
      row.innerHTML = `
        <span class="jog-quick-task-index">${index + 1}</span>
        <input class="jog-quick-task-name" type="text" maxlength="40"
               aria-label="Quick Task ${index + 1} 이름" placeholder="이름">
        <select class="jog-quick-task-select" aria-label="Quick Task ${index + 1} Task 선택"></select>
        <button class="btn btn-small btn-primary jog-quick-task-run" type="button">실행</button>
      `;
      container.appendChild(row);

      const nameInput = row.querySelector('.jog-quick-task-name');
      const taskSelect = row.querySelector('.jog-quick-task-select');
      const runButton = row.querySelector('.jog-quick-task-run');
      nameInput.value = this._quickTaskConfigs[index].displayName || '';

      taskSelect.addEventListener('change', () => {
        const previousTask = this._quickTaskConfigs[index].taskName;
        const currentName = nameInput.value.trim();
        this._quickTaskConfigs[index].taskName = taskSelect.value;
        if (!currentName || currentName === previousTask) {
          nameInput.value = taskSelect.value;
          this._quickTaskConfigs[index].displayName = taskSelect.value;
        }
        this._saveQuickTaskConfigs();
      });
      nameInput.addEventListener('change', () => {
        this._quickTaskConfigs[index].displayName = nameInput.value.trim();
        this._saveQuickTaskConfigs();
      });
      runButton.addEventListener('click', () => this._runQuickTask(index, runButton));
    }

    this.refreshQuickTaskOptions();
    this._updateQuickTaskTarget();
    document.addEventListener('amr:active-robot-changed', () => this._updateQuickTaskTarget());
  },

  _loadQuickTaskConfigs() {
    let saved = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(this.QUICK_TASK_STORAGE_KEY));
      if (Array.isArray(parsed)) saved = parsed;
    } catch (error) {
      saved = [];
    }
    return Array.from({ length: this.QUICK_TASK_COUNT }, (_, index) => ({
      taskName: typeof saved[index]?.taskName === 'string' ? saved[index].taskName : '',
      displayName: typeof saved[index]?.displayName === 'string' ? saved[index].displayName : ''
    }));
  },

  _saveQuickTaskConfigs() {
    try {
      localStorage.setItem(this.QUICK_TASK_STORAGE_KEY, JSON.stringify(this._quickTaskConfigs));
    } catch (error) {
      console.warn('Quick Task 설정 저장 실패:', error.message);
    }
  },

  refreshQuickTaskOptions() {
    const rows = document.querySelectorAll('.jog-quick-task-row');
    if (!rows.length || typeof ActionSender === 'undefined') return;
    const taskNames = ActionSender.getSavedQueueNames();

    rows.forEach((row, index) => {
      const select = row.querySelector('.jog-quick-task-select');
      if (!select) return;
      const configured = this._quickTaskConfigs[index]?.taskName || '';
      select.innerHTML = '';

      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '-- Task 선택 --';
      select.appendChild(empty);

      if (configured && !taskNames.includes(configured)) {
        const missing = document.createElement('option');
        missing.value = configured;
        missing.textContent = `${configured} (없음)`;
        missing.disabled = true;
        select.appendChild(missing);
      }
      taskNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      });
      select.value = taskNames.includes(configured) ? configured : '';
    });
  },

  _updateQuickTaskTarget() {
    const target = document.getElementById('jog-quick-task-target');
    const slot = App.robotSlots?.[App.activeSlotIndex];
    const text = slot?.connected ? `활성 로봇: ${slot.robotId}` : '활성 로봇: 미연결';
    if (target) target.textContent = text;
    const liftTarget = document.getElementById('jog-manual-lift-target');
    if (liftTarget) liftTarget.textContent = text;
    const stlTarget = document.getElementById('jog-stl-ulsan-target');
    if (stlTarget) {
      stlTarget.textContent = slot?.robotModel
        ? `${slot.robotId} · ${slot.robotModel}`
        : 'ROBOT_MODEL 확인 중';
    }
    const modelIoTarget = document.getElementById('jog-model-io-target');
    if (modelIoTarget) modelIoTarget.textContent = text;
  },

  async _runQuickTask(index, button) {
    const row = document.querySelector(`.jog-quick-task-row[data-index="${index}"]`);
    const taskName = row?.querySelector('.jog-quick-task-select')?.value || '';
    const displayName = row?.querySelector('.jog-quick-task-name')?.value.trim() || taskName;
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots?.[slotIndex];

    if (!taskName) {
      this._setQuickTaskStatus('error', `Quick Task ${index + 1}에 Task를 지정하세요.`);
      return;
    }
    if (!slot?.connected || !slot.ros) {
      this._setQuickTaskStatus('error', '활성 로봇이 연결되어 있지 않습니다.');
      return;
    }
    if (!this._requireSafety(`Quick Task ${index + 1}`)) return;
    const rid = RosManager.getRobotId(slotIndex) || slot.robotId;
    const profile = typeof RobotCompatibility !== 'undefined' ? RobotCompatibility.get(slot) : null;
    if (!this._confirmRiskyCommand('Quick Task를 실행합니다.', {
      rid,
      endpoint: profile?.task?.goalName || `/${rid}/TARU/goal`,
      payload: `saved task: ${taskName}`,
      warning: '저장된 Task가 로봇과 차상을 실제로 동작시킬 수 있습니다.'
    })) return;

    this._quickTaskConfigs[index] = { taskName, displayName };
    this._saveQuickTaskConfigs();
    this._stopVel();
    button.disabled = true;
    this._setQuickTaskStatus('running', `${slot.robotId}에 "${displayName}" 전송 중...`);
    try {
      await ActionSender.sendSavedQueueToSlot(taskName, slotIndex, 1, displayName);
      this._setQuickTaskStatus('success', `${slot.robotId} · "${displayName}" 실행 요청 완료`);
      App.toast(`${slot.robotId} Quick Task 실행: ${displayName}`, 'success');
    } catch (error) {
      this._setQuickTaskStatus('error', `실행 실패: ${error.message || error}`);
      App.toast(`Quick Task 실패: ${error.message || error}`, 'error');
    } finally {
      button.disabled = false;
    }
  },

  _setQuickTaskStatus(state, message) {
    const status = document.getElementById('jog-quick-task-status');
    if (!status) return;
    status.className = `jog-quick-task-status ${state || ''}`.trim();
    status.textContent = message;
  },

  _setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Jog owns its shortcuts while the panel is open. Other capture handlers
      // (including Quick Task) use the same ownership check and yield first.
      if (!this._ownsKeyboardEvent(e)) return;

      const key = this._normalizeKeyboardKey(e.key);
      const normalizedKey = key;
      if (normalizedKey === 'r' || normalizedKey === 'v' || normalizedKey === 't') {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        if (e.repeat) return;
        if (normalizedKey === 'r') {
          const input = document.getElementById('jog-turntable-target');
          this._runStlTurntableTarget(Number(input?.value));
        } else if (normalizedKey === 'v') {
          this._cancelStlTurntable();
        } else {
          const syncOn = Number(this._turntableFeedback?.status) === 6;
          this._setTurntableSync(!syncOn);
        }
        return;
      }
      if (normalizedKey === 'o' || normalizedKey === 'f') {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        if (!e.repeat) this._setChargeRelay(normalizedKey === 'o');
        return;
      }
      if (normalizedKey === 'z' || normalizedKey === 'c') {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        if (e.repeat || this._manualLiftHeldKey || this._manualLiftState) return;
        const direction = normalizedKey === 'z' ? 'up' : 'down';
        const button = document.getElementById(direction === 'up' ? 'jog-lift-up' : 'jog-lift-down');
        if (this._startManualLift(direction, button, 'keyboard')) this._manualLiftHeldKey = normalizedKey;
        return;
      }
      if (this._activeKeys.has(key)) return; // already held
      this._activeKeys.add(key);

      const jogKeys = ['ArrowUp','w','ArrowDown','x','ArrowLeft','a','ArrowRight','d','q','e'];
      if (jogKeys.includes(key)) {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        this._stopManualLift();
        this._updateFromKeys();
      } else if (key === 's' || key === ' ') {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        this._stopJogControls();
      }
    }, true);

    document.addEventListener('keyup', (e) => {
      const normalizedKey = this._normalizeKeyboardKey(e.key);
      if (normalizedKey === this._manualLiftHeldKey) {
        e.preventDefault();
        this._stopManualLift();
        return;
      }
      this._activeKeys.delete(normalizedKey);
      if (!this._isPanelOpen()) return;
      this._updateFromKeys();
    });

    document.addEventListener('pointerup', () => {
      if (this._manualLiftState?.source === 'pointer') this._stopManualLift();
    });
    document.addEventListener('pointercancel', () => {
      if (this._manualLiftState?.source === 'pointer') this._stopManualLift();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._stopJogControls();
    });
    document.addEventListener('amr:active-robot-changed', () => {
      this._stopJogControls();
      if (this._isPanelOpen()) this._startTelemetry();
      else this._stopTelemetry();
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', () => this._stopJogControls());
      window.addEventListener('pagehide', () => this._stopJogControls());
    }
  },

  _updateFromKeys() {
    let lx = 0, ly = 0, az = 0;
    const linSpd = this._getLinearSpeed();
    const angSpd = this._getAngularSpeed();
    const isQD = this._getDriveType() === 'qd';

    if (this._activeKeys.has('ArrowUp') || this._activeKeys.has('w')) lx += linSpd;
    if (this._activeKeys.has('ArrowDown') || this._activeKeys.has('x')) lx -= linSpd;

    if (isQD) {
      // QD: a/d = strafe (linear.y), q/e = rotate
      if (this._activeKeys.has('ArrowLeft') || this._activeKeys.has('a')) ly += linSpd;
      if (this._activeKeys.has('ArrowRight') || this._activeKeys.has('d')) ly -= linSpd;
      if (this._activeKeys.has('q')) az += angSpd;
      if (this._activeKeys.has('e')) az -= angSpd;
    } else {
      // DD: a/d = rotate
      if (this._activeKeys.has('ArrowLeft') || this._activeKeys.has('a')) az += angSpd;
      if (this._activeKeys.has('ArrowRight') || this._activeKeys.has('d')) az -= angSpd;
    }

    if (lx === 0 && ly === 0 && az === 0) {
      this._stopVel();
    } else {
      this._setVel(lx, ly, az);
    }
  },

  _setVel(lx, ly, az) {
    if (!this._requireSafety('주행 Jog')) return false;
    this._stopManualLift();
    this._currentLx = lx;
    this._currentLy = ly || 0;
    this._currentAz = az;
    this._updateDisplay();
    this._startPublishing();
    return true;
  },

  _stopVel() {
    this._currentLx = 0;
    this._currentLy = 0;
    this._currentAz = 0;
    this._activeKeys.clear();
    this._updateDisplay();
    this._publishOnce();
    this._stopPublishing();
  },

  _stopJogControls() {
    this._stopVel();
    this._stopManualLift();
  },

  _updateDisplay() {
    document.getElementById('jog-cur-lx').textContent = this._currentLx.toFixed(2);
    const lyEl = document.getElementById('jog-cur-ly');
    if (lyEl) lyEl.textContent = this._currentLy.toFixed(2);
    document.getElementById('jog-cur-az').textContent = this._currentAz.toFixed(2);
    document.getElementById('jog-pub-status').textContent = this._publishing ? 'On' : 'Off';
    this._renderVelocityComparison();

    ['jog-fwd', 'jog-bwd', 'jog-left', 'jog-right', 'jog-rot-left', 'jog-rot-right'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
    if (this._currentLx > 0) document.getElementById('jog-fwd').classList.add('active');
    if (this._currentLx < 0) document.getElementById('jog-bwd').classList.add('active');
    if (this._getDriveType() === 'qd') {
      if (this._currentLy > 0) document.getElementById('jog-left').classList.add('active');
      if (this._currentLy < 0) document.getElementById('jog-right').classList.add('active');
      const rl = document.getElementById('jog-rot-left');
      const rr = document.getElementById('jog-rot-right');
      if (this._currentAz > 0 && rl) rl.classList.add('active');
      if (this._currentAz < 0 && rr) rr.classList.add('active');
    } else {
      if (this._currentAz > 0) document.getElementById('jog-left').classList.add('active');
      if (this._currentAz < 0) document.getElementById('jog-right').classList.add('active');
    }
  },

  _getTopic() {
    const slotIndex = App.activeSlotIndex;
    const ros = RosManager.getRos(slotIndex);
    if (!ros) return null;

    const topicName = this._getTopicName();
    // Reuse or create topic
    if (!this._cmdVelTopic || this._cmdVelTopic.name !== topicName || this._cmdVelTopic.ros !== ros) {
      this._cmdVelTopic = new ROSLIB.Topic({
        ros: ros,
        name: topicName,
        messageType: 'geometry_msgs/Twist'
      });
    }
    return this._cmdVelTopic;
  },

  _publishOnce() {
    const topic = this._getTopic();
    if (!topic) return;

    const twist = new ROSLIB.Message({
      linear: { x: this._currentLx, y: this._currentLy, z: 0 },
      angular: { x: 0, y: 0, z: this._currentAz }
    });
    topic.publish(twist);
  },

  _startPublishing() {
    if (this._publishing) return;
    this._publishing = true;
    this._updateDisplay();

    this._pubInterval = setInterval(() => {
      this._publishOnce();
    }, this.PUB_RATE);
  },

  _stopPublishing() {
    if (!this._publishing) return;
    this._publishing = false;
    this._updateDisplay();

    if (this._pubInterval) {
      clearInterval(this._pubInterval);
      this._pubInterval = null;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  JogControl.init();
});
