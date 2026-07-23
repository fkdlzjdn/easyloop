// Jog Control - Publish cmd_vel for manual robot movement (floating panel)
const JogControl = {
  _pubInterval: null,
  _currentLx: 0,
  _currentLy: 0,  // QD strafe
  _currentAz: 0,
  _publishing: false,
  _cmdVelTopic: null,
  _activeKeys: new Set(),
  _chargeStatusTimer: null,
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
      id: 'sr3_ls_1st',
      label: 'sr3_ls_1st',
      driveType: 'dd',
      controlProfile: 'sr3_ls_1st_conveyor',
      commands: {
        frontDoorOpen: { label: '전방 도어 OPEN', cmdType: 144, count: 1 },
        frontDoorClose: { label: '전방 도어 CLOSE', cmdType: 145, count: 1 },
        rearDoorOpen: { label: '후방 도어 OPEN', cmdType: 146, count: 1 },
        rearDoorClose: { label: '후방 도어 CLOSE', cmdType: 147, count: 1 },
        frontDischarge: { label: '컨베이어 전방 배출', cmdType: 3, count: 1 },
        rearDischarge: { label: '컨베이어 후방 배출', cmdType: 6, count: 1 }
      }
    }
  ],
  PUB_RATE: 100,

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
    const selectedId = this._chassisSelections[this._activeChassisKey()] || this.DEFAULT_CHASSIS_MODEL;
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
  },

  _setChassisModel(modelId) {
    const model = this.CHASSIS_MODELS.find(entry => entry.id === modelId);
    if (!model) return;
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
    const modelIoControl = document.getElementById('jog-model-io-control');
    const isSr3Conveyor = model.controlProfile === 'sr3_ls_1st_conveyor';
    if (liftControl) liftControl.hidden = isSr3Conveyor;
    if (modelIoControl) modelIoControl.hidden = !isSr3Conveyor;
    this._applyDriveType(model.driveType, stop);
    this._updateQuickTaskTarget();
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
    this._stopVel();
  },

  _isPanelOpen() {
    const panel = document.getElementById('jog-panel');
    return panel && panel.style.display !== 'none';
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
      'jog-stop':      () => this._stopVel()
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
    if (liftUpBtn) liftUpBtn.addEventListener('click', () => this._runManualLift('up', liftUpBtn));
    if (liftDownBtn) liftDownBtn.addEventListener('click', () => this._runManualLift('down', liftDownBtn));
  },

  _setupChassisCommandButtons() {
    document.querySelectorAll('[data-chassis-command]').forEach(button => {
      button.addEventListener('click', () => {
        this._callChassisCommand(button.dataset.chassisCommand, button);
      });
    });
  },

  async _callChassisCommand(commandKey, sourceButton = null) {
    const model = this._getSelectedChassisModel();
    const command = model.commands?.[commandKey];
    if (!command) {
      this._setChassisCommandStatus('error', `${model.label}에서 지원하지 않는 명령입니다.`);
      return;
    }

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
    this._setChassisCommandStatus('running', `${rid} · ${command.label} 명령 중...`);

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
      this._setChassisCommandStatus('success', `${rid} · ${command.label} 요청 완료`);
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
    const ros = RosManager.ros;
    if (!ros) {
      App.toast('ROS not connected', 'error');
      return;
    }
    const slotIndex = App.activeSlotIndex;
    const rid = RosManager.getRobotId(slotIndex);
    const serviceName = rid ? `/${rid}${serviceSuffix}` : serviceSuffix;

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
    if (enabled && !confirm(`${rid} 충전 릴레이를 ON 하시겠습니까?`)) return;

    const onBtn = document.getElementById('jog-charge-on');
    const offBtn = document.getElementById('jog-charge-off');
    if (onBtn) onBtn.disabled = true;
    if (offBtn) offBtn.disabled = true;
    slot.chargeRelayCommand = enabled;
    slot.chargeRelayCommandAt = Date.now();
    slot.chargeRelayOn = null;
    slot.chargeRelayAssumed = false;
    this.updateChargeStatus(slot);

    try {
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

  async _runManualLift(direction, button) {
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots?.[slotIndex];
    const isUp = direction === 'up';
    const taskName = isUp ? '기본 - 리프트 업' : '기본 - 리프트 다운';
    const label = isUp ? '리프트 UP' : '리프트 DOWN';
    if (!slot?.connected || !slot.ros) {
      this._setManualLiftStatus('error', '활성 로봇이 연결되어 있지 않습니다.');
      return;
    }
    if (typeof ActionSender === 'undefined' || !ActionSender.getSavedQueues()[taskName]) {
      this._setManualLiftStatus('error', `${taskName} Task를 찾을 수 없습니다.`);
      return;
    }

    const upButton = document.getElementById('jog-lift-up');
    const downButton = document.getElementById('jog-lift-down');
    this._stopVel();
    if (upButton) upButton.disabled = true;
    if (downButton) downButton.disabled = true;
    if (button) button.classList.add('active');
    this._setManualLiftStatus('running', `${slot.robotId} · ${label} 명령 중...`);
    try {
      await ActionSender.sendSavedQueueToSlot(taskName, slotIndex, 1, `Manual_${isUp ? 'LiftUp' : 'LiftDown'}`);
      this._setManualLiftStatus('success', `${slot.robotId} · ${label} 요청 완료`);
      App.toast(`${slot.robotId} ${label} 요청 완료`, 'success');
    } catch (error) {
      this._setManualLiftStatus('error', `${label} 실패: ${error.message || error}`);
      App.toast(`${label} 실패: ${error.message || error}`, 'error');
    } finally {
      if (upButton) upButton.disabled = false;
      if (downButton) downButton.disabled = false;
      if (button) button.classList.remove('active');
    }
  },

  _setManualLiftStatus(state, message) {
    const status = document.getElementById('jog-manual-lift-status');
    if (!status) return;
    status.className = `jog-manual-lift-status ${state || ''}`.trim();
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
      // Only respond when Jog panel is open and no input is focused
      if (!this._isPanelOpen()) return;
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT')) return;

      const key = e.key;
      if (this._activeKeys.has(key)) return; // already held
      this._activeKeys.add(key);

      const jogKeys = ['ArrowUp','w','ArrowDown','x','ArrowLeft','a','ArrowRight','d','q','e'];
      if (jogKeys.includes(key)) {
        e.preventDefault();
        this._updateFromKeys();
      } else if (key === 's' || key === ' ') {
        e.preventDefault();
        this._stopVel();
      }
    });

    document.addEventListener('keyup', (e) => {
      this._activeKeys.delete(e.key);
      if (!this._isPanelOpen()) return;
      this._updateFromKeys();
    });
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
    this._currentLx = lx;
    this._currentLy = ly || 0;
    this._currentAz = az;
    this._updateDisplay();
    this._startPublishing();
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

  _updateDisplay() {
    document.getElementById('jog-cur-lx').textContent = this._currentLx.toFixed(2);
    const lyEl = document.getElementById('jog-cur-ly');
    if (lyEl) lyEl.textContent = this._currentLy.toFixed(2);
    document.getElementById('jog-cur-az').textContent = this._currentAz.toFixed(2);
    document.getElementById('jog-pub-status').textContent = this._publishing ? 'On' : 'Off';

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
