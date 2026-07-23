// SSH Terminal using xterm.js - Multi-Terminal Support
const SSHTerminal = {
  terminal: null,
  fitAddon: null,
  searchAddon: null,
  ws: null,
  sessionId: null,

  // Multi-terminal state
  terminals: [],  // [{terminal, fitAddon, searchAddon, ws, container}]
  activeTermIdx: 0,
  maxTerminals: 4,

  init() {
    // Initialize terminal
    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0a14',
        foreground: '#ffffff',
        cursor: '#e94560'
      }
    });

    this.fitAddon = new FitAddon.FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Load search addon if available
    if (typeof SearchAddon !== 'undefined') {
      this.searchAddon = new SearchAddon.SearchAddon();
      this.terminal.loadAddon(this.searchAddon);
    }

    const container = document.getElementById('terminal-container');
    this.terminal.open(container);

    // Setup search functionality
    this.setupSearch();

    // Fit terminal to container
    setTimeout(() => this.fit(), 100);

    // Handle window resize
    window.addEventListener('resize', () => this.fit());

    // Handle terminal input
    this.terminal.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'data',
          data: btoa(data)
        }));
      }
    });

    // Handle terminal resize
    this.terminal.onResize(({ cols, rows }) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'resize',
          cols,
          rows
        }));
      }
    });
  },

  fit() {
    if (this.fitAddon && this.terminal) {
      try {
        this.fitAddon.fit();
      } catch (e) {
        // Ignore fit errors when terminal is not visible
      }
    }
  },

  connect(password = null) {
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      this.terminal.clear();
      this.terminal.writeln('Test Mode: SSH terminal simulated.');
      this.terminal.writeln('> uname -a');
      this.terminal.writeln('Linux test-host 5.15.0 x86_64 GNU/Linux');
      App.updateSshStatus(true);
      return;
    }

    const info = App.getConnectionInfo();

    if (!info.ip) {
      this.terminal.writeln('\r\n\x1b[31mError: IP address required\x1b[0m');
      return;
    }

    // WebSocket to backend SSH server
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

    this.ws.onopen = () => {
      this.terminal.clear();
      this.terminal.writeln(`Connecting to ${info.ip}:${info.sshPort || 22}...`);

      this.ws.send(JSON.stringify({
        type: 'connect',
        host: info.ip,
        port: info.sshPort || 22,
        username: info.sshUser,
        password: password || info.sshPassword || null
      }));
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'connected':
          App.updateSshStatus(true);
          this.terminal.clear();
          this.fit();
          break;

        case 'data':
          const data = atob(msg.data);
          this.terminal.write(data);
          break;

        case 'disconnected':
          App.updateSshStatus(false);
          this.terminal.writeln('\r\n\x1b[33mDisconnected\x1b[0m');
          break;

        case 'error':
          if (msg.needPassword) {
            this.ws.close();
            App.showPasswordModal(msg.message, (pwd) => {
              this.connect(pwd);
            });
          } else {
            this.terminal.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
            App.updateSshStatus(false);
          }
          break;
      }
    };

    this.ws.onclose = () => {
      App.updateSshStatus(false);
    };

    this.ws.onerror = (error) => {
      this.terminal.writeln('\r\n\x1b[31mWebSocket error\x1b[0m');
      App.updateSshStatus(false);
    };
  },

  disconnect() {
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: 'disconnect' }));
      this.ws.close();
      this.ws = null;
    }
    App.updateSshStatus(false);
  },

  // Execute single command via API (for commands tab)
  async execCommand(command) {
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      return {
        success: true,
        stdout: `[test-mode] ${command}\nOK\n`,
        stderr: '',
        exitCode: 0
      };
    }

    const info = App.getConnectionInfo();

    if (!this.sessionId) {
      // Need to create SSH session first
      const connectResult = await this.apiConnect();
      if (!connectResult.success) {
        return connectResult;
      }
    }

    try {
      // B12 fix: SSH exec 서버 30초 + 여유분
      const res = await fetchWithTimeout('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          command
        })
      }, 35000);
      const result = await res.json();
      // Audit log for SSH command execution
      if (result.success && typeof App !== 'undefined' && App.logAudit) {
        App.logAudit('ssh_command', { command: command.substring(0, 100), exitCode: result.exitCode });
      }
      return result;
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  // Execute sequential commands via API
  async execSequence(steps) {
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      const results = steps.map(step => ({
        cmd: step.cmd,
        stdout: `[test-mode] ${step.cmd}\nOK\n`,
        stderr: '',
        exitCode: 0
      }));
      return { success: true, results };
    }

    const info = App.getConnectionInfo();

    if (!this.sessionId) {
      const connectResult = await this.apiConnect();
      if (!connectResult.success) {
        return connectResult;
      }
    }

    try {
      // B12 fix: fetch 타임아웃 적용 (시퀀스 실행 60초)
      const res = await fetchWithTimeout('/api/ssh/exec-sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          steps
        })
      }, 60000);
      return await res.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  // API-based SSH connect (for commands)
  async apiConnect(password = null) {
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      this.sessionId = App.generateSessionId();
      return { success: true, message: 'Test mode SSH connected' };
    }

    const info = App.getConnectionInfo();

    if (!info.ip) {
      return { success: false, message: 'IP address required' };
    }

    // Generate new session ID only if not retrying with password
    if (!password) {
      this.sessionId = App.generateSessionId();
    }

    console.log('[SSH] Connecting to', info.ip, 'port:', info.sshPort || 22, 'user:', info.sshUser, 'session:', this.sessionId);

    try {
      // Add timeout to fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      const res = await fetch('/api/ssh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: info.ip,
          port: info.sshPort || 22,
          username: info.sshUser,
          password: password || info.sshPassword || null,
          sessionId: this.sessionId
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const result = await res.json();
      console.log('[SSH] Connect result:', result);

      if (!result.success && result.needPassword) {
        // Reset session for password retry
        this.sessionId = App.generateSessionId();

        return new Promise((resolve) => {
          App.showPasswordModal(result.message, async (pwd) => {
            if (!pwd) {
              resolve({ success: false, message: 'Password cancelled' });
              return;
            }
            console.log('[SSH] Retrying with password...');
            const retryResult = await this.apiConnect(pwd);
            resolve(retryResult);
          });
        });
      }

      return result;
    } catch (e) {
      console.error('[SSH] Connect error:', e);
      this.sessionId = null;
      if (e.name === 'AbortError') {
        return { success: false, message: 'Connection timeout (15s)' };
      }
      return { success: false, message: e.message };
    }
  },

  // API disconnect
  async apiDisconnect() {
    if (this.sessionId) {
      try {
        await fetch('/api/ssh/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: this.sessionId })
        });
      } catch (e) {
        console.error('Disconnect error:', e);
      }
      this.sessionId = null;
    }
  },

  setupSearch() {
    const searchBar = document.getElementById('terminal-search-bar');
    const searchInput = document.getElementById('terminal-search-input');
    const prevBtn = document.getElementById('btn-terminal-search-prev');
    const nextBtn = document.getElementById('btn-terminal-search-next');
    const closeBtn = document.getElementById('btn-terminal-search-close');
    const countEl = document.getElementById('terminal-search-count');

    if (!searchBar || !searchInput) return;

    // Toggle search bar with Ctrl+F
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'f') {
        const sshTab = document.getElementById('tab-ssh');
        if (sshTab && sshTab.classList.contains('active')) {
          e.preventDefault();
          searchBar.classList.add('active');
          searchInput.focus();
          searchInput.select();
        }
      }
      // Close on Escape
      if (e.key === 'Escape' && searchBar.classList.contains('active')) {
        searchBar.classList.remove('active');
        if (this.searchAddon) this.searchAddon.clearDecorations();
      }
    });

    // Search on input
    searchInput.addEventListener('input', () => {
      if (this.searchAddon && searchInput.value) {
        this.searchAddon.findNext(searchInput.value);
      }
    });

    // Enter to find next
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.searchAddon && searchInput.value) {
          if (e.shiftKey) {
            this.searchAddon.findPrevious(searchInput.value);
          } else {
            this.searchAddon.findNext(searchInput.value);
          }
        }
      }
    });

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (this.searchAddon && searchInput.value) {
          this.searchAddon.findPrevious(searchInput.value);
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (this.searchAddon && searchInput.value) {
          this.searchAddon.findNext(searchInput.value);
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        searchBar.classList.remove('active');
        if (this.searchAddon) this.searchAddon.clearDecorations();
      });
    }
  }
};

