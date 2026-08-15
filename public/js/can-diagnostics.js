// ==================== CAN Motor Diagnostics ====================
const CanDiag = {
  _nodes: [],
  _selectedNodeId: null,
  _logEntries: [],
  _paramChangedNodes: [],   // 파라미터 변경된 노드 목록
  _lastScanTime: null,
  _canStatus: null,

  PROTECTED_NODES: [5, 6, 7],  // 조향(5,6), 리프트(7) - 파라미터 변경/구동 테스트 금지

  NODE_NAMES: {
    1: 'FL Drive', 2: 'FR Drive', 3: 'RL Drive', 4: 'RR Drive',
    5: 'F Steer', 6: 'R Steer', 7: 'Lift'
  },

  // ==================== 초기화 ====================

  initCanDiagTab() {
    const container = document.getElementById('tab-can-diag');
    if (!container) return;

    container.innerHTML = this._buildTabHTML();
    this._bindEvents();
    CanRobotView.render(
      document.getElementById('can-robot-view-container'),
      (nodeId) => this.showNodeDetail(nodeId)
    );
    this._log('CAN Motor Diagnostics \uD0ED \uCD08\uAE30\uD654 \uC644\uB8CC', 'ok');
  },

  _buildTabHTML() {
    return `
      <div class="can-power-banner" id="can-power-banner">
        \u26A0\uFE0F <span id="can-power-banner-text">\uD30C\uB77C\uBBF8\uD130\uAC00 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC804\uC6D0 \uC7AC\uD22C\uC785(OFF\u2192ON) \uD6C4 \uC801\uC6A9\uB429\uB2C8\uB2E4.</span>
        <button class="banner-close" onclick="CanDiag.dismissPowerBanner()">\u00D7</button>
      </div>
      <div class="can-diag-container">
        <!-- Left: Robot View -->
        <div class="can-diag-left">
          <div id="can-robot-view-container"></div>
          <div class="can-node-detail" id="can-node-detail">
            <h4>\uB178\uB4DC \uC0C1\uC138</h4>
            <div class="node-detail-grid" id="can-node-detail-grid">
              <span class="detail-label">\uC120\uD0DD\uB41C \uB178\uB4DC \uC5C6\uC74C</span>
            </div>
          </div>
        </div>

        <!-- Right: Status & Actions -->
        <div class="can-diag-right">
          <div class="can-summary-bar" id="can-summary-bar">
            <span class="summary-item offline">\u2B1C \uC2A4\uCE94 \uD544\uC694</span>
            <span class="summary-can-status">CAN: -- | -- | TX:-- RX:--</span>
            <span class="summary-time">\uCD5C\uC885 \uC2A4\uCE94: --</span>
          </div>

          <div class="can-table-wrap">
            <table class="can-node-table">
              <thead>
                <tr>
                  <th>ID</th><th>\uC774\uB984</th><th>\uC0C1\uD0DC</th><th>\uC5D0\uB7EC</th>
                  <th>STO</th><th>\uC804\uB958(A)</th><th>\uC704\uCE58</th>
                </tr>
              </thead>
              <tbody id="can-node-tbody">
                <tr><td colspan="7" style="text-align:center;color:var(--text-muted)">\uC2A4\uCE94\uC744 \uC2E4\uD589\uD558\uC138\uC694</td></tr>
              </tbody>
            </table>
          </div>

          <div class="can-actions">
            <div class="action-group">
              <h4>\uC9C4\uB2E8</h4>
              <button onclick="CanDiag.scan()">\uD83D\uDD0D \uC2A4\uCE94</button>
              <button onclick="CanDiag.readParams()">\uD83D\uDCCB \uD30C\uB77C\uBBF8\uD130</button>
              <button onclick="CanDiag.showCompareModal()">\u2696\uFE0F \uBE44\uAD50</button>
              <button onclick="CanDiag.checkDup()">\uD83D\uDD04 \uC911\uBCF5 \uD655\uC778</button>
            </div>
            <div class="action-group">
              <h4>\uC124\uC815</h4>
              <button onclick="CanDiag.showStoModal()">\uD83D\uDEE1\uFE0F STO</button>
              <button onclick="CanDiag.showChangeIdModal()">\uD83C\uDFF7\uFE0F ID \uBCC0\uACBD</button>
              <button onclick="CanDiag.faultReset()">\uD83D\uDD04 Fault Reset</button>
            </div>
            <div class="action-group">
              <h4>\uD14C\uC2A4\uD2B8</h4>
              <button onclick="CanDiag.showDriveTestModal()">\uD83C\uDFCE\uFE0F \uAD6C\uB3D9 \uD14C\uC2A4\uD2B8</button>
              <button onclick="CanDiag.checkBusOff()">\uD83D\uDD0C BUS-OFF \uD655\uC778</button>
              <button onclick="CanDiag.recoverBusOff()">\uD83D\uDD27 BUS-OFF \uBCF5\uAD6C</button>
            </div>
          </div>

          <div class="can-log-panel">
            <div class="log-header">
              <h4>\uC791\uC5C5 \uB85C\uADF8</h4>
              <button onclick="CanDiag.clearLog()">\uC9C0\uC6B0\uAE30</button>
            </div>
            <div class="can-log-content" id="can-log"></div>
          </div>
        </div>
      </div>

      <!-- Drive Test Modal -->
      <div class="can-modal-overlay" id="can-modal-drive-test">
        <div class="can-modal">
          <h3>\uD83C\uDFCE\uFE0F \uAD6C\uB3D9 \uD14C\uC2A4\uD2B8</h3>
          <div class="drive-test-form">
            <label>
              \uB178\uB4DC \uC120\uD0DD
              <select id="drive-test-node">
                <option value="">-- \uC120\uD0DD --</option>
                <option value="1">Node 1 (FL Drive)</option>
                <option value="2">Node 2 (FR Drive)</option>
                <option value="3">Node 3 (RL Drive)</option>
                <option value="4">Node 4 (RR Drive)</option>
              </select>
            </label>
            <label>
              \uC18D\uB3C4 (m/s): <span class="speed-display" id="drive-test-speed-display">0.10</span>
              <input type="range" id="drive-test-speed" min="0.05" max="0.5" step="0.05" value="0.1">
            </label>
            <label>
              \uC2DC\uAC04 (\uCD08)
              <input type="number" id="drive-test-duration" min="1" max="30" value="5">
            </label>
            <div class="safety-check">
              <input type="checkbox" id="drive-test-safety">
              <span>\uBC14\uD034\uAC00 \uB5B4 \uC0C1\uD0DC\uC778\uAC00\uC694? (\uD655\uC778 \uD544\uC218)</span>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" onclick="CanDiag.closeModal('can-modal-drive-test')">\uCDE8\uC18C</button>
            <button class="btn-danger" id="btn-drive-stop" onclick="CanDiag.driveStop()" style="display:none">\u23F9 \uC815\uC9C0</button>
            <button class="btn-primary" id="btn-drive-exec" onclick="CanDiag.driveTestExec()">\u25B6 \uC2E4\uD589</button>
          </div>
        </div>
      </div>

      <!-- Compare Modal -->
      <div class="can-modal-overlay" id="can-modal-compare">
        <div class="can-modal" style="min-width:600px">
          <h3>\u2696\uFE0F \uD30C\uB77C\uBBF8\uD130 \uBE44\uAD50</h3>
          <div style="display:flex;gap:12px;margin-bottom:12px">
            <label style="flex:1">
              \uB85C\uBD07 1 IP
              <input type="text" id="compare-ip1" placeholder="192.168.1.x" style="width:100%;padding:6px;background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary)">
            </label>
            <label style="flex:1">
              \uB85C\uBD07 2 IP
              <input type="text" id="compare-ip2" placeholder="192.168.1.x" style="width:100%;padding:6px;background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary)">
            </label>
          </div>
          <button class="btn-primary" onclick="CanDiag.compareExec()" style="margin-bottom:12px">\uBE44\uAD50 \uC2E4\uD589</button>
          <div id="compare-results"></div>
          <div class="modal-actions">
            <button class="btn-secondary" onclick="CanDiag.closeModal('can-modal-compare')">\uB2EB\uAE30</button>
          </div>
        </div>
      </div>

      <!-- STO Modal -->
      <div class="can-modal-overlay" id="can-modal-sto">
        <div class="can-modal">
          <h3>\uD83D\uDEE1\uFE0F STO \uC124\uC815</h3>
          <div id="sto-node-list" style="margin-bottom:12px"></div>
          <div style="display:flex;gap:12px;margin-bottom:12px">
            <button class="btn-primary" onclick="CanDiag.setStoExec(true)">STO ON (Safe)</button>
            <button class="btn-danger" onclick="CanDiag.setStoExec(false)">STO OFF (Enable)</button>
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" onclick="CanDiag.closeModal('can-modal-sto')">\uB2EB\uAE30</button>
          </div>
        </div>
      </div>

      <!-- Change ID Modal -->
      <div class="can-modal-overlay" id="can-modal-change-id">
        <div class="can-modal">
          <h3>\uD83C\uDFF7\uFE0F Node ID \uBCC0\uACBD</h3>
          <label style="display:block;margin-bottom:8px">
            \uD604\uC7AC Node ID
            <select id="change-id-old" style="width:100%;padding:6px;background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary)">
              <option value="">-- \uC120\uD0DD --</option>
            </select>
          </label>
          <label style="display:block;margin-bottom:12px">
            \uC0C8 Node ID
            <input type="number" id="change-id-new" min="1" max="127" style="width:100%;padding:6px;background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary)">
          </label>
          <div class="modal-actions">
            <button class="btn-secondary" onclick="CanDiag.closeModal('can-modal-change-id')">\uCDE8\uC18C</button>
            <button class="btn-primary" onclick="CanDiag.changeIdExec()">\uBCC0\uACBD</button>
          </div>
        </div>
      </div>

      <!-- Params Modal -->
      <div class="can-modal-overlay" id="can-modal-params">
        <div class="can-modal" style="min-width:500px">
          <h3>\uD83D\uDCCB \uD30C\uB77C\uBBF8\uD130</h3>
          <div id="params-content">\uB178\uB4DC\uB97C \uC120\uD0DD\uD55C \uD6C4 \uD30C\uB77C\uBBF8\uD130 \uBC84\uD2BC\uC744 \uB204\uB974\uC138\uC694.</div>
          <div class="modal-actions">
            <button class="btn-secondary" onclick="CanDiag.closeModal('can-modal-params')">\uB2EB\uAE30</button>
          </div>
        </div>
      </div>
    `;
  },

  _bindEvents() {
    // Drive test speed slider
    const speedSlider = document.getElementById('drive-test-speed');
    const speedDisplay = document.getElementById('drive-test-speed-display');
    if (speedSlider && speedDisplay) {
      speedSlider.addEventListener('input', () => {
        speedDisplay.textContent = parseFloat(speedSlider.value).toFixed(2);
      });
    }
  },

  // ==================== 로봇 IP 헬퍼 ====================

  _getRobotIp() {
    const activeRobot = typeof App.getActiveRobot === 'function' ? App.getActiveRobot() : null;
    if (activeRobot && activeRobot.ip) return activeRobot.ip;
    if (App.currentRobot && App.currentRobot.ip) return App.currentRobot.ip;
    const sel = document.getElementById('active-robot-select');
    if (sel && sel.value) {
      const robot = App.robots.find(r => r.name === sel.value || r.ip === sel.value);
      if (robot) return robot.ip;
    }
    return null;
  },

  // ==================== API 호출 ====================

  async _apiCall(endpoint, method, body, robotIp) {
    const ip = robotIp || this._getRobotIp();
    if (!ip) {
      this._log('\uB85C\uBD07\uC774 \uC120\uD0DD\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.', 'error');
      App.toast('\uB85C\uBD07\uC744 \uBA3C\uC800 \uC120\uD0DD\uD558\uC138\uC694.', 'error');
      return null;
    }

    const url = `/api/can/${endpoint}`;
    const options = {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify({ ...body, robotIp: ip });
    else if (method === 'POST') options.body = JSON.stringify({ robotIp: ip });

    try {
      const resp = await fetchWithTimeout(url, options, 30000);
      const data = await resp.json();
      if (!resp.ok) {
        this._log(`API \uC624\uB958: ${endpoint} - ${data.error || resp.statusText}`, 'error');
        return null;
      }
      return data;
    } catch (err) {
      this._log(`API \uD1B5\uC2E0 \uC2E4\uD328: ${endpoint} - ${err.message}`, 'error');
      return null;
    }
  },

  // ==================== 스캔 ====================

  async scan() {
    const ip = this._getRobotIp();
    if (!ip) {
      App.showToast('\uB85C\uBD07\uC744 \uBA3C\uC800 \uC120\uD0DD\uD558\uC138\uC694.', 'error');
      return;
    }

    this._log(`\uC2A4\uCE94 \uC2DC\uC791: ${ip}`, 'ok');
    const data = await this.scanAllNodes(ip);
    if (data) {
      this._log(`\uC2A4\uCE94 \uC644\uB8CC: ${data.nodes ? data.nodes.length : 0}\uAC1C \uB178\uB4DC \uBC1C\uACAC`, 'ok');
    }
  },

  async scanAllNodes(robotIp) {
    const data = await this._apiCall('scan', 'POST', null, robotIp);
    if (!data) return null;

    this._nodes = data.nodes || [];
    this._canStatus = data.canStatus || null;
    this._lastScanTime = new Date();

    this.updateRobotView(this._nodes);
    this.updateStatusTable(this._nodes);
    this.updateSummaryBar(this._nodes);

    return data;
  },

  // ==================== UI 업데이트 ====================

  updateRobotView(nodes) {
    CanRobotView.updateNodes(nodes);
  },

  updateStatusTable(nodes) {
    const tbody = document.getElementById('can-node-tbody');
    if (!tbody) return;

    if (!nodes || nodes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">\uBC1C\uACAC\uB41C \uB178\uB4DC \uC5C6\uC74C</td></tr>';
      return;
    }

    tbody.innerHTML = nodes.map(n => {
      const rowClass = n.status === 'fault' || n.status === 'error' ? 'row-fault' :
                       !n.status || n.status === 'offline' ? 'row-offline' : '';
      const statusClass = this._statusBadgeClass(n.status);
      const name = this.NODE_NAMES[n.id] || `Node ${n.id}`;
      return `<tr class="${rowClass}" onclick="CanDiag.showNodeDetail(${n.id})" style="cursor:pointer">
        <td>${n.id}</td>
        <td>${_escapeHtml(n.name || name)}</td>
        <td><span class="status-badge ${statusClass}">${_escapeHtml(n.status || 'offline')}</span></td>
        <td>${_escapeHtml(n.error || '-')}</td>
        <td>${n.sto !== undefined ? (n.sto ? 'ON' : 'OFF') : '-'}</td>
        <td>${n.current !== undefined ? n.current.toFixed(2) : '-'}</td>
        <td>${n.position !== undefined ? n.position : '-'}</td>
      </tr>`;
    }).join('');
  },

  updateSummaryBar(nodes) {
    const bar = document.getElementById('can-summary-bar');
    if (!bar) return;

    if (!nodes || nodes.length === 0) {
      bar.innerHTML = `
        <span class="summary-item offline">\u2B1C \uC2A4\uCE94 \uD544\uC694</span>
        <span class="summary-can-status">CAN: -- | -- | TX:-- RX:--</span>
        <span class="summary-time">\uCD5C\uC885 \uC2A4\uCE94: --</span>
      `;
      return;
    }

    const ok = nodes.filter(n => n.status === 'enable' || n.status === 'enabled' || n.status === 'operational').length;
    const fault = nodes.filter(n => n.status === 'fault' || n.status === 'error').length;
    const offline = 7 - nodes.length;

    const canInfo = this._canStatus ?
      `CAN: ${this._canStatus.baudrate || '250K'} | ${this._canStatus.state || '--'} | TX:${this._canStatus.tx || 0} RX:${this._canStatus.rx || 0}` :
      'CAN: -- | -- | TX:-- RX:--';

    const timeStr = this._lastScanTime ?
      `\uCD5C\uC885 \uC2A4\uCE94: ${this._lastScanTime.toLocaleTimeString('ko-KR')}` :
      '\uCD5C\uC885 \uC2A4\uCE94: --';

    bar.innerHTML = `
      <span class="summary-item ok">\u2705 ${ok} \uC815\uC0C1</span>
      ${fault > 0 ? `<span class="summary-item fault">\u274C ${fault} \uC5D0\uB7EC</span>` : ''}
      ${offline > 0 ? `<span class="summary-item offline">\u2B1C ${offline} \uBBF8\uC5F0\uACB0</span>` : ''}
      <span class="summary-can-status">${_escapeHtml(canInfo)}</span>
      <span class="summary-time">${_escapeHtml(timeStr)}</span>
    `;
  },

  // ==================== 노드 상세 ====================

  showNodeDetail(nodeId) {
    this._selectedNodeId = nodeId;
    const grid = document.getElementById('can-node-detail-grid');
    if (!grid) return;

    const node = this._nodes.find(n => n.id === nodeId);
    const name = this.NODE_NAMES[nodeId] || `Node ${nodeId}`;
    const isProtected = this.PROTECTED_NODES.includes(nodeId);

    if (!node) {
      grid.innerHTML = `
        <span class="detail-label">Node</span><span class="detail-value">${nodeId} (${_escapeHtml(name)})</span>
        <span class="detail-label">\uC0C1\uD0DC</span><span class="detail-value">OFFLINE</span>
        ${isProtected ? '<span class="detail-label">\uBCF4\uD638</span><span class="detail-value">\uD30C\uB77C\uBBF8\uD130 \uBCC0\uACBD/\uAD6C\uB3D9\uD14C\uC2A4\uD2B8 \uBD88\uAC00</span>' : ''}
      `;
      return;
    }

    grid.innerHTML = `
      <span class="detail-label">Node</span><span class="detail-value">${node.id} (${_escapeHtml(node.name || name)})</span>
      <span class="detail-label">\uC0C1\uD0DC</span><span class="detail-value">${_escapeHtml(node.status || '--')}</span>
      <span class="detail-label">\uC5D0\uB7EC</span><span class="detail-value">${_escapeHtml(node.error || '\uC5C6\uC74C')}</span>
      <span class="detail-label">STO</span><span class="detail-value">${node.sto !== undefined ? (node.sto ? 'ON' : 'OFF') : '--'}</span>
      <span class="detail-label">\uC804\uB958</span><span class="detail-value">${node.current !== undefined ? node.current.toFixed(2) + ' A' : '--'}</span>
      <span class="detail-label">\uC704\uCE58</span><span class="detail-value">${node.position !== undefined ? node.position : '--'}</span>
      ${node.angle !== undefined ? `<span class="detail-label">\uAC01\uB3C4</span><span class="detail-value">${node.angle.toFixed(1)}\u00B0</span>` : ''}
      ${node.voltage !== undefined ? `<span class="detail-label">\uC804\uC555</span><span class="detail-value">${node.voltage.toFixed(1)} V</span>` : ''}
      ${node.temperature !== undefined ? `<span class="detail-label">\uC628\uB3C4</span><span class="detail-value">${node.temperature}\u00B0C</span>` : ''}
      ${isProtected ? '<span class="detail-label">\uBCF4\uD638</span><span class="detail-value" style="color:var(--warning)">\uD30C\uB77C\uBBF8\uD130 \uBCC0\uACBD/\uAD6C\uB3D9\uD14C\uC2A4\uD2B8 \uBD88\uAC00</span>' : ''}
    `;
  },

  // ==================== 파라미터 읽기 ====================

  async readParams() {
    const nodeId = this._selectedNodeId;
    if (!nodeId) {
      App.showToast('\uB178\uB4DC\uB97C \uBA3C\uC800 \uC120\uD0DD\uD558\uC138\uC694.', 'warn');
      return;
    }

    const ip = this._getRobotIp();
    if (!ip) return;

    this._log(`\uD30C\uB77C\uBBF8\uD130 \uC77D\uAE30: Node ${nodeId}`, 'ok');
    const data = await this._apiCall('params/read', 'POST', { nodeId }, ip);
    if (!data) return;

    const content = document.getElementById('params-content');
    if (content && data.params) {
      const isProtected = this.PROTECTED_NODES.includes(nodeId);
      let html = `<h4>Node ${nodeId} - ${_escapeHtml(this.NODE_NAMES[nodeId] || '')}</h4>`;
      html += '<table class="compare-table"><thead><tr><th>\uD30C\uB77C\uBBF8\uD130</th><th>\uAC12</th><th>\uC124\uBA85</th></tr></thead><tbody>';
      data.params.forEach(p => {
        html += `<tr>
          <td>${_escapeHtml(p.name || p.index)}</td>
          <td>${_escapeHtml(String(p.value))}</td>
          <td>${_escapeHtml(p.desc || '')}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      if (isProtected) {
        html += '<p style="color:var(--warning);margin-top:8px">\u26A0\uFE0F \uBCF4\uD638 \uB178\uB4DC: \uD30C\uB77C\uBBF8\uD130 \uBCC0\uACBD \uBD88\uAC00</p>';
      }
      content.innerHTML = html;
    }

    this.openModal('can-modal-params');
  },

  // ==================== 파라미터 비교 ====================

  showCompareModal() {
    const ip = this._getRobotIp();
    if (ip) {
      const input1 = document.getElementById('compare-ip1');
      if (input1) input1.value = ip;
    }
    document.getElementById('compare-results').innerHTML = '';
    this.openModal('can-modal-compare');
  },

  async compareExec() {
    const ip1 = document.getElementById('compare-ip1').value.trim();
    const ip2 = document.getElementById('compare-ip2').value.trim();

    if (!ip1 || !ip2) {
      App.showToast('\uB450 \uB85C\uBD07\uC758 IP\uB97C \uC785\uB825\uD558\uC138\uC694.', 'warn');
      return;
    }

    this._log(`\uD30C\uB77C\uBBF8\uD130 \uBE44\uAD50: ${ip1} vs ${ip2}`, 'ok');
    const data = await this.compareParams(ip1, ip2);
    if (!data) return;

    const container = document.getElementById('compare-results');
    if (!container) return;

    if (data.diffs && data.diffs.length > 0) {
      let html = `<p style="color:var(--danger);font-weight:600">\u274C ${data.diffs.length}\uAC1C \uCC28\uC774 \uBC1C\uACAC</p>`;
      html += '<table class="compare-table"><thead><tr><th>Node</th><th>\uD30C\uB77C\uBBF8\uD130</th><th>\uB85C\uBD07 1</th><th>\uB85C\uBD07 2</th></tr></thead><tbody>';
      data.diffs.forEach(d => {
        html += `<tr class="diff-row">
          <td>${d.nodeId}</td>
          <td>${_escapeHtml(d.param)}</td>
          <td>${_escapeHtml(String(d.value1))}</td>
          <td>${_escapeHtml(String(d.value2))}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    } else {
      container.innerHTML = '<p style="color:var(--success)">\u2705 \uBAA8\uB4E0 \uD30C\uB77C\uBBF8\uD130 \uC77C\uCE58</p>';
    }

    this._log(`\uBE44\uAD50 \uC644\uB8CC: ${data.diffs ? data.diffs.length : 0}\uAC1C \uCC28\uC774`, data.diffs && data.diffs.length > 0 ? 'warn' : 'ok');
  },

  async compareParams(robotIp1, robotIp2) {
    try {
      const url = '/api/can/params/compare';
      const resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ robotIp1, robotIp2 })
      }, 30000);
      const data = await resp.json();
      if (!resp.ok) {
        this._log(`\uBE44\uAD50 \uC624\uB958: ${data.error || resp.statusText}`, 'error');
        return null;
      }
      return data;
    } catch (err) {
      this._log(`\uBE44\uAD50 \uC2E4\uD328: ${err.message}`, 'error');
      return null;
    }
  },

  // ==================== 중복 ID 확인 ====================

  async checkDup() {
    const ip = this._getRobotIp();
    if (!ip) return;

    this._log('\uC911\uBCF5 ID \uD655\uC778 \uC2DC\uC791...', 'ok');
    const data = await this._apiCall('check-duplicate', 'POST', null, ip);
    if (!data) return;

    if (data.duplicates && data.duplicates.length > 0) {
      CanRobotView.markDuplicates(data.duplicates);
      this._log(`\u26A0\uFE0F \uC911\uBCF5 ID \uBC1C\uACAC: ${data.duplicates.join(', ')}`, 'warn');
      App.showToast(`\uC911\uBCF5 Node ID \uBC1C\uACAC: ${data.duplicates.join(', ')}`, 'error');
    } else {
      this._log('\u2705 \uC911\uBCF5 ID \uC5C6\uC74C', 'ok');
      App.showToast('\uC911\uBCF5 Node ID \uC5C6\uC74C', 'success');
    }
  },

  // ==================== ID 변경 ====================

  showChangeIdModal() {
    const select = document.getElementById('change-id-old');
    if (select) {
      select.innerHTML = '<option value="">-- \uC120\uD0DD --</option>';
      this._nodes.forEach(n => {
        const name = this.NODE_NAMES[n.id] || '';
        select.innerHTML += `<option value="${n.id}">Node ${n.id} (${_escapeHtml(name)})</option>`;
      });
    }
    this.openModal('can-modal-change-id');
  },

  async changeIdExec() {
    const oldId = parseInt(document.getElementById('change-id-old').value);
    const newId = parseInt(document.getElementById('change-id-new').value);

    if (!oldId || !newId) {
      App.showToast('\uD604\uC7AC ID\uC640 \uC0C8 ID\uB97C \uBAA8\uB450 \uC785\uB825\uD558\uC138\uC694.', 'warn');
      return;
    }

    if (oldId === newId) {
      App.showToast('\uAC19\uC740 ID\uB85C\uB294 \uBCC0\uACBD\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.', 'warn');
      return;
    }

    // 중복 확인
    const existing = this._nodes.find(n => n.id === newId);
    if (existing) {
      App.showToast(`Node ${newId}\uB294 \uC774\uBBF8 \uC874\uC7AC\uD569\uB2C8\uB2E4. \uB2E4\uB978 ID\uB97C \uC120\uD0DD\uD558\uC138\uC694.`, 'error');
      return;
    }

    if (!confirm(`Node ${oldId} \u2192 Node ${newId}\uB85C \uBCC0\uACBD\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?`)) return;

    const ip = this._getRobotIp();
    this._log(`ID \uBCC0\uACBD: Node ${oldId} \u2192 ${newId}`, 'ok');
    const data = await this.changeNodeId(ip, oldId, newId);
    if (data) {
      this._log(`\u2705 ID \uBCC0\uACBD \uC131\uACF5: Node ${oldId} \u2192 ${newId}`, 'ok');
      this._showPowerBanner(`Node ${oldId} \u2192 ${newId} ID \uBCC0\uACBD`);
      App.showToast('ID \uBCC0\uACBD \uC131\uACF5. \uC804\uC6D0 \uC7AC\uD22C\uC785 \uD544\uC694.', 'success');
      this.closeModal('can-modal-change-id');
    }
  },

  async changeNodeId(robotIp, oldId, newId) {
    return await this._apiCall('node/change-id', 'POST', { oldId, newId }, robotIp);
  },

  // ==================== STO 설정 ====================

  showStoModal() {
    const container = document.getElementById('sto-node-list');
    if (!container) return;

    let html = '';
    [1, 2, 3, 4, 5, 6, 7].forEach(id => {
      const node = this._nodes.find(n => n.id === id);
      const name = this.NODE_NAMES[id] || `Node ${id}`;
      const status = node ? (node.sto ? 'ON' : 'OFF') : '--';
      html += `<label style="display:flex;align-items:center;gap:8px;padding:4px 0">
        <input type="checkbox" class="sto-node-check" value="${id}" ${node ? '' : 'disabled'}>
        <span>Node ${id} (${_escapeHtml(name)}) - STO: ${status}</span>
      </label>`;
    });
    container.innerHTML = html;
    this.openModal('can-modal-sto');
  },

  async setStoExec(value) {
    const checks = document.querySelectorAll('.sto-node-check:checked');
    const nodeIds = Array.from(checks).map(c => parseInt(c.value));

    if (nodeIds.length === 0) {
      App.showToast('\uB178\uB4DC\uB97C \uC120\uD0DD\uD558\uC138\uC694.', 'warn');
      return;
    }

    const action = value ? 'ON (Safe)' : 'OFF (Enable)';
    if (!confirm(`\uC120\uD0DD\uB41C \uB178\uB4DC [${nodeIds.join(', ')}]\uC5D0 STO ${action} \uC124\uC815\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?`)) return;

    const ip = this._getRobotIp();
    this._log(`STO ${action}: Node ${nodeIds.join(', ')}`, 'ok');
    const data = await this.setSto(ip, nodeIds, value);
    if (data) {
      this._log(`\u2705 STO ${action} \uC124\uC815 \uC644\uB8CC`, 'ok');
      App.showToast(`STO ${action} \uC124\uC815 \uC644\uB8CC`, 'success');
      this.closeModal('can-modal-sto');
      // 다시 스캔
      this.scan();
    }
  },

  async setSto(robotIp, nodeIds, value) {
    return await this._apiCall('sto', 'POST', { nodeIds, value }, robotIp);
  },

  // ==================== 구동 테스트 ====================

  showDriveTestModal() {
    document.getElementById('drive-test-safety').checked = false;
    document.getElementById('drive-test-node').value = '';
    document.getElementById('drive-test-speed').value = '0.1';
    document.getElementById('drive-test-speed-display').textContent = '0.10';
    document.getElementById('drive-test-duration').value = '5';
    document.getElementById('btn-drive-exec').style.display = '';
    document.getElementById('btn-drive-stop').style.display = 'none';
    this.openModal('can-modal-drive-test');
  },

  async driveTestExec() {
    const nodeId = parseInt(document.getElementById('drive-test-node').value);
    const speed = parseFloat(document.getElementById('drive-test-speed').value);
    const duration = parseInt(document.getElementById('drive-test-duration').value);
    const safetyChecked = document.getElementById('drive-test-safety').checked;

    if (!nodeId) {
      App.showToast('\uB178\uB4DC\uB97C \uC120\uD0DD\uD558\uC138\uC694.', 'warn');
      return;
    }

    if (this.PROTECTED_NODES.includes(nodeId)) {
      App.showToast('\uBCF4\uD638 \uB178\uB4DC(5,6,7)\uB294 \uAD6C\uB3D9 \uD14C\uC2A4\uD2B8\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.', 'error');
      return;
    }

    if (!safetyChecked) {
      App.showToast('\uC548\uC804 \uD655\uC778\uC744 \uCCB4\uD06C\uD558\uC138\uC694.', 'error');
      return;
    }

    if (duration > 30) {
      App.showToast('\uCD5C\uB300 30\uCD08\uAE4C\uC9C0 \uAC00\uB2A5\uD569\uB2C8\uB2E4.', 'warn');
      return;
    }

    // 2중 확인
    if (!confirm(`Node ${nodeId}\uB97C ${speed} m/s\uB85C ${duration}\uCD08\uAC04 \uAD6C\uB3D9\uD569\uB2C8\uB2E4.\n\uBC14\uD034\uAC00 \uB5B4 \uC0C1\uD0DC\uC778\uC9C0 \uD655\uC778\uD588\uC2B5\uB2C8\uAE4C?`)) return;

    const ip = this._getRobotIp();
    this._log(`\uAD6C\uB3D9 \uD14C\uC2A4\uD2B8 \uC2DC\uC791: Node ${nodeId}, ${speed} m/s, ${duration}s`, 'warn');

    document.getElementById('btn-drive-exec').style.display = 'none';
    document.getElementById('btn-drive-stop').style.display = '';

    const data = await this.driveTest(ip, nodeId, speed, duration);
    if (data) {
      this._log(`\u2705 \uAD6C\uB3D9 \uD14C\uC2A4\uD2B8 \uC644\uB8CC`, 'ok');
    }

    document.getElementById('btn-drive-exec').style.display = '';
    document.getElementById('btn-drive-stop').style.display = 'none';
  },

  async driveStop() {
    const nodeId = parseInt(document.getElementById('drive-test-node').value);
    if (!nodeId) return;

    const ip = this._getRobotIp();
    this._log(`\uAD6C\uB3D9 \uC815\uC9C0: Node ${nodeId}`, 'warn');
    await this._apiCall('drive/stop', 'POST', { nodeId }, ip);

    document.getElementById('btn-drive-exec').style.display = '';
    document.getElementById('btn-drive-stop').style.display = 'none';
  },

  async driveTest(robotIp, nodeId, speed, duration) {
    return await this._apiCall('drive/test', 'POST', { nodeId, speed, duration }, robotIp);
  },

  // ==================== Fault Reset ====================

  async faultReset() {
    const nodeId = this._selectedNodeId;
    if (!nodeId) {
      App.showToast('\uB178\uB4DC\uB97C \uBA3C\uC800 \uC120\uD0DD\uD558\uC138\uC694.', 'warn');
      return;
    }

    const ip = this._getRobotIp();
    if (!ip) return;

    this._log(`Fault Reset: Node ${nodeId}`, 'ok');
    const data = await this._apiCall('fault-reset', 'POST', { nodeId }, ip);
    if (data) {
      this._log(`\u2705 Fault Reset \uC644\uB8CC: Node ${nodeId}`, 'ok');
      App.showToast(`Node ${nodeId} Fault Reset \uC644\uB8CC`, 'success');
      // 다시 스캔
      this.scan();
    }
  },

  // ==================== BUS-OFF ====================

  async checkBusOff() {
    const ip = this._getRobotIp();
    if (!ip) return;

    this._log('BUS-OFF \uC0C1\uD0DC \uD655\uC778...', 'ok');
    const data = await this._apiCall('bus-off/check', 'POST', null, ip);
    if (!data) return;

    if (data.busOff) {
      this._log(`\u26A0\uFE0F BUS-OFF \uBC1C\uC0DD! TEC:${data.tec} REC:${data.rec}`, 'error');
      App.showToast('BUS-OFF \uC0C1\uD0DC \uAC10\uC9C0!', 'error');
    } else {
      this._log(`\u2705 CAN \uBC84\uC2A4 \uC815\uC0C1. State: ${data.state || 'OK'}`, 'ok');
      App.showToast('CAN \uBC84\uC2A4 \uC815\uC0C1', 'success');
    }
  },

  async recoverBusOff() {
    const ip = this._getRobotIp();
    if (!ip) return;

    if (!confirm('BUS-OFF \uBCF5\uAD6C\uB97C \uC2E4\uD589\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?')) return;

    this._log('BUS-OFF \uBCF5\uAD6C \uC2DC\uB3C4...', 'warn');
    const data = await this._apiCall('bus-off/recover', 'POST', null, ip);
    if (data) {
      this._log('\u2705 BUS-OFF \uBCF5\uAD6C \uC644\uB8CC', 'ok');
      App.showToast('BUS-OFF \uBCF5\uAD6C \uC644\uB8CC', 'success');
      // 다시 스캔
      this.scan();
    }
  },

  // ==================== 전원 재투입 배너 ====================

  _showPowerBanner(detail) {
    const banner = document.getElementById('can-power-banner');
    const text = document.getElementById('can-power-banner-text');
    if (!banner || !text) return;

    this._paramChangedNodes.push(detail);
    text.textContent = `\u26A0\uFE0F \uD30C\uB77C\uBBF8\uD130\uAC00 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC804\uC6D0 \uC7AC\uD22C\uC785(OFF\u2192ON) \uD6C4 \uC801\uC6A9\uB429\uB2C8\uB2E4. \uBCC0\uACBD: ${this._paramChangedNodes.join(', ')}`;
    banner.classList.add('visible');
  },

  dismissPowerBanner() {
    const banner = document.getElementById('can-power-banner');
    if (banner) banner.classList.remove('visible');
    this._paramChangedNodes = [];
  },

  // ==================== 모달 ====================

  openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('visible');
  },

  closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('visible');
  },

  // ==================== 로그 ====================

  _log(msg, level) {
    const logEl = document.getElementById('can-log');
    if (!logEl) return;

    const now = new Date().toLocaleTimeString('ko-KR');
    const cls = level === 'error' ? 'log-error' : level === 'warn' ? 'log-warn' : level === 'ok' ? 'log-ok' : '';
    const entry = document.createElement('div');
    entry.className = `log-entry ${cls}`;
    entry.textContent = `[${now}] ${msg}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;

    this._logEntries.push({ time: now, msg, level });
    // 최대 200개 유지
    if (this._logEntries.length > 200) this._logEntries.shift();
  },

  clearLog() {
    const logEl = document.getElementById('can-log');
    if (logEl) logEl.innerHTML = '';
    this._logEntries = [];
  },

  // ==================== 탭 활성화 콜백 ====================

  onTabActivated() {
    // 탭 전환 시 호출 - 필요하면 새로고침
    if (!document.getElementById('can-robot-view-container')?.children.length) {
      this.initCanDiagTab();
    }
  },

  // ==================== 헬퍼 ====================

  _statusBadgeClass(status) {
    if (!status) return 'st-offline';
    const s = status.toLowerCase();
    if (s === 'enable' || s === 'enabled' || s === 'operational') return 'st-enable';
    if (s === 'fault' || s === 'error') return 'st-fault';
    if (s === 'disabled' || s === 'pre-operational') return 'st-disabled';
    return 'st-offline';
  },
};

// 탭 컨텐츠 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  // tab-can-diag가 존재하면 초기화
  if (document.getElementById('tab-can-diag')) {
    CanDiag.initCanDiagTab();
  }
});
