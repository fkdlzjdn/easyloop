// Preset Commands
const Commands = {
  // Command definitions
  presets: {
    'scorpion-restart': {
      name: 'Scorpion Restart',
      description: 'Stop and restart scorpion service',
      steps: [
        { cmd: 'sudo service scorpion stop', wait: 3000 },
        { cmd: 'sudo service scorpion stop', wait: 2000 },
        { cmd: 'sudo service scorpion start', wait: 0 }
      ]
    },
    'check-ros': {
      name: 'Check ROS Status',
      description: 'Check ROS master and node status',
      steps: [
        { cmd: 'rostopic list | head -20', wait: 0 }
      ]
    },
    'system-info': {
      name: 'System Info',
      description: 'Show system information',
      steps: [
        { cmd: 'echo "=== Hostname ===" && hostname && echo "" && echo "=== Uptime ===" && uptime && echo "" && echo "=== Memory ===" && free -h && echo "" && echo "=== CPU ===" && cat /proc/cpuinfo | grep "model name" | head -1', wait: 0 }
      ]
    },
    'disk-usage': {
      name: 'Disk Usage',
      description: 'Show disk usage information',
      steps: [
        { cmd: 'df -h', wait: 0 }
      ]
    },
    'network-info': {
      name: 'Network Info',
      description: 'Show network configuration',
      steps: [
        { cmd: 'ip addr show | grep -E "^[0-9]+:|inet "', wait: 0 }
      ]
    },
    'reboot': {
      name: 'Reboot Robot',
      description: 'Reboot the robot IPC',
      confirm: true,
      steps: [
        { cmd: 'sudo reboot', wait: 0 }
      ]
    }
  },

  async execute(cmdKey, sourceButton = null) {
    const preset = this.presets[cmdKey];
    if (!preset) {
      this.showResult(`Unknown command: ${cmdKey}`, true);
      App.toast(`Unknown command: ${cmdKey}`, 'error');
      return;
    }

    // Confirm dangerous commands
    if (preset.confirm) {
      if (!confirm(`Execute "${preset.name}"?`)) {
        return;
      }
    }

    this.showResult(`Running: ${preset.name}...\n`);
    App.setButtonLoading(sourceButton, true, 'Running');

    try {
      const result = await SSHTerminal.execSequence(preset.steps);

      if (result.success) {
        let output = '';
        result.results.forEach((r, i) => {
          output += `\n[Step ${i + 1}] ${r.cmd}\n`;
          output += '─'.repeat(50) + '\n';
          if (r.stdout) output += r.stdout;
          if (r.stderr) output += `\n[stderr] ${r.stderr}`;
          if (r.error) output += `\n[error] ${r.error}`;
          output += '\n';
        });
        this.showResult(output);
        App.toast(`${preset.name} complete`, 'success');
        App.addEvent('command', `Command complete: ${preset.name}`, 'Executed successfully', 'success');
      } else {
        this.showResult(`Error: ${result.message}`, true);
        App.toast(result.message || 'Command execution failed', 'error');
        App.addEvent('command', `Command failed: ${preset.name}`, result.message || 'Execution failed', 'error');
      }
    } catch (e) {
      this.showResult(`Error: ${e.message}`, true);
      App.toast(e.message || 'Command execution failed', 'error');
      App.addEvent('command', `Command failed: ${preset.name}`, e.message || 'Execution failed', 'error');
    } finally {
      App.setButtonLoading(sourceButton, false);
    }
  },

  showResult(message, isError = false) {
    const resultEl = document.getElementById('command-result');
    if (isError) {
      resultEl.innerHTML = `<span style="color: #ff6b6b">${this.escapeHtml(message)}</span>`;
    } else {
      resultEl.textContent = message;
    }
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Camera Serial Manager
const CameraSerial = {
  actualSerials: { cam1: null, cam2: null },
  configSerials: { cam1: null, cam2: null },
  hasMismatch: false,

  async checkSerials(sourceButton = null) {
    const statusEl = document.getElementById('serial-status');
    const comparisonEl = document.getElementById('serial-comparison');
    const fixBtn = document.getElementById('btn-fix-serials');
    const checkBtn = document.getElementById('btn-check-serial');

      statusEl.textContent = 'Checking...';
    statusEl.style.color = '#888';
    comparisonEl.style.display = 'none';
    fixBtn.style.display = 'none';
    checkBtn.disabled = true;
    App.setButtonLoading(sourceButton, true, 'Checking');

    try {
      console.log('[CameraSerial] Starting check...');

      // Get actual camera serials from device
      const actualResult = await SSHTerminal.execCommand('rs-fw-update -l');
      console.log('[CameraSerial] rs-fw-update result:', actualResult);

      if (!actualResult.success) {
        statusEl.textContent = 'Error: ' + (actualResult.message || 'Failed to get device serials');
        statusEl.style.color = '#ff6b6b';
        App.toast(actualResult.message || 'Failed to get device serial', 'error');
        checkBtn.disabled = false;
        return;
      }

      // Parse actual serials from rs-fw-update output
      this.parseActualSerials(actualResult.stdout || '');

      // Get config serials from scorpion.sh
      const configResult = await SSHTerminal.execCommand('cat ~/scorpion.sh | grep -E "CAM_[12]_SERIAL"');
      console.log('[CameraSerial] scorpion.sh result:', configResult);

      if (!configResult.success) {
        // If grep returns nothing, it might not be an error
        if (configResult.exitCode === 1) {
          // grep found nothing - that's okay, just no config
          this.configSerials = { cam1: null, cam2: null };
        } else {
          statusEl.textContent = 'Error: ' + (configResult.message || 'Failed to read scorpion.sh');
          statusEl.style.color = '#ff6b6b';
          App.toast(configResult.message || 'Failed to read scorpion.sh', 'error');
          checkBtn.disabled = false;
          return;
        }
      } else {
        // Parse config serials
        this.parseConfigSerials(configResult.stdout || '');
      }

      // Display comparison
      this.displayComparison();

      statusEl.textContent = this.hasMismatch ? 'Mismatch found' : 'Serial match';
      statusEl.style.color = this.hasMismatch ? '#ff6b6b' : '#27ae60';
      App.toast(this.hasMismatch ? 'Serial mismatch' : 'Serial match', this.hasMismatch ? 'error' : 'success');

      comparisonEl.style.display = 'block';
      if (this.hasMismatch) {
        fixBtn.style.display = 'inline-block';
      }

    } catch (e) {
      console.error('[CameraSerial] Error:', e);
      statusEl.textContent = 'Error: ' + e.message;
      statusEl.style.color = '#ff6b6b';
      App.toast(e.message || 'Serial check failed', 'error');
    } finally {
      checkBtn.disabled = false;
      App.setButtonLoading(sourceButton, false);
    }
  },

  parseActualSerials(output) {
    // rs-fw-update -l output format:
    // connected devices:
    // 1) Name: Intel RealSense D435, serial number: 238222074218, update serial number: xxx, firmware version: x.x.x
    // 2) Name: Intel RealSense D435, serial number: 238222071114, ...

    this.actualSerials = { cam1: null, cam2: null };

    const lines = output.split('\n');
    const serials = [];

    for (const line of lines) {
      const match = line.match(/serial number:\s*(\d+)/i);
      if (match) {
        serials.push(match[1]);
      }
    }

    // Assume first camera is cam1, second is cam2
    if (serials.length >= 1) this.actualSerials.cam1 = serials[0];
    if (serials.length >= 2) this.actualSerials.cam2 = serials[1];
  },

  parseConfigSerials(output) {
    // Format: export CAM_1_SERIAL=238222074218
    this.configSerials = { cam1: null, cam2: null };

    const cam1Match = output.match(/CAM_1_SERIAL=(\d+)/);
    const cam2Match = output.match(/CAM_2_SERIAL=(\d+)/);

    if (cam1Match) this.configSerials.cam1 = cam1Match[1];
    if (cam2Match) this.configSerials.cam2 = cam2Match[1];
  },

  displayComparison() {
    this.hasMismatch = false;

    // CAM_1
    document.getElementById('actual-cam1').textContent = this.actualSerials.cam1 || 'Not detected';
    document.getElementById('config-cam1').textContent = this.configSerials.cam1 || 'Not set';

    const status1 = this.getStatus(this.actualSerials.cam1, this.configSerials.cam1);
    const status1El = document.getElementById('status-cam1');
    status1El.textContent = status1.text;
    status1El.style.color = status1.color;
    if (status1.mismatch) this.hasMismatch = true;

    // CAM_2
    document.getElementById('actual-cam2').textContent = this.actualSerials.cam2 || 'Not detected';
    document.getElementById('config-cam2').textContent = this.configSerials.cam2 || 'Not set';

    const status2 = this.getStatus(this.actualSerials.cam2, this.configSerials.cam2);
    const status2El = document.getElementById('status-cam2');
    status2El.textContent = status2.text;
    status2El.style.color = status2.color;
    if (status2.mismatch) this.hasMismatch = true;
  },

  getStatus(actual, config) {
    if (!actual) {
      return { text: 'No device', color: '#888', mismatch: false };
    }
    if (!config) {
      return { text: 'Not configured', color: '#f39c12', mismatch: true };
    }
    if (actual === config) {
      return { text: 'OK', color: '#27ae60', mismatch: false };
    }
    return { text: 'MISMATCH', color: '#ff6b6b', mismatch: true };
  },

  async fixSerials(sourceButton = null) {
    if (!confirm('Update ~/scorpion.sh with actual camera serials. Continue?')) {
      return;
    }

    const statusEl = document.getElementById('serial-status');
    statusEl.textContent = 'Applying...';
    statusEl.style.color = '#888';
    App.setButtonLoading(sourceButton, true, 'Fixing');

    try {
      const commands = [];

      // Build sed commands to replace serials
      if (this.actualSerials.cam1 && this.actualSerials.cam1 !== this.configSerials.cam1) {
        if (this.configSerials.cam1) {
          // Replace existing
          commands.push(`sed -i 's/CAM_1_SERIAL=.*/CAM_1_SERIAL=${this.actualSerials.cam1}/' ~/scorpion.sh`);
        } else {
          // Add new line
          commands.push(`echo 'export CAM_1_SERIAL=${this.actualSerials.cam1}' >> ~/scorpion.sh`);
        }
      }

      if (this.actualSerials.cam2 && this.actualSerials.cam2 !== this.configSerials.cam2) {
        if (this.configSerials.cam2) {
          // Replace existing
          commands.push(`sed -i 's/CAM_2_SERIAL=.*/CAM_2_SERIAL=${this.actualSerials.cam2}/' ~/scorpion.sh`);
        } else {
          // Add new line
          commands.push(`echo 'export CAM_2_SERIAL=${this.actualSerials.cam2}' >> ~/scorpion.sh`);
        }
      }

      if (commands.length === 0) {
        statusEl.textContent = 'No changes to apply';
        statusEl.style.color = '#27ae60';
        App.toast('No changes', 'info');
        return;
      }

      // Execute fix commands
      for (const cmd of commands) {
        const result = await SSHTerminal.execCommand(cmd);
        if (!result.success) {
          throw new Error(result.message || 'Failed to update scorpion.sh');
        }
      }

      statusEl.textContent = 'Applied';
      statusEl.style.color = '#27ae60';
      App.toast('Serial updated', 'success');

      // Re-check to confirm
      setTimeout(() => this.checkSerials(), 1000);

      // Ask to restart service
      setTimeout(() => {
        if (confirm('Serial applied.\nRestart Scorpion service?')) {
          this.restartScorpion();
        }
      }, 1500);

    } catch (e) {
      statusEl.textContent = 'Error: ' + e.message;
      statusEl.style.color = '#ff6b6b';
      App.toast(e.message || 'Serial apply failed', 'error');
    } finally {
      App.setButtonLoading(sourceButton, false);
    }
  },

  async restartScorpion() {
    const statusEl = document.getElementById('serial-status');
    statusEl.textContent = 'Restarting Scorpion...';
    statusEl.style.color = '#888';

    try {
      const result = await SSHTerminal.execSequence([
        { cmd: 'sudo service scorpion stop', wait: 3000 },
        { cmd: 'sudo service scorpion stop', wait: 2000 },
        { cmd: 'sudo service scorpion start', wait: 0 }
      ]);

      if (result.success) {
        statusEl.textContent = 'Scorpion restart complete';
        statusEl.style.color = '#27ae60';
        App.toast('Scorpion restart complete', 'success');
      } else {
        statusEl.textContent = 'Restart failed: ' + result.message;
        statusEl.style.color = '#ff6b6b';
        App.toast(result.message || 'Restart failed', 'error');
      }
    } catch (e) {
      statusEl.textContent = 'Restart error: ' + e.message;
      statusEl.style.color = '#ff6b6b';
      App.toast(e.message || 'Restart failed', 'error');
    }
  }
};

// Event handlers
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.cmd-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmdKey = btn.dataset.cmd;
      Commands.execute(cmdKey, btn);
    });
  });

  // Camera Serial handlers
  const serialBtn = document.getElementById('btn-check-serial');
  if (serialBtn) {
    serialBtn.addEventListener('click', () => {
      CameraSerial.checkSerials(serialBtn);
    });
  }

  const fixBtn = document.getElementById('btn-fix-serials');
  if (fixBtn) {
    fixBtn.addEventListener('click', () => {
      CameraSerial.fixSerials(fixBtn);
    });
  }

  // CMD floating panel toggle + drag
  const cmdPanel = document.getElementById('cmd-panel');
  const cmdToggle = document.getElementById('btn-cmd-toggle');
  const cmdClose = document.getElementById('cmd-panel-close');
  const cmdHeader = document.getElementById('cmd-panel-header');

  if (cmdToggle && cmdPanel) {
    cmdToggle.addEventListener('click', () => {
      const visible = cmdPanel.style.display !== 'none';
      cmdPanel.style.display = visible ? 'none' : 'flex';
      cmdToggle.classList.toggle('active', !visible);
      if (!visible) {
        cmdPanel.style.top = '80px';
        cmdPanel.style.right = '20px';
        cmdPanel.style.left = 'auto';
      }
    });
  }

  if (cmdClose && cmdPanel) {
    cmdClose.addEventListener('click', () => { cmdPanel.style.display = 'none'; cmdToggle.classList.remove('active'); });
  }

  // Draggable header
  if (cmdHeader && cmdPanel) {
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
    cmdHeader.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = cmdPanel.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      cmdPanel.style.right = 'auto';
      cmdPanel.style.left = origLeft + 'px';
      cmdPanel.style.top = origTop + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      cmdPanel.style.left = (origLeft + e.clientX - startX) + 'px';
      cmdPanel.style.top = (origTop + e.clientY - startY) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  // Command Snippets
  CommandSnippets.init();
});

