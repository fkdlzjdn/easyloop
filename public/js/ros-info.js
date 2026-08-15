// ROS Information - Nodes, Topics, Services, Params
const RosInfo = {
  // Store full data for search filtering
  _data: { nodes: [], topics: [], topicTypes: [], services: [], params: [] },
  _favorites: [],

  filterList(selectId) {
    const searchInput = document.getElementById(selectId + '-search');
    if (!searchInput) return;
    const query = searchInput.value.toLowerCase().trim();
    const select = document.getElementById(selectId);
    const countEl = document.getElementById(selectId + '-count');

    let items;
    if (selectId === 'ros-nodes') items = this._data.nodes;
    else if (selectId === 'ros-topics') items = this._data.topics;
    else if (selectId === 'ros-services') items = this._data.services;
    else if (selectId === 'ros-params') items = this._data.params;
    else return;

    const filtered = query ? items.filter(item => item.toLowerCase().includes(query)) : items;

    select.innerHTML = '';
    filtered.forEach((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      if (selectId === 'ros-topics' && this._data.topicTypes.length) {
        const origIdx = this._data.topics.indexOf(item);
        if (origIdx >= 0) option.title = this._data.topicTypes[origIdx] || '';
      }
      select.appendChild(option);
    });

    if (countEl) {
      countEl.textContent = query ? `(${filtered.length}/${items.length})` : `(${items.length})`;
    }
  },

  refreshAll() {
    if (!RosManager.ros) {
      App.toast('ROS is not connected', 'error');
      return;
    }

    const refreshBtn = document.getElementById('btn-refresh-ros-info');
    App.setButtonLoading(refreshBtn, true, 'Refreshing');
    let pending = 4;
    const done = () => {
      pending -= 1;
      if (pending <= 0) {
        App.setButtonLoading(refreshBtn, false);
      }
    };

    this.refreshNodes(done);
    this.refreshTopics(done);
    this.refreshServices(done);
    this.refreshParams(done);
  },

  refreshNodes(button, onDone) {
    if (typeof button === 'function') {
      onDone = button;
      button = null;
    }

    if (!RosManager.ros) {
      App.toast('ROS is not connected', 'error');
      if (onDone) onDone();
      return;
    }

    App.setButtonLoading(button, true);

    RosManager.ros.getNodes((nodes) => {
      this._data.nodes = nodes.sort();
      const searchEl = document.getElementById('ros-nodes-search');
      if (searchEl) searchEl.value = '';
      this.filterList('ros-nodes');
      App.setButtonLoading(button, false);
      if (onDone) onDone();
    });
  },

  refreshTopics(button, onDone) {
    if (typeof button === 'function') {
      onDone = button;
      button = null;
    }

    if (!RosManager.ros) {
      App.toast('ROS is not connected', 'error');
      if (onDone) onDone();
      return;
    }

    App.setButtonLoading(button, true);

    RosManager.ros.getTopics((result) => {
      const topics = result.topics || [];
      const types = result.types || [];
      // Sort and keep types aligned
      const paired = topics.map((t, i) => ({ topic: t, type: types[i] || '' }));
      paired.sort((a, b) => a.topic.localeCompare(b.topic));
      this._data.topics = paired.map(p => p.topic);
      this._data.topicTypes = paired.map(p => p.type);
      const searchEl = document.getElementById('ros-topics-search');
      if (searchEl) searchEl.value = '';
      this.filterList('ros-topics');
      App.setButtonLoading(button, false);
      if (onDone) onDone();
    });
  },

  refreshServices(button, onDone) {
    if (typeof button === 'function') {
      onDone = button;
      button = null;
    }

    if (!RosManager.ros) {
      App.toast('ROS is not connected', 'error');
      if (onDone) onDone();
      return;
    }

    App.setButtonLoading(button, true);

    RosManager.ros.getServices((services) => {
      this._data.services = services.sort();
      const searchEl = document.getElementById('ros-services-search');
      if (searchEl) searchEl.value = '';
      this.filterList('ros-services');
      App.setButtonLoading(button, false);
      if (onDone) onDone();
    });
  },

  refreshParams(button, onDone) {
    if (typeof button === 'function') {
      onDone = button;
      button = null;
    }

    if (!RosManager.ros) {
      App.toast('ROS not connected', 'error');
      if (onDone) onDone();
      return;
    }

    App.setButtonLoading(button, true);

    RosManager.ros.getParams((params) => {
      this._data.params = params.sort();
      const searchEl = document.getElementById('ros-params-search');
      if (searchEl) searchEl.value = '';
      this.filterList('ros-params');
      App.setButtonLoading(button, false);
      if (onDone) onDone();
    });
  },

  loadFavorites() {
    try { this._favorites = JSON.parse(localStorage.getItem('rosFavorites') || '[]'); } catch(e) { this._favorites = []; }
    this.renderFavorites();
  },

  saveFavorites() {
    // B13 fix: localStorage 안전 쓰기
    try { localStorage.setItem('rosFavorites', JSON.stringify(this._favorites)); }
    catch (e) { console.warn('localStorage.setItem rosFavorites failed:', e.message); }
  },

  toggleFavorite(name, type) {
    const idx = this._favorites.findIndex(f => f.name === name && f.type === type);
    if (idx >= 0) {
      this._favorites.splice(idx, 1);
    } else {
      this._favorites.push({ name, type });
    }
    this.saveFavorites();
    this.renderFavorites();
  },

  clearFavorites() {
    this._favorites = [];
    this.saveFavorites();
    this.renderFavorites();
  },

  isFavorite(name, type) {
    return this._favorites.some(f => f.name === name && f.type === type);
  },

  renderFavorites() {
    const container = document.getElementById('ros-favorites-list');
    if (!container) return;
    container.innerHTML = '';
    if (this._favorites.length === 0) {
      container.innerHTML = '<span class="favorites-empty">Double-click items to pin favorites</span>';
      return;
    }
    this._favorites.forEach(fav => {
      const chip = document.createElement('span');
      chip.className = 'favorite-chip';
      chip.textContent = fav.name;
      chip.title = `${fav.type}: ${fav.name}`;
      const removeBtn = document.createElement('span');
      removeBtn.className = 'favorite-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFavorite(fav.name, fav.type);
      });
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }
};

