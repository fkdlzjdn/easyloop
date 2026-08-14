// Docking Test - Field Application Testing
const DockingTest = {
  STORAGE_KEY: 'dockingTestParams',

  // Docking type definitions with parameters
  // Parameters array (15 elements): [dock_dist, dock_dist_flag, scan_view, center_offset, marker_size,
  //   marker_type, v_angle, x_offset, y_offset, cradle_width, cradle_depth,
  //   target_id_1, target_id_2, target_size, quad_flag]
  dockingTypes: {
    'L_dock': {
      name: 'L_dock (Riser)',
      desc: 'Riser-based docking using distance',
      params: [
        { name: 'dock_dist', idx: 0, default: 0.2, desc: 'Docking distance (m)' },
        { name: 'dock_dist_flag', idx: 1, default: 1, desc: 'Use distance constraint', type: 'bool' }
      ]
    },
    'LV_dock': {
      name: 'LV_dock (Vertical Marker + Riser)',
      desc: 'Camera-based docking with vertical marker and angle detection',
      params: [
        { name: 'dock_dist', idx: 0, default: 0.2, desc: 'Docking distance (m)' },
        { name: 'dock_dist_flag', idx: 1, default: 1, desc: 'Use distance constraint', type: 'bool' },
        { name: 'v_angle', idx: 6, default: 120, desc: 'Vertical angle (deg)' },
        { name: 'marker_type', idx: 5, default: 1, desc: 'Marker type' }
      ]
    },
    'Cradle_dock': {
      name: 'Cradle_dock (Cradle)',
      desc: 'Cradle-style docking with X/Y offset',
      params: [
        { name: 'dock_dist', idx: 0, default: 0.2, desc: 'Docking distance (m)' },
        { name: 'dock_dist_flag', idx: 1, default: 1, desc: 'Use distance constraint', type: 'bool' },
        { name: 'x_offset', idx: 7, default: 0.0, desc: 'X-axis offset (m)' },
        { name: 'y_offset', idx: 8, default: 0.0, desc: 'Y-axis offset (m)' },
        { name: 'cradle_width', idx: 9, default: 0.5, desc: 'Cradle width (m)' },
        { name: 'cradle_depth', idx: 10, default: 0.3, desc: 'Cradle depth (m)' }
      ]
    },
    'Rack_dock': {
      name: 'Rack_dock (Rack)',
      desc: 'Rack-style docking with scan angle',
      params: [
        { name: 'dock_dist', idx: 0, default: 0.2, desc: 'Docking distance (m)' },
        { name: 'dock_dist_flag', idx: 1, default: 1, desc: 'Use distance constraint', type: 'bool' },
        { name: 'scan_view', idx: 2, default: 60, desc: 'Scan angle (deg)' },
        { name: 'center_offset', idx: 3, default: 0.0, desc: 'Center offset (m)' }
      ]
    },
    'Aruco_dock': {
      name: 'Aruco_dock (ArUco Marker)',
      desc: 'ArUco marker-based docking',
      params: [
        { name: 'dock_dist', idx: 0, default: 0.2, desc: 'Docking distance (m)' },
        { name: 'dock_dist_flag', idx: 1, default: 1, desc: 'Use distance constraint', type: 'bool' },
        { name: 'target_id_1', idx: 11, default: 0, desc: 'Target ArUco ID 1' },
        { name: 'target_id_2', idx: 12, default: 1, desc: 'Target ArUco ID 2' },
        { name: 'target_size', idx: 13, default: 0.1, desc: 'Target marker size (m)' },
        { name: 'marker_size', idx: 4, default: 0.05, desc: 'Marker size (m)' },
        { name: 'quad_flag', idx: 14, default: 0, desc: 'Use quad marker', type: 'bool' }
      ]
    },
    'ML_LV_dock': {
      name: 'ML_LV_dock (ML + LV)',
      desc: 'Machine learning combined with LV docking',
      params: [
        { name: 'dock_dist', idx: 0, default: 0.2, desc: 'Docking distance (m)' },
        { name: 'dock_dist_flag', idx: 1, default: 1, desc: 'Use distance constraint', type: 'bool' },
        { name: 'scan_view', idx: 2, default: 90, desc: 'Scan view angle (deg)' },
        { name: 'v_angle', idx: 6, default: 120, desc: 'Vertical angle (deg)' },
        { name: 'marker_type', idx: 5, default: 1, desc: 'Marker type' }
      ]
    }
  },

  // Test state
  testStatus: 'idle', // 'idle', 'running', 'completed', 'stopped'
  currentCycle: 0,
  totalCycles: 0,
  results: {
    dockIn: [],  // Array of docking in times (seconds)
    dockOut: [], // Array of docking out times (seconds)
    precision: [] // Array of precision measurements {x, y, yaw, distance}
  },
  subscriptions: [],
  testStartTime: null,
  cycleStartTime: null,

  // OptiTrack state
  optitrack: {
    connected: false,
    serverIp: '',
    rigidBodies: {},  // { id: { name, pose } }
    selectedBody: '',
    referenceBody: '',
    referencePose: null, // Reference pose for precision calculation
    subscription: null
  },

  // Graph state for cluster monitoring
  graph: {
    xyData: [],       // Array of {x, y} in mm (relative to reference)
    yawData: [],      // Array of {time, yaw} in degrees
    maxPoints: 500,
    scale: 50,        // mm per half-canvas
    recording: true,
    startTime: null,
    animationFrame: null
  },

  init() {
    this.setupEventListeners();
    this.setupOptiTrackListeners();
    this.setupGraphListeners();
    this.updateParamForm('LV_dock'); // Default docking type
    this.loadSavedParams();
    this.loadOptiTrackSettings();
    this.initGraphCanvases();
  },

  setupEventListeners() {
    // Docking type change
    document.getElementById('docking-type-select').addEventListener('change', (e) => {
      this.updateParamForm(e.target.value);
    });

    // Start test button
    document.getElementById('btn-docking-start').addEventListener('click', () => {
      this.startTest();
    });

    // Stop test button
    document.getElementById('btn-docking-stop').addEventListener('click', () => {
      this.stopTest();
    });

    // Export CSV button
    document.getElementById('btn-docking-export').addEventListener('click', () => {
      this.exportResults();
    });
  },

  // OptiTrack event listeners
  setupOptiTrackListeners() {
    // Scan button
    document.getElementById('btn-optitrack-scan').addEventListener('click', () => {
      this.scanOptiTrack();
    });

    // Connect button
    document.getElementById('btn-optitrack-connect').addEventListener('click', () => {
      this.connectOptiTrack();
    });

    // Disconnect button
    document.getElementById('btn-optitrack-disconnect').addEventListener('click', () => {
      this.disconnectOptiTrack();
    });

    // Rigid body selection change
    document.getElementById('optitrack-rigid-body').addEventListener('change', (e) => {
      this.optitrack.selectedBody = e.target.value;
      this.saveOptiTrackSettings();
    });

    // Reference selection change
    document.getElementById('optitrack-reference').addEventListener('change', (e) => {
      this.optitrack.referenceBody = e.target.value;
      this.saveOptiTrackSettings();
    });

    // Set reference button
    document.getElementById('btn-optitrack-set-ref').addEventListener('click', () => {
      this.setOptiTrackReference();
    });
  },

  // Scan for OptiTrack server via ROS service
  scanOptiTrack() {
    if (!RosManager.ros) {
      this.log('Error: ROS not connected', true);
      return;
    }

    this.log('Scanning for OptiTrack server...');
    document.getElementById('btn-optitrack-scan').disabled = true;

    // Call optitrack_node service to get server info
    const scanService = new ROSLIB.Service({
      ros: RosManager.ros,
      name: '/optitrack/get_server_info',
      serviceType: 'std_srvs/Trigger'
    });

    scanService.callService(new ROSLIB.ServiceRequest({}), (result) => {
      document.getElementById('btn-optitrack-scan').disabled = false;
      if (result.success) {
        // Parse server IP from result message
        const match = result.message.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (match) {
          document.getElementById('optitrack-ip').value = match[1];
          this.log(`Found OptiTrack server: ${match[1]}`);
        } else {
          this.log(`OptiTrack info: ${result.message}`);
        }
      } else {
        this.log('OptiTrack scan: ' + (result.message || 'No server found'), true);
      }
    }, (_error) => {
      document.getElementById('btn-optitrack-scan').disabled = false;
      // Try alternative: check if optitrack topics exist
      this.scanOptiTrackTopics();
    });
  },

  // Alternative scan: look for existing optitrack topics
  scanOptiTrackTopics() {
    if (!RosManager.ros) return;

    RosManager.ros.getTopics((topics) => {
      const optitrackTopics = topics.topics.filter(t =>
        t.includes('optitrack') || t.includes('vrpn') || t.includes('mocap')
      );

      if (optitrackTopics.length > 0) {
        this.log(`Found motion capture topics: ${optitrackTopics.join(', ')}`);
        // Try to extract IP from parameter server
        this.getOptiTrackIpFromParams();
      } else {
        this.log('No OptiTrack topics found. Enter IP manually.', true);
      }
    });
  },

  // Get OptiTrack IP from ROS params
  getOptiTrackIpFromParams() {
    const paramNames = [
      '/optitrack/server_address',
      '/optitrack_node/server_address',
      '/vrpn_client_node/server',
      '/mocap/server_address'
    ];

    paramNames.forEach(paramName => {
      RosManager.getParam(paramName, (result) => {
        if (result.success && result.value) {
          const ip = result.value.replace(/:\d+$/, ''); // Remove port if present
          document.getElementById('optitrack-ip').value = ip;
          this.log(`Found OptiTrack server IP: ${ip}`);
        }
      });
    });
  },

  // Connect to OptiTrack
  connectOptiTrack() {
    if (!RosManager.ros) {
      this.log('Error: ROS not connected', true);
      return;
    }

    const serverIp = document.getElementById('optitrack-ip').value.trim();
    if (!serverIp) {
      this.log('Error: Please enter OptiTrack server IP', true);
      return;
    }

    this.log(`Connecting to OptiTrack server: ${serverIp}`);
    this.optitrack.serverIp = serverIp;

    // Try to set server address parameter and start node
    const setParamService = new ROSLIB.Service({
      ros: RosManager.ros,
      name: '/optitrack/set_server',
      serviceType: 'std_srvs/SetBool'
    });

    // First try custom service, then fallback to direct subscription
    setParamService.callService(
      new ROSLIB.ServiceRequest({ data: true }),
      (result) => {
        if (result.success) {
          this.log('OptiTrack server configured');
        }
        this.subscribeOptiTrackData();
      },
      (_error) => {
        // Service not available, try direct subscription
        this.subscribeOptiTrackData();
      }
    );
  },

  // Subscribe to OptiTrack rigid body data
  subscribeOptiTrackData() {
    if (this.optitrack.subscription) {
      this.optitrack.subscription.unsubscribe();
    }

    // Try different topic patterns for OptiTrack data
    // First, get list of available topics to find the right one
    RosManager.ros.getTopics((topics) => {
      let foundTopic = null;

      // Look for rigid body topics
      for (const topic of topics.topics) {
        if (topic.includes('rigid_bod') || topic.includes('pose')) {
          if (topic.includes('optitrack') || topic.includes('vrpn') || topic.includes('mocap')) {
            foundTopic = { name: topic, type: topics.types[topics.topics.indexOf(topic)] };
            break;
          }
        }
      }

      // Also check for individual rigid body topics (e.g., /vrpn_client_node/RigidBody1/pose)
      const rigidBodyTopics = topics.topics.filter(t =>
        (t.includes('optitrack') || t.includes('vrpn') || t.includes('mocap')) &&
        t.includes('pose')
      );

      if (rigidBodyTopics.length > 0) {
        this.subscribeToIndividualBodies(rigidBodyTopics, topics.types);
      } else if (foundTopic) {
        this.subscribeToRigidBodyArray(foundTopic.name, foundTopic.type);
      } else {
        // Try default topic
        this.subscribeToRigidBodyArray('/optitrack/rigid_bodies', 'geometry_msgs/PoseArray');
      }
    });
  },

  // Subscribe to individual rigid body pose topics
  subscribeToIndividualBodies(topicNames, types) {
    this.log(`Subscribing to ${topicNames.length} rigid body topics`);

    topicNames.forEach((topicName, idx) => {
      const topic = new ROSLIB.Topic({
        ros: RosManager.ros,
        name: topicName,
        messageType: types[idx] || 'geometry_msgs/PoseStamped',
        throttle_rate: 100
      });

      // Extract body name from topic (e.g., /vrpn_client_node/Robot1/pose -> Robot1)
      const bodyName = topicName.split('/').slice(-2, -1)[0] || `Body${idx}`;

      topic.subscribe((msg) => {
        this.onRigidBodyPose(bodyName, msg);
      });

      this.subscriptions.push(topic);
    });

    this.updateOptiTrackStatus(true);
  },

  // Subscribe to rigid body array topic
  subscribeToRigidBodyArray(topicName, messageType) {
    this.log(`Subscribing to ${topicName}`);

    this.optitrack.subscription = new ROSLIB.Topic({
      ros: RosManager.ros,
      name: topicName,
      messageType: messageType,
      throttle_rate: 100
    });

    this.optitrack.subscription.subscribe((msg) => {
      this.onRigidBodyArray(msg);
    });

    this.subscriptions.push(this.optitrack.subscription);
    this.updateOptiTrackStatus(true);
  },

  // Handle individual rigid body pose message
  onRigidBodyPose(bodyName, msg) {
    const pose = msg.pose || msg;

    this.optitrack.rigidBodies[bodyName] = {
      name: bodyName,
      pose: {
        position: pose.position,
        orientation: pose.orientation
      }
    };

    this.updateRigidBodyList();

    if (this.optitrack.selectedBody === bodyName) {
      this.updateOptiTrackDisplay(pose);
    }
  },

  // Handle rigid body array message
  onRigidBodyArray(msg) {
    const poses = msg.poses || msg.rigid_bodies || [];

    poses.forEach((item, idx) => {
      const name = item.name || `Body${idx + 1}`;
      const pose = item.pose || item;

      this.optitrack.rigidBodies[name] = {
        name: name,
        pose: {
          position: pose.position,
          orientation: pose.orientation
        }
      };
    });

    this.updateRigidBodyList();

    if (this.optitrack.selectedBody && this.optitrack.rigidBodies[this.optitrack.selectedBody]) {
      this.updateOptiTrackDisplay(this.optitrack.rigidBodies[this.optitrack.selectedBody].pose);
    }
  },

  // Update rigid body dropdown list
  updateRigidBodyList() {
    const bodySelect = document.getElementById('optitrack-rigid-body');
    const refSelect = document.getElementById('optitrack-reference');
    const currentBody = bodySelect.value;
    const currentRef = refSelect.value;

    const bodies = Object.keys(this.optitrack.rigidBodies);

    // Only update if list changed
    const existingOptions = Array.from(bodySelect.options).map(o => o.value).filter(v => v);
    if (JSON.stringify(bodies.sort()) === JSON.stringify(existingOptions.sort())) {
      return;
    }

    // Update body select
    bodySelect.innerHTML = '<option value="">-- Select --</option>';
    bodies.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      bodySelect.appendChild(option);
    });

    // Update reference select
    refSelect.innerHTML = '<option value="">-- Select --</option>';
    bodies.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      refSelect.appendChild(option);
    });

    // Restore selection
    if (currentBody && bodies.includes(currentBody)) {
      bodySelect.value = currentBody;
    } else if (this.optitrack.selectedBody && bodies.includes(this.optitrack.selectedBody)) {
      bodySelect.value = this.optitrack.selectedBody;
    }

    if (currentRef && bodies.includes(currentRef)) {
      refSelect.value = currentRef;
    } else if (this.optitrack.referenceBody && bodies.includes(this.optitrack.referenceBody)) {
      refSelect.value = this.optitrack.referenceBody;
    }
  },

  // Update OptiTrack pose display
  updateOptiTrackDisplay(pose) {
    if (!pose) return;

    // Position
    document.getElementById('optitrack-pos-x').textContent = pose.position.x.toFixed(4) + ' m';
    document.getElementById('optitrack-pos-y').textContent = pose.position.y.toFixed(4) + ' m';
    document.getElementById('optitrack-pos-z').textContent = pose.position.z.toFixed(4) + ' m';

    // Convert quaternion to Euler angles
    const euler = this.quaternionToEuler(pose.orientation);
    document.getElementById('optitrack-rot-r').textContent = (euler.roll * 180 / Math.PI).toFixed(2) + '\u00B0';
    document.getElementById('optitrack-rot-p').textContent = (euler.pitch * 180 / Math.PI).toFixed(2) + '\u00B0';
    document.getElementById('optitrack-rot-y').textContent = (euler.yaw * 180 / Math.PI).toFixed(2) + '\u00B0';

    // Calculate precision if reference is set
    if (this.optitrack.referencePose) {
      this.calculatePrecision(pose);
    }
  },

  // Convert quaternion to Euler angles (roll, pitch, yaw)
  quaternionToEuler(q) {
    // Roll (x-axis rotation)
    const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
    const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);

    // Pitch (y-axis rotation)
    const sinp = 2 * (q.w * q.y - q.z * q.x);
    let pitch;
    if (Math.abs(sinp) >= 1) {
      pitch = Math.sign(sinp) * Math.PI / 2;
    } else {
      pitch = Math.asin(sinp);
    }

    // Yaw (z-axis rotation)
    const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
    const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);

    return { roll, pitch, yaw };
  },

  // Set current pose as reference
  setOptiTrackReference() {
    const selectedBody = document.getElementById('optitrack-rigid-body').value;
    if (!selectedBody || !this.optitrack.rigidBodies[selectedBody]) {
      this.log('Error: Select a rigid body first', true);
      return;
    }

    this.optitrack.referencePose = JSON.parse(JSON.stringify(
      this.optitrack.rigidBodies[selectedBody].pose
    ));
    this.log(`Reference pose set from ${selectedBody}`);
    this.saveOptiTrackSettings();
  },

  // Calculate precision error from reference
  calculatePrecision(currentPose) {
    const ref = this.optitrack.referencePose;
    if (!ref) return;

    const xError = currentPose.position.x - ref.position.x;
    const yError = currentPose.position.y - ref.position.y;
    const distance = Math.sqrt(xError * xError + yError * yError);

    const currentEuler = this.quaternionToEuler(currentPose.orientation);
    const refEuler = this.quaternionToEuler(ref.orientation);
    let yawError = currentEuler.yaw - refEuler.yaw;

    // Normalize to [-pi, pi]
    while (yawError > Math.PI) yawError -= 2 * Math.PI;
    while (yawError < -Math.PI) yawError += 2 * Math.PI;

    // Update display
    document.getElementById('precision-x-error').textContent = (xError * 1000).toFixed(2) + ' mm';
    document.getElementById('precision-y-error').textContent = (yError * 1000).toFixed(2) + ' mm';
    document.getElementById('precision-yaw-error').textContent = (yawError * 180 / Math.PI).toFixed(3) + '\u00B0';
    document.getElementById('precision-distance').textContent = (distance * 1000).toFixed(2) + ' mm';

    // Add data to cluster graph (real-time)
    this.addGraphDataPoint(xError, yError, yawError);

    // Store for results if test is running
    if (this.testStatus === 'running') {
      this.lastPrecisionData = { x: xError, y: yError, yaw: yawError, distance: distance };
    }
  },

  // Disconnect OptiTrack
  disconnectOptiTrack() {
    if (this.optitrack.subscription) {
      this.optitrack.subscription.unsubscribe();
      this.optitrack.subscription = null;
    }

    // Unsubscribe all optitrack-related subscriptions
    this.subscriptions = this.subscriptions.filter(sub => {
      if (sub.name && (sub.name.includes('optitrack') || sub.name.includes('vrpn') || sub.name.includes('mocap'))) {
        sub.unsubscribe();
        return false;
      }
      return true;
    });

    this.updateOptiTrackStatus(false);
    this.log('Disconnected from OptiTrack');
  },

  // Update OptiTrack connection status UI
  updateOptiTrackStatus(connected) {
    this.optitrack.connected = connected;
    const statusBadge = document.getElementById('optitrack-status');
    const dataPanel = document.getElementById('optitrack-data-panel');
    const connectBtn = document.getElementById('btn-optitrack-connect');
    const disconnectBtn = document.getElementById('btn-optitrack-disconnect');

    if (connected) {
      statusBadge.textContent = 'Connected';
      statusBadge.className = 'optitrack-status-badge connected';
      dataPanel.style.display = 'block';
      connectBtn.disabled = true;
      disconnectBtn.disabled = false;
    } else {
      statusBadge.textContent = 'Disconnected';
      statusBadge.className = 'optitrack-status-badge';
      dataPanel.style.display = 'none';
      connectBtn.disabled = false;
      disconnectBtn.disabled = true;
    }
  },

  // Save OptiTrack settings
  saveOptiTrackSettings() {
    const settings = {
      serverIp: document.getElementById('optitrack-ip').value,
      selectedBody: this.optitrack.selectedBody,
      referenceBody: this.optitrack.referenceBody,
      referencePose: this.optitrack.referencePose
    };
    // B13 fix: localStorage 안전 쓰기
    try { localStorage.setItem('optitrackSettings', JSON.stringify(settings)); }
    catch (e) { console.warn('localStorage.setItem optitrackSettings failed:', e.message); }
  },

  // Load OptiTrack settings
  loadOptiTrackSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem('optitrackSettings'));
      if (settings) {
        if (settings.serverIp) {
          document.getElementById('optitrack-ip').value = settings.serverIp;
        }
        this.optitrack.selectedBody = settings.selectedBody || '';
        this.optitrack.referenceBody = settings.referenceBody || '';
        this.optitrack.referencePose = settings.referencePose || null;
      }
    } catch (e) {
      console.error('[DockingTest] Failed to load OptiTrack settings:', e);
    }
  },

  // ==================== Graph Methods ====================

  setupGraphListeners() {
    // Record checkbox
    document.getElementById('chk-graph-record').addEventListener('change', (e) => {
      this.graph.recording = e.target.checked;
      if (e.target.checked && !this.graph.startTime) {
        this.graph.startTime = Date.now();
      }
    });

    // Max points input
    document.getElementById('graph-max-points').addEventListener('change', (e) => {
      this.graph.maxPoints = parseInt(e.target.value) || 500;
      // Trim existing data if exceeds new limit
      if (this.graph.xyData.length > this.graph.maxPoints) {
        this.graph.xyData = this.graph.xyData.slice(-this.graph.maxPoints);
      }
      if (this.graph.yawData.length > this.graph.maxPoints) {
        this.graph.yawData = this.graph.yawData.slice(-this.graph.maxPoints);
      }
    });

    // Scale input
    document.getElementById('graph-scale').addEventListener('change', (e) => {
      this.graph.scale = parseInt(e.target.value) || 50;
      this.renderGraphs();
    });

    // Clear button
    document.getElementById('btn-graph-clear').addEventListener('click', () => {
      this.clearGraphData();
    });

    // Snapshot button
    document.getElementById('btn-graph-snapshot').addEventListener('click', () => {
      this.saveGraphSnapshot();
    });

    // Test data button
    document.getElementById('btn-graph-test').addEventListener('click', () => {
      this.addTestData();
    });
  },

  // Add random test data for debugging
  addTestData() {
    this.log('Adding test data...');
    const numPoints = 50;
    const startTime = Date.now();
    this.graph.startTime = startTime;

    for (let i = 0; i < numPoints; i++) {
      // Random gaussian-like distribution around center
      const xError = (Math.random() - 0.5) * 0.02 + (Math.random() - 0.5) * 0.01; // ~10-20mm spread
      const yError = (Math.random() - 0.5) * 0.015 + (Math.random() - 0.5) * 0.01; // ~10-15mm spread
      const yawError = (Math.random() - 0.5) * 0.02 + (Math.random() - 0.5) * 0.01; // ~0.5-1 deg spread

      this.graph.xyData.push({
        x: xError * 1000,
        y: yError * 1000
      });

      this.graph.yawData.push({
        time: i * 0.1, // 100ms intervals
        yaw: yawError * 180 / Math.PI + Math.sin(i * 0.1) * 0.2 // Small oscillation
      });
    }

    this.renderGraphs();
    this.updateGraphStats();
    this.log(`Added ${numPoints} test data points`);
  },

  initGraphCanvases() {
    // Initialize with empty grids
    this.renderXYGraph();
    this.renderYawGraph();
  },

  clearGraphData() {
    this.graph.xyData = [];
    this.graph.yawData = [];
    this.graph.startTime = Date.now();
    this.renderGraphs();
    this.updateGraphStats();
    this.log('Graph data cleared');
  },

  // Add data point to graphs (called from updateOptiTrackDisplay when reference is set)
  addGraphDataPoint(xError, yError, yawError) {
    if (!this.graph.recording) return;

    const now = Date.now();
    if (!this.graph.startTime) {
      this.graph.startTime = now;
    }

    // Add XY data (convert to mm)
    this.graph.xyData.push({
      x: xError * 1000,  // m to mm
      y: yError * 1000
    });

    // Add Yaw data
    this.graph.yawData.push({
      time: (now - this.graph.startTime) / 1000, // seconds
      yaw: yawError * 180 / Math.PI  // rad to deg
    });

    // Trim if exceeds max
    if (this.graph.xyData.length > this.graph.maxPoints) {
      this.graph.xyData.shift();
    }
    if (this.graph.yawData.length > this.graph.maxPoints) {
      this.graph.yawData.shift();
    }

    // Render (throttled via requestAnimationFrame)
    if (!this.graph.animationFrame) {
      this.graph.animationFrame = requestAnimationFrame(() => {
        this.renderGraphs();
        this.updateGraphStats();
        this.graph.animationFrame = null;
      });
    }
  },

  renderGraphs() {
    this.renderXYGraph();
    this.renderYawGraph();
  },

  renderXYGraph() {
    const canvas = document.getElementById('graph-xy');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const scale = this.graph.scale; // mm per half-canvas

    // Clear
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, w, h);

    // Draw grid
    ctx.strokeStyle = '#1a3a5c';
    ctx.lineWidth = 1;

    // Grid lines (every 10mm)
    const gridStep = 10; // mm
    const pixelsPerMm = (w / 2) / scale;

    for (let i = -scale; i <= scale; i += gridStep) {
      const px = cx + i * pixelsPerMm;
      const py = cy - i * pixelsPerMm;

      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();

      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // Draw axes
    ctx.strokeStyle = '#3a5a7c';
    ctx.lineWidth = 2;

    // X axis
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();

    // Y axis
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();

    // Draw axis labels
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`+${scale}mm`, w - 25, cy - 5);
    ctx.fillText(`-${scale}mm`, 25, cy - 5);
    ctx.fillText('X', w - 10, cy + 12);

    ctx.textAlign = 'left';
    ctx.fillText(`+${scale}mm`, cx + 5, 12);
    ctx.fillText(`-${scale}mm`, cx + 5, h - 5);
    ctx.fillText('Y', cx + 5, 24);

    // Draw reference point (center)
    ctx.fillStyle = '#27ae60';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    // Draw data points
    if (this.graph.xyData.length === 0) return;

    // Draw points with gradient (older = more transparent)
    const len = this.graph.xyData.length;
    this.graph.xyData.forEach((point, idx) => {
      const alpha = 0.3 + (idx / len) * 0.7; // 0.3 to 1.0
      const x = cx + point.x * pixelsPerMm;
      const y = cy - point.y * pixelsPerMm; // Flip Y for canvas

      // Check bounds
      if (x < 0 || x > w || y < 0 || y > h) return;

      ctx.fillStyle = `rgba(233, 69, 96, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw mean point
    if (len > 0) {
      const meanX = this.graph.xyData.reduce((s, p) => s + p.x, 0) / len;
      const meanY = this.graph.xyData.reduce((s, p) => s + p.y, 0) / len;
      const mx = cx + meanX * pixelsPerMm;
      const my = cy - meanY * pixelsPerMm;

      ctx.fillStyle = '#3498db';
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fill();

      // Draw 3-sigma ellipse
      const xStd = this.calculateStdDev(this.graph.xyData.map(p => p.x));
      const yStd = this.calculateStdDev(this.graph.xyData.map(p => p.y));
      const sigma3X = xStd * 3 * pixelsPerMm;
      const sigma3Y = yStd * 3 * pixelsPerMm;

      ctx.strokeStyle = 'rgba(52, 152, 219, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(mx, my, Math.abs(sigma3X), Math.abs(sigma3Y), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  },

  renderYawGraph() {
    const canvas = document.getElementById('graph-yaw');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const padding = { top: 20, right: 20, bottom: 30, left: 45 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // Clear
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, w, h);

    // Draw plot area background
    ctx.fillStyle = '#0f1a2a';
    ctx.fillRect(padding.left, padding.top, plotW, plotH);

    if (this.graph.yawData.length === 0) {
      // Draw empty state
      ctx.fillStyle = '#888';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No data', w / 2, h / 2);
      return;
    }

    // Calculate ranges
    const times = this.graph.yawData.map(p => p.time);
    const yaws = this.graph.yawData.map(p => p.yaw);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeRange = Math.max(maxTime - minTime, 1);

    const meanYaw = yaws.reduce((s, v) => s + v, 0) / yaws.length;
    const yawStd = this.calculateStdDev(yaws);
    const yawRange = Math.max(yawStd * 6, 1); // Show at least 6-sigma range
    const maxYaw = meanYaw + yawRange / 2;

    // Draw grid
    ctx.strokeStyle = '#1a3a5c';
    ctx.lineWidth = 1;

    // Horizontal grid lines (5 lines)
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (plotH * i / 4);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotW, y);
      ctx.stroke();

      // Y axis labels
      const yawVal = maxYaw - (yawRange * i / 4);
      ctx.fillStyle = '#888';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(yawVal.toFixed(2) + '°', padding.left - 5, y + 3);
    }

    // Vertical grid lines (5 lines)
    for (let i = 0; i <= 4; i++) {
      const x = padding.left + (plotW * i / 4);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + plotH);
      ctx.stroke();

      // X axis labels
      const timeVal = minTime + (timeRange * i / 4);
      ctx.fillStyle = '#888';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(timeVal.toFixed(1) + 's', x, h - 10);
    }

    // Draw mean line
    const meanY = padding.top + plotH * (maxYaw - meanYaw) / yawRange;
    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(padding.left, meanY);
    ctx.lineTo(padding.left + plotW, meanY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw 3-sigma band
    const sigma3Upper = padding.top + plotH * (maxYaw - (meanYaw + yawStd * 3)) / yawRange;
    const sigma3Lower = padding.top + plotH * (maxYaw - (meanYaw - yawStd * 3)) / yawRange;

    ctx.fillStyle = 'rgba(52, 152, 219, 0.2)';
    ctx.fillRect(padding.left, Math.max(sigma3Upper, padding.top),
                 plotW, Math.min(sigma3Lower - sigma3Upper, plotH));

    // Draw data line
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    this.graph.yawData.forEach((point, idx) => {
      const x = padding.left + plotW * (point.time - minTime) / timeRange;
      const y = padding.top + plotH * (maxYaw - point.yaw) / yawRange;

      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Draw axis labels
    ctx.fillStyle = '#e94560';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Time (s)', padding.left + plotW / 2, h - 2);

    ctx.save();
    ctx.translate(12, padding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Yaw (°)', 0, 0);
    ctx.restore();
  },

  calculateStdDev(data) {
    if (data.length === 0) return 0;
    const mean = data.reduce((s, v) => s + v, 0) / data.length;
    const squareDiffs = data.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squareDiffs.reduce((s, v) => s + v, 0) / data.length);
  },

  updateGraphStats() {
    // XY Stats
    const xyLen = this.graph.xyData.length;
    document.getElementById('stat-xy-count').textContent = xyLen;

    if (xyLen > 0) {
      const xVals = this.graph.xyData.map(p => p.x);
      const yVals = this.graph.xyData.map(p => p.y);

      const xMean = xVals.reduce((s, v) => s + v, 0) / xyLen;
      const yMean = yVals.reduce((s, v) => s + v, 0) / xyLen;
      const xStd = this.calculateStdDev(xVals);
      const yStd = this.calculateStdDev(yVals);

      document.getElementById('stat-xy-x-mean').textContent = xMean.toFixed(2) + 'mm';
      document.getElementById('stat-xy-x-sigma').textContent = (xStd * 3).toFixed(2) + 'mm';
      document.getElementById('stat-xy-y-mean').textContent = yMean.toFixed(2) + 'mm';
      document.getElementById('stat-xy-y-sigma').textContent = (yStd * 3).toFixed(2) + 'mm';
    } else {
      document.getElementById('stat-xy-x-mean').textContent = '-';
      document.getElementById('stat-xy-x-sigma').textContent = '-';
      document.getElementById('stat-xy-y-mean').textContent = '-';
      document.getElementById('stat-xy-y-sigma').textContent = '-';
    }

    // Yaw Stats
    const yawLen = this.graph.yawData.length;
    document.getElementById('stat-yaw-count').textContent = yawLen;

    if (yawLen > 0) {
      const yawVals = this.graph.yawData.map(p => p.yaw);
      const yawMean = yawVals.reduce((s, v) => s + v, 0) / yawLen;
      const yawStd = this.calculateStdDev(yawVals);

      document.getElementById('stat-yaw-mean').textContent = yawMean.toFixed(3) + '°';
      document.getElementById('stat-yaw-sigma').textContent = (yawStd * 3).toFixed(3) + '°';
    } else {
      document.getElementById('stat-yaw-mean').textContent = '-';
      document.getElementById('stat-yaw-sigma').textContent = '-';
    }
  },

  saveGraphSnapshot() {
    // Create a combined canvas with both graphs
    const xyCanvas = document.getElementById('graph-xy');
    const yawCanvas = document.getElementById('graph-yaw');

    const combined = document.createElement('canvas');
    combined.width = xyCanvas.width + yawCanvas.width + 20;
    combined.height = Math.max(xyCanvas.height, yawCanvas.height) + 80;

    const ctx = combined.getContext('2d');

    // Background
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, combined.width, combined.height);

    // Title
    ctx.fillStyle = '#e94560';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('OptiTrack Cluster Analysis - ' + new Date().toLocaleString(), 10, 20);

    // Draw both canvases
    ctx.drawImage(xyCanvas, 10, 40);
    ctx.drawImage(yawCanvas, xyCanvas.width + 20, 40);

    // Stats text
    ctx.fillStyle = '#aaa';
    ctx.font = '11px monospace';
    const statsY = Math.max(xyCanvas.height, yawCanvas.height) + 55;

    const xyLen = this.graph.xyData.length;
    if (xyLen > 0) {
      const xVals = this.graph.xyData.map(p => p.x);
      const yVals = this.graph.xyData.map(p => p.y);
      const xMean = xVals.reduce((s, v) => s + v, 0) / xyLen;
      const yMean = yVals.reduce((s, v) => s + v, 0) / xyLen;
      const xStd = this.calculateStdDev(xVals) * 3;
      const yStd = this.calculateStdDev(yVals) * 3;

      ctx.fillText(`XY: ${xyLen} pts | X: ${xMean.toFixed(2)}mm (3σ: ${xStd.toFixed(2)}mm) | Y: ${yMean.toFixed(2)}mm (3σ: ${yStd.toFixed(2)}mm)`, 10, statsY);
    }

    const yawLen = this.graph.yawData.length;
    if (yawLen > 0) {
      const yawVals = this.graph.yawData.map(p => p.yaw);
      const yawMean = yawVals.reduce((s, v) => s + v, 0) / yawLen;
      const yawStd = this.calculateStdDev(yawVals) * 3;

      ctx.fillText(`Yaw: ${yawLen} pts | Mean: ${yawMean.toFixed(3)}° (3σ: ${yawStd.toFixed(3)}°)`, 10, statsY + 15);
    }

    // Download
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const link = document.createElement('a');
    link.download = `optitrack_cluster_${timestamp}.png`;
    link.href = combined.toDataURL('image/png');
    link.click();

    this.log('Graph snapshot saved');
  },

  updateParamForm(dockType) {
    const config = this.dockingTypes[dockType];
    if (!config) return;

    const container = document.getElementById('docking-params-container');
    container.innerHTML = '';

    // Create parameter inputs based on docking type
    config.params.forEach((param) => {
      const div = document.createElement('div');
      div.className = 'docking-input-row';

      let inputHtml;
      if (param.type === 'bool') {
        inputHtml = `
          <select id="dock-param-${param.idx}" data-idx="${param.idx}">
            <option value="1" ${param.default === 1 ? 'selected' : ''}>Yes (1)</option>
            <option value="0" ${param.default === 0 ? 'selected' : ''}>No (0)</option>
          </select>
        `;
      } else {
        inputHtml = `
          <input type="number" step="any" id="dock-param-${param.idx}"
                 data-idx="${param.idx}" value="${param.default}" placeholder="${param.desc}">
        `;
      }

      div.innerHTML = `
        <label title="${param.desc}">${param.name}:</label>
        ${inputHtml}
      `;
      container.appendChild(div);
    });

    // Apply saved values after form is rendered
    this.applySavedParams(dockType);
  },

  getTestType() {
    return document.querySelector('input[name="docking-test-type"]:checked').value;
  },

  getDockDirection() {
    return parseInt(document.querySelector('input[name="dock-direction"]:checked').value);
  },

  // Collect all 15 docking parameters
  collectDockParams() {
    const params = new Array(15).fill(0.0);
    const dockType = document.getElementById('docking-type-select').value;
    const config = this.dockingTypes[dockType];

    config.params.forEach((param) => {
      const input = document.getElementById(`dock-param-${param.idx}`);
      if (input) {
        params[param.idx] = parseFloat(input.value) || 0;
      }
    });

    return params;
  },

  // Collect 4 docking arguments
  collectDockArgs() {
    return [
      parseInt(document.getElementById('dock-arg-charge').value) || 0,
      this.getDockDirection(),
      parseInt(document.getElementById('dock-arg-type').value) || 0,
      parseInt(document.getElementById('dock-arg-end-sign').value) || 0
    ];
  },

  startTest() {
    if (!RosManager.ros) {
      this.log('Error: ROS is not connected', true);
      App.addEvent('test', 'Docking test start failed', 'ROS disconnected', 'error');
      return;
    }

    const testType = this.getTestType();
    const cycleCount = parseInt(document.getElementById('docking-cycle-count').value) || 10;
    const dockParams = this.collectDockParams();
    const dockArgs = this.collectDockArgs();

    // Save current params
    this.saveCurrentParams();

    // Reset state
    this.testStatus = 'running';
    this.currentCycle = 0;
    this.totalCycles = cycleCount;
    this.results = { dockIn: [], dockOut: [], precision: [] };
    this.lastPrecisionData = null;
    this.testStartTime = Date.now();

    // Update UI
    this.updateStatus('running');
    this.updateProgress();
    document.getElementById('btn-docking-start').disabled = true;
    document.getElementById('btn-docking-stop').disabled = false;
    this.clearStats();

    const robotId = document.getElementById('robot-id').value || 'R_001';
    const missionId = testType === 'timer' ? 11 : 13;

    this.log(`${testType} test started (${cycleCount} cycles)`);
    this.log(`Docking type: ${document.getElementById('docking-type-select').value}`);
    this.log(`Parameters: ${JSON.stringify(dockParams)}`);
    this.log(`Args: ${JSON.stringify(dockArgs)}`);
    App.addEvent('test', 'Docking test started', `${testType} / ${cycleCount} cycles`, 'info');

    // Publish test configuration
    this.publishTestConfig(robotId, cycleCount, missionId, dockParams, dockArgs);

    // Subscribe to result topics
    this.subscribeDockingTopics(robotId);

    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      TestMode.startDockingSimulation(cycleCount, testType);
    }
  },

  publishTestConfig(robotId, cycleCount, missionId, dockParams, dockArgs) {
    // Publish cycle count
    const cycleCountTopic = new ROSLIB.Topic({
      ros: RosManager.ros,
      name: '/set_cycle_count',
      messageType: 'std_msgs/Int32'
    });
    cycleCountTopic.publish(new ROSLIB.Message({ data: cycleCount }));

    // Publish mission ID
    const missionTopic = new ROSLIB.Topic({
      ros: RosManager.ros,
      name: '/set_mission',
      messageType: 'std_msgs/Int32'
    });
    missionTopic.publish(new ROSLIB.Message({ data: missionId }));

    // Publish dock params (Float32MultiArray)
    const paramsTopic = new ROSLIB.Topic({
      ros: RosManager.ros,
      name: '/set_dock_params',
      messageType: 'std_msgs/Float32MultiArray'
    });
    paramsTopic.publish(new ROSLIB.Message({
      layout: { dim: [], data_offset: 0 },
      data: dockParams
    }));

    // Publish dock args (Int32MultiArray)
    const argsTopic = new ROSLIB.Topic({
      ros: RosManager.ros,
      name: '/set_dock_args',
      messageType: 'std_msgs/Int32MultiArray'
    });
    argsTopic.publish(new ROSLIB.Message({
      layout: { dim: [], data_offset: 0 },
      data: dockArgs
    }));

    // Publish mission request
    const requestTopic = new ROSLIB.Topic({
      ros: RosManager.ros,
      name: '/mission_request',
      messageType: 'std_msgs/String'
    });
    requestTopic.publish(new ROSLIB.Message({ data: 'start' }));

    this.log('Published test configuration to ROS');
  },

  subscribeDockingTopics(robotId) {
    // Unsubscribe existing
    this.unsubscribeDockingTopics();

    // Subscribe to mission result
    const missionResultTopic = new ROSLIB.Topic({
      ros: RosManager.ros,
      name: '/mission_result',
      messageType: 'std_msgs/String'
    });
    missionResultTopic.subscribe((msg) => this.onMissionResult(msg));
    this.subscriptions.push(missionResultTopic);

    // Subscribe to precision result (for precision test)
    const precisionResultTopic = new ROSLIB.Topic({
      ros: RosManager.ros,
      name: '/precision_result',
      messageType: 'std_msgs/Float64MultiArray'
    });
    precisionResultTopic.subscribe((msg) => this.onPrecisionResult(msg));
    this.subscriptions.push(precisionResultTopic);

    // Subscribe to Docking action result
    const dockingResultTopic = new ROSLIB.Topic({
      ros: RosManager.ros,
      name: `/${robotId}/AMS/Docking/result`,
      messageType: 'syscon_msgs/WorkFlowActionResult'
    });
    dockingResultTopic.subscribe((msg) => this.onDockingResult(msg));
    this.subscriptions.push(dockingResultTopic);

    // Subscribe to DockingOut action result
    const dockingOutResultTopic = new ROSLIB.Topic({
      ros: RosManager.ros,
      name: `/${robotId}/AMS/DockingOut/result`,
      messageType: 'syscon_msgs/WorkFlowActionResult'
    });
    dockingOutResultTopic.subscribe((msg) => this.onDockingOutResult(msg));
    this.subscriptions.push(dockingOutResultTopic);

    this.log('Subscribed to docking topics');
  },

  unsubscribeDockingTopics() {
    this.subscriptions.forEach(sub => {
      if (sub && sub.unsubscribe) {
        sub.unsubscribe();
      }
    });
    this.subscriptions = [];
  },

  onMissionResult(msg) {
    this.log(`Mission result: ${msg.data}`);

    if (msg.data === 'cycle_complete') {
      this.currentCycle++;
      this.updateProgress();

      if (this.currentCycle >= this.totalCycles) {
        this.completeTest();
      }
    } else if (msg.data === 'test_complete') {
      this.completeTest();
    } else if (msg.data === 'error' || msg.data === 'failed') {
      this.log('Test failed: ' + msg.data, true);
      this.stopTest();
    }
  },

  onPrecisionResult(msg) {
    // Precision results: [x_error, y_error, theta_error, ...]
    if (msg.data && msg.data.length >= 3) {
      this.log(`Precision: X=${msg.data[0].toFixed(4)}m, Y=${msg.data[1].toFixed(4)}m, Theta=${msg.data[2].toFixed(4)}rad`);
    }
  },

  onDockingResult(_msg) {
    if (this.cycleStartTime) {
      const elapsed = (Date.now() - this.cycleStartTime) / 1000;
      this.results.dockIn.push(elapsed);
      this.log(`Docking In: ${elapsed.toFixed(3)}s`);

      // Store precision data if OptiTrack is connected and precision test
      if (this.optitrack.connected && this.lastPrecisionData && this.getTestType() === 'precision') {
        this.results.precision.push({...this.lastPrecisionData, cycle: this.currentCycle + 1});
        this.log(`Precision: X=${(this.lastPrecisionData.x * 1000).toFixed(2)}mm, Y=${(this.lastPrecisionData.y * 1000).toFixed(2)}mm, Yaw=${(this.lastPrecisionData.yaw * 180 / Math.PI).toFixed(3)}\u00B0`);
      }

      this.updateStats();
    }
    this.cycleStartTime = Date.now(); // Start timing for dock out
  },

  onDockingOutResult(_msg) {
    if (this.cycleStartTime) {
      const elapsed = (Date.now() - this.cycleStartTime) / 1000;
      this.results.dockOut.push(elapsed);
      this.log(`Docking Out: ${elapsed.toFixed(3)}s`);
      this.updateStats();
    }
    this.cycleStartTime = Date.now(); // Start timing for next cycle
  },

  stopTest() {
    this.testStatus = 'stopped';
    this.updateStatus('stopped');
    this.unsubscribeDockingTopics();

    // Publish stop request
    if (RosManager.ros) {
      const requestTopic = new ROSLIB.Topic({
        ros: RosManager.ros,
        name: '/mission_request',
        messageType: 'std_msgs/String'
      });
      requestTopic.publish(new ROSLIB.Message({ data: 'stop' }));
    }

    document.getElementById('btn-docking-start').disabled = false;
    document.getElementById('btn-docking-stop').disabled = true;
    this.log('Stopped by user');
    App.addEvent('test', 'Docking test stopped', 'User stopped', 'info');
  },

  completeTest() {
    this.testStatus = 'completed';
    this.updateStatus('completed');
    this.unsubscribeDockingTopics();

    document.getElementById('btn-docking-start').disabled = false;
    document.getElementById('btn-docking-stop').disabled = true;

    const totalTime = ((Date.now() - this.testStartTime) / 1000).toFixed(1);
    this.log(`Test completed (total ${totalTime}s)`);
    App.addEvent('test', 'Docking test completed', `Total ${totalTime}s`, 'success');
    this.updateStats();
  },

  updateStatus(status) {
    const badge = document.getElementById('docking-status');
    const map = {
      idle: 'Idle',
      running: 'Running',
      stopped: 'Stopped',
      completed: 'Completed'
    };
    badge.textContent = map[status] || status;
    badge.className = 'docking-status-badge status-' + status;
  },

  updateProgress() {
    const percent = this.totalCycles > 0 ? (this.currentCycle / this.totalCycles) * 100 : 0;
    document.getElementById('docking-progress-fill').style.width = percent + '%';
    document.getElementById('docking-progress-text').textContent =
      `${this.currentCycle} / ${this.totalCycles} cycles`;
  },

  clearStats() {
    ['avg', 'max', 'min', 'sigma'].forEach(stat => {
      document.getElementById(`stat-dock-in-${stat}`).textContent = '-';
      document.getElementById(`stat-dock-out-${stat}`).textContent = '-';
    });
  },

  updateStats() {
    // Update Docking In stats
    if (this.results.dockIn.length > 0) {
      const stats = this.calculateStats(this.results.dockIn);
      document.getElementById('stat-dock-in-avg').textContent = stats.avg.toFixed(3) + 's';
      document.getElementById('stat-dock-in-max').textContent = stats.max.toFixed(3) + 's';
      document.getElementById('stat-dock-in-min').textContent = stats.min.toFixed(3) + 's';
      document.getElementById('stat-dock-in-sigma').textContent = '\u00B1' + stats.sigma3.toFixed(3) + 's';
    }

    // Update Docking Out stats
    if (this.results.dockOut.length > 0) {
      const stats = this.calculateStats(this.results.dockOut);
      document.getElementById('stat-dock-out-avg').textContent = stats.avg.toFixed(3) + 's';
      document.getElementById('stat-dock-out-max').textContent = stats.max.toFixed(3) + 's';
      document.getElementById('stat-dock-out-min').textContent = stats.min.toFixed(3) + 's';
      document.getElementById('stat-dock-out-sigma').textContent = '\u00B1' + stats.sigma3.toFixed(3) + 's';
    }
  },

  calculateStats(data) {
    if (data.length === 0) return { avg: 0, max: 0, min: 0, sigma3: 0 };

    const sum = data.reduce((a, b) => a + b, 0);
    const avg = sum / data.length;
    const max = Math.max(...data);
    const min = Math.min(...data);

    // Calculate standard deviation
    const squareDiffs = data.map(value => Math.pow(value - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / data.length;
    const stdDev = Math.sqrt(avgSquareDiff);
    const sigma3 = stdDev * 3;

    return { avg, max, min, sigma3 };
  },

  log(message, isError = false) {
    const logEl = document.getElementById('docking-log-content');
    const timestamp = new Date().toLocaleTimeString();
    const prefix = isError ? '[ERROR]' : '[INFO]';
    logEl.textContent += `\n${timestamp} ${prefix} ${message}`;
    logEl.scrollTop = logEl.scrollHeight;
    console.log(`[DockingTest] ${message}`);
  },

  exportResults() {
    if (this.results.dockIn.length === 0 && this.results.dockOut.length === 0) {
      this.log('No results to export', true);
      App.addEvent('test', 'CSV export failed', 'No results', 'error');
      return;
    }

    const dockType = document.getElementById('docking-type-select').value;
    const testType = this.getTestType();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const hasPrecision = this.results.precision.length > 0;

    // Build CSV content
    let csv = hasPrecision
      ? 'Cycle,Docking In (s),Docking Out (s),X Error (mm),Y Error (mm),Yaw Error (deg),Distance (mm)\n'
      : 'Cycle,Docking In (s),Docking Out (s)\n';

    const maxLen = Math.max(this.results.dockIn.length, this.results.dockOut.length, this.results.precision.length);
    for (let i = 0; i < maxLen; i++) {
      const dockIn = this.results.dockIn[i] !== undefined ? this.results.dockIn[i].toFixed(3) : '';
      const dockOut = this.results.dockOut[i] !== undefined ? this.results.dockOut[i].toFixed(3) : '';

      if (hasPrecision) {
        const p = this.results.precision[i];
        const xErr = p ? (p.x * 1000).toFixed(3) : '';
        const yErr = p ? (p.y * 1000).toFixed(3) : '';
        const yawErr = p ? (p.yaw * 180 / Math.PI).toFixed(4) : '';
        const dist = p ? (p.distance * 1000).toFixed(3) : '';
        csv += `${i + 1},${dockIn},${dockOut},${xErr},${yErr},${yawErr},${dist}\n`;
      } else {
        csv += `${i + 1},${dockIn},${dockOut}\n`;
      }
    }

    // Add stats
    csv += '\nStatistics\n';
    if (this.results.dockIn.length > 0) {
      const stats = this.calculateStats(this.results.dockIn);
      csv += `Docking In Avg,${stats.avg.toFixed(3)}\n`;
      csv += `Docking In Max,${stats.max.toFixed(3)}\n`;
      csv += `Docking In Min,${stats.min.toFixed(3)}\n`;
      csv += `Docking In 3-Sigma,${stats.sigma3.toFixed(3)}\n`;
    }
    if (this.results.dockOut.length > 0) {
      const stats = this.calculateStats(this.results.dockOut);
      csv += `Docking Out Avg,${stats.avg.toFixed(3)}\n`;
      csv += `Docking Out Max,${stats.max.toFixed(3)}\n`;
      csv += `Docking Out Min,${stats.min.toFixed(3)}\n`;
      csv += `Docking Out 3-Sigma,${stats.sigma3.toFixed(3)}\n`;
    }

    // Add precision stats
    if (hasPrecision) {
      csv += '\nPrecision Statistics\n';
      const xErrors = this.results.precision.map(p => p.x * 1000);
      const yErrors = this.results.precision.map(p => p.y * 1000);
      const yawErrors = this.results.precision.map(p => p.yaw * 180 / Math.PI);
      const distances = this.results.precision.map(p => p.distance * 1000);

      const xStats = this.calculateStats(xErrors);
      const yStats = this.calculateStats(yErrors);
      const yawStats = this.calculateStats(yawErrors);
      const distStats = this.calculateStats(distances);

      csv += `X Error Avg (mm),${xStats.avg.toFixed(3)}\n`;
      csv += `X Error 3-Sigma (mm),${xStats.sigma3.toFixed(3)}\n`;
      csv += `Y Error Avg (mm),${yStats.avg.toFixed(3)}\n`;
      csv += `Y Error 3-Sigma (mm),${yStats.sigma3.toFixed(3)}\n`;
      csv += `Yaw Error Avg (deg),${yawStats.avg.toFixed(4)}\n`;
      csv += `Yaw Error 3-Sigma (deg),${yawStats.sigma3.toFixed(4)}\n`;
      csv += `Distance Avg (mm),${distStats.avg.toFixed(3)}\n`;
      csv += `Distance Max (mm),${distStats.max.toFixed(3)}\n`;
    }

    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docking_test_${dockType}_${testType}_${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.log('CSV export completed');
    App.addEvent('test', 'CSV export completed', `${dockType} / ${testType}`, 'success');
  },

  // Save current form values to localStorage
  saveCurrentParams() {
    const dockType = document.getElementById('docking-type-select').value;
    const config = this.dockingTypes[dockType];
    if (!config) return;

    let savedData = {};
    try {
      savedData = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
    } catch (e) {
      savedData = {};
    }

    // Collect current params
    const params = {};
    config.params.forEach((param) => {
      const input = document.getElementById(`dock-param-${param.idx}`);
      if (input) {
        params[param.idx] = input.value;
      }
    });

    // Collect args
    const args = {
      charge: document.getElementById('dock-arg-charge').value,
      direction: this.getDockDirection(),
      type: document.getElementById('dock-arg-type').value,
      endSign: document.getElementById('dock-arg-end-sign').value
    };

    savedData[dockType] = { params, args };
    savedData._global = {
      testType: this.getTestType(),
      cycleCount: document.getElementById('docking-cycle-count').value,
      selectedDockType: dockType
    };

    // B13 fix: localStorage 안전 쓰기
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(savedData)); }
    catch (e) { console.warn('localStorage.setItem dockingTestParams failed:', e.message); }
  },

  loadSavedParams() {
    try {
      const savedData = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
      const global = savedData._global;

      if (global) {
        // Restore test type
        if (global.testType) {
          const radio = document.querySelector(`input[name="docking-test-type"][value="${global.testType}"]`);
          if (radio) radio.checked = true;
        }

        // Restore cycle count
        if (global.cycleCount) {
          document.getElementById('docking-cycle-count').value = global.cycleCount;
        }

        // Restore selected dock type and update form
        if (global.selectedDockType) {
          document.getElementById('docking-type-select').value = global.selectedDockType;
          this.updateParamForm(global.selectedDockType);
        }
      }
    } catch (e) {
      console.error('[DockingTest] Failed to load saved params:', e);
    }
  },

  applySavedParams(dockType) {
    try {
      const savedData = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
      const saved = savedData[dockType];
      if (!saved) return;

      // Apply params
      if (saved.params) {
        Object.entries(saved.params).forEach(([idx, value]) => {
          const input = document.getElementById(`dock-param-${idx}`);
          if (input) input.value = value;
        });
      }

      // Apply args
      if (saved.args) {
        if (saved.args.charge !== undefined) {
          document.getElementById('dock-arg-charge').value = saved.args.charge;
        }
        if (saved.args.direction !== undefined) {
          const radio = document.querySelector(`input[name="dock-direction"][value="${saved.args.direction}"]`);
          if (radio) radio.checked = true;
        }
        if (saved.args.type !== undefined) {
          document.getElementById('dock-arg-type').value = saved.args.type;
        }
        if (saved.args.endSign !== undefined) {
          document.getElementById('dock-arg-end-sign').value = saved.args.endSign;
        }
      }
    } catch (e) {
      console.error('[DockingTest] Failed to apply saved params:', e);
    }
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  DockingTest.init();
});
