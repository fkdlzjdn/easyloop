// Map Version Control - Track map file versions and history
const MapVersionControl = {
  STORAGE_KEY: 'amrMapVersions',
  _versions: [],  // [{id, name, timestamp, robotId, size, checksum, note}]

  init() {
    this._versions = this.loadVersions();
    this.setupUI();
  },

  loadVersions() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  saveVersions() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._versions));
    } catch (e) {
      console.error('Failed to save map versions', e);
    }
  },

  setupUI() {
    const btn = document.getElementById('btn-map-version');
    if (btn) {
      btn.addEventListener('click', () => this.showModal());
    }
  },

  showModal() {
    let modal = document.getElementById('map-version-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'map-version-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content map-version-modal-content">
          <div class="modal-header">
            <h3>Map Version Control</h3>
            <button class="modal-close" id="map-version-close">&times;</button>
          </div>
          <div class="map-version-body">
            <div class="map-version-actions">
              <button id="btn-map-snapshot" class="btn btn-small btn-primary">Save Current Map</button>
              <button id="btn-map-version-refresh" class="btn btn-small">Refresh</button>
            </div>
            <div id="map-version-list" class="map-version-list"></div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#map-version-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      modal.querySelector('#btn-map-snapshot').addEventListener('click', () => this.saveCurrentMap());
      modal.querySelector('#btn-map-version-refresh').addEventListener('click', () => this.refreshFromRobot());
    }

    this.renderVersionList();
    modal.classList.add('active');
  },

  async saveCurrentMap() {
    const robotId = RosManager.getRobotId();
    if (!robotId) {
      App.toast('No robot connected', 'warning');
      return;
    }

    // Get note from user
    const note = prompt('Enter version note (optional):') || '';

    App.toast('Saving map snapshot...', 'info');

    try {
      // Get map file info from robot
      const result = await SSHTerminal.execCommand('ls -la ~/ROS_DB/map/*.pgm 2>/dev/null | head -5');

      if (!result.success || !result.stdout.trim()) {
        App.toast('No map files found on robot', 'warning');
        return;
      }

      const lines = result.stdout.trim().split('\n');
      const mapFiles = [];

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          const size = parseInt(parts[4]) || 0;
          const name = parts[parts.length - 1].split('/').pop();
          mapFiles.push({ name, size });
        }
      }

      if (mapFiles.length === 0) {
        App.toast('No PGM files found', 'warning');
        return;
      }

      // Calculate simple checksum using file size and date
      const checksumResult = await SSHTerminal.execCommand('md5sum ~/ROS_DB/map/*.pgm 2>/dev/null | head -5');
      const checksums = {};
      if (checksumResult.success && checksumResult.stdout) {
        checksumResult.stdout.trim().split('\n').forEach(line => {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) {
            const checksum = parts[0];
            const filename = parts[1].split('/').pop();
            checksums[filename] = checksum.substring(0, 8);
          }
        });
      }

      // Create version entry
      const version = {
        id: Date.now(),
        name: mapFiles[0].name,
        timestamp: new Date().toISOString(),
        robotId: robotId,
        size: mapFiles[0].size,
        checksum: checksums[mapFiles[0].name] || 'unknown',
        note: note,
        files: mapFiles.map(f => ({
          name: f.name,
          size: f.size,
          checksum: checksums[f.name] || 'unknown'
        }))
      };

      this._versions.unshift(version);

      // Keep only last 50 versions
      if (this._versions.length > 50) {
        this._versions = this._versions.slice(0, 50);
      }

      this.saveVersions();
      this.renderVersionList();
      App.toast('Map version saved', 'success');

    } catch (e) {
      App.toast('Failed to save map snapshot: ' + e.message, 'error');
    }
  },

  async refreshFromRobot() {
    const robotId = RosManager.getRobotId();
    if (!robotId) {
      App.toast('No robot connected', 'warning');
      return;
    }

    App.toast('Scanning robot map files...', 'info');

    try {
      const result = await SSHTerminal.execCommand('ls -la ~/ROS_DB/map/*.pgm 2>/dev/null');

      if (!result.success || !result.stdout.trim()) {
        App.toast('No map files found', 'info');
        return;
      }

      this.renderVersionList();
      App.toast('Map list refreshed', 'success');
    } catch (e) {
      App.toast('Failed to refresh: ' + e.message, 'error');
    }
  },

  renderVersionList() {
    const listEl = document.getElementById('map-version-list');
    if (!listEl) return;

    if (this._versions.length === 0) {
      listEl.innerHTML = '<div class="map-version-empty">No saved versions</div>';
      return;
    }

    listEl.innerHTML = this._versions.map((v, i) => `
      <div class="map-version-item" data-idx="${i}">
        <div class="map-version-main">
          <div class="map-version-name">${this.escapeHtml(v.name)}</div>
          <div class="map-version-meta">
            <span class="mv-robot">${this.escapeHtml(v.robotId || '-')}</span>
            <span class="mv-size">${this.formatSize(v.size)}</span>
            <span class="mv-checksum">${v.checksum}</span>
          </div>
          <div class="map-version-time">${new Date(v.timestamp).toLocaleString('ko-KR')}</div>
          ${v.note ? `<div class="map-version-note">${this.escapeHtml(v.note)}</div>` : ''}
        </div>
        <div class="map-version-actions">
          <button class="btn btn-tiny btn-mv-restore" data-idx="${i}" title="Restore this version">Restore</button>
          <button class="btn btn-tiny btn-mv-compare" data-idx="${i}" title="Compare with current">Compare</button>
          <button class="btn btn-tiny btn-danger btn-mv-delete" data-idx="${i}" title="Delete">×</button>
        </div>
      </div>
    `).join('');

    // Bind event handlers
    listEl.querySelectorAll('.btn-mv-restore').forEach(btn => {
      btn.addEventListener('click', () => this.restoreVersion(parseInt(btn.dataset.idx)));
    });

    listEl.querySelectorAll('.btn-mv-compare').forEach(btn => {
      btn.addEventListener('click', () => this.compareVersion(parseInt(btn.dataset.idx)));
    });

    listEl.querySelectorAll('.btn-mv-delete').forEach(btn => {
      btn.addEventListener('click', () => this.deleteVersion(parseInt(btn.dataset.idx)));
    });
  },

  async restoreVersion(idx) {
    const version = this._versions[idx];
    if (!version) return;

    if (!confirm(`Restore map version from ${new Date(version.timestamp).toLocaleString()}?\n\nNote: This will download the backup if available.`)) {
      return;
    }

    App.toast('Version restore functionality requires backup files on server', 'info');
  },

  async compareVersion(idx) {
    const version = this._versions[idx];
    if (!version) return;

    // Get current map checksum
    const result = await SSHTerminal.execCommand(`md5sum ~/ROS_DB/map/${version.name} 2>/dev/null`);

    if (!result.success || !result.stdout) {
      App.toast('Cannot compare - file not found', 'warning');
      return;
    }

    const currentChecksum = result.stdout.trim().split(/\s+/)[0].substring(0, 8);

    if (currentChecksum === version.checksum) {
      App.toast('Map is identical to saved version', 'success');
    } else {
      App.toast(`Map differs from saved version\nCurrent: ${currentChecksum}\nSaved: ${version.checksum}`, 'warning');
    }
  },

  deleteVersion(idx) {
    if (!confirm('Delete this version record?')) return;

    this._versions.splice(idx, 1);
    this.saveVersions();
    this.renderVersionList();
    App.toast('Version deleted', 'success');
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  formatSize(bytes) {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  MapVersionControl.init();
});
