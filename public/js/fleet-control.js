// Fleet control: render every connected robot on one verified map.
const FleetControl = {
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
  _renderTimer: null,
  _resizeObserver: null,
  _selectedSlotIndex: -1,
  _robotHitAreas: [],
  _robotIconSize: 40,
  _selectedTaskName: '',
  _taskRunning: false,
  _colors: ['#22c55e', '#38bdf8', '#f59e0b', '#a78bfa', '#f43f5e', '#14b8a6', '#eab308', '#fb7185'],

  init() {
    document.getElementById('btn-fleet-map-refresh')?.addEventListener('click', () => {
      this.refreshMaps();
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
    document.getElementById('btn-fleet-task-cancel')?.addEventListener('click', () => {
      this._cancelSelectedTask();
    });
    document.addEventListener('easyloop:tasks-changed', () => {
      if (!this._active) return;
      const filter = document.getElementById('fleet-task-filter')?.value || '';
      this._refreshTaskOptions(filter);
    });
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
    connected.sort((a, b) => {
      if (a === App.activeSlotIndex) return -1;
      if (b === App.activeSlotIndex) return 1;
      return a - b;
    });
    this._seedActiveRobotMap(connected);
    connected.forEach(index => this._enqueueMapCheck(index));
    this.requestRender();
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

    const robotStateTopic = new ROSLIB.Topic({
      ros: slot.ros,
      name: `/${rid}/robot_state`,
      messageType: 'syscon_msgs/RobotState',
      throttle_rate: 500,
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

    const amclTopic = new ROSLIB.Topic({
      ros: slot.ros,
      name: `/${rid}/amcl_pose`,
      messageType: 'geometry_msgs/PoseWithCovarianceStamped',
      throttle_rate: 500,
      queue_length: 1
    });
    amclTopic.subscribe((msg) => {
      if (!this._active || generation !== this._generation || App.robotSlots[index] !== slot) return;
      const current = this._poses.get(index);
      if (current?.source === 'robot_state' && Date.now() - current.receivedAt < 3000) return;
      const pose = msg?.pose?.pose;
      if (!pose?.position || !pose?.orientation) return;
      this._updatePose(index, {
        x: Number(pose.position.x),
        y: Number(pose.position.y),
        yaw: this._yawFromQuaternion(pose.orientation)
      }, 'amcl_pose');
    });

    this._positionSubscriptions.set(index, [robotStateTopic, amclTopic]);
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

  _enqueueMapCheck(index) {
    if (!this._active || this._mapStates.has(index) || this._mapQueue.includes(index)) return;
    const slot = App.robotSlots[index];
    if (!slot || !slot.connected || !slot.ros) return;
    this._mapStates.set(index, { status: 'pending' });
    this._mapQueue.push(index);
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
    // Deployments expose either /{rid}/map or the standard /map. First response wins.
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
    this._mapInFlight += 1;
    this._mapStates.set(index, { status: 'loading' });

    const finish = (status, message = null) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      clearTimeout(staticMapTimerId);
      topics.forEach(topic => {
        try { topic.unsubscribe(); } catch (e) { /* ignore */ }
      });
      this._mapTopics.delete(index);
      this._mapInFlight = Math.max(0, this._mapInFlight - 1);

      if (generation === this._mapGeneration && this._active) {
        if (status === 'ok' && message) this._acceptMap(index, message);
        else if (status === 'cancelled') this._mapStates.delete(index);
        else this._mapStates.set(index, { status: 'error' });
        this._pumpMapQueue();
        this.requestRender();
      }
    };

    const staticMapTimerId = setTimeout(() => {
      this._requestStaticMap(slot, finish);
    }, 1200);
    const timeoutId = setTimeout(() => finish('error'), 12000);
    this._mapTopics.set(index, { topics, timeoutId, staticMapTimerId, finish });
    topics.forEach(topic => topic.subscribe(msg => finish('ok', msg)));
  },

  _requestStaticMap(slot, finish) {
    if (!slot?.ros || typeof ROSLIB?.Service !== 'function') return;
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
    if (!this._referenceMap) {
      this._referenceMap = message;
      this._referenceSignature = signature;
      this._referenceSlotIndex = index;
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
    if (summary) {
      const referenceText = referenceSlot ? ` · 기준 맵 ${this._robotNumber(referenceSlot)}` : '';
      summary.textContent = `연결 ${connected.length}대 · 위치 ${poseCount}대 · 맵 확인 ${mapComplete}/${connected.length}${referenceText}`;
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
      item.appendChild(nameEl);
      item.appendChild(countEl);
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
    if (label) {
      label.textContent = slot?.connected
        ? `${this._robotNumber(slot)} · ${slot.robotId}`
        : '로봇을 클릭하세요';
    }
    if (detail) {
      detail.textContent = slot?.connected
        ? `${slot.ip} · ${this._selectedSlotIndex === App.activeSlotIndex ? '연결됨(데이터수신)' : '연결됨(대기)'}`
        : '맵 아이콘 또는 하단 목록에서 선택';
    }
    card?.classList.toggle('empty', !slot?.connected);
    if (selectedLabel) selectedLabel.textContent = slot?.connected ? '선택됨' : '미선택';
    if (taskName) taskName.textContent = this._selectedTaskName || '선택 안 됨';
    const robotEnabled = Boolean(slot?.connected && slot?.ros) && !this._taskRunning;
    if (runButton) runButton.disabled = !(robotEnabled && this._selectedTaskName);
    if (cancelButton) cancelButton.disabled = !robotEnabled;
  },

  async _runSelectedTask() {
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
    const loopCount = Math.max(0, Math.min(9999, parseInt(loopInput?.value, 10) || 0));
    if (!confirm(`${slot.robotId}에서 "${taskName}" Task를 실행하시겠습니까?`)) return;

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
      this._setTaskResult('success', `✓ ${slot.robotId} Task 취소 요청 완료`);
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
