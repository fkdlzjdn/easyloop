// rosout Log Viewer - Real-time ROS log monitoring
const RosoutViewer = {
  _subscription: null,
  _logs: [],
  _maxLogs: 500,
  _levelFilter: 0,
  _searchFilter: '',
  _autoScroll: true,

  LEVELS: {
    1: 'debug',
    2: 'info',
    4: 'warn',
    8: 'error',
    16: 'fatal'
  },

  init() {
    this.bindEvents();
  },

  bindEvents() {
    const toggleBtn = document.getElementById('btn-rosout-toggle');
    const clearBtn = document.getElementById('btn-rosout-clear');
    const levelSelect = document.getElementById('rosout-level-filter');
    const searchInput = document.getElementById('rosout-search');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggle());
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clear());
    }
    if (levelSelect) {
      levelSelect.addEventListener('change', (e) => {
        this._levelFilter = parseInt(e.target.value);
        this.renderLogs();
      });
    }
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this._searchFilter = e.target.value.toLowerCase();
        this.renderLogs();
      });
    }
  },

  toggle() {
    const btn = document.getElementById('btn-rosout-toggle');
    if (this._subscription) {
      this.stop();
      if (btn) {
        btn.textContent = 'Start';
        btn.classList.remove('btn-danger');
        btn.classList.add('btn-primary');
      }
    } else {
      this.start();
      if (btn) {
        btn.textContent = 'Stop';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-danger');
      }
    }
  },

  start() {
    const idx = App.activeSlotIndex >= 0 ? App.activeSlotIndex : 0;
    const slot = App.robotSlots[idx];
    if (!slot || !slot.ros) {
      App.toast('No ROS connection', 'error');
      return;
    }

    this._subscription = new ROSLIB.Topic({
      ros: slot.ros,
      name: '/rosout',
      messageType: 'rosgraph_msgs/Log'
    });

    this._subscription.subscribe((msg) => {
      this.addLog(msg);
    });

    App.toast('rosout viewer started', 'success');
  },

  stop() {
    if (this._subscription) {
      this._subscription.unsubscribe();
      this._subscription = null;
    }
    App.toast('rosout viewer stopped', 'info');
  },

  addLog(msg) {
    const log = {
      time: msg.header ? new Date(msg.header.stamp.secs * 1000) : new Date(),
      level: msg.level,
      levelName: this.LEVELS[msg.level] || 'unknown',
      node: msg.name || 'unknown',
      msg: msg.msg || ''
    };

    this._logs.unshift(log);
    if (this._logs.length > this._maxLogs) {
      this._logs.pop();
    }

    this.renderLogs();
  },

  clear() {
    this._logs = [];
    this.renderLogs();
  },

  renderLogs() {
    const container = document.getElementById('rosout-log');
    if (!container) return;

    let filtered = this._logs;

    // Level filter
    if (this._levelFilter > 0) {
      filtered = filtered.filter(l => l.level >= this._levelFilter);
    }

    // Search filter
    if (this._searchFilter) {
      filtered = filtered.filter(l =>
        l.msg.toLowerCase().includes(this._searchFilter) ||
        l.node.toLowerCase().includes(this._searchFilter)
      );
    }

    // Render (max 100 visible)
    const visible = filtered.slice(0, 100);
    container.innerHTML = visible.map(l => `
      <div class="rosout-entry">
        <span class="rosout-time">${this.formatTime(l.time)}</span>
        <span class="rosout-level ${l.levelName}">${l.levelName.toUpperCase()}</span>
        <span class="rosout-node" title="${l.node}">${this.shortName(l.node)}</span>
        <span class="rosout-msg">${this.escapeHtml(l.msg)}</span>
      </div>
    `).join('');

    if (this._autoScroll && container.scrollTop === 0) {
      // Already at top for newest-first
    }
  },

  formatTime(date) {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  },

  shortName(name) {
    if (!name) return 'unknown';
    const parts = name.split('/');
    return parts[parts.length - 1] || name;
  },

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  RosoutViewer.init();
});
