// AMR Diagnostics - Boot Health Check & Steady-State Monitor
const Diagnostics = {
  _running: false,
  _mode: null,        // 'boot' | 'steady'
  _results: {},       // category -> [{name, status, detail}]
  _steadyData: {},    // collected during 30s monitor
  _steadyTimer: null,
  _steadyStart: 0,
  _steadySubs: [],    // temp ROSLIB subscriptions for 30s monitor
  _steadyInterval: null,
  _steadySshInterval: null,

  // Expected nodes (P0 = critical, P1 = important, P2 = nice-to-have)
  EXPECTED_NODES: {
    P0: ['spcore', 'robotstate_pub', 'TARU', 'odom_pub'],
    P1: ['amcl_node', 'move_base', 'navigation_manager', 'route_planner'],
    P2: ['sp2_lidar', 'twist_smoother', 'map_server']
  },

  // Expected topics with min Hz
  EXPECTED_TOPICS: {
    P0: [
      { name: 'robot_state', minHz: 10 },
      { name: 'emergency_state', minHz: 0 },
      { name: 'motor_status', minHz: 10 },
      { name: 'taru_state', minHz: 0 }
    ],
    P1: [
      { name: 'amcl_pose', minHz: 1 },
      { name: 'odom', minHz: 10 },
      { name: 'cmd_vel', minHz: 0 },
      { name: 'move_base/status', minHz: 1 }
    ],
    P2: [
      { name: 'scan', minHz: 5 },
      { name: 'tf', minHz: 10 }
    ]
  },

  // Expected services
  EXPECTED_SERVICES: [
    'move_base/make_plan',
    'move_base/clear_costmaps',
    'global_localization',
    'request_nomotion_update'
  ],

  // System thresholds
  SYS_THRESHOLDS: {
    cpu: { warn: 80, fail: 95 },
    mem: { warn: 80, fail: 95 },
    disk: { warn: 85, fail: 95 },
    temp: { warn: 70, fail: 80 }
  },

  // Score weights
  SCORE_WEIGHTS: {
    nodes: 20,
    topics: 25,
    tf: 15,
    services: 10,
    state: 15,
    system: 15
  },

  init() {
    this._cacheDom();
    this._bindEvents();
  },

  _cacheDom() {
    this.$score = document.getElementById('diag-score');
    this.$progress = document.getElementById('diag-progress');
    this.$progressFill = document.getElementById('diag-progress-fill');
    this.$progressText = document.getElementById('diag-progress-text');
    this.$btnBoot = document.getElementById('btn-diag-boot');
    this.$btnSteady = document.getElementById('btn-diag-steady');
    this.$btnStop = document.getElementById('btn-diag-stop');
  },

  _bindEvents() {
    if (this.$btnBoot) this.$btnBoot.addEventListener('click', () => this.runBootCheck());
    if (this.$btnSteady) this.$btnSteady.addEventListener('click', () => this.startSteadyMonitor());
    if (this.$btnStop) this.$btnStop.addEventListener('click', () => this.stopSteadyMonitor());
  },

  onTabActivated() {
    // Nothing special needed on activation
  },

  // ── Helpers ──

  _getSlot() {
    const idx = App.activeSlotIndex;
    if (idx < 0 || idx >= App.robotSlots.length) return null;
    return App.robotSlots[idx];
  },

  _getRos() {
    const slot = this._getSlot();
    return slot && slot.ros && slot.ros.isConnected ? slot.ros : null;
  },

  _getRobotId() {
    const slot = this._getSlot();
    return slot ? slot.robotId : null;
  },

  _getRobot() {
    const idx = App.activeSlotIndex;
    if (idx < 0 || idx >= App.robotSlots.length) return null;
    const slot = App.robotSlots[idx];
    return {
      ip: slot.ip,
      sshUser: slot.sshUser || 'ubuntu',
      sshPassword: slot.sshPassword || 'ubuntu'
    };
  },

  async _sshExec(cmd) {
    const robot = this._getRobot();
    if (!robot || !robot.ip) throw new Error('No robot connected');
    const res = await fetchWithTimeout('/api/ssh/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: robot.ip,
        user: robot.sshUser,
        password: robot.sshPassword,
        command: cmd
      })
    }, 10000);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'SSH failed');
    return data.output || '';
  },

  // ── A. Boot Check ──

  async runBootCheck() {
    if (this._running) {
      App.toast('Diagnostics already running', 'warning');
      return;
    }

    const ros = this._getRos();
    if (!ros) {
      App.toast('Robot not connected', 'error');
      return;
    }

    this._running = true;
    this._mode = 'boot';
    this._results = {};
    this._setButtonState('boot');
    this._updateScore(null);

    // Clear previous results
    ['nodes', 'topics', 'tf', 'services', 'state', 'system'].forEach(cat => {
      this._renderCategory(cat, [{ name: 'Checking...', status: 'checking', detail: '' }]);
    });

    try {
      // Run checks sequentially for clarity
      await this._checkNodes();
      await this._checkTopics();
      await this._checkTfTree();
      await this._checkServices();
      this._checkStateValues();
      await this._checkSystem();
    } catch (e) {
      console.error('Boot check error:', e);
    }

    this._running = false;
    this._mode = null;
    this._setButtonState('idle');
    this._updateScore();
  },

  async _checkNodes() {
    const ros = this._getRos();
    const items = [];

    try {
      const nodes = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 5000);
        ros.getNodes((nodeList) => {
          clearTimeout(timer);
          resolve(nodeList);
        });
      });

      const rid = this._getRobotId() || '';
      const allExpected = [
        ...this.EXPECTED_NODES.P0.map(n => ({ name: n, priority: 'P0' })),
        ...this.EXPECTED_NODES.P1.map(n => ({ name: n, priority: 'P1' })),
        ...this.EXPECTED_NODES.P2.map(n => ({ name: n, priority: 'P2' }))
      ];

      allExpected.forEach(({ name, priority }) => {
        const found = nodes.some(n => n.includes(name));
        const status = found ? 'pass' : (priority === 'P0' ? 'fail' : 'warn');
        items.push({
          name: `${name} [${priority}]`,
          status,
          detail: found ? 'Running' : 'Not found'
        });
      });

      // Summary: count extra nodes
      const expectedNames = allExpected.map(e => e.name);
      const extraCount = nodes.filter(n => !expectedNames.some(en => n.includes(en))).length;
      if (extraCount > 0) {
        items.push({ name: 'Other nodes', status: 'pass', detail: `${extraCount} additional nodes running` });
      }
    } catch (e) {
      items.push({ name: 'Node check', status: 'fail', detail: e.message });
    }

    this._results.nodes = items;
    this._renderCategory('nodes', items);
  },

  async _checkTopics() {
    const ros = this._getRos();
    const items = [];
    const rid = this._getRobotId() || '';

    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 5000);
        ros.getTopics((res) => {
          clearTimeout(timer);
          resolve(res);
        });
      });

      const topicList = result.topics || [];

      const allExpected = [
        ...this.EXPECTED_TOPICS.P0.map(t => ({ ...t, priority: 'P0' })),
        ...this.EXPECTED_TOPICS.P1.map(t => ({ ...t, priority: 'P1' })),
        ...this.EXPECTED_TOPICS.P2.map(t => ({ ...t, priority: 'P2' }))
      ];

      // Check Hz from existing RosManager data
      const hzMap = {};
      if (typeof RosManager !== 'undefined' && RosManager._hzValues) {
        // Map known hz keys to topic names
        const hzKeyMap = {
          bms: 'bms', workstate: 'robot_state', pose: 'amcl_pose',
          map: 'map', lidar: 'scan'
        };
        Object.entries(hzKeyMap).forEach(([key, topicPart]) => {
          hzMap[topicPart] = RosManager._hzValues[key] || 0;
        });
      }

      allExpected.forEach(({ name, minHz, priority }) => {
        const fullName = `/${rid}/${name}`;
        const found = topicList.some(t => t === fullName || t.endsWith('/' + name));
        const hz = hzMap[name] || null;

        let status, detail;
        if (!found) {
          status = priority === 'P0' ? 'fail' : 'warn';
          detail = 'Not found';
        } else if (hz !== null && minHz > 0 && hz < minHz) {
          status = 'warn';
          detail = `${hz} Hz (expected >= ${minHz})`;
        } else if (hz !== null) {
          status = 'pass';
          detail = `${hz} Hz`;
        } else {
          status = found ? 'pass' : 'warn';
          detail = found ? 'Exists' : 'Not publishing';
        }

        items.push({ name: `${name} [${priority}]`, status, detail });
      });
    } catch (e) {
      items.push({ name: 'Topic check', status: 'fail', detail: e.message });
    }

    this._results.topics = items;
    this._renderCategory('topics', items);
  },

  async _checkTfTree() {
    const items = [];
    const slot = this._getSlot();

    try {
      if (slot && slot.tfReceived) {
        // Check if position is reasonable (not NaN, not at origin with no movement)
        const pose = slot.pose;
        if (pose && !isNaN(pose.x) && !isNaN(pose.y)) {
          items.push({ name: 'map -> base_link', status: 'pass', detail: `TF active (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)})` });
        } else {
          items.push({ name: 'map -> base_link', status: 'warn', detail: 'TF received but pose invalid' });
        }
      } else {
        // Try SSH fallback
        try {
          const rid = this._getRobotId() || '';
          const output = await this._sshExec(`timeout 3 rostopic echo /${rid}/tf -n1 2>&1 | head -5`);
          if (output && output.includes('transforms')) {
            items.push({ name: 'map -> base_link', status: 'warn', detail: 'TF publishing but not received in browser' });
          } else {
            items.push({ name: 'map -> base_link', status: 'fail', detail: 'TF not available' });
          }
        } catch (e) {
          items.push({ name: 'map -> base_link', status: 'fail', detail: 'No TF data' });
        }
      }

      // Check odom -> base_link (via odom topic existence)
      const ros = this._getRos();
      if (ros) {
        const result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Timeout')), 3000);
          ros.getTopics((res) => { clearTimeout(timer); resolve(res); });
        });
        const rid = this._getRobotId() || '';
        const hasOdom = (result.topics || []).some(t => t.includes('/odom'));
        items.push({
          name: 'odom -> base_link',
          status: hasOdom ? 'pass' : 'warn',
          detail: hasOdom ? 'Odometry available' : 'Odom topic not found'
        });
      }
    } catch (e) {
      items.push({ name: 'TF check', status: 'fail', detail: e.message });
    }

    this._results.tf = items;
    this._renderCategory('tf', items);
  },

  async _checkServices() {
    const ros = this._getRos();
    const items = [];
    const rid = this._getRobotId() || '';

    try {
      const services = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 5000);
        ros.getServices((svcList) => { clearTimeout(timer); resolve(svcList); });
      });

      this.EXPECTED_SERVICES.forEach(svcName => {
        const fullName = `/${rid}/${svcName}`;
        const found = services.some(s => s === fullName || s.endsWith('/' + svcName));
        items.push({
          name: svcName,
          status: found ? 'pass' : 'warn',
          detail: found ? 'Available' : 'Not found'
        });
      });
    } catch (e) {
      items.push({ name: 'Service check', status: 'fail', detail: e.message });
    }

    this._results.services = items;
    this._renderCategory('services', items);
  },

  _checkStateValues() {
    const slot = this._getSlot();
    const items = [];

    if (!slot) {
      items.push({ name: 'State check', status: 'fail', detail: 'No slot' });
      this._results.state = items;
      this._renderCategory('state', items);
      return;
    }

    // Work state
    const ws = slot.workState;
    if (ws === null || ws === undefined) {
      items.push({ name: 'Work State', status: 'warn', detail: 'No data' });
    } else if (ws === 0) {
      items.push({ name: 'Work State', status: 'pass', detail: 'IDLE (0)' });
    } else if (ws === 99 || ws === 100) {
      items.push({ name: 'Work State', status: 'fail', detail: `Error state (${ws})` });
    } else {
      items.push({ name: 'Work State', status: 'pass', detail: `Active (${ws})` });
    }

    // BMS
    const bms = slot.bms;
    if (!bms || bms.soc === undefined) {
      items.push({ name: 'BMS SOC', status: 'warn', detail: 'No BMS data' });
    } else {
      const soc = bms.soc;
      let status = 'pass';
      if (soc <= 5) status = 'fail';
      else if (soc <= 20) status = 'warn';
      items.push({ name: 'BMS SOC', status, detail: `${soc.toFixed(1)}%${bms.charging ? ' (Charging)' : ''}` });

      // Voltage check
      if (bms.voltage > 0) {
        items.push({ name: 'BMS Voltage', status: 'pass', detail: `${bms.voltage.toFixed(1)} V` });
      }
    }

    // Connection status
    items.push({
      name: 'ROS Bridge',
      status: slot.ros && slot.ros.isConnected ? 'pass' : 'fail',
      detail: slot.ros && slot.ros.isConnected ? 'Connected' : 'Disconnected'
    });

    this._results.state = items;
    this._renderCategory('state', items);
  },

  async _checkSystem() {
    const items = [];

    try {
      const output = await this._sshExec(
        `echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1)";` +
        `echo "MEM:$(free | awk '/Mem:/{printf "%.1f", $3/$2*100}')";` +
        `echo "DISK:$(df / | awk 'NR==2{print $5}' | tr -d '%')";` +
        `cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | head -1 | awk '{printf "TEMP:%.1f\\n", $1/1000}'`
      );

      const vals = {};
      output.split('\n').forEach(line => {
        const [key, val] = line.split(':');
        if (key && val) vals[key.trim()] = parseFloat(val) || 0;
      });

      const checks = [
        { key: 'CPU', val: vals.CPU, unit: '%', thresh: this.SYS_THRESHOLDS.cpu },
        { key: 'MEM', val: vals.MEM, unit: '%', thresh: this.SYS_THRESHOLDS.mem },
        { key: 'DISK', val: vals.DISK, unit: '%', thresh: this.SYS_THRESHOLDS.disk },
        { key: 'TEMP', val: vals.TEMP, unit: 'C', thresh: this.SYS_THRESHOLDS.temp }
      ];

      checks.forEach(({ key, val, unit, thresh }) => {
        if (val === undefined || isNaN(val)) {
          items.push({ name: key, status: 'warn', detail: 'No data' });
        } else {
          let status = 'pass';
          if (val >= thresh.fail) status = 'fail';
          else if (val >= thresh.warn) status = 'warn';
          items.push({ name: key, status, detail: `${val.toFixed(1)}${unit}` });
        }
      });
    } catch (e) {
      items.push({ name: 'System check', status: 'fail', detail: e.message });
    }

    this._results.system = items;
    this._renderCategory('system', items);
  },

  // ── B. 30s Steady-State Monitor ──

  startSteadyMonitor() {
    if (this._running) {
      App.toast('Diagnostics already running', 'warning');
      return;
    }

    const ros = this._getRos();
    if (!ros) {
      App.toast('Robot not connected', 'error');
      return;
    }

    this._running = true;
    this._mode = 'steady';
    this._setButtonState('steady');

    // Show stability category
    const stabCat = document.getElementById('diag-cat-stability');
    if (stabCat) stabCat.style.display = '';

    // Initialize collection data
    this._steadyData = {
      hzSamples: {},     // topic -> [hz values]
      errors: [],        // rosout errors
      emergencyChanges: 0,
      stopflagChanges: 0,
      cpuSamples: [],
      memSamples: [],
      startNodes: null,
      endNodes: null
    };

    this._steadyStart = Date.now();
    this._showProgress(0);

    // Run initial boot check first
    this._renderCategory('stability', [{ name: 'Monitoring...', status: 'checking', detail: '0 / 30s' }]);

    // Record initial node list
    ros.getNodes((nodes) => { this._steadyData.startNodes = nodes; });

    // Subscribe to rosout_agg for errors
    this._subscribeSteadyTopics(ros);

    // 1-second Hz sampling
    this._steadyInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this._steadyStart) / 1000);
      this._showProgress(elapsed);

      // Sample Hz values
      if (typeof RosManager !== 'undefined' && RosManager._hzValues) {
        Object.entries(RosManager._hzValues).forEach(([key, hz]) => {
          if (!this._steadyData.hzSamples[key]) this._steadyData.hzSamples[key] = [];
          this._steadyData.hzSamples[key].push(hz);
        });
      }

      this._renderCategory('stability', [{
        name: 'Monitoring...',
        status: 'checking',
        detail: `${elapsed} / 30s | Errors: ${this._steadyData.errors.length}`
      }]);
    }, 1000);

    // 5-second SSH system check
    this._steadySshInterval = setInterval(async () => {
      try {
        const output = await this._sshExec(
          `echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1)";` +
          `echo "MEM:$(free | awk '/Mem:/{printf "%.1f", $3/$2*100}')"`
        );
        output.split('\n').forEach(line => {
          if (line.startsWith('CPU:')) this._steadyData.cpuSamples.push(parseFloat(line.split(':')[1]) || 0);
          if (line.startsWith('MEM:')) this._steadyData.memSamples.push(parseFloat(line.split(':')[1]) || 0);
        });
      } catch (e) { /* ignore */ }
    }, 5000);

    // 30-second timer
    this._steadyTimer = setTimeout(() => this._finishSteadyMonitor(), 30000);
  },

  _subscribeSteadyTopics(ros) {
    const rid = this._getRobotId() || '';

    // rosout_agg
    const rosoutTopic = new ROSLIB.Topic({
      ros: ros,
      name: `/${rid}/rosout_agg`,
      messageType: 'rosgraph_msgs/Log',
      throttle_rate: 100
    });
    rosoutTopic.subscribe((msg) => {
      // level: 1=DEBUG, 2=INFO, 4=WARN, 8=ERROR, 16=FATAL
      if (msg.level >= 8) {
        this._steadyData.errors.push({
          level: msg.level >= 16 ? 'FATAL' : 'ERROR',
          node: msg.name || '',
          msg: (msg.msg || '').substring(0, 200),
          time: Date.now()
        });
      }
    });
    this._steadySubs.push(rosoutTopic);

    // emergency_state
    const emergTopic = new ROSLIB.Topic({
      ros: ros,
      name: `/${rid}/emergency_state`,
      messageType: 'std_msgs/Int32',
      throttle_rate: 500
    });
    emergTopic.subscribe((msg) => {
      if (msg.data !== 0) this._steadyData.emergencyChanges++;
    });
    this._steadySubs.push(emergTopic);

    // static_stopflag
    const stopTopic = new ROSLIB.Topic({
      ros: ros,
      name: `/${rid}/static_stopflag`,
      messageType: 'std_msgs/Bool',
      throttle_rate: 500
    });
    stopTopic.subscribe((msg) => {
      if (msg.data === true) this._steadyData.stopflagChanges++;
    });
    this._steadySubs.push(stopTopic);
  },

  stopSteadyMonitor() {
    if (this._steadyTimer) { clearTimeout(this._steadyTimer); this._steadyTimer = null; }
    if (this._steadyInterval) { clearInterval(this._steadyInterval); this._steadyInterval = null; }
    if (this._steadySshInterval) { clearInterval(this._steadySshInterval); this._steadySshInterval = null; }

    // Unsubscribe temp topics
    this._steadySubs.forEach(t => { try { t.unsubscribe(); } catch(e) {} });
    this._steadySubs = [];

    this._running = false;
    this._mode = null;
    this._setButtonState('idle');
    this._hideProgress();

    this._renderCategory('stability', [{ name: 'Stopped', status: 'warn', detail: 'Monitor stopped by user' }]);
  },

  async _finishSteadyMonitor() {
    // Clear intervals
    if (this._steadyInterval) { clearInterval(this._steadyInterval); this._steadyInterval = null; }
    if (this._steadySshInterval) { clearInterval(this._steadySshInterval); this._steadySshInterval = null; }
    this._steadyTimer = null;

    // Unsubscribe
    this._steadySubs.forEach(t => { try { t.unsubscribe(); } catch(e) {} });
    this._steadySubs = [];

    this._showProgress(30);

    // Get final node list
    const ros = this._getRos();
    if (ros) {
      try {
        this._steadyData.endNodes = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Timeout')), 3000);
          ros.getNodes((nodes) => { clearTimeout(timer); resolve(nodes); });
        });
      } catch (e) { /* ignore */ }
    }

    // Analyze results
    this._analyzeSteadyResults();

    this._running = false;
    this._mode = null;
    this._setButtonState('idle');
    setTimeout(() => this._hideProgress(), 2000);
    this._updateScore();
  },

  _analyzeSteadyResults() {
    const items = [];
    const d = this._steadyData;

    // Hz stability analysis
    Object.entries(d.hzSamples).forEach(([key, samples]) => {
      if (samples.length < 5) return;
      const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
      if (avg === 0) {
        items.push({ name: `Hz: ${key}`, status: 'warn', detail: 'No data received (0 Hz)' });
        return;
      }
      const variance = samples.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / samples.length;
      const stdDev = Math.sqrt(variance);
      const cv = stdDev / avg; // coefficient of variation

      let status = 'pass';
      if (cv > 0.5) status = 'fail';
      else if (cv > 0.3) status = 'warn';

      items.push({
        name: `Hz: ${key}`,
        status,
        detail: `avg ${avg.toFixed(1)} Hz, CV ${(cv * 100).toFixed(0)}%`
      });
    });

    // Node survival
    if (d.startNodes && d.endNodes) {
      const missing = d.startNodes.filter(n => !d.endNodes.includes(n));
      const added = d.endNodes.filter(n => !d.startNodes.includes(n));
      if (missing.length === 0 && added.length === 0) {
        items.push({ name: 'Node survival', status: 'pass', detail: 'No changes in 30s' });
      } else {
        const details = [];
        if (missing.length > 0) details.push(`Lost: ${missing.join(', ')}`);
        if (added.length > 0) details.push(`New: ${added.join(', ')}`);
        items.push({ name: 'Node survival', status: 'warn', detail: details.join(' | ') });
      }
    }

    // Emergency state
    items.push({
      name: 'Emergency state',
      status: d.emergencyChanges === 0 ? 'pass' : 'fail',
      detail: d.emergencyChanges === 0 ? 'Clean (0 triggers)' : `${d.emergencyChanges} triggers`
    });

    // Stop flag
    items.push({
      name: 'Static stop flag',
      status: d.stopflagChanges === 0 ? 'pass' : 'warn',
      detail: d.stopflagChanges === 0 ? 'Clean (0 triggers)' : `${d.stopflagChanges} triggers`
    });

    // rosout errors
    if (d.errors.length === 0) {
      items.push({ name: 'rosout errors', status: 'pass', detail: '0 errors in 30s' });
    } else {
      const summary = d.errors.slice(0, 3).map(e => `[${e.level}] ${e.node}: ${e.msg.substring(0, 60)}`).join('\n');
      items.push({
        name: 'rosout errors',
        status: 'warn',
        detail: `${d.errors.length} errors. Latest: ${d.errors[0]?.msg.substring(0, 80) || ''}`
      });
    }

    // CPU/MEM over 30s
    if (d.cpuSamples.length > 0) {
      const maxCpu = Math.max(...d.cpuSamples);
      const avgCpu = d.cpuSamples.reduce((s, v) => s + v, 0) / d.cpuSamples.length;
      items.push({
        name: 'CPU (30s)',
        status: maxCpu < 80 ? 'pass' : (maxCpu < 95 ? 'warn' : 'fail'),
        detail: `avg ${avgCpu.toFixed(1)}%, max ${maxCpu.toFixed(1)}%`
      });
    }
    if (d.memSamples.length > 0) {
      const maxMem = Math.max(...d.memSamples);
      const avgMem = d.memSamples.reduce((s, v) => s + v, 0) / d.memSamples.length;
      items.push({
        name: 'MEM (30s)',
        status: maxMem < 80 ? 'pass' : (maxMem < 95 ? 'warn' : 'fail'),
        detail: `avg ${avgMem.toFixed(1)}%, max ${maxMem.toFixed(1)}%`
      });
    }

    this._results.stability = items;
    this._renderCategory('stability', items);
  },

  // ── Rendering ──

  _renderCategory(catId, items) {
    const container = document.getElementById(`diag-${catId}-items`);
    const summary = document.getElementById(`diag-${catId}-summary`);
    const icon = document.querySelector(`#diag-cat-${catId} .diag-cat-icon`);

    if (!container) return;

    container.innerHTML = items.map(item => `
      <div class="diag-item diag-${item.status}">
        <span class="diag-item-icon">${this._statusIcon(item.status)}</span>
        <span class="diag-item-name">${item.name}</span>
        <span class="diag-item-detail">${item.detail}</span>
      </div>
    `).join('');

    // Update category summary
    if (summary) {
      const pass = items.filter(i => i.status === 'pass').length;
      const warn = items.filter(i => i.status === 'warn').length;
      const fail = items.filter(i => i.status === 'fail').length;
      const checking = items.filter(i => i.status === 'checking').length;

      if (checking > 0) {
        summary.textContent = 'Checking...';
        summary.className = 'diag-cat-summary checking';
      } else {
        summary.textContent = `${pass}P ${warn}W ${fail}F`;
        summary.className = 'diag-cat-summary ' + (fail > 0 ? 'has-fail' : (warn > 0 ? 'has-warn' : 'all-pass'));
      }
    }

    // Update icon color
    if (icon) {
      const hasChecking = items.some(i => i.status === 'checking');
      const hasFail = items.some(i => i.status === 'fail');
      const hasWarn = items.some(i => i.status === 'warn');
      icon.className = 'diag-cat-icon ' + (hasChecking ? 'icon-checking' : (hasFail ? 'icon-fail' : (hasWarn ? 'icon-warn' : 'icon-pass')));
    }
  },

  _statusIcon(status) {
    switch (status) {
      case 'pass': return '<span class="diag-icon-pass">OK</span>';
      case 'warn': return '<span class="diag-icon-warn">!!</span>';
      case 'fail': return '<span class="diag-icon-fail">NG</span>';
      case 'checking': return '<span class="diag-icon-checking">...</span>';
      default: return '<span class="diag-icon-pending">--</span>';
    }
  },

  _updateScore(forceVal) {
    if (!this.$score) return;

    if (forceVal === null) {
      this.$score.textContent = '--';
      this.$score.className = 'diag-score';
      return;
    }

    // Calculate weighted score
    let totalPoints = 0;
    let maxPoints = 0;

    Object.entries(this.SCORE_WEIGHTS).forEach(([cat, weight]) => {
      const items = this._results[cat];
      if (!items || items.length === 0) return;

      const scorable = items.filter(i => i.status !== 'checking');
      if (scorable.length === 0) return;

      const catScore = scorable.reduce((sum, item) => {
        if (item.status === 'pass') return sum + 1;
        if (item.status === 'warn') return sum + 0.5;
        return sum;
      }, 0);

      totalPoints += (catScore / scorable.length) * weight;
      maxPoints += weight;
    });

    if (maxPoints === 0) {
      this.$score.textContent = '--';
      this.$score.className = 'diag-score';
      return;
    }

    const score = Math.round((totalPoints / maxPoints) * 100);
    this.$score.textContent = score;

    let level = 'critical';
    if (score >= 90) level = 'healthy';
    else if (score >= 70) level = 'warning';

    this.$score.className = `diag-score diag-score-${level}`;
  },

  _setButtonState(mode) {
    if (!this.$btnBoot || !this.$btnSteady || !this.$btnStop) return;

    switch (mode) {
      case 'boot':
        this.$btnBoot.disabled = true;
        this.$btnBoot.textContent = 'Running...';
        this.$btnSteady.disabled = true;
        this.$btnStop.style.display = 'none';
        break;
      case 'steady':
        this.$btnBoot.disabled = true;
        this.$btnSteady.disabled = true;
        this.$btnSteady.textContent = 'Running...';
        this.$btnStop.style.display = '';
        break;
      case 'idle':
      default:
        this.$btnBoot.disabled = false;
        this.$btnBoot.textContent = 'Boot Check';
        this.$btnSteady.disabled = false;
        this.$btnSteady.textContent = '30s Monitor';
        this.$btnStop.style.display = 'none';
        break;
    }
  },

  _showProgress(seconds) {
    if (!this.$progress) return;
    this.$progress.style.display = '';
    const pct = Math.min((seconds / 30) * 100, 100);
    if (this.$progressFill) this.$progressFill.style.width = pct + '%';
    if (this.$progressText) this.$progressText.textContent = `${seconds} / 30s`;
  },

  _hideProgress() {
    if (this.$progress) this.$progress.style.display = 'none';
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Diagnostics.init();
});
