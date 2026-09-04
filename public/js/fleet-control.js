// Fleet control: render every connected robot on one verified map.
const FleetControl = {
  POSITION_THROTTLE_MS: 100,
  POSITION_SOURCE_FRESH_MS: 250,
  _active: false,
  _positionSubscriptions: new Map(),
  _poses: new Map(),
  _mapStates: new Map(),
  _mapTopics: new Map(),
  _mapQueue: [],
  _mapInFlight: 0,
  _mapConcurrency: 2,
  _generation: 0,
  _mapGeneration: 0,
  _referenceMap: null,
  _referenceSignature: null,
  _referenceSlotIndex: -1,
  _mapImageCanvas: null,
  _mapImageSignature: null,
  _activeMapSyncIndex: -1,
  _renderTimer: null,
  _resizeObserver: null,
  _selectedSlotIndex: -1,
  _robotHitAreas: [],
  _robotIconSize: 40,
  _showTaskRoutes: true,
  _showTaskLabels: true,
  _selectedTaskName: '',
  _taskRunning: false,
  _pendingShortcutTask: null,
  _colors: ['#22c55e', '#38bdf8', '#f59e0b', '#a78bfa', '#f43f5e', '#14b8a6', '#eab308', '#fb7185'],

  init() {
    document.getElementById('btn-fleet-map-refresh')?.addEventListener('click', () => {
      this.refreshMaps();
    });
    document.getElementById('btn-fleet-sync-active-map')?.addEventListener('click', () => {
      this.syncActiveRobotMap(true);
    });
    document.getElementById('fleet-control-map')?.addEventListener('click', event => {
      this._handleMapClick(event);
    });
    document.getElementById('fleet-task-filter')?.addEventListener('input', event => {
      this._refreshTaskOptions(event.target.value);
    });
    document.getElementById('btn-fleet-task-refresh')?.addEventListener('click', () => {
      const filter = document.getElementById('fleet-task-filter')?.value || '';
      this._refreshTaskOptions(filter);
    });
    document.getElementById('fleet-icon-size')?.addEventListener('input', event => {
      this._setRobotIconSize(event.target.value);
    });
    document.getElementById('btn-fleet-task-run')?.addEventListener('click', () => {
      this._runSelectedTask();
    });
    document.getElementById('btn-fleet-shortcut-confirm')?.addEventListener('click', () => {
      this._confirmShortcutTask();
    });
    ['btn-fleet-shortcut-cancel', 'btn-fleet-shortcut-close'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        this._closeShortcutTaskConfirm();
      });
    });
    document.getElementById('fleet-shortcut-task-modal')?.addEventListener('click', event => {
      if (event.target?.id === 'fleet-shortcut-task-modal') this._closeShortcutTaskConfirm();
    });
    document.getElementById('btn-fleet-task-cancel')?.addEventListener('click', () => {
      this._cancelSelectedTask();
    });
    document.getElementById('btn-fleet-running-task-info')?.addEventListener('click', () => {
      this._showSelectedRunningTaskInfo();
    });
    document.getElementById('fleet-show-task-routes')?.addEventListener('change', event => {
      this._showTaskRoutes = event.target.checked;
      this.requestRender();
    });
    document.getElementById('fleet-show-task-labels')?.addEventListener('change', event => {
      this._showTaskLabels = event.target.checked;
      this.requestRender();
    });
    document.addEventListener('easyloop:tasks-changed', () => {
      if (!this._active) return;
      const filter = document.getElementById('fleet-task-filter')?.value || '';
      this._refreshTaskOptions(filter);
    });
    document.addEventListener('amr:active-robot-changed', event => {
      if (!this._active) return;
      this.syncActiveRobotMap(false, event?.detail?.index);
    });
    document.addEventListener('keydown', event => {
      if (this._handleShortcutTaskModalKey(event)) return;
      this._handleTaskShortcut(event);
    }, true);
    try {
      this._setRobotIconSize(localStorage.getItem('fleetRobotIconSize') || 40, false);
    } catch (e) {
      this._setRobotIconSize(40, false);
    }

    const wrap = document.querySelector('.fleet-control-map-wrap');
    if (wrap && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.requestRender());
      this._resizeObserver.observe(wrap);
    }
  },

  activate() {
    if (this._active) {
      this.requestRender();
      return;
    }

    this._active = true;
    this.resetConnections();
    const connected = this._connectedIndices();
    connected.sort((a, b) => {
      if (a === App.activeSlotIndex) return -1;
      if (b === App.activeSlotIndex) return 1;
      return a - b;
    });
    connected.forEach(index => this._subscribePosition(index));
    if (connected.includes(App.activeSlotIndex)) this._selectedSlotIndex = App.activeSlotIndex;
    this._seedActiveRobotMap(connected);
    connected.forEach(index => this._enqueueMapCheck(index));
    this._refreshTaskOptions();
    this._updateTaskPanel();
    this.requestRender();
  },

  deactivate() {
    if (!this._active) return;
    this._active = false;
    this._generation += 1;
    this._mapGeneration += 1;
    this._unsubscribeAllPositionTopics();
    this._clearMapChecks();
    if (this._renderTimer) {
      clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }
  },

  resetConnections() {
    this._generation += 1;
    this._mapGeneration += 1;
    this._unsubscribeAllPositionTopics();
    this._clearMapChecks();
    this._poses.clear();
    this._mapStates.clear();
    this._referenceMap = null;
    this._referenceSignature = null;
    this._referenceSlotIndex = -1;
    this._mapImageCanvas = null;
    this._mapImageSignature = null;
    this._activeMapSyncIndex = -1;
    this._selectedSlotIndex = -1;
    this._robotHitAreas = [];
    this._updateTaskPanel();
    this.requestRender();
  },

  onSlotConnected(index) {
    if (!this._active) return;
    const slot = App.robotSlots[index];
    if (!slot || !slot.connected || !slot.ros) return;
    this._subscribePosition(index);
    this._enqueueMapCheck(index);
    this.requestRender();
  },

  onSlotDisconnected(index) {
    this._unsubscribePosition(index);
    this._poses.delete(index);
    this._cancelMapCheck(index);
    this._mapStates.delete(index);
    if (index === this._activeMapSyncIndex) this._activeMapSyncIndex = -1;
    if (index === this._selectedSlotIndex) {
      this._selectedSlotIndex = -1;
      this._updateTaskPanel();
    }

    if (index === this._referenceSlotIndex && this._active) {
      this.refreshMaps();
    } else {
      this.requestRender();
    }
  },

  refreshMaps() {
    if (!this._active) return;
    this._mapGeneration += 1;
    this._clearMapChecks();
    this._mapStates.clear();
    this._referenceMap = null;
    this._referenceSignature = null;
    this._referenceSlotIndex = -1;
    this._mapImageCanvas = null;
    this._mapImageSignature = null;
    const connected = this._connectedIndices();
    this._activeMapSyncIndex = connected.includes(App.activeSlotIndex)
      ? App.activeSlotIndex
      : -1;
    connected.sort((a, b) => {
      if (a === App.activeSlotIndex) return -1;
      if (b === App.activeSlotIndex) return 1;
      return a - b;
    });
    this._seedActiveRobotMap(connected);
    connected.forEach(index => this._enqueueMapCheck(index));
    this.requestRender();
  },

  syncActiveRobotMap(forceReload = false, requestedIndex = App.activeSlotIndex) {
    if (!this._active) return false;
    const index = Number.isInteger(Number(requestedIndex))
      ? Number(requestedIndex)
      : App.activeSlotIndex;
    const slot = App.robotSlots[index];
    if (!slot?.connected || !slot.ros || index !== App.activeSlotIndex) {
      if (forceReload && typeof App.toast === 'function') {
        App.toast('활성 로봇이 연결되어 있지 않아 맵을 동기화할 수 없습니다.', 'error');
      }
      this.requestRender();
      return false;
    }

    this._selectedSlotIndex = index;
    this._updateTaskPanel();

    // On initial activation RosManager may already hold the active robot's map.
    // During an active-slot switch it is cleared first, so the fleet subscriber
    // below becomes the authoritative source for the newly active robot.
    if (!forceReload && typeof RosManager !== 'undefined' && RosManager.lastMapMsg) {
      this._acceptMap(index, RosManager.lastMapMsg);
      this.requestRender();
      return true;
    }

    if (!forceReload && this._referenceSlotIndex === index && this._referenceMap) {
      this._activeMapSyncIndex = -1;
      this.requestRender();
      return true;
    }

    this._activeMapSyncIndex = index;
    this._cancelMapCheck(index);
    this._mapStates.delete(index);
    this._enqueueMapCheck(index, true);
    if (forceReload && typeof App.toast === 'function') {
      App.toast(`${this._robotNumber(slot)}번 활성 로봇의 맵을 다시 동기화합니다.`, 'info');
    }
    this.requestRender();
    return true;
  },

  _connectedIndices() {
    const indices = [];
    (App.robotSlots || []).forEach((slot, index) => {
      if (slot.connected && slot.ros) indices.push(index);
    });
    return indices;
  },

  _subscribePosition(index) {
    if (this._positionSubscriptions.has(index)) return;
    const slot = App.robotSlots[index];
    if (!slot || !slot.ros) return;
    const rid = slot.robotId;
    const generation = this._generation;

    if (slot.pose && [slot.pose.x, slot.pose.y, slot.pose.yaw].every(Number.isFinite)) {
      this._poses.set(index, { ...slot.pose, source: 'cached', receivedAt: Date.now() });
    }

    const robotStateEndpoint = typeof RobotCompatibility !== 'undefined'
      ? RobotCompatibility.get(slot)?.monitoring?.topics?.robotState
      : null;
    let robotStateTopic = null;
    if (robotStateEndpoint?.name && robotStateEndpoint?.type) {
      robotStateTopic = new ROSLIB.Topic({
        ros: slot.ros,
        name: robotStateEndpoint.name,
        messageType: robotStateEndpoint.type,
        throttle_rate: this.POSITION_THROTTLE_MS,
        queue_length: 1
      });
      robotStateTopic.subscribe((msg) => {
        if (!this._active || generation !== this._generation || App.robotSlots[index] !== slot) return;
        if (!msg.pose || msg.pose.x === undefined || msg.pose.y === undefined) return;
        this._updatePose(index, {
          x: Number(msg.pose.x),
          y: Number(msg.pose.y),
          yaw: Number(msg.pose.theta) || 0
        }, 'robot_state');
      });
    }

    const amclTopic = new ROSLIB.Topic({
      ros: slot.ros,
      name: `/${rid}/amcl_pose`,
      messageType: 'geometry_msgs/PoseWithCovarianceStamped',
      throttle_rate: this.POSITION_THROTTLE_MS,
      queue_length: 1
    });
    amclTopic.subscribe((msg) => {
      if (!this._active || generation !== this._generation || App.robotSlots[index] !== slot) return;
      const current = this._poses.get(index);
      if (current?.source === 'robot_state'
          && Date.now() - current.receivedAt < this.POSITION_SOURCE_FRESH_MS) return;
      const pose = msg?.pose?.pose;
      if (!pose?.position || !pose?.orientation) return;
      this._updatePose(index, {
        x: Number(pose.position.x),
        y: Number(pose.position.y),
        yaw: this._yawFromQuaternion(pose.orientation)
      }, 'amcl_pose');
    });

    this._positionSubscriptions.set(index, [robotStateTopic, amclTopic].filter(Boolean));
  },

  _updatePose(index, pose, source) {
    if (![pose.x, pose.y, pose.yaw].every(Number.isFinite)) return;
    this._poses.set(index, { ...pose, source, receivedAt: Date.now() });
    this.requestRender();
  },

  _yawFromQuaternion(orientation) {
    const x = Number(orientation.x) || 0;
    const y = Number(orientation.y) || 0;
    const z = Number(orientation.z) || 0;
    const w = Number(orientation.w) || 0;
    return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  },

  _unsubscribePosition(index) {
    const topics = this._positionSubscriptions.get(index) || [];
    topics.forEach(topic => {
      try { topic.unsubscribe(); } catch (e) { /* ignore */ }
    });
    this._positionSubscriptions.delete(index);
  },

  _unsubscribeAllPositionTopics() {
    Array.from(this._positionSubscriptions.keys()).forEach(index => this._unsubscribePosition(index));
  },

  _enqueueMapCheck(index, priority = false) {
    if (!this._active || this._mapStates.has(index) || this._mapQueue.includes(index)) return;
    const slot = App.robotSlots[index];
    if (!slot || !slot.connected || !slot.ros) return;
    this._mapStates.set(index, { status: 'pending' });
    if (priority) this._mapQueue.unshift(index);
    else this._mapQueue.push(index);
    this._pumpMapQueue();
  },

  _pumpMapQueue() {
    // Select the reference map deterministically first, then compare two robots at a time.
    const concurrency = this._referenceMap ? this._mapConcurrency : 1;
    while (this._active && this._mapInFlight < concurrency && this._mapQueue.length > 0) {
      const index = this._mapQueue.shift();
      const slot = App.robotSlots[index];
      if (!slot || !slot.connected || !slot.ros) {
        this._mapStates.delete(index);
        continue;
      }
      this._startMapCheck(index, slot);
    }
  },

  _startMapCheck(index, slot) {
    const generation = this._mapGeneration;
    // Deployments expose either /{rid}/map or the standard /map. The namespaced
    // topic is canonical because slam_toolbox/localization builds it from the
    // saved pose graph. Keep /map only as a delayed map_server fallback; letting
    // the first response win can select an older PGM revision after Mapping.
    // A static map is usually latched, but rosbridge does not always replay that
    // latched value to a second browser-side subscriber. In that case request the
    // same OccupancyGrid through map_server's nav_msgs/GetMap service.
    const topicNames = Array.from(new Set([`/${slot.robotId}/map`, '/map']));
    const topics = topicNames.map(name => new ROSLIB.Topic({
      ros: slot.ros,
      name,
      messageType: 'nav_msgs/OccupancyGrid',
      queue_length: 1
    }));
    let completed = false;
    let rootMapFallback = null;
    this._mapInFlight += 1;
    this._mapStates.set(index, { status: 'loading' });

    const finish = (status, message = null) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      clearTimeout(staticMapTimerId);
      clearTimeout(rootMapFallbackTimerId);
      topics.forEach(topic => {
        try { topic.unsubscribe(); } catch (e) { /* ignore */ }
      });
      this._mapTopics.delete(index);
      this._mapInFlight = Math.max(0, this._mapInFlight - 1);

      if (generation === this._mapGeneration && this._active) {
        if (status === 'ok' && message) this._acceptMap(index, message);
        else if (status === 'cancelled') this._mapStates.delete(index);
        else {
          this._mapStates.set(index, { status: 'error' });
          if (index === this._activeMapSyncIndex) this._activeMapSyncIndex = -1;
        }
        this._pumpMapQueue();
        this.requestRender();
      }
    };

    const staticMapTimerId = setTimeout(() => {
      this._requestStaticMap(slot, finish);
    }, 1200);
    const rootMapFallbackTimerId = setTimeout(() => {
      if (rootMapFallback) finish('ok', rootMapFallback);
    }, 700);
    const timeoutId = setTimeout(() => finish('error'), 12000);
    this._mapTopics.set(index, {
      topics, timeoutId, staticMapTimerId, rootMapFallbackTimerId, finish
    });
    topics.forEach(topic => topic.subscribe(msg => {
      const sourceName = topic.name || topic.options?.name;
      if (sourceName === `/${slot.robotId}/map`) finish('ok', msg);
      else rootMapFallback = msg;
    }));
  },

  _requestStaticMap(slot, finish) {
    if (!slot?.ros || typeof ROSLIB === 'undefined' || typeof ROSLIB.Service !== 'function') return;
    const serviceNames = Array.from(new Set([`/${slot.robotId}/static_map`, '/static_map']));
    serviceNames.forEach(name => {
      const service = new ROSLIB.Service({
        ros: slot.ros,
        name,
        serviceType: 'nav_msgs/GetMap'
      });
      const request = typeof ROSLIB.ServiceRequest === 'function'
        ? new ROSLIB.ServiceRequest({})
        : {};
      service.callService(request, result => {
        const map = result?.map;
        if (map?.info && map?.data) finish('ok', map);
      }, () => {
        // The alternate namespaced/root service may still exist; the overall
        // map check timeout owns the final error state.
      });
    });
  },

  _seedActiveRobotMap(connectedIndices) {
    const index = App.activeSlotIndex;
    if (!connectedIndices.includes(index)) return;
    if (typeof RosManager === 'undefined' || !RosManager.lastMapMsg) return;
    this._acceptMap(index, RosManager.lastMapMsg);
  },

  _acceptMap(index, message) {
    const signature = this.mapFingerprint(message);
    this._mapStates.set(index, { status: 'ok', signature });
    if (!this._referenceMap || index === App.activeSlotIndex) {
      this._referenceMap = message;
      this._referenceSignature = signature;
      this._referenceSlotIndex = index;
      this._mapImageCanvas = null;
      this._mapImageSignature = null;
    }
    if (index === this._activeMapSyncIndex) {
      this._activeMapSyncIndex = -1;
    }
  },

  _cancelMapCheck(index) {
    this._mapQueue = this._mapQueue.filter(item => item !== index);
    const record = this._mapTopics.get(index);
    if (record) record.finish('cancelled');
  },

  _clearMapChecks() {
    this._mapQueue = [];
    Array.from(this._mapTopics.values()).forEach(record => {
      clearTimeout(record.timeoutId);
      clearTimeout(record.staticMapTimerId);
      clearTimeout(record.rootMapFallbackTimerId);
      (record.topics || []).forEach(topic => {
        try { topic.unsubscribe(); } catch (e) { /* ignore */ }
      });
    });
    this._mapTopics.clear();
    this._mapInFlight = 0;
  },

  mapFingerprint(message) {
    const info = message?.info || {};
    const origin = info.origin || {};
    const position = origin.position || {};
    const orientation = origin.orientation || {};
    const metadata = [
      Number(info.width) || 0,
      Number(info.height) || 0,
      (Number(info.resolution) || 0).toFixed(8),
      (Number(position.x) || 0).toFixed(6),
      (Number(position.y) || 0).toFixed(6),
      (Number(position.z) || 0).toFixed(6),
      (Number(orientation.x) || 0).toFixed(6),
      (Number(orientation.y) || 0).toFixed(6),
      (Number(orientation.z) || 0).toFixed(6),
      (Number(orientation.w) || 0).toFixed(6)
    ].join(':');

    let hash = 2166136261;
    const data = message?.data || [];
    for (let i = 0; i < data.length; i++) {
      hash ^= (Number(data[i]) + 2) & 0xff;
      hash = Math.imul(hash, 16777619);
    }
    return `${metadata}:${data.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  },

  requestRender() {
    if (!this._active || this._renderTimer) return;
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      this.render();
    }, 80);
  },

  render() {
    if (!this._active) return;
    this._renderStatus();
    this._renderMap();
    this._renderLegend();
  },

  _renderStatus() {
    const connected = this._connectedIndices();
    const poseCount = connected.filter(index => this._poses.has(index)).length;
    const mapComplete = connected.filter(index => this._mapStates.get(index)?.status === 'ok').length;
    const summary = document.getElementById('fleet-control-summary');
    const referenceSlot = App.robotSlots[this._referenceSlotIndex];
    const activeSlot = App.robotSlots[App.activeSlotIndex];
    const activeMapSource = document.getElementById('fleet-active-map-source');
    if (summary) {
      const referenceText = referenceSlot ? ` · 기준 맵 ${this._robotNumber(referenceSlot)}` : '';
      summary.textContent = `연결 ${connected.length}대 · 위치 ${poseCount}대 · 맵 확인 ${mapComplete}/${connected.length}${referenceText}`;
    }
    if (activeMapSource) {
      const activeNumber = activeSlot ? this._robotNumber(activeSlot) : '--';
      const synchronized = this._referenceSlotIndex === App.activeSlotIndex && Boolean(this._referenceMap);
      const syncing = this._activeMapSyncIndex === App.activeSlotIndex;
      const failed = this._mapStates.get(App.activeSlotIndex)?.status === 'error';
      activeMapSource.textContent = syncing
        ? `${activeNumber}번 맵 동기화 중`
        : failed
          ? `${activeNumber}번 맵 실패`
        : synchronized
          ? `${activeNumber}번 활성 맵`
          : `${activeNumber}번 맵 대기`;
      activeMapSource.classList.toggle('syncing', syncing);
      activeMapSource.classList.toggle('ready', synchronized && !syncing);
      activeMapSource.classList.toggle('error', failed && !syncing);
    }

    const warning = document.getElementById('fleet-map-warning');
    if (!warning) return;
    const mismatched = connected.filter(index => {
      const state = this._mapStates.get(index);
      return state?.status === 'ok' && this._referenceSignature && state.signature !== this._referenceSignature;
    });
    const failed = connected.filter(index => this._mapStates.get(index)?.status === 'error');
    const warnings = [];
    if (mismatched.length > 0) {
      warnings.push(`맵 불일치 로봇: ${mismatched.map(index => this._robotNumber(App.robotSlots[index])).join(', ')}`);
    }
    if (failed.length > 0) {
      warnings.push(`맵 확인 실패: ${failed.map(index => this._robotNumber(App.robotSlots[index])).join(', ')}`);
    }
    warning.textContent = warnings.length > 0 ? `⚠ ${warnings.join(' · ')}` : '';
    warning.classList.toggle('hidden', warnings.length === 0);
  },

  _renderMap() {
    const canvas = document.getElementById('fleet-control-map');
    const empty = document.getElementById('fleet-control-empty');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const rect = wrap?.getBoundingClientRect() || { width: 1200, height: 700 };
    const displayWidth = Math.max(1, Math.floor(rect.width || 1200));
    const displayHeight = Math.max(1, Math.floor(rect.height || 700));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.floor(displayWidth * dpr);
    const pixelHeight = Math.floor(displayHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(0, 0, displayWidth, displayHeight);
    this._robotHitAreas = [];

    if (!this._referenceMap) {
      if (empty) {
        empty.textContent = this._connectedIndices().length > 0 ? '기준 맵을 확인하고 있습니다...' : '연결된 로봇이 없습니다.';
        empty.classList.remove('hidden');
      }
      return;
    }
    if (empty) empty.classList.add('hidden');

    const info = this._referenceMap.info;
    const mapImage = this._buildMapImage(this._referenceMap);
    const padding = 24;
    const scale = Math.min(
      Math.max(0.01, (displayWidth - padding * 2) / info.width),
      Math.max(0.01, (displayHeight - padding * 2) / info.height)
    );
    const drawWidth = info.width * scale;
    const drawHeight = info.height * scale;
    const offsetX = (displayWidth - drawWidth) / 2;
    const offsetY = (displayHeight - drawHeight) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mapImage, offsetX, offsetY, drawWidth, drawHeight);

    this._drawRunningTaskRoutes(ctx, info, scale, offsetX, offsetY);

    this._connectedIndices().forEach(index => {
      const pose = this._poses.get(index);
      if (!pose) return;
      const point = this._worldToCanvas(pose, info, scale, offsetX, offsetY);
      const iconScale = this._robotIconSize / 40;
      this._robotHitAreas.push({
        index,
        x: point.x,
        y: point.y,
        radius: Math.max(22, 29 * iconScale)
      });
      this._drawRobot(ctx, point.x, point.y, pose.yaw - point.originYaw, index, pose.receivedAt);
    });
  },

  _drawRunningTaskRoutes(ctx, info, scale, offsetX, offsetY) {
    if (!this._showTaskRoutes || typeof ActionSender === 'undefined') return;
    this._connectedIndices().forEach(index => {
      const slot = App.robotSlots[index];
      const running = slot?.robotId ? ActionSender._runningTasks?.get(slot.robotId) : null;
      const points = Array.from(running?.points || []);
      if (points.length === 0) return;
      const color = this._colorForSlot(slot, index);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      points.forEach((point, pointIndex) => {
        const canvasPoint = this._worldToCanvas(point, info, scale, offsetX, offsetY);
        if (pointIndex > 0) {
          const previous = this._worldToCanvas(points[pointIndex - 1], info, scale, offsetX, offsetY);
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.globalAlpha = Number(point.actionIndex) < Number(running.actionIndex) ? 0.38 : 0.88;
          ctx.lineWidth = Number(point.actionIndex) === Number(running.actionIndex) ? 4 : 2.5;
          ctx.setLineDash(Number(point.actionIndex) === Number(running.actionIndex) ? [] : [7, 4]);
          ctx.moveTo(previous.x, previous.y);
          ctx.lineTo(canvasPoint.x, canvasPoint.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = Number(point.actionIndex) === Number(running.actionIndex) ? '#facc15' : color;
        ctx.beginPath();
        ctx.arc(canvasPoint.x, canvasPoint.y, Number(point.actionIndex) === Number(running.actionIndex) ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    });
  },

  _buildMapImage(message) {
    const signature = this._referenceSignature || this.mapFingerprint(message);
    if (this._mapImageCanvas && this._mapImageSignature === signature) return this._mapImageCanvas;
    const width = message.info.width;
    const height = message.info.height;
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = width;
    mapCanvas.height = height;
    const ctx = mapCanvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = message.data[(height - 1 - y) * width + x];
        const color = value === -1 ? 128 : (value <= 0 ? 255 : Math.max(0, 255 - Math.round(value * 2.55)));
        const offset = (y * width + x) * 4;
        image.data[offset] = color;
        image.data[offset + 1] = color;
        image.data[offset + 2] = color;
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    this._mapImageCanvas = mapCanvas;
    this._mapImageSignature = signature;
    return mapCanvas;
  },

  _worldToCanvas(pose, info, scale, offsetX, offsetY) {
    const origin = info.origin || {};
    const originPosition = origin.position || { x: 0, y: 0 };
    const originYaw = this._yawFromQuaternion(origin.orientation || { w: 1 });
    const dx = pose.x - (Number(originPosition.x) || 0);
    const dy = pose.y - (Number(originPosition.y) || 0);
    const cos = Math.cos(originYaw);
    const sin = Math.sin(originYaw);
    const localX = cos * dx + sin * dy;
    const localY = -sin * dx + cos * dy;
    const mapX = localX / info.resolution;
    const mapY = info.height - localY / info.resolution;
    return {
      x: offsetX + mapX * scale,
      y: offsetY + mapY * scale,
      originYaw
    };
  },

  _drawRobot(ctx, x, y, yaw, index, receivedAt) {
    const slot = App.robotSlots[index];
    if (!slot) return;
    const color = this._colorForSlot(slot, index);
    const stale = Date.now() - receivedAt > 5000;
    const scale = this._robotIconSize / 40;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-yaw);
    ctx.globalAlpha = stale ? 0.45 : 1;

    if (index === this._selectedSlotIndex) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.strokeRect(-22 * scale, -17 * scale, 44 * scale, 34 * scale);
    }

    // Robot body: a simple rectangle. The arrow inside the front (+X) edge
    // is the only directional marker, so every robot keeps the same footprint.
    ctx.fillStyle = color;
    ctx.fillRect(-18 * scale, -13 * scale, 36 * scale, 26 * scale);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    ctx.strokeRect(-18 * scale, -13 * scale, 36 * scale, 26 * scale);

    ctx.beginPath();
    ctx.moveTo(5 * scale, 0);
    ctx.lineTo(14 * scale, 0);
    ctx.moveTo(9 * scale, -5 * scale);
    ctx.lineTo(14 * scale, 0);
    ctx.lineTo(9 * scale, 5 * scale);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = stale ? 0.55 : 1;
    ctx.font = `700 ${Math.max(9, 10 * scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2.5, 3 * scale);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    const label = this._robotNumber(slot);
    ctx.strokeText(label, x - 4 * scale, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x - 4 * scale, y);
    if (this._showTaskLabels && typeof ActionSender !== 'undefined') {
      const running = ActionSender._runningTasks?.get(slot.robotId);
      if (running) {
        const taskLabel = `${running.taskId} · ${String(running.state || 'work').toUpperCase()}`;
        ctx.font = `600 ${Math.max(9, 9 * scale)}px sans-serif`;
        ctx.strokeText(taskLabel, x, y + 24 * scale);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(taskLabel, x, y + 24 * scale);
      }
    }
    ctx.restore();
  },

  _renderLegend() {
    const legend = document.getElementById('fleet-control-legend');
    if (!legend) return;
    legend.innerHTML = '';
    this._connectedIndices().forEach(index => {
      const slot = App.robotSlots[index];
      const pose = this._poses.get(index);
      const chip = document.createElement('span');
      chip.className = 'fleet-control-robot-chip'
        + (!pose || Date.now() - pose.receivedAt > 5000 ? ' stale' : '')
        + (index === this._selectedSlotIndex ? ' selected' : '');
      chip.title = '클릭하여 Task 대상 로봇 선택';
      chip.addEventListener('click', () => this._selectRobot(index));
      const dot = document.createElement('span');
      dot.className = 'fleet-control-color-dot';
      dot.style.backgroundColor = this._colorForSlot(slot, index);
      const label = document.createElement('span');
      label.textContent = `${this._robotNumber(slot)} · ${pose ? `${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}` : '위치 대기'}`;
      chip.appendChild(dot);
      chip.appendChild(label);
      legend.appendChild(chip);
    });
  },

  _handleMapClick(event) {
    const canvas = document.getElementById('fleet-control-map');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    this._robotHitAreas.forEach(area => {
      const distance = Math.hypot(x - area.x, y - area.y);
      if (distance <= area.radius && (!best || distance < best.distance)) {
        best = { index: area.index, distance };
      }
    });
    if (best) this._selectRobot(best.index);
  },

  _selectRobot(index) {
    const slot = App.robotSlots[index];
    if (!slot?.connected || !slot.ros) return;
    this._selectedSlotIndex = index;
    this._updateTaskPanel();
    this.requestRender();
  },

  _setRobotIconSize(value, persist = true) {
    const size = Math.max(24, Math.min(72, Number(value) || 40));
    this._robotIconSize = size;
    const slider = document.getElementById('fleet-icon-size');
    const label = document.getElementById('fleet-icon-size-value');
    if (slider) slider.value = String(size);
    if (label) label.textContent = `${size} px`;
    if (persist) {
      try { localStorage.setItem('fleetRobotIconSize', String(size)); } catch (e) { /* ignore */ }
    }
    this.requestRender();
  },

  _refreshTaskOptions(filterText = '') {
    const list = document.getElementById('fleet-task-list');
    if (!list || typeof ActionSender === 'undefined') return;
    const saved = ActionSender.getSavedQueues();
    const filter = String(filterText || '').trim().toLowerCase();
    const shortcutNames = this._shortcutTaskNames(saved);
    const names = Object.keys(saved)
      .filter(name => !filter || name.toLowerCase().includes(filter))
      .sort((a, b) => a.localeCompare(b));
    if (this._selectedTaskName && !saved[this._selectedTaskName]) this._selectedTaskName = '';
    list.innerHTML = '';
    if (names.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fleet-task-empty';
      empty.textContent = filter ? '검색 결과가 없습니다.' : '저장된 Task가 없습니다.';
      list.appendChild(empty);
      this._updateTaskPanel();
      this._updateTaskDetail();
      return;
    }
    names.forEach(name => {
      const entry = saved[name] || {};
      const count = Array.isArray(entry.queue) ? entry.queue.length : 0;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'fleet-task-list-item' + (name === this._selectedTaskName ? ' selected' : '');
      const nameEl = document.createElement('span');
      nameEl.textContent = name;
      const countEl = document.createElement('small');
      countEl.textContent = `${count} actions`;
      const shortcutIndex = shortcutNames.indexOf(name);
      item.appendChild(nameEl);
      item.appendChild(countEl);
      if (shortcutIndex >= 0) {
        const shortcut = document.createElement('kbd');
        shortcut.className = 'fleet-task-shortcut';
        shortcut.textContent = `Ctrl+${shortcutIndex + 1}`;
        item.appendChild(shortcut);
      }
      item.addEventListener('click', () => this._selectTask(name));
      list.appendChild(item);
    });
    this._updateTaskPanel();
    this._updateTaskDetail();
  },

  _selectTask(name) {
    this._selectedTaskName = name;
    const filter = document.getElementById('fleet-task-filter')?.value || '';
    this._refreshTaskOptions(filter);
    this._updateTaskDetail();
  },

  _shortcutTaskNames(saved = null) {
    const queues = saved || (typeof ActionSender !== 'undefined'
      ? ActionSender.getSavedQueues()
      : {});
    return Object.keys(queues || {})
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 9);
  },

  _handleTaskShortcut(event = {}) {
    if (!this._active || !(event.ctrlKey || event.metaKey)
        || event.altKey || event.shiftKey || !/^[1-9]$/.test(String(event.key || ''))) {
      return false;
    }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    if (event.repeat) return true;

    const shortcutNumber = Number(event.key);
    const taskName = this._shortcutTaskNames()[shortcutNumber - 1];
    if (!taskName) {
      App.toast?.(`Ctrl+${shortcutNumber}에 해당하는 저장 Task가 없습니다.`, 'info');
      return true;
    }
    this._requestShortcutTask(taskName, shortcutNumber);
    return true;
  },

  _handleShortcutTaskModalKey(event = {}) {
    if (!this._pendingShortcutTask || event.isComposing) return false;
    if (event.key !== 'Enter' && event.key !== 'Escape') return false;

    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    if (event.repeat) return true;

    if (event.key === 'Escape') {
      this._closeShortcutTaskConfirm();
    } else {
      this._confirmShortcutTask();
    }
    return true;
  },

  _requestShortcutTask(taskName, shortcutNumber) {
    if (this._taskRunning || typeof ActionSender === 'undefined') return false;
    const slot = App.robotSlots?.[this._selectedSlotIndex];
    const entry = ActionSender.getSavedQueues()?.[taskName];
    if (!slot?.connected || !slot?.ros) {
      this._setTaskResult('error', '관제 맵에서 Task 대상 로봇을 먼저 선택하세요.');
      App.toast?.('관제 맵에서 Task 대상 로봇을 먼저 선택하세요.', 'warning');
      return false;
    }
    if (!entry || !Array.isArray(entry.queue) || entry.queue.length === 0) {
      this._setTaskResult('error', `"${taskName}" Task 정보가 없거나 Action이 비어 있습니다.`);
      return false;
    }

    this._selectedTaskName = taskName;
    const filter = document.getElementById('fleet-task-filter')?.value || '';
    this._refreshTaskOptions(filter);
    const loopInput = document.getElementById('fleet-task-loop');
    const requestedLoop = parseInt(loopInput?.value, 10);
    const loopCount = Math.max(0, Math.min(
      9999,
      Number.isFinite(requestedLoop) ? requestedLoop : (Number(entry.loopFlag) || 0)
    ));
    const model = ActionSender.getTaskDetailModel?.(taskName);
    this._pendingShortcutTask = {
      taskName,
      shortcutNumber,
      slotIndex: this._selectedSlotIndex,
      robotId: slot.robotId,
      loopCount
    };

    const modal = document.getElementById('fleet-shortcut-task-modal');
    const shortcut = document.getElementById('fleet-shortcut-task-key');
    const robot = document.getElementById('fleet-shortcut-task-robot');
    const name = document.getElementById('fleet-shortcut-task-name');
    const meta = document.getElementById('fleet-shortcut-task-meta');
    const preview = document.getElementById('fleet-shortcut-task-preview');
    if (shortcut) shortcut.textContent = `Ctrl+${shortcutNumber}`;
    if (robot) robot.textContent = `${slot.robotId} · ${slot.ip || '--'}`;
    if (name) name.textContent = model?.name || entry.yamlTaskId || taskName;
    if (meta) {
      const missionCount = model?.missionCount ?? '?';
      const actionCount = model?.actions?.length ?? entry.queue.length;
      meta.textContent = `${missionCount} Missions · ${actionCount} Actions · 반복 ${loopCount}`;
    }
    if (preview) {
      preview.innerHTML = '';
      const actions = Array.from(model?.actions || []).slice(0, 4);
      actions.forEach((action, index) => {
        const row = document.createElement('div');
        row.className = 'fleet-shortcut-action-row';
        row.textContent = `${index + 1}. ${action.id} · ${action.typeName}`;
        preview.appendChild(row);
      });
      if ((model?.actions?.length || 0) > actions.length) {
        const more = document.createElement('small');
        more.textContent = `외 ${(model.actions.length - actions.length)}개 Action`;
        preview.appendChild(more);
      }
    }
    modal?.classList.add('show');
    return true;
  },

  _closeShortcutTaskConfirm() {
    document.getElementById('fleet-shortcut-task-modal')?.classList.remove('show');
    this._pendingShortcutTask = null;
  },

  async _confirmShortcutTask() {
    const pending = this._pendingShortcutTask;
    if (!pending) return;
    const currentSlot = App.robotSlots?.[pending.slotIndex];
    if (!currentSlot?.connected || !currentSlot.ros || currentSlot.robotId !== pending.robotId) {
      this._closeShortcutTaskConfirm();
      this._setTaskResult('error', '선택했던 로봇의 연결 상태가 변경되었습니다. 다시 선택하세요.');
      return;
    }
    this._pendingShortcutTask = null;
    document.getElementById('fleet-shortcut-task-modal')?.classList.remove('show');
    await this._runSelectedTask(true, pending.loopCount);
  },

  _updateTaskDetail() {
    const detail = document.getElementById('fleet-task-detail');
    if (!detail) return;
    if (typeof ActionSender === 'undefined' || !ActionSender.renderTaskDetail) {
      detail.textContent = 'Task 상세 정보를 불러올 수 없습니다.';
      return;
    }
    ActionSender.renderTaskDetail(detail, this._selectedTaskName);
  },

  _updateTaskPanel() {
    const slot = App.robotSlots?.[this._selectedSlotIndex];
    const label = document.getElementById('fleet-task-robot');
    const detail = document.getElementById('fleet-task-robot-detail');
    const card = document.getElementById('fleet-task-robot-card');
    const selectedLabel = document.getElementById('fleet-task-selected-label');
    const taskName = document.getElementById('fleet-task-selected-name');
    const runButton = document.getElementById('btn-fleet-task-run');
    const cancelButton = document.getElementById('btn-fleet-task-cancel');
    const infoButton = document.getElementById('btn-fleet-running-task-info');
    const running = slot?.robotId && typeof ActionSender !== 'undefined'
      ? ActionSender._runningTasks?.get(slot.robotId)
      : null;
    if (label) {
      label.textContent = slot?.connected
        ? `${this._robotNumber(slot)} · ${slot.robotId}`
        : '로봇을 클릭하세요';
    }
    if (detail) {
      detail.textContent = slot?.connected
        ? `${slot.ip} · ${this._selectedSlotIndex === App.activeSlotIndex ? '수신' : '대기'}${
          running ? ` · ${running.taskId} (${String(running.state || 'work').toUpperCase()})` : ''
        }`
        : '맵 아이콘 또는 하단 목록에서 선택';
    }
    card?.classList.toggle('empty', !slot?.connected);
    if (selectedLabel) selectedLabel.textContent = slot?.connected ? '선택됨' : '미선택';
    if (taskName) taskName.textContent = this._selectedTaskName || '선택 안 됨';
    const robotEnabled = Boolean(slot?.connected && slot?.ros) && !this._taskRunning;
    if (runButton) runButton.disabled = !(robotEnabled && this._selectedTaskName);
    if (cancelButton) cancelButton.disabled = !robotEnabled;
    if (infoButton) infoButton.disabled = !running;
  },

  _showSelectedRunningTaskInfo() {
    const slot = App.robotSlots?.[this._selectedSlotIndex];
    const running = slot?.robotId && typeof ActionSender !== 'undefined'
      ? ActionSender._runningTasks?.get(slot.robotId)
      : null;
    if (!running) {
      App.toast('선택한 로봇의 실행 Task 정보가 없습니다.', 'info');
      return;
    }
    ActionSender.showTaskInfoFromQueue(
      running.taskId,
      running.queue,
      running.loopFlag,
      `${running.robotId} · ${String(running.state || 'work').toUpperCase()}`
    );
  },

  async _runSelectedTask(skipConfirm = false, requestedLoopCount = null) {
    if (this._taskRunning || typeof ActionSender === 'undefined') return;
    const slot = App.robotSlots?.[this._selectedSlotIndex];
    const loopInput = document.getElementById('fleet-task-loop');
    const taskName = this._selectedTaskName;
    if (!slot?.connected || !slot?.ros) {
      this._setTaskResult('error', 'Task 대상 로봇을 먼저 선택하세요.');
      return;
    }
    if (!taskName) {
      this._setTaskResult('error', '오른쪽 Task 목록에서 실행할 Task를 선택하세요.');
      return;
    }
    const savedNames = ActionSender.getSavedQueueNames();
    if (!savedNames.includes(taskName)) {
      this._setTaskResult('error', `"${taskName}" Task가 없습니다. Tasks 탭에서 먼저 저장하세요.`);
      return;
    }
    const loopCount = requestedLoopCount === null
      ? Math.max(0, Math.min(9999, parseInt(loopInput?.value, 10) || 0))
      : Math.max(0, Math.min(9999, Number(requestedLoopCount) || 0));
    if (!skipConfirm && !confirm(`${slot.robotId}에서 "${taskName}" Task를 실행하시겠습니까?`)) return;

    this._taskRunning = true;
    this._updateTaskPanel();
    this._setTaskResult('running', `${slot.robotId} · ${taskName} 전송 중...`);
    try {
      const sent = await ActionSender.sendSavedQueueToSlot(
        taskName,
        this._selectedSlotIndex,
        loopCount
      );
      this._setTaskResult('success', `✓ ${sent.robotId} · ${taskName} 실행 요청 완료 (${sent.actionCount} actions)`);
      App.toast(`${sent.robotId}: "${taskName}" Task 실행 요청 완료`, 'success');
    } catch (error) {
      this._setTaskResult('error', `Task 실행 실패: ${error.message || error}`);
      App.toast(`Task 실행 실패: ${error.message || error}`, 'error');
    } finally {
      this._taskRunning = false;
      this._updateTaskPanel();
    }
  },

  async _cancelSelectedTask() {
    if (this._taskRunning || typeof ActionSender === 'undefined') return;
    const slot = App.robotSlots?.[this._selectedSlotIndex];
    if (!slot?.connected || !slot?.ros) {
      this._setTaskResult('error', 'Task 대상 로봇을 먼저 선택하세요.');
      return;
    }
    if (!confirm(`${slot.robotId}에서 실행 중인 Task를 취소하시겠습니까?`)) return;
    this._taskRunning = true;
    this._updateTaskPanel();
    this._setTaskResult('running', `${slot.robotId} · Task 취소 요청 중...`);
    try {
      await ActionSender.cancelTaskOnSlot(this._selectedSlotIndex);
      this._setTaskResult('success', `✓ ${slot.robotId} Task 취소 요청 승인 · 종료 상태 확인 중`);
    } catch (error) {
      this._setTaskResult('error', `Task 취소 실패: ${error.message || error}`);
    } finally {
      this._taskRunning = false;
      this._updateTaskPanel();
    }
  },

  _setTaskResult(state, message) {
    const element = document.getElementById('fleet-task-result');
    if (!element) return;
    element.className = `fleet-task-result ${state || ''}`;
    element.textContent = message;
    element.title = message;
  },

  _robotNumber(slot) {
    if (!slot) return '---';
    if (typeof App.getRobotUnitNumber === 'function') {
      const unit = App.getRobotUnitNumber(slot);
      if (Number.isFinite(unit)) return String(unit).padStart(3, '0');
    }
    const ridMatch = String(slot.robotId || '').match(/(\d{1,3})/);
    if (ridMatch) return ridMatch[1].padStart(3, '0');
    const ipPart = Number.parseInt(String(slot.ip || '').split('.').pop(), 10);
    return Number.isFinite(ipPart) ? String(ipPart).padStart(3, '0') : '---';
  },

  _colorForSlot(slot, index) {
    const numeric = Number.parseInt(this._robotNumber(slot), 10);
    const colorIndex = Number.isFinite(numeric) ? numeric : index;
    return this._colors[Math.abs(colorIndex) % this._colors.length];
  }
};

document.addEventListener('DOMContentLoaded', () => FleetControl.init());