// Event handlers
document.addEventListener('DOMContentLoaded', () => {
  // Refresh All button
  document.getElementById('btn-refresh-ros-info').addEventListener('click', () => {
    RosInfo.refreshAll();
  });

  // Search inputs - filter on typing
  document.querySelectorAll('.ros-info-search').forEach(input => {
    input.addEventListener('input', () => {
      RosInfo.filterList(input.dataset.target);
    });
  });

  // Individual refresh buttons
  document.querySelectorAll('.btn-mini[data-refresh]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.refresh;
      switch (type) {
        case 'nodes': RosInfo.refreshNodes(btn); break;
        case 'topics': RosInfo.refreshTopics(btn); break;
        case 'services': RosInfo.refreshServices(btn); break;
        case 'params': RosInfo.refreshParams(btn); break;
      }
    });
  });

  // Load favorites
  RosInfo.loadFavorites();

  const favoritesClearBtn = document.getElementById('btn-ros-fav-clear');
  if (favoritesClearBtn) {
    favoritesClearBtn.addEventListener('click', () => {
      RosInfo.clearFavorites();
      App.toast('ROS 즐겨찾기를 모두 지웠습니다.', 'info');
    });
  }

  // Double-click on list items to toggle favorites
  ['ros-nodes', 'ros-topics', 'ros-services', 'ros-params'].forEach(selectId => {
    const selectEl = document.getElementById(selectId);
    if (selectEl) {
      selectEl.addEventListener('dblclick', () => {
        const selected = selectEl.value;
        if (selected) {
          const type = selectId.replace('ros-', '');
          RosInfo.toggleFavorite(selected, type);
          App.toast(`${selected} ${RosInfo.isFavorite(selected, type) ? 'pinned' : 'unpinned'}`, 'info');
        }
      });
    }
  });

  // Node restart button
  const nodeRestartBtn = document.getElementById('btn-node-restart');
  if (nodeRestartBtn) {
    nodeRestartBtn.addEventListener('click', () => RosInfo.restartSelectedNode());
  }

  // Message type browser button
  const msgBrowserBtn = document.getElementById('btn-msg-type-browser');
  if (msgBrowserBtn) {
    msgBrowserBtn.addEventListener('click', () => RosInfo.showMessageTypeBrowser());
  }
});

