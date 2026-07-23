// Fleet Dashboard - Overview of all connected robots
const FleetDashboard = {
  _refreshInterval: null,

  init() {
    const btn = document.getElementById('btn-fleet-dashboard');
    if (btn) {
      btn.addEventListener('click', () => this.showModal());
    }
  },

  showModal() {
    let modal = document.getElementById('fleet-dashboard-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'fleet-dashboard-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content fleet-dashboard-modal-content">
          <div class="modal-header">
            <h3>Fleet Dashboard</h3>
            <button class="modal-close" id="fleet-dashboard-close">&times;</button>
          </div>
          <div class="fleet-dashboard-body">
            <div class="fleet-summary" id="fleet-summary"></div>
            <div class="fleet-robot-grid" id="fleet-robot-grid"></div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#fleet-dashboard-close').addEventListener('click', () => {
        this.stopRefresh();
        modal.classList.remove('active');
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.stopRefresh();
          modal.classList.remove('active');
        }
      });
    }

    this.refresh();
    this.startRefresh();
    modal.classList.add('active');
  },

  startRefresh() {
    if (this._refreshInterval) return;
    this._refreshInterval = setInterval(() => this.refresh(), 5000);
  },

  stopRefresh() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  },

  refresh() {
    this.renderSummary();
    this.renderRobotGrid();
  },

  renderSummary() {
    const summaryEl = document.getElementById('fleet-summary');
    if (!summaryEl) return;

    const slots = App.robotSlots || [];
    const total = slots.length;
    const connected = slots.filter(s => s.ros && s.ros.isConnected).length;
    const charging = slots.filter(s => s.bms && s.bms.charging).length;
    const lowBattery = slots.filter(s => s.bms && s.bms.soc < 20).length;

    summaryEl.innerHTML = `
      <div class="fleet-stat">
        <div class="fleet-stat-value">${total}</div>
        <div class="fleet-stat-label">Total</div>
      </div>
      <div class="fleet-stat fleet-stat-ok">
        <div class="fleet-stat-value">${connected}</div>
        <div class="fleet-stat-label">Online</div>
      </div>
      <div class="fleet-stat fleet-stat-warn">
        <div class="fleet-stat-value">${charging}</div>
        <div class="fleet-stat-label">Charging</div>
      </div>
      <div class="fleet-stat fleet-stat-danger">
        <div class="fleet-stat-value">${lowBattery}</div>
        <div class="fleet-stat-label">Low Batt</div>
      </div>
    `;
  },

  renderRobotGrid() {
    const gridEl = document.getElementById('fleet-robot-grid');
    if (!gridEl) return;

    const slots = App.robotSlots || [];

    if (slots.length === 0) {
      gridEl.innerHTML = '<div class="fleet-empty">No robots configured</div>';
      return;
    }

    gridEl.innerHTML = slots.map((slot, i) => {
      const isConnected = slot.ros && slot.ros.isConnected;
      const bms = slot.bms || {};
      const workState = slot.workState || {};
      const pose = slot.pose || {};
      const isActive = i === App.activeSlotIndex;

      const statusClass = isConnected ? 'connected' : 'disconnected';
      const batteryClass = bms.soc < 20 ? 'low' : bms.soc < 50 ? 'mid' : 'high';
      const chargingIcon = bms.charging ? '⚡' : '';

      return `
        <div class="fleet-robot-card ${statusClass} ${isActive ? 'active' : ''}" data-idx="${i}">
          <div class="fleet-robot-header">
            <span class="fleet-robot-id">${this.escapeHtml(slot.robotId || 'Robot ' + (i + 1))}</span>
            <span class="fleet-robot-status ${statusClass}">${isConnected ? '●' : '○'}</span>
          </div>
          <div class="fleet-robot-ip">${slot.ip || '-'}:${slot.wsPort || 9090}</div>
          <div class="fleet-robot-battery ${batteryClass}">
            <div class="fleet-battery-bar" style="width: ${bms.soc || 0}%"></div>
            <span class="fleet-battery-text">${chargingIcon} ${bms.soc !== undefined ? bms.soc.toFixed(0) + '%' : '-'}</span>
          </div>
          <div class="fleet-robot-info">
            <div class="fleet-info-row">
              <span class="fleet-info-label">State:</span>
              <span class="fleet-info-value">${this.getWorkStateName(workState.state)}</span>
            </div>
            <div class="fleet-info-row">
              <span class="fleet-info-label">Pos:</span>
              <span class="fleet-info-value">${pose.x !== undefined ? `(${pose.x.toFixed(1)}, ${pose.y.toFixed(1)})` : '-'}</span>
            </div>
          </div>
          <div class="fleet-robot-actions">
            <button class="btn btn-tiny btn-fleet-select ${isActive ? 'active' : ''}" data-idx="${i}">${isActive ? 'Active' : 'Select'}</button>
          </div>
        </div>
      `;
    }).join('');

    gridEl.querySelectorAll('.btn-fleet-select').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        App.setActiveSlot(idx);
        this.renderRobotGrid();
        App.toast(`Switched to ${App.robotSlots[idx]?.robotId || 'Robot ' + (idx + 1)}`, 'info');
      });
    });
  },

  getWorkStateName(state) {
    const states = { 0: 'Idle', 1: 'Moving', 2: 'Charging', 3: 'Error', 4: 'Manual', 5: 'Paused' };
    return states[state] || '-';
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  FleetDashboard.init();
});
