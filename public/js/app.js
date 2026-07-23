// ==================== Global Utilities ====================

// S3 fix: XSS 방지용 HTML 이스케이프
function _escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// B12 fix: fetch 타임아웃 래퍼 (기본 15초)
function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// S1 fix: 비밀번호 난독화 (평문 저장 방지)
function _obfuscatePassword(pw) {
  if (!pw) return '';
  const key = 'amrF13ldT00l';
  let result = '';
  for (let i = 0; i < pw.length; i++) {
    result += String.fromCharCode(pw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result);
}
function _deobfuscatePassword(encoded) {
  if (!encoded) return '';
  try {
    const decoded = atob(encoded);
    const key = 'amrF13ldT00l';
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  } catch (e) {
    return encoded; // 이전 평문 데이터 호환
  }
}

// B13 fix: localStorage 안전 래퍼
function _safeSetItem(key, value) {
  try { localStorage.setItem(key, value); }
  catch (e) { console.warn(`localStorage.setItem('${key}') failed:`, e.message); }
}

// ==================== Main Application ====================
// EasyLoop - Main Application
const App = {
  currentRobot: null,
  robots: [],
  isDarkMode: true, // Default: Night mode (dark)
  toastContainer: null,
  EVENT_LOG_KEY: 'amrEventLog',
  EVENT_LOG_LIMIT: 200,
  LOG_RETENTION_DAYS: 7,  // Auto-cleanup logs older than this

  // Multi-robot slots
  robotSlots: [],
  discoveredRobots: [],
  activeSlotIndex: -1,
  SLOTS_STORAGE_KEY: 'amrRobotSlots',
  LAST_ACTIVE_ROBOT_KEY: 'easyloopLastActiveRobot',
  _loginAutoScanStarted: false,
  _isUnloading: false, // Flag to track page unload

  init() {
    this.initToastSystem();
    if (typeof TestMode !== 'undefined') TestMode.init();
    this.setupPasswordAuth();
    this.setupTabs();
    this.setupHeader();
    this.setupThemeToggle();
    this.setupMapControls();
    this.setupRobotManager();
    // Robot presence is session-only. A successful login scan rebuilds this list.
    try { localStorage.removeItem(this.SLOTS_STORAGE_KEY); } catch (e) { /* ignore */ }
    this.loadRobots();
    this._setupBeforeUnload();

    // Auto cleanup old logs
    this.cleanupOldLogs();

    // Initial multi-robot buttons visibility
    this.updateMultiRobotButtons();
  },

  // Update multi-robot buttons visibility (show when 2+ robots)
  updateMultiRobotButtons() {
    const btns = document.getElementById('multi-robot-btns');
    if (!btns) return;

    const connectedCount = this.robotSlots.filter(s => s.connected).length;
    if (connectedCount >= 2) {
      btns.classList.remove('hidden');
    } else {
      btns.classList.add('hidden');
    }
  },

  // Save robot slots before page unload (to preserve connection state)
  _setupBeforeUnload() {
    window.addEventListener('beforeunload', () => {
      this._isUnloading = true;
      // B15 fix: 페이지 언로드 시 리소스 정리
      // Stop latency monitor
      if (typeof RosManager !== 'undefined') {
        RosManager.stopLatencyMonitor();
        // B7 fix: Hz 모니터링 인터벌 정리
        if (RosManager._hzInterval) {
          clearInterval(RosManager._hzInterval);
          RosManager._hzInterval = null;
        }
      }
    });
  },

  initToastSystem() {
    this.toastContainer = document.getElementById('toast-container');
  },

  toast(message, type = 'info', duration = 3200) {
    if (!this.toastContainer) return;
    if (!message) return;

    this.addEvent('notification', message, null, type);

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    this.toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    const remove = () => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    };

    setTimeout(remove, duration);
  },

  getEventLog() {
    try {
      const raw = localStorage.getItem(this.EVENT_LOG_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  },

  saveEventLog(logs) {
    try {
      localStorage.setItem(this.EVENT_LOG_KEY, JSON.stringify(logs));
    } catch (e) {
      // ignore
    }
  },

  // Data Retention: Clean up old logs
  cleanupOldLogs() {
    const retentionMs = this.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;
    let logs = this.getEventLog();
    const origLen = logs.length;

    logs = logs.filter(log => log.at && log.at > cutoff);

    if (logs.length < origLen) {
      this.saveEventLog(logs);
      console.log(`Data retention: Removed ${origLen - logs.length} old log entries`);
    }
  },

  // Calculate storage usage
  getStorageUsage() {
    let total = 0;
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key) && key.startsWith('amr')) {
        total += (localStorage.getItem(key) || '').length;
      }
    }
    return {
      bytes: total,
      kb: (total / 1024).toFixed(1),
      mb: (total / 1024 / 1024).toFixed(2)
    };
  },

  // Clear all stored data
  clearAllStoredData() {
    if (!confirm('Clear all stored data? This will remove robots, logs, settings, and notes.')) {
      return;
    }
    const keys = [];
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key) && key.startsWith('amr')) {
        keys.push(key);
      }
    }
    keys.forEach(k => localStorage.removeItem(k));
    this.toast(`Cleared ${keys.length} stored items`, 'success');
  },

  // Audit Trail: Log user actions for accountability
  AUDIT_LOG_KEY: 'amrAuditTrail',
  AUDIT_LOG_LIMIT: 500,

  logAudit(action, details = {}) {
    try {
      const raw = localStorage.getItem(this.AUDIT_LOG_KEY);
      const logs = raw ? JSON.parse(raw) : [];

      logs.unshift({
        action,
        details,
        robot: this.getActiveRobot()?.id || null,
        ip: this.getActiveRobot()?.ip || null,
        at: new Date().toISOString()
      });

      if (logs.length > this.AUDIT_LOG_LIMIT) {
        logs.length = this.AUDIT_LOG_LIMIT;
      }

      localStorage.setItem(this.AUDIT_LOG_KEY, JSON.stringify(logs));
    } catch (e) {
      // ignore
    }
  },

  getAuditLog() {
    try {
      const raw = localStorage.getItem(this.AUDIT_LOG_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  exportAuditLog() {
    const logs = this.getAuditLog();
    if (!logs.length) {
      this.toast('No audit log to export', 'info');
      return;
    }

    const csv = [
      ['Timestamp', 'Action', 'Robot', 'IP', 'Details'].join(','),
      ...logs.map(l => [
        l.at,
        l.action,
        l.robot || '',
        l.ip || '',
        JSON.stringify(l.details || {}).replace(/"/g, '""')
      ].map(c => `"${c}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const link = document.createElement('a');
    link.download = `amr-audit_${ts}.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();

    this.toast('Audit log exported', 'success');
  },

  renderAuditTrail() {
    const list = document.getElementById('audit-trail-list');
    if (!list) return;

    const logs = this.getAuditLog();
    const search = (document.getElementById('audit-search')?.value || '').toLowerCase();
    const filter = document.getElementById('audit-filter')?.value || 'all';

    let filtered = logs;
    if (filter !== 'all') {
      filtered = filtered.filter(l => l.action === filter);
    }
    if (search) {
      filtered = filtered.filter(l =>
        l.action.toLowerCase().includes(search) ||
        (l.robot || '').toLowerCase().includes(search) ||
        JSON.stringify(l.details || {}).toLowerCase().includes(search)
      );
    }

    if (!filtered.length) {
      list.innerHTML = '<div class="audit-empty">No audit logs found</div>';
      return;
    }

    list.innerHTML = filtered.slice(0, 200).map(l => {
      const date = new Date(l.at).toLocaleString();
      const actionLabel = {
        'action_send': '🚀 Action',
        'ssh_command': '💻 SSH',
        'file_upload': '📤 Upload',
        'file_download': '📥 Download'
      }[l.action] || l.action;
      const details = Object.entries(l.details || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
      return `<div class="audit-item">
        <span class="audit-time">${date}</span>
        <span class="audit-action">${actionLabel}</span>
        <span class="audit-robot">${l.robot || '-'}</span>
        <span class="audit-details">${details}</span>
      </div>`;
    }).join('');
  },

  addEvent(type, title, detail = null, level = 'info') {
    const logs = this.getEventLog();
    logs.unshift({
      type,
      title,
      detail,
      level,
      at: Date.now()
    });

    if (logs.length > this.EVENT_LOG_LIMIT) {
      logs.length = this.EVENT_LOG_LIMIT;
    }

    this.saveEventLog(logs);

    if (typeof Dashboard !== 'undefined' && Dashboard.render) {
      Dashboard.render();
    }
  },

  clearEventLog(type = null) {
    if (!type) {
      this.saveEventLog([]);
    } else {
      const logs = this.getEventLog().filter(entry => entry.type !== type);
      this.saveEventLog(logs);
    }

    if (typeof Dashboard !== 'undefined' && Dashboard.render) {
      Dashboard.render();
    }
  },

  setButtonLoading(button, isLoading, label) {
    if (!button) return;

    if (isLoading) {
      if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent;
      }
      if (label) {
        button.textContent = label;
      }
      button.classList.add('loading');
      button.disabled = true;
      return;
    }

    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
    button.classList.remove('loading');
    button.disabled = false;
  },

  // Password Authentication
  setupPasswordAuth() {
    const overlay = document.getElementById('password-overlay');
    const input = document.getElementById('password-input');
    const submit = document.getElementById('password-submit');
    const error = document.getElementById('password-error');
    const mainContent = document.getElementById('main-content');
    const logoutBtn = document.getElementById('btn-logout');

    const showMainContent = (role) => {
      overlay.style.display = 'none';
      mainContent.style.display = 'block';
      error.style.display = 'none';
      this._userRole = role || 'user';
      this._applyRoleRestrictions();
      this.startLoginRobotDiscovery();
    };

    const showOverlay = () => {
      mainContent.style.display = 'none';
      overlay.style.display = 'flex';
      input.value = '';
      error.style.display = 'none';
      input.focus();
    };

    const setError = (message) => {
      error.textContent = message;
      error.style.display = 'block';
    };

    const checkStatus = async () => {
      try {
        // B12 fix: fetch 타임아웃 적용
        const res = await fetchWithTimeout('/api/auth/status', { credentials: 'same-origin' });
        const data = await res.json();
        if (data.authenticated) {
          showMainContent(data.role);
          return;
        }
      } catch (e) {
        console.warn('Auth status check failed:', e);
      }

      showOverlay();
    };

    const checkPassword = async () => {
      const password = input.value;
      if (!password) {
        setError('비밀번호를 입력하세요');
        input.focus();
        return;
      }

      try {
        // B12 fix: fetch 타임아웃 적용
        const res = await fetchWithTimeout('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ password, role: document.querySelector('input[name="login-role"]:checked')?.value || 'user' })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          showMainContent(data.role);
          return;
        }

        setError(data.message || '로그인 실패');
      } catch (e) {
        console.error('Login failed:', e);
        setError('로그인 실패');
      }

      input.value = '';
      input.focus();
    };

    submit.addEventListener('click', checkPassword);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') checkPassword();
    });

    logoutBtn.addEventListener('click', async () => {
      try {
        // B12 fix: fetch 타임아웃 적용
        await fetchWithTimeout('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin'
        });
      } catch (e) {
        console.warn('Logout failed:', e);
      }

      showOverlay();

      this._loginAutoScanStarted = false;

      // Disconnect all robot slots and stop tunnels
      this.clearCurrentRobotSlots();
      this.discoveredRobots = [];
      // Stop all tunnels
      fetch('/api/tunnel/stop-all', { method: 'POST' }).catch(() => {});
      if (SSHTerminal.ws) SSHTerminal.disconnect();
    });

    // Cleanup tunnels on page unload
    window.addEventListener('beforeunload', () => {
      navigator.sendBeacon('/api/tunnel/stop-all', '{}');
    });

    checkStatus();
  },

  // Role-based UI restrictions
  _userRole: 'user',

  _applyRoleRestrictions() {
    const isEngineer = this._userRole === 'engineer';

    // Engineer-only tabs
    const engineerTabs = ['tab-ssh', 'tab-batch', 'tab-files', 'tab-ros', 'tab-docking', 'tab-scheduler', 'tab-diagnostics', 'tab-can-diag'];
    engineerTabs.forEach(tabId => {
      const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
      if (btn) btn.style.display = isEngineer ? '' : 'none';
    });

    // If current active tab is hidden, switch to Dashboard
    if (!isEngineer) {
      const activeTab = document.querySelector('.tab-btn.active');
      if (activeTab && engineerTabs.includes(activeTab.dataset.tab)) {
        const dashBtn = document.querySelector('.tab-btn[data-tab="tab-dashboard"]');
        if (dashBtn) dashBtn.click();
      }
    }

    // Engineer-only map controls: SLAM, Auto-align
    const engineerElements = [
      'btn-map-auto-align',     // Auto-align
    ];
    engineerElements.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = isEngineer ? '' : 'none';
    });


    // Show role badge in header
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.textContent = isEngineer ? '엔지니어 로그아웃' : '로그아웃';
      logoutBtn.title = `Logged in as ${this._userRole}`;
    }

    // Add body class for CSS-based hiding
    document.body.classList.toggle('role-user', !isEngineer);
    document.body.classList.toggle('role-engineer', isEngineer);
  },

  // Tab Navigation
  setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetId = tab.dataset.tab;

        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(targetId).classList.add('active');

        // Save active tab to session
        _safeSetItem('amrActiveTab', targetId);

        // Resize terminal when switching to SSH tab
        if (targetId === 'tab-ssh' && SSHTerminal.terminal) {
          setTimeout(() => SSHTerminal.fit(), 100);
        }

        // Render graphs when switching to Docking tab
        if (targetId === 'tab-docking' && typeof DockingTest !== 'undefined') {
          setTimeout(() => DockingTest.renderGraphs(), 100);
        }

        // Re-render monitoring cards when switching to monitoring tab
        if (targetId === 'tab-monitoring') {
          this.renderMonitoringCards();
        }

        const fleetControlActive = targetId === 'tab-fleet-control';
        document.getElementById('main-layout')?.classList.toggle('fleet-control-mode', fleetControlActive);
        if (typeof FleetControl !== 'undefined') {
          if (fleetControlActive) FleetControl.activate();
          else FleetControl.deactivate();
        }

        // Notify Diagnostics module when tab is activated
        if (targetId === 'tab-diagnostics' && typeof Diagnostics !== 'undefined') {
          Diagnostics.onTabActivated();
        }

        // Notify CAN Diagnostics module when tab is activated
        if (targetId === 'tab-can-diag' && typeof CanDiag !== 'undefined') {
          CanDiag.onTabActivated();
        }
      });
    });

    // Restore last active tab
    const savedTab = localStorage.getItem('amrActiveTab');
    if (savedTab) {
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${savedTab}"]`);
      if (tabBtn) tabBtn.click();
    }

    // Camera tab checkbox handlers
    this.setupCameraTabCheckboxes();
    this.setupCameraSnapshot();

    // Font size control
    this.setupFontSizeControl();


    // Mobile sidebar toggle
    this.setupMobileSidebar();
  },


  setupMobileSidebar() {
    const btn = document.getElementById('btn-mobile-sidebar');
    const sidebar = document.querySelector('.sidebar');
    if (!btn || !sidebar) return;

    btn.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });

    // Close sidebar when clicking outside
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('mobile-open') &&
          !sidebar.contains(e.target) &&
          e.target !== btn) {
        sidebar.classList.remove('mobile-open');
      }
    });
  },

  setupFontSizeControl() {
    const buttons = document.querySelectorAll('.btn-font-size');
    const savedSize = localStorage.getItem('amrFontSize') || 'normal';

    // Apply saved size
    this.applyFontSize(savedSize);
    buttons.forEach(btn => {
      if (btn.dataset.size === savedSize) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const size = btn.dataset.size;
        this.applyFontSize(size);
        _safeSetItem('amrFontSize', size);
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.toast(`Font size: ${size}`, 'info');
      });
    });
  },

  applyFontSize(size) {
    document.body.classList.remove('font-small', 'font-normal', 'font-large', 'font-xlarge');
    document.body.classList.add(`font-${size}`);
  },

  setupCameraTabCheckboxes() {
    const checkboxes = document.querySelectorAll('.cam-select-chk');
    const layoutSelect = document.getElementById('cam-layout-select');

    // Map camera tab checkbox data-cam → hidden checkbox id
    const camToHiddenId = {
      'cam1-depth': 'chk-cam1-depth',
      'cam1-color': 'chk-cam1-color',
      'cam2-depth': 'chk-cam2-depth',
      'cam2-color': 'chk-cam2-color'
    };

    checkboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const maxPanes = RosManager._camLayoutCount || 2;
        const checked = document.querySelectorAll('.cam-select-chk:checked');
        if (checked.length > maxPanes) {
          cb.checked = false;
          App.toast(`최대 ${maxPanes}개까지 선택 가능`, 'info');
          return;
        }
        // Sync to hidden subscription checkbox and trigger topic subscribe/unsubscribe
        const hiddenId = camToHiddenId[cb.dataset.cam];
        if (hiddenId) {
          const hidden = document.getElementById(hiddenId);
          if (hidden) {
            hidden.checked = cb.checked;
            if (hidden.onchange) hidden.onchange();
          }
        }
        RosManager.updateCameraPanes();
      });
    });

    if (layoutSelect) {
      layoutSelect.addEventListener('change', () => {
        const count = parseInt(layoutSelect.value);
        RosManager.setCameraLayout(count);
      });
    }
  },

  setupCameraSnapshot() {
    const snapAll = document.getElementById('btn-cam-snapshot-all');

    const saveCanvas = (canvasId, label) => {
      const canvas = document.getElementById(canvasId);
      if (!canvas || canvas.parentElement.style.display === 'none') return;
      const ctx = canvas.getContext('2d');
      const pixel = ctx.getImageData(0, 0, 1, 1).data;
      if (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 0) return;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `camera_${label}_${ts}.png`;
      const link = document.createElement('a');
      link.download = filename;
      link.href = canvas.toDataURL('image/png');
      link.click();
      return filename;
    };

    if (snapAll) snapAll.addEventListener('click', () => {
      let saved = 0;
      for (let i = 0; i < 4; i++) {
        const result = saveCanvas(`cam-pane-${i}-canvas`, `P${i + 1}`);
        if (result) saved++;
      }
      if (saved > 0) {
        this.toast(`${saved}개 스냅샷 저장됨`, 'success');
      } else {
        this.toast('카메라 이미지 없음', 'info');
      }
    });
  },

  // Header Controls
  setupHeader() {
    // Active robot selector
    const activeSelect = document.getElementById('active-robot-select');
    activeSelect.addEventListener('change', () => {
      const idx = parseInt(activeSelect.value, 10);
      if (!isNaN(idx) && idx >= 0 && idx < this.robotSlots.length) {
        this.switchActiveRobot(idx);
      }
    });

    // BMS charging toggle in test mode — click on the gauge container
    const bmsGaugeEl = document.querySelector('.bms-gauge');
    if (bmsGaugeEl) {
      bmsGaugeEl.style.cursor = 'pointer';
      bmsGaugeEl.addEventListener('click', () => {
        if (typeof TestMode !== 'undefined' && TestMode.enabled) {
          TestMode._bmsCharging = !TestMode._bmsCharging;
          TestMode._bmsChargingManual = true; // prevent setWorkState from overriding
          this.toast(TestMode._bmsCharging ? 'Charging started (test)' : 'Charging stopped (test)', 'info');
        }
      });
    }
  },

  // Format robot ID: "1" -> "R_001", "44" -> "R_044", "R_005" stays
  formatRobotId(value) {
    if (!value) return '';
    // Already formatted
    if (/^R_\d{3}$/.test(value)) return value;
    // Pure number
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 0 && num <= 999) {
      return 'R_' + String(num).padStart(3, '0');
    }
    return value;
  },

  // Robot Manager Modal setup
  setupRobotManager() {
    const btn = document.getElementById('btn-robot-manager');
    const headerScanBtn = document.getElementById('btn-robot-scan');
    const modal = document.getElementById('robot-manager-modal');
    const closeBtn = document.getElementById('btn-rm-close');
    const addBtn = document.getElementById('btn-rm-add');

    btn.addEventListener('click', () => {
      this.renderRobotManagerList();
      modal.classList.add('show');
    });

    if (headerScanBtn) {
      headerScanBtn.addEventListener('click', () => {
        this.runNetworkScan({ autoConnect: true, background: true, replaceCurrent: true });
      });
    }

    closeBtn.addEventListener('click', () => {
      modal.classList.remove('show');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    });

    addBtn.addEventListener('click', () => {
      const ipInput = document.getElementById('rm-new-ip');
      const idInput = document.getElementById('rm-new-id');
      const sshPortInput = document.getElementById('rm-new-ssh-port');
      const tunnelModeInput = document.getElementById('rm-new-tunnel-mode');
      const sshPasswordInput = document.getElementById('rm-new-ssh-password');
      const ip = ipInput.value.trim();
      const rawId = idInput.value.trim();
      const robotId = this.formatRobotId(rawId);
      const sshPort = sshPortInput && sshPortInput.value ? parseInt(sshPortInput.value) : 22;
      const tunnelMode = tunnelModeInput ? tunnelModeInput.checked : false;
      const sshPassword = sshPasswordInput ? sshPasswordInput.value : '';

      if (!ip) {
        this.toast('IP 주소를 입력하세요', 'error');
        return;
      }
      if (!robotId) {
        this.toast('로봇 번호를 입력하세요', 'error');
        return;
      }

      // Extract number from robotId for tunnel local IP
      const robotNumber = parseInt(rawId) || parseInt(robotId.replace(/\D/g, '')) || 1;

      this.addRobotSlot(ip, robotId, sshPort, tunnelMode, sshPassword, robotNumber);
      ipInput.value = '';
      idInput.value = '';
      if (sshPortInput) sshPortInput.value = '';
      if (tunnelModeInput) tunnelModeInput.checked = false;
      if (sshPasswordInput) sshPasswordInput.value = '';
      this.renderRobotManagerList();
      this.renderActiveRobotSelector();
      this.renderMonitoringCards();
    });

    // Clone settings
    const cloneBtn = document.getElementById('btn-rm-clone');
    if (cloneBtn) {
      cloneBtn.addEventListener('click', () => {
        const fromIdx = parseInt(document.getElementById('rm-clone-from').value);
        const toIdx = parseInt(document.getElementById('rm-clone-to').value);
        if (isNaN(fromIdx) || isNaN(toIdx)) { this.toast('Select clone target', 'error'); return; }
        if (fromIdx === toIdx) { this.toast('Same robot selected', 'error'); return; }
        const from = this.robotSlots[fromIdx];
        const to = this.robotSlots[toIdx];
        if (!from || !to) return;
        to.sshPort = from.sshPort;
        to.tunnelMode = from.tunnelMode;
        to.sshPassword = from.sshPassword;
        to.robotNumber = from.robotNumber;
        this.saveRobotSlots();
        this.renderRobotManagerList();
        this.toast(`설정 복사 완료: ${from.robotId} → ${to.robotId} (IP 유지)`, 'success');
      });
    }

    // Network Scan
    this.setupNetworkScan();
  },

  setupNetworkScan() {
    const scanBtn = document.getElementById('btn-rm-scan');
    const subnetInput = document.getElementById('rm-scan-subnet');

    if (!scanBtn) return;

    const savedSubnet = localStorage.getItem('easyloopScanSubnet');
    if (savedSubnet) subnetInput.value = savedSubnet;

    scanBtn.addEventListener('click', () => this.runNetworkScan({ autoConnect: true, replaceCurrent: true }));
    subnetInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.runNetworkScan({ autoConnect: true, replaceCurrent: true });
    });

    // Template selection
    const templateSelect = document.getElementById('rm-template');
    if (templateSelect) {
      templateSelect.addEventListener('change', () => {
        this.applyRobotTemplate(templateSelect.value);
      });
    }
  },

  startLoginRobotDiscovery() {
    if (this._loginAutoScanStarted) return;
    this._loginAutoScanStarted = true;
    this.runNetworkScan({
      autoConnect: true,
      background: true,
      replaceCurrent: true
    });
  },

  async runNetworkScan({ autoConnect = false, background = false, replaceCurrent = false } = {}) {
    const scanBtn = document.getElementById('btn-rm-scan');
    const headerScanBtn = document.getElementById('btn-robot-scan');
    const subnetInput = document.getElementById('rm-scan-subnet');
    const statusEl = document.getElementById('rm-scan-status');
    const resultsEl = document.getElementById('rm-scan-results');
    const listEl = document.getElementById('rm-scan-list');
    if (!scanBtn || scanBtn.disabled) return;

    const enteredSubnet = subnetInput.value.trim() || '192.168.20';
    // 마지막 점은 사용자가 IP를 이어 입력하던 습관에서 자주 남으므로 자동 보정한다.
    const subnet = enteredSubnet.replace(/\.$/, '');
    subnetInput.value = subnet;
    scanBtn.disabled = true;
    if (headerScanBtn) headerScanBtn.disabled = true;
    if (background && headerScanBtn) headerScanBtn.textContent = '스캔 중...';
    statusEl.textContent = '자동 검색 중...';
    statusEl.className = 'rm-scan-status scanning';
    resultsEl.style.display = 'block';
    listEl.innerHTML = '<span class="rm-scan-empty">ROS Bridge와 RID를 확인하고 있습니다...</span>';

    try {
      const response = await fetchWithTimeout(
        `/api/robots/scan-subnet?base=${encodeURIComponent(subnet)}`,
        {},
        30000
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Scan failed');

      localStorage.setItem('easyloopScanSubnet', data.subnet || subnet);
      subnetInput.value = data.subnet || subnet;
      this.discoveredRobots = Array.isArray(data.hosts) ? data.hosts : [];

      let stageSummary = { addedCount: 0, connectCount: 0 };
      if (autoConnect && (replaceCurrent || this.discoveredRobots.length > 0)) {
        stageSummary = this.stageDiscoveredRobots(this.discoveredRobots, {
          silent: background,
          replaceCurrent
        });
      }

      listEl.innerHTML = '';

      if (!data.hosts || data.hosts.length === 0) {
        listEl.innerHTML = '<span class="rm-scan-empty">발견된 로봇이 없습니다. 대역과 ROS Bridge 상태를 확인하세요.</span>';
        statusEl.textContent = `0대 발견 · ${data.fixedTarget} 확인 완료`;
      } else {
        data.hosts.forEach(host => {
          const existingIndex = this.robotSlots.findIndex(slot => slot.ip === host.ip);
          const alreadyExists = existingIndex >= 0;
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'rm-scan-item';
          if (alreadyExists) item.classList.add('registered');
          if (existingIndex === this.activeSlotIndex) item.classList.add('selected');

          const rid = document.createElement('span');
          rid.className = `scan-rid${host.robotId ? '' : ' unknown'}`;
          rid.textContent = host.robotId || 'RID 미확인';
          item.appendChild(rid);

          const ip = document.createElement('span');
          ip.className = 'scan-ip';
          ip.textContent = host.ip;
          item.appendChild(ip);

          if (host.fixed) {
            const fixed = document.createElement('span');
            fixed.className = 'scan-fixed';
            fixed.textContent = '고정';
            item.appendChild(fixed);
          }

          const action = document.createElement('span');
          action.className = alreadyExists ? 'scan-registered' : 'scan-select';
          action.textContent = host.robotId
            ? (existingIndex === this.activeSlotIndex ? '수신 중' : '활성화')
            : 'RID 필요';
          item.appendChild(action);

          item.disabled = !host.robotId;
          item.addEventListener('click', async () => {
            listEl.querySelectorAll('.rm-scan-item').forEach(row => row.classList.remove('selected'));
            item.classList.add('selected');
            await this.selectDiscoveredRobot(host);
          });
          listEl.appendChild(item);
        });

        const identified = data.hosts.filter(host => host.robotId).length;
        statusEl.textContent = autoConnect
          ? `${data.hosts.length}대 발견 · ${identified}대 연결 시작 · ${stageSummary.activeRobotId || '활성 로봇'} 데이터 수신`
          : `${data.hosts.length}대 발견 · RID ${identified}대 확인`;
      }
      statusEl.className = 'rm-scan-status complete';

      if (background) {
        if (this.discoveredRobots.length === 0) {
          this.toast('검색된 로봇이 없습니다', 'warning');
        } else {
          this.toast(
            `${this.discoveredRobots.length}대 검색 · ${stageSummary.activeRobotId || '로봇'} 데이터 수신 시작 · 나머지 대기`,
            'success'
          );
        }
      }
    } catch (err) {
      listEl.innerHTML = `<span class="rm-scan-empty">스캔 실패: ${_escapeHtml(err.message)}</span>`;
      statusEl.textContent = '검색 실패';
      statusEl.className = 'rm-scan-status error';
      this.toast(`네트워크 스캔 실패: ${err.message}`, 'error');
    } finally {
      scanBtn.disabled = false;
      if (headerScanBtn) headerScanBtn.disabled = false;
      if (background && headerScanBtn) headerScanBtn.textContent = '로봇 스캔';
    }
  },

  // Resume one active robot with data; keep every other discovered robot connection-only.
  stageDiscoveredRobots(hosts, { silent = false, replaceCurrent = false } = {}) {
    let addedCount = 0;
    let connectCount = 0;

    if (replaceCurrent) {
      this.clearCurrentRobotSlots();
    }

    const identifiedHosts = hosts
      .filter(host => host && host.ip && host.robotId)
      .slice()
      .sort((a, b) => {
        const aNumber = this._robotNumberFromIdentity(a);
        const bNumber = this._robotNumberFromIdentity(b);
        if (aNumber !== bNumber) return aNumber - bNumber;
        return String(a.ip).localeCompare(String(b.ip), undefined, { numeric: true });
      });

    identifiedHosts.forEach(host => {
      let slotIndex = this.robotSlots.findIndex(slot => slot.ip === host.ip);
      if (slotIndex < 0) {
        const robotNumber = this._robotNumberFromIdentity(host);
        this.addRobotSlot(host.ip, host.robotId, 22, false, '', robotNumber, null, {
          activateFirst: false,
          deferRender: true,
          silent: true
        });
        slotIndex = this.robotSlots.findIndex(slot => slot.ip === host.ip);
        addedCount += 1;
      }
    });

    const startupIndex = this._chooseStartupActiveSlot();
    if (startupIndex >= 0) {
      this.activeSlotIndex = startupIndex;
      this._rememberActiveRobot(this.robotSlots[startupIndex]);
      this.updateActiveRobotStatus();
      this.updateActionTargetLabel();
    }

    // Start the active robot first. RosManager sees this index as active when
    // its WebSocket opens and subscribes full data only for this one slot.
    const connectionOrder = this.robotSlots.map((slot, index) => index);
    if (startupIndex >= 0) {
      connectionOrder.splice(connectionOrder.indexOf(startupIndex), 1);
      connectionOrder.unshift(startupIndex);
    }
    connectionOrder.forEach(slotIndex => {
      const slot = this.robotSlots[slotIndex];
      if (slot && !slot.connected && !slot.ros) {
        this.connectSlot(slotIndex);
        connectCount += 1;
      }
    });

    this.saveRobotSlots();
    this.renderActiveRobotSelector();
    this.renderRobotManagerList();
    this.renderMonitoringCards();
    this.updateMultiRobotButtons();

    if (!silent && (addedCount > 0 || connectCount > 0)) {
      const active = this.robotSlots[startupIndex];
      this.toast(
        `${addedCount}대 추가 · ${active?.robotId || '활성 로봇'} 데이터 수신 시작 · 나머지 연결 대기`,
        'info'
      );
    }

    return {
      addedCount,
      connectCount,
      activeSlotIndex: startupIndex,
      activeRobotId: this.robotSlots[startupIndex]?.robotId || null
    };
  },

  _robotNumberFromIdentity(robot) {
    const ridNumber = parseInt(String(robot?.robotId || '').replace(/\D/g, ''), 10);
    const ipNumber = parseInt(String(robot?.ip || '').split('.').pop(), 10);
    return Number.isFinite(ridNumber) ? ridNumber : (Number.isFinite(ipNumber) ? ipNumber : Number.MAX_SAFE_INTEGER);
  },

  _getRememberedActiveRobot() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.LAST_ACTIVE_ROBOT_KEY) || 'null');
      if (!saved || (!saved.robotId && !saved.ip)) return null;
      return { robotId: saved.robotId || '', ip: saved.ip || '' };
    } catch (e) {
      return null;
    }
  },

  _rememberActiveRobot(slot) {
    if (!slot?.robotId || !slot?.ip) return;
    _safeSetItem(this.LAST_ACTIVE_ROBOT_KEY, JSON.stringify({
      robotId: slot.robotId,
      ip: slot.ip
    }));
  },

  _chooseStartupActiveSlot() {
    if (this.robotSlots.length === 0) return -1;
    const previous = this._getRememberedActiveRobot();
    if (previous) {
      const exact = this.robotSlots.findIndex(slot =>
        slot.robotId === previous.robotId && slot.ip === previous.ip
      );
      if (exact >= 0) return exact;
      const sameRid = this.robotSlots.findIndex(slot => slot.robotId === previous.robotId);
      if (sameRid >= 0) return sameRid;
      const sameIp = this.robotSlots.findIndex(slot => slot.ip === previous.ip);
      if (sameIp >= 0) return sameIp;
    }
    return this.robotSlots.reduce((bestIndex, slot, index) => {
      if (bestIndex < 0) return index;
      return this._robotNumberFromIdentity(slot) < this._robotNumberFromIdentity(this.robotSlots[bestIndex])
        ? index
        : bestIndex;
    }, -1);
  },

  // Drop the previous session/scan list. Discovered robots are rebuilt as passive connections.
  clearCurrentRobotSlots() {
    if (typeof FleetControl !== 'undefined') FleetControl.resetConnections();
    if (typeof RosManager !== 'undefined') {
      Object.keys(RosManager._autoReconnect || {}).forEach(index => {
        if (RosManager._clearAutoReconnect) RosManager._clearAutoReconnect(Number(index));
      });
      this.robotSlots.forEach((slot, index) => {
        if (slot.ros || slot.connected) RosManager.disconnectSlot(index);
      });
      RosManager.ros = null;
    }

    if (this.robotSlots.some(slot => slot.tunnelActive)) {
      fetch('/api/tunnel/stop-all', { method: 'POST' }).catch(() => {});
    }

    this.robotSlots.length = 0;
    this.activeSlotIndex = -1;
    this.saveRobotSlots();
    this.renderActiveRobotSelector();
    this.renderRobotManagerList();
    this.renderMonitoringCards();
    this.updateActiveRobotStatus();
    this.updateMultiRobotButtons();
  },

  // Select a discovered robot without requiring a separate manual registration step.
  async selectDiscoveredRobot(host) {
    if (!host || !host.ip || !host.robotId) {
      this.toast('RID가 확인된 로봇만 자동 선택할 수 있습니다', 'warning');
      return;
    }

    let slotIndex = this.robotSlots.findIndex(slot => slot.ip === host.ip);
    if (slotIndex < 0) {
      const ridNumber = parseInt(String(host.robotId).replace(/\D/g, ''), 10);
      const ipNumber = parseInt(String(host.ip).split('.').pop(), 10);
      const robotNumber = Number.isFinite(ridNumber) ? ridNumber : (Number.isFinite(ipNumber) ? ipNumber : 1);
      this.addRobotSlot(host.ip, host.robotId, 22, false, '', robotNumber);
      slotIndex = this.robotSlots.findIndex(slot => slot.ip === host.ip);
    }

    if (slotIndex < 0) {
      this.toast(`${host.robotId} (${host.ip}) 선택 실패`, 'error');
      return;
    }

    if (slotIndex !== this.activeSlotIndex) {
      this.switchActiveRobot(slotIndex);
    } else {
      this.updateActiveRobotStatus();
      this.updateActionTargetLabel();
    }

    if (!this.robotSlots[slotIndex].connected && !this.robotSlots[slotIndex].ros) {
      await this.connectSlot(slotIndex);
    }

    this.renderRobotManagerList();
    document.getElementById('robot-manager-modal')?.classList.remove('show');
    const stateText = this.robotSlots[slotIndex].connected ? '데이터 수신 시작' : '연결 후 데이터 수신 시작';
    this.toast(`${host.robotId} (${host.ip}) 활성화 · ${stateText}`, 'info');
  },

  // Robot templates configuration
  ROBOT_TEMPLATES: {
    'ULW-100': { sshPort: 22, tunnelMode: false, defaultTopics: { bms: '/bms_state', workState: '/work_state' } },
    'ULW-200': { sshPort: 22, tunnelMode: false, defaultTopics: { bms: '/bms_state', workState: '/work_state' } },
    'ULW-300': { sshPort: 22, tunnelMode: false, defaultTopics: { bms: '/bms_state', workState: '/work_state' } },
    'SCOUT': { sshPort: 22, tunnelMode: false, defaultTopics: { bms: '/scout/bms', workState: '/scout/state' } },
    'CUSTOM': { sshPort: 22, tunnelMode: false, defaultTopics: {} }
  },

  applyRobotTemplate(templateName) {
    const template = this.ROBOT_TEMPLATES[templateName];
    if (!template) return;

    const sshPortInput = document.getElementById('rm-new-ssh-port');
    const tunnelModeInput = document.getElementById('rm-new-tunnel-mode');

    if (sshPortInput && template.sshPort) {
      sshPortInput.value = template.sshPort;
    }
    if (tunnelModeInput) {
      tunnelModeInput.checked = template.tunnelMode;
    }

    this.toast(`템플릿 적용: ${templateName}`, 'info');
  },

  // Robot slot management
  getRobotUnitNumber(slot) {
    if (!slot) return Number.MAX_SAFE_INTEGER;
    if (slot.robotId) {
      const match = String(slot.robotId).match(/(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
    if (slot.robotNumber !== undefined && slot.robotNumber !== null && !isNaN(slot.robotNumber)) {
      return parseInt(slot.robotNumber, 10);
    }
    return Number.MAX_SAFE_INTEGER;
  },

  getSortedRobotEntries() {
    return this.robotSlots
      .map((slot, index) => ({
        slot,
        index,
        unitNumber: this.getRobotUnitNumber(slot),
      }))
      .sort((a, b) => {
        if (a.slot.connected !== b.slot.connected) {
          return a.slot.connected ? -1 : 1;
        }
        if (a.unitNumber !== b.unitNumber) {
          return a.unitNumber - b.unitNumber;
        }
        const aId = a.slot.robotId || '';
        const bId = b.slot.robotId || '';
        const byId = aId.localeCompare(bId);
        if (byId !== 0) return byId;
        return (a.slot.ip || '').localeCompare(b.slot.ip || '');
      });
  },

  findSlotIndexByUnitNumber(unitNumber) {
    const entry = this.robotSlots.findIndex(slot => this.getRobotUnitNumber(slot) === unitNumber);
    return entry >= 0 ? entry : -1;
  },

  UNIT_SWITCH_BUFFER_TIMEOUT_MS: 900,
  _unitSwitchBuffer: '',
  _unitSwitchTimer: null,

  queueUnitSwitchDigit(digit) {
    if (!/^\d$/.test(String(digit))) return;

    // Limit to 3 digits. If the buffer is already full, start a new input sequence.
    if (this._unitSwitchBuffer.length >= 3) {
      this._unitSwitchBuffer = '';
    }

    this._unitSwitchBuffer += String(digit);
    this._resetUnitSwitchTimer();
  },

  backspaceUnitSwitchBuffer() {
    if (!this._unitSwitchBuffer) return false;

    this._unitSwitchBuffer = this._unitSwitchBuffer.slice(0, -1);
    if (this._unitSwitchBuffer) {
      this._resetUnitSwitchTimer();
    } else {
      this.clearUnitSwitchBuffer();
    }
    return true;
  },

  clearUnitSwitchBuffer() {
    this._unitSwitchBuffer = '';
    if (this._unitSwitchTimer) {
      clearTimeout(this._unitSwitchTimer);
      this._unitSwitchTimer = null;
    }
  },

  _resetUnitSwitchTimer() {
    if (this._unitSwitchTimer) {
      clearTimeout(this._unitSwitchTimer);
    }
    this._unitSwitchTimer = setTimeout(() => {
      this.commitUnitSwitchBuffer();
    }, this.UNIT_SWITCH_BUFFER_TIMEOUT_MS);
  },

  commitUnitSwitchBuffer() {
    const buffer = this._unitSwitchBuffer;
    this.clearUnitSwitchBuffer();

    if (!buffer) return false;

    const unitNumber = parseInt(buffer, 10);
    if (isNaN(unitNumber) || unitNumber <= 0) return false;

    const slotIdx = this.findSlotIndexByUnitNumber(unitNumber);
    if (slotIdx < 0) {
      this.toast(`호기 ${String(unitNumber).padStart(3, '0')} 가 등록되어 있지 않습니다`, 'warning');
      return false;
    }

    this.switchActiveRobot(slotIdx);
    if (!this.robotSlots[slotIdx].connected) {
      this.connectSlot(slotIdx);
    }
    this.toast(`호기 ${String(unitNumber).padStart(3, '0')}: ${this.robotSlots[slotIdx].robotId}`, 'info');
    return true;
  },

  addRobotSlot(ip, robotId, sshPort, tunnelMode, sshPassword, robotNumber, template = null, options = {}) {
    const templateConfig = template ? this.ROBOT_TEMPLATES[template] : null;
    this.robotSlots.push({
      ip: ip,
      robotId: robotId,
      sshPort: sshPort || 22,
      tunnelMode: tunnelMode || false,
      sshPassword: sshPassword || '',
      robotNumber: robotNumber || 1,
      tunnelActive: false,
      ros: null,
      connected: false,
      subscriptions: {},
      dataSubscribed: false,
      bms: { voltage: 0, current: 0, soc: 0, charging: false },
      workState: null,
      pose: null,
      mapCorrection: null,
      chargeRelayOn: null,
      chargeRelayReceivedAt: 0
    });

    // Auto-select first slot if none active
    if (this.activeSlotIndex < 0 && options.activateFirst !== false) {
      this.activeSlotIndex = 0;
      this._rememberActiveRobot(this.robotSlots[0]);
      this.updateActiveRobotStatus();
    }

    this.saveRobotSlots();
    if (!options.deferRender) {
      this.renderActiveRobotSelector();
      this.renderRobotManagerList();
      this.renderMonitoringCards();
      this.updateMultiRobotButtons();
    }
    if (!options.silent) {
      this.toast(`로봇 추가됨: ${robotId} (${ip}:${sshPort || 22})`, 'success');
    }
  },

  removeRobotSlot(index) {
    if (index < 0 || index >= this.robotSlots.length) return;

    // Disconnect if connected
    if (this.robotSlots[index].connected) {
      RosManager.disconnectSlot(index);
    }

    const removed = this.robotSlots.splice(index, 1)[0];

    // Adjust active index
    if (this.robotSlots.length === 0) {
      this.activeSlotIndex = -1;
    } else if (this.activeSlotIndex >= this.robotSlots.length) {
      this.activeSlotIndex = this.robotSlots.length - 1;
    } else if (this.activeSlotIndex === index) {
      this.activeSlotIndex = Math.min(index, this.robotSlots.length - 1);
    } else if (this.activeSlotIndex > index) {
      this.activeSlotIndex--;
    }
    if (this.activeSlotIndex >= 0) {
      this._rememberActiveRobot(this.robotSlots[this.activeSlotIndex]);
    }

    this.saveRobotSlots();
    this.renderActiveRobotSelector();
    this.renderRobotManagerList();
    this.renderMonitoringCards();
    this.updateActiveRobotStatus();
    this.updateMultiRobotButtons();
    this.toast(`Robot removed: ${removed.robotId}`, 'info');
  },

  async connectSlot(index) {
    if (index < 0 || index >= this.robotSlots.length) return;
    const slot = this.robotSlots[index];

    // If tunnel mode is enabled, start tunnel first
    if (slot.tunnelMode) {
      try {
        this.toast(`Tunnel connecting: ${slot.ip}...`, 'info');
        const tunnelId = `tunnel-${index}-${slot.robotId}`;
        // B12 fix: 터널은 20초 타임아웃
        const res = await fetchWithTimeout('/api/tunnel/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tunnelId,
            robotIp: slot.ip,
            robotNumber: slot.robotNumber,
            sshPort: slot.sshPort,
            sshUser: 'syscon',
            sshPassword: slot.sshPassword
          })
        }, 20000);
        const result = await res.json();
        if (!result.success) {
          this.toast(`Tunnel connection failed: ${result.message}`, 'error');
          return;
        }
        slot.tunnelActive = true;
        slot.tunnelId = tunnelId;
        this.toast(`Tunnel connected: 127.0.0.${slot.robotNumber}:9090`, 'success');

        // Connect via tunnel IP
        RosManager.connectSlot(index, `127.0.0.${slot.robotNumber}`, slot.robotId);
      } catch (err) {
        this.toast(`Tunnel connection error: ${err.message}`, 'error');
        return;
      }
    } else {
      // Direct connection
      RosManager.connectSlot(index, slot.ip, slot.robotId);
    }
  },

  async disconnectSlot(index) {
    if (index < 0 || index >= this.robotSlots.length) return;
    const slot = this.robotSlots[index];

    // Disconnect ROS first
    RosManager.disconnectSlot(index);

    // If tunnel mode is enabled, stop tunnel
    if (slot.tunnelMode && slot.tunnelActive) {
      try {
        const tunnelId = slot.tunnelId || `tunnel-${index}-${slot.robotId}`;
        // B12 fix: fetch 타임아웃 적용
        await fetchWithTimeout('/api/tunnel/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tunnelId })
        });
        slot.tunnelActive = false;
        this.toast('Tunnel disconnected', 'info');
      } catch (err) {
        console.error('Failed to stop tunnel:', err);
      }
    }
  },

  switchActiveRobot(index) {
    if (index < 0 || index >= this.robotSlots.length) return;
    if (index === this.activeSlotIndex) return;

    const previousIndex = this.activeSlotIndex;
    this.activeSlotIndex = index;
    this._rememberActiveRobot(this.robotSlots[index]);
    this.updateActiveRobotStatus();
    this.renderActiveRobotSelector();

    // Stop all data on the previous slot and subscribe only to the selected slot.
    RosManager.switchActiveSlot(index, previousIndex);

    // Refresh ROS Info for the new active robot
    if (this.robotSlots[index].connected && typeof RosInfo !== 'undefined') {
      RosInfo.refreshAll();
    }

    // Update action target label
    this.updateActionTargetLabel();

    // Update BMS display for the new active slot
    this.refreshActiveBmsDisplay();

    // Update work state display for the new active slot
    this.refreshActiveWorkStateDisplay();

    // Update pose display for the new active slot
    this.refreshActivePoseDisplay();

    // Velocity monitor slot switch
    if (typeof VelMonitor !== 'undefined') VelMonitor.onSlotChange();

    document.dispatchEvent(new CustomEvent('amr:active-robot-changed', {
      detail: {
        index,
        robotId: this.robotSlots[index]?.robotId || null,
        ip: this.robotSlots[index]?.ip || null,
      }
    }));

    this.toast(`활성 로봇 전환: ${this.robotSlots[index].robotId}`, 'info');

    // B4 fix: TestMode.start()에 password 전달 (비밀번호 프롬프트로 받아서 전달)
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      TestMode.stop();
      TestMode._promptPassword().then(password => {
        if (password !== null) TestMode.start(password);
      });
    }
  },

  updateActionTargetLabel() {
    const labelEl = document.getElementById('action-target-robot-label');
    const statusEl = document.getElementById('action-target-status');
    if (this.activeSlotIndex >= 0 && this.activeSlotIndex < this.robotSlots.length) {
      const slot = this.robotSlots[this.activeSlotIndex];
      if (labelEl) labelEl.textContent = `${slot.robotId} (${slot.ip})`;
      if (statusEl) {
        statusEl.textContent = slot.connected ? '연결됨(데이터수신)' : '미연결';
        statusEl.className = 'action-target-status' + (slot.connected ? ' connected' : '');
      }
    } else {
      if (labelEl) labelEl.textContent = '--';
      if (statusEl) {
        statusEl.textContent = '미연결';
        statusEl.className = 'action-target-status';
      }
    }
  },

  refreshActiveBmsDisplay() {
    if (this.activeSlotIndex < 0) return;
    const slot = this.robotSlots[this.activeSlotIndex];
    const bms = slot.bms;
    const gaugeFill = document.getElementById('bms-gauge-fill');
    const gaugeText = document.getElementById('bms-gauge-text');
    const gauge = gaugeFill ? gaugeFill.parentElement : null;

    if (gaugeFill && gaugeText) {
      const percentage = Math.min(100, Math.max(0, bms.soc));
      gaugeFill.style.width = `${percentage}%`;
      gaugeText.textContent = `${percentage.toFixed(0)}%`;
      gaugeFill.classList.remove('low', 'medium');
      if (percentage <= 20) gaugeFill.classList.add('low');
      else if (percentage <= 50) gaugeFill.classList.add('medium');
    }
    if (gauge) {
      if (bms.charging) gauge.classList.add('charging');
      else gauge.classList.remove('charging');
    }
  },

  refreshActiveWorkStateDisplay() {
    if (this.activeSlotIndex < 0) return;
    const slot = this.robotSlots[this.activeSlotIndex];
    RosManager.displayWorkState(slot.workState);
  },

  refreshActivePoseDisplay() {
    if (this.activeSlotIndex < 0) return;
    const slot = this.robotSlots[this.activeSlotIndex];
    if (slot.pose) {
      RosManager.displayPose(slot.pose);
    } else {
      const xEl = document.getElementById('robot-pos-x');
      const yEl = document.getElementById('robot-pos-y');
      const yawEl = document.getElementById('robot-pos-yaw');
      if (xEl) xEl.textContent = '-';
      if (yEl) yEl.textContent = '-';
      if (yawEl) yawEl.textContent = '-';
    }
  },

  // Update active robot connection status in header
  updateActiveRobotStatus() {
    const statusEl = document.getElementById('active-robot-status');
    if (this.activeSlotIndex >= 0 && this.activeSlotIndex < this.robotSlots.length) {
      const slot = this.robotSlots[this.activeSlotIndex];
      if (slot.connected) {
        statusEl.textContent = '연결됨(데이터수신)';
        statusEl.classList.add('connected');
      } else {
        statusEl.textContent = '미연결';
        statusEl.classList.remove('connected');
      }
    } else {
      statusEl.textContent = '미연결';
      statusEl.classList.remove('connected');
    }
    this.updateActionTargetLabel();
  },

  // Render active robot selector dropdown in header
  renderActiveRobotSelector() {
    const select = document.getElementById('active-robot-select');
    select.innerHTML = '';

    if (this.robotSlots.length === 0) {
      select.innerHTML = '<option value="">-- 로봇 없음 --</option>';
      return;
    }

    if (this.activeSlotIndex < 0) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '-- 데이터 수신할 로봇 선택 --';
      placeholder.selected = true;
      select.appendChild(placeholder);
    }

    this.getSortedRobotEntries().forEach(({ slot, index, unitNumber }) => {
      const opt = document.createElement('option');
      opt.value = index;
      const connLabel = slot.connected
        ? (index === this.activeSlotIndex ? '연결됨(데이터수신)' : '연결됨(대기)')
        : (slot.ros ? '연결 중' : '미연결');
      const unitLabel = Number.isFinite(unitNumber) ? String(unitNumber).padStart(3, '0') : '---';
      opt.textContent = `${unitLabel} | ${slot.robotId} (${slot.ip}) - ${connLabel}`;
      if (index === this.activeSlotIndex) opt.selected = true;
      select.appendChild(opt);
    });
  },

  // Render robot manager modal list
  renderRobotManagerList() {
    const tbody = document.getElementById('robot-manager-tbody');
    tbody.innerHTML = '';

    if (this.robotSlots.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#666;">현재 검색된 로봇이 없습니다.</td></tr>';
      return;
    }

    this.getSortedRobotEntries().forEach(({ slot, index, unitNumber }) => {
      const tr = document.createElement('tr');
      const connClass = slot.connected ? 'connected' : 'disconnected';
      const isActive = index === this.activeSlotIndex;
      const connText = slot.connected
        ? (isActive ? '연결됨(데이터수신)' : '연결됨(대기)')
        : (slot.ros ? '연결 중' : '미연결');
      const connDot = slot.connected ? '\u25CF' : '\u25CB';
      const sshPortDisplay = (slot.sshPort && slot.sshPort !== 22) ? slot.sshPort : '<span style="color:#666;">22</span>';
      const unitLabel = Number.isFinite(unitNumber) ? String(unitNumber).padStart(3, '0') : '---';

      // Tunnel mode display
      let tunnelDisplay = '-';
      if (slot.tunnelMode) {
        const tunnelIp = `127.0.0.${slot.robotNumber}`;
        if (slot.tunnelActive) {
          tunnelDisplay = `<span style="color:#4ade80;" title="${tunnelIp}:9090">ON</span>`;
        } else {
          tunnelDisplay = `<span style="color:#666;" title="${tunnelIp}:9090">OFF</span>`;
        }
      }

      // S3 fix: XSS 방지를 위해 사용자 입력값 이스케이프
      tr.innerHTML = `
        <td>${unitLabel}${isActive ? ' <b style="color:#e94560;">*</b>' : ''}</td>
        <td>${_escapeHtml(slot.ip)}</td>
        <td>${_escapeHtml(slot.robotId)}</td>
        <td>${sshPortDisplay}</td>
        <td>${tunnelDisplay}</td>
        <td><span class="rm-status-dot ${connClass}">${connDot}</span>${connText}</td>
        <td>
          ${slot.connected
            ? `<button class="btn btn-small btn-danger" onclick="App.disconnectSlot(${index}); App.renderRobotManagerList();">연결 해제</button>`
            : `<button class="btn btn-small btn-primary" onclick="App.connectSlot(${index}); App.renderRobotManagerList();">연결</button>`
          }
          <button class="btn btn-small" onclick="App.switchActiveRobot(${index}); App.renderRobotManagerList();" ${isActive ? 'disabled' : ''}>활성화</button>
          <button class="btn btn-small btn-danger" onclick="App.removeRobotSlot(${index});">삭제</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Update clone selects
    ['rm-clone-from', 'rm-clone-to'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '<option value="">--</option>';
      this.getSortedRobotEntries().forEach(({ slot, index }) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = `${slot.robotId} (${slot.ip})`;
        sel.appendChild(opt);
      });
    });
  },

  // Render monitoring cards
  renderMonitoringCards() {
    const grid = document.getElementById('monitoring-grid');
    if (!grid) return;

    if (this.robotSlots.length === 0) {
      grid.innerHTML = '<p class="monitoring-empty">현재 연결 가능한 로봇이 없습니다. 로그인 시 자동 검색되며 "로봇 스캔"으로 다시 확인할 수 있습니다.</p>';
      return;
    }

    grid.innerHTML = '';

    this.getSortedRobotEntries().forEach(({ slot, index }) => {
      const card = document.createElement('div');
      card.className = 'monitoring-card' + (index === this.activeSlotIndex ? ' active' : '');

      const connDot = slot.connected ? '\u25CF' : '\u25CB';
      const connClass = slot.connected ? 'connected' : 'disconnected';
      const connText = slot.connected
        ? (index === this.activeSlotIndex ? '연결됨(데이터수신)' : '연결됨(대기)')
        : (slot.ros ? '연결 중' : '미연결');

      // Work state
      let wsText = '--';
      let wsColor = '#9ca3af';
      if (slot.connected && slot.workState !== null && slot.workState !== undefined) {
        const stateStr = String(slot.workState);
        const label = RosManager.WORK_STATE_LABELS[stateStr] || stateStr;
        wsText = `${label} (${stateStr})`;
        wsColor = RosManager._workStateColorMap[stateStr] || '#9ca3af';
      }

      // BMS
      let bmsText = '--%';
      let bmsExtra = '';
      if (slot.connected && slot.bms.soc > 0) {
        bmsText = `${slot.bms.soc.toFixed(0)}%`;
        if (slot.bms.charging) bmsExtra = ' \u26A1';
      }

      // Pose
      let poseText = '--';
      if (slot.connected && slot.pose) {
        poseText = `X:${slot.pose.x.toFixed(2)} Y:${slot.pose.y.toFixed(2)} Yaw:${(slot.pose.yaw * 180 / Math.PI).toFixed(1)}\u00B0`;
      }

      // S3 fix: XSS 방지
      card.innerHTML = `
        <div class="mc-robot-id">${_escapeHtml(slot.robotId)}</div>
        <div class="mc-ip">${_escapeHtml(slot.ip)}</div>
        <div class="mc-status"><span class="mc-dot ${connClass}">${connDot}</span> ${connText}</div>
        <div class="mc-work-state"><span class="mc-ws-bar" style="background-color:${wsColor};"></span> ${wsText}</div>
        <div class="mc-bms">${bmsText}${bmsExtra}</div>
        <div class="mc-pose">${poseText}</div>
      `;

      card.addEventListener('click', () => {
        this.switchActiveRobot(index);
        // Switch to Status tab
        const statusTab = document.querySelector('.tab-btn[data-tab="tab-dashboard"]');
        if (statusTab) statusTab.click();
      });

      grid.appendChild(card);
    });
  },

  // Robot slots are intentionally session-only; remove data written by older versions.
  saveRobotSlots() {
    try { localStorage.removeItem(this.SLOTS_STORAGE_KEY); } catch (e) { /* ignore */ }
  },

  // Get session info for display
  getSessionInfo() {
    return { robotCount: this.robotSlots.length, lastSaved: null };
  },

  restoreRobotSlots() {
    this.saveRobotSlots();
  },

  // Select IP from dropdown (legacy scan dropdown)
  selectRobotIp(ip, robotId) {
    // Auto-add to slots if not already there
    const exists = this.robotSlots.find(s => s.ip === ip);
    if (!exists) {
      this.addRobotSlot(ip, robotId || '');
      this.renderActiveRobotSelector();
    }
  },

  // Scan robots for reachability
  async scanRobots() {
    // Not used in new header, kept for compatibility
  },

  // Load Robots from Server
  async loadRobots() {
    try {
      // B12 fix: fetch 타임아웃 적용
      const res = await fetchWithTimeout('/api/robots');
      this.robots = await res.json();
    } catch (e) {
      console.error('Failed to load robots:', e);
    }
  },

  // Get current connection info (for SSH etc., based on active slot)
  getConnectionInfo() {
    const slot = this.activeSlotIndex >= 0 ? this.robotSlots[this.activeSlotIndex] : null;
    return {
      ip: slot ? slot.ip : '',
      robotId: slot ? slot.robotId : '',
      sshPort: slot ? (slot.sshPort || 22) : 22,
      sshUser: document.getElementById('ssh-user').value.trim() || 'root',
      sshPassword: document.getElementById('ssh-password').value
    };
  },

  // Update SSH connection status
  updateSshStatus(connected) {
    const status = document.getElementById('ssh-status');
    const connectBtn = document.getElementById('btn-ssh-connect');
    const disconnectBtn = document.getElementById('btn-ssh-disconnect');

    if (connected) {
      status.textContent = '연결됨';
      status.classList.add('connected');
      connectBtn.disabled = true;
      disconnectBtn.disabled = false;
    } else {
      status.textContent = '미연결';
      status.classList.remove('connected');
      connectBtn.disabled = false;
      disconnectBtn.disabled = true;
    }
  },

  // Show SSH password modal
  showPasswordModal(message, callback) {
    const modal = document.getElementById('ssh-password-modal');
    const msgEl = document.getElementById('ssh-password-message');
    const passwordInput = document.getElementById('modal-ssh-password');
    const connectBtn = document.getElementById('btn-modal-ssh-connect');
    const cancelBtn = document.getElementById('btn-modal-ssh-cancel');

    msgEl.textContent = message;
    passwordInput.value = '';
    modal.classList.add('show');

    const handleConnect = () => {
      modal.classList.remove('show');
      callback(passwordInput.value);
    };

    const handleCancel = () => {
      modal.classList.remove('show');
    };

    connectBtn.onclick = handleConnect;
    cancelBtn.onclick = handleCancel;
    passwordInput.onkeypress = (e) => {
      if (e.key === 'Enter') handleConnect();
    };

    passwordInput.focus();
  },

  // Generate unique session ID
  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  },

  // Theme Toggle (Day/Night Mode)
  setupThemeToggle() {
    const toggleBtn = document.getElementById('btn-theme-toggle');
    const themeIcon = toggleBtn.querySelector('.theme-icon');
    const themeText = toggleBtn.querySelector('.theme-text');

    // Load saved theme preference
    this.loadThemePreference();

    // Update button appearance based on current mode
    this.updateThemeButton(themeIcon, themeText);

    // Toggle theme on button click
    toggleBtn.addEventListener('click', () => {
      this.isDarkMode = !this.isDarkMode;
      this.applyTheme();
      this.updateThemeButton(themeIcon, themeText);
      this.saveThemePreference();
    });
  },

  loadThemePreference() {
    const savedTheme = localStorage.getItem('amrFieldToolTheme');
    if (savedTheme !== null) {
      this.isDarkMode = savedTheme === 'dark';
    }
    this.applyTheme();
  },

  saveThemePreference() {
    _safeSetItem('amrFieldToolTheme', this.isDarkMode ? 'dark' : 'light');
  },

  applyTheme() {
    if (this.isDarkMode) {
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
    }
  },

  updateThemeButton(iconEl, textEl) {
    if (this.isDarkMode) {
      // Currently dark mode, button shows option to switch to day
      iconEl.textContent = '\u2600\uFE0F';
      textEl.textContent = 'Day';
    } else {
      // Currently light mode, button shows option to switch to night
      iconEl.textContent = '\uD83C\uDF19';
      textEl.textContent = 'Night';
    }
  },

  // Map Controls (Rotation + Zoom)
  setupMapControls() {
    const rotateLeftBtn = document.getElementById('btn-map-rotate-left');
    const rotateRightBtn = document.getElementById('btn-map-rotate-right');
    const rotateResetBtn = document.getElementById('btn-map-rotate-reset');
    const zoomInBtn = document.getElementById('btn-map-zoom-in');
    const zoomOutBtn = document.getElementById('btn-map-zoom-out');
    const zoomResetBtn = document.getElementById('btn-map-zoom-reset');

    if (rotateLeftBtn) {
      rotateLeftBtn.addEventListener('click', () => RosManager.rotateMap(-90));
    }
    if (rotateRightBtn) {
      rotateRightBtn.addEventListener('click', () => RosManager.rotateMap(90));
    }
    if (rotateResetBtn) {
      rotateResetBtn.addEventListener('click', () => RosManager.resetMapRotation());
    }
    const autoAlignBtn = document.getElementById('btn-map-auto-align');
    if (autoAlignBtn) {
      autoAlignBtn.addEventListener('click', () => RosManager.autoAlignMapRotation());
    }
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => RosManager.zoomMap(0.2));
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => RosManager.zoomMap(-0.2));
    }
    if (zoomResetBtn) {
      zoomResetBtn.addEventListener('click', () => RosManager.resetMapZoom());
    }

    // Setup mouse wheel zoom and drag pan
    RosManager.setupMapInteraction();

    // Setup map edit controls
    RosManager.setupMapEditControls();

    // Map panel collapse/expand
    const mapCollapseBtn = document.getElementById('btn-map-panel-collapse');
    const mapExpandBtn = document.getElementById('btn-map-panel-expand');
    const mapPanel = document.getElementById('panel-map');

    function setMapPanelCollapsed(collapsed) {
      if (!mapPanel) return;
      if (collapsed) {
        mapPanel.classList.add('collapsed');
      } else {
        mapPanel.classList.remove('collapsed');
      }
      if (mapCollapseBtn) mapCollapseBtn.textContent = collapsed ? '▶' : '◀';
      if (mapExpandBtn) {
        if (collapsed) {
          mapExpandBtn.classList.remove('hidden');
        } else {
          mapExpandBtn.classList.add('hidden');
        }
      }
      if (!collapsed && RosManager.lastMapMsg) {
        setTimeout(() => RosManager.renderMap(RosManager.lastMapMsg), 250);
      }
    }

    if (mapCollapseBtn) {
      mapCollapseBtn.addEventListener('click', () => {
        setMapPanelCollapsed(!mapPanel.classList.contains('collapsed'));
      });
    }
    if (mapExpandBtn) {
      mapExpandBtn.addEventListener('click', () => {
        setMapPanelCollapsed(false);
      });
    }

    // ResizeObserver to re-render map when panel resizes
    const mapCanvas = document.getElementById('map-canvas');
    if (mapCanvas && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        if (RosManager.lastMapMsg) {
          RosManager.renderMap(RosManager.lastMapMsg);
        }
      }).observe(mapCanvas.parentElement);
    }

    // BMS Detail modal
    const bmsDetailBtn = document.getElementById('btn-bms-detail');
    const bmsModal = document.getElementById('bms-detail-modal');
    const bmsModalClose = document.getElementById('btn-bms-modal-close');

    if (bmsDetailBtn && bmsModal) {
      bmsDetailBtn.addEventListener('click', () => {
        bmsModal.classList.add('show');
      });
    }

    if (bmsModalClose && bmsModal) {
      bmsModalClose.addEventListener('click', () => {
        bmsModal.classList.remove('show');
      });
    }

    // Close modal when clicking outside
    if (bmsModal) {
      bmsModal.addEventListener('click', (e) => {
        if (e.target === bmsModal) {
          bmsModal.classList.remove('show');
        }
      });
    }

    // BMS charge target setting
    const bmsSetTargetBtn = document.getElementById('btn-bms-set-target');
    if (bmsSetTargetBtn) {
      bmsSetTargetBtn.addEventListener('click', () => {
        const input = document.getElementById('bms-charge-target-input');
        const val = parseInt(input.value, 10);
        if (val >= 1 && val <= 100) {
          RosManager._bmsTargetSoc = val;
          App.toast(`Charge target set to ${val}%`, 'success');
        } else {
          App.toast('Enter a value between 1-100', 'error');
        }
      });
    }
  },

  // Monitoring auto-refresh timer
  _monitoringTimer: null,

  startMonitoringRefresh() {
    if (this._monitoringTimer) return;
    this._monitoringTimer = setInterval(() => {
      const monTab = document.getElementById('tab-monitoring');
      if (monTab && monTab.classList.contains('active')) {
        this.renderMonitoringCards();
      }
    }, 2000);
  },

  stopMonitoringRefresh() {
    if (this._monitoringTimer) {
      clearInterval(this._monitoringTimer);
      this._monitoringTimer = null;
    }
  }
};

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  // Start monitoring refresh timer
  App.startMonitoringRefresh();

  // Initialize C2, C3, D1
  ActionHistory.init();
  ConnTimeline.init();
  OpMode.init();
  MissionScheduler.init();

  // Event Log Panel
  App.eventLog = {
    _filter: 'all',
    init() {
      const btnToggle = document.getElementById('btn-event-log');
      const panel = document.getElementById('event-log-panel');
      const btnClose = document.getElementById('btn-event-log-close');
      const btnClear = document.getElementById('btn-event-log-clear');
      const filterSelect = document.getElementById('event-log-filter');

      if (btnToggle && panel) {
        btnToggle.addEventListener('click', () => {
          panel.classList.toggle('hidden');
          if (!panel.classList.contains('hidden')) this.render();
        });
      }
      if (btnClose && panel) {
        btnClose.addEventListener('click', () => panel.classList.add('hidden'));
      }
      if (btnClear) {
        btnClear.addEventListener('click', () => {
          App.saveEventLog([]);
          this.render();
        });
      }
      if (filterSelect) {
        filterSelect.addEventListener('change', () => {
          this._filter = filterSelect.value;
          this.render();
        });
      }
    },
    add(level, message, category) {
      App.addEvent(category || 'system', message, null, level);
      const panel = document.getElementById('event-log-panel');
      if (panel && !panel.classList.contains('hidden')) {
        this.render();
      }
    },
    render() {
      const list = document.getElementById('event-log-list');
      if (!list) return;
      let logs = App.getEventLog();
      if (this._filter !== 'all') {
        logs = logs.filter(e => e.level === this._filter);
      }
      list.innerHTML = logs.slice(0, 100).map(e => {
        const d = new Date(e.at);
        const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
        return `<div class="event-log-item">
          <span class="event-log-time">${time}</span>
          <span class="event-log-level ${e.level || 'info'}"></span>
          <span class="event-log-msg">${e.title || ''}</span>
        </div>`;
      }).join('');
      if (logs.length === 0) {
        list.innerHTML = '<div style="color:#666;padding:12px;font-size:12px;">No events</div>';
      }
    }
  };
  App.eventLog.init();

  // BMS trend metric selector
  const bmsTrendMetric = document.getElementById('bms-trend-metric');
  if (bmsTrendMetric) {
    bmsTrendMetric.addEventListener('change', () => {
      RosManager._renderBmsTrend();
    });
  }

  // Alarm system
  App.alarmSystem = {
    STORAGE_KEY: 'alarmSettings',
    _lastTopicTime: { bms: Date.now(), workstate: Date.now(), pose: Date.now() },
    _alarmActive: false,

    getSettings() {
      try {
        return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || this.defaults();
      } catch (e) { return this.defaults(); }
    },

    defaults() {
      return { bmsLowEn: true, bmsLowVal: 20, wsErrorEn: true, wsErrorVals: '99,100', topicDropEn: true, topicDropSec: 10, soundEn: false };
    },

    saveSettings(s) {
      _safeSetItem(this.STORAGE_KEY, JSON.stringify(s));
    },

    loadToUI() {
      const s = this.getSettings();
      document.getElementById('alarm-bms-low-en').checked = s.bmsLowEn;
      document.getElementById('alarm-bms-low-val').value = s.bmsLowVal;
      document.getElementById('alarm-ws-error-en').checked = s.wsErrorEn;
      document.getElementById('alarm-ws-error-vals').value = s.wsErrorVals;
      document.getElementById('alarm-topic-drop-en').checked = s.topicDropEn;
      document.getElementById('alarm-topic-drop-sec').value = s.topicDropSec;
      document.getElementById('alarm-sound-en').checked = s.soundEn;
    },

    saveFromUI() {
      const s = {
        bmsLowEn: document.getElementById('alarm-bms-low-en').checked,
        bmsLowVal: parseInt(document.getElementById('alarm-bms-low-val').value) || 20,
        wsErrorEn: document.getElementById('alarm-ws-error-en').checked,
        wsErrorVals: document.getElementById('alarm-ws-error-vals').value,
        topicDropEn: document.getElementById('alarm-topic-drop-en').checked,
        topicDropSec: parseInt(document.getElementById('alarm-topic-drop-sec').value) || 5,
        soundEn: document.getElementById('alarm-sound-en').checked,
      };
      this.saveSettings(s);
      App.toast('Alarm settings saved', 'success');
    },

    init() {
      const btn = document.getElementById('btn-alarm-settings');
      const modal = document.getElementById('alarm-settings-modal');
      const saveBtn = document.getElementById('btn-alarm-save');
      const closeBtn = document.getElementById('btn-alarm-close');
      if (btn) btn.addEventListener('click', () => { this.loadToUI(); modal.classList.add('active'); });
      if (saveBtn) saveBtn.addEventListener('click', () => { this.saveFromUI(); modal.classList.remove('active'); });
      if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.remove('active'));
      if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      // Error Code DB modal
      const errBtn = document.getElementById('btn-error-codes');
      const errModal = document.getElementById('error-code-modal');
      const errClose = document.getElementById('btn-error-code-close');
      if (errBtn && errModal) {
        errBtn.addEventListener('click', () => {
          errModal.classList.add('active');
          if (typeof ErrorCodeDB !== 'undefined') ErrorCodeDB.renderCodes();
        });
      }
      if (errClose && errModal) {
        errClose.addEventListener('click', () => errModal.classList.remove('active'));
      }
      if (errModal) {
        errModal.addEventListener('click', (e) => { if (e.target === errModal) errModal.classList.remove('active'); });
      }

      // Audit Trail modal
      const auditBtn = document.getElementById('btn-audit-trail');
      const auditModal = document.getElementById('audit-trail-modal');
      const auditClose = document.getElementById('btn-audit-close');
      const auditExport = document.getElementById('btn-export-audit');
      const auditClear = document.getElementById('btn-clear-audit');
      const auditSearch = document.getElementById('audit-search');
      const auditFilter = document.getElementById('audit-filter');

      if (auditBtn && auditModal) {
        auditBtn.addEventListener('click', () => {
          auditModal.classList.add('active');
          App.renderAuditTrail();
        });
      }
      if (auditClose && auditModal) {
        auditClose.addEventListener('click', () => auditModal.classList.remove('active'));
      }
      if (auditModal) {
        auditModal.addEventListener('click', (e) => { if (e.target === auditModal) auditModal.classList.remove('active'); });
      }
      if (auditExport) {
        auditExport.addEventListener('click', () => App.exportAuditLog());
      }
      if (auditClear) {
        auditClear.addEventListener('click', () => {
          if (confirm('Clear all audit logs?')) {
            localStorage.removeItem(App.AUDIT_LOG_KEY);
            App.renderAuditTrail();
            App.toast('Audit log cleared', 'success');
          }
        });
      }
      if (auditSearch) {
        auditSearch.addEventListener('input', () => App.renderAuditTrail());
      }
      if (auditFilter) {
        auditFilter.addEventListener('change', () => App.renderAuditTrail());
      }

      // Check alarms every 2 seconds
      setInterval(() => this.check(), 2000);
    },

    recordTopicActivity(topic) {
      if (this._lastTopicTime[topic] !== undefined) {
        this._lastTopicTime[topic] = Date.now();
      }
    },

    resetTopicTimes() {
      const now = Date.now();
      this._lastTopicTime = { bms: now, workstate: now, pose: now };
    },

    _playBeep() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880; gain.gain.value = 0.3;
        osc.start(); osc.stop(ctx.currentTime + 0.15);
      } catch (e) {}
    },

    _fireAlarm(msg, type) {
      App.toast(msg, 'error');
      if (App.eventLog) App.eventLog.add('error', msg, 'alarm');
      const s = this.getSettings();
      if (s.soundEn) this._playBeep();
      // Flash header
      const header = document.querySelector('.header');
      if (header) {
        header.classList.add('alarm-flash');
        setTimeout(() => header.classList.remove('alarm-flash'), 1500);
      }
    },

    check() {
      const slot = App.robotSlots[App.activeSlotIndex];
      if (!slot || !slot.connected) return;
      const s = this.getSettings();

      // BMS low check
      if (s.bmsLowEn && slot.bms && slot.bms.soc > 0 && slot.bms.soc <= s.bmsLowVal && !slot.bms.charging) {
        this._fireAlarm(`BMS SOC ${slot.bms.soc.toFixed(0)}% <= ${s.bmsLowVal}% (${slot.robotId})`);
      }

      // Work State error
      if (s.wsErrorEn && slot.workState !== null) {
        const errorVals = s.wsErrorVals.split(',').map(v => v.trim());
        if (errorVals.includes(String(slot.workState))) {
          this._fireAlarm(`Work State error: ${slot.workState} (${slot.robotId})`);
        }
      }

      // Topic drop check (skip during test mode startup or when test mode not yet publishing)
      // Also skip grace period after initial connection (wait for first data to arrive)
      if (s.topicDropEn && !(typeof TestMode !== 'undefined' && (TestMode._starting || (slot.ip === '127.0.0.1' && !TestMode.enabled)))) {
        const now = Date.now();
        const threshold = s.topicDropSec * 1000;
        const gracePeriod = threshold + 5000; // extra 5s after connection before checking drops
        if (slot.connectedAt && (now - slot.connectedAt) > gracePeriod) {
          ['bms', 'workstate'].forEach(k => {
            if (now - this._lastTopicTime[k] > threshold) {
              this._fireAlarm(`Topic dropped: ${k} (${s.topicDropSec}s no response, ${slot.robotId})`);
            }
          });
        }
      }
    }
  };
  App.alarmSystem.init();

  // Setup Checklist
  App.setupChecklist = {
    checks: [
      { id: 'ros-conn', label: 'ROS Bridge Connection', test() { const s = App.robotSlots[App.activeSlotIndex]; return s && s.connected ? 'ok' : 'fail'; }},
      { id: 'bms', label: 'BMS Topic Reception', test() { return RosManager._hzValues.bms > 0 ? 'ok' : (RosManager._hzValues.bms === 0 && App.robotSlots[App.activeSlotIndex]?.connected ? 'warn' : 'fail'); }},
      { id: 'pose', label: 'Pose Topic Reception', test() { return RosManager._hzValues.pose > 0 ? 'ok' : (App.robotSlots[App.activeSlotIndex]?.connected ? 'warn' : 'fail'); }},
      { id: 'workstate', label: 'Work State Reception', test() { return RosManager._hzValues.workstate > 0 ? 'ok' : (App.robotSlots[App.activeSlotIndex]?.connected ? 'warn' : 'fail'); }},
      { id: 'map', label: 'Map Data Reception', test() { return RosManager.lastMapMsg ? 'ok' : 'fail'; }},
      { id: 'lidar', label: 'LiDAR Topic Reception', test() { return RosManager._hzValues.lidar > 0 ? 'ok' : (App.robotSlots[App.activeSlotIndex]?.connected ? 'warn' : 'fail'); }},
      { id: 'pose-data', label: 'Robot Pose Valid', test() { return RosManager.robotPose ? 'ok' : 'fail'; }},
    ],

    run() {
      const container = document.getElementById('checklist-items');
      const summary = document.getElementById('checklist-summary');
      if (!container) return;
      let ok = 0, fail = 0, warn = 0;
      container.innerHTML = '';
      this.checks.forEach(c => {
        const result = c.test();
        if (result === 'ok') ok++;
        else if (result === 'warn') warn++;
        else fail++;
        const icon = result === 'ok' ? '●' : result === 'warn' ? '▲' : '○';
        const div = document.createElement('div');
        div.className = `checklist-item cl-${result}`;
        div.innerHTML = `<span class="cl-icon">${icon}</span><span class="cl-label">${c.label}</span><span class="cl-result">${result.toUpperCase()}</span>`;
        container.appendChild(div);
      });
      if (summary) summary.textContent = `Pass: ${ok} / Warn: ${warn} / Fail: ${fail}`;
      return { ok, warn, fail, total: this.checks.length };
    }
  };
  const clBtn = document.getElementById('btn-run-checklist');
  if (clBtn) clBtn.addEventListener('click', () => App.setupChecklist.run());

  // Integration Test
  App.integTest = {
    _results: [],
    _running: false,

    tests: [
      { name: 'ROS 연결', async run() { const s = App.robotSlots[App.activeSlotIndex]; return s?.connected ? { pass: true, detail: `연결됨 (${s.ip})` } : { pass: false, detail: '미연결' }; }},
      { name: 'BMS Reception', async run() { return new Promise(r => { const start = RosManager._hzCounters.bms; setTimeout(() => { r(RosManager._hzCounters.bms > start ? { pass: true, detail: `${RosManager._hzValues.bms} Hz` } : { pass: false, detail: 'No reception' }); }, 2000); }); }},
      { name: 'Work State Reception', async run() { return new Promise(r => { const start = RosManager._hzCounters.workstate; setTimeout(() => { r(RosManager._hzCounters.workstate > start ? { pass: true, detail: `${RosManager._hzValues.workstate} Hz` } : { pass: false, detail: 'No reception' }); }, 2000); }); }},
      { name: 'Pose Reception', async run() { return new Promise(r => { const start = RosManager._hzCounters.pose; setTimeout(() => { r(RosManager._hzCounters.pose > start ? { pass: true, detail: `${RosManager._hzValues.pose} Hz` } : { pass: false, detail: 'No reception' }); }, 2000); }); }},
      { name: 'Map Data', async run() { if (!RosManager.lastMapMsg) return { pass: false, detail: 'No map received' }; const info = RosManager.lastMapMsg.info; return { pass: true, detail: `${info.width}x${info.height}, ${info.resolution}m/px` }; }},
      { name: 'LiDAR Reception', async run() { return new Promise(r => { const start = RosManager._hzCounters.lidar; setTimeout(() => { r(RosManager._hzCounters.lidar > start ? { pass: true, detail: `${RosManager._hzValues.lidar} Hz` } : { pass: false, detail: 'No reception' }); }, 2000); }); }},
      { name: 'Robot Pose Valid', async run() { const p = RosManager.robotPose; return p ? { pass: true, detail: `X:${p.x.toFixed(2)} Y:${p.y.toFixed(2)}` } : { pass: false, detail: 'No pose' }; }},
      { name: 'BMS SOC Normal Range', async run() { const s = App.robotSlots[App.activeSlotIndex]; if (!s?.bms?.soc) return { pass: false, detail: 'No BMS' }; const soc = s.bms.soc; return soc > 10 && soc <= 100 ? { pass: true, detail: `SOC: ${soc.toFixed(0)}%` } : { pass: false, detail: `SOC: ${soc.toFixed(0)}% (abnormal)` }; }},
    ],

    async run() {
      if (this._running) return;
      this._running = true;
      this._results = [];
      const resultsEl = document.getElementById('integ-test-results');
      const progressEl = document.getElementById('integ-test-progress');
      const barFill = document.getElementById('integ-test-bar-fill');
      const stepEl = document.getElementById('integ-test-step');
      const statusEl = document.getElementById('integ-test-status');
      const reportBtn = document.getElementById('btn-integ-report');
      resultsEl.innerHTML = '';
      progressEl.style.display = 'flex';
      reportBtn.style.display = 'none';
      statusEl.textContent = 'Running...';
      const startTime = Date.now();

      for (let i = 0; i < this.tests.length; i++) {
        const t = this.tests[i];
        stepEl.textContent = `${i + 1}/${this.tests.length}: ${t.name}`;
        barFill.style.width = `${((i) / this.tests.length) * 100}%`;
        let result;
        try { result = await t.run(); } catch (e) { result = { pass: false, detail: e.message }; }
        this._results.push({ name: t.name, ...result });
        const div = document.createElement('div');
        div.className = `integ-result-item ${result.pass ? 'pass' : 'fail'}`;
        div.innerHTML = `<span class="ir-icon">${result.pass ? '✓' : '✗'}</span><span class="ir-name">${t.name}</span><span class="ir-detail">${result.detail}</span>`;
        resultsEl.appendChild(div);
      }
      barFill.style.width = '100%';
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const passed = this._results.filter(r => r.pass).length;
      stepEl.textContent = `Complete (${elapsed}s)`;
      statusEl.textContent = `${passed}/${this._results.length} passed`;
      reportBtn.style.display = 'inline-block';
      this._elapsed = elapsed;
      this._running = false;
    },

    downloadReport() {
      const slot = App.robotSlots[App.activeSlotIndex];
      const rid = slot ? slot.robotId : '--';
      const ip = slot ? slot.ip : '--';
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const passed = this._results.filter(r => r.pass).length;
      const rows = this._results.map(r =>
        `<tr><td>${r.pass ? '<span style="color:#22c55e">PASS</span>' : '<span style="color:#ef4444">FAIL</span>'}</td><td>${r.name}</td><td>${r.detail}</td></tr>`
      ).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AMR Integration Test Report</title>
<style>body{font-family:sans-serif;padding:20px;max-width:700px;margin:auto}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px 12px;border:1px solid #ddd;text-align:left}th{background:#f1f5f9}.header{margin-bottom:20px}.summary{font-size:18px;font-weight:bold;margin:10px 0}</style>
</head><body><div class="header"><h1>AMR Integration Test Report</h1>
<p>Robot: <b>${rid}</b> (${ip})</p><p>Date: <b>${new Date().toLocaleString()}</b></p><p>Duration: <b>${this._elapsed}s</b></p>
<p class="summary">Result: ${passed}/${this._results.length} PASS</p></div>
<table><thead><tr><th>Status</th><th>Test</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>
<p style="margin-top:20px;color:#999;font-size:12px">Generated by EasyLoop</p></body></html>`;
      const blob = new Blob([html], { type: 'text/html' });
      const link = document.createElement('a');
      link.download = `integ-test_${rid}_${ts}.html`;
      link.href = URL.createObjectURL(blob);
      link.click();
      App.toast('Report saved', 'success');
    }
  };
  document.getElementById('btn-integ-test').addEventListener('click', () => App.integTest.run());
  document.getElementById('btn-integ-report').addEventListener('click', () => App.integTest.downloadReport());

  // Widget config
  App.widgetConfig = {
    STORAGE_KEY: 'widgetConfig',
    getSettings() {
      try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {}; }
      catch (e) { return {}; }
    },
    save(settings) { _safeSetItem(this.STORAGE_KEY, JSON.stringify(settings)); },
    apply() {
      const s = this.getSettings();
      document.querySelectorAll('[data-widget]').forEach(el => {
        const wid = el.dataset.widget;
        if (s[wid] === false) el.style.display = 'none';
        else el.style.display = '';
      });
    },
    init() {
      const btn = document.getElementById('btn-widget-config');
      const panel = document.getElementById('widget-config-panel');
      const saveBtn = document.getElementById('btn-widget-config-save');
      if (btn && panel) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          panel.classList.toggle('hidden');
          // Load current settings to checkboxes
          const s = this.getSettings();
          panel.querySelectorAll('input[data-wid]').forEach(cb => {
            cb.checked = s[cb.dataset.wid] !== false;
          });
        });
      }
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const s = {};
          panel.querySelectorAll('input[data-wid]').forEach(cb => { s[cb.dataset.wid] = cb.checked; });
          this.save(s);
          this.apply();
          panel.classList.add('hidden');
          App.toast('Widget settings saved', 'success');
        });
      }
      // Close panel on outside click
      document.addEventListener('click', (e) => {
        if (panel && !panel.contains(e.target) && e.target.id !== 'btn-widget-config') {
          panel.classList.add('hidden');
        }
      });
      this.apply();
    }
  };
  App.widgetConfig.init();

  // Session export/import - Config Backup
  const SESSION_KEYS = [
    'actionFavorites', 'paramPresets', 'actionSenderSavedQueues',
    'actionSenderLastParams', 'jogQuickTasks', 'alarmSettings', 'widgetConfig', 'workStateColorConfig',
    'amrTheme', 'lastConnectionIp', 'lastConnectionRobotId',
    // Additional config backup keys
    'amrFieldToolTheme', 'amrDarkMap', 'amrFontSize', 'amrTouchMode', 'amrActiveTab',
    'amrSmartAlarmRules', 'amrErrorCodesCustom', 'amrQuickNotes', 'amrCommandSnippets',
    'amrCommandHistory', 'amrRosFavorites'
  ];

  document.getElementById('btn-session-export').addEventListener('click', () => {
    const data = {};
    SESSION_KEYS.forEach(k => {
      const val = localStorage.getItem(k);
      if (val !== null) data[k] = val;
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const link = document.createElement('a');
    link.download = `amr-session_${ts}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    App.toast('Session exported', 'success');
  });

  const importFileInput = document.getElementById('session-import-file');
  document.getElementById('btn-session-import').addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        let count = 0;
        Object.keys(data).forEach(k => {
          if (SESSION_KEYS.includes(k)) {
            _safeSetItem(k, data[k]);
            count++;
          }
        });
        App.toast(`Session imported (${count} items). Refresh required.`, 'success');
      } catch (err) {
        App.toast('Session file parse error', 'error');
      }
    };
    reader.readAsText(file);
    importFileInput.value = '';
  });

  // Keyboard shortcuts
  const shortcutsOverlay = document.getElementById('shortcuts-overlay');
  const shortcutsCloseBtn = document.getElementById('btn-shortcuts-close');
  if (shortcutsCloseBtn) shortcutsCloseBtn.addEventListener('click', () => shortcutsOverlay.classList.add('hidden'));

  document.addEventListener('keydown', (e) => {
    // Ignore when typing in inputs (unless Ctrl/Meta combos)
    const tag = e.target.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (isInput && !e.ctrlKey && !e.metaKey) return;

    const key = e.key;

    // Ctrl+Z = Undo
    if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (typeof ActionSender !== 'undefined' && ActionSender.undo) ActionSender.undo();
      return;
    }

    // Ctrl+Y or Ctrl+Shift+Z = Redo
    if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      if (typeof ActionSender !== 'undefined' && ActionSender.redo) ActionSender.redo();
      return;
    }

    // Ctrl+K = Search/Focus (search ROS info)
    if ((e.ctrlKey || e.metaKey) && key === 'k') {
      e.preventDefault();
      // Switch to ROS tab and focus search
      const rosTab = document.querySelector('.tab-btn[data-tab="tab-ros"]');
      if (rosTab) rosTab.click();
      setTimeout(() => {
        const searchInput = document.getElementById('ros-topics-search');
        if (searchInput) searchInput.focus();
      }, 100);
      return;
    }

    // Ctrl+M = Toggle map panel
    if ((e.ctrlKey || e.metaKey) && key === 'm') {
      e.preventDefault();
      const mapPanel = document.getElementById('panel-map');
      const mapCollapseBtn = document.getElementById('btn-map-panel-collapse');
      if (mapPanel && mapCollapseBtn) mapCollapseBtn.click();
      return;
    }

    if (isInput) return;

    // ? = show shortcuts help
    if (key === '?' || (e.shiftKey && key === '/')) {
      e.preventDefault();
      shortcutsOverlay.classList.toggle('hidden');
      return;
    }

    // Escape = close modals/overlays/floating panels
    if (key === 'Escape') {
      document.querySelectorAll('.modal.show, .modal.active').forEach(m => { m.classList.remove('show'); m.classList.remove('active'); });
      if (shortcutsOverlay) shortcutsOverlay.classList.add('hidden');
      const jogPanel = document.getElementById('jog-panel');
      if (jogPanel && jogPanel.style.display !== 'none') {
        jogPanel.style.display = 'none';
        const jogBtn = document.getElementById('btn-jog-toggle');
        if (jogBtn) jogBtn.classList.remove('active');
      }
      const cmdPanel = document.getElementById('cmd-panel');
      if (cmdPanel && cmdPanel.style.display !== 'none') {
        cmdPanel.style.display = 'none';
        const cmdBtn = document.getElementById('btn-cmd-toggle');
        if (cmdBtn) cmdBtn.classList.remove('active');
      }
      if (typeof MapContextMenu !== 'undefined') MapContextMenu.hide();
      return;
    }

    // F = toggle fullscreen
    if (key === 'f' || key === 'F') {
      e.preventDefault();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
      return;
    }

    // G = Nav Goal mode
    if (key === 'g' || key === 'G') {
      e.preventDefault();
      const navBtn = document.getElementById('btn-nav-goal-mode');
      if (navBtn) navBtn.click();
      return;
    }

    // P = Set Pose mode
    if (key === 'p' || key === 'P') {
      e.preventDefault();
      const poseBtn = document.getElementById('btn-set-pose-mode');
      if (poseBtn) poseBtn.click();
      return;
    }

    // Number input = switch by robot unit number (e.g. 1 => R_001, 10 => R_010, 101 => R_101)
    if (/^\d$/.test(key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      App.queueUnitSwitchDigit(key);
      return;
    }

    // Backspace = delete last buffered unit digit
    if (key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (App.backspaceUnitSwitchBuffer()) {
        e.preventDefault();
        return;
      }
    }

    // Enter = confirm buffered unit number selection
    if (key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && App._unitSwitchBuffer) {
      e.preventDefault();
      App.commitUnitSwitchBuffer();
      return;
    }

    // Ctrl+1~9 = tab switch (visible tabs only)
    if (key >= '1' && key <= '9' && (e.ctrlKey || e.metaKey)) {
      const tabBtns = Array.from(document.querySelectorAll('.tab-btn')).filter(b => b.offsetParent !== null);
      const idx = parseInt(key) - 1;
      if (idx < tabBtns.length) {
        e.preventDefault();
        tabBtns[idx].click();
      }
      return;
    }

    // J = toggle Jog panel
    if ((key === 'j' || key === 'J') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const jogBtn = document.getElementById('btn-jog-toggle');
      if (jogBtn) jogBtn.click();
      return;
    }

    // +/= = increase linear speed, - = decrease linear speed
    if ((key === '+' || key === '=') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const slider = document.getElementById('jog-linear-speed');
      if (slider) {
        slider.value = Math.min(parseFloat(slider.max), parseFloat(slider.value) + parseFloat(slider.step));
        slider.dispatchEvent(new Event('input'));
        App.toast(`Linear: ${parseFloat(slider.value).toFixed(2)} m/s`, 'info');
      }
      return;
    }
    if (key === '-' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const slider = document.getElementById('jog-linear-speed');
      if (slider) {
        slider.value = Math.max(parseFloat(slider.min), parseFloat(slider.value) - parseFloat(slider.step));
        slider.dispatchEvent(new Event('input'));
        App.toast(`Linear: ${parseFloat(slider.value).toFixed(2)} m/s`, 'info');
      }
      return;
    }

    // Ctrl + +/= = increase angular speed, Ctrl + - = decrease angular speed
    if ((key === '+' || key === '=') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const slider = document.getElementById('jog-angular-speed');
      if (slider) {
        slider.value = Math.min(parseFloat(slider.max), parseFloat(slider.value) + parseFloat(slider.step));
        slider.dispatchEvent(new Event('input'));
        App.toast(`Angular: ${parseFloat(slider.value).toFixed(2)} rad/s`, 'info');
      }
      return;
    }
    if (key === '-' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const slider = document.getElementById('jog-angular-speed');
      if (slider) {
        slider.value = Math.max(parseFloat(slider.min), parseFloat(slider.value) - parseFloat(slider.step));
        slider.dispatchEvent(new Event('input'));
        App.toast(`Angular: ${parseFloat(slider.value).toFixed(2)} rad/s`, 'info');
      }
      return;
    }

    // Space = emergency stop
    if (key === ' ') {
      e.preventDefault();
      const stopBtn = document.getElementById('btn-jog-stop');
      if (stopBtn) stopBtn.click();
      App.toast('Emergency stop', 'error');
      return;
    }

    // Enter = send action (when on action tab)
    if (key === 'Enter') {
      const actionTab = document.getElementById('tab-action');
      if (actionTab && !actionTab.classList.contains('hidden') && actionTab.classList.contains('active')) {
        const sendBtn = document.getElementById('btn-action-send');
        if (sendBtn) sendBtn.click();
      }
      return;
    }

    // WASD + QE = Jog control
    const jogKeys = { 'w': 'forward', 'a': 'left', 's': 'backward', 'd': 'right', 'q': 'rotate-left', 'e': 'rotate-right' };
    if (jogKeys[key.toLowerCase()]) {
      e.preventDefault();
      const dir = jogKeys[key.toLowerCase()];
      if (typeof JogControl !== 'undefined' && JogControl._publishOnce) {
        const mapping = {
          'forward': { linear: 0.3, angular: 0 },
          'backward': { linear: -0.3, angular: 0 },
          'left': { linear: 0, angular: 0.5 },
          'right': { linear: 0, angular: -0.5 },
          'rotate-left': { linear: 0, angular: 0.8 },
          'rotate-right': { linear: 0, angular: -0.8 },
        };
        const m = mapping[dir];
        if (m) JogControl._publishOnce(m.linear, m.angular);
      }
      return;
    }
  });

  // ============ Initialize New UX Components ============

  // I18n - initialize with saved preference or default to English
  if (typeof I18n !== 'undefined') {
    I18n.init();
  }

  // Floating Widget - BMS/WorkState
  const floatingWidget = document.getElementById('floating-widget');
  if (floatingWidget) {
    let fwDragging = false, fwOffX = 0, fwOffY = 0;
    const fwHeader = floatingWidget.querySelector('.fw-header');
    const fwClose = floatingWidget.querySelector('.fw-close');
    if (fwHeader) {
      fwHeader.addEventListener('mousedown', (e) => {
        fwDragging = true;
        fwOffX = e.clientX - floatingWidget.offsetLeft;
        fwOffY = e.clientY - floatingWidget.offsetTop;
        e.preventDefault();
      });
    }
    document.addEventListener('mousemove', (e) => {
      if (!fwDragging) return;
      floatingWidget.style.left = (e.clientX - fwOffX) + 'px';
      floatingWidget.style.top = (e.clientY - fwOffY) + 'px';
      floatingWidget.style.right = 'auto';
      floatingWidget.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { fwDragging = false; });
    if (fwClose) fwClose.addEventListener('click', () => floatingWidget.classList.add('hidden'));

    // Update floating widget data periodically
    setInterval(() => {
      const bmsEl = document.getElementById('fw-bms-value');
      const wsEl = document.getElementById('fw-work-state');
      const srcBms = document.getElementById('bms-soc');
      const srcWs = document.getElementById('work-state-value');
      if (bmsEl && srcBms) bmsEl.textContent = srcBms.textContent;
      if (wsEl && srcWs) wsEl.textContent = srcWs.textContent;
    }, 2000);
  }

  // Map Context Menu
  if (typeof MapContextMenu !== 'undefined') {
    MapContextMenu.init();
  }

  // Split View toggle
  const splitViewSelect = document.getElementById('split-view-select');
  if (splitViewSelect) {
    splitViewSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      const mainContent = document.querySelector('.main-content');
      if (!mainContent) return;
      mainContent.classList.remove('split-horizontal', 'split-vertical');
      if (mode === 'horizontal') mainContent.classList.add('split-horizontal');
      else if (mode === 'vertical') mainContent.classList.add('split-vertical');
      _safeSetItem('amrSplitView', mode);
    });
  }

  // Breadcrumb trail checkbox sync
  const breadcrumbChk = document.getElementById('chk-breadcrumb');
  if (breadcrumbChk) {
    breadcrumbChk.checked = localStorage.getItem('amrBreadcrumb') === 'true';
    breadcrumbChk.addEventListener('change', () => {
      _safeSetItem('amrBreadcrumb', breadcrumbChk.checked);
      if (RosManager.lastMapMsg) RosManager.renderMap(RosManager.lastMapMsg);
    });
  }

  // "More (···)" dropdown toggle
  const btnMore = document.getElementById('btn-hdr-more');
  const moreMenu = document.getElementById('hdr-more-menu');
  if (btnMore && moreMenu) {
    btnMore.addEventListener('click', (e) => {
      e.stopPropagation();
      moreMenu.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!moreMenu.contains(e.target) && e.target !== btnMore) {
        moreMenu.classList.remove('open');
      }
    });
    moreMenu.querySelectorAll('.hdr-menu-item').forEach(item => {
      item.addEventListener('click', () => moreMenu.classList.remove('open'));
    });
  }
});

// ============ C2: Action History + Re-execute ============
const ActionHistory = {
  STORAGE_KEY: 'actionHistory',
  MAX: 50,

  init() {
    this.render();
    const clearBtn = document.getElementById('btn-clear-action-history');
    if (clearBtn) clearBtn.addEventListener('click', () => { this.clear(); });
  },

  getAll() {
    try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || []; }
    catch (e) { return []; }
  },

  saveAll(list) {
    _safeSetItem(this.STORAGE_KEY, JSON.stringify(list));
  },

  record(actionData) {
    const list = this.getAll();
    list.unshift({
      ...actionData,
      sentAt: Date.now()
    });
    if (list.length > this.MAX) list.length = this.MAX;
    this.saveAll(list);
    this.render();
  },

  reExecute(index) {
    const list = this.getAll();
    const entry = list[index];
    if (!entry) return;

    // Restore to form
    const typeSelect = document.getElementById('action-type');
    if (typeSelect) {
      typeSelect.value = entry.actionType;
      ActionSender.updateActionForm(entry.actionType);

      // Restore args
      const config = ActionSender.actionTypes[entry.actionType];
      if (config && entry.args) {
        config.args.forEach((a, i) => {
          const el = document.getElementById(`action-arg-${i}`);
          if (el && entry.args[i] !== undefined) el.value = entry.args[i];
        });
      }
      // Restore params
      if (config && entry.params) {
        entry.params.forEach((p, i) => {
          const el = document.getElementById(`action-param-${i}`);
          if (el) el.value = p.value;
        });
      }
    }
    App.toast('Previous action restored — send via Send Goal', 'info');
  },

  clear() {
    this.saveAll([]);
    this.render();
  },

  render() {
    const listEl = document.getElementById('action-history-list');
    if (!listEl) return;
    const list = this.getAll();

    if (list.length === 0) {
      listEl.innerHTML = '<span class="action-history-empty">No history yet</span>';
      return;
    }

    listEl.innerHTML = list.map((entry, i) => {
      const config = ActionSender.actionTypes[entry.actionType];
      const name = config ? config.name : entry.actionType;
      const time = new Date(entry.sentAt).toLocaleTimeString();
      const argStr = entry.args ? entry.args.map(a => typeof a === 'number' ? a.toFixed(1) : a).join(', ') : '';
      return `<div class="action-history-item">
        <span class="action-history-time">${time}</span>
        <span class="action-history-name">${name}</span>
        <span class="action-history-args">(${argStr})</span>
        <button class="btn-mini action-history-replay" data-hist-idx="${i}" title="Re-execute">&#8635;</button>
      </div>`;
    }).join('');

    listEl.querySelectorAll('[data-hist-idx]').forEach(btn => {
      btn.addEventListener('click', () => this.reExecute(parseInt(btn.dataset.histIdx)));
    });
  }
};

// ============ C3: Connection Timeline ============
const ConnTimeline = {
  STORAGE_KEY: 'connTimeline',
  MAX: 100,

  init() {
    this.render();
    const clearBtn = document.getElementById('btn-clear-conn-timeline');
    if (clearBtn) clearBtn.addEventListener('click', () => { this.clear(); });
  },

  getAll() {
    try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || []; }
    catch (e) { return []; }
  },

  saveAll(list) {
    _safeSetItem(this.STORAGE_KEY, JSON.stringify(list));
  },

  record(robotId, ip, event, detail) {
    const list = this.getAll();
    list.unshift({ robotId, ip, event, detail, at: Date.now() });
    if (list.length > this.MAX) list.length = this.MAX;
    this.saveAll(list);
    this.render();
  },

  clear() {
    this.saveAll([]);
    this.render();
  },

  render() {
    const listEl = document.getElementById('conn-timeline-list');
    if (!listEl) return;
    const list = this.getAll();

    if (list.length === 0) {
      listEl.innerHTML = '<span class="conn-timeline-empty">No events</span>';
      return;
    }

    listEl.innerHTML = list.slice(0, 30).map(entry => {
      const time = new Date(entry.at).toLocaleTimeString();
      const cls = entry.event === 'connected' ? 'conn-evt-ok' :
                  entry.event === 'disconnected' ? 'conn-evt-err' :
                  entry.event === 'error' ? 'conn-evt-err' : 'conn-evt-info';
      return `<div class="conn-timeline-item ${cls}">
        <span class="conn-timeline-time">${time}</span>
        <span class="conn-timeline-robot">${entry.robotId || '--'}</span>
        <span class="conn-timeline-event">${entry.event}</span>
        <span class="conn-timeline-detail">${entry.detail || ''}</span>
      </div>`;
    }).join('');
  }
};

// ============ Operation Mode (Auto/Manual) ============
const OpMode = {
  MODE_KEY: 'opMode',
  _mode: 'manual', // 'manual' | 'auto'
  _listeners: [],

  init() {
    this._mode = localStorage.getItem(this.MODE_KEY) || 'manual';
    this._updateUI();

    const btn = document.getElementById('btn-op-mode');
    if (btn) {
      btn.addEventListener('click', () => {
        this.toggle();
      });
    }
  },

  get mode() { return this._mode; },
  get isAuto() { return this._mode === 'auto'; },

  toggle() {
    if (this._mode === 'manual') {
      // Manual -> Auto: require password
      App.showPasswordModal('AUTO mode password', (pwd) => {
        if (pwd === '0000') {
          this._mode = 'auto';
          _safeSetItem(this.MODE_KEY, this._mode);
          this._updateUI();
          this._notify();
          App.toast('Switched to AUTO mode', 'info');
        } else if (pwd !== null) {
          App.toast('Incorrect password', 'error');
        }
      });
    } else {
      // Auto -> Manual: no password needed
      this._mode = 'manual';
      _safeSetItem(this.MODE_KEY, this._mode);
      this._updateUI();
      this._notify();
      App.toast('Switched to MANUAL mode', 'info');
    }
  },

  onChange(fn) {
    this._listeners.push(fn);
  },

  _notify() {
    this._listeners.forEach(fn => fn(this._mode));
  },

  _updateUI() {
    const btn = document.getElementById('btn-op-mode');
    if (btn) {
      btn.textContent = this._mode.toUpperCase();
      btn.className = 'btn btn-small btn-op-mode ' + this._mode;
    }
    const badge = document.getElementById('scheduler-mode-badge');
    if (badge) {
      badge.textContent = this._mode.toUpperCase();
      badge.className = 'scheduler-mode-badge ' + this._mode;
    }
  }
};

// ============ D1: Mission Scheduler ============
const MissionScheduler = {
  STORAGE_KEY: 'missionScheduler',
  LOG_KEY: 'missionSchedulerLog',
  _timers: {},
  _batteryCheckTimer: null,

  init() {
    this.render();
    this.renderLog();
    this._restoreTimers();
    this._startBatteryWatch();

    const addBtn = document.getElementById('btn-scheduler-add');
    const clearBtn = document.getElementById('btn-scheduler-clear');
    const clearLogBtn = document.getElementById('btn-scheduler-clear-log');

    if (addBtn) addBtn.addEventListener('click', () => this.addMission());
    if (clearBtn) clearBtn.addEventListener('click', () => { this.clearAll(); });
    if (clearLogBtn) clearLogBtn.addEventListener('click', () => { this.clearLog(); });

    // Re-render when mode changes
    OpMode.onChange(() => {
      this.render();
      if (OpMode.isAuto) {
        this._restoreTimers();
      } else {
        this._stopAllTimers();
      }
    });
  },

  getAll() {
    try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || []; }
    catch (e) { return []; }
  },

  saveAll(list) {
    _safeSetItem(this.STORAGE_KEY, JSON.stringify(list));
  },

  getLogs() {
    try { return JSON.parse(localStorage.getItem(this.LOG_KEY)) || []; }
    catch (e) { return []; }
  },

  saveLogs(logs) {
    _safeSetItem(this.LOG_KEY, JSON.stringify(logs));
  },

  addLog(msg) {
    const logs = this.getLogs();
    logs.unshift({ msg, at: Date.now() });
    if (logs.length > 100) logs.length = 100;
    this.saveLogs(logs);
    this.renderLog();
  },

  addMission() {
    const name = prompt('Mission name:', `Mission_${this.getAll().length + 1}`);
    if (!name) return;

    const queueName = prompt('Queue name (saved Action Queue):', 'default');
    if (!queueName) return;

    const mode = prompt('Execution mode (once / interval / cron / battery):', 'once');
    if (!mode) return;

    let intervalSec = 0;
    let cronTime = '';
    let batteryThreshold = 0;
    let batteryCondition = 'below';
    if (mode === 'interval') {
      const sec = prompt('Repeat interval (seconds):', '60');
      intervalSec = parseInt(sec) || 60;
    } else if (mode === 'cron') {
      cronTime = prompt('Execution time (HH:MM):', '09:00') || '09:00';
    } else if (mode === 'battery') {
      const thresh = prompt('Battery threshold (%):', '20');
      batteryThreshold = parseInt(thresh) || 20;
      batteryCondition = 'below';
    }

    // Optional battery trigger for interval/cron modes too
    if (mode === 'interval' || mode === 'cron') {
      const addBattery = prompt('Add battery condition? (y/n):', 'n');
      if (addBattery && addBattery.toLowerCase() === 'y') {
        const thresh = prompt('Battery threshold (%) - execute when below:', '20');
        batteryThreshold = parseInt(thresh) || 0;
        batteryCondition = 'below';
      }
    }

    const missions = this.getAll();
    missions.push({
      id: Date.now(),
      name,
      queueName,
      mode,
      intervalSec,
      cronTime,
      batteryThreshold,
      batteryCondition,
      enabled: true,
      lastRun: null
    });
    this.saveAll(missions);
    this.render();
    App.toast(`Mission added: ${name}`, 'success');
  },

  removeMission(id) {
    this._stopTimer(id);
    const missions = this.getAll().filter(m => m.id !== id);
    this.saveAll(missions);
    this.render();
  },

  toggleMission(id) {
    const missions = this.getAll();
    const m = missions.find(x => x.id === id);
    if (!m) return;
    m.enabled = !m.enabled;
    this.saveAll(missions);
    if (m.enabled) {
      this._startTimer(m);
    } else {
      this._stopTimer(id);
    }
    this.render();
  },

  _getCurrentBatterySoc() {
    const slot = App.robotSlots && App.robotSlots[App.activeSlotIndex];
    if (slot && slot.bms && slot.bms.soc > 0) return slot.bms.soc;
    return -1;
  },

  _checkBatteryCondition(m) {
    if (!m.batteryThreshold || m.batteryThreshold <= 0) return true;
    const soc = this._getCurrentBatterySoc();
    if (soc < 0) return true; // no data, skip check
    if (m.batteryCondition === 'below') return soc <= m.batteryThreshold;
    return true;
  },

  executeMission(id, isManualRun) {
    const missions = this.getAll();
    const m = missions.find(x => x.id === id);
    if (!m) return;

    // Auto mode check - block auto-scheduled execution in Manual mode
    if (!isManualRun && !OpMode.isAuto) {
      this.addLog(`[${m.name}] Blocked - Auto execution disabled in MANUAL mode`);
      return;
    }

    // Battery condition check
    if (!this._checkBatteryCondition(m)) {
      const soc = this._getCurrentBatterySoc();
      this.addLog(`[${m.name}] Skipped - Battery ${soc.toFixed(0)}% (condition: below ${m.batteryThreshold}%)`);
      return;
    }

    // Load saved queue
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(ActionSender.QUEUE_STORAGE_KEY)) || {};
    } catch (e) { saved = {}; }

    const entry = saved[m.queueName];
    if (!entry || !entry.queue || entry.queue.length === 0) {
      this.addLog(`[${m.name}] Queue "${m.queueName}" not found or empty`);
      App.toast(`Mission failed: Queue "${m.queueName}" not found`, 'error');
      return;
    }

    // Load queue and send
    ActionSender.actionQueue = JSON.parse(JSON.stringify(entry.queue));
    ActionSender.renderQueue();
    ActionSender.sendAction();

    m.lastRun = Date.now();
    this.saveAll(missions);
    this.addLog(`[${m.name}] Executed with queue "${m.queueName}" (${entry.queue.length} actions)`);
    this.render();
  },

  _startTimer(m) {
    this._stopTimer(m.id);
    if (m.mode === 'interval' && m.intervalSec > 0) {
      this._timers[m.id] = setInterval(() => {
        this.executeMission(m.id, false);
      }, m.intervalSec * 1000);
    } else if (m.mode === 'cron' && m.cronTime) {
      this._timers[m.id] = setInterval(() => {
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (hhmm === m.cronTime && (!m.lastRun || Date.now() - m.lastRun > 60000)) {
          this.executeMission(m.id, false);
        }
      }, 30000);
    }
    // battery mode has no own timer - uses _batteryCheckTimer
  },

  _stopTimer(id) {
    if (this._timers[id]) {
      clearInterval(this._timers[id]);
      delete this._timers[id];
    }
  },

  _stopAllTimers() {
    Object.keys(this._timers).forEach(id => this._stopTimer(id));
  },

  _restoreTimers() {
    if (!OpMode.isAuto) return;
    const missions = this.getAll();
    missions.forEach(m => {
      if (m.enabled && (m.mode === 'interval' || m.mode === 'cron')) {
        this._startTimer(m);
      }
    });
  },

  // Battery watch: check every 10s for battery-triggered missions
  _startBatteryWatch() {
    if (this._batteryCheckTimer) clearInterval(this._batteryCheckTimer);
    this._batteryCheckTimer = setInterval(() => {
      if (!OpMode.isAuto) return;
      const soc = this._getCurrentBatterySoc();
      if (soc < 0) return;

      const missions = this.getAll();
      missions.forEach(m => {
        if (!m.enabled) return;
        if (m.mode !== 'battery') return;
        if (!m.batteryThreshold || m.batteryThreshold <= 0) return;
        // Only trigger once per threshold crossing (cooldown 5min)
        if (m.lastRun && Date.now() - m.lastRun < 300000) return;
        if (soc <= m.batteryThreshold) {
          this.executeMission(m.id, false);
        }
      });
    }, 10000);
  },

  clearAll() {
    Object.keys(this._timers).forEach(id => this._stopTimer(id));
    this.saveAll([]);
    this.render();
  },

  clearLog() {
    this.saveLogs([]);
    this.renderLog();
  },

  render() {
    const listEl = document.getElementById('scheduler-list');
    if (!listEl) return;
    const missions = this.getAll();

    // Update mode badge
    const badge = document.getElementById('scheduler-mode-badge');
    if (badge) {
      badge.textContent = OpMode.mode.toUpperCase();
      badge.className = 'scheduler-mode-badge ' + OpMode.mode;
    }

    if (missions.length === 0) {
      listEl.innerHTML = '<span class="scheduler-empty">No missions registered.</span>';
      return;
    }

    listEl.innerHTML = missions.map(m => {
      const lastStr = m.lastRun ? new Date(m.lastRun).toLocaleTimeString() : '--';
      const modeStr = m.mode === 'interval' ? `${m.intervalSec}s repeat` :
                      m.mode === 'cron' ? `Daily ${m.cronTime}` :
                      m.mode === 'battery' ? `Battery ≤${m.batteryThreshold}%` : 'Once';
      const statusCls = m.enabled ? 'sched-enabled' : 'sched-disabled';
      const blockedCls = (!OpMode.isAuto && m.mode !== 'once') ? ' sched-blocked' : '';

      // Battery trigger info
      let triggerHtml = '';
      if (m.batteryThreshold && m.batteryThreshold > 0) {
        triggerHtml = `<div class="sched-trigger"><span class="trigger-tag">BAT &le; ${m.batteryThreshold}%</span></div>`;
      }

      return `<div class="scheduler-item ${statusCls}${blockedCls}">
        <div class="sched-info">
          <span class="sched-name">${m.name}</span>
          <span class="sched-detail">Queue: ${m.queueName} | ${modeStr} | Last: ${lastStr}</span>
          ${triggerHtml}
        </div>
        <div class="sched-actions">
          <button class="btn btn-small" onclick="MissionScheduler.executeMission(${m.id}, true)" title="Manual run">Run</button>
          <button class="btn btn-small" onclick="MissionScheduler.toggleMission(${m.id})">${m.enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-small btn-danger" onclick="MissionScheduler.removeMission(${m.id})">Del</button>
        </div>
      </div>`;
    }).join('');
  },

  renderLog() {
    const logEl = document.getElementById('scheduler-log');
    if (!logEl) return;
    const logs = this.getLogs();

    if (logs.length === 0) {
      logEl.innerHTML = '<span class="scheduler-log-empty">No logs</span>';
      return;
    }

    logEl.innerHTML = logs.slice(0, 20).map(l => {
      const time = new Date(l.at).toLocaleTimeString();
      return `<div class="scheduler-log-item"><span class="sched-log-time">${time}</span> ${l.msg}</div>`;
    }).join('');
  }
};