// Node restart functionality
// Message type browser
RosInfo.showMessageTypeBrowser = function() {
  const types = [...new Set(this._data.topicTypes.filter(t => t))];
  if (!types.length) {
    App.toast('No message types loaded. Refresh topics first.', 'warning');
    return;
  }

  types.sort();
  const listHtml = types.map(t => `<div class="msg-type-item" data-type="${t}">${t}</div>`).join('');

  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'msg-type-browser-modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:600px;">
      <div class="modal-header">
        <h3>Message Type Browser</h3>
        <button class="modal-close" id="btn-msg-browser-close">&times;</button>
      </div>
      <div class="msg-type-browser-body">
        <div class="msg-type-list">${listHtml}</div>
        <div class="msg-type-detail">
          <pre id="msg-type-definition">Select a message type to view its definition</pre>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btn-msg-browser-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelectorAll('.msg-type-item').forEach(item => {
    item.addEventListener('click', () => {
      modal.querySelectorAll('.msg-type-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      this.showMessageDefinition(item.dataset.type);
    });
  });
};

RosInfo.showMessageDefinition = async function(msgType) {
  const defEl = document.getElementById('msg-type-definition');
  if (!defEl) return;

  defEl.textContent = 'Loading...';

  const robot = App.getActiveRobot();
  if (!robot || !robot.ip) {
    defEl.textContent = 'No robot connected';
    return;
  }

  try {
    const res = await fetchWithTimeout('/api/ssh/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: robot.ip,
        user: robot.sshUser || 'ubuntu',
        password: robot.sshPassword || 'ubuntu',
        command: `rosmsg show ${msgType}`
      })
    });

    const data = await res.json();
    if (data.success) {
      defEl.textContent = data.output || '(empty)';
    } else {
      defEl.textContent = `Error: ${data.error || 'Failed'}`;
    }
  } catch (e) {
    defEl.textContent = `Error: ${e.message}`;
  }
};

RosInfo.restartSelectedNode = async function() {
  const nodeSelect = document.getElementById('ros-nodes');
  if (!nodeSelect || !nodeSelect.value) {
    App.toast('Please select a node first', 'warning');
    return;
  }

  const nodeName = nodeSelect.value;
  if (!confirm(`Restart node: ${nodeName}?\n\nThis will kill and respawn the node using rosnode kill.`)) {
    return;
  }

  const robot = App.getActiveRobot();
  if (!robot || !robot.ip) {
    App.toast('No robot connected', 'error');
    return;
  }

  App.toast(`Restarting node: ${nodeName}...`, 'info');

  try {
    const res = await fetchWithTimeout('/api/ssh/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: robot.ip,
        user: robot.sshUser || 'ubuntu',
        password: robot.sshPassword || 'ubuntu',
        command: `rosnode kill ${nodeName}`
      })
    });

    const data = await res.json();
    if (data.success) {
      App.toast(`Node ${nodeName} killed. It should respawn if managed by launch file.`, 'success');
      // Refresh nodes after a delay
      setTimeout(() => RosInfo.refreshNodes(), 2000);
    } else {
      App.toast(`Failed to kill node: ${data.error || 'Unknown error'}`, 'error');
    }
  } catch (e) {
    App.toast(`Error: ${e.message}`, 'error');
  }
};
