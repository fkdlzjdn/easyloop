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

  _path(value) {
    if (!value || /[\n\r\0]/.test(value)) throw new Error('유효한 경로를 입력하세요.');
    return value.startsWith('~/') ? `"$HOME"/${RosManager._shellQuote(value.slice(2))}` : RosManager._shellQuote(value);
  },

  async _startProcess(command, index) {
    const result = await RosManager.execRuntimeCommand(
      `nohup ${command} > /tmp/easyloop-bag-${Date.now()}.log 2>&1 < /dev/null & easyloop_bag_pid=$!; sleep 0.3; kill -0 "$easyloop_bag_pid" 2>/dev/null && echo "$easyloop_bag_pid"`, index);
    const pid = Number(String(result.stdout || '').trim().split('\n').pop());
    if (!result.success || !Number.isSafeInteger(pid) || pid <= 1) throw new Error(result.message || 'bag 프로세스를 시작하지 못했습니다.');
    return pid;
  },

  async startRecording() {
    const status = document.getElementById('rosbag-record-status');
    try {
      const index = App.activeSlotIndex;
      const owner = App.robotSlots[index];
      if (!owner?.connected) throw new Error('로봇 연결이 필요합니다.');
      if (this._recordingOwner) throw new Error('진행 중인 기록을 먼저 종료하세요.');
      const outputPath = document.getElementById('rosbag-output-path').value.trim() || '~/ROS_DB/rosbag';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = document.getElementById('rosbag-name').value.trim() || `bag_${timestamp}`;
      if (!/^[A-Za-z0-9_.-]{1,120}$/.test(filename) || ['.', '..'].includes(filename)) throw new Error('Bag 이름은 영문·숫자·점·밑줄·하이픈을 사용하세요.');
      const topics = document.getElementById('rosbag-topics').value.split(',').map(t => t.trim()).filter(Boolean);
      if (topics.some(topic => !/^\/[A-Za-z0-9_/]+$/.test(topic))) throw new Error('Topic 경로를 확인하세요.');
      const duration = Number(document.getElementById('rosbag-duration').value || 0);
      if (!Number.isInteger(duration) || duration < 0) throw new Error('기록 시간을 확인하세요.');
      const ros2 = RosManager.isRos2(index);
      const path = `${outputPath.replace(/\/$/, '')}/${filename}`;
      let command = `${ros2 ? 'ros2 bag record -o' : 'rosbag record -O'} ${this._path(path)}`;
      command += topics.length ? ' ' + topics.map(topic => RosManager._shellQuote(topic)).join(' ') : ros2 ? ' --all' : ' -a';
      if (duration > 0) command = ros2 ? `timeout --signal=INT --kill-after=10 ${duration}s ${command}` : command + ` --duration=${duration}`;
      const directory = await RosManager.execRuntimeCommand(`mkdir -p -- ${this._path(outputPath)}`, index);
      if (!directory.success) throw new Error(directory.message || '기록 경로를 만들 수 없습니다.');
      this._recordPid = await this._startProcess(command, index);
      this._recordingOwner = owner;
      this._recordingRos2 = ros2;
      this._isRecording = true;
      document.getElementById('btn-rosbag-start').disabled = true;
      document.getElementById('btn-rosbag-stop').disabled = false;
      status.textContent = `Recording: ${path}${ros2 ? ' (ROS2 bag directory)' : '.bag'}`;
      status.className = 'rosbag-status success';
      App.logAudit?.('rosbag_record_start', { robotId: owner.robotId, path, topics });
      App.toast('Rosbag recording started', 'success');
    } catch (error) { status.textContent = `기록 실패: ${error.message || error}`; status.className = 'rosbag-status error'; }
  },

  async _stopProcess(owner, pid, ros2, operation) {
    const index = App.robotSlots.indexOf(owner);
    if (index < 0 || !Number.isSafeInteger(pid) || pid <= 1) throw new Error('기록/재생을 시작한 로봇에 다시 연결하세요.');
    const signature = ros2 ? `ros2 bag ${operation}` : `rosbag ${operation}`;
    const command = `if [ -r /proc/${pid}/cmdline ]; then case "$(tr '\\000' ' ' < /proc/${pid}/cmdline)" in *${RosManager._shellQuote(signature)}*) kill -INT ${pid};; *) exit 1;; esac; fi`;
    const result = await RosManager.execRuntimeCommand(command, index);
    if (!result.success) throw new Error(result.message || '프로세스 종료를 확인하지 못했습니다.');
  },

  async stopRecording() {
    const status = document.getElementById('rosbag-record-status');
    try {
      await this._stopProcess(this._recordingOwner, this._recordPid, this._recordingRos2, 'record');
      this._recordingOwner = null;
      this._recordPid = null;
      this._isRecording = false;
      document.getElementById('btn-rosbag-start').disabled = false;
      document.getElementById('btn-rosbag-stop').disabled = true;
      status.textContent = '기록 종료를 요청했습니다.';
      status.className = 'rosbag-status';
      this.refreshFileList();
    } catch (error) { status.textContent = `종료 실패: ${error.message || error}`; }
  },

  async startPlayback() {
    const status = document.getElementById('rosbag-play-status');
    try {
      const index = App.activeSlotIndex;
      const owner = App.robotSlots[index];
      if (!owner?.connected) throw new Error('로봇 연결이 필요합니다.');
      if (this._playbackOwner) throw new Error('진행 중인 재생을 먼저 종료하세요.');
      const path = document.getElementById('rosbag-play-path').value.trim();
      const rate = Number(document.getElementById('rosbag-play-rate').value || 1);
      if (!Number.isFinite(rate) || rate <= 0 || rate > 10) throw new Error('재생 속도를 확인하세요.');
      const ros2 = RosManager.isRos2(index);
      let command = `${ros2 ? 'ros2 bag play' : 'rosbag play'} ${this._path(path)} -r ${rate}`;
      if (document.getElementById('rosbag-play-loop').checked) command += ros2 ? ' --loop' : ' -l';
      this._playPid = await this._startProcess(command, index);
      this._playbackOwner = owner;
      this._playbackRos2 = ros2;
      document.getElementById('btn-rosbag-play').disabled = true;
      document.getElementById('btn-rosbag-stop-play').disabled = false;
      status.textContent = `Playing: ${path}`;
      status.className = 'rosbag-status success';
    } catch (error) { status.textContent = `재생 실패: ${error.message || error}`; }
  },

  async stopPlayback() {
    const status = document.getElementById('rosbag-play-status');
    try {
      await this._stopProcess(this._playbackOwner, this._playPid, this._playbackRos2, 'play');
      this._playbackOwner = null;
      this._playPid = null;
      document.getElementById('btn-rosbag-play').disabled = false;
      document.getElementById('btn-rosbag-stop-play').disabled = true;
      status.textContent = '재생 종료를 요청했습니다.';
    } catch (error) { status.textContent = `종료 실패: ${error.message || error}`; }
  },

  async refreshFileList() {
    const list = document.getElementById('rosbag-file-list');
    list.textContent = '조회 중...';
    try {
      const index = App.activeSlotIndex;
      const owner = App.robotSlots[index];
      const dir = document.getElementById('rosbag-dir-path').value.trim() || '~/ROS_DB/rosbag';
      const script = `import json,sys,pathlib,datetime
p=pathlib.Path(sys.argv[1]).expanduser()
items=[]
if p.is_dir():
 for f in p.iterdir():
  if (f.is_file() and f.suffix in ('.bag','.db3','.mcap')) or (f.is_dir() and (f/'metadata.yaml').is_file()):
   items.append({'path':str(f),'size':f.stat().st_size,'date':datetime.datetime.fromtimestamp(f.stat().st_mtime).isoformat()})
print(json.dumps(sorted(items,key=lambda f:f['date'],reverse=True)[:20]))`;
      const result = await RosManager.execRuntimeCommand(`python3 -c ${RosManager._shellQuote(script)} ${this._path(dir)}`, index);
      if (!result.success) throw new Error(result.message || 'bag 목록 조회 실패');
      if (App.robotSlots[App.activeSlotIndex] !== owner) return;
      this._bagFiles = JSON.parse(result.stdout || '[]');
      this._fileOwner = owner;
      list.innerHTML = this._bagFiles.map((file, i) => `<div class="rosbag-file-item">
        <div class="rosbag-file-info"><span class="rosbag-file-name">${_escapeHtml(file.path)}</span>
          <span class="rosbag-file-meta">${_escapeHtml(file.date)}</span></div>
        <div class="rosbag-file-actions">
          <button class="btn btn-small" data-bag-index="${i}" data-bag-operation="play">Play</button>
          <button class="btn btn-small" data-bag-index="${i}" data-bag-operation="info">Info</button>
          <button class="btn btn-small btn-danger" data-bag-index="${i}" data-bag-operation="delete">Delete</button>
        </div></div>`).join('') || '<div class="rosbag-empty">Bag 파일이 없습니다.</div>';
      list.querySelectorAll('[data-bag-index]').forEach(button => button.addEventListener('click', () => {
        if (this._fileOwner !== App.robotSlots[App.activeSlotIndex]) return this.refreshFileList();
        const path = this._bagFiles[Number(button.dataset.bagIndex)].path;
        if (button.dataset.bagOperation === 'play') this.selectForPlay(path);
        else if (button.dataset.bagOperation === 'info') this.showBagInfo(path);
        else this.deleteBag(path);
      }));
    } catch (error) { list.textContent = `조회 실패: ${error.message || error}`; }
  },

  selectForPlay(filename) {
    document.getElementById('rosbag-play-path').value = filename;
    document.querySelectorAll('.rosbag-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.rosbag-tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector('.rosbag-tab[data-tab="play"]').classList.add('active');
    document.getElementById('rosbag-play-tab').classList.add('active');
  },

  async showBagInfo(filename) {
    try {
      const result = await RosManager.execRuntimeCommand(`${RosManager.isRos2() ? 'ros2 bag info' : 'rosbag info'} ${this._path(filename)}`);
      if (!result.success) throw new Error(result.message || 'bag 정보 조회 실패');
      alert(`Bag Info:\n\n${result.stdout}`);
    } catch (error) { App.toast(String(error.message || error), 'error'); }
  },

  async deleteBag(filename) {
    if (!this._bagFiles?.some(file => file.path === filename)
        || this._fileOwner !== App.robotSlots[App.activeSlotIndex]) return;
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      const result = await RosManager.execRuntimeCommand(`rm -r -- ${this._path(filename)}`);
      if (!result.success) throw new Error(result.message || '삭제 실패');
      this.refreshFileList();
    } catch (error) { App.toast(String(error.message || error), 'error'); }
  }

};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  RosbagControl.init();
});
