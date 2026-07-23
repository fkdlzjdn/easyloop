// Performance Profiler - Node-level CPU/Memory profiling
const PerformanceProfiler = {
  _nodeStats: [],
  _refreshInterval: null,

  init() {
    const btn = document.getElementById('btn-perf-profiler');
    if (btn) {
      btn.addEventListener('click', () => this.showModal());
    }
  },

  showModal() {
    let modal = document.getElementById('perf-profiler-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'perf-profiler-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content perf-profiler-modal-content">
          <div class="modal-header">
            <h3>Performance Profiler</h3>
            <button class="modal-close" id="btn-perf-close">&times;</button>
          </div>
          <div class="perf-profiler-body">
            <div class="perf-controls">
              <button id="btn-perf-refresh" class="btn btn-small btn-primary">Refresh</button>
              <label><input type="checkbox" id="perf-auto-refresh"> Auto-refresh (5s)</label>
            </div>
            <div id="perf-node-list" class="perf-node-list"></div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-perf-close').addEventListener('click', () => {
        this.stopAutoRefresh();
        modal.classList.remove('active');
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.stopAutoRefresh();
          modal.classList.remove('active');
        }
      });

      modal.querySelector('#btn-perf-refresh').addEventListener('click', () => this.refreshStats());

      modal.querySelector('#perf-auto-refresh').addEventListener('change', (e) => {
        if (e.target.checked) {
          this.startAutoRefresh();
        } else {
          this.stopAutoRefresh();
        }
      });
    }

    this.refreshStats();
    modal.classList.add('active');
  },

  startAutoRefresh() {
    if (this._refreshInterval) return;
    this._refreshInterval = setInterval(() => this.refreshStats(), 5000);
  },

  stopAutoRefresh() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
    const checkbox = document.getElementById('perf-auto-refresh');
    if (checkbox) checkbox.checked = false;
  },

  async refreshStats() {
    const list = document.getElementById('perf-node-list');
    list.innerHTML = '<div class="perf-loading">Loading node stats...</div>';

    try {
      // Get ROS node list
      const nodesResult = await SSHTerminal.execCommand('rosnode list 2>/dev/null | head -30');

      if (!nodesResult.success || !nodesResult.stdout) {
        list.innerHTML = '<div class="perf-error">Failed to get node list</div>';
        return;
      }

      const nodes = nodesResult.stdout.trim().split('\n').filter(n => n);

      if (nodes.length === 0) {
        list.innerHTML = '<div class="perf-empty">No ROS nodes found</div>';
        return;
      }

      // Get process stats for ROS nodes
      const psResult = await SSHTerminal.execCommand(
        'ps aux --sort=-%cpu | head -50 | grep -E "ros|python|node" | head -20'
      );

      const processes = [];
      if (psResult.success && psResult.stdout) {
        const lines = psResult.stdout.trim().split('\n');
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length >= 11) {
            processes.push({
              pid: parts[1],
              cpu: parseFloat(parts[2]) || 0,
              mem: parseFloat(parts[3]) || 0,
              cmd: parts.slice(10).join(' ').substring(0, 60)
            });
          }
        }
      }

      // Match nodes to processes (simplified)
      const nodeStats = nodes.map(nodeName => {
        const shortName = nodeName.replace(/^\//, '');
        const matchedProc = processes.find(p =>
          p.cmd.includes(shortName) ||
          p.cmd.includes(nodeName)
        );

        return {
          name: nodeName,
          cpu: matchedProc ? matchedProc.cpu : 0,
          mem: matchedProc ? matchedProc.mem : 0,
          pid: matchedProc ? matchedProc.pid : '-'
        };
      });

      // Sort by CPU usage
      nodeStats.sort((a, b) => b.cpu - a.cpu);
      this._nodeStats = nodeStats;

      // Render
      list.innerHTML = `
        <table class="perf-table">
          <thead>
            <tr>
              <th>Node</th>
              <th>CPU %</th>
              <th>MEM %</th>
              <th>PID</th>
            </tr>
          </thead>
          <tbody>
            ${nodeStats.map(n => `
              <tr class="${n.cpu > 50 ? 'high-cpu' : ''}">
                <td class="perf-node-name" title="${n.name}">${n.name}</td>
                <td class="${n.cpu > 30 ? 'warn' : ''}">${n.cpu.toFixed(1)}%</td>
                <td class="${n.mem > 20 ? 'warn' : ''}">${n.mem.toFixed(1)}%</td>
                <td>${n.pid}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    } catch (e) {
      list.innerHTML = `<div class="perf-error">Error: ${e.message}</div>`;
    }
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  PerformanceProfiler.init();
});
