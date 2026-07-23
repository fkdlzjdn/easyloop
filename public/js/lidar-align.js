// LiDAR Alignment Check — Range Comparison method
// Compares scan_1 (front) and scan_2 (rear) range values in overlap angular zone
const LidarAlign = {
  _active: false,
  _scan1Sub: null,
  _scan2Sub: null,
  _scan1: null,
  _scan2: null,
  _renderTimer: null,

  // Zoom & Pan
  _zoom: 1.0,
  _panX: 0,
  _panY: 0,
  _baseScale: 80,
  _dragging: false,
  _dragStartX: 0,
  _dragStartY: 0,
  _dragPanX: 0,
  _dragPanY: 0,

  // LiDAR config (read from robot TF)
  _configLoaded: false,
  _robotModel: null,
  _tfStaticSub: null,
  _tfStaticFrames: {},  // frame_id → {parent, x, y, z, yaw}
  // Default: sr3 diagonal layout (overwritten by /tf_static when available)
  _config: {
    frontX: 0.4307, frontY: -0.3307, frontYaw: -Math.PI / 4,
    rearX: -0.4307, rearY: 0.3307, rearYaw: Math.PI + (-Math.PI / 4),
  },

  // Load LiDAR TF by subscribing to /tf_static via rosbridge
  _loadConfigFromRobot() {
    const slot = App.robotSlots[App.activeSlotIndex];
    if (!slot || !slot.ros) return;

    const rid = slot.robotId || '';
    this._tfStaticFrames = {};
    this._robotModel = slot.robotModel || null;

    // Subscribe to /tf_static to get all static transforms
    if (this._tfStaticSub) { this._tfStaticSub.unsubscribe(); this._tfStaticSub = null; }

    this._tfStaticSub = new ROSLIB.Topic({
      ros: slot.ros,
      name: '/tf_static',
      messageType: 'tf2_msgs/TFMessage',
      // tf_static is latched, so we get all on subscribe
    });

    this._tfStaticSub.subscribe((msg) => {
      if (!msg.transforms) return;
      for (const tf of msg.transforms) {
        const child = tf.child_frame_id.replace(/^\//, '');
        const parent = tf.header.frame_id.replace(/^\//, '');
        const t = tf.transform.translation;
        const q = tf.transform.rotation;
        // Quaternion to yaw
        const yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
        this._tfStaticFrames[child] = { parent, x: t.x, y: t.y, z: t.z, yaw };
      }

      // Try to resolve laser_1_link and laser_2_link to base_link
      this._resolveLaserTF(rid);
    });

    console.log('[LidarAlign] Subscribed to /tf_static');
  },

  // Resolve the full TF chain: base_link → ... → laser_X_link
  _resolveLaserTF(rid) {
    const frames = this._tfStaticFrames;

    // Find laser frame names (could be R_001/laser_1_link or just laser_1_link)
    const findFrame = (name) => {
      // Try with robot ID prefix first, then without
      const candidates = [
        `${rid}/laser_${name}_link`, `laser_${name}_link`,
        `${rid}/scan_${name}_link`, `scan_${name}_link`,
      ];
      for (const c of candidates) {
        if (frames[c]) return c;
      }
      return null;
    };

    const f1 = findFrame('1');
    const f2 = findFrame('2');

    if (!f1) {
      console.log('[LidarAlign] laser_1 frame not found yet, available:', Object.keys(frames).join(', '));
      return; // Not enough data yet, will retry on next tf_static message
    }

    // Walk chain from laser frame up to base_link
    const resolveChain = (frameName) => {
      let x = 0, y = 0, yaw = 0;
      let current = frameName;
      const visited = new Set();

      while (current && frames[current] && !visited.has(current)) {
        visited.add(current);
        const f = frames[current];
        // Apply transform: rotate current accumulated position by this frame's yaw, then add translation
        const cosY = Math.cos(f.yaw);
        const sinY = Math.sin(f.yaw);
        // The child position in parent = parent_rot * child_pos + parent_trans
        // We're going child→parent, so accumulate inversely:
        // Actually we want base_link → laser, so accumulate forward:
        // final = T_parent * T_child
        // But we're walking child→parent, so we need to compose:
        // pos_in_parent = rot(parent_yaw) * pos_accumulated + parent_translation

        // Simpler: just accumulate all the transforms from base_link down
        // Let me reverse the chain first
        break;
      }

      // Build chain from base_link down to target
      const chain = [];
      current = frameName;
      visited.clear();
      while (current && frames[current] && !visited.has(current)) {
        visited.add(current);
        chain.unshift({ frame: current, ...frames[current] });
        const stripped = frames[current].parent.replace(/^\//, '');
        if (stripped.includes('base_link') || stripped.includes('base_footprint')) break;
        current = stripped;
      }

      // Forward compose: base_link → intermediate → ... → laser
      let rx = 0, ry = 0, ryaw = 0;
      for (const tf of chain) {
        // Rotate accumulated offset by this transform's yaw
        const c = Math.cos(ryaw);
        const s = Math.sin(ryaw);
        rx += c * tf.x - s * tf.y;
        ry += s * tf.x + c * tf.y;
        ryaw += tf.yaw;
      }

      return { x: rx, y: ry, yaw: ryaw };
    };

    const tf1 = resolveChain(f1);
    const tf2 = f2 ? resolveChain(f2) : null;

    this._config = {
      frontX: tf1.x, frontY: tf1.y, frontYaw: tf1.yaw,
      rearX: tf2 ? tf2.x : -tf1.x,
      rearY: tf2 ? tf2.y : -tf1.y,
      rearYaw: tf2 ? tf2.yaw : (Math.PI + tf1.yaw),
    };
    this._configLoaded = true;

    // Unsubscribe after getting data (static, won't change)
    if (this._tfStaticSub) { this._tfStaticSub.unsubscribe(); this._tfStaticSub = null; }

    console.log(`[LidarAlign] TF resolved: L1(${tf1.x.toFixed(3)}, ${tf1.y.toFixed(3)}, ${(tf1.yaw*180/Math.PI).toFixed(1)}°) L2(${this._config.rearX.toFixed(3)}, ${this._config.rearY.toFixed(3)}, ${(this._config.rearYaw*180/Math.PI).toFixed(1)}°)`);
    App.toast(`LiDAR TF: L1(${tf1.x.toFixed(2)},${tf1.y.toFixed(2)}) L2(${this._config.rearX.toFixed(2)},${this._config.rearY.toFixed(2)})`, 'success');
  },

  // Thresholds
  _thresholds: {
    pitchPass: 3.0,   // mm
    pitchWarn: 8.0,
    yawPass: 0.3,     // degrees
    yawWarn: 0.8,
  },

  // Rolling average buffer
  _history: [],       // [{pitch, yaw}]
  _historyMax: 30,

  // Last analysis result for rendering
  _lastResult: null,

  init() {
    const btnOpen = document.getElementById('btn-lidar-align');
    const btnClose = document.getElementById('btn-lidar-align-close');
    const btnStart = document.getElementById('btn-lidar-align-start');
    const btnStop = document.getElementById('btn-lidar-align-stop');
    const btnCheck = document.getElementById('btn-lidar-align-check');
    const modal = document.getElementById('lidar-align-modal');

    if (!btnOpen) return;

    btnOpen.addEventListener('click', () => {
      if (modal) modal.style.display = 'flex';
    });
    btnClose.addEventListener('click', () => {
      this.stop();
      if (modal) modal.style.display = 'none';
    });
    btnStart.addEventListener('click', () => this.start());
    btnStop.addEventListener('click', () => this.stop());
    if (btnCheck) btnCheck.addEventListener('click', () => this._resetHistory());

    // Zoom & Pan
    const canvas = document.getElementById('lidar-align-canvas');
    if (canvas) {
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        this._zoom = Math.max(0.2, Math.min(10, this._zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      }, { passive: false });
      canvas.addEventListener('mousedown', (e) => {
        this._dragging = true;
        this._dragStartX = e.clientX;
        this._dragStartY = e.clientY;
        this._dragPanX = this._panX;
        this._dragPanY = this._panY;
        canvas.style.cursor = 'grabbing';
      });
      canvas.addEventListener('mousemove', (e) => {
        if (!this._dragging) return;
        this._panX = this._dragPanX + (e.clientX - this._dragStartX);
        this._panY = this._dragPanY + (e.clientY - this._dragStartY);
      });
      canvas.addEventListener('mouseup', () => { this._dragging = false; canvas.style.cursor = 'grab'; });
      canvas.addEventListener('mouseleave', () => { this._dragging = false; canvas.style.cursor = 'grab'; });
      canvas.style.cursor = 'grab';
    }
  },

  start() {
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots[slotIndex];
    if (!slot || !slot.ros) { App.toast('Robot not connected', 'error'); return; }

    const rid = slot.robotId;
    const ros = slot.ros;

    this._scan1Sub = new ROSLIB.Topic({ ros, name: `/${rid}/scan_1`, messageType: 'sensor_msgs/LaserScan', throttle_rate: 100 });
    this._scan1Sub.subscribe((msg) => { this._scan1 = msg; });

    this._scan2Sub = new ROSLIB.Topic({ ros, name: `/${rid}/scan_2`, messageType: 'sensor_msgs/LaserScan', throttle_rate: 100 });
    this._scan2Sub.subscribe((msg) => { this._scan2 = msg; });

    this._active = true;
    this._history = [];
    this._lastResult = null;
    this._scan1 = null;
    this._scan2 = null;
    this._zoom = 1.0;
    this._panX = 0;
    this._panY = 0;

    // Load LiDAR TF from /tf_static (latched, arrives immediately)
    if (!this._configLoaded) {
      this._loadConfigFromRobot();
    }

    if (this._renderTimer) clearInterval(this._renderTimer);
    this._renderTimer = setInterval(() => this._tick(), 200);

    document.getElementById('btn-lidar-align-start').disabled = true;
    document.getElementById('btn-lidar-align-stop').disabled = false;
    document.getElementById('btn-lidar-align-check').disabled = false;
    document.getElementById('btn-lidar-align-check').textContent = 'Reset';
    const st = document.getElementById('lidar-align-status');
    if (st) { st.textContent = 'Live'; st.style.color = '#4ade80'; }

    App.toast('scan_1 / scan_2 subscribing...', 'info');
  },

  stop() {
    if (this._scan1Sub) { this._scan1Sub.unsubscribe(); this._scan1Sub = null; }
    if (this._scan2Sub) { this._scan2Sub.unsubscribe(); this._scan2Sub = null; }
    if (this._tfStaticSub) { this._tfStaticSub.unsubscribe(); this._tfStaticSub = null; }
    if (this._renderTimer) { clearInterval(this._renderTimer); this._renderTimer = null; }
    this._active = false;
    this._configLoaded = false;

    document.getElementById('btn-lidar-align-start').disabled = false;
    document.getElementById('btn-lidar-align-stop').disabled = true;
    document.getElementById('btn-lidar-align-check').disabled = true;
    const st = document.getElementById('lidar-align-status');
    if (st) { st.textContent = 'Off'; st.style.color = ''; }
  },

  _resetHistory() {
    this._history = [];
    this._lastResult = null;
    App.toast('History reset', 'info');
  },

  // ── Core: Range Comparison Analysis ──

  _tick() {
    if (!this._scan1 || !this._scan2) { this._render(); return; }

    const result = this._analyzeRangeComparison(this._scan1, this._scan2);
    if (result) {
      this._lastResult = result;
      this._history.push({ pitch: result.pitchMm, yaw: result.yawDeg });
      if (this._history.length > this._historyMax) this._history.shift();

      // Rolling average
      const avg = this._history.reduce((s, h) => ({ pitch: s.pitch + h.pitch, yaw: s.yaw + h.yaw }), { pitch: 0, yaw: 0 });
      avg.pitch /= this._history.length;
      avg.yaw /= this._history.length;

      this._updateMeters(avg.pitch, avg.yaw);
      this._updateVerdict(avg.pitch, avg.yaw);
    }
    this._render();
  },

  _analyzeRangeComparison(scan1, scan2) {
    const cfg = this._config;

    // Convert both scans to {angle_in_base_link → range} maps
    const map1 = this._scanToAngleRangeMap(scan1, cfg.frontX, cfg.frontY || 0, cfg.frontYaw);
    const map2 = this._scanToAngleRangeMap(scan2, cfg.rearX, cfg.rearY || 0, cfg.rearYaw);

    // Find overlapping angles (1-degree resolution)
    const diffs = []; // [{angleDeg, diff_mm, range1, range2}]
    for (const angleDeg in map1) {
      if (map2[angleDeg]) {
        const r1 = map1[angleDeg];
        const r2 = map2[angleDeg];
        // Skip if ranges differ too much (different objects, not same surface)
        const diffM = r1 - r2;
        if (Math.abs(diffM) < 0.5) { // max 500mm difference to be considered same surface
          diffs.push({
            angleDeg: parseInt(angleDeg),
            diff_mm: diffM * 1000,
            range1: r1,
            range2: r2
          });
        }
      }
    }

    if (diffs.length < 5) return null;

    // Sort by angle
    diffs.sort((a, b) => a.angleDeg - b.angleDeg);

    // Pitch = mean of all differences (constant offset)
    const pitchMm = diffs.reduce((s, d) => s + d.diff_mm, 0) / diffs.length;

    // Yaw = linear regression slope of diff vs angle
    // diff_mm = slope * angleDeg + intercept
    const n = diffs.length;
    let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    for (const d of diffs) {
      sumX += d.angleDeg;
      sumY += d.diff_mm;
      sumXX += d.angleDeg * d.angleDeg;
      sumXY += d.angleDeg * d.diff_mm;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    // slope is mm per degree → convert to actual angular error
    // Approximation: at 1m range, 1° yaw error ≈ 17.5mm shift per degree of scan angle
    // yawDeg ≈ slope / (avg_range_m * 1000 * tan(1°))
    const avgRange = diffs.reduce((s, d) => s + (d.range1 + d.range2) / 2, 0) / n;
    const yawDeg = Math.atan(slope / 1000 / avgRange) * (180 / Math.PI);

    return { pitchMm, yawDeg, diffs, overlapCount: diffs.length, avgRange, slope };
  },

  // Convert LaserScan to {angleDeg_in_base_link: avg_range_m}
  _scanToAngleRangeMap(scan, offsetX, offsetY, offsetYaw) {
    const map = {};    // angleDeg → [ranges]
    const angleMin = scan.angle_min;
    const angleInc = scan.angle_increment;
    const ranges = scan.ranges;
    const rMin = scan.range_min || 0.05;
    const rMax = scan.range_max || 30;

    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (r < rMin || r > rMax || !isFinite(r)) continue;

      // Point in LiDAR local frame
      const localAngle = angleMin + i * angleInc;
      const lx = r * Math.cos(localAngle);
      const ly = r * Math.sin(localAngle);

      // Rotate by LiDAR yaw, then translate to base_link frame
      const cosY = Math.cos(offsetYaw);
      const sinY = Math.sin(offsetYaw);
      const bx = cosY * lx - sinY * ly + offsetX;
      const by = sinY * lx + cosY * ly + offsetY;

      // Angle in base_link frame (1-degree bucket)
      const baseAngle = Math.atan2(by, bx);
      const angleDeg = Math.round(baseAngle * 180 / Math.PI);
      const baseRange = Math.sqrt(bx * bx + by * by);

      if (!map[angleDeg]) map[angleDeg] = [];
      map[angleDeg].push(baseRange);
    }

    // Average per bucket
    const result = {};
    for (const deg in map) {
      const arr = map[deg];
      result[deg] = arr.reduce((s, v) => s + v, 0) / arr.length;
    }
    return result;
  },

  // Convert LaserScan to [{x,y}] for rendering
  _scanToPoints(scan, offsetX, offsetY, offsetYaw) {
    const points = [];
    const angleMin = scan.angle_min;
    const angleInc = scan.angle_increment;
    const ranges = scan.ranges;
    const rMin = scan.range_min || 0.05;
    const rMax = scan.range_max || 30;

    const cosY = Math.cos(offsetYaw);
    const sinY = Math.sin(offsetYaw);
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (r < rMin || r > rMax || !isFinite(r)) continue;
      const angle = angleMin + i * angleInc;
      const lx = r * Math.cos(angle);
      const ly = r * Math.sin(angle);
      points.push({ x: cosY * lx - sinY * ly + offsetX, y: sinY * lx + cosY * ly + offsetY });
    }
    return points;
  },

  // ── UI Updates ──

  _updateMeters(pitchMm, yawDeg) {
    const pitchBar = document.getElementById('lidar-meter-pitch');
    const yawBar = document.getElementById('lidar-meter-yaw');
    const pitchVal = document.getElementById('lidar-val-pitch');
    const yawVal = document.getElementById('lidar-val-yaw');

    const pitchPct = Math.min(Math.abs(pitchMm) / 15, 1) * 50;
    pitchBar.style.width = pitchPct + '%';
    pitchBar.style.left = pitchMm >= 0 ? '50%' : (50 - pitchPct) + '%';
    pitchBar.style.background = Math.abs(pitchMm) < this._thresholds.pitchPass ? '#4caf50' :
                                 Math.abs(pitchMm) < this._thresholds.pitchWarn ? '#ff9800' : '#f44336';
    pitchVal.textContent = (pitchMm >= 0 ? '+' : '') + pitchMm.toFixed(1) + ' mm';
    pitchVal.style.color = pitchBar.style.background;

    const yawPct = Math.min(Math.abs(yawDeg) / 3, 1) * 50;
    yawBar.style.width = yawPct + '%';
    yawBar.style.left = yawDeg >= 0 ? '50%' : (50 - yawPct) + '%';
    yawBar.style.background = Math.abs(yawDeg) < this._thresholds.yawPass ? '#4caf50' :
                               Math.abs(yawDeg) < this._thresholds.yawWarn ? '#ff9800' : '#f44336';
    yawVal.textContent = (yawDeg >= 0 ? '+' : '') + yawDeg.toFixed(2) + ' °';
    yawVal.style.color = yawBar.style.background;
  },

  _updateVerdict(pitchMm, yawDeg) {
    const el = document.getElementById('lidar-align-verdict');
    const ap = Math.abs(pitchMm), ay = Math.abs(yawDeg);

    if (ap < this._thresholds.pitchPass && ay < this._thresholds.yawPass) {
      el.textContent = 'PASS'; el.className = 'lidar-align-verdict pass';
    } else if (ap < this._thresholds.pitchWarn && ay < this._thresholds.yawWarn) {
      el.textContent = 'WARN'; el.className = 'lidar-align-verdict warn';
    } else {
      el.textContent = 'FAIL'; el.className = 'lidar-align-verdict fail';
    }
  },

  // ── Canvas Rendering ──

  _render() {
    const canvas = document.getElementById('lidar-align-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const scale = this._baseScale * this._zoom;
    const cx = w / 2 + this._panX;
    const cy = h / 2 + this._panY;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // Grid with labels
    this._drawGrid(ctx, w, h, cx, cy, scale);

    if (!this._scan1 && !this._scan2) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Start Scan to begin...', w / 2, h / 2);
      return;
    }

    // Robot outline + LiDAR positions
    this._drawRobotOutline(ctx, cx, cy, scale);

    const ptSize = Math.max(1.5, 2 * this._zoom);

    // scan_1 points (red)
    if (this._scan1) {
      const pts = this._scanToPoints(this._scan1, this._config.frontX, this._config.frontY || 0, this._config.frontYaw);
      this._drawPoints(ctx, pts, cx, cy, scale, 'rgba(255,80,80,0.6)', ptSize);
    }

    // scan_2 points (blue)
    if (this._scan2) {
      const pts = this._scanToPoints(this._scan2, this._config.rearX, this._config.rearY || 0, this._config.rearYaw);
      this._drawPoints(ctx, pts, cx, cy, scale, 'rgba(80,140,255,0.6)', ptSize);
    }

    // Overlap highlighting + diff visualization
    if (this._lastResult) {
      this._drawOverlapDiffs(ctx, cx, cy, scale);
    }

    // HUD
    this._drawHUD(ctx, w, h, scale);
  },

  _drawGrid(ctx, w, h, cx, cy, scale) {
    let gridM = 1;
    const gridPx = gridM * scale;
    if (gridPx < 30) gridM = 5;
    else if (gridPx < 50) gridM = 2;
    else if (gridPx > 400) gridM = 0.2;
    else if (gridPx > 200) gridM = 0.5;

    const step = gridM * scale;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    const startX = ((cx % step) + step) % step;
    for (let x = startX; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    const startY = ((cy % step) + step) % step;
    for (let y = startY; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();

    // Labels
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    for (let x = startX; x < w; x += step) {
      const m = (x - cx) / scale;
      if (Math.abs(m) < 0.01) continue;
      ctx.fillText(m.toFixed(gridM < 1 ? 1 : 0) + 'm', x, cy + 12);
    }
    ctx.textAlign = 'right';
    for (let y = startY; y < h; y += step) {
      const m = -(y - cy) / scale;
      if (Math.abs(m) < 0.01) continue;
      ctx.fillText(m.toFixed(gridM < 1 ? 1 : 0) + 'm', cx - 4, y + 3);
    }

    // Axis labels
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'left';
    ctx.fillText('Front →', w - 55, cy - 5);
    ctx.textAlign = 'center';
    ctx.fillText('← Left', cx, 12);
  },

  _drawRobotOutline(ctx, cx, cy, scale) {
    const fp = (typeof RosManager !== 'undefined' && RosManager._footprintPoints) || [
      { x: 0.45, y: 0.35 }, { x: -0.45, y: 0.35 },
      { x: -0.45, y: -0.35 }, { x: 0.45, y: -0.35 }
    ];
    const cfg = this._config;
    const l1x = cfg.frontX, l1y = cfg.frontY || 0;
    const l2x = cfg.rearX, l2y = cfg.rearY || 0;

    // ── Footprint polygon ──
    ctx.beginPath();
    ctx.moveTo(cx + fp[0].x * scale, cy - fp[0].y * scale);
    for (let i = 1; i < fp.length; i++) ctx.lineTo(cx + fp[i].x * scale, cy - fp[i].y * scale);
    ctx.closePath();
    ctx.fillStyle = 'rgba(100,100,120,0.2)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── Footprint dimensions ──
    const fpMaxX = Math.max(...fp.map(p => p.x));
    const fpMinX = Math.min(...fp.map(p => p.x));
    const fpMaxY = Math.max(...fp.map(p => p.y));
    const fpMinY = Math.min(...fp.map(p => p.y));
    const fpLength = fpMaxX - fpMinX;
    const fpWidth = fpMaxY - fpMinY;

    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';

    // Width dimension (top)
    const dimY = cy - fpMaxY * scale - 12;
    this._drawDimLine(ctx, cx + fpMinX * scale, dimY, cx + fpMaxX * scale, dimY,
      (fpLength * 1000).toFixed(0) + 'mm', 'rgba(255,255,255,0.3)');

    // Height dimension (right)
    const dimX = cx + fpMaxX * scale + 12;
    this._drawDimLine(ctx, dimX, cy - fpMaxY * scale, dimX, cy - fpMinY * scale,
      (fpWidth * 1000).toFixed(0) + 'mm', 'rgba(255,255,255,0.3)', true);

    // ── Front edge highlight ──
    ctx.beginPath();
    ctx.moveTo(cx + fpMaxX * scale, cy - fpMaxY * scale);
    ctx.lineTo(cx + fpMaxX * scale, cy - fpMinY * scale);
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // "FRONT" label
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = '#00d4ff';
    ctx.textAlign = 'center';
    ctx.fillText('FRONT', cx + fpMaxX * scale + 22, cy);

    // ── base_link center ──
    // Crosshair
    const chSize = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - chSize, cy); ctx.lineTo(cx + chSize, cy);
    ctx.moveTo(cx, cy - chSize); ctx.lineTo(cx, cy + chSize);
    ctx.stroke();
    // Dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    // Label
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'left';
    ctx.fillText('base_link (0, 0)', cx + 10, cy + 14);

    // ── LiDAR 1 (Front) ──
    const l1sx = cx + l1x * scale, l1sy = cy - l1y * scale;
    // Scan fan
    ctx.beginPath();
    ctx.moveTo(l1sx, l1sy);
    const fanR = 15;
    ctx.arc(l1sx, l1sy, fanR, -(cfg.frontYaw + 2.3), -(cfg.frontYaw - 2.3));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,80,80,0.15)';
    ctx.fill();
    // Dot
    ctx.beginPath();
    ctx.arc(l1sx, l1sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff5555';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Label
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = '#ff5555';
    ctx.textAlign = 'center';
    ctx.fillText('L1 (scan_1)', l1sx, l1sy - 12);
    // Position text
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255,150,150,0.7)';
    ctx.fillText(`(${(l1x*1000).toFixed(0)}, ${(l1y*1000).toFixed(0)})mm`, l1sx, l1sy - 22);

    // ── LiDAR 2 (Rear) ──
    const l2sx = cx + l2x * scale, l2sy = cy - l2y * scale;
    // Scan fan
    ctx.beginPath();
    ctx.moveTo(l2sx, l2sy);
    ctx.arc(l2sx, l2sy, fanR, -(cfg.rearYaw + 2.3), -(cfg.rearYaw - 2.3));
    ctx.closePath();
    ctx.fillStyle = 'rgba(80,136,255,0.15)';
    ctx.fill();
    // Dot
    ctx.beginPath();
    ctx.arc(l2sx, l2sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#5588ff';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Label
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = '#5588ff';
    ctx.textAlign = 'center';
    ctx.fillText('L2 (scan_2)', l2sx, l2sy + 22);
    // Position text
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(150,170,255,0.7)';
    ctx.fillText(`(${(l2x*1000).toFixed(0)}, ${(l2y*1000).toFixed(0)})mm`, l2sx, l2sy + 32);

    // ── Distance lines: center → L1, center → L2 ──
    const l1Dist = Math.sqrt(l1x * l1x + l1y * l1y);
    const l2Dist = Math.sqrt(l2x * l2x + l2y * l2y);

    // Dashed line center → L1
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(255,100,100,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(l1sx, l1sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // Distance label
    const mid1x = (cx + l1sx) / 2, mid1y = (cy + l1sy) / 2;
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255,150,150,0.6)';
    ctx.textAlign = 'center';
    ctx.fillText((l1Dist * 1000).toFixed(0) + 'mm', mid1x, mid1y - 6);

    // Dashed line center → L2
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(100,150,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(l2sx, l2sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // Distance label
    const mid2x = (cx + l2sx) / 2, mid2y = (cy + l2sy) / 2;
    ctx.fillStyle = 'rgba(150,170,255,0.6)';
    ctx.fillText((l2Dist * 1000).toFixed(0) + 'mm', mid2x, mid2y + 12);
  },

  // Draw a dimension line with label
  _drawDimLine(ctx, x1, y1, x2, y2, label, color, vertical) {
    const tickSize = 4;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;

    // Main line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // End ticks
    if (vertical) {
      ctx.beginPath();
      ctx.moveTo(x1 - tickSize, y1); ctx.lineTo(x1 + tickSize, y1);
      ctx.moveTo(x2 - tickSize, y2); ctx.lineTo(x2 + tickSize, y2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x1, y1 - tickSize); ctx.lineTo(x1, y1 + tickSize);
      ctx.moveTo(x2, y2 - tickSize); ctx.lineTo(x2, y2 + tickSize);
      ctx.stroke();
    }

    // Label
    ctx.font = '8px monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    if (vertical) {
      ctx.save();
      ctx.translate((x1 + x2) / 2 + 10, (y1 + y2) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(label, (x1 + x2) / 2, (y1 + y2) / 2 - 4);
    }
  },

  _drawPoints(ctx, points, cx, cy, scale, color, size) {
    ctx.fillStyle = color;
    for (const p of points) {
      ctx.fillRect(cx + p.x * scale - size / 2, cy - p.y * scale - size / 2, size, size);
    }
  },

  _drawOverlapDiffs(ctx, cx, cy, scale) {
    const r = this._lastResult;
    if (!r || !r.diffs) return;

    const cfg = this._config;

    // For each overlap angle, draw a line from scan_1 point to scan_2 point
    // Color by diff magnitude: green(small) → yellow → red(large)
    for (const d of r.diffs) {
      const rad = d.angleDeg * Math.PI / 180;

      // scan_1 point at this angle
      const x1 = d.range1 * Math.cos(rad);
      const y1 = d.range1 * Math.sin(rad);
      // scan_2 point at this angle
      const x2 = d.range2 * Math.cos(rad);
      const y2 = d.range2 * Math.sin(rad);

      const absDiff = Math.abs(d.diff_mm);
      // Color: 0mm=green, 5mm=yellow, 10mm+=red
      let cr, cg;
      const t = Math.min(absDiff / 10, 1);
      if (t < 0.5) {
        cr = Math.round(t * 2 * 255);
        cg = 255;
      } else {
        cr = 255;
        cg = Math.round((1 - (t - 0.5) * 2) * 255);
      }

      // Draw connecting line (shows misalignment)
      const sx1 = cx + x1 * scale, sy1 = cy - y1 * scale;
      const sx2 = cx + x2 * scale, sy2 = cy - y2 * scale;

      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.strokeStyle = `rgba(${cr},${cg},0,0.5)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Overlap point (midpoint)
      ctx.fillStyle = `rgba(${cr},${cg},0,0.7)`;
      ctx.fillRect((sx1 + sx2) / 2 - 1, (sy1 + sy2) / 2 - 1, 3, 3);
    }

    // Summary text on canvas
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;

    const pitchColor = Math.abs(r.pitchMm) < this._thresholds.pitchPass ? '#4caf50' :
                        Math.abs(r.pitchMm) < this._thresholds.pitchWarn ? '#ff9800' : '#f44336';
    const yawColor = Math.abs(r.yawDeg) < this._thresholds.yawPass ? '#4caf50' :
                      Math.abs(r.yawDeg) < this._thresholds.yawWarn ? '#ff9800' : '#f44336';

    const y0 = 50;
    ctx.strokeText(`Overlap: ${r.overlapCount} pts`, 10, y0);
    ctx.fillText(`Overlap: ${r.overlapCount} pts`, 10, y0);
    ctx.strokeText(`Avg range: ${r.avgRange.toFixed(2)} m`, 10, y0 + 16);
    ctx.fillText(`Avg range: ${r.avgRange.toFixed(2)} m`, 10, y0 + 16);

    ctx.fillStyle = pitchColor;
    const pitchText = `Pitch: ${r.pitchMm >= 0 ? '+' : ''}${r.pitchMm.toFixed(1)} mm`;
    ctx.strokeText(pitchText, 10, y0 + 36);
    ctx.fillText(pitchText, 10, y0 + 36);

    ctx.fillStyle = yawColor;
    const yawText = `Yaw: ${r.yawDeg >= 0 ? '+' : ''}${r.yawDeg.toFixed(2)} °`;
    ctx.strokeText(yawText, 10, y0 + 52);
    ctx.fillText(yawText, 10, y0 + 52);
  },

  _drawHUD(ctx, w, h, scale) {
    ctx.save();
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';

    // Top-left: zoom
    ctx.textAlign = 'left';
    const modelLabel = this._robotModel ? `Model: ${this._robotModel}` : 'Model: default';
    ctx.fillText(`Zoom: ${Math.round(this._zoom * 100)}%  |  ${modelLabel}`, 8, 14);

    const s1 = this._scan1 ? this._scan1.ranges.filter(r => r > 0.05 && isFinite(r)).length : 0;
    const s2 = this._scan2 ? this._scan2.ranges.filter(r => r > 0.05 && isFinite(r)).length : 0;
    ctx.fillText(`scan_1: ${s1}  scan_2: ${s2}`, 8, 28);

    // Top-right: controls
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('Scroll: zoom  |  Drag: pan', w - 8, 14);

    // Samples count
    if (this._history.length > 0) {
      ctx.fillText(`Avg of ${this._history.length} samples`, w - 8, 28);
    }

    // Scale bar (bottom-left)
    const barM = scale > 200 ? 0.5 : scale > 80 ? 1 : scale > 30 ? 2 : 5;
    const barPx = barM * scale;
    const barY = h - 16;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(12, barY); ctx.lineTo(12 + barPx, barY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12, barY - 4); ctx.lineTo(12, barY + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12 + barPx, barY - 4); ctx.lineTo(12 + barPx, barY + 4); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(barM >= 1 ? barM + ' m' : (barM * 100) + ' cm', 12 + barPx / 2, barY - 6);

    ctx.restore();
  }
};

document.addEventListener('DOMContentLoaded', () => { LidarAlign.init(); });
