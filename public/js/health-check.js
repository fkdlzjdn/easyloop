// Health Check Suite - One-click robot health check
const HealthCheck = {
  _running: false,
  _results: [],

  // Health check items
  checks: [
    { id: 'ros', name: 'ROS Master', type: 'ros', cmd: null },
    { id: 'rosbridge', name: 'ROS Bridge', type: 'ros', cmd: null },
    { id: 'cpu', name: 'CPU Usage', type: 'ssh', cmd: "top -bn1 | grep 'Cpu(s)' | awk '{print $2}'", threshold: 80, unit: '%' },
    { id: 'memory', name: 'Memory Usage', type: 'ssh', cmd: "free | awk '/Mem:/{printf \"%.0f\", $3/$2*100}'", threshold: 85, unit: '%' },
    { id: 'disk', name: 'Disk Usage', type: 'ssh', cmd: "df / | awk 'NR==2{print $5}' | tr -d '%'", threshold: 90, unit: '%' },
    { id: 'temp', name: 'CPU Temperature', type: 'ssh', cmd: "cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | head -1 | awk '{printf \"%.0f\", $1/1000}'", threshold: 75, unit: '°C' },
    { id: 'network', name: 'Network', type: 'ping', cmd: null },
    { id: 'time', name: 'System Time', type: 'ssh', cmd: 'date "+%Y-%m-%d %H:%M:%S"', threshold: null, unit: '' },
    { id: 'uptime', name: 'Uptime', type: 'ssh', cmd: "uptime -p | sed 's/up //'", threshold: null, unit: '' },
    { id: 'rosnodes', name: 'ROS Nodes', type: 'ssh', cmd: 'rosnode list 2>/dev/null | wc -l', threshold: 5, thresholdType: 'min', unit: '' }
  ],

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this.bindEvents();
  },

  bindEvents() {
    const runBtn = document.getElementById('btn-health-check-run');
    const closeBtn = document.getElementById('btn-health-check-close');
    const modal = document.getElementById('health-check-modal');

    if (runBtn) {
      runBtn.addEventListener('click', () => this.runAll());
    }
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    }

    // Header button to open modal
    const openBtn = document.getElementById('btn-health-check');
    if (openBtn && modal) {
      openBtn.addEventListener('click', () => {
        modal.classList.add('active');
        this.renderResults();
      });
    }
  },

  async runAll() {
    if (this._running) {
      App.toast('Health check already running', 'warning');
      return;
    }

    const robot = App.getActiveRobot();
    if (!robot || !robot.ip) {
      App.toast('Please connect to a robot first', 'error');
      return;
    }

    this._running = true;
    this._results = [];
    this.updateRunButton(true);
    this.renderResults();

    for (const check of this.checks) {
      const result = await this.runCheck(check, robot);
      this._results.push(result);
      this.renderResults();
    }

    this._running = false;
    this.updateRunButton(false);

    const passed = this._results.filter(r => r.status === 'pass').length;
    const failed = this._results.filter(r => r.status === 'fail').length;
    App.toast(`Health check complete: ${passed} passed, ${failed} failed`, failed > 0 ? 'warning' : 'success');
  },

  async runCheck(check, robot) {
    const result = {
      id: check.id,
      name: check.name,
      status: 'checking',
      value: null,
      message: ''
    };

    try {
      switch (check.type) {
        case 'ros':
          result.value = await this.checkROS(check.id);
          result.status = result.value ? 'pass' : 'fail';
          result.message = result.value ? 'Connected' : 'Not connected';
          break;

        case 'ping':
          result.value = await this.checkPing(robot.ip);
          result.status = result.value ? 'pass' : 'fail';
          result.message = result.value ? 'Reachable' : 'Unreachable';
          break;

        case 'ssh': {
          const output = await this.execSSH(robot, check.cmd);
          result.value = output.trim();
          if (check.threshold !== null) {
            const numVal = parseFloat(result.value);
            if (check.thresholdType === 'min') {
              result.status = numVal >= check.threshold ? 'pass' : 'warn';
            } else {
              result.status = numVal <= check.threshold ? 'pass' : 'warn';
            }
          } else {
            result.status = result.value ? 'pass' : 'warn';
          }
          result.message = result.value + (check.unit || '');
          break;
        }
      }
    } catch (e) {
      result.status = 'fail';
      result.message = e.message || 'Error';
    }

    return result;
  },

  checkROS(type) {
    const idx = App.activeSlotIndex >= 0 ? App.activeSlotIndex : 0;
    const slot = App.robotSlots[idx];

    if (type === 'ros') {
      return slot && slot.ros && slot.ros.isConnected;
    }
    if (type === 'rosbridge') {
      return slot && slot.ros && slot.ros.isConnected;
    }
    return false;
  },

  async checkPing(ip) {
    // We'll use a simple fetch to check connectivity
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      await fetch(`http://${ip}:9090/`, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal
      });
      clearTimeout(timeout);
      return true;
    } catch (e) {
      return false;
    }
  },

  async execSSH(robot, cmd) {
    // B12 fix: fetch 타임아웃 적용
    const res = await fetchWithTimeout('/api/ssh/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: robot.ip,
        user: robot.sshUser || 'ubuntu',
        password: robot.sshPassword || 'ubuntu',
        command: cmd
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'SSH failed');
    return data.output || '';
  },

  updateRunButton(running) {
    const btn = document.getElementById('btn-health-check-run');
    if (btn) {
      btn.disabled = running;
      btn.textContent = running ? 'Running...' : 'Run Health Check';
    }
  },

  renderResults() {
    const container = document.getElementById('health-check-results');
    if (!container) return;

    if (!this._results.length && !this._running) {
      container.innerHTML = '<div class="hc-empty">Click "Run Health Check" to start</div>';
      return;
    }

    const items = this.checks.map(check => {
      const result = this._results.find(r => r.id === check.id);
      if (result) {
        return `
          <div class="hc-item hc-${result.status}">
            <span class="hc-icon">${this.getStatusIcon(result.status)}</span>
            <span class="hc-name">${check.name}</span>
            <span class="hc-value">${result.message}</span>
          </div>
        `;
      } else {
        return `
          <div class="hc-item hc-pending">
            <span class="hc-icon">⏳</span>
            <span class="hc-name">${check.name}</span>
            <span class="hc-value">Pending</span>
          </div>
        `;
      }
    });

    container.innerHTML = items.join('');
  },

  getStatusIcon(status) {
    switch (status) {
      case 'pass': return '✅';
      case 'warn': return '⚠️';
      case 'fail': return '❌';
      case 'checking': return '🔄';
      default: return '⏳';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  HealthCheck.init();
});
