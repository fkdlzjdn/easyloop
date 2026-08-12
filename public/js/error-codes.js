// Error Code Database - Quick reference for engineers
const ErrorCodeDB = {
  // Default error codes (can be extended via localStorage)
  _defaultCodes: {
    // Work State errors
    99: { name: 'SYSTEM_ERROR', desc: 'General system error', solution: 'Check rosout logs, restart system' },
    100: { name: 'EMERGENCY_STOP', desc: 'Emergency stop activated', solution: 'Release E-stop button, reset safety' },

    // Navigation errors (100-199)
    101: { name: 'NAV_GOAL_REJECTED', desc: 'Navigation goal was rejected', solution: 'Check if goal is reachable on map' },
    102: { name: 'NAV_PLANNING_FAILED', desc: 'Path planning failed', solution: 'Check costmap, clear local costmap' },
    103: { name: 'NAV_LOCALIZATION_LOST', desc: 'Robot lost localization', solution: 'Reinitialize pose with 2D Pose Estimate' },
    104: { name: 'NAV_OBSTACLE_BLOCKED', desc: 'Path blocked by obstacle', solution: 'Remove obstacle or change goal' },

    // Motor/Drive errors (200-299)
    201: { name: 'MOTOR_OVERCURRENT', desc: 'Motor overcurrent detected', solution: 'Check motor wiring, reduce load' },
    202: { name: 'MOTOR_OVERHEAT', desc: 'Motor temperature too high', solution: 'Let motors cool down, check ventilation' },
    203: { name: 'ENCODER_ERROR', desc: 'Encoder signal lost', solution: 'Check encoder connection/wiring' },
    204: { name: 'DRIVER_FAULT', desc: 'Motor driver fault', solution: 'Reset driver, check power supply' },

    // Battery/BMS errors (300-399)
    301: { name: 'BMS_LOW_VOLTAGE', desc: 'Battery voltage too low', solution: 'Charge battery immediately' },
    302: { name: 'BMS_OVERCURRENT', desc: 'Battery overcurrent', solution: 'Reduce load, check for short circuit' },
    303: { name: 'BMS_OVERHEAT', desc: 'Battery temperature too high', solution: 'Stop operation, let battery cool' },
    304: { name: 'BMS_COMM_ERROR', desc: 'BMS communication lost', solution: 'Check BMS CAN/serial connection' },

    // Sensor errors (400-499)
    401: { name: 'LIDAR_ERROR', desc: 'LiDAR not responding', solution: 'Check LiDAR power/connection, restart' },
    402: { name: 'CAMERA_ERROR', desc: 'Camera not available', solution: 'Check camera USB/power connection' },
    403: { name: 'IMU_ERROR', desc: 'IMU sensor failure', solution: 'Check IMU connection, recalibrate' },
    404: { name: 'ULTRASONIC_ERROR', desc: 'Ultrasonic sensor failure', solution: 'Check sensor wiring' },

    // Communication errors (500-599)
    501: { name: 'ROS_MASTER_LOST', desc: 'Lost connection to ROS Master', solution: 'Check network, restart roscore' },
    502: { name: 'ROSBRIDGE_TIMEOUT', desc: 'rosbridge not responding', solution: 'Restart rosbridge_server' },
    503: { name: 'CAN_BUS_ERROR', desc: 'CAN bus communication error', solution: 'Check CAN wiring and termination' },

    // Docking errors (600-699)
    601: { name: 'DOCK_NOT_FOUND', desc: 'Docking station not detected', solution: 'Align robot with dock, check sensors' },
    602: { name: 'DOCK_ALIGNMENT_FAIL', desc: 'Failed to align with dock', solution: 'Retry docking, check dock position' },
    603: { name: 'CHARGING_CONTACT_FAIL', desc: 'Charging contact not made', solution: 'Clean charging contacts' }
  },

  _customCodes: {},

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this.loadCustomCodes();
    this.bindEvents();
    this.renderCodes();
  },

  loadCustomCodes() {
    try {
      const saved = localStorage.getItem('amrErrorCodesCustom');
      this._customCodes = saved ? JSON.parse(saved) : {};
    } catch (e) {
      this._customCodes = {};
    }
  },

  saveCustomCodes() {
    // B13 fix: localStorage 안전 쓰기
    try { localStorage.setItem('amrErrorCodesCustom', JSON.stringify(this._customCodes)); }
    catch (e) { console.warn('localStorage.setItem amrErrorCodesCustom failed:', e.message); }
  },

  getAllCodes() {
    return { ...this._defaultCodes, ...this._customCodes };
  },

  getCode(code) {
    const codes = this.getAllCodes();
    return codes[code] || null;
  },

  addCustomCode(code, name, desc, solution) {
    this._customCodes[code] = { name, desc, solution, custom: true };
    this.saveCustomCodes();
    this.renderCodes();
  },

  deleteCustomCode(code) {
    delete this._customCodes[code];
    this.saveCustomCodes();
    this.renderCodes();
  },

  bindEvents() {
    const searchInput = document.getElementById('error-code-search');
    const addBtn = document.getElementById('btn-add-error-code');

    if (searchInput) {
      searchInput.addEventListener('input', () => this.renderCodes());
    }

    if (addBtn) {
      addBtn.addEventListener('click', () => this.showAddDialog());
    }
  },

  renderCodes() {
    const container = document.getElementById('error-code-list');
    if (!container) return;

    const codes = this.getAllCodes();
    const searchInput = document.getElementById('error-code-search');
    const search = searchInput ? searchInput.value.toLowerCase() : '';

    const filtered = Object.entries(codes).filter(([code, info]) => {
      if (!search) return true;
      return code.toString().includes(search) ||
             info.name.toLowerCase().includes(search) ||
             info.desc.toLowerCase().includes(search);
    });

    filtered.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    container.innerHTML = filtered.map(([code, info]) => `
      <div class="error-code-item ${info.custom ? 'custom' : ''}">
        <div class="erc-code">${code}</div>
        <div class="erc-content">
          <div class="erc-name">${this.escapeHtml(info.name)}</div>
          <div class="erc-desc">${this.escapeHtml(info.desc)}</div>
          <div class="erc-solution"><strong>Solution:</strong> ${this.escapeHtml(info.solution)}</div>
        </div>
        ${info.custom ? `<button class="btn btn-mini btn-danger erc-delete" data-code="${code}">&times;</button>` : ''}
      </div>
    `).join('');

    // Bind delete buttons
    container.querySelectorAll('.erc-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        if (confirm(`Delete error code ${code}?`)) {
          this.deleteCustomCode(code);
        }
      });
    });
  },

  showAddDialog() {
    const code = prompt('Error Code (number):');
    if (!code || isNaN(parseInt(code))) return;

    const name = prompt('Error Name (e.g., MOTOR_ERROR):');
    if (!name) return;

    const desc = prompt('Description:');
    if (!desc) return;

    const solution = prompt('Solution:');
    if (!solution) return;

    this.addCustomCode(parseInt(code), name, desc, solution);
    App.toast('Error code added', 'success');
  },

  // Lookup error code and show toast
  lookup(code) {
    const info = this.getCode(code);
    if (info) {
      App.toast(`[${code}] ${info.name}: ${info.solution}`, 'info');
      return info;
    }
    return null;
  },

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  ErrorCodeDB.init();
});
