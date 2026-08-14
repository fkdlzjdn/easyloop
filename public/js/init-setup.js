// Initial Setup Mode - Remote robot configuration via SSH
const InitSetup = {
  _sessionId: null,
  _connected: false,
  _sshPassword: null, // stored for sudo -S
  _bashrcRaw: '',    // full file content
  _envVars: [],      // parsed [{key, value, lineIndex}]
  _otherLines: [],   // non-export lines preserved

  init() {
    if (this._initialized) return;
    this._initialized = true;
    const btn = document.getElementById('btn-init-setup');
    const modal = document.getElementById('init-setup-modal');
    const closeBtn = document.getElementById('init-setup-close');

    if (btn && modal) {
      btn.addEventListener('click', () => modal.classList.add('show'));
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => modal.classList.remove('show'));
    }
    if (modal) {
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
    }

    // Tab switching
    document.querySelectorAll('.init-setup-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.init-setup-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.init-setup-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const target = document.getElementById(tab.dataset.target);
        if (target) target.classList.add('active');
      });
    });

    // Connect / Disconnect
    document.getElementById('init-setup-connect').addEventListener('click', () => this.connect());
    document.getElementById('init-setup-disconnect').addEventListener('click', () => this.disconnect());

    // Load / Save
    document.getElementById('init-setup-load-network').addEventListener('click', () => this.loadNetworkSettings());
    document.getElementById('init-setup-apply-network').addEventListener('click', () => this.applyNetworkSettings());
    document.getElementById('init-setup-load-bashrc').addEventListener('click', () => this.loadBashrc());
    document.getElementById('init-setup-save-bashrc').addEventListener('click', () => this.saveBashrc());
    document.getElementById('init-setup-load-hosts').addEventListener('click', () => this.loadHosts());
    document.getElementById('init-setup-save-hosts').addEventListener('click', () => this.saveHosts());

    // Add env var
    document.getElementById('init-setup-add-env').addEventListener('click', () => this.addEnvVar());
  },

  async connect(password) {
    const ip = document.getElementById('init-setup-ip').value.trim();
    const port = parseInt(document.getElementById('init-setup-port').value) || 22;
    const user = document.getElementById('init-setup-user').value.trim() || 'syscon';
    const pw = password || document.getElementById('init-setup-pw').value || null;

    if (!ip) { App.toast('Please enter IP', 'error'); return; }

    this._sessionId = 'initsetup_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    try {
      // B12 fix: fetch 타임아웃 적용
      const res = await fetchWithTimeout('/api/ssh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: ip, port, username: user, password: pw, sessionId: this._sessionId })
      });
      const result = await res.json();

      if (!result.success && result.needPassword) {
        this._sessionId = null;
        App.showPasswordModal(result.message, async (pwd) => {
          if (pwd) await this.connect(pwd);
        });
        return;
      }

      if (!result.success) {
        this._sessionId = null;
        App.toast('Connection failed: ' + result.message, 'error');
        return;
      }

      this._connected = true;
      this._sshPassword = pw;
      this._updateConnUI(true);
      App.toast(`Initial setup connected: ${ip}:${port}`, 'success');
      this._loadSystemInfo();
    } catch (e) {
      this._sessionId = null;
      App.toast('Connection error: ' + e.message, 'error');
    }
  },

  async disconnect() {
    if (this._sessionId) {
      try {
        await fetchWithTimeout('/api/ssh/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: this._sessionId })
        });
      } catch (e) { /* ignore */ }
    }
    this._sessionId = null;
    this._connected = false;
    this._sshPassword = null;
    this._updateConnUI(false);
    const sysPanel = document.getElementById('init-setup-sysinfo-panel');
    if (sysPanel) sysPanel.style.display = 'none';
    App.toast('Initial setup disconnected', 'info');
  },

  _updateConnUI(connected) {
    const status = document.getElementById('init-setup-status');
    const connBtn = document.getElementById('init-setup-connect');
    const discBtn = document.getElementById('init-setup-disconnect');
    status.textContent = connected ? 'Connected' : 'Disconnected';
    status.classList.toggle('connected', connected);
    connBtn.disabled = connected;
    discBtn.disabled = !connected;

    // Enable/disable action buttons
    const actionBtns = [
      'init-setup-load-network', 'init-setup-apply-network',
      'init-setup-load-bashrc', 'init-setup-save-bashrc',
      'init-setup-load-hosts', 'init-setup-save-hosts',
      'init-setup-add-env'
    ];
    actionBtns.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !connected;
    });

    // Network form inputs
    const netInputs = ['net-robot-id', 'net-lan-card', 'net-ip', 'net-subnet',
                       'net-gateway', 'net-dns', 'net-robot-model', 'net-plc-ip',
                       'net-ubuntu-ver', 'net-lan-cards-list'];
    netInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !connected;
    });

    const editor = document.getElementById('init-setup-hosts-editor');
    if (editor) editor.disabled = !connected;
  },

  async _loadSystemInfo() {
    const panel = document.getElementById('init-setup-sysinfo-panel');
    const elManuf = document.getElementById('sysinfo-manufacturer');
    const elUbuntu = document.getElementById('sysinfo-ubuntu');
    const elRos = document.getElementById('sysinfo-ros');
    const elLan = document.getElementById('sysinfo-lan-cards');
    const elHostname = document.getElementById('sysinfo-hostname');

    // Show panel with loading state
    panel.style.display = 'block';
    elManuf.textContent = '...';
    elUbuntu.textContent = '...';
    elRos.textContent = '...';
    elLan.textContent = '...';
    elHostname.textContent = '...';
    elManuf.className = 'sysinfo-value';

    try {
      // Run all info commands in parallel via a single combined command
      const result = await this._exec(
        'echo "===LAN===" && ls /sys/class/net | tr "\\n" " " && ' +
        'echo "" && echo "===UBUNTU===" && lsb_release -rs 2>/dev/null && ' +
        'echo "===ROS===" && (bash -ic "echo \\$ROS_DISTRO" 2>/dev/null || echo "") && ' +
        'echo "===HOSTNAME===" && hostname 2>/dev/null'
      );

      const stdout = result.stdout || '';

      // Parse LAN cards
      const lanSection = stdout.split('===LAN===')[1]?.split('===UBUNTU===')[0]?.trim() || '';
      const allCards = lanSection.split(/\s+/).filter(c => c && c !== 'lo');
      elLan.textContent = allCards.join(', ') || 'None';

      // Detect manufacturer from LAN card names
      // Rule: second non-lo interface (index 1, since eno1 is typically first)
      // eno2 → Siemens, enp2s0 → Advantech
      let manufacturer = 'Unknown';
      let mfgClass = 'badge-unknown';
      const nonLoCards = allCards; // already filtered lo
      if (nonLoCards.length >= 2) {
        const secondCard = nonLoCards[1];
        if (secondCard === 'eno2') {
          manufacturer = 'Siemens';
          mfgClass = 'badge-siemens';
        } else if (secondCard.startsWith('enp')) {
          manufacturer = 'Advantech';
          mfgClass = 'badge-advantech';
        }
      } else if (nonLoCards.length === 1) {
        const card = nonLoCards[0];
        if (card === 'eno2') {
          manufacturer = 'Siemens';
          mfgClass = 'badge-siemens';
        } else if (card.startsWith('enp')) {
          manufacturer = 'Advantech';
          mfgClass = 'badge-advantech';
        }
      }
      elManuf.textContent = manufacturer;
      elManuf.className = 'sysinfo-value ' + mfgClass;

      // Parse Ubuntu version
      const ubuntuVer = stdout.split('===UBUNTU===')[1]?.split('===ROS===')[0]?.trim() || 'Unknown';
      elUbuntu.textContent = ubuntuVer;
      document.getElementById('net-ubuntu-ver').value = ubuntuVer;

      // Parse ROS distro
      let rosDistro = stdout.split('===ROS===')[1]?.split('===HOSTNAME===')[0]?.trim() || '';
      if (!rosDistro) {
        // Fallback: check /opt/ros/ directories
        try {
          const rosCheck = await this._exec('ls /opt/ros/ 2>/dev/null | tr "\\n" " "');
          rosDistro = rosCheck.stdout.trim();
        } catch (e) { /* ignore */ }
      }
      elRos.textContent = rosDistro || 'Not installed';

      // Parse hostname
      const hostname = stdout.split('===HOSTNAME===')[1]?.trim() || 'Unknown';
      elHostname.textContent = hostname;

      // Also populate LAN cards list in network tab
      const lanListInput = document.getElementById('net-lan-cards-list');
      if (lanListInput) lanListInput.value = allCards.join(', ');

    } catch (e) {
      elManuf.textContent = 'Error';
      elUbuntu.textContent = 'Error';
      elRos.textContent = 'Error';
      elLan.textContent = 'Error';
      elHostname.textContent = 'Error';
      console.error('[InitSetup] System info load failed:', e);
    }
  },

  async _exec(command) {
    if (!this._sessionId) throw new Error('Not connected');
    // B12 fix: SSH exec은 서버에서 30초 타임아웃이므로 클라이언트는 35초
    const res = await fetchWithTimeout('/api/ssh/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this._sessionId, command })
    }, 35000);
    const result = await res.json();
    if (!result.success) throw new Error(result.message || 'Command failed');
    return result;
  },

  // Execute a command with sudo -S (pipe password via stdin)
  async _sudoExec(command) {
    const pw = this._sshPassword;
    if (!pw) throw new Error('sudo 실행을 위한 비밀번호가 없습니다. 비밀번호를 입력하여 재접속하세요.');
    const escaped = pw.replace(/'/g, "'\\''");
    const result = await this._exec(`printf '%s\\n' '${escaped}' | sudo -S ${command}`);
    if (result.exitCode && result.exitCode !== 0) {
      const errMsg = (result.stderr || '').replace(/\[sudo\].*password.*\n?/gi, '').trim();
      throw new Error(errMsg || `sudo command failed (exit ${result.exitCode})`);
    }
    return result;
  },

  // Write content to a remote file reliably via base64 encoding (avoids heredoc issues over SSH)
  async _writeRemoteFile(filePath, content, { sudo = false } = {}) {
    const b64 = btoa(unescape(encodeURIComponent(content)));
    const CHUNK = 6000;
    const tmp = `/tmp/.initsetup_${Date.now()}`;

    // Step 1: Write base64-decoded content to temp file (no sudo needed for /tmp)
    if (b64.length <= CHUNK) {
      await this._exec(`printf '%s' '${b64}' | base64 -d > ${tmp}`);
    } else {
      const tmpB64 = tmp + '.b64';
      for (let i = 0; i < b64.length; i += CHUNK) {
        const chunk = b64.substring(i, i + CHUNK);
        const op = i === 0 ? '>' : '>>';
        await this._exec(`printf '%s' '${chunk}' ${op} ${tmpB64}`);
      }
      await this._exec(`base64 -d ${tmpB64} > ${tmp} && rm -f ${tmpB64}`);
    }

    // Step 2: Copy to final path
    if (sudo) {
      await this._sudoExec(`cp ${tmp} ${filePath}`);
      await this._exec(`rm -f ${tmp}`);
    } else {
      const r = await this._exec(`mv ${tmp} ${filePath}`);
      if (r.exitCode && r.exitCode !== 0) throw new Error(`Write failed (${filePath}): ${r.stderr || 'exit ' + r.exitCode}`);
    }
  },

  // ==================== .bashrc ====================
  async loadBashrc() {
    const statusEl = document.getElementById('init-setup-bashrc-status');
    statusEl.textContent = 'Loading...';
    try {
      const user = document.getElementById('init-setup-user').value.trim() || 'syscon';
      const result = await this._exec(`cat /home/${user}/.bashrc 2>/dev/null || cat ~/.bashrc 2>/dev/null || echo ""`);
      this._bashrcRaw = result.stdout;
      this._parseBashrc(result.stdout);
      this._renderEnvList();
      statusEl.textContent = `${this._envVars.length} environment variables loaded`;
    } catch (e) {
      statusEl.textContent = 'Failed: ' + e.message;
      App.toast('.bashrc load failed: ' + e.message, 'error');
    }
  },

  _parseBashrc(content) {
    this._envVars = [];
    this._otherLines = [];
    const lines = content.split('\n');

    lines.forEach((line, i) => {
      // Match: export KEY=VALUE or export KEY="VALUE" or export KEY='VALUE'
      const match = line.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) {
        let val = match[2].trim();
        // Strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        this._envVars.push({ key: match[1], value: val, lineIndex: i });
      } else {
        this._otherLines.push({ lineIndex: i, content: line });
      }
    });
  },

  _renderEnvList() {
    const listEl = document.getElementById('init-setup-env-list');
    if (this._envVars.length === 0) {
      listEl.innerHTML = '<p class="init-setup-placeholder">No export variables</p>';
      return;
    }

    listEl.innerHTML = this._envVars.map((v, i) => `
      <div class="init-setup-env-row" data-index="${i}">
        <span class="env-key">${this._escHtml(v.key)}</span>
        <input type="text" class="env-val-input" data-index="${i}" value="${this._escAttr(v.value)}">
        <button class="btn btn-small btn-danger env-del-btn" data-index="${i}" title="Delete">&times;</button>
      </div>
    `).join('');

    // Value change handlers
    listEl.querySelectorAll('.env-val-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        if (this._envVars[idx]) this._envVars[idx].value = e.target.value;
      });
    });

    // Delete handlers
    listEl.querySelectorAll('.env-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this._envVars.splice(idx, 1);
        this._renderEnvList();
      });
    });
  },

  addEnvVar() {
    const keyInput = document.getElementById('init-setup-new-key');
    const valInput = document.getElementById('init-setup-new-val');
    const key = keyInput.value.trim();
    const val = valInput.value;

    if (!key) { App.toast('Please enter variable name', 'error'); return; }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { App.toast('Invalid variable name', 'error'); return; }

    // Check duplicate
    const existing = this._envVars.findIndex(v => v.key === key);
    if (existing >= 0) {
      this._envVars[existing].value = val;
      App.toast(`${key} value updated`, 'info');
    } else {
      this._envVars.push({ key, value: val, lineIndex: -1 });
      App.toast(`${key} added`, 'success');
    }

    keyInput.value = '';
    valInput.value = '';
    this._renderEnvList();
  },

  _rebuildBashrc() {
    // Rebuild: other lines + export lines
    // Keep original order for other lines, append exports at their original positions
    const maxLine = Math.max(
      ...this._otherLines.map(l => l.lineIndex),
      ...this._envVars.filter(v => v.lineIndex >= 0).map(v => v.lineIndex),
      0
    );

    const lines = new Array(maxLine + 1).fill(null);

    // Place other lines
    this._otherLines.forEach(l => {
      if (l.lineIndex >= 0 && l.lineIndex < lines.length) {
        lines[l.lineIndex] = l.content;
      }
    });

    // Place existing export lines at original positions
    this._envVars.forEach(v => {
      if (v.lineIndex >= 0 && v.lineIndex < lines.length) {
        lines[v.lineIndex] = `export ${v.key}="${v.value}"`;
      }
    });

    // Collect result (skip nulls, they were removed lines)
    const result = lines.filter(l => l !== null);

    // Append new vars (lineIndex === -1)
    this._envVars.forEach(v => {
      if (v.lineIndex < 0) {
        result.push(`export ${v.key}="${v.value}"`);
      }
    });

    return result.join('\n');
  },

  async saveBashrc() {
    const statusEl = document.getElementById('init-setup-bashrc-status');
    statusEl.textContent = 'Saving...';
    try {
      const content = this._rebuildBashrc();
      const user = document.getElementById('init-setup-user').value.trim() || 'syscon';
      const bashrcPath = `/home/${user}/.bashrc`;

      // Backup first
      await this._exec(`cp ${bashrcPath} ${bashrcPath}.bak.$(date +%Y%m%d%H%M%S)`);

      // Write via base64 (reliable over SSH)
      await this._writeRemoteFile(bashrcPath, content);

      statusEl.textContent = 'Saved';
      App.toast('.bashrc saved (backup created)', 'success');
    } catch (e) {
      statusEl.textContent = 'Save failed:' + e.message;
      App.toast('.bashrc Save failed:' + e.message, 'error');
    }
  },

  // ==================== /etc/hosts ====================
  async loadHosts() {
    const statusEl = document.getElementById('init-setup-hosts-status');
    statusEl.textContent = 'Loading...';
    try {
      const result = await this._exec('cat /etc/hosts');
      const editor = document.getElementById('init-setup-hosts-editor');
      editor.value = result.stdout;
      statusEl.textContent = 'Loaded';
    } catch (e) {
      statusEl.textContent = 'Failed: ' + e.message;
      App.toast('/etc/hosts load failed: ' + e.message, 'error');
    }
  },

  async saveHosts() {
    const statusEl = document.getElementById('init-setup-hosts-status');
    statusEl.textContent = 'Saving...';
    try {
      const content = document.getElementById('init-setup-hosts-editor').value;

      // Backup
      await this._sudoExec('cp /etc/hosts /etc/hosts.bak.$(date +%Y%m%d%H%M%S)');

      // Write (needs sudo) — base64 for reliability over SSH
      await this._writeRemoteFile('/etc/hosts', content, { sudo: true });

      statusEl.textContent = 'Saved';
      App.toast('/etc/hosts saved (backup created)', 'success');
    } catch (e) {
      statusEl.textContent = 'Save failed:' + e.message;
      App.toast('/etc/hosts Save failed:' + e.message, 'error');
    }
  },

  _escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  _escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  },

  // ==================== Network Settings ====================

  // Parse /etc/network/interfaces into per-interface blocks
  _parseInterfacesFile(content) {
    const blocks = {};
    let currentIf = null;
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      const autoMatch = line.match(/^auto\s+(\S+)/);
      if (autoMatch) {
        currentIf = autoMatch[1];
        if (!blocks[currentIf]) blocks[currentIf] = {};
        continue;
      }
      const ifaceMatch = line.match(/^iface\s+(\S+)\s+inet\s+(\S+)/);
      if (ifaceMatch) {
        currentIf = ifaceMatch[1];
        if (!blocks[currentIf]) blocks[currentIf] = {};
        continue;
      }
      if (!currentIf || line.startsWith('#') || line === '') continue;
      const kvMatch = line.match(/^(\S+)\s+(.+)/);
      if (kvMatch) {
        const key = kvMatch[1];
        const val = kvMatch[2].trim();
        if (key === 'address') blocks[currentIf].address = val;
        else if (key === 'netmask') blocks[currentIf].netmask = val;
        else if (key === 'gateway') blocks[currentIf].gateway = val;
        else if (key === 'dns-nameservers') blocks[currentIf].dns = val;
      }
    }
    return blocks;
  },

  // Replace or append an interface block in /etc/network/interfaces content
  _replaceInterfaceBlock(content, ifName, address, netmask, gateway, dns) {
    let newBlock = `auto ${ifName}\niface ${ifName} inet static\naddress ${address}\nnetmask ${netmask}`;
    if (gateway) newBlock += `\ngateway ${gateway}`;
    if (dns) newBlock += `\ndns-nameservers ${dns}`;

    const lines = content.split('\n');
    let blockStart = -1;
    let blockEnd = lines.length;

    // Find the block boundaries: starts at "auto <ifName>", ends before next "auto" or EOF
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === `auto ${ifName}` || trimmed === `auto ${ifName} `) {
        blockStart = i;
      } else if (blockStart >= 0 && /^auto\s+/.test(trimmed)) {
        blockEnd = i;
        break;
      }
    }

    if (blockStart >= 0) {
      // Remove trailing blank lines of the old block
      while (blockEnd > blockStart + 1 && lines[blockEnd - 1].trim() === '') blockEnd--;
      const before = lines.slice(0, blockStart);
      const after = lines.slice(blockEnd);
      return [...before, newBlock, '', ...after].join('\n');
    }
    // Block not found — append
    return content.replace(/\n*$/, '') + '\n\n' + newBlock + '\n';
  },

  async loadNetworkSettings() {
    const statusEl = document.getElementById('init-setup-network-status');
    statusEl.textContent = 'Loading...';

    // Clear all editable fields first
    ['net-robot-id', 'net-lan-card', 'net-ip', 'net-gateway', 'net-dns', 'net-robot-model', 'net-plc-ip'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('net-subnet').value = '255.255.255.0';

    try {
      const user = document.getElementById('init-setup-user').value.trim() || 'syscon';

      // Ubuntu version (already loaded by _loadSystemInfo, re-read if missing)
      let ubuntuVer = document.getElementById('net-ubuntu-ver').value;
      if (!ubuntuVer || ubuntuVer === 'Unknown') {
        const ubuntuRes = await this._exec('lsb_release -rs 2>/dev/null');
        ubuntuVer = ubuntuRes.stdout.trim() || 'Unknown';
        document.getElementById('net-ubuntu-ver').value = ubuntuVer;
      }

      // ── bashrc: ROS env vars ──
      const bashrcRes = await this._exec(`cat /home/${user}/.bashrc 2>/dev/null || cat ~/.bashrc 2>/dev/null || echo ""`);
      const bashrc = bashrcRes.stdout;
      const ridMatch = bashrc.match(/export\s+ROS_HOSTNAME=([^\s\n]+)/);
      if (ridMatch) document.getElementById('net-robot-id').value = ridMatch[1];
      const modelMatch = bashrc.match(/export\s+ROBOT_MODEL=([^\s\n]+)/);
      if (modelMatch) document.getElementById('net-robot-model').value = modelMatch[1];
      const plcMatch = bashrc.match(/export\s+PLC_IP=([^\s\n]+)/);
      if (plcMatch) document.getElementById('net-plc-ip').value = plcMatch[1];

      // ── Network config ──
      let netConfigFound = false;

      if (ubuntuVer.startsWith('18') || ubuntuVer.startsWith('20') || ubuntuVer.startsWith('22')) {
        // ─── Ubuntu 18.04+ (melodic/noetic) — netplan ───
        const netplanRes = await this._exec('cat /etc/netplan/01-scorpion-config.yaml 2>/dev/null || echo ""');
        const nc = netplanRes.stdout.trim();
        if (nc) {
          const ethRegex = /^\s+(eno\d+|enp\w+|wlp\w+):/gm;
          let m;
          while ((m = ethRegex.exec(nc)) !== null) {
            if (m[1] === 'eno1') continue;
            netConfigFound = true;
            document.getElementById('net-lan-card').value = m[1];
            const afterIf = nc.substring(m.index);
            const addrM = afterIf.match(/addresses:\s*\[\s*"?([0-9./]+)/);
            if (addrM) {
              const parts = addrM[1].split('/');
              document.getElementById('net-ip').value = parts[0];
              if (parts[1]) document.getElementById('net-subnet').value = this._prefixToSubnet(parseInt(parts[1]));
            }
            const gwM = afterIf.match(/gateway4:\s*([0-9.]+)/);
            if (gwM) document.getElementById('net-gateway').value = gwM[1];
            const dnsM = afterIf.match(/nameservers:[\s\S]*?addresses:\s*\[([^\]]+)\]/);
            if (dnsM) document.getElementById('net-dns').value = dnsM[1].replace(/["']/g, '').split(',').map(s => s.trim()).join(' ');
            break;
          }
        }
      } else {
        // ─── Ubuntu 16.04 (kinetic) — /etc/network/interfaces ───
        const ifRes = await this._exec('cat /etc/network/interfaces 2>/dev/null || echo ""');
        const ifContent = ifRes.stdout.trim();
        if (ifContent) {
          const blocks = this._parseInterfacesFile(ifContent);
          // Find the second interface (not eno1, not lo)
          const secondIf = Object.keys(blocks).find(n => n !== 'eno1' && n !== 'lo');
          if (secondIf) {
            netConfigFound = true;
            const b = blocks[secondIf];
            document.getElementById('net-lan-card').value = secondIf;
            if (b.address) document.getElementById('net-ip').value = b.address;
            if (b.netmask) document.getElementById('net-subnet').value = b.netmask;
            if (b.gateway) document.getElementById('net-gateway').value = b.gateway;
            if (b.dns) document.getElementById('net-dns').value = b.dns;
          }
        }
      }

      if (netConfigFound) {
        statusEl.textContent = 'Loaded';
        App.toast('Network settings loaded', 'success');
      } else {
        statusEl.textContent = '두 번째 네트워크 인터페이스가 설정되어 있지 않습니다';
        App.toast('두 번째 네트워크 인터페이스 설정이 없습니다', 'warning');
      }
    } catch (e) {
      statusEl.textContent = 'Failed: ' + e.message;
      App.toast('Network settings load failed: ' + e.message, 'error');
    }
  },

  _prefixToSubnet(prefix) {
    const mask = [];
    for (let i = 0; i < 4; i++) {
      const n = Math.min(prefix, 8);
      mask.push(256 - Math.pow(2, 8 - n));
      prefix -= n;
    }
    return mask.join('.');
  },

  _subnetToPrefix(subnet) {
    let prefix = 0;
    subnet.split('.').forEach(octet => {
      const bits = parseInt(octet).toString(2);
      prefix += (bits.match(/1/g) || []).length;
    });
    return prefix;
  },

  async applyNetworkSettings() {
    const statusEl = document.getElementById('init-setup-network-status');
    statusEl.textContent = 'Applying...';

    try {
      // Validate required fields
      const robotId = document.getElementById('net-robot-id').value.trim();
      const lanCard = document.getElementById('net-lan-card').value.trim();
      const ip = document.getElementById('net-ip').value.trim();
      const subnet = document.getElementById('net-subnet').value.trim();

      if (!robotId || !lanCard || !ip || !subnet) {
        throw new Error('Robot ID, LAN Card, IP, and Subnet are required');
      }

      // Validate IP format
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipRegex.test(ip) || !ipRegex.test(subnet)) {
        throw new Error('Invalid IP address or subnet mask format');
      }

      // Optional fields
      const gateway = document.getElementById('net-gateway').value.trim();
      const dns = document.getElementById('net-dns').value.trim();
      const robotModel = document.getElementById('net-robot-model').value.trim();
      const plcIp = document.getElementById('net-plc-ip').value.trim();

      const user = document.getElementById('init-setup-user').value.trim() || 'syscon';
      const ubuntuVer = document.getElementById('net-ubuntu-ver').value;

      statusEl.textContent = 'Step 1/5: Updating network config...';

      // 1. Update network configuration
      if (ubuntuVer.startsWith('18') || ubuntuVer.startsWith('20') || ubuntuVer.startsWith('22')) {
        // ─── Ubuntu 18.04+ — netplan ───
        await this._sudoExec('cp /etc/netplan/01-scorpion-config.yaml /etc/netplan/01-scorpion-config.yaml.bak.$(date +%Y%m%d%H%M%S) 2>/dev/null; true');
        const prefix = this._subnetToPrefix(subnet);
        let netplanConfig = `network:\n  version: 2\n  renderer: networkd\n  ethernets:\n`;
        netplanConfig += `    eno1:\n      dhcp4: false\n      addresses: ["192.168.3.5/24"]\n`;
        netplanConfig += `    ${lanCard}:\n      dhcp4: false\n      addresses: ["${ip}/${prefix}"]\n`;
        if (gateway) netplanConfig += `      gateway4: ${gateway}\n`;
        if (dns) {
          const dnsList = dns.split(/\s+/).map(d => `"${d}"`).join(', ');
          netplanConfig += `      nameservers:\n        addresses: [${dnsList}]\n`;
        }
        await this._writeRemoteFile('/etc/netplan/01-scorpion-config.yaml', netplanConfig, { sudo: true });
      } else {
        // ─── Ubuntu 16.04 (kinetic) — /etc/network/interfaces (in-place modify) ───
        await this._sudoExec('cp /etc/network/interfaces /etc/network/interfaces.bak.$(date +%Y%m%d%H%M%S)');
        const ifRes = await this._exec('cat /etc/network/interfaces 2>/dev/null || echo ""');
        const currentContent = ifRes.stdout;
        const newContent = this._replaceInterfaceBlock(currentContent, lanCard, ip, subnet, gateway, dns);
        await this._writeRemoteFile('/etc/network/interfaces', newContent, { sudo: true });
      }

      statusEl.textContent = 'Step 2/5: Updating .bashrc...';

      // 2. Update .bashrc
      const bashrcPath = `/home/${user}/.bashrc`;
      await this._exec(`cp ${bashrcPath} ${bashrcPath}.bak.$(date +%Y%m%d%H%M%S)`);
      await this._exec(`sed -i "s|.*export ROS_MASTER_URI.*|export ROS_MASTER_URI=http://${robotId}:11311|" ${bashrcPath}`);
      await this._exec(`sed -i "s|.*export ROS_HOSTNAME.*|export ROS_HOSTNAME=${robotId}|" ${bashrcPath}`);

      if (robotModel) {
        const hasModel = await this._exec(`grep -c "ROBOT_MODEL" ${bashrcPath} || echo 0`);
        if (parseInt(hasModel.stdout) > 0) {
          await this._exec(`sed -i "s|.*export ROBOT_MODEL.*|export ROBOT_MODEL=${robotModel}|" ${bashrcPath}`);
        } else {
          await this._exec(`echo "export ROBOT_MODEL=${robotModel}" >> ${bashrcPath}`);
        }
      }

      if (plcIp) {
        const hasPlc = await this._exec(`grep -c "PLC_IP" ${bashrcPath} || echo 0`);
        if (parseInt(hasPlc.stdout) > 0) {
          await this._exec(`sed -i "s|.*export PLC_IP.*|export PLC_IP=${plcIp}|" ${bashrcPath}`);
        } else {
          await this._exec(`echo "export PLC_IP=${plcIp}" >> ${bashrcPath}`);
        }
      }

      statusEl.textContent = 'Step 3/5: Updating scorpion.sh...';

      // 3. Update scorpion.sh
      const scorpionPath = `/home/${user}/scorpion.sh`;
      const hasScorpion = await this._exec(`test -f ${scorpionPath} && echo 1 || echo 0`);
      if (hasScorpion.stdout.trim() === '1') {
        await this._exec(`sed -i "s|.*TMP=\`hostname.*|TMP=\`hostname -I | awk '{for (i=1; i<=NF; i++) if(index($i,\\"${ip}\\")!=0) print $i}'\`|" ${scorpionPath}`);
        await this._exec(`sed -i "s|.*export ROS_MASTER_URI.*|export ROS_MASTER_URI=http://${robotId}:11311|" ${scorpionPath}`);
        await this._exec(`sed -i "s|.*export ROS_HOSTNAME.*|export ROS_HOSTNAME=${robotId}|" ${scorpionPath}`);
        if (robotModel) {
          await this._exec(`sed -i "s|.*export ROBOT_MODEL.*|export ROBOT_MODEL=${robotModel}|" ${scorpionPath}`);
        }
        if (plcIp) {
          await this._exec(`sed -i "s|.*export PLC_IP.*|export PLC_IP=${plcIp}|" ${scorpionPath}`);
        }
      }

      statusEl.textContent = 'Step 4/5: Updating /etc/hosts...';

      // 4. Update /etc/hosts
      await this._sudoExec(`cp /etc/hosts /etc/hosts.bak.$(date +%Y%m%d%H%M%S)`);
      await this._sudoExec(`sed -i "/${robotId}/d" /etc/hosts`);
      await this._sudoExec(`sed -i "/${ip}/d" /etc/hosts`);
      await this._sudoExec(`sed -i "/127.0.1.1/a ${ip}  ${robotId}" /etc/hosts`);

      if (plcIp) {
        await this._sudoExec(`sed -i "/plc/d" /etc/hosts`);
        await this._sudoExec(`sed -i "/${plcIp}/d" /etc/hosts`);
        await this._sudoExec(`sed -i "/127.0.1.1/a ${plcIp}  plc" /etc/hosts`);
      }

      statusEl.textContent = 'Step 5/5: Saving config...';

      // 5. Save config to ~/ROS_DB/network/config
      const configDir = `/home/${user}/ROS_DB/network`;
      await this._exec(`mkdir -p ${configDir}`);
      const configData = JSON.stringify({
        robot_id: robotId,
        robot_ip: ip,
        subnet_mask: subnet,
        lan_card: lanCard,
        gateway: gateway || '',
        dns: dns || '',
        robot_model: robotModel || '',
        plc_ip: plcIp || ''
      });
      await this._writeRemoteFile(`${configDir}/config`, configData);

      statusEl.textContent = 'Applied successfully';
      App.toast('Network settings applied! Reboot required for changes to take effect.', 'success');
    } catch (e) {
      statusEl.textContent = 'Apply failed: ' + e.message;
      App.toast('Network settings apply failed: ' + e.message, 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  InitSetup.init();
});
