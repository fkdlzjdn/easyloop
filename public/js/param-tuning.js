// Parameter Tuning - Real-time ROS parameter adjustment
const ParamTuning = {
  _watchedParams: {},  // {paramPath: {value, sub}}
  _updateInterval: null,

  init() {
    this.setupUI();
  },

  setupUI() {
    const btn = document.getElementById('btn-param-tuning');
    if (btn) {
      btn.addEventListener('click', () => this.showModal());
    }
  },

  showModal() {
    let modal = document.getElementById('param-tuning-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'param-tuning-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content param-tuning-modal-content">
          <div class="modal-header">
            <h3>Parameter Tuning</h3>
            <button class="modal-close" id="btn-param-tuning-close">&times;</button>
          </div>
          <div class="param-tuning-body">
            <div class="param-tuning-search">
              <input type="text" id="param-search-input" placeholder="Search parameter name..." class="param-search-input">
              <button id="btn-param-search" class="btn btn-small btn-primary">Search</button>
            </div>
            <div class="param-tuning-common">
              <h4>Common Parameters</h4>
              <div class="param-common-btns">
                <button class="btn btn-mini param-quick-btn" data-ns="/move_base">move_base</button>
                <button class="btn btn-mini param-quick-btn" data-ns="/amcl">amcl</button>
                <button class="btn btn-mini param-quick-btn" data-ns="/global_costmap">costmap</button>
                <button class="btn btn-mini param-quick-btn" data-ns="/pure_controller">controller</button>
              </div>
            </div>
            <div id="param-tuning-list" class="param-tuning-list"></div>
            <div class="param-tuning-actions">
              <button id="btn-param-refresh" class="btn btn-small">Refresh Values</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-param-tuning-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      modal.querySelector('#btn-param-search').addEventListener('click', () => this.searchParams());
      modal.querySelector('#param-search-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.searchParams();
      });

      modal.querySelectorAll('.param-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => this.searchParams(btn.dataset.ns));
      });

      modal.querySelector('#btn-param-refresh').addEventListener('click', () => this.refreshValues());
    }

    modal.classList.add('active');
  },

  async searchParams(prefix = null) {
    const searchInput = document.getElementById('param-search-input');
    const searchTerm = prefix || searchInput.value.trim();
    const list = document.getElementById('param-tuning-list');

    if (!searchTerm) {
      list.innerHTML = '<div class="param-empty">Enter a parameter name or namespace to search</div>';
      return;
    }

    list.innerHTML = '<div class="param-loading">Searching...</div>';

    try {
      // Get list of matching parameters
      const ros = typeof RosManager !== 'undefined' ? RosManager.getRos(App.activeSlotIndex) : null;

      if (!ros) {
        list.innerHTML = '<div class="param-error">ROS not connected</div>';
        return;
      }


      // Use rosparam list via SSH
      const result = await SSHTerminal.execCommand(`rosparam list 2>/dev/null | grep -i "${searchTerm}" | head -30`);

      if (result.success && result.stdout && result.stdout.trim()) {
        const params = result.stdout.trim().split('\n').filter(p => p);

        if (params.length === 0) {
          list.innerHTML = '<div class="param-empty">No matching parameters found</div>';
          return;
        }

        // Get values for each parameter
        const paramValues = await Promise.all(params.map(async (param) => {
          const valResult = await SSHTerminal.execCommand(`rosparam get ${param} 2>/dev/null`);
          return {
            name: param,
            value: valResult.success ? valResult.stdout.trim() : 'N/A'
          };
        }));

        list.innerHTML = paramValues.map(p => {
          const valueType = this._guessType(p.value);
          return `
            <div class="param-item">
              <div class="param-name" title="${p.name}">${p.name}</div>
              <div class="param-value-row">
                ${valueType === 'bool' ? `
                  <select class="param-value-input" data-param="${p.name}" data-type="bool">
                    <option value="true" ${p.value === 'true' ? 'selected' : ''}>true</option>
                    <option value="false" ${p.value === 'false' ? 'selected' : ''}>false</option>
                  </select>
                ` : `
                  <input type="${valueType === 'number' ? 'number' : 'text'}"
                         class="param-value-input"
                         data-param="${p.name}"
                         data-type="${valueType}"
                         value="${this._escapeHtml(p.value)}"
                         step="any">
                `}
                <button class="btn btn-mini btn-primary" onclick="ParamTuning.setParam('${p.name}')">Set</button>
              </div>
            </div>
          `;
        }).join('');

      } else {
        list.innerHTML = '<div class="param-empty">No matching parameters found</div>';
      }
    } catch (e) {
      list.innerHTML = `<div class="param-error">Error: ${e.message}</div>`;
    }
  },

  async setParam(paramName) {
    const input = document.querySelector(`[data-param="${paramName}"]`);
    if (!input) return;

    const value = input.value;
    const type = input.dataset.type;

    App.toast(`Setting ${paramName}...`, 'info');

    try {
      let cmd;
      if (type === 'bool' || value === 'true' || value === 'false') {
        cmd = `rosparam set ${paramName} ${value}`;
      } else if (type === 'number' || !isNaN(parseFloat(value))) {
        cmd = `rosparam set ${paramName} ${value}`;
      } else {
        // String - need quotes
        cmd = `rosparam set ${paramName} "${value.replace(/"/g, '\\"')}"`;
      }

      const result = await SSHTerminal.execCommand(cmd);

      if (result.success) {
        App.toast(`Parameter set: ${paramName} = ${value}`, 'success');

        // Audit log
        if (typeof App !== 'undefined' && App.logAudit) {
          App.logAudit('param_set', { param: paramName, value: value });
        }
      } else {
        App.toast(`Failed: ${result.stderr || result.message}`, 'error');
      }
    } catch (e) {
      App.toast(`Error: ${e.message}`, 'error');
    }
  },

  async refreshValues() {
    const inputs = document.querySelectorAll('.param-value-input[data-param]');
    if (inputs.length === 0) {
      App.toast('No parameters to refresh', 'info');
      return;
    }

    App.toast('Refreshing values...', 'info');

    for (const input of inputs) {
      const param = input.dataset.param;
      try {
        const result = await SSHTerminal.execCommand(`rosparam get ${param} 2>/dev/null`);
        if (result.success && result.stdout) {
          input.value = result.stdout.trim();
        }
      } catch (e) {
        // Ignore individual errors
      }
    }

    App.toast('Values refreshed', 'success');
  },

  _guessType(value) {
    if (value === 'true' || value === 'false') return 'bool';
    if (!isNaN(parseFloat(value)) && isFinite(value)) return 'number';
    return 'string';
  },

  _escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  ParamTuning.init();
});
