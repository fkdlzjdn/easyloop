// Map File Manager - Manage map files on robot
const MapFileManager = {
  MAP_DIR: '~/ROS_DB/map/map_list',

  init() {
    this.setupUI();
  },

  setupUI() {
    const btn = document.getElementById('btn-map-manager');
    if (btn) {
      btn.addEventListener('click', () => this.showModal());
    }
  },

  showModal() {
    let modal = document.getElementById('map-manager-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'map-manager-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content map-manager-modal-content">
          <div class="modal-header">
            <h3>Map File Manager</h3>
            <button class="modal-close" id="btn-map-manager-close">&times;</button>
          </div>
          <div class="map-manager-body">
            <div class="map-manager-controls">
              <input type="text" id="map-dir-path" value="${this.MAP_DIR}" class="map-dir-input">
              <button id="btn-refresh-maps" class="btn btn-small">Refresh</button>
              <button id="btn-upload-map" class="btn btn-small btn-primary">Upload Map</button>
              <input type="file" id="map-upload-input" accept=".pgm,.yaml,.png" multiple style="display:none">
            </div>
            <div id="map-file-list" class="map-file-list"></div>
            <div class="map-preview-section" id="map-preview-section" style="display:none">
              <h4>Map Preview</h4>
              <div id="map-preview-container" class="map-preview-container"></div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-map-manager-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      modal.querySelector('#btn-refresh-maps').addEventListener('click', () => this.refreshMapList());
      modal.querySelector('#btn-upload-map').addEventListener('click', () => {
        document.getElementById('map-upload-input').click();
      });
      modal.querySelector('#map-upload-input').addEventListener('change', (e) => this.uploadMaps(e.target.files));
    }

    this.refreshMapList();
    modal.classList.add('active');
  },

  async refreshMapList() {
    const list = document.getElementById('map-file-list');
    const dirPath = document.getElementById('map-dir-path').value.trim();

    list.innerHTML = '<div class="map-loading">Loading maps...</div>';

    try {
      // List directories in map_list folder
      const result = await SSHTerminal.execCommand(`ls -la ${dirPath} 2>/dev/null | grep "^d" | tail -20`);

      if (result.success && result.stdout && result.stdout.trim()) {
        const lines = result.stdout.trim().split('\n');
        const dirs = lines.filter(line => {
          const parts = line.split(/\s+/);
          const name = parts[parts.length - 1];
          return name && name !== '.' && name !== '..';
        }).map(line => {
          const parts = line.split(/\s+/);
          const name = parts[parts.length - 1];
          const date = `${parts[5]} ${parts[6]} ${parts[7]}`;
          return { name, date };
        });

        if (dirs.length === 0) {
          list.innerHTML = '<div class="map-empty">No map folders found</div>';
          return;
        }

        list.innerHTML = dirs.map(dir => `
          <div class="map-folder-item">
            <div class="map-folder-icon">📁</div>
            <div class="map-folder-info">
              <span class="map-folder-name">${dir.name}</span>
              <span class="map-folder-date">${dir.date}</span>
            </div>
            <div class="map-folder-actions">
              <button class="btn btn-mini" onclick="MapFileManager.previewMap('${dir.name}')">Preview</button>
              <button class="btn btn-mini" onclick="MapFileManager.downloadMap('${dir.name}')">Download</button>
              <button class="btn btn-mini" onclick="MapFileManager.loadMap('${dir.name}')">Load</button>
              <button class="btn btn-mini btn-danger" onclick="MapFileManager.deleteMap('${dir.name}')">Delete</button>
            </div>
          </div>
        `).join('');
      } else {
        list.innerHTML = '<div class="map-empty">No maps found in ' + dirPath + '</div>';
      }
    } catch (e) {
      list.innerHTML = '<div class="map-error">Error: ' + e.message + '</div>';
    }
  },

  async previewMap(mapName) {
    const dirPath = document.getElementById('map-dir-path').value.trim();
    const previewSection = document.getElementById('map-preview-section');
    const container = document.getElementById('map-preview-container');

    previewSection.style.display = 'block';
    container.innerHTML = '<div class="map-loading">Loading preview...</div>';

    try {
      // Get map.yaml content
      const yamlResult = await SSHTerminal.execCommand(`cat ${dirPath}/${mapName}/map.yaml 2>/dev/null`);

      if (yamlResult.success && yamlResult.stdout) {
        // Parse YAML manually (basic)
        const yamlContent = yamlResult.stdout;
        const resolution = yamlContent.match(/resolution:\s*([\d.]+)/);
        const origin = yamlContent.match(/origin:\s*\[([-\d.,\s]+)\]/);
        const imageFile = yamlContent.match(/image:\s*(.+)/);

        container.innerHTML = `
          <div class="map-preview-info">
            <h5>Map: ${mapName}</h5>
            <p><strong>Image:</strong> ${imageFile ? imageFile[1].trim() : 'N/A'}</p>
            <p><strong>Resolution:</strong> ${resolution ? resolution[1] : 'N/A'} m/pixel</p>
            <p><strong>Origin:</strong> ${origin ? origin[1] : 'N/A'}</p>
          </div>
          <div class="map-preview-yaml">
            <pre>${this._escapeHtml(yamlContent)}</pre>
          </div>
        `;
      } else {
        container.innerHTML = '<div class="map-error">Failed to load map.yaml</div>';
      }
    } catch (e) {
      container.innerHTML = '<div class="map-error">Error: ' + e.message + '</div>';
    }
  },

  async downloadMap(mapName) {
    const dirPath = document.getElementById('map-dir-path').value.trim();
    App.toast('Preparing download...', 'info');

    try {
      // Create tar archive of the map folder
      const tarName = `${mapName}.tar.gz`;
      const tarResult = await SSHTerminal.execCommand(`cd ${dirPath} && tar -czf /tmp/${tarName} ${mapName}`);

      if (tarResult.success) {
        // Download the tar file
        if (typeof FileTransfer !== 'undefined') {
          await FileTransfer.download(`/tmp/${tarName}`);
          // Cleanup
          await SSHTerminal.execCommand(`rm -f /tmp/${tarName}`);
        } else {
          App.toast('File transfer not available', 'error');
        }
      } else {
        App.toast('Failed to create archive', 'error');
      }
    } catch (e) {
      App.toast('Error: ' + e.message, 'error');
    }
  },

  async loadMap(mapName) {
    if (!confirm(`Load map "${mapName}" on robot?\nThis will call TARU/change_map service.`)) return;

    try {
      // Call ROS service to change map
      const robotId = (typeof RosManager !== 'undefined' && RosManager.getRobotId) ?
        RosManager.getRobotId(App.activeSlotIndex) : 'R_001';

      // Use ActionSender style service call
      const ros = typeof RosManager !== 'undefined' ? RosManager.getRos(App.activeSlotIndex) : null;

      if (ros) {
        const service = new ROSLIB.Service({
          ros: ros,
          name: `/${robotId}/TARU/change_map`,
          serviceType: 'syscon_msgs/String_srv'
        });

        service.callService({ data: mapName }, (result) => {
          if (result.success) {
            App.toast(`Map "${mapName}" loaded successfully`, 'success');
            // Unlock map and re-subscribe after map_server restarts
            setTimeout(() => {
              if (typeof RosManager !== 'undefined') {
                RosManager._mapLocked = false;
                RosManager._resubscribeMapTopic();
              }
            }, 3000);
          } else {
            App.toast(`Failed to load map: ${result.message}`, 'error');
          }
        }, (error) => {
          App.toast(`Service error: ${error}`, 'error');
        });
      } else {
        App.toast('ROS not connected', 'error');
      }
    } catch (e) {
      App.toast('Error: ' + e.message, 'error');
    }
  },

  async deleteMap(mapName) {
    if (!confirm(`Delete map "${mapName}"?\nThis cannot be undone.`)) return;

    const dirPath = document.getElementById('map-dir-path').value.trim();

    try {
      await SSHTerminal.execCommand(`rm -rf ${dirPath}/${mapName}`);
      App.toast(`Map "${mapName}" deleted`, 'success');
      this.refreshMapList();
    } catch (e) {
      App.toast('Error: ' + e.message, 'error');
    }
  },

  async uploadMaps(files) {
    if (!files || files.length === 0) return;

    const dirPath = document.getElementById('map-dir-path').value.trim();
    App.toast(`Uploading ${files.length} file(s)...`, 'info');

    for (const file of files) {
      try {
        if (typeof FileTransfer !== 'undefined') {
          // Create folder if uploading pgm/yaml pair
          // Upload to temp then move
          const connResult = await FileTransfer.ensureConnection();
          if (!connResult.success) {
            App.toast('Connection failed', 'error');
            return;
          }

          const formData = new FormData();
          formData.append('file', file);
          formData.append('sessionId', FileTransfer.sessionId);
          formData.append('remotePath', dirPath);

          // B12 fix: fetch 타임아웃 적용 (업로드 60초)
          const res = await fetchWithTimeout('/api/sftp/upload', {
            method: 'POST',
            body: formData
          }, 60000);

          const result = await res.json();
          if (result.success) {
            App.toast(`Uploaded: ${file.name}`, 'success');
          } else {
            App.toast(`Failed: ${file.name}`, 'error');
          }
        }
      } catch (e) {
        App.toast(`Error uploading ${file.name}: ${e.message}`, 'error');
      }
    }

    this.refreshMapList();
  },

  _escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  MapFileManager.init();
});