// Command History Manager
/* exported CommandHistory */
// eslint-disable-next-line no-unused-vars -- classic-script global consumed by index.html handlers
const CommandHistory = {
  STORAGE_KEY: 'amrCmdHistory',
  MAX_ITEMS: 50,
  history: [],

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      this.history = raw ? JSON.parse(raw) : [];
    } catch (e) {
      this.history = [];
    }
  },

  save() {
    // B13 fix: localStorage 안전 쓰기
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.history)); }
    catch (e) { console.warn('localStorage.setItem amrCmdHistory failed:', e.message); }
  },

  add(cmd, output, success) {
    this.load();
    this.history.unshift({
      cmd,
      output: output ? output.substring(0, 500) : '',
      success,
      at: Date.now()
    });
    if (this.history.length > this.MAX_ITEMS) {
      this.history.length = this.MAX_ITEMS;
    }
    this.save();
  },

  getRecent(limit = 10) {
    this.load();
    return this.history.slice(0, limit);
  },

  clear() {
    this.history = [];
    this.save();
  }
};

// Command Snippets Manager
const CommandSnippets = {
  STORAGE_KEY: 'amrCmdSnippets',
  snippets: [],

  init() {
    this.load();
    this.render();
    this.setupHandlers();
  },

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      this.snippets = raw ? JSON.parse(raw) : [];
    } catch (e) {
      this.snippets = [];
    }
  },

  save() {
    // B13 fix: localStorage 안전 쓰기
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.snippets)); }
    catch (e) { console.warn('localStorage.setItem amrCmdSnippets failed:', e.message); }
  },

  render() {
    const listEl = document.getElementById('cmd-snippet-list');
    if (!listEl) return;

    if (this.snippets.length === 0) {
      listEl.innerHTML = '<span class="snippet-empty">No snippets saved</span>';
      return;
    }

    listEl.innerHTML = '';
    this.snippets.forEach((snip, idx) => {
      const item = document.createElement('div');
      item.className = 'snippet-item';
      item.innerHTML = `
        <span class="snippet-name">${this.escapeHtml(snip.name)}</span>
        <span class="snippet-del" data-idx="${idx}" title="Delete">&times;</span>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('snippet-del')) {
          this.delete(idx);
        } else {
          this.execute(snip);
        }
      });
      listEl.appendChild(item);
    });
  },

  setupHandlers() {
    const addBtn = document.getElementById('btn-snippet-add');
    const saveBtn = document.getElementById('btn-snippet-save');
    const cancelBtn = document.getElementById('btn-snippet-cancel');
    const formEl = document.getElementById('cmd-snippet-add-form');

    if (addBtn && formEl) {
      addBtn.addEventListener('click', () => {
        formEl.style.display = formEl.style.display === 'none' ? 'flex' : 'none';
        if (formEl.style.display !== 'none') {
          document.getElementById('snippet-name').value = '';
          document.getElementById('snippet-cmd').value = '';
          document.getElementById('snippet-name').focus();
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const name = document.getElementById('snippet-name').value.trim();
        const cmd = document.getElementById('snippet-cmd').value.trim();
        if (!name || !cmd) {
          App.toast('Enter name and command', 'error');
          return;
        }
        this.add(name, cmd);
        formEl.style.display = 'none';
      });
    }

    if (cancelBtn && formEl) {
      cancelBtn.addEventListener('click', () => {
        formEl.style.display = 'none';
      });
    }
  },

  add(name, cmd) {
    this.snippets.push({ name, cmd });
    this.save();
    this.render();
    App.toast(`Snippet saved: ${name}`, 'success');
  },

  delete(idx) {
    if (!confirm('Delete this snippet?')) return;
    const removed = this.snippets.splice(idx, 1)[0];
    this.save();
    this.render();
    App.toast(`Snippet deleted: ${removed.name}`, 'info');
  },

  async execute(snip) {
    Commands.showResult(`Executing: ${snip.cmd}\n...`);
    try {
      const result = await SSHTerminal.execCommand(snip.cmd);
      if (result.success) {
        Commands.showResult(result.stdout || '(no output)');
        App.toast(`Snippet executed: ${snip.name}`, 'success');
      } else {
        Commands.showResult(`Error: ${result.message || result.stderr || 'Failed'}`, true);
        App.toast(`Snippet failed: ${snip.name}`, 'error');
      }
    } catch (e) {
      Commands.showResult(`Error: ${e.message}`, true);
      App.toast(`Snippet error: ${e.message}`, 'error');
    }
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Batch Command Execution
const BatchCommand = {
  _running: false,
  _aborted: false,

  init() {
    this.bindEvents();
  },

  bindEvents() {
    const runBtn = document.getElementById('btn-batch-run');
    const abortBtn = document.getElementById('btn-batch-abort');

    if (runBtn) {
      runBtn.addEventListener('click', () => this.run());
    }
    if (abortBtn) {
      abortBtn.addEventListener('click', () => this.abort());
    }
  },

  async run() {
    if (this._running) {
      App.toast('Batch already running', 'warning');
      return;
    }

    const textarea = document.getElementById('batch-commands');
    const output = document.getElementById('batch-output');
    if (!textarea || !output) return;

    const lines = textarea.value.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));  // Skip empty lines and comments

    if (!lines.length) {
      App.toast('No commands to execute', 'info');
      return;
    }

    this._running = true;
    this._aborted = false;
    output.textContent = '';
    this.updateUI(true);

    for (let i = 0; i < lines.length; i++) {
      if (this._aborted) {
        output.textContent += '\n[ABORTED by user]\n';
        break;
      }

      const cmd = lines[i];
      output.textContent += `\n[${i+1}/${lines.length}] $ ${cmd}\n`;
      output.scrollTop = output.scrollHeight;

      try {
        const result = await SSHTerminal.execCommand(cmd);
        if (result.success) {
          output.textContent += (result.stdout || '(no output)') + '\n';
        } else {
          output.textContent += `[ERROR] ${result.message || result.stderr || 'Failed'}\n`;
        }
      } catch (e) {
        output.textContent += `[ERROR] ${e.message}\n`;
      }

      output.scrollTop = output.scrollHeight;

      // Small delay between commands
      if (i < lines.length - 1 && !this._aborted) {
        await this.delay(500);
      }
    }

    this._running = false;
    this.updateUI(false);
    App.toast('Batch execution completed', 'success');
  },

  abort() {
    if (this._running) {
      this._aborted = true;
      App.toast('Aborting batch...', 'warning');
    }
  },

  updateUI(running) {
    const runBtn = document.getElementById('btn-batch-run');
    const abortBtn = document.getElementById('btn-batch-abort');

    if (runBtn) {
      runBtn.disabled = running;
      runBtn.textContent = running ? 'Running...' : 'Run All';
    }
    if (abortBtn) {
      abortBtn.disabled = !running;
    }
  },

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

document.addEventListener('DOMContentLoaded', () => {
  BatchCommand.init();
});
