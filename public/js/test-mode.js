/* global DriveSimulationLab */
/* exported TestMode */
// Test Mode - publish simulated ROS data via rosbridge (no mocking layer)
// eslint-disable-next-line no-unused-vars -- classic-script global consumed by multiple UI modules
const TestMode = {
  enabled: false,
  publishers: {},
  timers: [],
  tick: 0,
  dockTimers: [],
  createdSlotIndex: null,
  originalSlot: null,
  MAX_VIRTUAL_ROBOTS: 3,
  ROSBRIDGE_PORT: 19090,
  DRIVE_MODEL_STORAGE_KEY: 'easyloopTestDriveModel',
  virtualRobots: new Map(),
  publisherSets: new Map(),
  originalFleet: null,
  originalActiveSlotIndex: -1,
  _fleetSimulationTimer: null,
  _fleetRenderTick: 0,
  _publishRos: null, // Separate ROS connection for publishing
  _starting: false,
  _startupAttempt: 0,
  _startupTimeoutId: null,
  _lastStartError: '',
  _lastFailure: null,
  _startupStage: '',
  STARTUP_TIMEOUT_MS: 45000,
  _workState: 0, // Current simulated work state (0=IDLE by default)
  // Robot pose state
  _pose: { x: 0, y: 0, yaw: 0 },        // True physical position (LiDAR ray-cast source)
  _poseEstOffset: { x: 0, y: 0, yaw: 0 }, // Offset: estimate = _pose + _poseEstOffset
  _navTarget: null,    // { x, y, theta } — active navigation goal
  _navTimer: null,     // interval for navigation animation
  _navSpeed: 0.8,      // m/s simulated linear speed
  _navWaypoints: null,
  _navControllerState: null,
  _driveSimulationProfileOverride: null,
  _navigationGrid: null,
  _navigationClearance: 0.30,
  _lastPlanError: '',
  _lastObstacleNoticeAt: 0,
  // Jog control velocity integration
  _jogVel: { lx: 0, az: 0 },
  _jogTimer: null,
  // Map data cache for LiDAR ray-casting
  _mapData: null,
  _mapInfo: null,      // { width, height, resolution, originX, originY }
  // SLAM mode
  _slamMode: 'NAV',    // NAV, SLAM, LIFELONG
  // Light Mapping: active robot gets responsive sensor updates while background
  // robots are sampled less often to keep the browser main thread available.
  _mappingScanRays: 96,
  _virtualScanCycle: 0,
  _mappingProductCycle: 0,
  _backgroundMappingDivisor: 4,
  _mappingRangeMax: 8,
  _mappingNodeDistance: 0.6,
  _mappingNodeHeading: 0.5,
  _mappingLoopRadius: 0.7,
  _mappingLoopMinNodeGap: 6,
  // Noise generation (Box-Muller transform for Gaussian noise)
  _gaussRandom(mean, stddev) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z * stddev;
  },
  // BMS simulation
  _bmsSOC: 75,
  _bmsCharging: false,
  _bmsChargingManual: false,
  TEST_IMAGE_JPEG: '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABALCwkJCxwKCw4QDw4eFhUVFx4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eH//2wBDARESEhIVFx4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eH//wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAbEAACAQUAAAAAAAAAAAAAAAAAAQIDBAURIf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAVEQEBAAAAAAAAAAAAAAAAAAAAEf/aAAwDAQACEQMRAD8Aq2p6w0nT6xGq8Mcf/9k=',

  init() {
    const btn = document.getElementById('btn-test-mode');
    if (btn) {
      btn.addEventListener('click', () => this.toggle());
    }
    const demoBtn = document.getElementById('btn-test-mapping-demo');
    if (demoBtn) {
      demoBtn.addEventListener('click', () => this.startMappingDemo());
    }
    const cancelStartBtn = document.getElementById('btn-testmode-start-cancel');
    if (cancelStartBtn) {
      cancelStartBtn.addEventListener('click', () => {
        this._abortStartup('Test Mode 시작을 취소했습니다.', 'warning');
      });
    }
    const driveModel = document.getElementById('test-mode-drive-model');
    if (driveModel) {
      try {
        const savedModel = localStorage.getItem(this.DRIVE_MODEL_STORAGE_KEY);
        if (['dd', 'qd', 'action'].includes(savedModel)) driveModel.value = savedModel;
      } catch (error) {
        console.warn('Test Mode 주행 모델 설정 불러오기 실패:', error.message);
      }
      driveModel.addEventListener('change', () => {
        this._applyVirtualDriveModel(driveModel.value, true);
      });
    }
    if (typeof DriveSimulationLab !== 'undefined') DriveSimulationLab.init();
    this.updateUi();
  },

  _selectedVirtualDriveModel() {
    const selected = document.getElementById('test-mode-drive-model')?.value;
    return ['dd', 'qd', 'action'].includes(selected) ? selected : 'dd';
  },

  _applyVirtualDriveModel(value, notify = false) {
    const selected = ['dd', 'qd', 'action'].includes(value) ? value : 'dd';
    try {
      localStorage.setItem(this.DRIVE_MODEL_STORAGE_KEY, selected);
    } catch (error) {
      console.warn('Test Mode 주행 모델 설정 저장 실패:', error.message);
    }
    this.virtualRobots.forEach(robot => {
      robot.driveModel = selected;
      const profile = robot.currentAction?.profile;
      if (!profile) return;
      profile.modelType = selected === 'action'
        ? profile.actionModelType
        : (selected === 'qd' ? 1 : 0);
      profile.driveModelName = profile.modelType === 1
        ? 'QD'
        : (profile.modelType === 2 ? 'TRAILER' : 'DD');
    });
    if (this._navControllerState?.profile) {
      const profile = this._navControllerState.profile;
      profile.modelType = selected === 'action'
        ? profile.actionModelType
        : (selected === 'qd' ? 1 : 0);
      profile.driveModelName = profile.modelType === 1
        ? 'QD'
        : (profile.modelType === 2 ? 'TRAILER' : 'DD');
    }
    this.updateUi();
    if (notify) {
      const label = selected === 'action' ? 'Action 설정 사용' : selected.toUpperCase();
      App.toast(`Test Mode 주행 모델: ${label}`, 'success');
    }
  },

  toggle() {
    if (this.enabled) {
      this.stop();
    } else {
      if (typeof ROSLIB === 'undefined') {
        App.toast(
          'ROS 클라이언트 자산을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.',
          'error'
        );
        return;
      }
      this._promptPassword().then(password => {
        if (password !== null) this.start(password);
      });
    }
  },

  _promptPassword() {
    return new Promise((resolve) => {
      let overlay = document.getElementById('testmode-pw-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'testmode-pw-overlay';
        overlay.className = 'testmode-loading-overlay';
        overlay.innerHTML = `
          <div class="testmode-loading-box" style="min-width:300px;">
            <div class="testmode-loading-title">테스트 모드 비밀번호</div>
            <div style="padding:12px 0;">
              <input type="password" id="testmode-pw-input" placeholder="비밀번호 입력"
                style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:4px;
                       background:var(--bg);color:var(--text);font-size:14px;box-sizing:border-box;" />
              <div id="testmode-pw-error" style="color:#e74c3c;font-size:12px;margin-top:4px;display:none;"></div>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button id="testmode-pw-cancel" class="btn btn-small" style="min-width:60px;">취소</button>
              <button id="testmode-pw-ok" class="btn btn-small btn-primary" style="min-width:60px;">확인</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
      }
      overlay.style.display = 'flex';
      const input = document.getElementById('testmode-pw-input');
      const errEl = document.getElementById('testmode-pw-error');
      const okBtn = document.getElementById('testmode-pw-ok');
      const cancelBtn = document.getElementById('testmode-pw-cancel');
      input.value = '';
      errEl.style.display = 'none';
      setTimeout(() => input.focus(), 100);

      const cleanup = () => {
        overlay.style.display = 'none';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        input.removeEventListener('keydown', onKey);
      };
      const onOk = () => {
        const pw = input.value;
        if (!pw) {
          errEl.textContent = '비밀번호를 입력해주세요';
          errEl.style.display = 'block';
          return;
        }
        cleanup();
        resolve(pw);
      };
      const onCancel = () => { cleanup(); resolve(null); };
      const onKey = (e) => {
        if (e.key === 'Enter') onOk();
        else if (e.key === 'Escape') onCancel();
      };
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      input.addEventListener('keydown', onKey);
    });
  },

  async start(password) {
    if (this.enabled || this._starting) return;
    const startupAttempt = ++this._startupAttempt;
    this._lastStartError = '';
    this._lastFailure = null;
    this._startupStage = '시작 준비';
    this._starting = true;
    this.updateUi();
    this.showLoading(true);
    this._clearStartupTimeout();
    this._startupTimeoutId = setTimeout(() => {
      if (this._starting && this._startupAttempt === startupAttempt) {
        this._abortStartup(
          'Test Mode 시작 시간이 초과되었습니다. ROS 상태를 확인한 뒤 다시 시도해주세요.',
          'error'
        );
      }
    }, this.STARTUP_TIMEOUT_MS);

    try {
      // Step 1: Start rosbridge server (server waits for port ready)
      this.setProgress(5, '가상 ROS 서버 시작 요청 중...');
      await this.startRosBridgeOnly(password);
      this._ensureStartupActive(startupAttempt);

      // Step 2: Prepare temporary virtual fleet
      const robotCount = this._requestedRobotCount();
      this.setProgress(60, `가상 로봇 ${robotCount}대 준비 중...`);
      this.prepareVirtualFleet(robotCount);
      this._ensureStartupActive(startupAttempt);

      // Step 3: Connect ROS
      this.setProgress(70, '가상 ROS 연결 중...');
      await this.ensureRosConnection();
      this._ensureStartupActive(startupAttempt);

      const ros = RosManager.getRos();
      if (!ros) {
        throw new Error('Failed to get ROS connection');
      }

      // Step 4: Open separate ROS connection for publishing
      // (rosbridge does not echo published messages back to the same WebSocket client)
      this.setProgress(85, '가상 데이터 송신 채널 연결 중...');
      await this._openPublishConnection();
      this._ensureStartupActive(startupAttempt);

      // Step 5: Attach every temporary robot to the local bridge and advertise topics.
      this.setProgress(90, '가상 로봇 토픽 등록 중...');
      this.tick = 0;
      this._attachVirtualFleetConnection(ros);
      this.publisherSets.clear();
      this.virtualRobots.forEach(robot => {
        this.publisherSets.set(robot.robotId, this.createPublishers(this._publishRos, robot.robotId));
      });
      this.publishers = this.publisherSets.get(App.robotSlots[App.activeSlotIndex]?.robotId) || {};

      // ROS needs time to discover publisher↔subscriber connections
      this.setProgress(93, 'ROS 토픽 연결 확인 중...');
      await this._delay(3000);
      this._ensureStartupActive(startupAttempt);

      // Step 6: Start publish loops + set initial IDLE state
      this.setProgress(97, '가상 센서 데이터 시작 중...');
      this._workState = 0; // Start as IDLE
      this._pose = { x: 0, y: 0, yaw: 0 }; // Start at origin
      this._poseEstOffset = { x: 0, y: 0, yaw: 0 };
      this._jogVel = { lx: 0, az: 0 };
      this._bmsSOC = 75;
      this._bmsCharging = false;
      this._bmsChargingManual = false;
      this._slamMode = 'NAV';
      this._virtualScanCycle = 0;
      this._mappingProductCycle = 0;
      this._stopNavigation();
      this._buildMapCache();
      this._ensureStartupActive(startupAttempt);
      this.enabled = true;
      this._starting = false;
      this._lastFailure = null;
      this._lastStartError = '';
      this._clearStartupTimeout();
      this.startPublishLoops();
      this._startJogSubscription();
      this._startSlamSubscription();
      this.updateUi();
      this._refreshFleetUi();

      this.setProgress(100, 'Test Mode 준비 완료');
      await this._delay(400);
      this.showLoading(false);
      App.addEvent(
        'notification',
        'Test mode started',
        `${this.virtualRobots.size} virtual robots · Task + Light Mapping simulation`,
        'info'
      );
    } catch (err) {
      if (startupAttempt !== this._startupAttempt) return;
      this._abortStartup(err.message || 'Test Mode 시작에 실패했습니다.', 'error');
    }
  },

  _clearStartupTimeout() {
    if (!this._startupTimeoutId) return;
    clearTimeout(this._startupTimeoutId);
    this._startupTimeoutId = null;
  },

  _ensureStartupActive(startupAttempt) {
    if (!this._starting || startupAttempt !== this._startupAttempt) {
      throw new Error('Test Mode 시작이 취소되었습니다.');
    }
  },

  _abortStartup(message, toastType = 'warning') {
    if (!this._starting) return;
    this._startupAttempt += 1;
    this._clearStartupTimeout();
    this._starting = false;
    this.enabled = false;
    const failure = toastType === 'error'
      ? this._diagnoseFailure(message, 'startup')
      : null;
    this._lastFailure = failure;
    this._lastStartError = failure ? failure.detail : '';
    this.clearTimers();
    this._closePublishConnection();
    if (this.originalFleet) this.restoreVirtualFleet();
    this.requestStopRosBridge();
    this.updateUi();
    this.showLoading(false);
    if (failure) {
      const notice = `Test Mode 시작 실패 · 원인: ${failure.cause} · 조치: ${failure.action}`;
      App.toast(notice, 'error');
      App.addEvent?.(
        'notification',
        '[TestMode] 시작 실패',
        `${notice} · 기술 정보: ${failure.detail}`,
        'error'
      );
    } else if (message) {
      App.toast(message, toastType);
    }
  },

  stop() {
    if (this._starting) {
      this._abortStartup('Test Mode 시작을 취소했습니다.', 'warning');
      return;
    }
    this._startupAttempt += 1;
    this._clearStartupTimeout();
    this.enabled = false;
    this._lastStartError = '';
    this._lastFailure = null;
    this._workState = 0;
    this._stopNavigation();
    this._stopJogSubscription();
    this._stopSlamSubscription();
    this._pose = { x: 0, y: 0, yaw: 0 };
    this._poseEstOffset = { x: 0, y: 0, yaw: 0 };
    this._jogVel = { lx: 0, az: 0 };
    this._virtualScanCycle = 0;
    this._mappingProductCycle = 0;
    this._mapData = null;
    this._mapInfo = null;
    this._navigationGrid = null;
    this._lastPlanError = '';
    this._driveSimulationProfileOverride = null;
    this._updateVirtualMappingUi(null);
    this.clearTimers();
    this.publishers = {};
    this._closePublishConnection();
    this.updateUi();
    App.addEvent('notification', 'Test mode stopped', null, 'info');
    this.requestStopRosBridge();
    this.restoreVirtualFleet();
  },

  _requestedRobotCount() {
    const requested = Number(document.getElementById('test-mode-robot-count')?.value) || 3;
    return Math.max(1, Math.min(this.MAX_VIRTUAL_ROBOTS, Math.floor(requested)));
  },

  prepareVirtualFleet(count = 3) {
    if (!App?.robotSlots) return;
    const robotCount = Math.max(1, Math.min(this.MAX_VIRTUAL_ROBOTS, Number(count) || 1));
    this.originalFleet = App.robotSlots.map(slot => ({
      ip: slot.ip,
      robotId: slot.robotId,
      sshPort: slot.sshPort,
      tunnelMode: slot.tunnelMode,
      sshPassword: slot.sshPassword,
      robotNumber: slot.robotNumber,
      manualAdded: Boolean(slot.manualAdded),
      source: slot.source
    }));
    this.originalActiveSlotIndex = App.activeSlotIndex;

    App.robotSlots.forEach((slot, index) => {
      if (slot.ros || slot.connected) RosManager.disconnectSlot(index);
    });
    App.robotSlots.length = 0;
    App.activeSlotIndex = -1;
    this.virtualRobots.clear();

    // Keep every spawn pose in free space with enough clearance from the
    // black occupied cells. The previous poses were located directly on walls.
    const startPoses = [
      { x: -3.0, y: -2.5, yaw: 0 },
      { x: -0.75, y: -2.5, yaw: Math.PI / 2 },
      { x: 2.0, y: -2.5, yaw: Math.PI }
    ];
    for (let index = 0; index < robotCount; index += 1) {
      const robotId = `R_TEST_${index + 1}`;
      App.addRobotSlot(
        '127.0.0.1',
        robotId,
        22,
        false,
        '',
        901 + index,
        null,
        { silent: true, deferRender: true, activateFirst: index === 0 }
      );
      const slot = App.robotSlots[index];
      slot.virtualTestRobot = true;
      slot.wsPort = this.ROSBRIDGE_PORT;
      slot.robotModel = 'Test AMR';
      slot.conveyorCount = 2;
      const pose = { ...startPoses[index] };
      slot.pose = { ...pose };
      slot.workState = 0;
      slot.bms = { voltage: 52.5, current: -0.3, soc: 80 - index * 5, charging: false };
      this.virtualRobots.set(index, this._createVirtualRobotState(index, robotId, pose, slot.bms.soc));
    }
    App.activeSlotIndex = 0;
    App.renderActiveRobotSelector();
    App.renderRobotManagerList();
    App.renderMonitoringCards();
    App.updateActiveRobotStatus();
    App.updateMultiRobotButtons();
  },

  _createVirtualRobotState(slotIndex, robotId, pose, soc = 75) {
    return {
      slotIndex,
      robotId,
      pose: { ...pose },
      poseEstOffset: { x: 0, y: 0, yaw: 0 },
      workState: 0,
      soc,
      charging: false,
      task: null,
      paused: false,
      currentAction: null,
      actionStartedAt: 0,
      navTarget: null,
      navQueue: [],
      plannedPath: [],
      taskLabel: '',
      completedLoops: 0,
      mappingMode: 'NAV',
      mapping: null,
      lastMappedData: null,
      lastMappingSession: null,
      savedNavMap: null,
      savedMapName: '',
      driveModel: this._selectedVirtualDriveModel()
    };
  },

  _attachVirtualFleetConnection(ros) {
    App.robotSlots.forEach((slot, index) => {
      if (!slot.virtualTestRobot) return;
      slot.ros = ros;
      slot.connected = true;
      slot.connectedAt = Date.now();
      if (index !== App.activeSlotIndex) {
        slot.subscriptions = {};
        slot.dataSubscribed = false;
      }
      if (typeof FleetControl !== 'undefined') FleetControl.onSlotConnected(index);
    });
    RosManager.ros = ros;
    App.renderActiveRobotSelector();
    App.renderRobotManagerList();
    App.renderMonitoringCards();
    App.updateActiveRobotStatus();
    App.updateMultiRobotButtons();
  },

  restoreVirtualFleet() {
    if (!App?.robotSlots) return;
    const sharedConnections = new Set();
    App.robotSlots.forEach(slot => {
      if (slot.virtualTestRobot && slot.ros) sharedConnections.add(slot.ros);
      Object.values(slot.subscriptions || {}).forEach(sub => {
        try { sub?.unsubscribe?.(); } catch (e) { /* ignore */ }
      });
      slot.subscriptions = {};
      slot.ros = null;
      slot.connected = false;
    });
    sharedConnections.forEach(ros => {
      try { ros.close(); } catch (e) { /* ignore */ }
    });

    App.robotSlots.length = 0;
    App.activeSlotIndex = -1;
    (this.originalFleet || []).forEach((slot, index) => {
      App.addRobotSlot(
        slot.ip,
        slot.robotId,
        slot.sshPort,
        slot.tunnelMode,
        slot.sshPassword,
        slot.robotNumber,
        null,
        {
          silent: true,
          deferRender: true,
          activateFirst: false,
          manualAdded: slot.manualAdded,
          source: slot.source
        }
      );
      App.robotSlots[index].connected = false;
      App.robotSlots[index].ros = null;
    });
    if (App.robotSlots.length > 0) {
      App.activeSlotIndex = Math.max(
        0,
        Math.min(this.originalActiveSlotIndex, App.robotSlots.length - 1)
      );
    }
    this.originalFleet = null;
    this.originalActiveSlotIndex = -1;
    this.virtualRobots.clear();
    this.publisherSets.clear();
    RosManager.ros = null;
    RosManager.robotPose = null;
    App.renderActiveRobotSelector();
    App.renderRobotManagerList();
    App.renderMonitoringCards();
    App.updateActiveRobotStatus();
    App.updateMultiRobotButtons();
  },

  _refreshFleetUi() {
    App.renderActiveRobotSelector();
    App.renderRobotManagerList();
    App.renderMonitoringCards();
    App.updateActiveRobotStatus();
    if (typeof FleetControl !== 'undefined' && FleetControl._active) {
      FleetControl.deactivate();
      FleetControl.activate();
      this._publishVirtualMaps();
    }
  },

  prepareLocalSlot() {
    if (!App || !App.robotSlots) return;

    if (App.robotSlots.length === 0) {
      App.addRobotSlot('127.0.0.1', 'R_TEST');
      this.createdSlotIndex = App.activeSlotIndex;
      this.originalSlot = null;
      return;
    }

    const index = App.activeSlotIndex >= 0 ? App.activeSlotIndex : 0;
    const slot = App.robotSlots[index];
    this.originalSlot = { index, ip: slot.ip, robotId: slot.robotId, tunnelMode: slot.tunnelMode, sshPort: slot.sshPort };

    // Disconnect without triggering TestMode.stop() loop
    if (slot.connected || slot.ros) {
      Object.values(slot.subscriptions || {}).forEach(sub => {
        if (sub && sub.unsubscribe) sub.unsubscribe();
      });
      slot.subscriptions = {};
      if (slot.ros) {
        try { slot.ros.close(); } catch (e) { /* ignore */ }
        slot.ros = null;
      }
      slot.connected = false;
      if (index === App.activeSlotIndex) {
        RosManager.ros = null;
      }
    }

    slot.ip = '127.0.0.1';
    slot.robotId = 'R_TEST';
    slot.tunnelMode = false;
    slot.tunnelActive = false;
    App.saveRobotSlots();
    App.renderActiveRobotSelector();
    App.updateActiveRobotStatus();
  },

  restoreLocalSlot() {
    if (this.createdSlotIndex !== null) {
      App.removeRobotSlot(this.createdSlotIndex);
      this.createdSlotIndex = null;
      return;
    }

    if (this.originalSlot) {
      const { index, ip, robotId, tunnelMode, sshPort } = this.originalSlot;
      const slot = App.robotSlots[index];
      if (slot) {
        if (slot.connected || slot.ros) {
          Object.values(slot.subscriptions || {}).forEach(sub => {
            if (sub && sub.unsubscribe) sub.unsubscribe();
          });
          slot.subscriptions = {};
          if (slot.ros) {
            try { slot.ros.close(); } catch (e) { /* ignore */ }
            slot.ros = null;
          }
          slot.connected = false;
          if (index === App.activeSlotIndex) {
            RosManager.ros = null;
          }
        }
        slot.ip = ip;
        slot.robotId = robotId;
        if (tunnelMode !== undefined) slot.tunnelMode = tunnelMode;
        if (sshPort !== undefined) slot.sshPort = sshPort;
        App.saveRobotSlots();
        App.renderActiveRobotSelector();
        App.updateActiveRobotStatus();
      }
      this.originalSlot = null;
    }
  },

  async startRosBridgeOnly(password) {
    this._progressTimer = setInterval(() => {
      const fill = document.getElementById('testmode-progress-fill');
      if (fill) {
        const cur = parseFloat(fill.style.width) || 5;
        if (cur < 55) this.setProgress(Math.min(cur + 1.5, 55), '가상 ROS 서버 준비 중...');
      }
    }, 500);

    try {
      // B12 fix: roscore+rosbridge 시작 대기가 길 수 있으므로 30초 타임아웃
      const res = await fetchWithTimeout('/api/testmode/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      }, 30000);
      clearInterval(this._progressTimer);

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Test Mode 서버 응답이 올바르지 않습니다. 다시 로그인하거나 서버를 재시작해주세요.');
      }

      const data = await res.json();
      if (!data.success) {
        if (data.authFailed) {
          throw new Error('비밀번호가 올바르지 않습니다.');
        }
        throw new Error(data.message || '가상 ROS 서버 시작 실패');
      }
      this.ROSBRIDGE_PORT = Number(data.port) || 19090;
      return true;
    } catch (e) {
      clearInterval(this._progressTimer);
      throw new Error(e.message || '가상 ROS 서버 시작 실패');
    }
  },

  ensureRosConnection() {
    const idx = App.activeSlotIndex;
    const curSlot = App.robotSlots[idx];
    if (curSlot && curSlot.connected && RosManager.ros) return Promise.resolve(true);

    if (idx < 0 || idx >= App.robotSlots.length) {
      return Promise.reject(new Error('Please add a robot slot first for ROS connection'));
    }

    const slot = App.robotSlots[idx];
    if (!slot.ip || !slot.robotId) {
      return Promise.reject(new Error('Please set robot IP/ID first'));
    }

    App.connectSlot(idx);

    return new Promise((resolve, reject) => {
      const start = Date.now();
      let attempt = 0;
      const timer = setInterval(() => {
        attempt++;
        const pct = Math.min(70 + attempt * 2, 88);
        this.setProgress(pct, `가상 ROS 연결 대기 중... (${Math.round((Date.now() - start) / 1000)}초)`);

        const s = App.robotSlots[idx];
        if (s && s.connected && RosManager.ros) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        if (s && !s.connected && !s.ros) {
          App.connectSlot(idx);
        }
        if (Date.now() - start > 15000) {
          clearInterval(timer);
          reject(new Error('가상 ROS 연결에 실패했습니다.'));
        }
      }, 500);
    });
  },

  async requestStopRosBridge() {
    try {
      await fetch('/api/testmode/stop', { method: 'POST' });
    } catch (e) {
      // ignore
    }
  },

  updateUi() {
    const status = document.getElementById('test-mode-status');
    const chip = document.getElementById('test-mode-chip');
    const robotCount = document.getElementById('test-mode-robot-count');
    const driveModel = document.getElementById('test-mode-drive-model');
    const detailStatus = document.getElementById('test-mode-detail-status');
    const toggleButton = document.getElementById('btn-test-mode');
    const chargeButton = document.getElementById('btn-bms-test-charge');
    if (!status) return;
    status.textContent = this._starting ? '...' : (this.enabled ? 'ON' : 'OFF');
    status.classList.toggle('on', this.enabled);
    if (robotCount) robotCount.disabled = this.enabled || this._starting;
    if (driveModel) driveModel.disabled = this._starting;
    if (detailStatus) {
      detailStatus.textContent = this.enabled
        ? `실행 중 · ${this._selectedVirtualDriveModel() === 'action'
          ? 'Action 모델'
          : this._selectedVirtualDriveModel().toUpperCase()}`
          + ` · 가상 로봇 ${this.virtualRobots.size}대`
        : (this._starting
          ? '시작 중'
          : (this._lastStartError ? '시작 실패' : '꺼짐'));
      detailStatus.classList.toggle('error', Boolean(this._lastStartError));
    }
    this._renderFailureGuide();
    if (toggleButton) {
      toggleButton.textContent = this.enabled ? 'Test Mode 종료' : (this._starting ? '시작 중...' : 'Test Mode 시작');
      toggleButton.classList.toggle('btn-danger', this.enabled);
      toggleButton.classList.toggle('btn-primary', !this.enabled);
      toggleButton.disabled = Boolean(this._starting);
    }
    if (chargeButton) {
      chargeButton.disabled = !this.enabled;
      chargeButton.textContent = this._bmsCharging ? 'Test 충전 중지' : 'Test 충전 시작';
    }
    if (chip) {
      chip.classList.toggle('enabled', this.enabled);
    }
    if (!this.enabled) this._updateVirtualMappingUi(null);
    if (typeof DriveSimulationLab !== 'undefined') {
      DriveSimulationLab.refreshAvailability();
    }
  },

  showLoading(show) {
    const overlay = document.getElementById('testmode-loading-overlay');
    if (overlay) overlay.style.display = show ? 'flex' : 'none';
    if (show) this.setProgress(0, 'Preparing...');
  },

  setProgress(pct, stepText) {
    const fill = document.getElementById('testmode-progress-fill');
    const pctEl = document.getElementById('testmode-loading-pct');
    const stepEl = document.getElementById('testmode-step-text');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    if (stepText) {
      this._startupStage = String(stepText);
      if (stepEl) stepEl.textContent = stepText;
    }
  },

  _diagnoseFailure(message, phase = 'runtime') {
    const detail = String(message || '알 수 없는 오류').trim();
    const normalized = detail.toLowerCase();
    const startup = phase === 'startup';
    const result = {
      phase,
      title: startup ? 'Test Mode 시작 실패' : 'Test Mode 주행 실패',
      cause: detail,
      action: startup
        ? 'Test Mode를 다시 시작하고, 같은 문제가 반복되면 EasyLoop 서버 상태를 확인하세요.'
        : '실패한 Action과 맵 상태를 확인한 뒤 Task를 다시 실행하세요.',
      detail
    };

    if (/비밀번호|password|authfailed|unauthorized/.test(normalized)) {
      result.cause = 'Test Mode 시작 비밀번호가 현재 서버 설정과 일치하지 않습니다.';
      result.action = 'Test Mode 비밀번호를 다시 입력하세요. 계속 실패하면 EasyLoop 로그인 세션을 갱신한 뒤 재시도하세요.';
    } else if (/응답이 올바르지|다시 로그인|세션|unexpected token|json/.test(normalized)) {
      result.cause = '로그인 세션이 만료되었거나 서버가 JSON 대신 오류 페이지를 반환했습니다.';
      result.action = 'EasyLoop에 다시 로그인하고 페이지를 새로고침한 뒤 Test Mode를 시작하세요.';
    } else if (/roscore|ros master|11311/.test(normalized)) {
      result.cause = '로컬 ROS Master(roscore)를 시작하거나 연결하지 못했습니다.';
      result.action = 'EasyLoop 실행 환경의 ROS1 Noetic 설정과 11311 포트 사용 상태를 확인한 뒤 서버를 재시작하세요.';
    } else if (/rosbridge|19090/.test(normalized)) {
      result.cause = 'Test Mode 전용 rosbridge가 19090 포트에서 준비되지 못했습니다.';
      result.action = '19090 포트 충돌과 rosbridge_server 실행 가능 여부를 확인한 뒤 EasyLoop 서버를 재시작하세요.';
    } else if (/publisher|publish ros|송신 채널/.test(normalized)) {
      result.cause = '가상 센서 데이터를 보낼 ROS Publisher WebSocket 연결에 실패했습니다.';
      result.action = '페이지를 새로고침해 다시 시도하고, 계속 실패하면 EasyLoop WebSocket 프록시와 19090 포트를 확인하세요.';
    } else if (/가상 ros 연결|ros connection|websocket|ws-proxy/.test(normalized)) {
      result.cause = '브라우저가 Test Mode 전용 ROS WebSocket에 연결하지 못했습니다.';
      result.action = 'EasyLoop 서버가 실행 중인지 확인하고 페이지 새로고침 후 재시도하세요. 실로봇 연결은 종료할 필요가 없습니다.';
    } else if (/시간이 초과|timeout|timed out|aborterror/.test(normalized)) {
      const stage = this._startupStage || '시작';
      result.cause = `${stage} 단계에서 시작 시간이 초과되었습니다.`;
      result.action = '한 번 다시 시도하고, 반복되면 EasyLoop 서버를 재시작한 뒤 ROS Core와 rosbridge 상태를 확인하세요.';
    } else if (/failed to fetch|networkerror|econnrefused|서버에 연결/.test(normalized)) {
      result.cause = '브라우저가 EasyLoop의 Test Mode 시작 API에 연결하지 못했습니다.';
      result.action = 'EasyLoop 서버 실행 여부와 현재 페이지 주소를 확인하고 새로고침한 뒤 재시도하세요.';
    } else if (/failed to get ros|robot slot|robot ip\/id|가상 로봇을 찾을 수 없/.test(normalized)) {
      result.cause = '임시 가상 로봇 슬롯 또는 ROS 연결 정보가 준비되지 않았습니다.';
      result.action = 'Test Mode를 종료한 뒤 다시 시작하고, 생성된 R_TEST 로봇이 선택되었는지 확인하세요.';
    } else if (/가상 맵이 준비되지/.test(normalized)) {
      result.cause = '가상 LiDAR와 Navigation Map 초기화가 아직 완료되지 않았습니다.';
      result.action = 'Test Mode 시작 완료 후 맵이 표시될 때까지 잠시 기다린 뒤 주행을 다시 실행하세요.';
    } else if (/맵 범위를 벗어/.test(normalized)) {
      result.cause = '선택한 목적지가 현재 가상 맵의 좌표 범위를 벗어났습니다.';
      result.action = '목적지를 맵 내부의 흰색 빈 공간으로 다시 지정하세요.';
    } else if (/collision|충돌|안전 정지/.test(normalized)) {
      result.title = 'Test Mode 안전 정지';
      result.cause = '설정된 충돌 감지 범위 안에서 벽 또는 장애물을 감지했습니다.';
      result.action = '목표점과 경로를 장애물에서 떼고, avoid_mode·road_width·collision_detect_range 값을 확인한 뒤 다시 실행하세요.';
    } else if (/경로를 만들 수 없|검은 장애물|경로 없음|no path|장애물을 피할 수 없|갈 수 있는 경로가 없/.test(normalized)) {
      result.cause = '시작점·목표점이 장애물에 있거나 로봇 폭을 확보할 우회 통로가 없습니다.';
      result.action = '목표점을 흰색 빈 공간으로 옮기고 경로 주변 여유 폭을 확보한 뒤 다시 실행하세요.';
    } else if (/action이 없습니다|no action|시뮬레이션할 action/.test(normalized)) {
      result.cause = '실행 요청에 시뮬레이션할 Action이 포함되지 않았습니다.';
      result.action = 'Task에 WayPoint·Trajectory 등 Action을 하나 이상 추가하고 저장 후 다시 실행하세요.';
    }
    return result;
  },

  _renderFailureGuide() {
    const panel = document.getElementById('test-mode-failure-guide');
    if (!panel) return;
    const failure = this._lastFailure;
    panel.hidden = !failure;
    if (!failure) return;
    const title = document.getElementById('test-mode-failure-title');
    const cause = document.getElementById('test-mode-failure-cause');
    const action = document.getElementById('test-mode-failure-action');
    const detail = document.getElementById('test-mode-failure-detail');
    if (title) title.textContent = failure.title;
    if (cause) cause.textContent = failure.cause;
    if (action) action.textContent = failure.action;
    if (detail) detail.textContent = failure.detail;
  },

  _reportRuntimeFailure(message, phase = 'runtime') {
    const failure = this._diagnoseFailure(message, phase);
    this._lastFailure = failure;
    this.updateUi();
    const notice = `실패 원인: ${failure.cause} · 조치: ${failure.action}`;
    App.toast(notice, 'error');
    App.addEvent?.(
      'action',
      `[TestMode] ${failure.title}`,
      `${notice} · 기술 정보: ${failure.detail}`,
      'error'
    );
    return failure;
  },

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  },

  _openPublishConnection() {
    return new Promise((resolve, reject) => {
      const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${wsProto}://${location.host}/ws-proxy?target=127.0.0.1:${this.ROSBRIDGE_PORT}`;
      this._publishRos = new ROSLIB.Ros({ url });
      this._publishRos.on('connection', () => {
        console.log('[TestMode] Publish ROS connection opened');
        resolve();
      });
      this._publishRos.on('error', (err) => {
        console.error('[TestMode] Publish ROS error:', err);
        reject(new Error('Publisher ROS connection failed'));
      });
      setTimeout(() => reject(new Error('Publisher ROS connection timeout')), 5000);
    });
  },

  _closePublishConnection() {
    if (this._publishRos) {
      try { this._publishRos.close(); } catch (e) { /* ignore */ }
      this._publishRos = null;
    }
  },

  clearTimers() {
    this.timers.forEach(id => clearInterval(id));
    this.dockTimers.forEach(id => { clearTimeout(id); clearInterval(id); });
    this.timers = [];
    this.dockTimers = [];
  },

  getRobotId() {
    return RosManager.getRobotId() || document.getElementById('robot-id')?.value || 'R_001';
  },

  // ── Publishers ──────────────────────────────────────────────
  createPublishers(ros, robotId = null) {
    const rid = robotId || this.getRobotId();
    return {
      bms: new ROSLIB.Topic({ ros, name: `/${rid}/bms`, messageType: 'std_msgs/Float32MultiArray' }),
      // workState: injected directly (syscon_msgs/RobotState not available in test rosbridge)
      pose: new ROSLIB.Topic({ ros, name: `/${rid}/amcl_pose`, messageType: 'geometry_msgs/PoseWithCovarianceStamped' }),
      map: new ROSLIB.Topic({ ros, name: `/${rid}/map`, messageType: 'nav_msgs/OccupancyGrid' }),
      scan: new ROSLIB.Topic({ ros, name: `/${rid}/scan`, messageType: 'sensor_msgs/LaserScan' }),
      mappingPath: new ROSLIB.Topic({ ros, name: `/${rid}/lio_sam/mapping/path`, messageType: 'nav_msgs/Path' }),
      mappingFootprint: new ROSLIB.Topic({ ros, name: `/${rid}/lio_sam/mapping/footprint`, messageType: 'geometry_msgs/PolygonStamped' }),
      slamGraph: new ROSLIB.Topic({ ros, name: `/${rid}/slam_toolbox/karto_graph_visualization`, messageType: 'visualization_msgs/MarkerArray' }),
      routineStatus: new ROSLIB.Topic({ ros, name: `/${rid}/sp_routine_status`, messageType: 'std_msgs/String' }),
      operationMode: new ROSLIB.Topic({ ros, name: `/${rid}/spx/operation_mode`, messageType: 'std_msgs/String' }),
      cam1Depth: new ROSLIB.Topic({ ros, name: `/${rid}/cam_1/depth/image_raw`, messageType: 'sensor_msgs/Image' }),
      cam1Color: new ROSLIB.Topic({ ros, name: `/${rid}/cam_1/color/image_raw/compressed`, messageType: 'sensor_msgs/CompressedImage' }),
      cam2Depth: new ROSLIB.Topic({ ros, name: `/${rid}/cam_2/depth/image_raw`, messageType: 'sensor_msgs/Image' }),
      cam2Color: new ROSLIB.Topic({ ros, name: `/${rid}/cam_2/color/image_raw/compressed`, messageType: 'sensor_msgs/CompressedImage' }),
      missionResult: new ROSLIB.Topic({ ros, name: '/mission_result', messageType: 'std_msgs/String' }),
      precisionResult: new ROSLIB.Topic({ ros, name: '/precision_result', messageType: 'std_msgs/Float64MultiArray' }),
      // docking results: injected directly (syscon_msgs not available in test rosbridge)
      dockingResult: null,
      dockingOutResult: null
    };
  },

  startPublishLoops() {
    if (this.virtualRobots.size > 0) {
      this._publishVirtualMaps();
      this._publishVirtualScans();
      this._syncActiveVirtualRobot(true);
      this.timers.push(setInterval(() => this._tickVirtualFleet(0.05), 50));
      this.timers.push(setInterval(() => this._publishVirtualFleetTelemetry(), 200));
      this.timers.push(setInterval(() => this._publishVirtualScans(), 400));
      this.timers.push(setInterval(() => this._publishVirtualMappingProducts(), 1000));
      this.timers.push(setInterval(() => this._publishVirtualBms(), 1000));
      this.timers.push(setInterval(() => this._publishVirtualMaps(), 10000));
      this.timers.push(setInterval(() => this._publishVirtualCameras(), 1000));
      return;
    }
    this.timers.push(setInterval(() => this.publishBms(), 1000));
    this.timers.push(setInterval(() => this.publishWorkState(), 2000));
    this.timers.push(setInterval(() => this.publishPose(), 200));
    this.timers.push(setInterval(() => this.publishScan(), 300));
    this.timers.push(setInterval(() => this.publishCamera(), 600));
    // Publish map once immediately, then every 10s
    this.publishMap();
    this.timers.push(setInterval(() => this.publishMap(), 10000));
  },

  _mapMessage(data = this._mapData) {
    if (!this._mapInfo || !data) return null;
    const { width, height, resolution, originX, originY } = this._mapInfo;
    return {
      header: { stamp: { secs: Math.floor(Date.now() / 1000), nsecs: 0 }, frame_id: 'map' },
      info: {
        map_load_time: { secs: 0, nsecs: 0 },
        resolution,
        width,
        height,
        origin: {
          position: { x: originX, y: originY, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 }
        }
      },
      data: Array.from(data)
    };
  },

  _publishVirtualMaps() {
    if (!this.enabled && !this._starting) return;
    const messagesByData = new Map();
    let activeMessage = null;
    this.virtualRobots.forEach(robot => {
      const data = robot.mappingMode === 'NAV'
        ? (robot.savedNavMap || this._mapData)
        : robot.mapping?.mapData;
      if (!data) return;
      let message = messagesByData.get(data);
      if (!message) {
        message = this._mapMessage(data);
        if (message) messagesByData.set(data, message);
      }
      if (!message) return;
      this.publisherSets.get(robot.robotId)?.map?.publish(new ROSLIB.Message(message));
      if (robot.slotIndex === App.activeSlotIndex) activeMessage = message;
    });
    if (activeMessage) RosManager.lastMapMsg = activeMessage;
    RosManager.requestRender();
  },

  _angleDistance(a, b) {
    return Math.abs(this._normalizeAngle((Number(a) || 0) - (Number(b) || 0)));
  },

  _worldToMapCell(x, y) {
    if (!this._mapInfo) return null;
    const { width, height, resolution, originX, originY } = this._mapInfo;
    const col = Math.floor((x - originX) / resolution);
    const row = Math.floor((y - originY) / resolution);
    if (col < 0 || col >= width || row < 0 || row >= height) return null;
    return { row, col, index: row * width + col };
  },

  _mapCellToWorld(row, col) {
    if (!this._mapInfo) return null;
    return {
      x: this._mapInfo.originX + (col + 0.5) * this._mapInfo.resolution,
      y: this._mapInfo.originY + (row + 0.5) * this._mapInfo.resolution
    };
  },

  _buildNavigationGrid() {
    if (!this._mapInfo || !this._mapData) {
      this._navigationGrid = null;
      return null;
    }
    const { width, height, resolution } = this._mapInfo;
    const blocked = new Uint8Array(width * height);
    const displayedMap = typeof RosManager !== 'undefined'
      && RosManager.lastMapMsg?.data?.length === width * height
      ? RosManager.lastMapMsg.data
      : null;
    const clearanceCells = Math.max(1, Math.ceil(this._navigationClearance / resolution));
    const offsets = [];
    for (let rowOffset = -clearanceCells; rowOffset <= clearanceCells; rowOffset += 1) {
      for (let colOffset = -clearanceCells; colOffset <= clearanceCells; colOffset += 1) {
        if (Math.hypot(rowOffset, colOffset) <= clearanceCells) {
          offsets.push([rowOffset, colOffset]);
        }
      }
    }

    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const index = row * width + col;
        // Ground-truth obstacles are always protected. Occupied cells added
        // through the visible/editable map are merged into the same grid.
        const displayedOccupied = displayedMap ? Number(displayedMap[index]) >= 50 : false;
        if (this._mapData[index] < 50 && !displayedOccupied) continue;
        offsets.forEach(([rowOffset, colOffset]) => {
          const blockedRow = row + rowOffset;
          const blockedCol = col + colOffset;
          if (blockedRow < 0 || blockedRow >= height || blockedCol < 0 || blockedCol >= width) return;
          blocked[blockedRow * width + blockedCol] = 1;
        });
      }
    }
    this._navigationGrid = blocked;
    return blocked;
  },

  _isNavigationCellFree(row, col) {
    if (!this._mapInfo || !this._mapData) return false;
    const { width, height } = this._mapInfo;
    if (row < 0 || row >= height || col < 0 || col >= width) return false;
    if (!this._navigationGrid || this._navigationGrid.length !== width * height) {
      this._buildNavigationGrid();
    }
    return this._navigationGrid?.[row * width + col] === 0;
  },

  _isPoseTraversable(x, y) {
    const cell = this._worldToMapCell(x, y);
    return Boolean(cell && this._isNavigationCellFree(cell.row, cell.col));
  },

  _hasNavigationLineOfSight(fromCell, toCell) {
    const rowDelta = toCell.row - fromCell.row;
    const colDelta = toCell.col - fromCell.col;
    const samples = Math.max(Math.abs(rowDelta), Math.abs(colDelta)) * 2;
    if (samples === 0) return this._isNavigationCellFree(fromCell.row, fromCell.col);
    let previous = fromCell;
    for (let step = 0; step <= samples; step += 1) {
      const ratio = step / samples;
      const row = Math.round(fromCell.row + rowDelta * ratio);
      const col = Math.round(fromCell.col + colDelta * ratio);
      if (!this._isNavigationCellFree(row, col)) return false;
      if (row !== previous.row && col !== previous.col) {
        if (!this._isNavigationCellFree(previous.row, col)
            || !this._isNavigationCellFree(row, previous.col)) {
          return false;
        }
      }
      previous = { row, col };
    }
    return true;
  },

  _simplifyNavigationCells(cells) {
    if (!Array.isArray(cells) || cells.length <= 2) return Array.from(cells || []);
    const simplified = [cells[0]];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let next = cells.length - 1;
      while (next > anchor + 1
          && !this._hasNavigationLineOfSight(cells[anchor], cells[next])) {
        next -= 1;
      }
      simplified.push(cells[next]);
      anchor = next;
    }
    return simplified;
  },

  _planNavigationPath(startPose, target, options = {}) {
    this._lastPlanError = '';
    if (!this._mapInfo || !this._mapData) {
      this._lastPlanError = '가상 맵이 준비되지 않았습니다.';
      return null;
    }
    // Rebuild for every new route so newly painted black map cells are also
    // treated as obstacles without restarting Test Mode.
    this._buildNavigationGrid();
    const start = this._worldToMapCell(startPose?.x, startPose?.y);
    const goal = this._worldToMapCell(target?.x, target?.y);
    if (!start || !goal) {
      this._lastPlanError = '목적지가 맵 범위를 벗어났습니다.';
      return null;
    }
    if (!this._isNavigationCellFree(start.row, start.col)) {
      this._lastPlanError = '로봇이 장애물 영역에 있어 경로를 만들 수 없습니다.';
      return null;
    }
    if (!this._isNavigationCellFree(goal.row, goal.col)) {
      this._lastPlanError = '목적지가 검은 장애물과 너무 가깝습니다.';
      return null;
    }
    if (start.index === goal.index) {
      return [{ x: Number(target.x), y: Number(target.y), theta: Number(target.theta) || 0 }];
    }

    const { width, height } = this._mapInfo;
    const cellCount = width * height;
    const gScore = new Float64Array(cellCount);
    gScore.fill(Infinity);
    const cameFrom = new Int32Array(cellCount);
    cameFrom.fill(-1);
    const closed = new Uint8Array(cellCount);
    const heap = [];
    const push = (index, score) => {
      heap.push({ index, score });
      let child = heap.length - 1;
      while (child > 0) {
        const parent = Math.floor((child - 1) / 2);
        if (heap[parent].score <= heap[child].score) break;
        [heap[parent], heap[child]] = [heap[child], heap[parent]];
        child = parent;
      }
    };
    const pop = () => {
      if (heap.length === 0) return null;
      const first = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        heap[0] = last;
        let parent = 0;
        while (true) {
          const left = parent * 2 + 1;
          const right = left + 1;
          let smallest = parent;
          if (left < heap.length && heap[left].score < heap[smallest].score) smallest = left;
          if (right < heap.length && heap[right].score < heap[smallest].score) smallest = right;
          if (smallest === parent) break;
          [heap[parent], heap[smallest]] = [heap[smallest], heap[parent]];
          parent = smallest;
        }
      }
      return first;
    };
    const heuristic = (row, col) => {
      const rowDistance = Math.abs(goal.row - row);
      const colDistance = Math.abs(goal.col - col);
      const diagonal = Math.min(rowDistance, colDistance);
      return rowDistance + colDistance + (Math.SQRT2 - 2) * diagonal;
    };
    const neighbours = [
      [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
      [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2],
      [1, -1, Math.SQRT2], [1, 1, Math.SQRT2]
    ];
    const corridorWidth = Math.max(0, Number(options.corridorWidth) || 0);
    const corridorRadiusCells = corridorWidth > 0
      ? corridorWidth / 2 / this._mapInfo.resolution
      : Infinity;
    const isInsideCorridor = (row, col) => {
      if (!Number.isFinite(corridorRadiusCells)) return true;
      const startCol = start.col;
      const startRow = start.row;
      const deltaCol = goal.col - startCol;
      const deltaRow = goal.row - startRow;
      const lengthSquared = deltaCol * deltaCol + deltaRow * deltaRow;
      if (lengthSquared === 0) return true;
      const projection = Math.max(0, Math.min(1,
        ((col - startCol) * deltaCol + (row - startRow) * deltaRow) / lengthSquared
      ));
      const nearestCol = startCol + projection * deltaCol;
      const nearestRow = startRow + projection * deltaRow;
      return Math.hypot(col - nearestCol, row - nearestRow) <= corridorRadiusCells;
    };

    gScore[start.index] = 0;
    push(start.index, heuristic(start.row, start.col));
    let reached = false;
    while (heap.length > 0) {
      const current = pop();
      if (!current || closed[current.index]) continue;
      if (current.index === goal.index) {
        reached = true;
        break;
      }
      closed[current.index] = 1;
      const row = Math.floor(current.index / width);
      const col = current.index % width;
      neighbours.forEach(([rowOffset, colOffset, cost]) => {
        const nextRow = row + rowOffset;
        const nextCol = col + colOffset;
        if (!this._isNavigationCellFree(nextRow, nextCol)) return;
        if (!isInsideCorridor(nextRow, nextCol)) return;
        if (rowOffset !== 0 && colOffset !== 0
            && (!this._isNavigationCellFree(row, nextCol)
              || !this._isNavigationCellFree(nextRow, col))) {
          return;
        }
        const nextIndex = nextRow * width + nextCol;
        if (closed[nextIndex]) return;
        const tentative = gScore[current.index] + cost;
        if (tentative >= gScore[nextIndex]) return;
        cameFrom[nextIndex] = current.index;
        gScore[nextIndex] = tentative;
        push(nextIndex, tentative + heuristic(nextRow, nextCol));
      });
    }

    if (!reached) {
      this._lastPlanError = corridorWidth > 0
        ? `road_width ${corridorWidth.toFixed(1)}m 범위에서 장애물을 피할 수 없습니다.`
        : '검은 장애물을 피해 목적지까지 갈 수 있는 경로가 없습니다.';
      return null;
    }

    const cells = [];
    let cursor = goal.index;
    while (cursor >= 0) {
      cells.push({
        row: Math.floor(cursor / width),
        col: cursor % width,
        index: cursor
      });
      if (cursor === start.index) break;
      cursor = cameFrom[cursor];
    }
    cells.reverse();
    const simplified = this._simplifyNavigationCells(cells);
    const points = simplified.slice(1).map(cell => this._mapCellToWorld(cell.row, cell.col));
    if (points.length === 0) points.push({ x: Number(target.x), y: Number(target.y) });
    points[points.length - 1] = { x: Number(target.x), y: Number(target.y) };
    return points.map((point, index) => {
      const next = points[index + 1];
      return {
        x: point.x,
        y: point.y,
        theta: next
          ? Math.atan2(next.y - point.y, next.x - point.x)
          : (Number(target.theta) || 0)
      };
    });
  },

  _planNavigationQueue(startPose, targets, options = true) {
    const normalized = typeof options === 'boolean'
      ? { mode: options ? 'global' : 'straight' }
      : { mode: 'global', ...(options || {}) };
    const planned = [];
    let cursor = { ...startPose };
    const sourceTargets = Array.from(targets || []);
    for (let targetIndex = 0; targetIndex < sourceTargets.length; targetIndex += 1) {
      const target = sourceTargets[targetIndex];
      let segment;
      if (normalized.mode === 'straight') {
        segment = [{
          x: Number(target.x),
          y: Number(target.y),
          theta: Number(target.theta) || 0
        }];
      } else if (normalized.mode === 'straight-rollout') {
        const startCell = this._worldToMapCell(cursor.x, cursor.y);
        const targetCell = this._worldToMapCell(target.x, target.y);
        segment = startCell && targetCell && this._hasNavigationLineOfSight(startCell, targetCell)
          ? [{
            x: Number(target.x),
            y: Number(target.y),
            theta: Number(target.theta) || 0
          }]
          : this._planNavigationPath(cursor, target, {
            corridorWidth: normalized.corridorWidth
          });
      } else {
        segment = this._planNavigationPath(cursor, target);
      }
      if (!segment) return null;
      segment.forEach((point, pointIndex) => {
        planned.push({
          ...point,
          stopPoint: pointIndex === segment.length - 1 && Boolean(target.stopPoint),
          sourceWaypoint: pointIndex === segment.length - 1
            && Boolean(target.sourceWaypoint),
          isGoal: targetIndex === sourceTargets.length - 1
            && pointIndex === segment.length - 1
        });
      });
      cursor = { ...target };
    }
    return planned;
  },

  _displayPlannedPath(robot, points) {
    if (!robot || robot.slotIndex !== App.activeSlotIndex || typeof RosManager === 'undefined') return;
    const checkbox = document.getElementById('chk-nav-path');
    if (checkbox) checkbox.checked = true;
    RosManager._navigationPath = [
      { x: robot.pose.x, y: robot.pose.y },
      ...Array.from(points || []).map(point => ({ x: point.x, y: point.y }))
    ];
    RosManager.requestRender?.();
  },

  _scanMessage(robot, rayCount = this._mappingScanRays) {
    if (!robot || !this._mapData || !this._mapInfo) return null;
    const rays = Math.max(36, Number(rayCount) || this._mappingScanRays);
    const angleMin = -Math.PI;
    const angleMax = Math.PI;
    const angleIncrement = (angleMax - angleMin) / rays;
    const rangeMin = 0.12;
    const rangeMax = this._mappingRangeMax;
    const step = this._mapInfo.resolution;
    const ranges = new Array(rays);

    for (let index = 0; index < rays; index += 1) {
      const localAngle = angleMin + index * angleIncrement;
      const worldAngle = robot.pose.yaw + localAngle;
      let measured = rangeMax;
      for (let range = rangeMin; range <= rangeMax; range += step) {
        const cell = this._worldToMapCell(
          robot.pose.x + Math.cos(worldAngle) * range,
          robot.pose.y + Math.sin(worldAngle) * range
        );
        if (!cell) {
          measured = Math.min(range, rangeMax);
          break;
        }
        if (this._mapData[cell.index] > 50) {
          measured = range;
          break;
        }
      }
      ranges[index] = measured;
    }

    return {
      header: {
        stamp: { secs: Math.floor(Date.now() / 1000), nsecs: 0 },
        frame_id: `${robot.robotId}/base_scan`
      },
      angle_min: angleMin,
      angle_max: angleMax,
      angle_increment: angleIncrement,
      time_increment: 0,
      scan_time: 0.4,
      range_min: rangeMin,
      range_max: rangeMax,
      ranges,
      intensities: ranges.map(range => range < rangeMax ? 100 : 0)
    };
  },

  _createVirtualMappingState(robot, mode) {
    const size = (this._mapInfo?.width || 0) * (this._mapInfo?.height || 0);
    const previous = mode === 'LIFELONG' ? robot.lastMappingSession : null;
    let mapData = new Int8Array(size).fill(-1);
    if (previous?.mapData?.length === size) {
      mapData = new Int8Array(previous.mapData);
    } else if (mode === 'LIFELONG' && robot.lastMappedData?.length === size) {
      mapData = new Int8Array(robot.lastMappedData);
    }

    if (mode === 'LIFELONG' && !robot.lastMappedData && this._mapData) {
      const seedRadius = 2.2;
      const { width, height, resolution, originX, originY } = this._mapInfo;
      for (let row = 0; row < height; row += 1) {
        const y = originY + (row + 0.5) * resolution;
        for (let col = 0; col < width; col += 1) {
          const x = originX + (col + 0.5) * resolution;
          if (Math.hypot(x - robot.pose.x, y - robot.pose.y) <= seedRadius) {
            mapData[row * width + col] = this._mapData[row * width + col];
          }
        }
      }
    }

    const knownCells = mapData.reduce(
      (count, value) => count + (value >= 0 ? 1 : 0),
      0
    );
    return {
      mode,
      mapData,
      knownCells,
      path: Array.from(previous?.path || []).map(point => ({ ...point })),
      graphNodes: Array.from(previous?.graphNodes || []).map(node => ({ ...node })),
      graphEdges: Array.from(previous?.graphEdges || []).map(edge => ({
        from: { ...edge.from },
        to: { ...edge.to }
      })),
      loopEdges: Array.from(previous?.loopEdges || []).map(edge => ({
        from: { ...edge.from },
        to: { ...edge.to }
      })),
      loopKeys: new Set(previous?.loopKeys || []),
      totalDistance: Number(previous?.totalDistance) || 0,
      coverage: Number(previous?.coverage) || 0,
      startedAt: Date.now()
    };
  },

  _snapshotVirtualMapping(robot) {
    const mapping = robot?.mapping;
    if (!mapping?.mapData?.length) return null;
    return {
      mapData: new Int8Array(mapping.mapData),
      path: Array.from(mapping.path || []).map(point => ({ ...point })),
      graphNodes: Array.from(mapping.graphNodes || []).map(node => ({ ...node })),
      graphEdges: Array.from(mapping.graphEdges || []).map(edge => ({
        from: { ...edge.from },
        to: { ...edge.to }
      })),
      loopEdges: Array.from(mapping.loopEdges || []).map(edge => ({
        from: { ...edge.from },
        to: { ...edge.to }
      })),
      loopKeys: Array.from(mapping.loopKeys || []),
      totalDistance: Number(mapping.totalDistance) || 0,
      coverage: Number(mapping.coverage) || 0
    };
  },

  _setVirtualMappingMode(robot, requestedMode) {
    if (!robot) return;
    const mode = String(requestedMode || 'NAV').trim().toUpperCase();
    if (!['NAV', 'SLAM', 'LIFELONG'].includes(mode)) return;
    if (robot.mappingMode === mode && (mode === 'NAV' || robot.mapping)) return;

    if (mode === 'NAV') {
      if (robot.mapping?.mapData?.length) {
        robot.lastMappedData = new Int8Array(robot.mapping.mapData);
        robot.lastMappingSession = this._snapshotVirtualMapping(robot);
      }
      robot.mappingMode = 'NAV';
      if (robot.workState === 10) robot.workState = 0;
    } else {
      robot.mappingMode = mode;
      robot.mapping = this._createVirtualMappingState(robot, mode);
      robot.workState = 10;
      const scan = this._scanMessage(robot);
      if (scan) this._updateVirtualMappingRobot(robot, scan);
    }

    if (robot.slotIndex === App.activeSlotIndex) {
      this._slamMode = mode;
      this._workState = robot.workState;
      RosManager._handleSlotWorkState?.(robot.slotIndex, { workstate: robot.workState });
      this._updateVirtualMappingUi(robot);
    }
    this._publishVirtualRoutineStatus(robot);
    if (mode === 'NAV') this._publishVirtualMaps();
    else this._publishVirtualMappingProducts();
  },

  setMappingMode(slotIndex, mode) {
    const robot = this.virtualRobots.get(slotIndex);
    if (!this.enabled || !robot) return false;
    this._setVirtualMappingMode(robot, mode);
    return true;
  },

  saveActiveMap() {
    const robot = this.virtualRobots.get(App.activeSlotIndex);
    if (!this.enabled || !robot?.mapping?.mapData?.length || robot.mappingMode === 'NAV') {
      return false;
    }
    robot.savedNavMap = new Int8Array(robot.mapping.mapData);
    robot.savedMapName = 'map';
    robot.lastMappedData = new Int8Array(robot.mapping.mapData);
    robot.lastMappingSession = this._snapshotVirtualMapping(robot);
    return true;
  },

  _updateVirtualMappingRobot(robot, scan = null) {
    const mapping = robot?.mapping;
    if (!mapping || robot.mappingMode === 'NAV' || !this._mapInfo || !this._mapData) return;
    const sample = scan || this._scanMessage(robot);
    if (!sample) return;

    const { resolution } = this._mapInfo;
    const freeRadiusCells = Math.max(1, Math.ceil(0.28 / resolution));
    const robotCell = this._worldToMapCell(robot.pose.x, robot.pose.y);
    if (robotCell) {
      for (let rowOffset = -freeRadiusCells; rowOffset <= freeRadiusCells; rowOffset += 1) {
        for (let colOffset = -freeRadiusCells; colOffset <= freeRadiusCells; colOffset += 1) {
          if (Math.hypot(rowOffset, colOffset) > freeRadiusCells) continue;
          const row = robotCell.row + rowOffset;
          const col = robotCell.col + colOffset;
          if (row < 0 || row >= this._mapInfo.height || col < 0 || col >= this._mapInfo.width) continue;
          this._setVirtualMappingCell(mapping, row * this._mapInfo.width + col, 0);
        }
      }
    }

    const rayStride = Math.max(1, Math.floor(sample.ranges.length / 120));
    for (let index = 0; index < sample.ranges.length; index += rayStride) {
      const measured = Math.min(Number(sample.ranges[index]) || sample.range_max, sample.range_max);
      const angle = robot.pose.yaw + sample.angle_min + index * sample.angle_increment;
      for (let range = sample.range_min; range <= measured; range += resolution) {
        const cell = this._worldToMapCell(
          robot.pose.x + Math.cos(angle) * range,
          robot.pose.y + Math.sin(angle) * range
        );
        if (!cell) break;
        const hit = range + resolution >= measured && this._mapData[cell.index] > 50;
        this._setVirtualMappingCell(mapping, cell.index, hit ? 100 : 0);
        if (hit) break;
      }
    }

    this._recordVirtualMappingPose(robot);
    mapping.coverage = mapping.mapData.length > 0
      ? Math.round(mapping.knownCells / mapping.mapData.length * 100)
      : 0;
  },

  _setVirtualMappingCell(mapping, index, value) {
    if (!mapping?.mapData || index < 0 || index >= mapping.mapData.length) return;
    if (mapping.mapData[index] < 0 && value >= 0) mapping.knownCells += 1;
    mapping.mapData[index] = value;
  },

  _recordVirtualMappingPose(robot) {
    const mapping = robot?.mapping;
    if (!mapping) return;
    const pose = { ...robot.pose, stamp: Date.now() };
    const previousPath = mapping.path.at(-1);
    if (!previousPath) {
      mapping.path.push(pose);
    } else {
      const distance = Math.hypot(pose.x - previousPath.x, pose.y - previousPath.y);
      const heading = this._angleDistance(pose.yaw, previousPath.yaw);
      if (distance < 0.08 && heading < 0.12) return;
      mapping.totalDistance += distance;
      mapping.path.push(pose);
    }

    const previousNode = mapping.graphNodes.at(-1);
    const nodeDistance = previousNode
      ? Math.hypot(pose.x - previousNode.x, pose.y - previousNode.y)
      : Infinity;
    const nodeHeading = previousNode
      ? this._angleDistance(pose.yaw, previousNode.yaw)
      : Infinity;
    if (previousNode
        && nodeDistance < this._mappingNodeDistance
        && nodeHeading < this._mappingNodeHeading) {
      return;
    }

    const node = {
      id: mapping.graphNodes.length,
      x: pose.x,
      y: pose.y,
      yaw: pose.yaw
    };
    mapping.graphNodes.push(node);
    if (previousNode) mapping.graphEdges.push({ from: previousNode, to: node });

    if (mapping.graphNodes.length <= this._mappingLoopMinNodeGap
        || mapping.totalDistance < 4) {
      return;
    }
    const candidates = mapping.graphNodes.slice(
      0,
      Math.max(0, mapping.graphNodes.length - this._mappingLoopMinNodeGap)
    );
    let closest = null;
    let closestDistance = Infinity;
    candidates.forEach(candidate => {
      const distance = Math.hypot(node.x - candidate.x, node.y - candidate.y);
      if (distance > this._mappingLoopRadius
          || this._angleDistance(node.yaw, candidate.yaw) > 1.1
          || distance >= closestDistance) {
        return;
      }
      closest = candidate;
      closestDistance = distance;
    });
    if (!closest) return;
    const key = String(closest.id);
    if (mapping.loopKeys.has(key)) return;
    mapping.loopKeys.add(key);
    mapping.loopEdges.push({ from: closest, to: node });
  },

  _publishVirtualScans() {
    if (!this.enabled) return;
    this._virtualScanCycle += 1;
    this.virtualRobots.forEach(robot => {
      const isActive = robot.slotIndex === App.activeSlotIndex;
      const isBackgroundMapping = robot.mappingMode !== 'NAV'
        && this._virtualScanCycle % this._backgroundMappingDivisor === 0;
      if (!isActive && !isBackgroundMapping) return;
      const scan = this._scanMessage(robot);
      if (!scan) return;
      this.publisherSets.get(robot.robotId)?.scan?.publish(new ROSLIB.Message(scan));
      if (robot.mappingMode !== 'NAV') {
        this._updateVirtualMappingRobot(robot, scan);
      }
    });
    const active = this.virtualRobots.get(App.activeSlotIndex);
    if (active?.mappingMode !== 'NAV') this._updateVirtualMappingUi(active);
  },

  _mappingPathMessage(robot) {
    const stamp = { secs: Math.floor(Date.now() / 1000), nsecs: 0 };
    return {
      header: { stamp, frame_id: 'map' },
      poses: Array.from(robot.mapping?.path || []).map(point => ({
        header: { stamp, frame_id: 'map' },
        pose: {
          position: { x: point.x, y: point.y, z: 0 },
          orientation: {
            x: 0,
            y: 0,
            z: Math.sin(point.yaw / 2),
            w: Math.cos(point.yaw / 2)
          }
        }
      }))
    };
  },

  _mappingGraphMessage(robot) {
    const mapping = robot.mapping;
    const stamp = { secs: Math.floor(Date.now() / 1000), nsecs: 0 };
    const marker = (namespace, id, extra = {}) => ({
      header: { stamp, frame_id: 'map' },
      ns: namespace,
      id,
      action: 0,
      ...extra
    });
    const pairPoints = edges => edges.flatMap(edge => ([
      { x: edge.from.x, y: edge.from.y, z: 0 },
      { x: edge.to.x, y: edge.to.y, z: 0 }
    ]));
    const markers = [
      {
        header: { stamp, frame_id: 'map' },
        action: 3,
        ns: '',
        id: 0
      },
      ...mapping.graphNodes.map(node => marker('slam_nodes', node.id, {
        type: 2,
        pose: {
          position: { x: node.x, y: node.y, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 }
        },
        scale: { x: 0.1, y: 0.1, z: 0.1 }
      })),
      marker('intra_slam_edges', 0, {
        type: 5,
        points: pairPoints(mapping.graphEdges)
      }),
      marker('loop_slam_edges', 0, {
        type: 5,
        points: pairPoints(mapping.loopEdges)
      })
    ];
    return { markers };
  },

  _mappingFootprintMessage(_robot) {
    return {
      header: {
        stamp: { secs: Math.floor(Date.now() / 1000), nsecs: 0 },
        frame_id: 'base_footprint'
      },
      polygon: {
        points: [
          { x: 0.32, y: 0.24, z: 0 },
          { x: -0.32, y: 0.24, z: 0 },
          { x: -0.32, y: -0.24, z: 0 },
          { x: 0.32, y: -0.24, z: 0 }
        ]
      }
    };
  },

  _publishVirtualRoutineStatus(robot) {
    const publishers = this.publisherSets.get(robot.robotId);
    const message = new ROSLIB.Message({ data: robot.mappingMode });
    publishers?.routineStatus?.publish(message);
    publishers?.operationMode?.publish(message);
  },

  _publishVirtualMappingProducts(forceAll = false) {
    if (!this.enabled && !this._starting) return;
    if (!forceAll) this._mappingProductCycle += 1;
    let activeMapMessage = null;
    this.virtualRobots.forEach(robot => {
      if (robot.mappingMode === 'NAV' || !robot.mapping) return;
      const isActive = robot.slotIndex === App.activeSlotIndex;
      const isBackgroundPublish = this._mappingProductCycle % this._backgroundMappingDivisor === 0;
      if (!forceAll && !isActive && !isBackgroundPublish) return;
      const publishers = this.publisherSets.get(robot.robotId);
      const mapMessage = this._mapMessage(robot.mapping.mapData);
      if (mapMessage) publishers?.map?.publish(new ROSLIB.Message(mapMessage));
      if (isActive) activeMapMessage = mapMessage;
      publishers?.mappingPath?.publish(new ROSLIB.Message(this._mappingPathMessage(robot)));
      publishers?.mappingFootprint?.publish(new ROSLIB.Message(this._mappingFootprintMessage(robot)));
      publishers?.slamGraph?.publish(new ROSLIB.Message(this._mappingGraphMessage(robot)));
      this._publishVirtualRoutineStatus(robot);
    });

    const active = this.virtualRobots.get(App.activeSlotIndex);
    if (active && active.mappingMode !== 'NAV' && active.mapping) {
      if (!activeMapMessage) activeMapMessage = this._mapMessage(active.mapping.mapData);
      if (activeMapMessage) RosManager.lastMapMsg = activeMapMessage;
      this._updateVirtualMappingUi(active);
      RosManager.requestRender();
    }
  },

  _updateVirtualMappingUi(robot) {
    const panel = document.getElementById('test-mapping-status');
    if (!panel) return;
    const mapping = robot && robot.mappingMode !== 'NAV' ? robot.mapping : null;
    panel.hidden = !this.enabled || !mapping;
    if (!mapping) return;
    const title = document.getElementById('test-mapping-status-title');
    const detail = document.getElementById('test-mapping-status-detail');
    if (title) {
      title.textContent = `가상 ${robot.mappingMode === 'LIFELONG' ? '부분 Mapping' : 'SLAM Mapping'}`;
    }
    if (detail) {
      detail.textContent = [
        `개척 ${mapping.coverage}%`,
        `경로 ${mapping.totalDistance.toFixed(1)}m`,
        `그래프 ${mapping.graphNodes.length}개`,
        `Loop ${mapping.loopEdges.length}회`
      ].join(' · ');
    }
  },

  startMappingDemo() {
    const robot = this.virtualRobots.get(App.activeSlotIndex);
    if (!this.enabled || !robot) {
      App.toast('Test Mode를 먼저 시작하세요', 'error');
      return;
    }
    if (robot.mappingMode === 'NAV' || !robot.mapping) {
      App.toast('SLAM 또는 Lifelong Mapping을 먼저 시작하세요', 'info');
      return;
    }
    if (robot.task) {
      App.toast('실행 중인 Task를 먼저 완료하거나 취소하세요', 'info');
      return;
    }

    const start = { ...robot.pose };
    const margin = 0.8;
    const minX = (this._mapInfo?.originX || -5) + margin;
    const minY = (this._mapInfo?.originY || -5) + margin;
    const maxX = (this._mapInfo?.originX || -5)
      + (this._mapInfo?.width || 200) * (this._mapInfo?.resolution || 0.05)
      - margin;
    const maxY = (this._mapInfo?.originY || -5)
      + (this._mapInfo?.height || 200) * (this._mapInfo?.resolution || 0.05)
      - margin;
    const directionX = start.x + 1.2 <= maxX ? 1 : -1;
    const directionY = start.y + 1.2 <= maxY ? 1 : -1;
    const x1 = Math.max(minX, Math.min(maxX, start.x + directionX * 1.2));
    const y1 = Math.max(minY, Math.min(maxY, start.y + directionY * 1.2));
    const actions = [
      [x1, start.y, directionX > 0 ? 0 : Math.PI],
      [x1, y1, directionY > 0 ? Math.PI / 2 : -Math.PI / 2],
      [start.x, y1, directionX > 0 ? Math.PI : 0],
      [start.x, start.y, directionY > 0 ? -Math.PI / 2 : Math.PI / 2],
      [start.x, start.y, start.yaw]
    ].map((args, index) => ({
      action_id: `mapping_loop_${index + 1}`,
      action_type: 0x01,
      action_args: args,
      action_params: []
    }));

    this.runTask(robot.slotIndex, {
      task_id: 'test_mapping_loop',
      loop_flag: 1,
      missions: [{ mission_id: 'virtual_environment_loop', actions }]
    }).then(() => {
      App.toast('가상 환경 순환주행을 시작했습니다', 'success');
    }).catch(error => {
      this._reportRuntimeFailure(error.message || '순환주행 시작 실패', 'task');
    });
  },

  _poseMessage(robot) {
    const pose = robot.pose;
    const qw = Math.cos(pose.yaw / 2);
    const qz = Math.sin(pose.yaw / 2);
    const covariance = Array(36).fill(0);
    covariance[0] = 0.00015;
    covariance[7] = 0.00015;
    covariance[35] = 0.00005;
    return {
      header: { stamp: { secs: Math.floor(Date.now() / 1000), nsecs: 0 }, frame_id: 'map' },
      pose: {
        pose: {
          position: { x: pose.x, y: pose.y, z: 0 },
          orientation: { x: 0, y: 0, z: qz, w: qw }
        },
        covariance
      }
    };
  },

  _publishVirtualFleetTelemetry() {
    if (!this.enabled) return;
    this.virtualRobots.forEach(robot => {
      const publishers = this.publisherSets.get(robot.robotId);
      publishers?.pose?.publish(new ROSLIB.Message(this._poseMessage(robot)));
      const slot = App.robotSlots[robot.slotIndex];
      if (slot) {
        slot.pose = { ...robot.pose };
        slot.workState = robot.workState;
      }
    });
    this._syncActiveVirtualRobot();
    this._fleetRenderTick += 1;
    if (this._fleetRenderTick % 3 === 0) {
      App.renderMonitoringCards();
      if (typeof FleetControl !== 'undefined' && FleetControl._active) {
        this.virtualRobots.forEach(robot => {
          FleetControl._updatePose(robot.slotIndex, robot.pose, 'test_mode');
        });
      }
    }
  },

  _publishVirtualBms() {
    if (!this.enabled) return;
    this.virtualRobots.forEach(robot => {
      if (robot.charging) robot.soc = Math.min(100, robot.soc + 0.08);
      else if (robot.workState === 1) robot.soc = Math.max(5, robot.soc - 0.025);
      else robot.soc = Math.max(5, robot.soc - 0.004);
      const voltage = 48 + robot.soc * 0.06;
      const current = robot.charging ? 2.5 : robot.workState === 1 ? -1.8 : -0.3;
      const data = [
        voltage, current, robot.soc, 95, 32,
        0, 0, voltage - 0.5, robot.soc * 5.12,
        0, 0, 0, 0, 0, 0, 0
      ];
      this.publisherSets.get(robot.robotId)?.bms?.publish(new ROSLIB.Message({ data }));
      const slot = App.robotSlots[robot.slotIndex];
      if (slot) {
        slot.bms = {
          voltage,
          current,
          soc: robot.soc,
          charging: robot.charging
        };
      }
    });
    App.refreshActiveBmsDisplay();
  },

  _publishVirtualCameras() {
    if (!this.enabled) return;
    const message = new ROSLIB.Message({ format: 'jpeg', data: this.TEST_IMAGE_JPEG });
    this.publisherSets.forEach(publishers => {
      publishers.cam1Depth?.publish(message);
      publishers.cam1Color?.publish(message);
      publishers.cam2Depth?.publish(message);
      publishers.cam2Color?.publish(message);
    });
  },

  _syncActiveVirtualRobot(forceMap = false) {
    const robot = this.virtualRobots.get(App.activeSlotIndex);
    if (!robot) return;
    this._pose = robot.pose;
    this._workState = robot.workState;
    this._bmsSOC = robot.soc;
    this._bmsCharging = robot.charging;
    this.publishers = this.publisherSets.get(robot.robotId) || {};
    RosManager.robotPose = { ...robot.pose };
    RosManager.displayPose(robot.pose);
    RosManager.displayWorkState(robot.workState);
    RosManager._handleRoutineStatus?.(robot.slotIndex, { data: robot.mappingMode });
    if (forceMap) {
      const message = this._mapMessage(
        robot.mappingMode === 'NAV'
          ? (robot.savedNavMap || this._mapData)
          : robot.mapping?.mapData
      );
      if (message) RosManager.lastMapMsg = message;
    }
    this._updateVirtualMappingUi(robot);
    RosManager.requestRender();
    App.refreshActiveBmsDisplay();
    if (typeof ActionSender !== 'undefined' && robot.task) {
      const actionCount = robot.task.actions.length;
      ActionSender._setTaskExecutionFeedback(
        robot.paused ? 'pause' : 'work',
        `${robot.robotId} · ${robot.task.taskId}`,
        `${robot.task.actionIndex + 1}/${actionCount} Actions · loop ${robot.completedLoops + 1}`
      );
    } else if (typeof ActionSender !== 'undefined') {
      ActionSender._setTaskExecutionFeedback('idle', `${robot.robotId} · Test Mode Task 대기`);
    }
  },

  runTask(slotIndex, request) {
    const robot = this.virtualRobots.get(slotIndex);
    if (!this.enabled || !robot) {
      return Promise.reject(new Error('Test Mode 가상 로봇을 찾을 수 없습니다'));
    }
    const actions = (request?.missions || []).flatMap(mission =>
      Array.from(mission?.actions || []).map(action => ({
        ...action,
        action_args: Array.from(action.action_args || []),
        action_params: Array.from(action.action_params || [])
      }))
    );
    if (actions.length === 0) {
      return Promise.reject(new Error('시뮬레이션할 Action이 없습니다'));
    }

    this._resetVirtualRobotTask(robot, false);
    if (slotIndex === App.activeSlotIndex) this._stopNavigation();
    robot.task = {
      taskId: request.task_id || 'test_task',
      actions,
      actionIndex: 0,
      loopFlag: Number.isFinite(Number(request.loop_flag)) ? Number(request.loop_flag) : 1
    };
    robot.taskLabel = robot.task.taskId;
    robot.completedLoops = 0;
    robot.workState = 1;
    this._notifyVirtualTaskFeedback(robot, 'work', 'Task 시작');
    App.addEvent(
      'action',
      `[TestMode] ${robot.robotId} Task 시작`,
      `${robot.task.taskId} · ${actions.length} actions`,
      'info'
    );
    return Promise.resolve({
      success: true,
      message: '[TestMode] virtual task accepted',
      error_code: 0
    });
  },

  controlTask(slotIndex, kind) {
    const robot = this.virtualRobots.get(slotIndex);
    if (!this.enabled || !robot) {
      return Promise.reject(new Error('Test Mode 가상 로봇을 찾을 수 없습니다'));
    }
    if (kind === 'pause') {
      if (!robot.task) return Promise.reject(new Error('실행 중인 Task가 없습니다'));
      robot.paused = true;
      robot.workState = 3;
      this._notifyVirtualTaskFeedback(robot, 'pause', 'Task 일시정지');
    } else if (kind === 'resume') {
      if (!robot.task) return Promise.reject(new Error('재개할 Task가 없습니다'));
      robot.paused = false;
      robot.workState = robot.currentAction?.state || 1;
      this._notifyVirtualTaskFeedback(robot, 'work', 'Task 재개');
    } else if (kind === 'cancel') {
      if (slotIndex === App.activeSlotIndex) this._stopNavigation();
      robot.workState = 4;
      this._notifyVirtualTaskFeedback(robot, 'cancel', 'Task 취소');
      this._resetVirtualRobotTask(robot, false);
      robot.workState = robot.mappingMode === 'NAV' ? 0 : 10;
    }
    this._publishVirtualFleetTelemetry();
    return Promise.resolve({ success: true, message: `[TestMode] ${kind}` });
  },

  onActiveRobotChanged(index) {
    if (!this.enabled || !this.virtualRobots.has(index)) return;
    const robot = this.virtualRobots.get(index);
    this.publishers = this.publisherSets.get(robot.robotId) || {};
    this._stopJogSubscription();
    this._stopSlamSubscription();
    this._jogVel = { lx: 0, az: 0 };
    this._startJogSubscription();
    this._startSlamSubscription();
    this._syncActiveVirtualRobot(true);
    this._refreshFleetUi();
  },

  _tickVirtualFleet(dt) {
    if (!this.enabled) return;
    this.virtualRobots.forEach(robot => {
      if (!robot.task || robot.paused) return;
      if (!robot.currentAction) this._startVirtualAction(robot);
      if (!robot.currentAction) return;
      if (this._tickVirtualAction(robot, dt)) this._completeVirtualAction(robot);
    });
  },

  _virtualActionParams(action) {
    const params = {};
    Array.from(action?.action_params || action?.params || []).forEach(param => {
      const name = param?.param_name ?? param?.name;
      if (!name) return;
      params[name] = param.value;
    });
    return params;
  },

  _virtualParamNumber(params, name, fallback, minimum, maximum) {
    const parsed = Number(params?.[name]);
    const value = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(minimum, Math.min(maximum, value));
  },

  _virtualParamBool(params, name, fallback) {
    if (!Object.prototype.hasOwnProperty.call(params || {}, name)) return fallback;
    const value = params[name];
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
  },

  setDriveSimulationOverride(profile) {
    const allowedKeys = [
      'maxTransVel', 'maxTransAcc', 'maxTransDeacc',
      'maxRotVel', 'maxRotAcc', 'maxRotDeacc',
      'minTransVel', 'minRotVel', 'xyGoalTolerance', 'yawGoalTolerance',
      'wpTolerance', 'arrivingDistance', 'responseTime', 'headingYaw',
      'driveGain', 'derivativeGain', 'passingDist',
      'collisionDetectRange', 'passingFlag', 'modelType'
    ];
    if (!profile) {
      this._driveSimulationProfileOverride = null;
      return;
    }
    this._driveSimulationProfileOverride = Object.fromEntries(
      allowedKeys
        .filter(key => Object.prototype.hasOwnProperty.call(profile, key))
        .map(key => [key, profile[key]])
    );
  },

  _applyDriveSimulationOverride(profile) {
    if (!this._driveSimulationProfileOverride) return profile;
    return {
      ...profile,
      ...this._driveSimulationProfileOverride,
      controllerSource: 'SR-AMR-Base + Engineer A/B override'
    };
  },

  _buildWaypointProfile(action, nextAction) {
    const params = this._virtualActionParams(action);
    const straightPath = this._virtualParamBool(params, 'straight_path', false);
    let avoidMode = this._virtualParamBool(params, 'avoid_mode', true);
    if (!Object.prototype.hasOwnProperty.call(params, 'avoid_mode')
        && Object.prototype.hasOwnProperty.call(params, 'non_avoid_mode')) {
      avoidMode = !this._virtualParamBool(params, 'non_avoid_mode', false);
    }
    const setLocalPlanner = Math.round(
      this._virtualParamNumber(params, 'set_local_planner', 0, 0, 3)
    );
    const motionDirection = Math.round(
      this._virtualParamNumber(params, 'motion_direction', 0, 0, 4)
    );
    const nextType = Number(nextAction?.action_type);
    const canPass = nextType === 0x01 || nextType === 0x15;
    const passingFlag = canPass
      && this._virtualParamBool(params, 'passing_flag', false);
    const plannerNames = ['Pure', 'TEB', 'MPC', 'DWA'];
    // Lightweight controller constants follow the defaults shipped in
    // SR-AMR-Base. Action parameters still take precedence when supplied.
    const plannerDefaults = [
      {
        maxTransAcc: 0.3,
        maxTransDeacc: 0.3,
        maxRotAcc: 0.3,
        maxRotDeacc: 0.3,
        minTransVel: 0.03,
        minRotVel: 0.03,
        arrivingDistance: 1.0,
        responseTime: 0.6,
        wpTolerance: 1.0,
        headingYaw: 0.8,
        driveGain: 1.2,
        derivativeGain: 0.08,
        departureThreshold: 0.03
      },
      {
        maxTransAcc: 0.2,
        maxTransDeacc: 0.2,
        maxRotAcc: 0.1,
        maxRotDeacc: 0.1,
        minTransVel: 0.03,
        minRotVel: 0.03,
        arrivingDistance: 1.0,
        responseTime: 0.5,
        wpTolerance: 0.7,
        headingYaw: 0.9,
        driveGain: 1.0,
        derivativeGain: 0.05,
        departureThreshold: 0.08
      },
      {
        maxTransAcc: 0.3,
        maxTransDeacc: 0.3,
        maxRotAcc: 0.25,
        maxRotDeacc: 0.25,
        minTransVel: 0.03,
        minRotVel: 0.03,
        arrivingDistance: 1.2,
        responseTime: 0.7,
        wpTolerance: 0.8,
        headingYaw: 1.0,
        driveGain: 1.35,
        derivativeGain: 0.06,
        departureThreshold: 0.1
      },
      {
        maxTransAcc: 0.5,
        maxTransDeacc: 0.5,
        maxRotAcc: 0.5,
        maxRotDeacc: 0.5,
        minTransVel: 0.05,
        minRotVel: 0.05,
        arrivingDistance: 0.8,
        responseTime: 0.4,
        wpTolerance: 0.6,
        headingYaw: 0.7,
        driveGain: 1.5,
        derivativeGain: 0.04,
        departureThreshold: 0.1
      }
    ];
    const controller = plannerDefaults[setLocalPlanner];
    let routeMode = 'GLOBAL';
    if (straightPath && avoidMode) routeMode = 'STRAIGHT+ROLLOUT';
    else if (straightPath) routeMode = 'STRAIGHT';
    else if (avoidMode) routeMode = 'GLOBAL+ROLLOUT';
    const actionModelType = Math.round(
      this._virtualParamNumber(params, 'model_type', 0, 0, 2)
    );
    const selectedDriveModel = this._selectedVirtualDriveModel();
    const modelType = selectedDriveModel === 'action'
      ? actionModelType
      : (selectedDriveModel === 'qd' ? 1 : 0);
    const profile = {
      maxTransVel: this._virtualParamNumber(params, 'max_trans_vel', 0.7, 0.05, 1.8),
      maxRotVel: this._virtualParamNumber(params, 'max_rot_vel', 0.6, 0.1, 1.8),
      xyGoalTolerance: this._virtualParamNumber(
        params, 'xy_goal_tolerance', 0.15, 0.02, 1
      ),
      yawGoalTolerance: this._virtualParamNumber(
        params, 'yaw_goal_tolerance', 0.05, 0.01, Math.PI
      ),
      passingFlag,
      passingDist: this._virtualParamNumber(params, 'passing_dist', 0.03, 0.01, 2),
      straightPath,
      avoidMode,
      roadWidth: avoidMode
        ? this._virtualParamNumber(params, 'road_width', 4, 0.5, 10)
        : 0.5,
      backwardDriving: this._virtualParamBool(params, 'backward_driving', false),
      actionModelType,
      modelType,
      driveModelSelection: selectedDriveModel,
      driveModelName: modelType === 1 ? 'QD' : (modelType === 2 ? 'TRAILER' : 'DD'),
      setLocalPlanner,
      motionDirection,
      plannerName: plannerNames[setLocalPlanner],
      routeMode,
      maxTransAcc: this._virtualParamNumber(
        params, 'max_trans_acc', controller.maxTransAcc, 0.05, 3
      ),
      maxTransDeacc: this._virtualParamNumber(
        params, 'max_trans_deacc', controller.maxTransDeacc, 0.05, 3
      ),
      maxRotAcc: this._virtualParamNumber(
        params, 'max_rot_acc', controller.maxRotAcc, 0.05, 3
      ),
      maxRotDeacc: this._virtualParamNumber(
        params, 'max_rot_deacc', controller.maxRotDeacc, 0.05, 3
      ),
      minTransVel: this._virtualParamNumber(
        params, 'min_trans_vel', controller.minTransVel, 0, 0.5
      ),
      minRotVel: this._virtualParamNumber(
        params, 'min_rot_vel', controller.minRotVel, 0, 0.8
      ),
      arrivingDistance: this._virtualParamNumber(
        params, 'arriving_distance', controller.arrivingDistance, 0.1, 5
      ),
      responseTime: this._virtualParamNumber(
        params, 'response_time', controller.responseTime, 0, 5
      ),
      wpTolerance: this._virtualParamNumber(
        params, 'wp_tolerance', controller.wpTolerance, 0.05, 2
      ),
      headingYaw: this._virtualParamNumber(
        params, 'heading_yaw', controller.headingYaw, 0.1, Math.PI
      ),
      driveGain: controller.driveGain,
      derivativeGain: controller.derivativeGain,
      departureThreshold: controller.departureThreshold,
      // Backward-compatible aliases used by a few test helpers.
      acceleration: this._virtualParamNumber(
        params, 'max_trans_acc', controller.maxTransAcc, 0.05, 3
      ),
      headingGate: controller.departureThreshold,
      controllerSource: 'SR-AMR-Base'
    };
    return this._applyDriveSimulationOverride(profile);
  },

  _buildTrajectoryProfile(action, nextAction) {
    const params = this._virtualActionParams(action);
    const profile = this._buildWaypointProfile(action, nextAction);
    const laneDirection = Math.round(
      this._virtualParamNumber(params, 'lane_direction', 0, 0, 5)
    );
    const laneType = Math.round(
      this._virtualParamNumber(params, 'lane_type', 0, 0, 2)
    );
    const drivingType = Math.round(
      this._virtualParamNumber(params, 'driving_type', 1, 0, 5)
    );
    const backwardLane = laneDirection >= 3;
    const rollout = laneType !== 2 && (drivingType === 1 || drivingType === 3);
    const offLaneAvoidance = laneType === 2 && drivingType === 3;
    const laneTypeNames = ['STRICT', 'SMOOTH', 'OFF_LANE'];
    const drivingTypeNames = [
      'FOLLOWING', 'OVERTAKE', 'STOP_AND_GO',
      'OBSTACLE_AVOIDANCE', 'CARRIAGEWAY', 'BYPASS'
    ];
    const laneDirectionNames = [
      'FORWARD', 'FORWARD_LEFT', 'FORWARD_RIGHT',
      'BACKWARD', 'BACKWARD_LEFT', 'BACKWARD_RIGHT'
    ];
    profile.backwardDriving = profile.backwardDriving || backwardLane;
    profile.straightPath = !offLaneAvoidance;
    profile.avoidMode = rollout || offLaneAvoidance;
    profile.roadWidth = this._virtualParamNumber(params, 'road_width', 4, 0.5, 10);
    profile.routeMode = laneTypeNames[laneType]
      + (rollout ? '+ROLLOUT' : offLaneAvoidance ? '+COSTMAP' : '');
    profile.laneName = String(params.lane_name || 'lane_tmp');
    profile.laneDirection = laneDirection;
    profile.laneDirectionName = laneDirectionNames[laneDirection];
    profile.laneType = laneType;
    profile.laneTypeName = laneTypeNames[laneType];
    profile.drivingType = drivingType;
    profile.drivingTypeName = drivingTypeNames[drivingType];
    profile.stopAndGo = drivingType === 2;
    profile.qrCorrectionMode = this._virtualParamBool(
      params, 'qr_correction_mode', false
    );
    profile.syncModeEnabled = this._virtualParamBool(
      params, 'sync_mode_enabled', false
    );
    profile.usingBasicFootprint = this._virtualParamBool(
      params, 'using_basic_footprint', false
    );
    profile.collisionDetectRange = this._virtualParamNumber(
      params, 'collision_detect_range', 0.15, 0, 2
    );
    profile.safetyFootprint = profile.usingBasicFootprint ? 'BASIC' : 'LOAD_AWARE';
    return this._applyDriveSimulationOverride(profile);
  },

  _navigationOptionsForProfile(profile) {
    if (!profile?.straightPath) return { mode: 'global' };
    if (!profile.avoidMode) return { mode: 'straight' };
    return {
      mode: 'straight-rollout',
      corridorWidth: profile.roadWidth
    };
  },

  _trajectoryTargetsFromArgs(args, profile) {
    const values = Array.from(args || []);
    const finalTheta = Number(values.at(-1)) || 0;
    const targets = [];
    for (let index = 0; index + 1 < values.length - 1; index += 2) {
      targets.push({
        x: Number(values[index]) || 0,
        y: Number(values[index + 1]) || 0,
        theta: 0,
        sourceWaypoint: true
      });
    }
    if (profile?.laneDirection >= 3) targets.reverse();
    targets.forEach((target, index) => {
      const next = targets[index + 1];
      target.theta = next
        ? Math.atan2(next.y - target.y, next.x - target.x)
        : finalTheta;
      target.stopPoint = Boolean(profile?.stopAndGo && index < targets.length - 1);
    });
    if (profile?.laneType !== 1 || targets.length < 3) return targets;

    const smoothed = [{ ...targets[0] }];
    for (let index = 1; index < targets.length - 1; index += 1) {
      const previous = targets[index - 1];
      const current = targets[index];
      const next = targets[index + 1];
      smoothed.push({
        x: previous.x * 0.2 + current.x * 0.8,
        y: previous.y * 0.2 + current.y * 0.8,
        theta: Math.atan2(next.y - previous.y, next.x - previous.x),
        sourceWaypoint: false
      });
      smoothed.push({
        x: current.x * 0.8 + next.x * 0.2,
        y: current.y * 0.8 + next.y * 0.2,
        theta: Math.atan2(next.y - current.y, next.x - current.x),
        sourceWaypoint: false,
        stopPoint: current.stopPoint
      });
    }
    smoothed.push({ ...targets.at(-1) });
    return smoothed;
  },

  _startVirtualAction(robot) {
    const task = robot.task;
    if (!task) return;
    const action = task.actions[task.actionIndex];
    if (!action) {
      this._completeVirtualTaskLoop(robot);
      return;
    }
    const type = Number(action.action_type);
    const args = Array.from(action.action_args || []);
    const current = {
      action,
      type,
      state: 1,
      elapsed: 0,
      duration: 0.8,
      navQueue: [],
      currentSpeed: Number(robot.motionCarry?.speed) || 0,
      currentAngularSpeed: Number(robot.motionCarry?.angularSpeed) || 0,
      previousHeadingError: null,
      controllerMode: 'WAIT'
    };
    robot.motionCarry = null;

    if (type === 0x01) {
      current.profile = this._buildWaypointProfile(
        action,
        task.actions[task.actionIndex + 1]
      );
      current.navQueue = [{
        x: Number(args[0]) || 0,
        y: Number(args[1]) || 0,
        theta: Number(args[2]) || 0
      }];
    } else if (type === 0x15) {
      current.profile = this._buildTrajectoryProfile(
        action,
        task.actions[task.actionIndex + 1]
      );
      current.navQueue = this._trajectoryTargetsFromArgs(args, current.profile);
    } else if (type === 0x02) {
      const moveType = Number(args[0]) || 0;
      const amount = Number(args[1]) || 0;
      if (moveType === 0) {
        current.navQueue = [{
          x: robot.pose.x + Math.cos(robot.pose.yaw) * amount,
          y: robot.pose.y + Math.sin(robot.pose.yaw) * amount,
          theta: robot.pose.yaw
        }];
      } else {
        current.navQueue = [{
          x: robot.pose.x,
          y: robot.pose.y,
          theta: robot.pose.yaw + amount * Math.PI / 180
        }];
      }
    } else if (type === 0x19) {
      const localX = Number(args[0]) || 0;
      const localY = Number(args[1]) || 0;
      current.navQueue = [{
        x: robot.pose.x + Math.cos(robot.pose.yaw) * localX - Math.sin(robot.pose.yaw) * localY,
        y: robot.pose.y + Math.sin(robot.pose.yaw) * localX + Math.cos(robot.pose.yaw) * localY,
        theta: robot.pose.yaw
      }];
    } else if (type === 0x07) {
      current.state = 7;
      current.duration = Math.max(0, Number(args[0]) || 0);
    } else if (type === 0x08) {
      current.state = 2;
      current.duration = 1.5;
    } else if (type === 0x10 || type === 0x12) {
      current.state = 8;
      const distance = Number(args[0]) || -0.5;
      current.navQueue = [{
        x: robot.pose.x + Math.cos(robot.pose.yaw) * distance,
        y: robot.pose.y + Math.sin(robot.pose.yaw) * distance,
        theta: robot.pose.yaw
      }];
    } else if (type === 0x17) {
      current.navQueue = [{
        x: Number(args[0]) || 0,
        y: Number(args[1]) || 0,
        theta: Number(args[2]) || 0
      }];
    }

    if (current.navQueue.length > 0) {
      const planned = this._planNavigationQueue(
        robot.pose,
        current.navQueue,
        this._navigationOptionsForProfile(current.profile)
      );
      if (!planned) {
        this._failVirtualTask(
          robot,
          this._lastPlanError || '검은 장애물을 피해 이동 경로를 만들 수 없습니다.'
        );
        return;
      }
      current.navQueue = planned;
      robot.plannedPath = planned.map(point => ({ ...point }));
      this._displayPlannedPath(robot, robot.plannedPath);
    }
    current.navTarget = current.navQueue.shift() || null;
    robot.currentAction = current;
    robot.workState = current.state;
    this._notifyVirtualTaskFeedback(
      robot,
      current.state === 7 ? 'pause' : 'work',
      current.profile
        ? `${action.action_id || `Action_${task.actionIndex + 1}`} · `
          + `${current.profile.routeMode} · ${current.profile.plannerName} · `
          + `${current.profile.driveModelName} · `
          + `${current.profile.maxTransVel.toFixed(1)}m/s`
          + (current.profile.passingFlag
            ? ` · PASS ${current.profile.passingDist.toFixed(2)}m`
            : '')
          + (current.type === 0x15
            ? ` · ${current.profile.drivingTypeName}`
              + ` · 충돌 ${current.profile.collisionDetectRange.toFixed(2)}m`
            : '')
        : `${action.action_id || `Action_${task.actionIndex + 1}`} 실행`
    );
  },

  _tickVirtualAction(robot, dt) {
    const current = robot.currentAction;
    if (!current) return false;
    current.elapsed += dt;
    if (current.navTarget) {
      if (this._moveVirtualRobot(robot, current.navTarget, dt, current)) {
        current.navTarget = current.navQueue.shift() || null;
        if (!current.navTarget) return true;
      }
      return false;
    }
    if (current.type === 0x07 && current.duration === 0) return false;
    return current.elapsed >= current.duration;
  },

  _approachVirtualValue(currentValue, targetValue, acceleration, deceleration, dt) {
    const current = Number(currentValue) || 0;
    const target = Number(targetValue) || 0;
    const sameDirection = current === 0 || target === 0
      || Math.sign(current) === Math.sign(target);
    const increasing = sameDirection && Math.abs(target) > Math.abs(current);
    const rate = Math.max(0.001, increasing ? acceleration : deceleration);
    const delta = target - current;
    const step = Math.min(Math.abs(delta), rate * Math.max(0, Number(dt) || 0));
    return current + Math.sign(delta) * step;
  },

  _virtualCurveSpeedLimit(maxVelocity, curveHeadingError) {
    const maximum = Math.max(0.01, Number(maxVelocity) || 0.01);
    const error = Math.abs(Number(curveHeadingError) || 0);
    const calculated = maximum
      * (0.05 + Math.exp(-(maximum * maximum + 0.5) * 3 * error));
    return Math.max(maximum * 0.18, Math.min(maximum, calculated));
  },

  _moveVirtualRobot(robot, target, dt, current = {}) {
    const profile = current.profile || {
      maxTransVel: 1,
      maxRotVel: 1.2,
      xyGoalTolerance: 0.03,
      yawGoalTolerance: 0.035,
      passingFlag: false,
      passingDist: 0.03,
      maxTransAcc: 0.3,
      maxTransDeacc: 0.3,
      maxRotAcc: 0.3,
      maxRotDeacc: 0.3,
      minTransVel: 0.03,
      minRotVel: 0.03,
      arrivingDistance: 1,
      responseTime: 0.6,
      wpTolerance: 1,
      headingYaw: 0.8,
      driveGain: 1.2,
      derivativeGain: 0.08,
      departureThreshold: 0.03,
      backwardDriving: false,
      setLocalPlanner: 0,
      motionDirection: 1,
      modelType: 0
    };
    const dx = target.x - robot.pose.x;
    const dy = target.y - robot.pose.y;
    const distance = Math.hypot(dx, dy);
    const isGoal = Boolean(target.isGoal);
    const positionTolerance = isGoal
      ? (profile.passingFlag ? profile.passingDist : profile.xyGoalTolerance)
      : 0.05;
    if (distance > positionTolerance) {
      const pathYaw = Math.atan2(dy, dx);
      const forwardError = this._normalizeAngle(pathYaw - robot.pose.yaw);
      const automaticBackward = profile.setLocalPlanner === 2
        && profile.motionDirection === 0
        && Math.abs(forwardError) > Math.PI / 2;
      const backward = profile.backwardDriving
        || profile.motionDirection === 2
        || automaticBackward;
      const holonomic = profile.modelType === 1;
      const bodyPathYaw = backward
        ? this._normalizeAngle(pathYaw + Math.PI)
        : pathYaw;
      const headingError = holonomic
        ? 0
        : this._normalizeAngle(bodyPathYaw - robot.pose.yaw);
      const speed = Math.max(0, Number(current.currentSpeed) || 0);
      const lookaheadDistance = Math.max(
        0.32 + speed,
        (Number(profile.wpTolerance) || 0.5) + speed
      );
      let desiredSpeed = profile.maxTransVel;
      let controllerMode = 'DRIVE';

      const nextTarget = current.navQueue?.[0];
      let curveHeadingError = 0;
      if (nextTarget) {
        const nextPathYaw = Math.atan2(
          nextTarget.y - target.y,
          nextTarget.x - target.x
        );
        curveHeadingError = Math.abs(this._normalizeAngle(nextPathYaw - pathYaw));
        if (distance < lookaheadDistance && curveHeadingError > 0.1) {
          const curveLimit = this._virtualCurveSpeedLimit(
            profile.maxTransVel,
            curveHeadingError
          );
          const influence = Math.max(0, Math.min(1, 1 - distance / lookaheadDistance));
          desiredSpeed = Math.min(
            desiredSpeed,
            profile.maxTransVel * (1 - influence) + curveLimit * influence
          );
          controllerMode = 'CURVE';
        }
      }

      if (isGoal && !profile.passingFlag) {
        const deceleration = Math.max(0.05, profile.maxTransDeacc);
        const dynamicArrivalDistance = speed * speed / (2 * deceleration)
          + speed * profile.responseTime;
        const arrivalThreshold = Math.max(
          positionTolerance * 2,
          Math.min(
            profile.arrivingDistance + speed * profile.responseTime,
            Math.max(profile.arrivingDistance * 0.25, dynamicArrivalDistance)
          )
        );
        if (distance < arrivalThreshold) {
          const ratio = Math.max(0, Math.min(1, distance / arrivalThreshold));
          desiredSpeed = Math.min(
            desiredSpeed,
            profile.minTransVel
              + (profile.maxTransVel - profile.minTransVel) * ratio
          );
          controllerMode = 'ARRIVE';
        }
      }

      if (!holonomic) {
        const headingMagnitude = Math.abs(headingError);
        const rotateBeforeDriveThreshold = Math.max(
          Number(profile.departureThreshold) || 0,
          0.12
        );
        if (headingMagnitude > profile.headingYaw
            || headingMagnitude > rotateBeforeDriveThreshold) {
          desiredSpeed = 0;
          controllerMode = 'ROTATE';
        } else if (headingMagnitude > 0.01) {
          const headingLimit = profile.maxTransVel * Math.min(
            1,
            0.1 + Math.exp(
              -(profile.maxTransVel * profile.maxTransVel + 0.5) * headingMagnitude
            )
          );
          desiredSpeed = Math.min(desiredSpeed, headingLimit);
        }
      }
      if (profile.modelType === 2 && curveHeadingError > 0.1) {
        desiredSpeed = Math.min(desiredSpeed, profile.maxTransVel * 0.45);
      }

      if (isGoal && profile.collisionDetectRange > 0) {
        const obstacleDistance = this._virtualObstacleDistance(
          robot,
          pathYaw,
          profile.collisionDetectRange,
          profile.usingBasicFootprint
        );
        current.obstacleDistance = obstacleDistance;
        if (Number.isFinite(obstacleDistance)) {
          desiredSpeed = 0;
          current.controllerMode = 'COLLISION_STOP';
          const message = `collision_detect_range ${profile.collisionDetectRange.toFixed(2)}m `
            + '내 장애물을 감지해 안전 정지했습니다.';
          if (typeof current.onSafetyStop === 'function') current.onSafetyStop(message);
          else this._failVirtualTask(robot, message);
          return false;
        }
      }

      current.currentSpeed = this._approachVirtualValue(
        speed,
        Math.max(0, desiredSpeed),
        profile.maxTransAcc,
        profile.maxTransDeacc,
        dt
      );

      const previousError = Number.isFinite(current.previousHeadingError)
        ? current.previousHeadingError
        : headingError;
      const derivative = this._normalizeAngle(headingError - previousError)
        / Math.max(0.001, dt);
      let desiredAngularSpeed = holonomic
        ? 0
        : profile.driveGain * headingError
          + profile.derivativeGain * Math.max(-2, Math.min(2, derivative));
      const angularDeadband = Math.max(0.01, profile.yawGoalTolerance * 0.35);
      if (Math.abs(headingError) <= angularDeadband) {
        desiredAngularSpeed = 0;
      } else if (Math.abs(desiredAngularSpeed) < profile.minRotVel) {
        desiredAngularSpeed = Math.sign(headingError) * profile.minRotVel;
      }
      desiredAngularSpeed = Math.max(
        -profile.maxRotVel,
        Math.min(profile.maxRotVel, desiredAngularSpeed)
      );
      current.currentAngularSpeed = this._approachVirtualValue(
        current.currentAngularSpeed,
        desiredAngularSpeed,
        profile.maxRotAcc,
        profile.maxRotDeacc,
        dt
      );
      current.previousHeadingError = headingError;
      current.controllerMode = controllerMode;
      current.lookaheadDistance = lookaheadDistance;
      current.targetSpeed = desiredSpeed;
      current.curvature = distance > 0.001
        ? 2 * Math.sin(headingError) / distance
        : 0;

      if (!holonomic) {
        robot.pose.yaw = this._normalizeAngle(
          robot.pose.yaw + current.currentAngularSpeed * dt
        );
      }
      const step = Math.min(distance, current.currentSpeed * dt);
      // SR-AMR-Base DD odometry forces linear_y to zero and integrates linear_x
      // on the body yaw. Projecting DD directly onto pathYaw makes its body
      // appear to rotate while the robot slides sideways like a QD. Only the
      // holonomic QD follows the path vector independently from body heading.
      const travelYaw = holonomic
        ? pathYaw
        : this._normalizeAngle(robot.pose.yaw + (backward ? Math.PI : 0));
      const nextX = robot.pose.x + Math.cos(travelYaw) * step;
      const nextY = robot.pose.y + Math.sin(travelYaw) * step;
      if (step > 0 && !this._isPoseTraversable(nextX, nextY)) {
        // A DD can briefly point inside an inflated corner while turning onto
        // the next safe path segment. Stop linear motion and keep aligning
        // instead of either sliding sideways or immediately failing the Task.
        // A deliberately straight, non-avoidance action still reports the
        // collision as a safety stop, as requested by that action profile.
        if (!holonomic && (!profile.straightPath || profile.avoidMode)) {
          current.currentSpeed = 0;
          current.targetSpeed = 0;
          current.controllerMode = 'PATH_ALIGN';
          current.blockedMotionTicks = (Number(current.blockedMotionTicks) || 0) + 1;
          if (current.blockedMotionTicks < 120) return false;
        }
        const message = '주행 중 검은 장애물을 감지해 안전 정지했습니다.';
        if (typeof current.onSafetyStop === 'function') current.onSafetyStop(message);
        else this._failVirtualTask(robot, message);
        return false;
      }
      current.blockedMotionTicks = 0;
      robot.pose.x = nextX;
      robot.pose.y = nextY;
      robot.pose.yaw = this._normalizeAngle(robot.pose.yaw);
      return false;
    }

    if (isGoal && profile.passingFlag) {
      current.passCompletionDistance = distance;
      current.controllerMode = 'PASS';
      current.previousHeadingError = null;
      return true;
    }
    robot.pose.x = target.x;
    robot.pose.y = target.y;
    current.previousHeadingError = null;
    if (!isGoal) {
      if (target.stopPoint) {
        current.currentSpeed = 0;
        current.currentAngularSpeed = 0;
        current.controllerMode = 'STOP_AND_GO';
      } else {
        current.controllerMode = 'PASS';
      }
      return true;
    }
    current.currentSpeed = 0;
    const finalError = this._normalizeAngle(target.theta - robot.pose.yaw);
    if (Math.abs(finalError) > profile.yawGoalTolerance) {
      let desiredAngularSpeed = profile.driveGain * finalError;
      if (Math.abs(desiredAngularSpeed) < profile.minRotVel) {
        desiredAngularSpeed = Math.sign(finalError) * profile.minRotVel;
      }
      desiredAngularSpeed = Math.max(
        -profile.maxRotVel,
        Math.min(profile.maxRotVel, desiredAngularSpeed)
      );
      current.currentAngularSpeed = this._approachVirtualValue(
        current.currentAngularSpeed,
        desiredAngularSpeed,
        profile.maxRotAcc,
        profile.maxRotDeacc,
        dt
      );
      current.controllerMode = 'GOAL_ROTATE';
      robot.pose.yaw = this._normalizeAngle(
        robot.pose.yaw + Math.sign(finalError) * Math.min(
          Math.abs(finalError),
          Math.abs(current.currentAngularSpeed) * dt
        )
      );
      return false;
    }
    robot.pose.yaw = this._normalizeAngle(target.theta);
    current.currentAngularSpeed = 0;
    current.controllerMode = 'GOAL_REACHED';
    return true;
  },

  _virtualObstacleDistance(robot, travelYaw, detectRange, usingBasicFootprint) {
    const range = Math.max(0, Number(detectRange) || 0);
    if (range <= 0 || !this._mapInfo || !this._mapData) return Infinity;
    const lateralRadius = usingBasicFootprint ? 0.12 : 0.26;
    const sampleStep = Math.max(0.04, this._mapInfo.resolution || 0.05);
    const lateralSamples = [-lateralRadius, 0, lateralRadius];
    for (let distance = sampleStep; distance <= range; distance += sampleStep) {
      for (const lateral of lateralSamples) {
        const x = robot.pose.x
          + Math.cos(travelYaw) * distance
          + Math.cos(travelYaw + Math.PI / 2) * lateral;
        const y = robot.pose.y
          + Math.sin(travelYaw) * distance
          + Math.sin(travelYaw + Math.PI / 2) * lateral;
        const cell = this._worldToMapCell(x, y);
        if (!cell || Number(this._mapData[cell.index]) >= 50) return distance;
      }
    }
    return Infinity;
  },

  _normalizeAngle(value) {
    let angle = Number(value) || 0;
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  },

  _completeVirtualAction(robot) {
    const current = robot.currentAction;
    if (!current || !robot.task) return;
    if (current.type === 0x08) {
      robot.charging = Number(current.action.action_args?.[0]) === 1;
    } else if (current.type === 0x10 || current.type === 0x12) {
      robot.charging = false;
    }
    const nextAction = robot.task.actions[robot.task.actionIndex + 1];
    const nextType = Number(nextAction?.action_type);
    robot.motionCarry = current.profile?.passingFlag
      && (nextType === 0x01 || nextType === 0x15)
      ? {
        speed: current.currentSpeed,
        angularSpeed: current.currentAngularSpeed,
        completedAtDistance: current.passCompletionDistance
      }
      : null;
    robot.task.actionIndex += 1;
    robot.currentAction = null;
    robot.plannedPath = [];
    if (robot.slotIndex === App.activeSlotIndex) {
      RosManager._navigationPath = [];
      RosManager.requestRender?.();
    }
    robot.workState = 1;
    if (robot.task.actionIndex >= robot.task.actions.length) {
      this._completeVirtualTaskLoop(robot);
    }
  },

  _completeVirtualTaskLoop(robot) {
    const task = robot.task;
    if (!task) return;
    robot.completedLoops += 1;
    const repeat = task.loopFlag === 0 || robot.completedLoops < Math.max(1, task.loopFlag);
    if (repeat) {
      task.actionIndex = 0;
      robot.currentAction = null;
      robot.workState = 1;
      this._notifyVirtualTaskFeedback(robot, 'work', `반복 ${robot.completedLoops + 1}회차`);
      return;
    }
    const taskId = task.taskId;
    this._resetVirtualRobotTask(robot, false);
    robot.workState = robot.mappingMode === 'NAV' ? 0 : 10;
    this._notifyVirtualTaskFeedback(robot, 'complete', 'Task 완료', taskId);
    App.addEvent('action', `[TestMode] ${robot.robotId} Task 완료`, taskId, 'success');
  },

  _resetVirtualRobotTask(robot, setIdle = true) {
    robot.task = null;
    robot.currentAction = null;
    robot.navTarget = null;
    robot.navQueue = [];
    robot.plannedPath = [];
    robot.paused = false;
    robot.taskLabel = '';
    robot.completedLoops = 0;
    robot.motionCarry = null;
    if (setIdle) robot.workState = robot.mappingMode === 'NAV' ? 0 : 10;
  },

  _failVirtualTask(robot, message) {
    if (!robot) return;
    const taskId = robot.task?.taskId || 'Test Mode Task';
    const failure = this._diagnoseFailure(message, 'task');
    const failureMessage = `원인: ${failure.cause} · 조치: ${failure.action}`;
    this._lastFailure = failure;
    this._notifyVirtualTaskFeedback(robot, 'error', failureMessage, taskId);
    App.addEvent(
      'action',
      `[TestMode] ${robot.robotId} 주행 중단`,
      `${failureMessage} · 기술 정보: ${failure.detail}`,
      'error'
    );
    if (robot.slotIndex === App.activeSlotIndex) {
      this.updateUi();
      App.toast(failureMessage, 'error');
      RosManager._navigationPath = [];
      RosManager.requestRender?.();
    }
    this._resetVirtualRobotTask(robot, false);
    robot.workState = robot.mappingMode === 'NAV' ? 0 : 10;
  },

  _notifyVirtualTaskFeedback(robot, state, message, taskId = '') {
    if (typeof ActionSender === 'undefined') return;
    const running = ActionSender._runningTasks?.get(robot.robotId);
    if (running) {
      running.state = state;
      running.actionIndex = robot.task?.actionIndex
        ?? (state === 'complete' ? Math.max(0, running.queue.length - 1) : running.actionIndex);
      running.loopCount = robot.completedLoops;
      ActionSender._syncActiveRunningTask?.();
    }
    if (robot.slotIndex !== App.activeSlotIndex) return;
    const detail = taskId || (robot.task
      ? `${robot.task.actionIndex + 1}/${robot.task.actions.length} Actions`
      : '');
    ActionSender._setTaskExecutionFeedback(
      state,
      `${robot.robotId} · ${message}`,
      detail
    );
  },

  // ── BMS (16-element realistic format) ──────────────────────
  publishBms() {
    if (!this.enabled || !this.publishers.bms) return;
    // Simulate slow SOC drain (or charge if docking/charging)
    if (this._bmsCharging) {
      this._bmsSOC = Math.min(100, this._bmsSOC + 0.05);
    } else if (this._workState === 1) {
      this._bmsSOC = Math.max(5, this._bmsSOC - 0.02);
    } else {
      this._bmsSOC = Math.max(5, this._bmsSOC - 0.005);
    }
    const soc = this._bmsSOC;
    const voltage = 48.0 + (soc / 100) * 6.0; // 48~54V
    const current = this._bmsCharging ? 2.5 : (this._workState === 1 ? -1.8 : -0.3);
    const soh = 95;
    const temp = 32.5 + Math.sin(this.tick / 20) * 2;
    const chargeT = this._bmsCharging ? Math.floor(this.tick / 2) : 0;
    const dischargeT = this._bmsCharging ? 0 : Math.floor(this.tick / 2);
    const restVoltage = voltage - 0.5;
    const restEnergy = soc * 5.12; // Wh estimate

    // 16-element array matching real BMS format
    const data = [
      voltage,     // [0] voltage
      current,     // [1] current (positive=charging)
      soc,         // [2] SOC %
      soh,         // [3] SOH %
      temp,        // [4] temperature
      chargeT,     // [5] charge cycles
      dischargeT,  // [6] discharge cycles
      restVoltage, // [7] rest voltage
      restEnergy,  // [8] rest energy Wh
      0, 0, 0, 0, 0, 0, 0 // [9-15] status flags
    ];
    this.publishers.bms.publish(new ROSLIB.Message({ data }));
  },

  // ── Work State ──────────────────────────────────────────────
  publishWorkState() {
    if (!this.enabled) return;
    const idx = App.activeSlotIndex;
    if (idx >= 0) {
      RosManager._handleSlotWorkState(idx, { workstate: this._workState });
    }
  },

  setWorkState(state) {
    this._workState = state;
    // Update charging flag only if not manually toggled
    if (!this._bmsChargingManual) {
      this._bmsCharging = (state === 2 || state === 7); // DOCK or CHARGE
    }
    if (this.enabled) {
      const idx = App.activeSlotIndex;
      if (idx >= 0) {
        const robot = this.virtualRobots.get(idx);
        if (robot) {
          robot.workState = state;
          if (!this._bmsChargingManual) robot.charging = this._bmsCharging;
        }
        RosManager._handleSlotWorkState(idx, { workstate: state });
      }
    }
  },

  toggleActiveCharging() {
    const robot = this.virtualRobots.get(App.activeSlotIndex);
    if (robot) {
      return this.setActiveCharging(!robot.charging);
    }
    this._bmsCharging = !this._bmsCharging;
    this._bmsChargingManual = true;
    return this._bmsCharging;
  },

  setActiveCharging(enabled) {
    const charging = Boolean(enabled);
    const robot = this.virtualRobots.get(App.activeSlotIndex);
    if (robot) robot.charging = charging;
    this._bmsCharging = charging;
    this._bmsChargingManual = true;
    if (this.enabled) this._publishVirtualBms();
    return charging;
  },

  // ── Robot Pose ──────────────────────────────────────────────
  publishPose() {
    if (!this.enabled || !this.publishers.pose) return;

    // Converge estimate offset toward zero (simulates AMCL correction)
    // ~90% convergence in 3 seconds at 10Hz (30 ticks, factor ≈ 0.93)
    const CONVERGE = 0.93;
    const off = this._poseEstOffset;
    off.x *= CONVERGE;
    off.y *= CONVERGE;
    off.yaw *= CONVERGE;
    // Snap to zero when negligible
    if (Math.abs(off.x) < 0.001 && Math.abs(off.y) < 0.001 && Math.abs(off.yaw) < 0.001) {
      off.x = 0; off.y = 0; off.yaw = 0;
    }

    // Estimated pose = true pose + offset
    const ex = this._pose.x + off.x;
    const ey = this._pose.y + off.y;
    const eYaw = this._pose.yaw + off.yaw;

    // Add slight jitter (±5mm position, ±0.15° orientation)
    const nx = ex + this._gaussRandom(0, 0.005);
    const ny = ey + this._gaussRandom(0, 0.005);
    const nYaw = eYaw + this._gaussRandom(0, 0.0025);

    const qw = Math.cos(nYaw / 2);
    const qz = Math.sin(nYaw / 2);

    // Covariance scales with offset distance (larger when estimate is off)
    const offDist = Math.sqrt(off.x * off.x + off.y * off.y);
    const baseCov = 0.0001;
    const extraCov = offDist * 0.5; // larger uncertainty when offset is large
    const cov = Array(36).fill(0);
    cov[0]  = baseCov + extraCov + Math.random() * 0.00005;
    cov[7]  = baseCov + extraCov + Math.random() * 0.00005;
    cov[35] = 0.00003 + Math.abs(off.yaw) * 0.1 + Math.random() * 0.00002;
    cov[1] = cov[6] = (Math.random() - 0.5) * 0.00003;

    this.publishers.pose.publish(new ROSLIB.Message({
      header: { stamp: { secs: Math.floor(Date.now() / 1000), nsecs: 0 }, frame_id: 'map' },
      pose: {
        pose: {
          position: { x: nx, y: ny, z: 0 },
          orientation: { x: 0, y: 0, z: qz, w: qw }
        },
        covariance: cov
      }
    }));
  },

  // ── Map (200x200, cached for ray-casting) ──────────────────
  _buildMapCache() {
    const W = 200;
    const H = 200;
    const res = 0.05; // 5cm/cell → 10m x 10m map
    const data = new Int8Array(W * H); // 0 = free

    const set = (r, c, v) => { if (r >= 0 && r < H && c >= 0 && c < W) data[r * W + c] = v; };
    const hWall = (r, c1, c2) => { for (let c = c1; c <= c2; c++) set(r, c, 100); };
    const vWall = (c, r1, r2) => { for (let r = r1; r <= r2; r++) set(r, c, 100); };

    // Outer walls
    hWall(0, 0, W - 1); hWall(H - 1, 0, W - 1);
    vWall(0, 0, H - 1); vWall(W - 1, 0, H - 1);

    // Horizontal corridor walls with door gaps
    hWall(60, 1, 70); hWall(60, 85, W - 2);
    hWall(140, 1, 55); hWall(140, 70, 130); hWall(140, 145, W - 2);

    // Vertical center wall with door gaps
    vWall(100, 1, 25); vWall(100, 40, 59);
    vWall(100, 61, 100); vWall(100, 115, 139);
    vWall(100, 141, 165); vWall(100, 180, H - 2);

    // Internal room walls
    vWall(50, 61, 100); vWall(50, 115, 139);
    hWall(100, 1, 20); hWall(100, 35, 49);
    vWall(150, 1, 25); vWall(150, 40, 59);
    vWall(150, 141, 170); vWall(150, 185, H - 2);

    // Pillars/obstacles (3x3 blocks)
    const pillars = [[30,30],[30,170],[170,30],[170,170],[100,50]];
    for (const [pr, pc] of pillars) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          set(pr + dr, pc + dc, 100);
        }
      }
    }

    this._mapData = data;
    this._mapInfo = { width: W, height: H, resolution: res, originX: -5, originY: -5 };
    this._buildNavigationGrid();
  },

  publishMap() {
    if (!this.enabled || !this.publishers.map || !this._mapInfo) return;
    const { width, height, resolution, originX, originY } = this._mapInfo;

    this.publishers.map.publish(new ROSLIB.Message({
      header: { stamp: { secs: Math.floor(Date.now() / 1000), nsecs: 0 }, frame_id: 'map' },
      info: {
        map_load_time: { secs: 0, nsecs: 0 },
        resolution,
        width,
        height,
        origin: { position: { x: originX, y: originY, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }
      },
      data: Array.from(this._mapData)
    }));
  },

  // ── LiDAR Scan (ray-cast against map walls) ────────────────
  publishScan() {
    if (!this.enabled || !this.publishers.scan) return;
    const NUM_RAYS = 360;
    const ANGLE_MIN = -Math.PI;
    const ANGLE_MAX = Math.PI;
    const ANGLE_INC = (ANGLE_MAX - ANGLE_MIN) / NUM_RAYS;
    const RANGE_MAX = 8.0;
    const RANGE_MIN = 0.12;

    const ranges = new Array(NUM_RAYS);
    const { x: rx, y: ry, yaw } = this._pose;

    if (this._mapData && this._mapInfo) {
      const { width, height, resolution, originX, originY } = this._mapInfo;
      const RAY_STEP = resolution * 0.5; // half-cell steps for accuracy

      for (let i = 0; i < NUM_RAYS; i++) {
        const angle = ANGLE_MIN + i * ANGLE_INC + yaw;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        let r = RANGE_MIN;
        let hit = false;

        while (r < RANGE_MAX) {
          const wx = rx + cosA * r;
          const wy = ry + sinA * r;
          // World → grid
          const col = Math.floor((wx - originX) / resolution);
          const row = Math.floor((wy - originY) / resolution);

          if (col < 0 || col >= width || row < 0 || row >= height) {
            // Out of map bounds
            ranges[i] = r;
            hit = true;
            break;
          }

          if (this._mapData[row * width + col] > 50) {
            // Wall hit
            ranges[i] = r;
            hit = true;
            break;
          }

          r += RAY_STEP;
        }

        if (!hit) {
          ranges[i] = RANGE_MAX;
        }
      }
    } else {
      // Fallback: uniform ranges with slight noise
      for (let i = 0; i < NUM_RAYS; i++) {
        ranges[i] = 3.0 + Math.sin((this.tick + i) / 30) * 0.2;
      }
    }

    // Add realistic LiDAR noise
    const intensities = new Array(NUM_RAYS);
    for (let i = 0; i < NUM_RAYS; i++) {
      // Range noise: ±8mm Gaussian noise
      ranges[i] += this._gaussRandom(0, 0.008);

      // Occasional dropout (~0.5% chance): simulate missed returns
      if (Math.random() < 0.005) {
        ranges[i] = Infinity;
      }

      // Clamp to valid range
      if (ranges[i] < RANGE_MIN) ranges[i] = RANGE_MIN;

      // Simulate intensity (stronger at closer range, with noise)
      const baseIntensity = Math.max(0, Math.min(1.0, 1.0 - ranges[i] / RANGE_MAX));
      intensities[i] = Math.max(0, baseIntensity * 4000 + this._gaussRandom(0, 200));
    }

    this.publishers.scan.publish(new ROSLIB.Message({
      header: { stamp: { secs: Math.floor(Date.now() / 1000), nsecs: 0 }, frame_id: 'laser' },
      angle_min: ANGLE_MIN,
      angle_max: ANGLE_MAX,
      angle_increment: ANGLE_INC,
      time_increment: 0,
      scan_time: 0.1,
      range_min: RANGE_MIN,
      range_max: RANGE_MAX,
      ranges,
      intensities
    }));
    this.tick += 1;
  },

  // ── Camera ─────────────────────────────────────────────────
  publishCamera() {
    if (!this.enabled) return;
    const msg = new ROSLIB.Message({ format: 'jpeg', data: this.TEST_IMAGE_JPEG });
    if (this.publishers.cam1Depth) this.publishers.cam1Depth.publish(msg);
    if (this.publishers.cam1Color) this.publishers.cam1Color.publish(msg);
    if (this.publishers.cam2Depth) this.publishers.cam2Depth.publish(msg);
    if (this.publishers.cam2Color) this.publishers.cam2Color.publish(msg);
  },

  // ── Jog Control (subscribe cmd_vel, integrate velocity) ────
  _cmdVelSub: null,

  _startJogSubscription() {
    const ros = RosManager.getRos();
    if (!ros) return;
    const rid = this.getRobotId();
    this._cmdVelSub = new ROSLIB.Topic({
      ros,
      name: `/${rid}/cmd_vel`,
      messageType: 'geometry_msgs/Twist'
    });
    this._cmdVelSub.subscribe((msg) => {
      this._jogVel.lx = msg.linear ? msg.linear.x : 0;
      this._jogVel.az = msg.angular ? msg.angular.z : 0;
    });

    // Integrate velocity at 50ms intervals
    const INTERVAL = 50;
    this._jogTimer = setInterval(() => {
      if (!this.enabled) return;
      const { lx, az } = this._jogVel;
      if (Math.abs(lx) < 0.001 && Math.abs(az) < 0.001) return;
      // Stop any waypoint navigation if jog is active
      if (this._navTimer) {
        this._stopNavigation();
        this.setWorkState(1); // WORK while jogging
      }
      const dt = INTERVAL / 1000;
      this._pose.yaw += az * dt;
      // Normalize yaw
      while (this._pose.yaw > Math.PI) this._pose.yaw -= 2 * Math.PI;
      while (this._pose.yaw < -Math.PI) this._pose.yaw += 2 * Math.PI;
      const nextX = this._pose.x + Math.cos(this._pose.yaw) * lx * dt;
      const nextY = this._pose.y + Math.sin(this._pose.yaw) * lx * dt;
      if (!this._isPoseTraversable(nextX, nextY)) {
        this._jogVel.lx = 0;
        const now = Date.now();
        if (now - this._lastObstacleNoticeAt > 1500) {
          this._lastObstacleNoticeAt = now;
          App.toast('검은 장애물 앞에서 수동 주행을 정지했습니다.', 'warning');
        }
        return;
      }
      this._pose.x = nextX;
      this._pose.y = nextY;
    }, INTERVAL);
  },

  _stopJogSubscription() {
    if (this._cmdVelSub) {
      try { this._cmdVelSub.unsubscribe(); } catch (e) {}
      this._cmdVelSub = null;
    }
    if (this._jogTimer) {
      clearInterval(this._jogTimer);
      this._jogTimer = null;
    }
  },

  // ── SLAM / Lifelong mode subscription ──────────────────────
  _slamSub: null,

  _startSlamSubscription() {
    const ros = RosManager.getRos();
    if (!ros) return;
    const rid = this.getRobotId();
    this._slamSub = new ROSLIB.Topic({
      ros,
      name: `/${rid}/sp_routine`,
      messageType: 'std_msgs/String'
    });
    this._slamSub.subscribe((msg) => {
      const mode = (msg.data || '').toUpperCase();
      console.log('[TestMode] sp_routine:', mode);
      this._slamMode = mode;
      const robot = this.virtualRobots.get(App.activeSlotIndex);
      if (robot) {
        this._setVirtualMappingMode(robot, mode);
        return;
      }
      if (mode === 'SLAM' || mode === 'LIFELONG') {
        this.setWorkState(10); // MAPPING
      } else if (mode === 'NAV') {
        if (this._workState === 10) this.setWorkState(0); // back to IDLE
      }
    });
  },

  _stopSlamSubscription() {
    if (this._slamSub) {
      try { this._slamSub.unsubscribe(); } catch (e) {}
      this._slamSub = null;
    }
  },

  // ── Docking Test Simulation ────────────────────────────────
  // Simulated dock station position (near a wall)
  _dockStation: { x: 2.0, y: 0.0, theta: 0 },
  _dockUndockOffset: 0.5, // distance to back away when undocking

  startDockingSimulation(cycleCount, testType) {
    if (!this.enabled) return;
    const total = cycleCount || 3;
    this.dockTimers.forEach(id => clearTimeout(id));
    this.dockTimers = [];

    this._dockCycleIndex = 0;
    this._dockTotalCycles = total;
    this._dockTestType = testType;
    this._dockHomePos = { x: this._pose.x, y: this._pose.y, yaw: this._pose.yaw };

    // Start first cycle: navigate to dock station
    this._runDockCycle();
  },

  _runDockCycle() {
    if (!this.enabled || this._dockCycleIndex >= this._dockTotalCycles) {
      // All cycles done
      this.publishers.missionResult.publish(new ROSLIB.Message({ data: 'test_complete' }));
      this.setWorkState(0);
      return;
    }

    // Phase 1: Navigate to dock station
    this.setWorkState(2); // DOCK
    const dock = this._dockStation;
    this.navigateTo(dock.x, dock.y, dock.theta);

    // Wait for arrival then fire docking result
    this._waitForNavComplete(() => {
      // Docking complete
      if (typeof DockingTest !== 'undefined' && DockingTest.onDockingResult) {
        DockingTest.onDockingResult({});
      }

      // Phase 2: Short pause then undock (back away)
      this.dockTimers.push(setTimeout(() => {
        this.setWorkState(8); // DOCK OUT
        const undockX = dock.x - this._dockUndockOffset * Math.cos(dock.theta);
        const undockY = dock.y - this._dockUndockOffset * Math.sin(dock.theta);
        this.navigateTo(undockX, undockY, dock.theta + Math.PI);

        this._waitForNavComplete(() => {
          if (typeof DockingTest !== 'undefined' && DockingTest.onDockingOutResult) {
            DockingTest.onDockingOutResult({});
          }
          this.publishers.missionResult.publish(new ROSLIB.Message({ data: 'cycle_complete' }));

          if (this._dockTestType === 'precision') {
            const precision = [
              (Math.random() - 0.5) * 0.02,
              (Math.random() - 0.5) * 0.02,
              (Math.random() - 0.5) * 0.02
            ];
            this.publishers.precisionResult.publish(new ROSLIB.Message({ data: precision }));
          }

          // Next cycle
          this._dockCycleIndex++;
          if (this._dockCycleIndex < this._dockTotalCycles) {
            this.dockTimers.push(setTimeout(() => this._runDockCycle(), 300));
          } else {
            this.dockTimers.push(setTimeout(() => {
              this.publishers.missionResult.publish(new ROSLIB.Message({ data: 'test_complete' }));
              this.setWorkState(0);
            }, 300));
          }
        });
      }, 500));
    });
  },

  _waitForNavComplete(callback) {
    const check = setInterval(() => {
      if (!this.enabled) { clearInterval(check); return; }
      if (!this._navTimer && !this._navTarget) {
        clearInterval(check);
        callback();
      }
    }, 100);
    this.dockTimers.push(check);
  },

  // ── Navigation simulation ──────────────────────────────────
  navigateTo(goalX, goalY, goalTheta, options = {}) {
    const target = { x: Number(goalX), y: Number(goalY), theta: Number(goalTheta) || 0 };
    const avoidObstacles = options.avoidObstacles !== false;
    const route = this._planNavigationQueue(this._pose, [target], avoidObstacles);
    if (!route) {
      const message = this._lastPlanError || '검은 장애물을 피해 이동 경로를 만들 수 없습니다.';
      this._reportRuntimeFailure(message, 'navigation');
      this.setWorkState(this._slamMode === 'NAV' ? 0 : 10);
      return false;
    }
    this._stopNavigation();
    this._navWaypoints = route;
    this._navControllerState = this._createStandaloneNavigationState(options);
    const robot = this.virtualRobots.get(App.activeSlotIndex);
    if (robot) {
      robot.plannedPath = route.map(point => ({ ...point }));
      this._displayPlannedPath(robot, robot.plannedPath);
    }
    this._navigateNextWaypoint();
    return true;
  },

  navigateQueue(waypoints, options = {}) {
    if (!waypoints || waypoints.length === 0) return false;
    const route = this._planNavigationQueue(
      this._pose,
      waypoints,
      options.avoidObstacles !== false
    );
    if (!route) {
      const message = this._lastPlanError || '검은 장애물을 피해 이동 경로를 만들 수 없습니다.';
      this._reportRuntimeFailure(message, 'navigation');
      this.setWorkState(this._slamMode === 'NAV' ? 0 : 10);
      return false;
    }
    this._stopNavigation();
    this._navWaypoints = route;
    this._navControllerState = this._createStandaloneNavigationState(options);
    const robot = this.virtualRobots.get(App.activeSlotIndex);
    if (robot) {
      robot.plannedPath = route.map(point => ({ ...point }));
      this._displayPlannedPath(robot, robot.plannedPath);
    }
    this._navigateNextWaypoint();
    return true;
  },

  _createStandaloneNavigationState(options = {}) {
    const maxTransVel = Math.max(
      0.05,
      Math.min(1.8, Number(options.maxTransVel ?? options.maxVel ?? this._navSpeed) || 0.8)
    );
    const passingFlag = Boolean(options.passingFlag ?? options.passing);
    const profile = this._buildWaypointProfile({
      action_params: [
        {
          param_name: 'max_trans_vel',
          type: 'float',
          value: String(maxTransVel)
        }
      ]
    }, passingFlag ? { action_type: 0x01 } : null);
    profile.passingFlag = passingFlag;
    return {
      profile,
      currentSpeed: 0,
      currentAngularSpeed: 0,
      previousHeadingError: null,
      controllerMode: 'WAIT',
      navQueue: [],
      onSafetyStop: message => {
        this._stopNavigation();
        this.setWorkState(this._slamMode === 'NAV' ? 0 : 10);
        this._reportRuntimeFailure(message, 'navigation');
      }
    };
  },

  _navigateNextWaypoint() {
    if (!this._navWaypoints || this._navWaypoints.length === 0) return;
    const wp = this._navWaypoints.shift();
    if (this._navTimer) clearInterval(this._navTimer);
    this._navTimer = null;
    this._navTarget = {
      x: wp.x,
      y: wp.y,
      theta: wp.theta,
      isGoal: Boolean(wp.isGoal || this._navWaypoints.length === 0)
    };
    this.setWorkState(1);

    const INTERVAL = 50;
    const state = this._navControllerState
      || this._createStandaloneNavigationState({});

    this._navTimer = setInterval(() => {
      if (!this.enabled) { this._stopNavigation(); return; }
      const robot = this.virtualRobots.get(App.activeSlotIndex)
        || { pose: this._pose, robotId: 'TEST_NAV', slotIndex: App.activeSlotIndex };
      state.navQueue = this._navWaypoints || [];
      if (this._moveVirtualRobot(robot, this._navTarget, INTERVAL / 1000, state)) {
        clearInterval(this._navTimer);
        this._navTimer = null;
        if (this._navWaypoints && this._navWaypoints.length > 0) {
          this._navigateNextWaypoint();
          return;
        }
        this._navTarget = null;
        this._navWaypoints = null;
        this._navControllerState = null;
        robot.plannedPath = [];
        if (typeof RosManager !== 'undefined') {
          RosManager._navigationPath = [];
          RosManager.requestRender?.();
        }
        this.setWorkState(this._slamMode === 'NAV' ? 0 : 10);
      }
    }, INTERVAL);
  },

  _stopNavigation() {
    if (this._navTimer) {
      clearInterval(this._navTimer);
      this._navTimer = null;
    }
    this._navTarget = null;
    this._navWaypoints = null;
    this._navControllerState = null;
    const robot = this.virtualRobots.get(App.activeSlotIndex);
    if (robot) robot.plannedPath = [];
    if (typeof RosManager !== 'undefined') {
      RosManager._navigationPath = [];
      RosManager.requestRender?.();
    }
  }
};
