// System Info Monitor - CPU, Memory, Disk, Temperature, Network
const SysInfo = {
  _interval: null,
  _refreshRate: 10000, // 10 seconds
  _lastNetRx: 0,
  _lastNetTx: 0,
  _lastNetTime: 0,

  init() {
    this.bindEvents();
    // Auto-refresh when connected
    document.addEventListener('ros-connected', () => this.startMonitoring());
    document.addEventListener('ros-disconnected', () => this.stopMonitoring());
  },

  bindEvents() {
    const refreshBtn = document.getElementById('btn-sysinfo-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refresh());
    }
  },

  startMonitoring() {
    this.refresh();
    this._interval = setInterval(() => this.refresh(), this._refreshRate);
  },

  stopMonitoring() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this.clearDisplay();
  },

  clearDisplay() {
    document.getElementById('sysinfo-cpu').textContent = '--%';
    document.getElementById('sysinfo-mem').textContent = '--%';
    document.getElementById('sysinfo-disk').textContent = '--%';
    document.getElementById('sysinfo-temp').textContent = '--°C';
    const rxEl = document.getElementById('sysinfo-net-rx');
    const txEl = document.getElementById('sysinfo-net-tx');
    if (rxEl) rxEl.textContent = '-- KB/s';
    if (txEl) txEl.textContent = '-- KB/s';
    ['cpu', 'mem', 'disk'].forEach(type => {
      const bar = document.getElementById(`sysinfo-${type}-bar`);
      if (bar) bar.style.width = '0%';
    });
    this._lastNetRx = 0;
    this._lastNetTx = 0;
    this._lastNetTime = 0;
  },

  async refresh() {
    const robot = typeof App !== 'undefined' ? App.getActiveRobot() : null;
    if (!robot || !robot.ip) return;

    try {
      // Execute combined command to get all system info at once
      const cmd = `echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1)";echo "MEM:$(free | awk '/Mem:/{printf "%.1f", $3/$2*100}')";echo "DISK:$(df / | awk 'NR==2{print $5}' | tr -d '%')";cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | head -1 | awk '{printf "TEMP:%.1f\\n", $1/1000}';cat /proc/net/dev | awk '/eth0|wlan0|eno|enp/{rx+=$2;tx+=$10}END{print "NETRX:"rx"\\nNETTX:"tx}'`;

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

      if (!res.ok) throw new Error('SSH exec failed');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Command failed');

      this.parseAndDisplay(data.output);
    } catch (err) {
      console.warn('SysInfo refresh failed:', err.message);
    }
  },

  parseAndDisplay(output) {
    const lines = output.split('\n');
    let cpu = 0, mem = 0, disk = 0, temp = 0, netRx = 0, netTx = 0;

    lines.forEach(line => {
      if (line.startsWith('CPU:')) {
        cpu = parseFloat(line.split(':')[1]) || 0;
      } else if (line.startsWith('MEM:')) {
        mem = parseFloat(line.split(':')[1]) || 0;
      } else if (line.startsWith('DISK:')) {
        disk = parseFloat(line.split(':')[1]) || 0;
      } else if (line.startsWith('TEMP:')) {
        temp = parseFloat(line.split(':')[1]) || 0;
      } else if (line.startsWith('NETRX:')) {
        netRx = parseInt(line.split(':')[1]) || 0;
      } else if (line.startsWith('NETTX:')) {
        netTx = parseInt(line.split(':')[1]) || 0;
      }
    });

    // Update display
    this.updateMetric('cpu', cpu, '%');
    this.updateMetric('mem', mem, '%');
    this.updateMetric('disk', disk, '%');
    document.getElementById('sysinfo-temp').textContent = `${temp.toFixed(1)}°C`;

    // Calculate network bandwidth
    const now = Date.now();
    if (this._lastNetTime > 0) {
      const dt = (now - this._lastNetTime) / 1000; // seconds
      const rxRate = (netRx - this._lastNetRx) / dt / 1024; // KB/s
      const txRate = (netTx - this._lastNetTx) / dt / 1024; // KB/s
      this.updateNetworkDisplay(rxRate, txRate);
    }
    this._lastNetRx = netRx;
    this._lastNetTx = netTx;
    this._lastNetTime = now;
  },

  updateNetworkDisplay(rxRate, txRate) {
    const rxEl = document.getElementById('sysinfo-net-rx');
    const txEl = document.getElementById('sysinfo-net-tx');
    if (rxEl) {
      rxEl.textContent = rxRate >= 1024
        ? `${(rxRate/1024).toFixed(1)} MB/s`
        : `${rxRate.toFixed(1)} KB/s`;
    }
    if (txEl) {
      txEl.textContent = txRate >= 1024
        ? `${(txRate/1024).toFixed(1)} MB/s`
        : `${txRate.toFixed(1)} KB/s`;
    }
  },

  updateMetric(type, value, unit) {
    const valueEl = document.getElementById(`sysinfo-${type}`);
    const barEl = document.getElementById(`sysinfo-${type}-bar`);

    if (valueEl) {
      valueEl.textContent = `${value.toFixed(1)}${unit}`;
    }

    if (barEl) {
      barEl.style.width = `${Math.min(value, 100)}%`;
      barEl.classList.remove('warn', 'danger');
      if (value >= 90) {
        barEl.classList.add('danger');
      } else if (value >= 70) {
        barEl.classList.add('warn');
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  SysInfo.init();
});