// Multi-Terminal Methods
SSHTerminal.initMultiTerminal = function() {
  // Create first terminal instance
  this.createTerminalInstance(0);

  // Tab click handlers
  document.getElementById('terminal-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.terminal-tab');
    if (tab && tab.dataset.termIdx !== undefined) {
      this.switchTerminal(parseInt(tab.dataset.termIdx));
    }
  });

  // Add terminal button
  const addBtn = document.getElementById('btn-add-terminal');
  if (addBtn) {
    addBtn.addEventListener('click', () => this.addTerminal());
  }
};

SSHTerminal.createTerminalInstance = function(idx) {
  const mainContainer = document.getElementById('terminal-container');

  // Create container for this terminal
  const container = document.createElement('div');
  container.id = `terminal-container-${idx}`;
  container.className = 'terminal-instance';
  container.style.display = idx === 0 ? 'block' : 'none';
  mainContainer.appendChild(container);

  // Create terminal
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#0a0a14',
      foreground: '#ffffff',
      cursor: '#e94560'
    }
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  let searchAddon = null;
  if (typeof SearchAddon !== 'undefined') {
    searchAddon = new SearchAddon.SearchAddon();
    term.loadAddon(searchAddon);
  }

  term.open(container);

  // Store instance
  this.terminals[idx] = {
    terminal: term,
    fitAddon,
    searchAddon,
    ws: null,
    container
  };

  // Set as main if first
  if (idx === 0) {
    this.terminal = term;
    this.fitAddon = fitAddon;
    this.searchAddon = searchAddon;
  }

  setTimeout(() => fitAddon.fit(), 100);

  // Handle input
  term.onData((data) => {
    const inst = this.terminals[idx];
    if (inst && inst.ws && inst.ws.readyState === WebSocket.OPEN) {
      inst.ws.send(JSON.stringify({
        type: 'data',
        data: btoa(data)
      }));
    }
  });

  // Handle resize
  term.onResize(({ cols, rows }) => {
    const inst = this.terminals[idx];
    if (inst && inst.ws && inst.ws.readyState === WebSocket.OPEN) {
      inst.ws.send(JSON.stringify({
        type: 'resize',
        cols,
        rows
      }));
    }
  });

  return this.terminals[idx];
};

