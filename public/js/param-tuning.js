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
    const ros2 = RosManager.isRos2();
    const names = ros2 ? ['controller_server', 'amcl', 'global_costmap', 'planner_server']
      : ['move_base', 'amcl', 'global_costmap', 'pure_controller'];
    modal.querySelectorAll('.param-quick-btn').forEach((button, index) => {
      button.dataset.ns = ros2 ? `/${RosManager.getRobotId(App.activeSlotIndex)}/${names[index]}` : `/${names[index]}`;
      button.textContent = names[index];
    });
    document.getElementById('param-search-input').placeholder = ros2 ? '/R_006/amcl::max_particles 또는 노드 이름' : 'Search parameter name...';
  },

  async searchParams(prefix = null) {
    const searchTerm = prefix || document.getElementById('param-search-input').value.trim();
    const list = document.getElementById('param-tuning-list');
    if (!searchTerm) {
      list.textContent = '파라미터 이름 또는 노드를 입력하세요.';
      return;
    }
    list.textContent = '조회 중...';
    try {
      const ros = RosManager.getRos(App.activeSlotIndex);
      if (!ros) throw new Error('ROS 연결이 필요합니다.');
      let values;
      if (RosManager.isRos2()) {
        const response = await RosManager.searchRos2Params(searchTerm);
        values = response.values;
        if (response.partial) App.toast('일부 노드의 파라미터 응답이 없습니다. 다시 조회할 수 있습니다.', 'warning');
      } else {
        const names = await new Promise(resolve => ros.getParams(resolve));
        values = await Promise.all(names.filter(name => name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 30)
          .map(name => new Promise(resolve => new ROSLIB.Param({ ros, name }).get(value => resolve({ name, value })))));
      }
      list.innerHTML = values.map(p => {
        const value = typeof p.value === 'string' ? p.value : JSON.stringify(p.value);
        const type = typeof p.value === 'boolean' ? 'bool' : typeof p.value === 'number' ? 'number'
          : Array.isArray(p.value) ? 'array' : 'string';
        return `<div class="param-item">
          <div class="param-name">${this._escapeHtml(p.name)}</div>
          <div class="param-value-row">
            <input class="param-value-input" type="text" data-param="${this._escapeHtml(p.name)}"
              data-type="${type}" value="${this._escapeHtml(value ?? '')}">
            <button class="btn btn-mini btn-primary param-set-btn" type="button">Set</button>
          </div></div>`;
      }).join('') || '<div class="param-empty">일치하는 파라미터가 없습니다.</div>';
      list.querySelectorAll('.param-set-btn').forEach(button => {
        button.disabled = App.robotSlots[App.activeSlotIndex]?.rosControlEnabled === false;
        button.addEventListener('click', () => this.setParam(button.previousElementSibling.dataset.param));
      });
    } catch (error) { list.textContent = `조회 실패: ${error.message || error}`; }
  },

  async setParam(paramName) {
    const input = Array.from(document.querySelectorAll('.param-value-input')).find(item => item.dataset.param === paramName);
    if (!input) return;
    try {
      const value = input.dataset.type === 'string' ? input.value : JSON.parse(input.value);
      const result = await new Promise(resolve => RosManager.setParam(paramName, value, resolve));
      if (!result.success) throw new Error(result.error || result.message || '파라미터 변경이 거부되었습니다.');
      App.toast(`Parameter set: ${paramName}`, 'success');
      App.logAudit?.('param_set', { param: paramName, value });
    } catch (error) { App.toast(`변경 실패: ${error.message || error}`, 'error'); }
  },

  async refreshValues() {
    for (const input of document.querySelectorAll('.param-value-input[data-param]')) {
      const result = await new Promise(resolve => RosManager.getParam(input.dataset.param, resolve));
      if (result.success) input.value = typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
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
