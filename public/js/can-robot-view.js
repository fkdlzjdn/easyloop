// ==================== CAN Robot Top View Renderer ====================
const CanRobotView = {
  // Node layout configuration
  // 로봇 상면도 기준 (위=전방)
  NODE_CONFIG: [
    { id: 1, name: 'FL Drive', position: 'fl', type: 'drive' },
    { id: 2, name: 'FR Drive', position: 'fr', type: 'drive' },
    { id: 5, name: 'F Steer',  position: 'fs', type: 'steer' },
    { id: 7, name: 'Lift',     position: 'lift', type: 'lift' },
    { id: 6, name: 'R Steer',  position: 'rs', type: 'steer' },
    { id: 3, name: 'RL Drive', position: 'rl', type: 'drive' },
    { id: 4, name: 'RR Drive', position: 'rr', type: 'drive' },
  ],

  PROTECTED_NODES: [5, 6, 7],

  /**
   * 로봇 상면도 DOM 생성
   * @param {HTMLElement} container - 상면도를 렌더링할 컨테이너
   * @param {Function} onNodeClick - 노드 클릭 콜백 (nodeId)
   */
  render(container, onNodeClick) {
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'can-robot-view';

    const title = document.createElement('h4');
    title.textContent = '로봇 상면도';
    wrapper.appendChild(title);

    const layout = document.createElement('div');
    layout.className = 'robot-top-layout';

    // Direction label
    const dirLabel = document.createElement('div');
    dirLabel.className = 'robot-direction-label';
    dirLabel.textContent = '\u2190 \uC804\uBC29 (FRONT) \u2192';
    layout.appendChild(dirLabel);

    this.NODE_CONFIG.forEach(cfg => {
      const box = document.createElement('div');
      box.className = 'node-box offline';
      box.id = `can-node-${cfg.id}`;
      box.dataset.nodeId = cfg.id;

      if (cfg.type === 'lift') box.classList.add('lift-node');
      if (cfg.type === 'steer') box.classList.add('steer-node');
      if (this.PROTECTED_NODES.includes(cfg.id)) box.classList.add('protected');

      box.innerHTML = `
        <span class="node-id">Node ${cfg.id}</span>
        <span class="node-name">${_escapeHtml(cfg.name)}</span>
        <span class="node-status-icon">--</span>
        <span class="node-error"></span>
        <span class="node-angle"></span>
      `;

      box.addEventListener('click', () => {
        // Remove previous selection
        container.querySelectorAll('.node-box.selected').forEach(el => el.classList.remove('selected'));
        box.classList.add('selected');
        if (onNodeClick) onNodeClick(cfg.id);
      });

      layout.appendChild(box);
    });

    wrapper.appendChild(layout);
    container.appendChild(wrapper);
  },

  /**
   * 노드 상태 업데이트
   * @param {Array} nodes - [{id, name, status, error, current, position, sto, angle}]
   */
  updateNodes(nodes) {
    if (!nodes || !Array.isArray(nodes)) return;

    // 먼저 모든 노드를 offline으로 리셋
    this.NODE_CONFIG.forEach(cfg => {
      const box = document.getElementById(`can-node-${cfg.id}`);
      if (box) {
        box.className = 'node-box offline';
        if (cfg.type === 'lift') box.classList.add('lift-node');
        if (cfg.type === 'steer') box.classList.add('steer-node');
        if (this.PROTECTED_NODES.includes(cfg.id)) box.classList.add('protected');
        // selected 상태 유지
        if (box.dataset.wasSelected === 'true') box.classList.add('selected');

        const statusIcon = box.querySelector('.node-status-icon');
        const errorSpan = box.querySelector('.node-error');
        const angleSpan = box.querySelector('.node-angle');
        if (statusIcon) statusIcon.textContent = '--';
        if (errorSpan) errorSpan.textContent = '';
        if (angleSpan) angleSpan.textContent = '';
      }
    });

    // 스캔된 노드 업데이트
    nodes.forEach(node => {
      const box = document.getElementById(`can-node-${node.id}`);
      if (!box) return;

      // 상태 클래스 설정
      const stateClass = this._getStateClass(node.status);
      box.classList.remove('offline', 'enable', 'fault', 'disabled', 'duplicate');
      box.classList.add(stateClass);

      // 상태 아이콘
      const statusIcon = box.querySelector('.node-status-icon');
      if (statusIcon) statusIcon.textContent = this._getStatusIcon(node.status);

      // 에러 코드
      const errorSpan = box.querySelector('.node-error');
      if (errorSpan) {
        errorSpan.textContent = node.error ? node.error : '';
      }

      // 조향 각도 (Node 5, 6)
      const angleSpan = box.querySelector('.node-angle');
      if (angleSpan && (node.id === 5 || node.id === 6) && node.angle !== undefined) {
        const arrow = node.angle > 0 ? '\u2192' : node.angle < 0 ? '\u2190' : '\u2191';
        angleSpan.textContent = `${arrow} ${node.angle.toFixed(1)}\u00B0`;
      }
    });
  },

  /**
   * 중복 ID 노드 표시
   * @param {Array} duplicateIds - 중복된 노드 ID 배열
   */
  markDuplicates(duplicateIds) {
    if (!duplicateIds) return;
    duplicateIds.forEach(id => {
      const box = document.getElementById(`can-node-${id}`);
      if (box) {
        box.classList.add('duplicate');
      }
    });
  },

  /**
   * 선택된 노드 ID 반환
   */
  getSelectedNodeId() {
    const selected = document.querySelector('.node-box.selected');
    return selected ? parseInt(selected.dataset.nodeId) : null;
  },

  _getStateClass(status) {
    if (!status) return 'offline';
    const s = status.toLowerCase();
    if (s === 'enable' || s === 'enabled' || s === 'operational') return 'enable';
    if (s === 'fault' || s === 'error') return 'fault';
    if (s === 'disabled' || s === 'pre-operational') return 'disabled';
    if (s === 'duplicate') return 'duplicate';
    return 'offline';
  },

  _getStatusIcon(status) {
    if (!status) return '\u2B1C';
    const s = status.toLowerCase();
    if (s === 'enable' || s === 'enabled' || s === 'operational') return '\u2705';
    if (s === 'fault' || s === 'error') return '\u274C';
    if (s === 'disabled' || s === 'pre-operational') return '\u26A0\uFE0F';
    if (s === 'duplicate') return '\uD83D\uDD04';
    return '\u2B1C';
  }
};
