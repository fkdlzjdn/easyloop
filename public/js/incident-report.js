// Incident Report - Automatic report generation for robot issues
const IncidentReport = {
  init() {
    this.setupUI();
  },

  setupUI() {
    const btn = document.getElementById('btn-incident-report');
    if (btn) {
      btn.addEventListener('click', () => this.showModal());
    }
  },

  showModal() {
    let modal = document.getElementById('incident-report-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'incident-report-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content incident-report-modal-content">
          <div class="modal-header">
            <h3>Generate Incident Report</h3>
            <button class="modal-close" id="btn-incident-close">&times;</button>
          </div>
          <div class="incident-report-body">
            <div class="incident-section">
              <label>Incident Type:</label>
              <select id="incident-type" class="incident-input">
                <option value="error">Error / Fault</option>
                <option value="collision">Collision</option>
                <option value="stuck">Robot Stuck</option>
                <option value="communication">Communication Lost</option>
                <option value="battery">Battery Issue</option>
                <option value="hardware">Hardware Malfunction</option>
                <option value="software">Software Bug</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="incident-section">
              <label>Description:</label>
              <textarea id="incident-description" rows="3" class="incident-input" placeholder="Describe what happened..."></textarea>
            </div>
            <div class="incident-section">
              <label>Include in Report:</label>
              <div class="incident-checkboxes">
                <label><input type="checkbox" id="inc-robot-status" checked> Robot Status</label>
                <label><input type="checkbox" id="inc-recent-events" checked> Recent Events (last 20)</label>
                <label><input type="checkbox" id="inc-system-info" checked> System Info</label>
                <label><input type="checkbox" id="inc-ros-info" checked> ROS Node/Topic Status</label>
                <label><input type="checkbox" id="inc-audit-log"> Audit Trail (last 50)</label>
                <label><input type="checkbox" id="inc-screenshot"> Map Screenshot</label>
              </div>
            </div>
            <div class="incident-actions">
              <button id="btn-generate-report" class="btn btn-primary">Generate Report</button>
              <span id="incident-status"></span>
            </div>
            <div id="incident-preview" class="incident-preview" style="display:none;"></div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-incident-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      modal.querySelector('#btn-generate-report').addEventListener('click', () => this.generateReport());
    }

    modal.classList.add('active');
  },

  async generateReport() {
    const status = document.getElementById('incident-status');
    const preview = document.getElementById('incident-preview');
    status.textContent = 'Generating...';
    preview.style.display = 'none';

    const incidentType = document.getElementById('incident-type').value;
    const description = document.getElementById('incident-description').value.trim();

    const includeRobotStatus = document.getElementById('inc-robot-status').checked;
    const includeRecentEvents = document.getElementById('inc-recent-events').checked;
    const includeSystemInfo = document.getElementById('inc-system-info').checked;
    const includeRosInfo = document.getElementById('inc-ros-info').checked;
    const includeAuditLog = document.getElementById('inc-audit-log').checked;
    const includeScreenshot = document.getElementById('inc-screenshot').checked;

    const timestamp = new Date().toISOString();
    const robotId = (typeof RosManager !== 'undefined' && RosManager.getRobotId) ?
      RosManager.getRobotId(App.activeSlotIndex) : 'Unknown';
    const connInfo = App.getConnectionInfo();

    let report = [];
    report.push('# Incident Report');
    report.push('');
    report.push(`**Generated:** ${timestamp}`);
    report.push(`**Robot ID:** ${robotId}`);
    report.push(`**IP Address:** ${connInfo.ip || 'N/A'}`);
    report.push(`**Incident Type:** ${this._getTypeLabel(incidentType)}`);
    report.push('');
    report.push('## Description');
    report.push(description || '(No description provided)');
    report.push('');

    // Robot Status
    if (includeRobotStatus) {
      report.push('## Robot Status');
      report.push('');
      try {
        const pose = typeof RosManager !== 'undefined' ? RosManager.robotPose : null;
        const bms = document.getElementById('bms-soc')?.textContent || 'N/A';
        const workState = document.getElementById('work-state-text')?.textContent || 'N/A';
        const slot = App.robotSlots && App.robotSlots[App.activeSlotIndex];
        const connStatus = slot && slot.connected ? 'Connected' : 'Disconnected';

        report.push(`- **Connection:** ${connStatus}`);
        report.push(`- **Work State:** ${workState}`);
        report.push(`- **Battery SOC:** ${bms}%`);
        if (pose) {
          report.push(`- **Position:** x=${pose.x?.toFixed(3)}, y=${pose.y?.toFixed(3)}, yaw=${(pose.yaw * 180 / Math.PI).toFixed(1)}°`);
        }
      } catch (e) {
        report.push('- Error collecting robot status');
      }
      report.push('');
    }

    // System Info
    if (includeSystemInfo) {
      report.push('## System Information');
      report.push('');
      try {
        if (typeof SysInfo !== 'undefined') {
          const sysData = SysInfo._lastData;
          if (sysData) {
            report.push(`- **CPU Usage:** ${sysData.cpu || 'N/A'}`);
            report.push(`- **Memory:** ${sysData.memUsed || 'N/A'} / ${sysData.memTotal || 'N/A'}`);
            report.push(`- **Disk:** ${sysData.diskUsed || 'N/A'} / ${sysData.diskTotal || 'N/A'}`);
            report.push(`- **Temperature:** ${sysData.temp || 'N/A'}`);
          } else {
            report.push('- System info not available (refresh System Info tab)');
          }
        }
      } catch (e) {
        report.push('- Error collecting system info');
      }
      report.push('');
    }

    // ROS Info
    if (includeRosInfo) {
      report.push('## ROS Status');
      report.push('');
      try {
        const nodeCount = document.getElementById('ros-nodes-count')?.textContent || 'N/A';
        const topicCount = document.getElementById('ros-topics-count')?.textContent || 'N/A';
        const serviceCount = document.getElementById('ros-services-count')?.textContent || 'N/A';

        report.push(`- **Nodes:** ${nodeCount}`);
        report.push(`- **Topics:** ${topicCount}`);
        report.push(`- **Services:** ${serviceCount}`);
      } catch (e) {
        report.push('- Error collecting ROS info');
      }
      report.push('');
    }

    // Recent Events
    if (includeRecentEvents) {
      report.push('## Recent Events (Last 20)');
      report.push('');
      try {
        const events = App.getEventLog().slice(0, 20);
        if (events.length > 0) {
          report.push('| Time | Type | Title | Detail |');
          report.push('|------|------|-------|--------|');
          events.forEach(e => {
            const time = new Date(e.at).toLocaleTimeString();
            report.push(`| ${time} | ${e.level} | ${e.title} | ${e.detail || ''} |`);
          });
        } else {
          report.push('No recent events');
        }
      } catch (e) {
        report.push('- Error collecting events');
      }
      report.push('');
    }

    // Audit Log
    if (includeAuditLog) {
      report.push('## Audit Trail (Last 50)');
      report.push('');
      try {
        const auditLogs = App.getAuditLog().slice(0, 50);
        if (auditLogs.length > 0) {
          report.push('| Time | Action | Robot | Details |');
          report.push('|------|--------|-------|---------|');
          auditLogs.forEach(l => {
            const time = new Date(l.at).toLocaleTimeString();
            const details = Object.entries(l.details || {}).map(([k, v]) => `${k}:${v}`).join(', ');
            report.push(`| ${time} | ${l.action} | ${l.robot || '-'} | ${details} |`);
          });
        } else {
          report.push('No audit logs');
        }
      } catch (e) {
        report.push('- Error collecting audit log');
      }
      report.push('');
    }

    // Screenshot placeholder
    if (includeScreenshot) {
      report.push('## Map Screenshot');
      report.push('');
      report.push('(Screenshot capture not implemented - please attach manually)');
      report.push('');
    }

    report.push('---');
    report.push('*Report generated by EasyLoop*');

    const reportText = report.join('\n');

    // Show preview
    preview.innerHTML = `<pre>${this._escapeHtml(reportText)}</pre>
      <div class="incident-preview-actions">
        <button class="btn btn-small btn-primary" id="btn-download-report">Download (.md)</button>
        <button class="btn btn-small" id="btn-copy-report">Copy to Clipboard</button>
      </div>`;
    preview.style.display = 'block';
    status.textContent = '';

    // Download handler
    preview.querySelector('#btn-download-report').addEventListener('click', () => {
      const blob = new Blob([reportText], { type: 'text/markdown' });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const link = document.createElement('a');
      link.download = `incident_report_${ts}.md`;
      link.href = URL.createObjectURL(blob);
      link.click();
      App.toast('Report downloaded', 'success');
    });

    // Copy handler
    preview.querySelector('#btn-copy-report').addEventListener('click', () => {
      navigator.clipboard.writeText(reportText).then(() => {
        App.toast('Report copied to clipboard', 'success');
      }).catch(() => {
        App.toast('Failed to copy', 'error');
      });
    });

    // Audit log
    if (typeof App !== 'undefined' && App.logAudit) {
      App.logAudit('incident_report', { type: incidentType });
    }
  },

  _getTypeLabel(type) {
    const labels = {
      'error': 'Error / Fault',
      'collision': 'Collision',
      'stuck': 'Robot Stuck',
      'communication': 'Communication Lost',
      'battery': 'Battery Issue',
      'hardware': 'Hardware Malfunction',
      'software': 'Software Bug',
      'other': 'Other'
    };
    return labels[type] || type;
  },

  _escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  IncidentReport.init();
});
