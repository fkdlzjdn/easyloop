// Network Config Tool - View and configure network settings on robot
const NetworkConfig = {
  init() {
    this.setupUI();
  },

  setupUI() {
    const btn = document.getElementById('btn-network-config');
    if (btn) {
      btn.addEventListener('click', () => this.showModal());
    }
  },

  showModal() {
    let modal = document.getElementById('network-config-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'network-config-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content network-config-modal-content">
          <div class="modal-header">
            <h3>Network Configuration</h3>
            <button class="modal-close" id="btn-netconfig-close">&times;</button>
          </div>
          <div class="network-config-body">
            <div class="netconfig-actions">
              <button id="btn-refresh-netconfig" class="btn btn-small btn-primary">Refresh All</button>
            </div>
            <div class="netconfig-section">
              <h4>Interface List</h4>
              <div id="netconfig-interfaces" class="netconfig-content"></div>
            </div>
            <div class="netconfig-section">
              <h4>IP Configuration</h4>
              <div id="netconfig-ip" class="netconfig-content"></div>
            </div>
            <div class="netconfig-section">
              <h4>Routing Table</h4>
              <div id="netconfig-routes" class="netconfig-content"></div>
            </div>
            <div class="netconfig-section">
              <h4>DNS Configuration</h4>
              <div id="netconfig-dns" class="netconfig-content"></div>
            </div>
            <div class="netconfig-section">
              <h4>Active Connections</h4>
              <div id="netconfig-connections" class="netconfig-content"></div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-netconfig-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      modal.querySelector('#btn-refresh-netconfig').addEventListener('click', () => this.refreshAll());
    }

    this.refreshAll();
    modal.classList.add('active');
  },

  async refreshAll() {
    // Run all network info commands in parallel
    const [interfaces, ipConfig, routes, dns, connections] = await Promise.all([
      this.getInterfaces(),
      this.getIPConfig(),
      this.getRoutes(),
      this.getDNS(),
      this.getConnections()
    ]);

    document.getElementById('netconfig-interfaces').innerHTML = interfaces;
    document.getElementById('netconfig-ip').innerHTML = ipConfig;
    document.getElementById('netconfig-routes').innerHTML = routes;
    document.getElementById('netconfig-dns').innerHTML = dns;
    document.getElementById('netconfig-connections').innerHTML = connections;
  },

  async getInterfaces() {
    try {
      const result = await SSHTerminal.execCommand('ip link show');
      if (result.success && result.stdout) {
        const lines = result.stdout.trim().split('\n');
        const interfaces = [];
        let current = null;

        for (const line of lines) {
          const ifMatch = line.match(/^(\d+):\s+(\S+):/);
          if (ifMatch) {
            if (current) interfaces.push(current);
            current = { name: ifMatch[2], state: '', mac: '' };
            const stateMatch = line.match(/state\s+(\S+)/);
            if (stateMatch) current.state = stateMatch[1];
          } else if (current && line.includes('link/ether')) {
            const macMatch = line.match(/link\/ether\s+(\S+)/);
            if (macMatch) current.mac = macMatch[1];
          }
        }
        if (current) interfaces.push(current);

        return `<table class="netconfig-table">
          <tr><th>Interface</th><th>State</th><th>MAC Address</th></tr>
          ${interfaces.map(iface => `
            <tr>
              <td>${iface.name}</td>
              <td class="${iface.state === 'UP' ? 'state-up' : 'state-down'}">${iface.state}</td>
              <td>${iface.mac || '-'}</td>
            </tr>
          `).join('')}
        </table>`;
      }
      return '<div class="netconfig-error">Failed to get interfaces</div>';
    } catch (e) {
      return `<div class="netconfig-error">Error: ${e.message}</div>`;
    }
  },

  async getIPConfig() {
    try {
      const result = await SSHTerminal.execCommand('ip addr show | grep -E "^[0-9]+:|inet "');
      if (result.success && result.stdout) {
        const lines = result.stdout.trim().split('\n');
        let html = '<div class="netconfig-ip-list">';
        let currentIface = '';

        for (const line of lines) {
          const ifMatch = line.match(/^(\d+):\s+(\S+):/);
          if (ifMatch) {
            currentIface = ifMatch[2];
          } else if (line.includes('inet ')) {
            const ipMatch = line.match(/inet\s+(\S+)/);
            if (ipMatch) {
              html += `<div class="netconfig-ip-item">
                <span class="ip-iface">${currentIface}</span>
                <span class="ip-addr">${ipMatch[1]}</span>
              </div>`;
            }
          }
        }
        html += '</div>';
        return html;
      }
      return '<div class="netconfig-error">Failed to get IP config</div>';
    } catch (e) {
      return `<div class="netconfig-error">Error: ${e.message}</div>`;
    }
  },

  async getRoutes() {
    try {
      const result = await SSHTerminal.execCommand('ip route | head -10');
      if (result.success && result.stdout) {
        return `<pre class="netconfig-pre">${this._escapeHtml(result.stdout.trim())}</pre>`;
      }
      return '<div class="netconfig-error">Failed to get routes</div>';
    } catch (e) {
      return `<div class="netconfig-error">Error: ${e.message}</div>`;
    }
  },

  async getDNS() {
    try {
      const result = await SSHTerminal.execCommand('cat /etc/resolv.conf 2>/dev/null | grep -E "^nameserver|^search"');
      if (result.success && result.stdout) {
        return `<pre class="netconfig-pre">${this._escapeHtml(result.stdout.trim())}</pre>`;
      }
      return '<div class="netconfig-empty">No DNS configuration found</div>';
    } catch (e) {
      return `<div class="netconfig-error">Error: ${e.message}</div>`;
    }
  },

  async getConnections() {
    try {
      const result = await SSHTerminal.execCommand('ss -tulpn 2>/dev/null | head -15');
      if (result.success && result.stdout) {
        const lines = result.stdout.trim().split('\n');
        if (lines.length <= 1) return '<div class="netconfig-empty">No active connections</div>';

        return `<pre class="netconfig-pre netconfig-connections-pre">${this._escapeHtml(result.stdout.trim())}</pre>`;
      }
      return '<div class="netconfig-error">Failed to get connections</div>';
    } catch (e) {
      return `<div class="netconfig-error">Error: ${e.message}</div>`;
    }
  },

  _escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  NetworkConfig.init();
});