SSHTerminal.addTerminal = function() {
  if (this.terminals.length >= this.maxTerminals) {
    App.toast(`Maximum ${this.maxTerminals} terminals`, 'warning');
    return;
  }

  const idx = this.terminals.length;
  this.createTerminalInstance(idx);

  // Add tab
  const tabsContainer = document.getElementById('terminal-tabs');
  const addBtn = tabsContainer.querySelector('#btn-add-terminal');
  const newTab = document.createElement('button');
  newTab.className = 'terminal-tab';
  newTab.dataset.termIdx = idx;
  newTab.innerHTML = `Terminal ${idx + 1} <span class="terminal-tab-close" data-close-idx="${idx}">×</span>`;
  tabsContainer.insertBefore(newTab, addBtn);

  // Close handler
  newTab.querySelector('.terminal-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    this.closeTerminal(idx);
  });

  this.switchTerminal(idx);
  App.toast(`Terminal ${idx + 1} added`, 'info');
};

SSHTerminal.closeTerminal = function(idx) {
  if (this.terminals.length <= 1) {
    App.toast('Cannot close last terminal', 'warning');
    return;
  }

  const inst = this.terminals[idx];
  if (!inst) return;

  // Disconnect if connected
  if (inst.ws) {
    inst.ws.close();
  }

  // Remove DOM elements
  inst.container.remove();
  const tab = document.querySelector(`.terminal-tab[data-term-idx="${idx}"]`);
  if (tab) tab.remove();

  // Mark as null (don't remove to keep indices stable)
  this.terminals[idx] = null;

  // Switch to another terminal
  if (this.activeTermIdx === idx) {
    const nextIdx = this.terminals.findIndex(t => t !== null);
    if (nextIdx >= 0) {
      this.switchTerminal(nextIdx);
    }
  }

  // Renumber tabs
  document.querySelectorAll('.terminal-tab[data-term-idx]').forEach((tab, i) => {
    const realIdx = parseInt(tab.dataset.termIdx);
    tab.childNodes[0].textContent = `Terminal ${i + 1} `;
  });
};

