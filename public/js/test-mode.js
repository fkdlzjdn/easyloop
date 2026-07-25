// Test Mode - publish simulated ROS data via rosbridge (no mocking layer)
const TestMode = {
  enabled: false,
  publishers: {},
  timers: [],
  tick: 0,
  dockTimers: [],
  createdSlotIndex: null,
  originalSlot: null,
  MAX_VIRTUAL_ROBOTS: 3,
  virtualRobots: new Map(),
  publisherSets: new Map(),
  originalFleet: null,
  originalActiveSlotIndex: -1,
  _fleetSimulationTimer: null,
  _fleetRenderTick: 0,
  _publishRos: null, // Separate ROS connection for publishing
  _workState: 0, // Current simulated work state (0=IDLE by default)
  // Robot pose state
  _pose: { x: 0, y: 0, yaw: 0 },        // True physical position (LiDAR ray-cast source)
  _poseEstOffset: { x: 0, y: 0, yaw: 0 }, // Offset: estimate = _pose + _poseEstOffset
  _navTarget: null,    // { x, y, theta } — active navigation goal
  _navTimer: null,     // interval for navigation animation
  _navSpeed: 0.8,      // m/s simulated linear speed
  // Jog control velocity integration
  _jogVel: { lx: 0, az: 0 },
  _jogTimer: null,
  // Map data cache for LiDAR ray-casting
  _mapData: null,
  _mapInfo: null,      // { width, height, resolution, originX, originY }
  // SLAM mode
  _slamMode: 'NAV',    // NAV, SLAM, LIFELONG
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
    this.updateUi();
  },

  toggle() {
    if (this.enabled) {
      this.stop();
    } else {
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
    this._starting = true;
    this.showLoading(true);
    try {
      // Step 1: Start rosbridge server (server waits for port ready)
      this.setProgress(5, 'Requesting rosbridge server start...');
      await this.startRosBridgeOnly(password);

      // Step 2: Prepare temporary virtual fleet
      const robotCount = this._requestedRobotCount();
      this.setProgress(60, `Preparing ${robotCount} temporary virtual robots...`);
      this.prepareVirtualFleet(robotCount);

      // Step 3: Connect ROS
      this.setProgress(70, 'Connecting to ROS...');
      await this.ensureRosConnection();

      const ros = RosManager.getRos();
      if (!ros) {
        throw new Error('Failed to get ROS connection');
      }

      // Step 4: Open separate ROS connection for publishing
      // (rosbridge does not echo published messages back to the same WebSocket client)
      this.setProgress(85, 'Creating publisher ROS connection...');
      await this._openPublishConnection();

      // Step 5: Attach every temporary robot to the local bridge and advertise topics.
      this.setProgress(90, 'Registering virtual fleet topics...');
      this.tick = 0;
      this._attachVirtualFleetConnection(ros);
      this.publisherSets.clear();
      this.virtualRobots.forEach(robot => {
        this.publisherSets.set(robot.robotId, this.createPublishers(this._publishRos, robot.robotId));
      });
      this.publishers = this.publisherSets.get(App.robotSlots[App.activeSlotIndex]?.robotId) || {};

      // ROS needs time to discover publisher↔subscriber connections
      this.setProgress(93, 'Waiting for ROS topic connections...');
      await this._delay(3000);

      // Step 6: Start publish loops + set initial IDLE state
      this.setProgress(97, 'Starting simulation publish...');
      this._workState = 0; // Start as IDLE
      this._pose = { x: 0, y: 0, yaw: 0 }; // Start at origin
      this._poseEstOffset = { x: 0, y: 0, yaw: 0 };
      this._jogVel = { lx: 0, az: 0 };
      this._bmsSOC = 75;
      this._bmsCharging = false;
      this._bmsChargingManual = false;
      this._slamMode = 'NAV';
      this._stopNavigation();
      this._buildMapCache();
      this.enabled = true;
      this._starting = false;
      this.startPublishLoops();
      this._startJogSubscription();
      this._startSlamSubscription();
      this.updateUi();
      this._refreshFleetUi();

      this.setProgress(100, 'Test mode activated');
      await this._delay(400);
      this.showLoading(false);
      App.addEvent(
        'notification',
        'Test mode started',
        `${this.virtualRobots.size} virtual robots · Task movement simulation`,
        'info'
      );
    } catch (err) {
      this._starting = false;
      this.enabled = false;
      this.clearTimers();
      this._closePublishConnection();
      if (this.originalFleet) this.restoreVirtualFleet();
      this.requestStopRosBridge();
      this.updateUi();
      this.showLoading(false);
      App.toast(err.message || 'Test mode start failed', 'error');
    }
  },

  stop() {
    this.enabled = false;
    this._workState = 0;
    this._stopNavigation();
    this._stopJogSubscription();
    this._stopSlamSubscription();
    this._pose = { x: 0, y: 0, yaw: 0 };
    this._poseEstOffset = { x: 0, y: 0, yaw: 0 };
    this._jogVel = { lx: 0, az: 0 };
    this._mapData = null;
    this._mapInfo = null;
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
      robotNumber: slot.robotNumber
    }));
    this.originalActiveSlotIndex = App.activeSlotIndex;

    App.robotSlots.forEach((slot, index) => {
      if (slot.ros || slot.connected) RosManager.disconnectSlot(index);
    });
    App.robotSlots.length = 0;
    App.activeSlotIndex = -1;
    this.virtualRobots.clear();

    const startPoses = [
      { x: -2.5, y: -2.0, yaw: 0 },
      { x: 0.0, y: -2.5, yaw: Math.PI / 2 },
      { x: 2.5, y: -2.0, yaw: Math.PI }
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
      taskLabel: '',
      completedLoops: 0
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
        { silent: true, deferRender: true, activateFirst: false }
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
        if (cur < 55) this.setProgress(Math.min(cur + 1.5, 55), 'Waiting for rosbridge server...');
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
        throw new Error('Test mode API response is not JSON. Server restart may be required.');
      }

      const data = await res.json();
      if (!data.success) {
        if (data.authFailed) {
          throw new Error('비밀번호가 올바르지 않습니다.');
        }
        throw new Error(data.message || 'rosbridge start failed');
      }
      return true;
    } catch (e) {
      clearInterval(this._progressTimer);
      throw new Error(e.message || 'rosbridge start failed');
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
        this.setProgress(pct, `Waiting for ROS connection... (${Math.round((Date.now() - start) / 1000)}s)`);

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
          reject(new Error('ROS connection failed: Cannot connect to rosbridge'));
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
    if (!status) return;
    status.textContent = this.enabled ? `ON · ${this.virtualRobots.size}` : 'OFF';
    status.classList.toggle('on', this.enabled);
    if (robotCount) robotCount.disabled = this.enabled || this._starting;
    if (chip) {
      chip.classList.toggle('enabled', this.enabled);
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
    if (stepText && stepEl) stepEl.textContent = stepText;
  },

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  },

  _openPublishConnection() {
    return new Promise((resolve, reject) => {
      const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${wsProto}://${location.host}/ws-proxy?target=127.0.0.1:9090`;
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
      this._syncActiveVirtualRobot(true);
      this.timers.push(setInterval(() => this._tickVirtualFleet(0.05), 50));
      this.timers.push(setInterval(() => this._publishVirtualFleetTelemetry(), 200));
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

  _mapMessage() {
    if (!this._mapInfo || !this._mapData) return null;
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
      data: Array.from(this._mapData)
    };
  },

  _publishVirtualMaps() {
    if (!this.enabled && !this._starting) return;
    const message = this._mapMessage();
    if (!message) return;
    this.publisherSets.forEach(publishers => {
      publishers.map?.publish(new ROSLIB.Message(message));
    });
    RosManager.lastMapMsg = message;
    RosManager.requestRender();
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
    if (forceMap) {
      const message = this._mapMessage();
      if (message) RosManager.lastMapMsg = message;
    }
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
      robot.workState = 0;
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
      navQueue: []
    };

    if (type === 0x01) {
      current.navQueue = [{
        x: Number(args[0]) || 0,
        y: Number(args[1]) || 0,
        theta: Number(args[2]) || 0
      }];
    } else if (type === 0x15) {
      const finalTheta = Number(args.at(-1)) || 0;
      for (let index = 0; index + 1 < args.length - 1; index += 2) {
        const x = Number(args[index]) || 0;
        const y = Number(args[index + 1]) || 0;
        const nextX = Number(args[index + 2]);
        const nextY = Number(args[index + 3]);
        current.navQueue.push({
          x,
          y,
          theta: Number.isFinite(nextX) && Number.isFinite(nextY)
            ? Math.atan2(nextY - y, nextX - x)
            : finalTheta
        });
      }
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

    current.navTarget = current.navQueue.shift() || null;
    robot.currentAction = current;
    robot.workState = current.state;
    this._notifyVirtualTaskFeedback(
      robot,
      current.state === 7 ? 'pause' : 'work',
      `${action.action_id || `Action_${task.actionIndex + 1}`} 실행`
    );
  },

  _tickVirtualAction(robot, dt) {
    const current = robot.currentAction;
    if (!current) return false;
    current.elapsed += dt;
    if (current.navTarget) {
      if (this._moveVirtualRobot(robot, current.navTarget, dt)) {
        current.navTarget = current.navQueue.shift() || null;
        if (!current.navTarget) return true;
      }
      return false;
    }
    if (current.type === 0x07 && current.duration === 0) return false;
    return current.elapsed >= current.duration;
  },

  _moveVirtualRobot(robot, target, dt) {
    const speed = 1.0;
    const rotationSpeed = 2.2;
    const dx = target.x - robot.pose.x;
    const dy = target.y - robot.pose.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.03) {
      const pathYaw = Math.atan2(dy, dx);
      const yawError = this._normalizeAngle(pathYaw - robot.pose.yaw);
      if (Math.abs(yawError) > 0.12) {
        robot.pose.yaw += Math.sign(yawError) * Math.min(Math.abs(yawError), rotationSpeed * dt);
      } else {
        const step = Math.min(distance, speed * dt);
        robot.pose.yaw = pathYaw;
        robot.pose.x += Math.cos(pathYaw) * step;
        robot.pose.y += Math.sin(pathYaw) * step;
      }
      robot.pose.yaw = this._normalizeAngle(robot.pose.yaw);
      return false;
    }

    robot.pose.x = target.x;
    robot.pose.y = target.y;
    const finalError = this._normalizeAngle(target.theta - robot.pose.yaw);
    if (Math.abs(finalError) > 0.035) {
      robot.pose.yaw = this._normalizeAngle(
        robot.pose.yaw + Math.sign(finalError) * Math.min(Math.abs(finalError), rotationSpeed * dt)
      );
      return false;
    }
    robot.pose.yaw = this._normalizeAngle(target.theta);
    return true;
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
    robot.task.actionIndex += 1;
    robot.currentAction = null;
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
    robot.workState = 0;
    this._notifyVirtualTaskFeedback(robot, 'complete', 'Task 완료', taskId);
    App.addEvent('action', `[TestMode] ${robot.robotId} Task 완료`, taskId, 'success');
  },

  _resetVirtualRobotTask(robot, setIdle = true) {
    robot.task = null;
    robot.currentAction = null;
    robot.navTarget = null;
    robot.navQueue = [];
    robot.paused = false;
    robot.taskLabel = '';
    robot.completedLoops = 0;
    if (setIdle) robot.workState = 0;
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
      this._pose.x += Math.cos(this._pose.yaw) * lx * dt;
      this._pose.y += Math.sin(this._pose.yaw) * lx * dt;
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
  navigateTo(goalX, goalY, goalTheta) {
    this._stopNavigation();
    this._navTarget = { x: goalX, y: goalY, theta: goalTheta };
    this.setWorkState(1); // WORK

    const INTERVAL = 50;
    const step = this._navSpeed * (INTERVAL / 1000);

    this._navTimer = setInterval(() => {
      if (!this.enabled) { this._stopNavigation(); return; }

      const dx = this._navTarget.x - this._pose.x;
      const dy = this._navTarget.y - this._pose.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < step) {
        this._pose.x = this._navTarget.x;
        this._pose.y = this._navTarget.y;

        let yawErr = this._navTarget.theta - this._pose.yaw;
        while (yawErr > Math.PI) yawErr -= 2 * Math.PI;
        while (yawErr < -Math.PI) yawErr += 2 * Math.PI;

        if (Math.abs(yawErr) < 0.05) {
          this._pose.yaw = this._navTarget.theta;
          this._stopNavigation();
          this.setWorkState(0); // IDLE
        } else {
          const rotStep = Math.sign(yawErr) * Math.min(Math.abs(yawErr), 1.0 * (INTERVAL / 1000));
          this._pose.yaw += rotStep;
        }
      } else {
        const goalYaw = Math.atan2(dy, dx);
        let yawErr = goalYaw - this._pose.yaw;
        while (yawErr > Math.PI) yawErr -= 2 * Math.PI;
        while (yawErr < -Math.PI) yawErr += 2 * Math.PI;

        if (Math.abs(yawErr) > 0.1) {
          const rotStep = Math.sign(yawErr) * Math.min(Math.abs(yawErr), 2.0 * (INTERVAL / 1000));
          this._pose.yaw += rotStep;
        } else {
          this._pose.yaw = goalYaw;
          this._pose.x += Math.cos(goalYaw) * step;
          this._pose.y += Math.sin(goalYaw) * step;
        }
      }
    }, INTERVAL);
  },

  navigateQueue(waypoints) {
    if (!waypoints || waypoints.length === 0) return;
    this._navWaypoints = waypoints.slice();
    this._navigateNextWaypoint();
  },

  _navigateNextWaypoint() {
    if (!this._navWaypoints || this._navWaypoints.length === 0) return;
    const wp = this._navWaypoints.shift();
    this._stopNavigation();
    this._navTarget = { x: wp.x, y: wp.y, theta: wp.theta };
    this.setWorkState(1);

    const INTERVAL = 50;
    const step = this._navSpeed * (INTERVAL / 1000);

    this._navTimer = setInterval(() => {
      if (!this.enabled) { this._stopNavigation(); return; }

      const dx = this._navTarget.x - this._pose.x;
      const dy = this._navTarget.y - this._pose.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < step) {
        this._pose.x = this._navTarget.x;
        this._pose.y = this._navTarget.y;
        let yawErr = this._navTarget.theta - this._pose.yaw;
        while (yawErr > Math.PI) yawErr -= 2 * Math.PI;
        while (yawErr < -Math.PI) yawErr += 2 * Math.PI;

        if (Math.abs(yawErr) < 0.05) {
          this._pose.yaw = this._navTarget.theta;
          clearInterval(this._navTimer);
          this._navTimer = null;
          if (this._navWaypoints && this._navWaypoints.length > 0) {
            this._navigateNextWaypoint();
          } else {
            this._navTarget = null;
            this.setWorkState(0);
          }
        } else {
          const rotStep = Math.sign(yawErr) * Math.min(Math.abs(yawErr), 1.0 * (INTERVAL / 1000));
          this._pose.yaw += rotStep;
        }
      } else {
        const goalYaw = Math.atan2(dy, dx);
        let yawErr = goalYaw - this._pose.yaw;
        while (yawErr > Math.PI) yawErr -= 2 * Math.PI;
        while (yawErr < -Math.PI) yawErr += 2 * Math.PI;
        if (Math.abs(yawErr) > 0.1) {
          const rotStep = Math.sign(yawErr) * Math.min(Math.abs(yawErr), 2.0 * (INTERVAL / 1000));
          this._pose.yaw += rotStep;
        } else {
          this._pose.yaw = goalYaw;
          this._pose.x += Math.cos(goalYaw) * step;
          this._pose.y += Math.sin(goalYaw) * step;
        }
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
  }
};
