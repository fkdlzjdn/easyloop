// Robot Comparison and Config Propagation
const RobotComparison = {
  init() {
    const compareBtn = document.getElementById('btn-robot-compare');
    const propagateBtn = document.getElementById('btn-config-propagate');

    if (compareBtn) compareBtn.addEventListener('click', () => this.showCompareModal());
    if (propagateBtn) propagateBtn.addEventListener('click', () => this.showPropagateModal());
  },

  // ========== Robot Comparison ==========
  showCompareModal() {
    let modal = document.getElementById('robot-compare-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'robot-compare-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content robot-compare-modal-content">
          <div class="modal-header">
            <h3>Robot Comparison</h3>
            <button class="modal-close" id="robot-compare-close">&times;</button>
          </div>
          <div class="robot-compare-body">
            <div class="compare-selector">
              <div class="compare-col">
                <label>Robot A:</label>
                <select id="compare-robot-a"></select>
              </div>
              <div class="compare-col">
                <label>Robot B:</label>
                <select id="compare-robot-b"></select>
              </div>
              <button id="btn-run-compare" class="btn btn-primary">Compare</button>
            </div>
            <div id="compare-result" class="compare-result"></div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#robot-compare-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
      modal.querySelector('#btn-run-compare').addEventListener('click', () => this.runComparison());
    }

    this.populateRobotSelectors();
    modal.classList.add('active');
  },

  populateRobotSelectors() {
    const selectA = document.getElementById('compare-robot-a');
    const selectB = document.getElementById('compare-robot-b');
    if (!selectA || !selectB) return;

    const slots = App.robotSlots || [];
    const options = slots.map((s, i) =>
      `<option value="${i}">${this.escapeHtml(s.robotId || 'Robot ' + (i + 1))}</option>`
    ).join('');

    selectA.innerHTML = options;
    selectB.innerHTML = options;
    if (slots.length > 1) selectB.selectedIndex = 1;
  },

  async runComparison() {
    const idxA = parseInt(document.getElementById('compare-robot-a').value);
    const idxB = parseInt(document.getElementById('compare-robot-b').value);
    const resultEl = document.getElementById('compare-result');

    if (idxA === idxB) {
      App.toast('Select different robots', 'warning');
      return;
    }

    resultEl.innerHTML = '<div class="compare-loading">Fetching configs...</div>';

    try {
      const [configA, configB] = await Promise.all([
        this.fetchRobotConfig(idxA),
        this.fetchRobotConfig(idxB)
      ]);

      const slots = App.robotSlots;
      const nameA = slots[idxA]?.robotId || 'Robot ' + (idxA + 1);
      const nameB = slots[idxB]?.robotId || 'Robot ' + (idxB + 1);

      this.renderComparisonResult(configA, configB, nameA, nameB);
    } catch (e) {
      resultEl.innerHTML = `<div class="compare-error">Error: ${e.message}</div>`;
    }
  },

  async fetchRobotConfig(slotIdx) {
    const config = { rosParams: {}, systemInfo: {} };

    const paramsResult = await SSHTerminal.execCommand(`
      rosparam get /move_base/max_vel_x 2>/dev/null || echo "N/A";
      rosparam get /move_base/max_vel_theta 2>/dev/null || echo "N/A";
      rosparam get /amcl/max_particles 2>/dev/null || echo "N/A";
    `);

    if (paramsResult.success && paramsResult.stdout) {
      const lines = paramsResult.stdout.trim().split('\n');
      config.rosParams = {
        'max_vel_x': lines[0] || 'N/A',
        'max_vel_theta': lines[1] || 'N/A',
        'amcl_max_particles': lines[2] || 'N/A'
      };
    }

    const sysResult = await SSHTerminal.execCommand('uname -r');
    config.systemInfo.kernel = sysResult.success ? sysResult.stdout.trim() : 'N/A';

    return config;
  },

  renderComparisonResult(configA, configB, nameA, nameB) {
    const resultEl = document.getElementById('compare-result');

    const categories = [
      { name: 'ROS Parameters', dataA: configA.rosParams, dataB: configB.rosParams },
      { name: 'System', dataA: configA.systemInfo, dataB: configB.systemInfo }
    ];

    let html = `
      <div class="compare-header">
        <div class="compare-header-col">Parameter</div>
        <div class="compare-header-col">${this.escapeHtml(nameA)}</div>
        <div class="compare-header-col">${this.escapeHtml(nameB)}</div>
        <div class="compare-header-col">Match</div>
      </div>
    `;

    for (const cat of categories) {
      html += `<div class="compare-category">${cat.name}</div>`;
      const allKeys = new Set([...Object.keys(cat.dataA || {}), ...Object.keys(cat.dataB || {})]);

      for (const key of allKeys) {
        const valA = cat.dataA?.[key] ?? 'N/A';
        const valB = cat.dataB?.[key] ?? 'N/A';
        const match = valA === valB;

        html += `
          <div class="compare-row ${match ? '' : 'diff'}">
            <div class="compare-cell key">${this.escapeHtml(key)}</div>
            <div class="compare-cell val">${this.escapeHtml(String(valA))}</div>
            <div class="compare-cell val">${this.escapeHtml(String(valB))}</div>
            <div class="compare-cell match">${match ? '✓' : '✗'}</div>
          </div>
        `;
      }
    }

    resultEl.innerHTML = html;
  },

  // ========== Config Propagation ==========
  showPropagateModal() {
    let modal = document.getElementById('config-propagate-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'config-propagate-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content config-propagate-modal-content">
          <div class="modal-header">
            <h3>Config Propagation</h3>
            <button class="modal-close" id="config-propagate-close">&times;</button>
          </div>
          <div class="config-propagate-body">
            <div class="propagate-source">
              <label>Source Robot:</label>
              <select id="propagate-source"></select>
            </div>
            <div class="propagate-targets">
              <label>Target Robots:</label>
              <div id="propagate-target-list" class="propagate-target-list"></div>
            </div>
            <div class="propagate-options">
              <label>Config Items:</label>
              <div class="propagate-items">
                <label><input type="checkbox" value="move_base" checked> move_base</label>
                <label><input type="checkbox" value="amcl" checked> AMCL</label>
                <label><input type="checkbox" value="costmap"> Costmap</label>
              </div>
            </div>
            <div class="propagate-actions">
              <button id="btn-run-propagate" class="btn btn-primary">Copy Config</button>
              <span id="propagate-status" class="propagate-status"></span>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#config-propagate-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
      modal.querySelector('#btn-run-propagate').addEventListener('click', () => this.runPropagation());
    }

    this.populatePropagateSelectors();
    modal.classList.add('active');
  },

  populatePropagateSelectors() {
    const sourceSelect = document.getElementById('propagate-source');
    const targetList = document.getElementById('propagate-target-list');
    if (!sourceSelect || !targetList) return;

    const slots = App.robotSlots || [];
    sourceSelect.innerHTML = slots.map((s, i) =>
      `<option value="${i}">${this.escapeHtml(s.robotId || 'Robot ' + (i + 1))}</option>`
    ).join('');

    targetList.innerHTML = slots.map((s, i) => `
      <label><input type="checkbox" class="propagate-target-chk" value="${i}">
        ${this.escapeHtml(s.robotId || 'Robot ' + (i + 1))}</label>
    `).join('');
  },

  async runPropagation() {
    const sourceIdx = parseInt(document.getElementById('propagate-source').value);
    const targetChecks = document.querySelectorAll('.propagate-target-chk:checked');
    const itemChecks = document.querySelectorAll('.propagate-items input:checked');
    const statusEl = document.getElementById('propagate-status');

    const targetIdxs = Array.from(targetChecks).map(c => parseInt(c.value)).filter(i => i !== sourceIdx);

    if (targetIdxs.length === 0) {
      App.toast('Select target robots', 'warning');
      return;
    }

    const items = Array.from(itemChecks).map(c => c.value);
    if (items.length === 0) {
      App.toast('Select config items', 'warning');
      return;
    }

    statusEl.textContent = 'Propagating...';

    try {
      const paramsToGet = this.getParamsByItems(items);
      const sourceParams = {};

      for (const param of paramsToGet) {
        const result = await SSHTerminal.execCommand(`rosparam get ${param} 2>/dev/null || echo "__NOT_SET__"`);
        if (result.success && result.stdout.trim() !== '__NOT_SET__') {
          sourceParams[param] = result.stdout.trim();
        }
      }

      let successCount = 0;
      for (const targetIdx of targetIdxs) {
        try {
          for (const [param, value] of Object.entries(sourceParams)) {
            await SSHTerminal.execCommand(`rosparam set ${param} "${value}"`);
          }
          successCount++;
        } catch (e) {
          console.error(`Failed propagate to robot ${targetIdx}:`, e);
        }
      }

      statusEl.textContent = `Done! ${successCount}/${targetIdxs.length} updated`;
      App.toast(`Config propagated to ${successCount} robots`, 'success');
    } catch (e) {
      statusEl.textContent = 'Failed';
      App.toast('Propagation failed', 'error');
    }
  },

  getParamsByItems(items) {
    const paramMap = {
      'move_base': ['/move_base/max_vel_x', '/move_base/max_vel_theta'],
      'amcl': ['/amcl/max_particles', '/amcl/min_particles'],
      'costmap': ['/move_base/global_costmap/inflation_radius']
    };
    const params = [];
    for (const item of items) {
      if (paramMap[item]) params.push(...paramMap[item]);
    }
    return params;
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  RobotComparison.init();
});
