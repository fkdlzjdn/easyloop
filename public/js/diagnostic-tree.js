// Diagnostic Tree - Auto troubleshooting decision tree
const DiagnosticTree = {
  // Decision tree nodes
  tree: {
    root: {
      question: 'What symptom are you experiencing?',
      options: [
        { label: 'Robot not moving', next: 'not_moving' },
        { label: 'Navigation failure', next: 'nav_failure' },
        { label: 'Communication issues', next: 'comm_issues' },
        { label: 'Sensor problems', next: 'sensor_probs' },
        { label: 'Battery/Charging', next: 'battery' }
      ]
    },
    not_moving: {
      question: 'Is the robot receiving commands?',
      options: [
        { label: 'Yes, but no motion', next: 'motor_check' },
        { label: 'No commands received', next: 'comm_issues' },
        { label: 'Error state active', next: 'check_error' }
      ]
    },
    motor_check: {
      question: 'Motor/Drive diagnosis:',
      checks: ['Check motor driver status', 'Verify emergency stop not engaged', 'Check motor cables', 'Test motor response with manual jog'],
      solutions: ['Reset motor driver', 'Release emergency stop', 'Check power to motors', 'Replace motor driver if faulty']
    },
    nav_failure: {
      question: 'Navigation failure type?',
      options: [
        { label: 'Localization lost', next: 'localization' },
        { label: 'Cannot find path', next: 'path_planning' },
        { label: 'Obstacle detected', next: 'obstacle' },
        { label: 'Goal unreachable', next: 'goal_issue' }
      ]
    },
    localization: {
      question: 'Localization diagnosis:',
      checks: ['Check AMCL particle spread', 'Verify LiDAR data quality', 'Check map matching', 'Verify initial pose'],
      solutions: ['Relocalize robot with 2D Pose Estimate', 'Clear AMCL and reinitialize', 'Check for map changes', 'Reduce AMCL particle noise']
    },
    path_planning: {
      question: 'Path planning diagnosis:',
      checks: ['Check costmap inflation', 'Verify goal is in free space', 'Check global planner timeout', 'Verify map is loaded'],
      solutions: ['Clear costmaps', 'Adjust inflation radius', 'Set goal in clear area', 'Restart move_base']
    },
    obstacle: {
      question: 'Obstacle diagnosis:',
      checks: ['Check LiDAR for phantom readings', 'Verify obstacle layer', 'Check sensor mounting', 'Verify costmap clearing'],
      solutions: ['Clear costmaps', 'Check sensor angles', 'Adjust obstacle detection params', 'Reset obstacle layer']
    },
    goal_issue: {
      question: 'Goal position diagnosis:',
      checks: ['Verify goal within map bounds', 'Check goal orientation', 'Verify tolerance settings', 'Check goal frame_id'],
      solutions: ['Set goal in valid area', 'Adjust goal tolerance', 'Verify correct coordinate frame']
    },
    comm_issues: {
      question: 'Communication problem type?',
      options: [
        { label: 'ROS topic missing', next: 'ros_topic' },
        { label: 'Network connection', next: 'network' },
        { label: 'WebSocket disconnect', next: 'websocket' }
      ]
    },
    ros_topic: {
      question: 'ROS topic diagnosis:',
      checks: ['Check if node is running', 'Verify topic publication', 'Check ROS_MASTER_URI', 'Verify topic remapping'],
      solutions: ['Restart the node', 'Check roscore status', 'Verify network configuration', 'Check launch file']
    },
    network: {
      question: 'Network diagnosis:',
      checks: ['Ping test to robot', 'Check IP configuration', 'Verify firewall rules', 'Check cable/WiFi connection'],
      solutions: ['Check network cables', 'Restart network interface', 'Configure firewall', 'Switch to wired connection']
    },
    websocket: {
      question: 'WebSocket diagnosis:',
      checks: ['Check rosbridge status', 'Verify port accessibility', 'Check browser console', 'Verify CORS settings'],
      solutions: ['Restart rosbridge_server', 'Check port 9090 is open', 'Clear browser cache', 'Check rosbridge parameters']
    },
    sensor_probs: {
      question: 'Which sensor has issues?',
      options: [
        { label: 'LiDAR', next: 'lidar' },
        { label: 'Camera', next: 'camera' },
        { label: 'IMU', next: 'imu' },
        { label: 'Encoders', next: 'encoders' }
      ]
    },
    lidar: {
      question: 'LiDAR diagnosis:',
      checks: ['Check LiDAR connection', 'Verify topic publishing', 'Check for obstructions', 'Verify scan data quality'],
      solutions: ['Check USB/Ethernet connection', 'Restart LiDAR driver', 'Clean LiDAR lens', 'Check power supply']
    },
    camera: {
      question: 'Camera diagnosis:',
      checks: ['Check camera connection', 'Verify image topic', 'Check exposure settings', 'Verify driver status'],
      solutions: ['Reconnect camera', 'Restart camera driver', 'Adjust lighting', 'Update camera firmware']
    },
    imu: {
      question: 'IMU diagnosis:',
      checks: ['Check IMU topic', 'Verify calibration', 'Check for drift', 'Verify mounting'],
      solutions: ['Recalibrate IMU', 'Check mounting stability', 'Restart IMU driver', 'Replace if faulty']
    },
    encoders: {
      question: 'Encoder diagnosis:',
      checks: ['Check encoder counts', 'Verify wheel radius', 'Check for slippage', 'Verify wiring'],
      solutions: ['Recalibrate wheel parameters', 'Check encoder connections', 'Clean encoder wheels', 'Replace encoder']
    },
    battery: {
      question: 'Battery/Charging issue type?',
      options: [
        { label: 'Not charging', next: 'charging' },
        { label: 'Fast drain', next: 'drain' },
        { label: 'BMS error', next: 'bms_error' }
      ]
    },
    charging: {
      question: 'Charging diagnosis:',
      checks: ['Check charger connection', 'Verify docking alignment', 'Check charge contacts', 'Verify charger output'],
      solutions: ['Clean charge contacts', 'Realign docking station', 'Check charger power', 'Replace charging cables']
    },
    drain: {
      question: 'Battery drain diagnosis:',
      checks: ['Check power consumption', 'Verify battery health', 'Check for parasitic loads', 'Review usage patterns'],
      solutions: ['Reduce unnecessary loads', 'Replace aging battery', 'Check for short circuits', 'Optimize driving patterns']
    },
    bms_error: {
      question: 'BMS error diagnosis:',
      checks: ['Read BMS error code', 'Check cell voltages', 'Verify temperature', 'Check BMS communication'],
      solutions: ['Reset BMS', 'Check cell balance', 'Allow cooling/warming', 'Update BMS firmware']
    },
    check_error: {
      question: 'Error state diagnosis:',
      checks: ['Read work_state value', 'Check error code', 'Verify last action', 'Check system logs'],
      solutions: ['Cancel current task', 'Reset robot state', 'Check Error DB for code meaning', 'Restart relevant nodes']
    }
  },

  currentNode: 'root',
  history: [],

  init() {
    if (this._initialized) return;
    this._initialized = true;
    const btn = document.getElementById('btn-diagnostic');
    if (btn) {
      btn.addEventListener('click', () => this.showModal());
    }
  },

  showModal() {
    let modal = document.getElementById('diagnostic-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'diagnostic-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content diagnostic-modal-content">
          <div class="modal-header">
            <h3>Diagnostic Tree</h3>
            <button class="modal-close" id="btn-diagnostic-close">&times;</button>
          </div>
          <div class="diagnostic-body">
            <div class="diagnostic-breadcrumb" id="diagnostic-breadcrumb"></div>
            <div id="diagnostic-content"></div>
            <div class="diagnostic-actions">
              <button id="btn-diagnostic-back" class="btn btn-small" disabled>← Back</button>
              <button id="btn-diagnostic-restart" class="btn btn-small">Restart</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-diagnostic-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      modal.querySelector('#btn-diagnostic-back').addEventListener('click', () => this.goBack());
      modal.querySelector('#btn-diagnostic-restart').addEventListener('click', () => this.restart());
    }

    this.restart();
    modal.classList.add('active');
  },

  restart() {
    this.currentNode = 'root';
    this.history = [];
    this.render();
  },

  goBack() {
    if (this.history.length > 0) {
      this.currentNode = this.history.pop();
      this.render();
    }
  },

  navigate(nodeId) {
    this.history.push(this.currentNode);
    this.currentNode = nodeId;
    this.render();
  },

  render() {
    const node = this.tree[this.currentNode];
    const contentEl = document.getElementById('diagnostic-content');
    const breadcrumbEl = document.getElementById('diagnostic-breadcrumb');
    const backBtn = document.getElementById('btn-diagnostic-back');

    backBtn.disabled = this.history.length === 0;

    // Breadcrumb
    const path = [...this.history, this.currentNode];
    breadcrumbEl.innerHTML = path.map((n) => {
      const label = n.replace(/_/g, ' ');
      return `<span class="diag-crumb">${label}</span>`;
    }).join(' → ');

    let html = `<div class="diag-question">${node.question}</div>`;

    if (node.options) {
      html += '<div class="diag-options">';
      node.options.forEach(opt => {
        html += `<button class="btn diag-option" data-next="${opt.next}">${opt.label}</button>`;
      });
      html += '</div>';
    }

    if (node.checks) {
      html += '<div class="diag-checks"><h4>Checks to perform:</h4><ul>';
      node.checks.forEach(c => { html += `<li>${c}</li>`; });
      html += '</ul></div>';
    }

    if (node.solutions) {
      html += '<div class="diag-solutions"><h4>Possible solutions:</h4><ul>';
      node.solutions.forEach(s => { html += `<li>${s}</li>`; });
      html += '</ul></div>';
    }

    contentEl.innerHTML = html;

    // Option click handlers
    contentEl.querySelectorAll('.diag-option').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.next));
    });
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  DiagnosticTree.init();
});
