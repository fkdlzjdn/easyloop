// File Diff Viewer - Compare two files
const FileDiff = {
  init() {
    this.setupUI();
  },

  setupUI() {
    const btn = document.getElementById('btn-file-diff');
    if (btn) {
      btn.addEventListener('click', () => this.showModal());
    }
  },

  showModal() {
    let modal = document.getElementById('file-diff-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'file-diff-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content file-diff-modal-content">
          <div class="modal-header">
            <h3>File Diff Viewer</h3>
            <button class="modal-close" id="btn-diff-close">&times;</button>
          </div>
          <div class="file-diff-body">
            <div class="file-diff-inputs">
              <div class="file-diff-input-group">
                <label>File A (Original):</label>
                <input type="text" id="diff-file-a" placeholder="/path/to/original" class="diff-input">
                <button id="btn-load-file-a" class="btn btn-small">Load from Robot</button>
              </div>
              <div class="file-diff-input-group">
                <label>File B (Modified):</label>
                <input type="text" id="diff-file-b" placeholder="/path/to/modified" class="diff-input">
                <button id="btn-load-file-b" class="btn btn-small">Load from Robot</button>
              </div>
            </div>
            <div class="file-diff-or">
              <span>Or paste content directly:</span>
            </div>
            <div class="file-diff-textareas">
              <div class="file-diff-textarea-group">
                <label>Content A:</label>
                <textarea id="diff-content-a" rows="8" placeholder="Paste original content..."></textarea>
              </div>
              <div class="file-diff-textarea-group">
                <label>Content B:</label>
                <textarea id="diff-content-b" rows="8" placeholder="Paste modified content..."></textarea>
              </div>
            </div>
            <div class="file-diff-actions">
              <button id="btn-run-diff" class="btn btn-primary">Compare</button>
              <button id="btn-clear-diff" class="btn">Clear</button>
            </div>
            <div id="diff-result" class="diff-result"></div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-diff-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      modal.querySelector('#btn-load-file-a').addEventListener('click', () => this.loadFile('a'));
      modal.querySelector('#btn-load-file-b').addEventListener('click', () => this.loadFile('b'));
      modal.querySelector('#btn-run-diff').addEventListener('click', () => this.runDiff());
      modal.querySelector('#btn-clear-diff').addEventListener('click', () => this.clearDiff());
    }

    modal.classList.add('active');
  },

  async loadFile(which) {
    const pathInput = document.getElementById(`diff-file-${which}`);
    const contentArea = document.getElementById(`diff-content-${which}`);
    const path = pathInput.value.trim();

    if (!path) {
      App.toast('Enter file path', 'error');
      return;
    }

    contentArea.value = 'Loading...';

    try {
      const result = await SSHTerminal.execCommand(`cat "${path}"`);
      if (result.success) {
        contentArea.value = result.stdout || '';
        App.toast(`Loaded: ${path}`, 'success');
      } else {
        contentArea.value = '';
        App.toast('Failed to load file: ' + (result.stderr || result.message), 'error');
      }
    } catch (e) {
      contentArea.value = '';
      App.toast('Error: ' + e.message, 'error');
    }
  },

  runDiff() {
    const contentA = document.getElementById('diff-content-a').value;
    const contentB = document.getElementById('diff-content-b').value;
    const resultEl = document.getElementById('diff-result');

    if (!contentA && !contentB) {
      resultEl.innerHTML = '<div class="diff-empty">Enter content to compare</div>';
      return;
    }

    const linesA = contentA.split('\n');
    const linesB = contentB.split('\n');

    // Simple line-by-line diff
    const diff = this.computeDiff(linesA, linesB);

    resultEl.innerHTML = `
      <div class="diff-stats">
        <span class="diff-stat-add">+${diff.added} added</span>
        <span class="diff-stat-remove">-${diff.removed} removed</span>
        <span class="diff-stat-same">${diff.same} unchanged</span>
      </div>
      <div class="diff-lines">${diff.html}</div>
    `;
  },

  computeDiff(linesA, linesB) {
    // LCS-based diff (simplified)
    const html = [];
    let added = 0, removed = 0, same = 0;

    // Use simple sequential comparison
    let idxA = 0, idxB = 0;

    while (idxA < linesA.length || idxB < linesB.length) {
      const lineA = idxA < linesA.length ? linesA[idxA] : null;
      const lineB = idxB < linesB.length ? linesB[idxB] : null;

      if (lineA === lineB) {
        // Same line
        html.push(`<div class="diff-line diff-same"><span class="diff-ln">${idxA + 1}</span><span class="diff-code">${this._escapeHtml(lineA || '')}</span></div>`);
        same++;
        idxA++;
        idxB++;
      } else if (lineA !== null && (lineB === null || this._findInRange(lineA, linesB, idxB, Math.min(idxB + 3, linesB.length)) === -1)) {
        // Line removed from A
        html.push(`<div class="diff-line diff-remove"><span class="diff-ln">${idxA + 1}</span><span class="diff-code">- ${this._escapeHtml(lineA)}</span></div>`);
        removed++;
        idxA++;
      } else if (lineB !== null && (lineA === null || this._findInRange(lineB, linesA, idxA, Math.min(idxA + 3, linesA.length)) === -1)) {
        // Line added in B
        html.push(`<div class="diff-line diff-add"><span class="diff-ln">${idxB + 1}</span><span class="diff-code">+ ${this._escapeHtml(lineB)}</span></div>`);
        added++;
        idxB++;
      } else {
        // Context mismatch - show as change
        if (lineA !== null) {
          html.push(`<div class="diff-line diff-remove"><span class="diff-ln">${idxA + 1}</span><span class="diff-code">- ${this._escapeHtml(lineA)}</span></div>`);
          removed++;
          idxA++;
        }
        if (lineB !== null) {
          html.push(`<div class="diff-line diff-add"><span class="diff-ln">${idxB + 1}</span><span class="diff-code">+ ${this._escapeHtml(lineB)}</span></div>`);
          added++;
          idxB++;
        }
      }
    }

    return { html: html.join(''), added, removed, same };
  },

  _findInRange(needle, haystack, start, end) {
    for (let i = start; i < end; i++) {
      if (haystack[i] === needle) return i;
    }
    return -1;
  },

  _escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  clearDiff() {
    document.getElementById('diff-file-a').value = '';
    document.getElementById('diff-file-b').value = '';
    document.getElementById('diff-content-a').value = '';
    document.getElementById('diff-content-b').value = '';
    document.getElementById('diff-result').innerHTML = '';
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  FileDiff.init();
});
