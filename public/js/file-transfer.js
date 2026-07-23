// File Transfer (SFTP)
const FileTransfer = {
  currentPath: '/home',
  sessionId: null,
  sessionHost: null,

  async ensureConnection(password = null) {
    const info = App.getConnectionInfo();

    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      this.sessionId = this.sessionId || App.generateSessionId();
      this.sessionHost = info.ip || 'test';
      return { success: true };
    }

    if (this.sessionId && this.sessionHost === info.ip) {
      return { success: true };
    }

    // 활성 로봇이 바뀌면 이전 로봇의 SFTP 세션을 재사용하지 않는다.
    if (this.sessionId && this.sessionHost !== info.ip) {
      const previousSessionId = this.sessionId;
      this.sessionId = null;
      this.sessionHost = null;
      try {
        await fetchWithTimeout('/api/ssh/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: previousSessionId })
        });
      } catch (error) {
        // 이전 조회 세션 정리 실패는 새 활성 로봇 연결을 막지 않는다.
      }
    }

    if (!info.ip) {
      return { success: false, message: 'Please enter IP address' };
    }

    this.sessionId = App.generateSessionId();

    try {
      // B12 fix: fetch 타임아웃 적용
      const res = await fetchWithTimeout('/api/ssh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: info.ip,
          port: info.sshPort || 22,
          username: info.sshUser,
          password: password || info.sshPassword || null,
          sessionId: this.sessionId
        })
      });

      const result = await res.json();

      if (!result.success && result.needPassword) {
        this.sessionId = null;
        this.sessionHost = null;
        return new Promise((resolve) => {
          App.showPasswordModal(result.message, async (pwd) => {
            const retryResult = await this.ensureConnection(pwd);
            resolve(retryResult);
          });
        });
      }

      if (result.success) this.sessionHost = info.ip;
      return result;
    } catch (e) {
      this.sessionId = null;
      this.sessionHost = null;
      return { success: false, message: e.message };
    }
  },

  async browse(path, sourceButton = null) {
    App.setButtonLoading(sourceButton, true, 'Loading');
    const connResult = await this.ensureConnection();
    if (!connResult.success) {
      this.showStatus(connResult.message, true);
      App.setButtonLoading(sourceButton, false);
      return;
    }

    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      const files = [
        { name: 'logs', isDirectory: true, size: 0, modifyTime: Date.now() - 100000 },
        { name: 'config', isDirectory: true, size: 0, modifyTime: Date.now() - 500000 },
        { name: 'readme.txt', isDirectory: false, size: 2048, modifyTime: Date.now() - 200000 }
      ];
      this.currentPath = path;
      document.getElementById('remote-path').value = path;
      this.renderFileList(files);
      this.showStatus('Test mode: File list displayed');
      App.setButtonLoading(sourceButton, false);
      return;
    }

    try {
      // B12 fix: fetch 타임아웃 적용
      const res = await fetchWithTimeout('/api/sftp/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          remotePath: path
        })
      });

      const result = await res.json();

      if (result.success) {
        this.currentPath = path;
        document.getElementById('remote-path').value = path;
        this.renderFileList(result.files);
        this.showStatus('File list refreshed');
      } else {
        this.showStatus(result.message, true);
      }
    } catch (e) {
      this.showStatus(e.message, true);
    } finally {
      App.setButtonLoading(sourceButton, false);
    }
  },

  renderFileList(files) {
    const tbody = document.querySelector('#file-list tbody');
    tbody.innerHTML = '';

    // Add parent directory entry
    if (this.currentPath !== '/') {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="dir">..</td>
        <td>-</td>
        <td>-</td>
        <td>
          <button class="btn btn-small" data-action="browse" data-path="${this.getParentPath()}">Open</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // Sort: directories first, then files
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    files.forEach(file => {
      const tr = document.createElement('tr');
      const fullPath = this.currentPath === '/' ?
        `/${file.name}` :
        `${this.currentPath}/${file.name}`;

      const modDate = new Date(file.modifyTime).toLocaleString();
      const size = file.isDirectory ? '-' : this.formatSize(file.size);

      if (file.isDirectory) {
        tr.innerHTML = `
          <td class="dir">${file.name}/</td>
          <td>${size}</td>
          <td>${modDate}</td>
          <td>
            <button class="btn btn-small" data-action="browse" data-path="${fullPath}">Open</button>
          </td>
        `;
      } else {
        tr.innerHTML = `
          <td>${file.name}</td>
          <td>${size}</td>
          <td>${modDate}</td>
          <td>
            <button class="btn btn-small" data-action="download" data-path="${fullPath}">Download</button>
          </td>
        `;
      }

      tbody.appendChild(tr);
    });

    // Add event listeners
    tbody.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const path = btn.dataset.path;

        if (action === 'browse') {
          this.browse(path, btn);
        } else if (action === 'download') {
          this.download(path, btn);
        }
      });
    });
  },

  getParentPath() {
    const parts = this.currentPath.split('/').filter(p => p);
    parts.pop();
    return '/' + parts.join('/');
  },

  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  async download(remotePath, sourceButton = null) {
    App.setButtonLoading(sourceButton, true, 'Downloading');
    const connResult = await this.ensureConnection();
    if (!connResult.success) {
      this.showStatus(connResult.message, true);
      App.setButtonLoading(sourceButton, false);
      return;
    }

    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      const blob = new Blob([`Test Mode file: ${remotePath}\n`], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = remotePath.split('/').pop() || 'test.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showStatus('Test mode: Download complete');
      App.setButtonLoading(sourceButton, false);
      return;
    }

    this.showStatus('Downloading...');

    try {
      // B12 fix: 다운로드는 60초 타임아웃 (대용량 파일 대응)
      const res = await fetchWithTimeout('/api/sftp/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          remotePath
        })
      }, 60000);

      const result = await res.json();

      if (result.success) {
        // Create download link
        const blob = new Blob([Uint8Array.from(atob(result.content), c => c.charCodeAt(0))]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showStatus(`Download complete: ${result.filename}`);
        // Audit log
        if (typeof App !== 'undefined' && App.logAudit) {
          App.logAudit('file_download', { path: remotePath, filename: result.filename });
        }
      } else {
        this.showStatus(result.message, true);
      }
    } catch (e) {
      this.showStatus(e.message, true);
    } finally {
      App.setButtonLoading(sourceButton, false);
    }
  },

  async upload() {
    const fileInput = document.getElementById('upload-file');
    const uploadBtn = document.getElementById('btn-upload');
    const file = fileInput.files[0];

    if (!file) {
      this.showStatus('Please select a file', true);
      return;
    }

    App.setButtonLoading(uploadBtn, true, 'Uploading');
    const connResult = await this.ensureConnection();
    if (!connResult.success) {
      this.showStatus(connResult.message, true);
      App.setButtonLoading(uploadBtn, false);
      return;
    }

    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      this.showStatus(`Test mode: Upload complete (${file.name})`);
      fileInput.value = '';
      App.setButtonLoading(uploadBtn, false);
      return;
    }

    this.showStatus('Uploading...');
    this.showProgressBar(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('sessionId', this.sessionId);
    formData.append('remotePath', this.currentPath);

    // Use XMLHttpRequest for progress tracking
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        this.updateProgress(percent, e.loaded, e.total);
      }
    };

    xhr.onload = () => {
      this.showProgressBar(false);
      try {
        const result = JSON.parse(xhr.responseText);
        if (result.success) {
          this.showStatus(`Upload complete: ${file.name}`);
          fileInput.value = '';
          // Audit log
          if (typeof App !== 'undefined' && App.logAudit) {
            App.logAudit('file_upload', { path: this.currentPath, filename: file.name, size: file.size });
          }
          // Refresh file list
          this.browse(this.currentPath);
        } else {
          this.showStatus(result.message, true);
        }
      } catch (e) {
        this.showStatus('Upload failed: Invalid response', true);
      }
      App.setButtonLoading(uploadBtn, false);
    };

    xhr.onerror = () => {
      this.showProgressBar(false);
      this.showStatus('Upload failed: Network error', true);
      App.setButtonLoading(uploadBtn, false);
    };

    xhr.open('POST', '/api/sftp/upload');
    xhr.send(formData);
  },

  showProgressBar(show) {
    let progressContainer = document.getElementById('upload-progress-container');
    if (!progressContainer && show) {
      progressContainer = document.createElement('div');
      progressContainer.id = 'upload-progress-container';
      progressContainer.className = 'upload-progress-container';
      progressContainer.innerHTML = `
        <div class="upload-progress-bar">
          <div class="upload-progress-fill" id="upload-progress-fill"></div>
        </div>
        <span class="upload-progress-text" id="upload-progress-text">0%</span>
      `;
      const statusEl = document.getElementById('upload-status');
      if (statusEl) {
        statusEl.parentNode.insertBefore(progressContainer, statusEl.nextSibling);
      }
    }
    if (progressContainer) {
      progressContainer.style.display = show ? 'flex' : 'none';
    }
  },

  updateProgress(percent, loaded, total) {
    const fill = document.getElementById('upload-progress-fill');
    const text = document.getElementById('upload-progress-text');
    if (fill) fill.style.width = percent + '%';
    if (text) {
      const loadedMB = (loaded / 1024 / 1024).toFixed(1);
      const totalMB = (total / 1024 / 1024).toFixed(1);
      text.textContent = `${percent}% (${loadedMB}/${totalMB} MB)`;
    }
  },

  showStatus(message, isError = false) {
    const status = document.getElementById('upload-status');
    status.textContent = message;
    status.style.color = isError ? '#ff6b6b' : '#27ae60';
    App.toast(message, isError ? 'error' : 'success');
  },

  // Drag & Drop Upload
  setupDragAndDrop() {
    const dropZone = document.getElementById('file-list-container') ||
                     document.querySelector('.file-list-container');
    if (!dropZone) return;

    // Create drop overlay
    const overlay = document.createElement('div');
    overlay.className = 'drop-overlay';
    overlay.innerHTML = '<span>Drop files here to upload</span>';
    dropZone.appendChild(overlay);

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // Highlight on drag
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove('drag-active');
      });
    });

    // Handle drop
    dropZone.addEventListener('drop', async (e) => {
      const files = e.dataTransfer.files;
      if (files.length === 0) return;

      // Upload each file
      for (const file of files) {
        await this.uploadDroppedFile(file);
      }

      // Refresh file list
      this.browse(this.currentPath);
    });
  },

  async uploadDroppedFile(file) {
    const info = App.getConnectionInfo();
    if (!info.ip) {
      App.toast('Please connect to a robot first', 'error');
      return;
    }

    const connResult = await this.ensureConnection();
    if (!connResult.success) {
      this.showStatus(connResult.message, true);
      return;
    }

    const remotePath = this.currentPath + '/' + file.name;

    App.toast(`Uploading: ${file.name}...`, 'info');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('remotePath', remotePath);
      formData.append('host', info.ip);
      formData.append('username', info.sshUser);
      formData.append('password', info.sshPassword || '');

      // B12 fix: fetch 타임아웃 적용 (업로드 60초)
      const res = await fetchWithTimeout('/api/sftp/upload', {
        method: 'POST',
        body: formData
      }, 60000);

      const result = await res.json();
      if (result.success) {
        this.showStatus(`Uploaded: ${file.name}`);
      } else {
        this.showStatus(result.message || 'Upload failed', true);
      }
    } catch (e) {
      this.showStatus(`Upload error: ${e.message}`, true);
    }
  }
};

// Event handlers
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-browse').addEventListener('click', () => {
    const path = document.getElementById('remote-path').value.trim() || '/home';
    FileTransfer.browse(path, document.getElementById('btn-browse'));
  });

  document.getElementById('btn-upload').addEventListener('click', () => {
    FileTransfer.upload();
  });

  // Allow pressing Enter in path input
  document.getElementById('remote-path').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const path = e.target.value.trim() || '/home';
      FileTransfer.browse(path, document.getElementById('btn-browse'));
    }
  });

  // Setup drag and drop
  FileTransfer.setupDragAndDrop();
});
