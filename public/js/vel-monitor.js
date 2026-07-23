// Velocity Monitor - Real-time cmd_vel vs feed_vel comparison graph (3-axis + analysis)
const VelMonitor = {
  _cmdVelData: [],   // [{time, lx, ly, az}]
  _feedVelData: [],  // [{time, lx, ly, az}]
  _maxPoints: 600,   // ~60s at 10Hz
  _windowMs: 30000,  // 30 second scroll window
  _renderTimer: null,
  _cmdVelSub: null,
  _feedVelSub: null,
  _active: false,
  _startTime: null,
  _elapsedTimer: null,

  // Feed velocity source config
  _feedSource: 'odom',
  _feedCustomTopic: '/feed_vel',

  _feedPresets: {
    odom: {
      suffix: '/odom',
      messageType: 'nav_msgs/Odometry',
      extract(msg) {
        const tw = msg.twist.twist;
        return { lx: tw.linear.x, ly: tw.linear.y, az: tw.angular.z };
      }
    },
    feed_vel: {
      suffix: '/feed_vel',
      messageType: 'geometry_msgs/Twist',
      extract(msg) {
        return { lx: msg.linear.x, ly: msg.linear.y, az: msg.angular.z };
      }
    },
    cmd_vel_out: {
      suffix: '/cmd_vel_out',
      messageType: 'geometry_msgs/Twist',
      extract(msg) {
        return { lx: msg.linear.x, ly: msg.linear.y, az: msg.angular.z };
      }
    }
  },

  // 3-axis config
  _axes: [
    { key: 'lx', label: 'Linear X', unit: 'm/s', cmdColor: '#00e5ff', feedColor: '#ff9800' },
    { key: 'ly', label: 'Linear Y', unit: 'm/s', cmdColor: '#76ff03', feedColor: '#e040fb' },
    { key: 'az', label: 'Angular Z', unit: 'rad/s', cmdColor: '#ffea00', feedColor: '#ff5252' }
  ],

  init() {
    const toggle = document.getElementById('btn-vel-monitor-toggle');
    if (toggle) toggle.addEventListener('click', () => this._toggle());

    const feedSrcSel = document.getElementById('vel-monitor-feed-source');
    if (feedSrcSel) {
      feedSrcSel.addEventListener('change', () => {
        this._feedSource = feedSrcSel.value;
        const customRow = document.getElementById('vel-monitor-custom-row');
        if (customRow) customRow.style.display = this._feedSource === 'custom' ? '' : 'none';
        if (this._active) { this._unsubscribe(); this._subscribe(); }
      });
    }

    const customInput = document.getElementById('vel-monitor-custom-topic');
    if (customInput) {
      customInput.addEventListener('change', () => {
        this._feedCustomTopic = customInput.value || '/feed_vel';
        if (this._active && this._feedSource === 'custom') {
          this._unsubscribe(); this._subscribe();
        }
      });
    }

    // CSV export button
    const csvBtn = document.getElementById('btn-vel-monitor-csv');
    if (csvBtn) csvBtn.addEventListener('click', () => this._exportCSV());
  },

  _toggle() {
    const graphArea = document.getElementById('vel-monitor-graph-area');
    const btn = document.getElementById('btn-vel-monitor-toggle');
    if (!graphArea) return;

    if (this._active) {
      this._stop();
      if (btn) { btn.textContent = 'Start'; btn.classList.remove('btn-danger'); btn.classList.add('btn-primary'); }
    } else {
      // Clear previous report
      const reportEl = document.getElementById('vel-monitor-report');
      if (reportEl) reportEl.style.display = 'none';
      this._start();
      graphArea.style.display = '';
      if (btn) { btn.textContent = 'Stop'; btn.classList.remove('btn-primary'); btn.classList.add('btn-danger'); }
    }
  },

  _start() {
    this._active = true;
    this._cmdVelData = [];
    this._feedVelData = [];
    this._startTime = Date.now();
    this._subscribe();
    this._renderTimer = setInterval(() => this._renderAll(), 100);
    this._elapsedTimer = setInterval(() => this._updateElapsed(), 200);
    this._updateElapsed();
  },

  _stop() {
    this._active = false;
    this._unsubscribe();
    if (this._renderTimer) { clearInterval(this._renderTimer); this._renderTimer = null; }
    if (this._elapsedTimer) { clearInterval(this._elapsedTimer); this._elapsedTimer = null; }
    // Generate analysis report
    this._showReport();
  },

  _updateElapsed() {
    const el = document.getElementById('vel-monitor-elapsed');
    if (!el || !this._startTime) return;
    const sec = ((Date.now() - this._startTime) / 1000);
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    el.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
  },

  _getFeedConfig() {
    if (this._feedSource === 'custom') {
      return {
        suffix: this._feedCustomTopic,
        messageType: 'geometry_msgs/Twist',
        extract(msg) {
          if (msg.twist && msg.twist.twist) {
            const tw = msg.twist.twist;
            return { lx: tw.linear.x, ly: tw.linear.y, az: tw.angular.z };
          }
          return { lx: msg.linear.x, ly: msg.linear.y, az: msg.angular.z };
        }
      };
    }
    return this._feedPresets[this._feedSource] || this._feedPresets.odom;
  },

  _subscribe() {
    const slotIndex = App.activeSlotIndex;
    const ros = RosManager.getRos(slotIndex);
    if (!ros) return;

    const rid = RosManager.getRobotId(slotIndex);
    const cmdTopicName = rid ? `/${rid}/cmd_vel` : '/cmd_vel';

    this._cmdVelSub = new ROSLIB.Topic({
      ros, name: cmdTopicName, messageType: 'geometry_msgs/Twist', throttle_rate: 50
    });
    this._cmdVelSub.subscribe((msg) => {
      this._cmdVelData.push({ time: Date.now(), lx: msg.linear.x, ly: msg.linear.y, az: msg.angular.z });
      if (this._cmdVelData.length > this._maxPoints) this._cmdVelData.shift();
    });

    const feedCfg = this._getFeedConfig();
    const feedTopicName = rid ? `/${rid}${feedCfg.suffix}` : feedCfg.suffix;

    this._feedVelSub = new ROSLIB.Topic({
      ros, name: feedTopicName, messageType: feedCfg.messageType, throttle_rate: 50
    });
    this._feedVelSub.subscribe((msg) => {
      const vel = feedCfg.extract(msg);
      this._feedVelData.push({ time: Date.now(), lx: vel.lx, ly: vel.ly, az: vel.az });
      if (this._feedVelData.length > this._maxPoints) this._feedVelData.shift();
    });

    const statusEl = document.getElementById('vel-monitor-status');
    if (statusEl) statusEl.textContent = `cmd: ${cmdTopicName}  |  feed: ${feedTopicName}`;
  },

  _unsubscribe() {
    if (this._cmdVelSub) { this._cmdVelSub.unsubscribe(); this._cmdVelSub = null; }
    if (this._feedVelSub) { this._feedVelSub.unsubscribe(); this._feedVelSub = null; }
  },

  // ── Render all 3 axes ──
  _renderAll() {
    for (let i = 0; i < this._axes.length; i++) {
      const canvas = document.getElementById(`vel-canvas-${i}`);
      if (canvas) this._renderAxis(canvas, this._axes[i]);
    }
  },

  _renderAxis(canvas, axis) {
    const ctx = canvas.getContext('2d');
    const w = canvas.parentElement.clientWidth || 800;
    if (canvas.width !== w) canvas.width = w;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const now = Date.now();
    const startTime = now - this._windowMs;
    const cmdPts = this._getPoints(this._cmdVelData, axis.key, startTime, now, w);
    const feedPts = this._getPoints(this._feedVelData, axis.key, startTime, now, w);

    // Y range
    let minV = 0, maxV = 0;
    for (const p of cmdPts) { if (p.v < minV) minV = p.v; if (p.v > maxV) maxV = p.v; }
    for (const p of feedPts) { if (p.v < minV) minV = p.v; if (p.v > maxV) maxV = p.v; }
    if (minV === 0 && maxV === 0) { minV = -0.5; maxV = 0.5; }
    else { const r = maxV - minV || 0.2; minV -= r * 0.15; maxV += r * 0.15; }

    const toY = (v) => h - ((v - minV) / (maxV - minV)) * h;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px sans-serif';
    for (let i = 0; i <= 4; i++) {
      const val = minV + (i / 4) * (maxV - minV);
      const y = toY(val);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(val.toFixed(2), 2, y - 2);
    }

    // Zero line
    if (minV < 0 && maxV > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.setLineDash([4, 4]);
      const zy = toY(0);
      ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(w, zy); ctx.stroke();
      ctx.restore();
    }

    // Time ticks
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '8px sans-serif';
    for (let s = 0; s <= 30; s += 10) {
      const x = (s / 30) * w;
      ctx.fillRect(x, h - 8, 1, 8);
      ctx.fillText(`-${30 - s}s`, x + 2, h - 1);
    }

    // Draw lines
    this._drawLine(ctx, cmdPts, toY, axis.cmdColor);
    this._drawLine(ctx, feedPts, toY, axis.feedColor);

    // Axis label + legend
    const cmdLast = this._cmdVelData.length > 0 ? this._cmdVelData[this._cmdVelData.length - 1][axis.key] : null;
    const feedLast = this._feedVelData.length > 0 ? this._feedVelData[this._feedVelData.length - 1][axis.key] : null;

    // Title
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`${axis.label} (${axis.unit})`, 4, 12);

    // Legend right side
    ctx.font = 'bold 10px monospace';
    const lx = w - 260;
    ctx.fillStyle = axis.cmdColor;
    ctx.fillRect(lx, 4, 10, 3);
    ctx.fillText(`cmd: ${cmdLast !== null ? cmdLast.toFixed(3) : '  --  '}`, lx + 14, 10);

    ctx.fillStyle = axis.feedColor;
    ctx.fillRect(lx + 120, 4, 10, 3);
    ctx.fillText(`feed: ${feedLast !== null ? feedLast.toFixed(3) : '  --  '}`, lx + 134, 10);

    // Error
    if (cmdLast !== null && feedLast !== null) {
      const err = Math.abs(cmdLast - feedLast);
      ctx.fillStyle = err > 0.05 ? '#ef4444' : '#22c55e';
      ctx.font = '9px monospace';
      ctx.fillText(`err:${err.toFixed(3)}`, w - 60, h - 2);
    }

    // No data
    if (cmdPts.length === 0 && feedPts.length === 0) {
      ctx.fillStyle = '#555';
      ctx.font = '10px sans-serif';
      ctx.fillText('Waiting...', w / 2 - 25, h / 2 + 3);
    }
  },

  _getPoints(data, key, startTime, now, w) {
    const pts = [];
    for (const d of data) {
      if (d.time < startTime) continue;
      pts.push({ x: ((d.time - startTime) / this._windowMs) * w, v: d[key] });
    }
    return pts;
  },

  _drawLine(ctx, pts, toY, color) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    let first = true;
    for (const pt of pts) {
      const y = toY(pt.v);
      if (first) { ctx.moveTo(pt.x, y); first = false; }
      else ctx.lineTo(pt.x, y);
    }
    ctx.stroke();

    // Fill
    const lastPt = pts[pts.length - 1];
    const zeroY = toY(0);
    ctx.lineTo(lastPt.x, zeroY);
    ctx.lineTo(pts[0].x, zeroY);
    ctx.closePath();
    ctx.fillStyle = color + '12';
    ctx.fill();
  },

  // ── Analysis Report ──
  _showReport() {
    const el = document.getElementById('vel-monitor-report');
    if (!el) return;

    const duration = this._startTime ? ((Date.now() - this._startTime) / 1000) : 0;
    const cmdN = this._cmdVelData.length;
    const feedN = this._feedVelData.length;

    if (cmdN === 0 && feedN === 0) {
      el.innerHTML = '<div class="vel-report-empty">No data collected.</div>';
      el.style.display = '';
      return;
    }

    let html = '<div class="vel-report-header">';
    html += `<span class="vel-report-title">Analysis Report</span>`;
    const m = Math.floor(duration / 60);
    const s = (duration % 60).toFixed(1);
    html += `<span class="vel-report-meta">Duration: ${m > 0 ? m + 'm ' : ''}${s}s  |  cmd samples: ${cmdN}  |  feed samples: ${feedN}</span>`;
    html += '</div>';

    html += '<table class="vel-report-table"><thead><tr>';
    html += '<th>Axis</th><th colspan="3">cmd_vel (min / avg / max)</th><th colspan="3">feed (min / avg / max)</th><th>RMSE</th><th>MAE</th><th>Max Err</th><th>Delay (ms)</th>';
    html += '</tr></thead><tbody>';

    for (const axis of this._axes) {
      const cmdStats = this._calcStats(this._cmdVelData, axis.key);
      const feedStats = this._calcStats(this._feedVelData, axis.key);
      const errStats = this._calcErrorStats(this._cmdVelData, this._feedVelData, axis.key);
      const delay = this._estimateDelay(this._cmdVelData, this._feedVelData, axis.key);

      html += '<tr>';
      html += `<td class="vel-report-axis">${axis.label} (${axis.unit})</td>`;
      html += `<td>${cmdStats.min.toFixed(3)}</td><td>${cmdStats.avg.toFixed(3)}</td><td>${cmdStats.max.toFixed(3)}</td>`;
      html += `<td>${feedStats.min.toFixed(3)}</td><td>${feedStats.avg.toFixed(3)}</td><td>${feedStats.max.toFixed(3)}</td>`;
      html += `<td class="${errStats.rmse > 0.05 ? 'vel-err-bad' : 'vel-err-good'}">${errStats.rmse.toFixed(4)}</td>`;
      html += `<td>${errStats.mae.toFixed(4)}</td>`;
      html += `<td class="${errStats.maxErr > 0.1 ? 'vel-err-bad' : ''}">${errStats.maxErr.toFixed(4)}</td>`;
      html += `<td>${delay !== null ? delay.toFixed(0) : '--'}</td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';

    // Overall verdict
    const overallRmse = this._axes.map(a => this._calcErrorStats(this._cmdVelData, this._feedVelData, a.key).rmse);
    const maxRmse = Math.max(...overallRmse);
    let verdict, verdictClass;
    if (maxRmse < 0.02) { verdict = 'EXCELLENT - Velocity tracking is very accurate'; verdictClass = 'vel-verdict-good'; }
    else if (maxRmse < 0.05) { verdict = 'GOOD - Minor tracking deviation'; verdictClass = 'vel-verdict-ok'; }
    else if (maxRmse < 0.1) { verdict = 'WARNING - Noticeable tracking error'; verdictClass = 'vel-verdict-warn'; }
    else { verdict = 'POOR - Large tracking error, check motor/controller'; verdictClass = 'vel-verdict-bad'; }

    html += `<div class="vel-verdict ${verdictClass}">${verdict}</div>`;

    el.innerHTML = html;
    el.style.display = '';
  },

  _calcStats(data, key) {
    if (data.length === 0) return { min: 0, max: 0, avg: 0 };
    let min = Infinity, max = -Infinity, sum = 0;
    for (const d of data) {
      const v = d[key];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return { min, max, avg: sum / data.length };
  },

  _calcErrorStats(cmdData, feedData, key) {
    // Align by nearest timestamp
    if (cmdData.length === 0 || feedData.length === 0) return { rmse: 0, mae: 0, maxErr: 0 };

    let sumSq = 0, sumAbs = 0, maxErr = 0, n = 0;
    let fi = 0;
    for (const cd of cmdData) {
      // Find closest feed sample
      while (fi < feedData.length - 1 && Math.abs(feedData[fi + 1].time - cd.time) < Math.abs(feedData[fi].time - cd.time)) fi++;
      if (Math.abs(feedData[fi].time - cd.time) > 500) continue; // skip if >500ms apart
      const err = Math.abs(cd[key] - feedData[fi][key]);
      sumSq += err * err;
      sumAbs += err;
      if (err > maxErr) maxErr = err;
      n++;
    }
    if (n === 0) return { rmse: 0, mae: 0, maxErr: 0 };
    return { rmse: Math.sqrt(sumSq / n), mae: sumAbs / n, maxErr };
  },

  _estimateDelay(cmdData, feedData, key) {
    // Cross-correlation based delay estimation
    if (cmdData.length < 10 || feedData.length < 10) return null;

    // Resample both to uniform 50ms intervals
    const startT = Math.max(cmdData[0].time, feedData[0].time);
    const endT = Math.min(cmdData[cmdData.length - 1].time, feedData[feedData.length - 1].time);
    if (endT - startT < 1000) return null;

    const dt = 50;
    const cmdR = this._resample(cmdData, key, startT, endT, dt);
    const feedR = this._resample(feedData, key, startT, endT, dt);
    if (cmdR.length < 10) return null;

    // Cross-correlate with max lag of 500ms (10 samples)
    const maxLag = 10;
    let bestLag = 0, bestCorr = -Infinity;
    for (let lag = 0; lag <= maxLag; lag++) {
      let corr = 0;
      const n = cmdR.length - lag;
      if (n < 5) break;
      for (let i = 0; i < n; i++) {
        corr += cmdR[i] * feedR[i + lag];
      }
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    return bestLag * dt;
  },

  _resample(data, key, startT, endT, dt) {
    const result = [];
    let di = 0;
    for (let t = startT; t <= endT; t += dt) {
      while (di < data.length - 1 && data[di + 1].time <= t) di++;
      result.push(data[di][key]);
    }
    return result;
  },

  _exportCSV() {
    if (this._cmdVelData.length === 0 && this._feedVelData.length === 0) return;

    let csv = 'timestamp_ms,source,linear_x,linear_y,angular_z\n';
    for (const d of this._cmdVelData) {
      csv += `${d.time},cmd_vel,${d.lx.toFixed(6)},${d.ly.toFixed(6)},${d.az.toFixed(6)}\n`;
    }
    for (const d of this._feedVelData) {
      csv += `${d.time},feed_vel,${d.lx.toFixed(6)},${d.ly.toFixed(6)},${d.az.toFixed(6)}\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `vel_monitor_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  onSlotChange() {
    if (!this._active) return;
    this._unsubscribe();
    this._cmdVelData = [];
    this._feedVelData = [];
    this._subscribe();
  },

  onDisconnect() {
    if (!this._active) return;
    this._unsubscribe();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  VelMonitor.init();
});