SSHTerminal.switchTerminal = function(idx) {
  const inst = this.terminals[idx];
  if (!inst) return;

  // Hide all, show target
  this.terminals.forEach((t, i) => {
    if (t && t.container) {
      t.container.style.display = i === idx ? 'block' : 'none';
    }
  });

  // Update tab active state
  document.querySelectorAll('.terminal-tab').forEach(tab => {
    tab.classList.toggle('active', parseInt(tab.dataset.termIdx) === idx);
  });

  this.activeTermIdx = idx;
  this.terminal = inst.terminal;
  this.fitAddon = inst.fitAddon;
  this.searchAddon = inst.searchAddon;
  this.ws = inst.ws;

  // Fit and focus
  setTimeout(() => {
    inst.fitAddon.fit();
    inst.terminal.focus();
  }, 50);
};

SSHTerminal.connectActive = function(password = null) {
  const idx = this.activeTermIdx;
  const inst = this.terminals[idx];
  if (!inst) return;

  if (typeof TestMode !== 'undefined' && TestMode.enabled) {
    inst.terminal.clear();
    inst.terminal.writeln('Test Mode: SSH terminal simulated.');
    inst.terminal.writeln('> uname -a');
    inst.terminal.writeln('Linux test-host 5.15.0 x86_64 GNU/Linux');
    App.updateSshStatus(true);
    return;
  }

  const info = App.getConnectionInfo();
  if (!info.ip) {
    inst.terminal.writeln('\r\n\x1b[31mError: IP address required\x1b[0m');
    return;
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  inst.ws = new WebSocket(`${wsProtocol}//${window.location.host}`);
  this.ws = inst.ws;

  inst.ws.onopen = () => {
    inst.terminal.clear();
    inst.terminal.writeln(`Connecting to ${info.ip}:${info.sshPort || 22}...`);

    inst.ws.send(JSON.stringify({
      type: 'connect',
      host: info.ip,
      port: info.sshPort || 22,
      username: info.sshUser,
      password: password || info.sshPassword || null
    }));
  };

  inst.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'connected':
        App.updateSshStatus(true);
        inst.terminal.clear();
        inst.fitAddon.fit();
        break;

      case 'data':
        const data = atob(msg.data);
        inst.terminal.write(data);
        break;

      case 'disconnected':
        App.updateSshStatus(false);
        inst.terminal.writeln('\r\n\x1b[33mDisconnected\x1b[0m');
        break;

      case 'error':
        if (msg.needPassword) {
          inst.ws.close();
          App.showPasswordModal(msg.message, (pwd) => {
            this.connectActive(pwd);
          });
        } else {
          inst.terminal.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
          App.updateSshStatus(false);
        }
        break;
    }
  };

  inst.ws.onclose = () => {
    App.updateSshStatus(false);
  };

  inst.ws.onerror = () => {
    inst.terminal.writeln('\r\n\x1b[31mWebSocket error\x1b[0m');
    App.updateSshStatus(false);
  };
};

SSHTerminal.disconnectActive = function() {
  const inst = this.terminals[this.activeTermIdx];
  if (inst && inst.ws) {
    inst.ws.send(JSON.stringify({ type: 'disconnect' }));
    inst.ws.close();
    inst.ws = null;
  }
  App.updateSshStatus(false);
};

// Initialize terminal and setup event handlers
document.addEventListener('DOMContentLoaded', () => {
  SSHTerminal.initMultiTerminal();
  SSHTerminal.setupSearch();

  document.getElementById('btn-ssh-connect').addEventListener('click', () => {
    SSHTerminal.connectActive();
  });

  document.getElementById('btn-ssh-disconnect').addEventListener('click', () => {
    SSHTerminal.disconnectActive();
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    const inst = SSHTerminal.terminals[SSHTerminal.activeTermIdx];
    if (inst && inst.fitAddon) {
      try { inst.fitAddon.fit(); } catch (e) {}
    }
  });
});
