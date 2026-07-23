// Rosbag Remote Control - Record and playback rosbag files on robot
const RosbagControl = {
  _isRecording: false,
  _recordingTopics: [],
  _rosbagPath: '~/ROS_DB/rosbag',

  init() {
    this.setupModal();
  },

  setupModal() {
    const btn = document.getElementById('btn-rosbag');
    if (btn) {
      btn.addEventListener('click', () => this.showModal());
    }
  },

  showModal() {
    let modal = document.getElementById('rosbag-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'rosbag-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content rosbag-modal-content">
          <div class="modal-header">
            <h3>Rosbag Control</h3>
            <button class="modal-close" id="btn-rosbag-close">&times;</button>
          </div>
          <div class="rosbag-tabs">
            <button class="rosbag-tab active" data-tab="record">Record</button>
            <button class="rosbag-tab" data-tab="play">Play</button>
            <button class="rosbag-tab" data-tab="files">Files</button>
          </div>
          <div class="rosbag-content">
            <div id="rosbag-record-tab" class="rosbag-tab-content active">
              <div class="rosbag-section">
                <label>Output Path:</label>
                <input type="text" id="rosbag-output-path" value="~/ROS_DB/rosbag" class="rosbag-input">
              </div>
              <div class="rosbag-section">
                <label>Bag Name:</label>
                <input type="text" id="rosbag-name" placeholder="auto-generated if empty" class="rosbag-input">
              </div>
              <div class="rosbag-section">
                <label>Topics (comma-separated, empty = all):</label>
                <textarea id="rosbag-topics" rows="3" placeholder="/odom, /scan, /tf" class="rosbag-input"></textarea>
              </div>
              <div class="rosbag-section">
                <label>Duration (seconds, 0 = manual stop):</label>
                <input type="number" id="rosbag-duration" value="0" min="0" class="rosbag-input">
              </div>
              <div class="rosbag-actions">
                <button id="btn-rosbag-start" class="btn btn-primary">⏺ Start Recording</button>
                <button id="btn-rosbag-stop" class="btn btn-danger" disabled>⏹ Stop Recording</button>
              </div>
              <div id="rosbag-record-status" class="rosbag-status"></div>
            </div>
            <div id="rosbag-play-tab" class="rosbag-tab-content">
              <div class="rosbag-section">
                <label>Bag File Path:</label>
                <input type="text" id="rosbag-play-path" placeholder="/home/user/ROS_DB/rosbag/example.bag" class="rosbag-input">
              </div>
              <div class="rosbag-section">
                <label>Playback Rate:</label>
                <input type="number" id="rosbag-play-rate" value="1.0" min="0.1" max="10" step="0.1" class="rosbag-input">
              </div>
              <div class="rosbag-section">
                <label>
                  <input type="checkbox" id="rosbag-play-loop"> Loop playback
                </label>
              </div>
              <div class="rosbag-actions">
                <button id="btn-rosbag-play" class="btn btn-primary">▶ Play</button>
                <button id="btn-rosbag-pause" class="btn" disabled>⏸ Pause</button>
                <button id="btn-rosbag-stop-play" class="btn btn-danger" disabled>⏹ Stop</button>
              </div>
              <div id="rosbag-play-status" class="rosbag-status"></div>
            </div>
            <div id="rosbag-files-tab" class="rosbag-tab-content">
              <div class="rosbag-section">
                <label>Directory:</label>
                <div class="rosbag-dir-row">
                  <input type="text" id="rosbag-dir-path" value="~/ROS_DB/rosbag" class="rosbag-input">
                  <button id="btn-rosbag-refresh" class="btn btn-small">Refresh</button>
                </div>
              </div>
              <div id="rosbag-file-list" class="rosbag-file-list"></div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Tab switching
      modal.querySelectorAll('.rosbag-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          modal.querySelectorAll('.rosbag-tab').forEach(t => t.classList.remove('active'));
          modal.querySelectorAll('.rosbag-tab-content').forEach(c => c.classList.remove('active'));
          tab.classList.add('active');
          document.getElementById(`rosbag-${tab.dataset.tab}-tab`).classList.add('active');
        });
      });

      // Close handlers
      modal.querySelector('#btn-rosbag-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      // Record handlers
      modal.querySelector('#btn-rosbag-start').addEventListener('click', () => this.startRecording());
      modal.querySelector('#btn-rosbag-stop').addEventListener('click', () => this.stopRecording());

      // Play handlers
      modal.querySelector('#btn-rosbag-play').addEventListener('click', () => this.startPlayback());
      modal.querySelector('#btn-rosbag-stop-play').addEventListener('click', () => this.stopPlayback());

      // File list handlers
      modal.querySelector('#btn-rosbag-refresh').addEventListener('click', () => this.refreshFileList());
    }

    modal.classList.add('active');
    this.refreshFileList();
  },

  async startRecording() {
    const outputPath = document.getElementById('rosbag-output-path').value.trim() || '~/ROS_DB/rosbag';
    const bagName = document.getElementById('rosbag-name').value.trim();
    const topics = document.getElementById('rosbag-topics').value.trim();
    const duration = parseInt(document.getElementById('rosbag-duration').value) || 0;

    // Build rosbag record command
    let cmd = 'rosbag record';

    // Output path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = bagName || `bag_${timestamp}`;
    cmd += ` -O ${outputPath}/${filename}`;

    // Topics
    if (topics) {
      const topicList = topics.split(',').map(t => t.trim()).filter(t => t);
      cmd += ' ' + topicList.join(' ');
    } else {
      cmd += ' -a'; // All topics
    }

    // Duration
    if (duration > 0) {
      cmd += ` --duration=${duration}`;
    }

    // Add background execution
    cmd += ' &';

    const status = document.getElementById('rosbag-record-status');
    status.textContent = 'Starting recording...';
    status.className = 'rosbag-status';

    try {
      const result = await SSHTerminal.execCommand(cmd);

      if (result.success) {
        this._isRecording = true;
        document.getElementById('btn-rosbag-start').disabled = true;
        document.getElementById('btn-rosbag-stop').disabled = false;
        status.textContent = `Recording to: ${outputPath}/${filename}.bag`;
        status.className = 'rosbag-status success';
        App.toast('Rosbag recording started', 'success');

        // Audit log
        if (typeof App !== 'undefined' && App.logAudit) {
          App.logAudit('rosbag_record_start', { path: `${outputPath}/${filename}.bag`, topics: topics || 'all' });
        }
      } else {
        status.textContent = 'Failed to start recording: ' + (result.message || result.stderr);
        status.className = 'rosbag-status error';
      }
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      status.className = 'rosbag-status error';
    }
  },

  async stopRecording() {
    const status = document.getElementById('rosbag-record-status');
    status.textContent = 'Stopping recording...';

    try {
      // Kill rosbag record process
      const result = await SSHTerminal.execCommand('pkill -f "rosbag record"');

      this._isRecording = false;
      document.getElementById('btn-rosbag-start').disabled = false;
      document.getElementById('btn-rosbag-stop').disabled = true;
      status.textContent = 'Recording stopped';
      status.className = 'rosbag-status';
      App.toast('Rosbag recording stopped', 'success');

      // Refresh file list
      this.refreshFileList();
    } catch (e) {
      status.textContent = 'Error stopping: ' + e.message;
      status.className = 'rosbag-status error';
    }
  },

  async startPlayback() {
    const bagPath = document.getElementById('rosbag-play-path').value.trim();
    const rate = parseFloat(document.getElementById('rosbag-play-rate').value) || 1.0;
    const loop = document.getElementById('rosbag-play-loop').checked;

    if (!bagPath) {
      App.toast('Please enter bag file path', 'error');
      return;
    }

    let cmd = `rosbag play ${bagPath} -r ${rate}`;
    if (loop) cmd += ' -l';
    cmd += ' &';

    const status = document.getElementById('rosbag-play-status');
    status.textContent = 'Starting playback...';

    try {
      const result = await SSHTerminal.execCommand(cmd);

      if (result.success) {
        document.getElementById('btn-rosbag-play').disabled = true;
        document.getElementById('btn-rosbag-stop-play').disabled = false;
        status.textContent = `Playing: ${bagPath}`;
        status.className = 'rosbag-status success';
        App.toast('Rosbag playback started', 'success');
      } else {
        status.textContent = 'Failed: ' + (result.message || result.stderr);
        status.className = 'rosbag-status error';
      }
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      status.className = 'rosbag-status error';
    }
  },

  async stopPlayback() {
    const status = document.getElementById('rosbag-play-status');

    try {
      await SSHTerminal.execCommand('pkill -f "rosbag play"');

      document.getElementById('btn-rosbag-play').disabled = false;
      document.getElementById('btn-rosbag-stop-play').disabled = true;
      status.textContent = 'Playback stopped';
      status.className = 'rosbag-status';
      App.toast('Rosbag playback stopped', 'success');
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      status.className = 'rosbag-status error';
    }
  },

  async refreshFileList() {
    const dirPath = document.getElementById('rosbag-dir-path').value.trim() || '~/ROS_DB/rosbag';
    const list = document.getElementById('rosbag-file-list');

    list.innerHTML = '<div class="rosbag-loading">Loading...</div>';

    try {
      const result = await SSHTerminal.execCommand(`ls -lh ${dirPath}/*.bag 2>/dev/null | tail -20`);

      if (result.success && result.stdout && result.stdout.trim()) {
        const lines = result.stdout.trim().split('\n');
        list.innerHTML = lines.map(line => {
          // Parse ls -lh output
          const parts = line.split(/\s+/);
          if (parts.length < 9) return '';
          const size = parts[4];
          const date = `${parts[5]} ${parts[6]} ${parts[7]}`;
          const filename = parts.slice(8).join(' ');
          return `
            <div class="rosbag-file-item">
              <div class="rosbag-file-info">
                <span class="rosbag-file-name">${filename}</span>
                <span class="rosbag-file-meta">${size} | ${date}</span>
              </div>
              <div class="rosbag-file-actions">
                <button class="btn btn-small" onclick="RosbagControl.selectForPlay('${filename}')">Play</button>
                <button class="btn btn-small" onclick="RosbagControl.showBagInfo('${filename}')">Info</button>
                <button class="btn btn-small btn-danger" onclick="RosbagControl.deleteBag('${filename}')">Delete</button>
              </div>
            </div>
          `;
        }).filter(x => x).join('') || '<div class="rosbag-empty">No bag files found</div>';
      } else {
        list.innerHTML = '<div class="rosbag-empty">No bag files found in ' + dirPath + '</div>';
      }
    } catch (e) {
      list.innerHTML = '<div class="rosbag-error">Error: ' + e.message + '</div>';
    }
  },

  selectForPlay(filename) {
    document.getElementById('rosbag-play-path').value = filename;
    // Switch to play tab
    document.querySelectorAll('.rosbag-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.rosbag-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.rosbag-tab[data-tab="play"]').classList.add('active');
    document.getElementById('rosbag-play-tab').classList.add('active');
  },

  async showBagInfo(filename) {
    App.toast('Loading bag info...', 'info');

    try {
      const result = await SSHTerminal.execCommand(`rosbag info ${filename} 2>&1`);

      if (result.success) {
        alert('Bag Info:\n\n' + result.stdout);
      } else {
        App.toast('Failed to get bag info', 'error');
      }
    } catch (e) {
      App.toast('Error: ' + e.message, 'error');
    }
  },

  async deleteBag(filename) {
    if (!confirm(`Delete ${filename}?`)) return;

    try {
      const result = await SSHTerminal.execCommand(`rm -f ${filename}`);
      App.toast('Bag file deleted', 'success');
      this.refreshFileList();
    } catch (e) {
      App.toast('Error deleting: ' + e.message, 'error');
    }
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  RosbagControl.init();
});
