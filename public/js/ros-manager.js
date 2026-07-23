// ROS Connection Manager - Multi-robot slot based
const RosManager = {
  throttleRate: 150,
  ros: null,
  mapRotation: 0,
  lastMapMsg: null,
  mapZoom: 1.0,
  mapPanX: 0,
  mapPanY: 0,
  mapDragging: false,
  mapDragStartX: 0,
  mapDragStartY: 0,
  mapPanStartX: 0,
  mapPanStartY: 0,
  mapRotating: false,
  mapRotateStartAngle: 0,
  mapRotateStartRot: 0,
  robotPose: null,
  lastScanMsg: null,
  mapCorrection: null,
  _followRobot: false,
  // Pose-set mode state
  _poseMode: false,
  _poseDragging: false,
  _poseStartCanvasX: 0,
  _poseStartCanvasY: 0,
  _poseCurrentCanvasX: 0,
  _poseCurrentCanvasY: 0,
  // Nav goal mode state
  _navGoalMode: false,
  _navGoalDragging: false,
  _navGoalStartX: 0,
  _navGoalStartY: 0,
  _navGoalCurrentX: 0,
  _navGoalCurrentY: 0,
  // Waypoint select mode (for ActionSender)
  _waypointSelectMode: false,
  _waypointSelectCallback: null,
  _waypointDragging: false,
  _waypointStartX: 0,
  _waypointStartY: 0,
  _waypointCurrentX: 0,
  _waypointCurrentY: 0,
  // Topic Hz monitoring
  _hzCounters: { bms: 0, workstate: 0, pose: 0, map: 0, lidar: 0 },
  _hzValues: { bms: 0, workstate: 0, pose: 0, map: 0, lidar: 0 },
  _hzInterval: null,

  // Auto-reconnect state
  _autoReconnect: {},  // index -> { timer, attempt, enabled }

  // Custom topic mapping
  TOPIC_MAPPING_KEY: 'amrTopicMapping',
  _topicMappings: {}, // { displayName: actualTopicName }

  // BMS charge estimation state (per active slot)
  _bmsTargetSoc: 80,
  _bmsSocHistory: [], // [{soc, time}] ring buffer for charge rate calculation
  _bmsSocHistoryMax: 120, // 120 samples (~2min at 1Hz) for stable rate estimation
  _bmsChargeStartTime: null,
  _bmsMinWarmupMs: 30000, // 30s warmup before showing ETA (reduced for responsiveness)
  _bmsMinSamples: 10,
  _bmsLastSoc: null,
  _bmsIsCharging: false,
  _bmsCurrentA: 0,
  _bmsCurrentAh: null,
  _bmsTotalAh: null,
  _bmsEtaTimer: null,
  _bmsChargingCurrentThreshold: 0.1, // A — minimum current to consider charging (noise filter)
  // Dock pose from /{rid}/dock_pose topic (docking target detection)
  _dockPose: null,        // { x, y, theta, stamp }
  _dockPoseTimeout: null, // auto-clear timer
  // Robot footprint polygon (from costmap)
  _footprintPoints: null, // [{x, y}, ...] in meters relative to base_link
  // SLAM breadcrumb trail & vertex tracking
  _breadcrumbTrail: [],       // [{x, y, yaw, time}] — full path at ~0.1m intervals
  _breadcrumbMaxPoints: 5000,
  _breadcrumbMinDist: 0.1,    // meters — minimum distance between trail points
  _slamVertices: [],           // [{x, y, yaw, idx, time}] — key vertices at ~1m intervals
  _slamVertexInterval: 1.0,   // meters between vertices
  _slamStartPose: null,       // starting pose for loop closure detection
  _slamLoopClosureRadius: 2.0,// meters — distance to start pose to suggest loop closure
  _slamTrailTimer: null,      // interval timer for trail recording
  // Render throttle for sync
  _renderPending: false,
  _renderThrottleMs: 50,
  // Discharge tracking
  _bmsDischargeHistory: [], // [{soc, time}] ring buffer for discharge rate
  _bmsDischargeStartTime: null,
  _bmsDischargeHistoryMax: 120, // match charge history size
  // Latency monitoring
  _latencyMs: null,
  _latencyInterval: null,

  // Get ROS connection by slot index
  getRos(index) {
    if (index === undefined || index === null) index = App.activeSlotIndex;
    if (index < 0 || index >= App.robotSlots.length) return null;
    return App.robotSlots[index].ros;
  },

  getRobotId(index) {
    if (index === undefined || index === null) index = App.activeSlotIndex;
    if (index < 0 || index >= App.robotSlots.length) return null;
    return App.robotSlots[index].robotId;
  },

  // Connect a specific slot
  connectSlot(index, ip, robotId) {
    if (index < 0 || index >= App.robotSlots.length) return;
    const slot = App.robotSlots[index];

    // B9 fix: 수동 재연결 전 auto-reconnect 타이머 해제
    this._clearAutoReconnect(index);

    // Disconnect existing connection if any
    if (slot.ros) {
      this.disconnectSlot(index);
    }

    const wsPort = slot.wsPort || 9090;
    // Use server-side WS proxy so remote users can reach the robot
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${wsProto}://${location.host}/ws-proxy?target=${ip}:${wsPort}`;
    const rosConn = new ROSLIB.Ros({ url });
    slot.ros = rosConn;

    rosConn.on('connection', () => {
      // Guard: ignore if this connection was replaced by a newer one
      if (slot.ros !== rosConn) return;
      console.log(`ROS slot[${index}] connected: ${url}`);
      slot.connected = true;
      slot.connectedAt = Date.now();  // Record connection time for mode detection
      slot.amclActive = false;  // Reset amcl state on new connection
      if (typeof ConnTimeline !== 'undefined') ConnTimeline.record(robotId, ip, 'connected', url);
      // Clear auto-reconnect on successful connection
      this._clearAutoReconnect(index);

      if (index === App.activeSlotIndex) {
        this.ros = rosConn;
      }

      // A passive connection keeps only the WebSocket open. Topic data is subscribed
      // exclusively for the active slot to keep 20-30 robot fleets lightweight.
      if (index === App.activeSlotIndex) {
        if (App.alarmSystem && App.alarmSystem.resetTopicTimes) {
          App.alarmSystem.resetTopicTimes();
        }
        App.updateActiveRobotStatus();
        this.subscribeSlotMonitoring(index);
        this.subscribeActiveSlotUI(index);
        if (typeof RosInfo !== 'undefined') RosInfo.refreshAll();
        // Start latency monitoring
        this.startLatencyMonitor(index);
        // Fetch robot model name
        this._fetchRobotModel(index);
      }

      App.renderActiveRobotSelector();
      App.renderRobotManagerList();
      App.renderMonitoringCards();
      App.saveRobotSlots();
      App.updateMultiRobotButtons();
      if (typeof FleetControl !== 'undefined') FleetControl.onSlotConnected(index);
    });

    rosConn.on('close', () => {
      // Guard: ignore stale close events from old connections
      if (slot.ros !== rosConn) return;
      console.log(`ROS slot[${index}] closed`);
      slot.connected = false;
      slot.ros = null;
      if (typeof ConnTimeline !== 'undefined') ConnTimeline.record(robotId, ip, 'disconnected', 'Connection closed');

      if (index === App.activeSlotIndex) {
        this.ros = null;
      }

      if (index === App.activeSlotIndex) {
        App.updateActiveRobotStatus();
        // Clear robot model display
        const modelEl = document.getElementById('robot-model-name');
        if (modelEl) modelEl.textContent = '';
      }
      App.renderActiveRobotSelector();
      App.renderRobotManagerList();
      App.renderMonitoringCards();
      App.updateMultiRobotButtons();
      if (typeof FleetControl !== 'undefined') FleetControl.onSlotDisconnected(index);

      // Don't save during page unload (beforeunload already saved with connected=true)
      if (!App._isUnloading) {
        App.saveRobotSlots();
      }

      // Auto-reconnect (skip during page unload)
      if (!App._isUnloading) {
        this._tryAutoReconnect(index, ip, robotId);
      }
    });

    rosConn.on('error', (error) => {
      // Guard: ignore stale error events from old connections
      if (slot.ros !== rosConn) return;
      console.error(`ROS slot[${index}] error:`, error);
      slot.connected = false;
      if (typeof FleetControl !== 'undefined') FleetControl.onSlotDisconnected(index);
      if (typeof ConnTimeline !== 'undefined') ConnTimeline.record(robotId, ip, 'error', String(error));
      if (index === App.activeSlotIndex) {
        App.updateActiveRobotStatus();
      }
    });
  },

  disconnectSlot(index) {
    if (index < 0 || index >= App.robotSlots.length) return;
    const slot = App.robotSlots[index];

    this.unsubscribeSlotData(index);

    if (slot.ros) {
      slot.ros.close();
      slot.ros = null;
    }

    if (index === App.activeSlotIndex) {
      this.ros = null;
      this.stopLatencyMonitor();
      if (this._bmsEtaTimer) {
        clearInterval(this._bmsEtaTimer);
        this._bmsEtaTimer = null;
      }
      if (typeof TestMode !== 'undefined' && TestMode.enabled && !TestMode._starting) {
        TestMode.stop();
      }
      if (typeof VelMonitor !== 'undefined') VelMonitor.onDisconnect();
    }

    slot.connected = false;
    if (typeof FleetControl !== 'undefined') FleetControl.onSlotDisconnected(index);
    if (index === App.activeSlotIndex) {
      App.updateActiveRobotStatus();
      App.refreshActiveBmsDisplay();
      App.refreshActiveWorkStateDisplay();
      App.refreshActivePoseDisplay();
    }

    App.renderActiveRobotSelector();
    App.renderRobotManagerList();
    App.renderMonitoringCards();
    App.saveRobotSlots();
  },

  // Stop every topic subscription while leaving the ROS WebSocket connected.
  unsubscribeSlotData(index, clearCachedData = true) {
    const slot = App.robotSlots[index];
    if (!slot) return;

    if (slot.tfTopic) {
      try { slot.tfTopic.unsubscribe(); } catch (e) { /* ignore */ }
      slot.tfTopic = null;
    }

    Object.values(slot.subscriptions || {}).forEach(sub => {
      if (sub && sub.unsubscribe) {
        try { sub.unsubscribe(); } catch (e) { /* ignore */ }
      }
    });
    slot.subscriptions = {};
    slot.dataSubscribed = false;
    slot.tfReceived = false;
    slot.robotStatePoseReceived = false;

    if (clearCachedData) {
      slot.bms = { voltage: 0, current: 0, soc: 0, charging: false };
      slot.workState = null;
      slot.pose = null;
    }
  },

  // Subscribe monitoring topics only for the active slot.
  subscribeSlotMonitoring(index) {
    const slot = App.robotSlots[index];
    if (!slot || !slot.ros || index !== App.activeSlotIndex) return;
    const rid = slot.robotId;
    slot.dataSubscribed = true;

    // BMS
    this._subscribeSlotTopic(index, 'bms', `/${rid}/bms`, 'std_msgs/Float32MultiArray', (msg) => {
      this._handleSlotBmsData(index, msg);
    });

    // Work state
    this._subscribeSlotTopic(index, 'work-state', `/${rid}/robot_state`, 'syscon_msgs/RobotState', (msg) => {
      this._handleSlotWorkState(index, msg);
    });

    // TF for pose (like RViz) - primary source for robot position
    this._subscribeSlotTf(index);

    // Pose from amcl (fallback if TF not available)
    this._subscribeSlotTopic(index, 'robot-pose', `/${rid}/amcl_pose`, 'geometry_msgs/PoseWithCovarianceStamped', (msg) => {
      this._handleSlotPose(index, msg, 'amcl');
    });

    // Pose from odom (SLAM mode fallback) - always subscribe
    this._subscribeSlotTopic(index, 'odom-pose', `/${rid}/odom`, 'nav_msgs/Odometry', (msg) => {
      this._handleSlotOdomPose(index, msg);
    });

    // Routine mode status
    this._subscribeSlotTopic(index, 'routine-status', `/${rid}/sp_routine_status`, 'std_msgs/String', (msg) => {
      this._handleRoutineStatus(index, msg);
    });

    // Dock pose (docking target detection result)
    this._subscribeSlotTopic(index, 'dock-pose', `/${rid}/dock_pose`, 'geometry_msgs/PoseStamped', (msg) => {
      this._handleDockPose(index, msg);
    });

    // Map matching quality is always visible on the map for the active robot.
    this._subscribeSlotTopic(index, 'map-correction', `/${rid}/map_correction`, 'syscon_msgs/Map_correction', (msg) => {
      this._handleMapCorrection(index, msg);
    });

    // 3D/LIO-SAM robots publish [level, inlier ratio] on a different topic.
    this._subscribeSlotTopic(index, 'map-correction-3d', `/${rid}/lio_sam/mapping/map_correction`, 'std_msgs/Float64MultiArray', (msg) => {
      const data = Array.isArray(msg?.data) ? msg.data : [];
      if (data.length < 2) return;
      this._handleMapCorrection(index, {
        map_correction: (Number(data[1]) || 0) * 100,
        level: Math.round(Number(data[0]) || 0),
        description: ''
      });
    });

    // Charge relay feedback. BMS current is evaluated separately so a relay ON
    // command is not mistaken for actual charging.
    this._subscribeSlotTopic(index, 'charge-relay-state', `/${rid}/charge_relay_state`, 'std_msgs/Bool', (msg) => {
      this._handleChargeRelayState(index, msg);
    });
    this._subscribeSlotTopic(index, 'io-charge-relay-state', `/${rid}/io/charge_relay`, 'std_msgs/Bool', (msg) => {
      this._handleChargeRelayState(index, msg);
    });
    this._subscribeSlotTopic(index, 'spx-io-charge-relay-state', `/${rid}/io/do/charge_relay`, 'std_msgs/Bool', (msg) => {
      this._handleChargeRelayState(index, msg);
    });

    // Robot footprint (from move_base costmap — points are in map frame)
    // Convert to base_link-relative by subtracting current robot pose
    this._subscribeSlotTopic(index, 'footprint', `/${rid}/move_base/local_costmap/footprint`, 'geometry_msgs/PolygonStamped', (msg) => {
      if (index !== App.activeSlotIndex) return;
      const slot = App.robotSlots[index];
      if (!msg.polygon || !msg.polygon.points || !slot) return;

      const rp = slot.pose || this.robotPose;
      if (rp) {
        // Transform map-frame points to base_link-relative
        const cosY = Math.cos(-rp.yaw);
        const sinY = Math.sin(-rp.yaw);
        this._footprintPoints = msg.polygon.points.map(p => {
          const dx = p.x - rp.x;
          const dy = p.y - rp.y;
          return { x: cosY * dx - sinY * dy, y: sinY * dx + cosY * dy };
        });
      } else {
        // No pose yet — assume footprint is already base_link relative (first polygon)
        this._footprintPoints = msg.polygon.points.map(p => ({ x: p.x, y: p.y }));
      }
    });

    // Also read footprint from ROS parameter as fallback
    this._fetchFootprintParam(index, rid);
  },

  // Fetch footprint from ROS parameter (move_base footprint param)
  _fetchFootprintParam(index, rid) {
    const slot = App.robotSlots[index];
    if (!slot || !slot.ros) return;

    // Try to read the footprint parameter
    const param = new ROSLIB.Param({
      ros: slot.ros,
      name: `/${rid}/move_base/local_costmap/footprint`
    });
    param.get((value) => {
      if (!value || index !== App.activeSlotIndex) return;
      try {
        // footprint param is a string like "[[x1,y1],[x2,y2],...]"
        const parsed = typeof value === 'string' ? JSON.parse(value.replace(/'/g, '"')) : value;
        if (Array.isArray(parsed) && parsed.length >= 3) {
          this._footprintPoints = parsed.map(p => {
            if (Array.isArray(p)) return { x: p[0], y: p[1] };
            return { x: p.x || 0, y: p.y || 0 };
          });
          console.log(`[Footprint] Loaded from param: ${this._footprintPoints.length} points`);
        }
      } catch (e) {
        console.warn('[Footprint] Param parse error:', e);
      }
    });
  },

  // Subscribe to TF for robot pose (like RViz does)
  _subscribeSlotTf(index) {
    const slot = App.robotSlots[index];
    if (!slot || !slot.ros) return;

    // Unsubscribe existing TF if any
    if (slot.tfTopic) {
      slot.tfTopic.unsubscribe();
      slot.tfTopic = null;
    }

    slot.tfReceived = false;
    slot.tfMapToOdom = null;
    slot.tfOdomToBase = null;

    // Subscribe to /tf
    slot.tfTopic = new ROSLIB.Topic({
      ros: slot.ros,
      name: '/tf',
      messageType: 'tf2_msgs/TFMessage'
    });

    slot.tfTopic.subscribe((msg) => {
      this._handleSlotTf(index, msg);
    });

    console.log(`[TF] Slot ${index}: Subscribed to /tf`);
  },

  // Handle TF message for a slot
  _handleSlotTf(index, msg) {
    const slot = App.robotSlots[index];
    if (!slot) return;

    const isMapFrame = (f) => f === 'map' || f.endsWith('/map');
    const isOdomFrame = (f) => f === 'odom' || f.endsWith('/odom');
    const isBaseFrame = (f) => f === 'base_link' || f.endsWith('/base_link') || f === 'base_footprint' || f.endsWith('/base_footprint');

    let updated = false;

    for (const tf of msg.transforms) {
      const parent = tf.header.frame_id;
      const child = tf.child_frame_id;

      // Direct map -> base_link
      if (isMapFrame(parent) && isBaseFrame(child)) {
        this._updateSlotPoseFromTf(index, tf.transform);
        slot.tfReceived = true;
        return;
      }

      // map -> odom
      if (isMapFrame(parent) && isOdomFrame(child)) {
        slot.tfMapToOdom = tf.transform;
        slot.tfMapToOdomTime = Date.now();
        updated = true;
      }

      // odom -> base_link
      if (isOdomFrame(parent) && isBaseFrame(child)) {
        slot.tfOdomToBase = tf.transform;
        slot.tfOdomToBaseTime = Date.now();
        updated = true;
      }
    }

    // Combine transforms if both available and recent (within 1s of each other)
    if (updated && slot.tfMapToOdom && slot.tfOdomToBase) {
      const age = Math.abs((slot.tfMapToOdomTime || 0) - (slot.tfOdomToBaseTime || 0));
      if (age < 1000) {
        const combined = this._combineTf(slot.tfMapToOdom, slot.tfOdomToBase);
        this._updateSlotPoseFromTf(index, combined);
        slot.tfReceived = true;
      }
    }
  },

  // Update slot pose from TF transform
  _updateSlotPoseFromTf(index, transform) {
    const slot = App.robotSlots[index];
    if (!slot) return;

    // If robot_state pose is available, it's more stable — skip TF pose
    if (slot.robotStatePoseReceived) return;

    const pos = transform.translation;
    const orient = transform.rotation;
    const siny = 2.0 * (orient.w * orient.z + orient.x * orient.y);
    const cosy = 1.0 - 2.0 * (orient.y * orient.y + orient.z * orient.z);
    const yaw = Math.atan2(siny, cosy);

    // Filter sudden jumps: reject if moved >2m in one tick (unless first pose)
    if (slot.pose) {
      const dx = pos.x - slot.pose.x;
      const dy = pos.y - slot.pose.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 2.0) {
        // Allow if jump persists (3 consecutive jumps = real relocation)
        slot._tfJumpCount = (slot._tfJumpCount || 0) + 1;
        if (slot._tfJumpCount < 3) {
          return; // Skip this frame
        }
        // 3+ consecutive jumps: accept as real (e.g. initialpose was set)
        console.warn(`[TF] Accepted jump ${dist.toFixed(2)}m after ${slot._tfJumpCount} frames`);
      } else {
        slot._tfJumpCount = 0;
      }
    }

    slot.pose = { x: pos.x, y: pos.y, yaw: yaw };
    slot.lastTfTime = Date.now();

    // If this is the active slot, update UI
    if (index === App.activeSlotIndex) {
      if (this._hzCounters) this._hzCounters.pose++;
      if (App.alarmSystem) App.alarmSystem.recordTopicActivity('pose');

      this.robotPose = { x: pos.x, y: pos.y, yaw: yaw };
      this.displayPose(this.robotPose);
      this.requestRender();
    }
  },

  // Subscribe UI-bound topics (camera, map) for the active slot only
  subscribeActiveSlotUI(index) {
    const slot = App.robotSlots[index];
    if (!slot || !slot.ros || index !== App.activeSlotIndex) return;
    const rid = slot.robotId;

    // Restore saved checkbox states before evaluating them (once)
    this._restoreCheckboxStates();

    // Camera subscriptions - capture index to verify active slot on callback
    const camIndex = index;
    if (document.getElementById('chk-cam1-depth').checked) {
      this._subscribeSlotTopic(index, 'cam1-depth', `/${rid}/cam_1/depth/image_raw`,
        'sensor_msgs/Image', (msg) => {
          if (camIndex !== App.activeSlotIndex) return;
          this.renderDepthImage('cam1-depth', msg);
        });
    }
    if (document.getElementById('chk-cam1-color').checked) {
      this._subscribeSlotTopic(index, 'cam1-color', `/${rid}/cam_1/color/image_raw/compressed`,
        'sensor_msgs/CompressedImage', (msg) => {
          if (camIndex !== App.activeSlotIndex) return;
          this.renderCamera('cam1-color', msg);
        });
    }
    if (document.getElementById('chk-cam2-depth').checked) {
      this._subscribeSlotTopic(index, 'cam2-depth', `/${rid}/cam_2/depth/image_raw`,
        'sensor_msgs/Image', (msg) => {
          if (camIndex !== App.activeSlotIndex) return;
          this.renderDepthImage('cam2-depth', msg);
        });
    }
    if (document.getElementById('chk-cam2-color').checked) {
      this._subscribeSlotTopic(index, 'cam2-color', `/${rid}/cam_2/color/image_raw/compressed`,
        'sensor_msgs/CompressedImage', (msg) => {
          if (camIndex !== App.activeSlotIndex) return;
          this.renderCamera('cam2-color', msg);
        });
    }

    // Map subscription - capture index to verify active slot on callback
    if (document.getElementById('chk-map').checked) {
      const mapIndex = index;
      this._subscribeSlotTopic(index, 'map', `/${rid}/map`, 'nav_msgs/OccupancyGrid', (msg) => {
        // Only process if this slot is still the active one (prevents race condition)
        if (mapIndex !== App.activeSlotIndex) return;
        this.renderMap(msg);
      });
    }

    // LiDAR subscription - capture index to verify active slot on callback
    if (document.getElementById('chk-lidar').checked) {
      const lidarIndex = index;
      this._subscribeSlotTopic(index, 'lidar', `/${rid}/scan`, 'sensor_msgs/LaserScan', (msg) => {
        // Only process if this slot is still the active one (prevents race condition)
        if (lidarIndex !== App.activeSlotIndex) return;
        this._hzCounters.lidar++;
        this.lastScanMsg = msg;
        this.requestRender();
      });
    }

    // Setup checkbox handlers for the active slot
    this.setupCheckboxHandlers();
  },

  // Switch active slot: previous robot becomes connection-only, new robot receives data.
  switchActiveSlot(index, previousIndex = -1) {
    if (previousIndex >= 0 && previousIndex < App.robotSlots.length && previousIndex !== index) {
      this.unsubscribeSlotData(previousIndex);
    }

    // Unsubscribe SLAM pose from previous slot
    this._unsubscribeSlamPose();
    this.stopLatencyMonitor();

    // Clear map, lidar, and footprint
    this.lastMapMsg = null;
    this.lastScanMsg = null;
    this.robotPose = null;
    this.mapCorrection = null;
    this._footprintPoints = null;
    this._renderMapCorrection(null);

    // Subscribe UI-bound topics for new active slot
    if (index >= 0 && index < App.robotSlots.length && App.robotSlots[index].connected) {
      this.ros = App.robotSlots[index].ros;
      // Defensive cleanup prevents duplicate subscriptions after rapid switching.
      this.unsubscribeSlotData(index, false);
      this.subscribeSlotMonitoring(index);
      this.subscribeActiveSlotUI(index);
      this.startLatencyMonitor(index);

      if (App.alarmSystem && App.alarmSystem.resetTopicTimes) {
        App.alarmSystem.resetTopicTimes();
      }

      const newSlot = App.robotSlots[index];
      // Restore cached pose from new slot immediately
      if (newSlot.pose) {
        this.robotPose = { ...newSlot.pose };
      }
      // Update robot model display
      const modelEl = document.getElementById('robot-model-name');
      if (modelEl) modelEl.textContent = newSlot.robotModel || '';
      if (!newSlot.robotModel) this._fetchRobotModel(index);
      if (newSlot.mapCorrection) {
        this.mapCorrection = { ...newSlot.mapCorrection };
        this._renderMapCorrection(this.mapCorrection);
      }
    } else {
      this.ros = null;
      const modelEl = document.getElementById('robot-model-name');
      if (modelEl) modelEl.textContent = '';
    }
    if (typeof JogControl !== 'undefined' && JogControl.updateChargeStatus) {
      JogControl.updateChargeStatus(index >= 0 ? App.robotSlots[index] : null);
    }

    // Reset BMS ETA state for new slot
    this._resetBmsEtaState();

    // Always reset to NAV mode on slot switch (manual control only)
    this._currentRoutineMode = 'NAV';
    this._slamRunning = false;
    this._lifelongRunning = false;
    this._modeManualSet = false;
    this._updateSlamButtons();
    this._updateLifelongButtons();
  },

  // Reset BMS ETA tracking state (called on slot switch / disconnect)
  _resetBmsEtaState() {
    this._bmsSocHistory = [];
    this._bmsChargeStartTime = null;
    this._bmsDischargeHistory = [];
    this._bmsDischargeStartTime = null;
    this._bmsLastSoc = null;
    this._bmsIsCharging = false;
    this._bmsCurrentA = 0;
    this._bmsCurrentAh = null;
    this._bmsTotalAh = null;
    this._bmsTrend = [];
    if (this._bmsEtaTimer) {
      clearInterval(this._bmsEtaTimer);
      this._bmsEtaTimer = null;
    }
    const summaryEl = document.getElementById('bms-time-estimate');
    if (summaryEl) {
      summaryEl.textContent = '예측 대기';
      summaryEl.classList.remove('charging', 'discharging');
      summaryEl.title = '배터리 데이터를 수집하면 예상 시간을 표시합니다';
    }
  },

  // Internal: subscribe a topic for a specific slot
  // Fast topics (pose, lidar) use lower throttle for smoother updates
  _fastTopicKeys: new Set(['robot-pose', 'lidar', 'cam1-color', 'cam2-color']),
  // Depth uses raw Image (heavy) - use separate slower rate
  _depthThrottleRate: 200,

  _subscribeSlotTopic(index, key, name, messageType, callback) {
    const slot = App.robotSlots[index];
    if (!slot || !slot.ros) return;

    if (slot.subscriptions[key]) {
      slot.subscriptions[key].unsubscribe();
    }

    const isDepth = key.includes('depth');
    const rate = isDepth ? this._depthThrottleRate :
                 this._fastTopicKeys.has(key) ? 50 : this.throttleRate;

    const topic = new ROSLIB.Topic({
      ros: slot.ros,
      name: name,
      messageType: messageType,
      throttle_rate: rate
    });

    topic.subscribe(callback);
    slot.subscriptions[key] = topic;
  },

  // BMS trend data
  _bmsTrend: [], // [{time, soc, voltage, current}]
  _bmsTrendMax: 600,

  // Handle BMS data for a slot
  _handleSlotBmsData(index, msg) {
    if (index === App.activeSlotIndex) {
      this._hzCounters.bms++;
      if (App.alarmSystem) App.alarmSystem.recordTopicActivity('bms');
    }
    const slot = App.robotSlots[index];
    if (!slot) return;
    const data = msg.data;

    const soc = data.length > 2 ? data[2] : 0;
    const current = data.length > 1 ? data[1] : 0;
    const voltage = data.length > 0 ? data[0] : 0;
    const isCharging = current > this._bmsChargingCurrentThreshold;

    slot.bms = { voltage, current, soc, charging: isCharging };

    // Record trend for active slot
    if (index === App.activeSlotIndex) {
      this._bmsTrend.push({ time: Date.now(), soc, voltage, current });
      if (this._bmsTrend.length > this._bmsTrendMax) this._bmsTrend.shift();
      this._renderBmsTrend();
    }

    // If this is the active slot, update UI
    if (index === App.activeSlotIndex) {
      this.handleBmsData(msg);
      if (typeof JogControl !== 'undefined' && JogControl.updateChargeStatus) {
        JogControl.updateChargeStatus(slot);
      }
    }
  },

  _handleMapCorrection(index, msg) {
    const slot = App.robotSlots[index];
    if (!slot) return;
    const correction = {
      value: Number(msg?.map_correction) || 0,
      level: Math.max(0, Math.min(5, Math.round(Number(msg?.level) || 0))),
      description: String(msg?.description || ''),
      receivedAt: Date.now()
    };
    slot.mapCorrection = correction;
    if (index !== App.activeSlotIndex) return;
    this.mapCorrection = correction;
    this._renderMapCorrection(correction);
  },

  _renderMapCorrection(correction) {
    const badge = document.getElementById('map-correction-badge');
    const levelEl = document.getElementById('map-correction-level');
    const valueEl = document.getElementById('map-correction-value');
    if (!badge || !levelEl || !valueEl) return;
    if (!correction) {
      badge.classList.add('waiting');
      badge.style.borderColor = '';
      badge.style.boxShadow = '';
      levelEl.style.color = '';
      levelEl.textContent = '● Map correction';
      valueEl.textContent = '수신 대기';
      badge.title = '실시간 map_correction 토픽을 기다리고 있습니다';
      return;
    }

    const colors = ['#888888', '#4ade80', '#86efac', '#fbbf24', '#f97316', '#ef4444'];
    const labels = ['?', 'Perfect', 'Good', 'Warning', 'Bad', 'Hazard'];
    const color = colors[correction.level] || colors[0];
    badge.classList.remove('waiting');
    badge.style.borderColor = color;
    badge.style.boxShadow = `0 0 9px ${color}55`;
    levelEl.style.color = color;
    levelEl.textContent = `● Lv.${correction.level} ${labels[correction.level] || '?'}`;
    valueEl.textContent = `${correction.value.toFixed(1)}%`;
    badge.title = correction.description || '실시간 map_correction 정합 품질';
  },

  _handleChargeRelayState(index, msg) {
    const slot = App.robotSlots[index];
    if (!slot) return;
    slot.chargeRelayOn = Boolean(msg?.data);
    slot.chargeRelayAssumed = false;
    slot.chargeRelayReceivedAt = Date.now();
    if (index === App.activeSlotIndex && typeof JogControl !== 'undefined' && JogControl.updateChargeStatus) {
      JogControl.updateChargeStatus(slot);
    }
  },

  // Handle work state for a slot
  _handleSlotWorkState(index, msg) {
    const slot = App.robotSlots[index];
    if (!slot) return;

    const state = msg.workstate !== undefined ? msg.workstate : (msg.data !== undefined ? msg.data : msg);
    slot.workState = state;

    // Extract robot model from robot_state.type field (no SSH needed)
    if (msg.type && !slot.robotModel) {
      slot.robotModel = msg.type;
      if (index === App.activeSlotIndex) {
        const modelEl = document.getElementById('robot-model-name');
        if (modelEl) modelEl.textContent = msg.type;
      }
      console.log(`[RobotModel] ${slot.robotId}: ${msg.type} (from robot_state)`);
    }

    // Use radius as footprint fallback (generate rectangle from radius)
    if (msg.radius && msg.radius > 0 && !this._footprintPoints && index === App.activeSlotIndex) {
      const r = msg.radius;
      this._footprintPoints = [
        { x: r, y: r * 0.7 }, { x: -r, y: r * 0.7 },
        { x: -r, y: -r * 0.7 }, { x: r, y: -r * 0.7 }
      ];
      console.log(`[Footprint] Generated from radius: ${r.toFixed(3)}m`);
    }

    // Use pose from robot_state as primary in NAV mode (most stable, from robotstate_pub)
    // In SLAM/LIFELONG mode, TF is the correct source (AMCL not running)
    const isNavMode = !slot.routineMode || slot.routineMode === 'NAV';
    if (isNavMode && msg.pose && (msg.pose.x !== undefined)) {
      const pose = { x: msg.pose.x, y: msg.pose.y, yaw: msg.pose.theta };
      slot.pose = pose;
      slot.robotStatePoseReceived = true;

      if (index === App.activeSlotIndex) {
        this._hzCounters.pose++;
        if (App.alarmSystem) App.alarmSystem.recordTopicActivity('pose');
        this.robotPose = pose;
        this.displayPose(pose);
        this.requestRender();
      }
    } else if (!isNavMode) {
      // SLAM/LIFELONG: let TF handle pose
      slot.robotStatePoseReceived = false;
    }

    // If this is the active slot, update UI
    if (index === App.activeSlotIndex) {
      this.displayWorkState(state);
    }
  },

  // Handle routine status for a slot (backup, workstate is primary)
  _handleRoutineStatus(index, msg) {
    const slot = App.robotSlots[index];
    if (!slot) return;

    const mode = msg.data || 'NAV';
    slot.routineMode = mode;
    // Mode detection is now handled by _handleSlotWorkState
  },

  // Handle pose for a slot (from amcl_pose - fallback when TF not available)
  _handleSlotPose(index, msg, source = 'amcl') {
    const slot = App.robotSlots[index];
    if (!slot) return;

    // If robot_state pose is available, skip amcl
    if (slot.robotStatePoseReceived) return;

    // If TF is working, ignore amcl_pose (TF is primary like RViz)
    if (slot.tfReceived) {
      return;
    }

    // Mark that amcl is active
    slot.amclActive = true;
    slot.lastAmclTime = Date.now();

    if (index === App.activeSlotIndex) {
      this._hzCounters.pose++;
      if (App.alarmSystem) App.alarmSystem.recordTopicActivity('pose');
    }

    const pos = msg.pose.pose.position;
    const orient = msg.pose.pose.orientation;
    const siny = 2.0 * (orient.w * orient.z + orient.x * orient.y);
    const cosy = 1.0 - 2.0 * (orient.y * orient.y + orient.z * orient.z);
    const yaw = Math.atan2(siny, cosy);

    slot.pose = { x: pos.x, y: pos.y, yaw: yaw };

    // If this is the active slot, update UI
    if (index === App.activeSlotIndex) {
      this.handleRobotPose(msg);
    }
  },

  // Handle dock_pose from /{rid}/dock_pose (geometry_msgs/PoseStamped)
  _handleDockPose(index, msg) {
    if (index !== App.activeSlotIndex) return;
    const pos = msg.pose.position;
    const orient = msg.pose.orientation;
    const siny = 2.0 * (orient.w * orient.z + orient.x * orient.y);
    const cosy = 1.0 - 2.0 * (orient.y * orient.y + orient.z * orient.z);
    const yaw = Math.atan2(siny, cosy);

    this._dockPose = { x: pos.x, y: pos.y, theta: yaw, stamp: Date.now() };
    console.log(`[DockPose] x=${pos.x.toFixed(3)} y=${pos.y.toFixed(3)} yaw=${yaw.toFixed(3)} frame=${msg.header?.frame_id || '?'}`);

    // Auto-clear after 5 seconds of no updates (docking ended)
    if (this._dockPoseTimeout) clearTimeout(this._dockPoseTimeout);
    this._dockPoseTimeout = setTimeout(() => {
      this._dockPose = null;
      this.requestRender();
    }, 5000);

    this.requestRender();
  },

  // Handle pose from odom (last resort fallback when TF and amcl not available)
  _handleSlotOdomPose(index, msg) {
    const slot = App.robotSlots[index];
    if (!slot) return;

    // If robot_state pose is available, skip odom
    if (slot.robotStatePoseReceived) return;

    // If TF is working, ignore odom (TF is primary like RViz)
    if (slot.tfReceived) {
      return;
    }

    // If amcl is active, ignore odom
    const amclTimeout = 5000;
    const amclActive = slot.amclActive && slot.lastAmclTime && (Date.now() - slot.lastAmclTime < amclTimeout);
    if (amclActive) {
      return;
    }

    const pos = msg.pose.pose.position;
    const orient = msg.pose.pose.orientation;
    const siny = 2.0 * (orient.w * orient.z + orient.x * orient.y);
    const cosy = 1.0 - 2.0 * (orient.y * orient.y + orient.z * orient.z);
    const yaw = Math.atan2(siny, cosy);

    slot.pose = { x: pos.x, y: pos.y, yaw: yaw };

    // If this is the active slot, update UI
    if (index === App.activeSlotIndex) {
      if (this._hzCounters) this._hzCounters.pose++;
      if (App.alarmSystem) App.alarmSystem.recordTopicActivity('pose');

      this.robotPose = { x: pos.x, y: pos.y, yaw: yaw };
      this.displayPose(this.robotPose);
      this.requestRender();
    }
  },

  // Work state timeline history
  _wsTimeline: [], // [{state, time}]
  _wsTimelineMax: 600, // ~10min at 1 sample/sec

  // Display work state on UI (dashboard section + header indicator)
  displayWorkState(state) {
    this._hzCounters.workstate++;
    if (App.alarmSystem) App.alarmSystem.recordTopicActivity('workstate');
    const stateStr = (state !== null && state !== undefined) ? String(state) : '--';
    const label = this.WORK_STATE_LABELS[stateStr] || stateStr;
    const valueEl = document.getElementById('work-state-value');
    const barEl = document.getElementById('work-state-bar');
    const headerBarEl = document.getElementById('header-ws-bar');
    const headerTextEl = document.getElementById('header-ws-text');

    if (state === null || state === undefined) {
      if (valueEl) valueEl.textContent = '--';
      if (barEl) barEl.style.backgroundColor = '#9ca3af';
      if (headerBarEl) headerBarEl.style.backgroundColor = '#9ca3af';
      if (headerTextEl) headerTextEl.textContent = '--';
      return;
    }

    const color = this._workStateColorMap[stateStr] || '#9ca3af';
    if (valueEl) valueEl.textContent = `${label} (${stateStr})`;
    if (barEl) barEl.style.backgroundColor = color;
    if (headerBarEl) headerBarEl.style.backgroundColor = color;
    if (headerTextEl) headerTextEl.textContent = label;

    // Record to timeline
    const now = Date.now();
    this._wsTimeline.push({ state: stateStr, color, time: now });
    if (this._wsTimeline.length > this._wsTimelineMax) this._wsTimeline.shift();
    this._renderWsTimeline();
  },

  _renderWsTimeline() {
    const canvas = document.getElementById('work-state-timeline');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.parentElement.clientWidth || 800;
    // P1 fix: 크기 변경시에만 재설정
    if (canvas.width !== w) canvas.width = w;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (this._wsTimeline.length < 2) {
      ctx.fillStyle = '#666';
      ctx.font = '11px sans-serif';
      ctx.fillText('Collecting data...', 10, h / 2 + 4);
      return;
    }

    const now = Date.now();
    const windowMs = 10 * 60 * 1000; // 10 minutes
    const startTime = now - windowMs;

    for (let i = 0; i < this._wsTimeline.length; i++) {
      const entry = this._wsTimeline[i];
      const nextEntry = this._wsTimeline[i + 1];
      const t0 = Math.max(entry.time, startTime);
      const t1 = nextEntry ? nextEntry.time : now;
      if (t1 < startTime) continue;

      const x0 = ((t0 - startTime) / windowMs) * w;
      const x1 = ((t1 - startTime) / windowMs) * w;
      ctx.fillStyle = entry.color;
      ctx.fillRect(x0, 0, Math.max(x1 - x0, 1), h);
    }

    // Time markers
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px sans-serif';
    for (let m = 0; m <= 10; m += 2) {
      const x = (m / 10) * w;
      ctx.fillRect(x, h - 10, 1, 10);
      ctx.fillText(`-${10 - m}m`, x + 2, h - 2);
    }
  },

  _renderBmsTrend() {
    const canvas = document.getElementById('bms-trend-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.parentElement.clientWidth || 800;
    // P1 fix: 크기 변경시에만 재설정
    if (canvas.width !== w) canvas.width = w;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (this._bmsTrend.length < 2) {
      ctx.fillStyle = '#666';
      ctx.font = '11px sans-serif';
      ctx.fillText('Collecting data...', 10, h / 2 + 4);
      return;
    }

    const metric = (document.getElementById('bms-trend-metric') || {}).value || 'soc';
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const startTime = now - windowMs;

    // Determine range
    let minV = Infinity, maxV = -Infinity;
    const pts = [];
    for (const d of this._bmsTrend) {
      if (d.time < startTime) continue;
      const v = d[metric];
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
      pts.push({ x: ((d.time - startTime) / windowMs) * w, v });
    }

    if (pts.length < 2) return;

    // Add padding
    const range = maxV - minV || 1;
    minV -= range * 0.1;
    maxV += range * 0.1;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = h - (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      const val = (minV + (i / 4) * (maxV - minV)).toFixed(1);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '9px sans-serif';
      ctx.fillText(val, 2, y - 2);
    }

    // Draw line
    ctx.beginPath();
    const colors = { soc: '#22c55e', voltage: '#3b82f6', current: '#f97316' };
    ctx.strokeStyle = colors[metric] || '#22c55e';
    ctx.lineWidth = 2;
    let first = true;
    for (const pt of pts) {
      const y = h - ((pt.v - minV) / (maxV - minV)) * h;
      if (first) { ctx.moveTo(pt.x, y); first = false; }
      else { ctx.lineTo(pt.x, y); }
    }
    ctx.stroke();

    // Fill under curve
    const lastPt = pts[pts.length - 1];
    ctx.lineTo(lastPt.x, h);
    ctx.lineTo(pts[0].x, h);
    ctx.closePath();
    ctx.fillStyle = (colors[metric] || '#22c55e') + '20';
    ctx.fill();

    // Time markers
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px sans-serif';
    for (let m = 0; m <= 10; m += 2) {
      const x = (m / 10) * w;
      ctx.fillRect(x, h - 10, 1, 10);
      ctx.fillText(`-${10 - m}m`, x + 2, h - 2);
    }

    // Current value
    if (pts.length > 0) {
      const last = this._bmsTrend[this._bmsTrend.length - 1];
      const units = { soc: '%', voltage: 'V', current: 'A' };
      ctx.fillStyle = colors[metric] || '#22c55e';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`${last[metric].toFixed(1)}${units[metric]}`, w - 60, 14);
    }
  },

  // Display pose on UI
  displayPose(pose) {
    const xEl = document.getElementById('robot-pos-x');
    const yEl = document.getElementById('robot-pos-y');
    const yawEl = document.getElementById('robot-pos-yaw');
    if (xEl) xEl.textContent = pose.x.toFixed(3) + ' m';
    if (yEl) yEl.textContent = pose.y.toFixed(3) + ' m';
    if (yawEl) yawEl.textContent = (pose.yaw * 180 / Math.PI).toFixed(1) + '\u00B0';
  },

  // Checkbox IDs that are persisted to localStorage
  _checkboxIds: ['chk-cam1-depth', 'chk-cam1-color', 'chk-cam2-depth', 'chk-cam2-color', 'chk-bms', 'chk-map', 'chk-robot-pose', 'chk-lidar'],
  _checkboxRestored: false,

  // Restore checkbox states from localStorage (runs once)
  _restoreCheckboxStates() {
    if (this._checkboxRestored) return;
    this._checkboxRestored = true;

    // Hidden-to-camera-tab checkbox mapping
    const hiddenToCam = {
      'chk-cam1-depth': 'cam1-depth',
      'chk-cam1-color': 'cam1-color',
      'chk-cam2-depth': 'cam2-depth',
      'chk-cam2-color': 'cam2-color'
    };

    this._checkboxIds.forEach(id => {
      const checkbox = document.getElementById(id);
      if (!checkbox) return;

      const saved = localStorage.getItem('amrChk_' + id);
      const camKey = hiddenToCam[id];

      if (saved !== null) {
        // Restore from localStorage
        checkbox.checked = saved === 'true';
      } else if (camKey) {
        // First use: sync from camera tab's default checked state
        const camCb = document.querySelector(`.cam-select-chk[data-cam="${camKey}"]`);
        if (camCb) checkbox.checked = camCb.checked;
      }

      // Sync hidden → camera tab visible checkboxes
      if (camKey) {
        const camCb = document.querySelector(`.cam-select-chk[data-cam="${camKey}"]`);
        if (camCb) camCb.checked = checkbox.checked;
      }
    });

    // Update camera panes to reflect restored state
    this.updateCameraPanes();
  },

  setupCheckboxHandlers() {
    // Define checkbox configs with topic templates (use {rid} as placeholder)
    // All handlerFn receive (msg, idx) and must verify active slot to prevent race conditions
    const checkboxConfigs = [
      { id: 'chk-cam1-depth', key: 'cam1-depth', topicTemplate: '/{rid}/cam_1/depth/image_raw', type: 'sensor_msgs/Image', handlerFn: (msg, idx) => { if (idx !== App.activeSlotIndex) return; this.renderDepthImage('cam1-depth', msg); } },
      { id: 'chk-cam1-color', key: 'cam1-color', topicTemplate: '/{rid}/cam_1/color/image_raw/compressed', type: 'sensor_msgs/CompressedImage', handlerFn: (msg, idx) => { if (idx !== App.activeSlotIndex) return; this.renderCamera('cam1-color', msg); } },
      { id: 'chk-cam2-depth', key: 'cam2-depth', topicTemplate: '/{rid}/cam_2/depth/image_raw', type: 'sensor_msgs/Image', handlerFn: (msg, idx) => { if (idx !== App.activeSlotIndex) return; this.renderDepthImage('cam2-depth', msg); } },
      { id: 'chk-cam2-color', key: 'cam2-color', topicTemplate: '/{rid}/cam_2/color/image_raw/compressed', type: 'sensor_msgs/CompressedImage', handlerFn: (msg, idx) => { if (idx !== App.activeSlotIndex) return; this.renderCamera('cam2-color', msg); } },
      { id: 'chk-bms', key: 'bms', topicTemplate: '/{rid}/bms', type: 'std_msgs/Float32MultiArray', handlerFn: (msg, idx) => this._handleSlotBmsData(idx, msg) },
      { id: 'chk-map', key: 'map', topicTemplate: '/{rid}/map', type: 'nav_msgs/OccupancyGrid', handlerFn: (msg, idx) => { if (idx !== App.activeSlotIndex) return; this.renderMap(msg); } },
      { id: 'chk-robot-pose', key: 'robot-pose', topicTemplate: '/{rid}/amcl_pose', type: 'geometry_msgs/PoseWithCovarianceStamped', handlerFn: (msg, idx) => this._handleSlotPose(idx, msg) },
      { id: 'chk-lidar', key: 'lidar', topicTemplate: '/{rid}/scan', type: 'sensor_msgs/LaserScan', handlerFn: (msg, idx) => { if (idx !== App.activeSlotIndex) return; this.lastScanMsg = msg; this.requestRender(); } }
    ];

    checkboxConfigs.forEach(cfg => {
      const checkbox = document.getElementById(cfg.id);
      checkbox.onchange = () => {
        // Persist checkbox state
        try { localStorage.setItem('amrChk_' + cfg.id, checkbox.checked); }
        catch (e) { /* ignore */ }

        // Unlock map when user explicitly toggles the map checkbox
        if (cfg.key === 'map') {
          this._mapLocked = false;
        }

        // Always use current active slot (not captured values)
        const currentIndex = App.activeSlotIndex;
        const currentSlot = App.robotSlots[currentIndex];
        if (checkbox.checked && currentSlot && currentSlot.ros) {
          // Build topic name dynamically with current robot ID
          const currentRid = currentSlot.robotId;
          const topic = cfg.topicTemplate.replace('{rid}', currentRid);
          // Create handler that passes current index
          const handler = (msg) => cfg.handlerFn(msg, currentIndex);
          this._subscribeSlotTopic(currentIndex, cfg.key, topic, cfg.type, handler);
        } else if (currentSlot) {
          if (currentSlot.subscriptions[cfg.key]) {
            currentSlot.subscriptions[cfg.key].unsubscribe();
            delete currentSlot.subscriptions[cfg.key];
          }
          // Clear cached data when unchecked
          if (cfg.key === 'lidar') {
            this.lastScanMsg = null;
            this.requestRender();
          }
        }
      };
    });
  },

  // Camera pane assignments (up to 4 panes)
  _camPanes: ['cam1-color', 'cam2-color', null, null],
  _camLayoutCount: 2,

  // Camera frame sequence to drop stale frames
  _camFrameSeq: {},

  renderCamera(canvasId, msg) {
    // Find which pane(s) this camera maps to
    const targetCanvases = [];
    for (let i = 0; i < 4; i++) {
      if (canvasId === this._camPanes[i]) {
        targetCanvases.push(`cam-pane-${i}-canvas`);
      }
    }
    // If no pane is showing this camera, skip rendering entirely
    if (targetCanvases.length === 0) return;

    // Increment frame sequence to detect stale frames
    if (!this._camFrameSeq[canvasId]) this._camFrameSeq[canvasId] = 0;
    const seq = ++this._camFrameSeq[canvasId];

    // Determine MIME type from msg.format
    const fmt = (msg.format || '').toLowerCase();
    let mime = 'image/jpeg';
    let imgData = msg.data;

    if (fmt.includes('png')) {
      mime = 'image/png';
    } else if (fmt.includes('bmp')) {
      mime = 'image/bmp';
    }

    // compressedDepth has 12-byte header before actual PNG data — strip it
    if (fmt.includes('compresseddepth') && mime === 'image/png') {
      try {
        const raw = atob(imgData);
        // Skip 12-byte header (compression config), find PNG signature (0x89504E47)
        let offset = 0;
        for (let i = 0; i < Math.min(raw.length - 4, 64); i++) {
          if (raw.charCodeAt(i) === 0x89 && raw.charCodeAt(i + 1) === 0x50 &&
              raw.charCodeAt(i + 2) === 0x4E && raw.charCodeAt(i + 3) === 0x47) {
            offset = i;
            break;
          }
        }
        if (offset > 0) {
          const stripped = raw.substring(offset);
          imgData = btoa(stripped);
        }
      } catch (e) {
        // If stripping fails, try with original data
      }
    }

    // Decode image once, draw to all target canvases
    const img = new Image();
    img.onload = () => {
      // Drop frame if a newer one arrived while decoding
      if (this._camFrameSeq[canvasId] !== seq) return;

      // For 16-bit depth PNG: canvas renders as very dark image
      // Apply colormap for better visualization
      const isDepth = canvasId.includes('depth');

      for (const cid of targetCanvases) {
        const c = document.getElementById(cid);
        if (!c) continue;
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);

        if (isDepth) {
          this._applyDepthColormap(ctx, img.width, img.height);
        }
      }
    };
    img.onerror = () => {
      // Silent fail for unsupported formats
    };
    img.src = `data:${mime};base64,${imgData}`;
  },

  // Render sensor_msgs/Image (raw depth) to camera pane
  renderDepthImage(canvasId, msg) {
    const targetCanvases = [];
    for (let i = 0; i < 4; i++) {
      if (canvasId === this._camPanes[i]) {
        targetCanvases.push(`cam-pane-${i}-canvas`);
      }
    }
    if (targetCanvases.length === 0) return;

    // Frame sequence to drop stale frames
    if (!this._camFrameSeq[canvasId]) this._camFrameSeq[canvasId] = 0;
    const seq = ++this._camFrameSeq[canvasId];

    const w = msg.width;
    const h = msg.height;
    const encoding = (msg.encoding || '').toLowerCase();

    // Decode base64 raw data
    let raw;
    try {
      const bin = atob(msg.data);
      raw = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
    } catch (e) {
      return;
    }

    if (this._camFrameSeq[canvasId] !== seq) return;

    for (const cid of targetCanvases) {
      const c = document.getElementById(cid);
      if (!c) continue;
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      const imageData = ctx.createImageData(w, h);
      const d = imageData.data;

      if (encoding === '16uc1' || encoding === 'mono16') {
        // 16-bit depth: convert to colormap
        // First pass: find min/max (skip 0 = no reading)
        const view = new DataView(raw.buffer);
        let min = 65535, max = 0;
        for (let i = 0; i < w * h; i++) {
          const v = view.getUint16(i * 2, true); // little-endian
          if (v > 0 && v < min) min = v;
          if (v > max) max = v;
        }
        const range = max > min ? max - min : 1;

        // Second pass: apply colormap
        for (let i = 0; i < w * h; i++) {
          const v = view.getUint16(i * 2, true);
          const pi = i * 4;
          if (v === 0) {
            d[pi] = d[pi + 1] = d[pi + 2] = 0;
          } else {
            const t = (v - min) / range;
            // Near(blue) → Mid(green) → Far(red)
            if (t < 0.5) {
              const s = t * 2;
              d[pi]     = 0;
              d[pi + 1] = s * 255 | 0;
              d[pi + 2] = (1 - s) * 255 | 0;
            } else {
              const s = (t - 0.5) * 2;
              d[pi]     = s * 255 | 0;
              d[pi + 1] = (1 - s) * 255 | 0;
              d[pi + 2] = 0;
            }
          }
          d[pi + 3] = 255;
        }
      } else if (encoding === '32fc1') {
        // 32-bit float depth (meters)
        const view = new DataView(raw.buffer);
        let min = Infinity, max = 0;
        for (let i = 0; i < w * h; i++) {
          const v = view.getFloat32(i * 4, true);
          if (v > 0 && isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        const range = max > min ? max - min : 1;
        for (let i = 0; i < w * h; i++) {
          const v = view.getFloat32(i * 4, true);
          const pi = i * 4;
          if (v <= 0 || !isFinite(v)) {
            d[pi] = d[pi + 1] = d[pi + 2] = 0;
          } else {
            const t = (v - min) / range;
            if (t < 0.5) {
              const s = t * 2;
              d[pi]     = 0;
              d[pi + 1] = s * 255 | 0;
              d[pi + 2] = (1 - s) * 255 | 0;
            } else {
              const s = (t - 0.5) * 2;
              d[pi]     = s * 255 | 0;
              d[pi + 1] = (1 - s) * 255 | 0;
              d[pi + 2] = 0;
            }
          }
          d[pi + 3] = 255;
        }
      } else {
        // 8-bit grayscale fallback (mono8 or unknown)
        for (let i = 0; i < w * h; i++) {
          const v = raw[i] || 0;
          const pi = i * 4;
          d[pi] = d[pi + 1] = d[pi + 2] = v;
          d[pi + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    }
  },

  // Apply colormap to depth image for better visualization
  _applyDepthColormap(ctx, w, h) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    // Find min/max depth from grayscale values (skip 0 = no data)
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i]; // R channel (grayscale)
      if (v > 0 && v < min) min = v;
      if (v > max) max = v;
    }
    if (max <= min) return; // uniform or empty image

    const range = max - min;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i];
      if (v === 0) {
        // No data → black
        d[i] = d[i + 1] = d[i + 2] = 0;
      } else {
        // Normalize and apply blue-to-red colormap
        const t = (v - min) / range; // 0 = near, 1 = far
        // Near = blue(0,0,255), Mid = green(0,255,0), Far = red(255,0,0)
        if (t < 0.5) {
          const s = t * 2;
          d[i]     = 0;              // R
          d[i + 1] = s * 255 | 0;    // G
          d[i + 2] = (1 - s) * 255 | 0; // B
        } else {
          const s = (t - 0.5) * 2;
          d[i]     = s * 255 | 0;    // R
          d[i + 1] = (1 - s) * 255 | 0; // G
          d[i + 2] = 0;              // B
        }
      }
      d[i + 3] = 255; // alpha
    }
    ctx.putImageData(imageData, 0, 0);
  },

  setCameraLayout(count) {
    const parsedCount = Number.parseInt(count, 10);
    this._camLayoutCount = [1, 2, 3, 4].includes(parsedCount) ? parsedCount : 2;
    const grid = document.getElementById('camera-tab-grid');
    if (grid) {
      grid.classList.remove('layout-1', 'layout-2', 'layout-3', 'layout-4');
      grid.classList.add(`layout-${this._camLayoutCount}`);
    }

    const layoutSelect = document.getElementById('cam-layout-select');
    if (layoutSelect) layoutSelect.value = String(this._camLayoutCount);

    // Uncheck and unsubscribe sources that no longer fit in the selected count.
    const checked = Array.from(document.querySelectorAll('.cam-select-chk:checked'));
    if (checked.length > this._camLayoutCount) {
      for (let i = this._camLayoutCount; i < checked.length; i++) {
        const cameraCheckbox = checked[i];
        cameraCheckbox.checked = false;
        const hiddenCheckbox = document.getElementById(`chk-${cameraCheckbox.dataset.cam}`);
        if (hiddenCheckbox) {
          hiddenCheckbox.checked = false;
          if (hiddenCheckbox.onchange) hiddenCheckbox.onchange();
          else {
            try { localStorage.setItem('amrChk_' + hiddenCheckbox.id, 'false'); }
            catch (e) { /* ignore */ }
          }
        }
      }
    }
    this.updateCameraPanes();
  },

  updateCameraPanes() {
    const checkboxes = document.querySelectorAll('.cam-select-chk:checked');
    const selected = Array.from(checkboxes).map(cb => cb.dataset.cam);
    const maxPanes = this._camLayoutCount;

    for (let i = 0; i < 4; i++) {
      this._camPanes[i] = (i < selected.length) ? selected[i] : null;
      const pane = document.getElementById(`cam-pane-${i}`);
      const label = document.getElementById(`cam-pane-${i}-label`);
      const canvas = document.getElementById(`cam-pane-${i}-canvas`);

      if (i < maxPanes && this._camPanes[i]) {
        if (pane) pane.style.display = '';
        if (label) label.textContent = this._camIdToLabel(this._camPanes[i]);
      } else {
        if (pane) pane.style.display = 'none';
      }
      if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
  },

  _camIdToLabel(camId) {
    const labels = {
      'cam1-depth': 'Cam1 Depth',
      'cam1-color': 'Cam1 Color',
      'cam2-depth': 'Cam2 Depth',
      'cam2-color': 'Cam2 Color'
    };
    return labels[camId] || camId;
  },

  // Handle robot pose from amcl_pose (active slot UI) - fallback only
  handleRobotPose(msg) {
    const slot = App.robotSlots[App.activeSlotIndex];
    // If robot_state or TF is providing pose, skip amcl
    if (slot && (slot.robotStatePoseReceived || slot.tfReceived)) {
      return;
    }

    const pos = msg.pose.pose.position;
    const orient = msg.pose.pose.orientation;
    const siny = 2.0 * (orient.w * orient.z + orient.x * orient.y);
    const cosy = 1.0 - 2.0 * (orient.y * orient.y + orient.z * orient.z);
    const yaw = Math.atan2(siny, cosy);

    this.robotPose = { x: pos.x, y: pos.y, yaw: yaw };
    this.displayPose(this.robotPose);
    this.requestRender();
  },

  // Build the raw map image (cached for performance)
  _buildMapImage(msg) {
    const width = msg.info.width;
    const height = msg.info.height;
    const data = msg.data;

    if (!this._mapImageCanvas) {
      this._mapImageCanvas = document.createElement('canvas');
    }
    this._mapImageCanvas.width = width;
    this._mapImageCanvas.height = height;
    const ctx = this._mapImageCanvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (height - 1 - y) * width + x;
        const dstIdx = (y * width + x) * 4;
        const value = data[srcIdx];

        let r, g, b;
        if (value === -1) {
          r = g = b = 128;
        } else if (value === 0) {
          r = g = b = 255;
        } else if (value === 100) {
          r = g = b = 0;
        } else {
          r = g = b = 255 + Math.round((value / 100) * -255);
        }

        imageData.data[dstIdx] = r;
        imageData.data[dstIdx + 1] = g;
        imageData.data[dstIdx + 2] = b;
        imageData.data[dstIdx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return this._mapImageCanvas;
  },

  // Throttled render request - ensures pose/lidar/map stay in sync
  requestRender() {
    if (this._renderPending) return;
    this._renderPending = true;
    requestAnimationFrame(() => {
      this._renderPending = false;
      if (this.lastMapMsg) this._doRenderMap(this.lastMapMsg);
    });
  },

  // When true, incoming map topic messages are ignored to protect restored/edited map
  _mapLocked: false,

  renderMap(msg) {
    this._hzCounters.map++;
    // Block map updates while in edit mode (prevent overwriting edits)
    if (this._mapEditMode) {
      this.requestRender();
      return;
    }
    // Block map_server's stale latched messages from overwriting restored/edited map
    if (this._mapLocked) {
      return;
    }
    this.lastMapMsg = msg;
    // Use throttled render for sync
    this.requestRender();
  },

  _doRenderMap(msg) {
    const canvas = document.getElementById('map-canvas');
    const container = canvas.parentElement;
    const width = msg.info.width;
    const height = msg.info.height;
    const resolution = msg.info.resolution;
    const origin = msg.info.origin;
    const rotation = this.mapRotation;

    const mapImg = this._buildMapImage(msg);

    const containerRect = container.getBoundingClientRect();
    const newW = containerRect.width || 600;
    const newH = containerRect.height || 600;
    // P1 fix: 캔버스 크기가 변경된 경우에만 재설정 (깜빡임 방지)
    if (canvas.width !== newW || canvas.height !== newH) {
      canvas.width = newW;
      canvas.height = newH;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Follow robot: compute pan so robot is centered
    if (this._followRobot && this.robotPose) {
      const robotMapX = (this.robotPose.x - origin.position.x) / resolution;
      const robotMapY = height - (this.robotPose.y - origin.position.y) / resolution;
      const rx = robotMapX - width / 2;
      const ry = robotMapY - height / 2;
      const rotRad = rotation * Math.PI / 180;
      const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
      // After rotation, robot pixel offset is (cosR*rx - sinR*ry, sinR*rx + cosR*ry)
      // After zoom: multiply by zoom. Pan must cancel this offset.
      this.mapPanX = -(cosR * rx - sinR * ry) * this.mapZoom;
      this.mapPanY = -(sinR * rx + cosR * ry) * this.mapZoom;
    }

    ctx.save();
    ctx.translate(canvas.width / 2 + this.mapPanX, canvas.height / 2 + this.mapPanY);
    ctx.scale(this.mapZoom, this.mapZoom);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(mapImg, -width / 2, -height / 2);

    // Render LiDAR scan points
    if (this.lastScanMsg && this.robotPose && document.getElementById('chk-lidar').checked) {
      this._renderLidarOnMap(ctx, width, height, resolution, origin);
    }

    // Render SLAM trail (before robot icon so robot draws on top)
    if (this._breadcrumbTrail.length > 1) {
      this._renderSlamTrail(ctx, width, height, resolution, origin);
    }

    if (this.robotPose && document.getElementById('chk-robot-pose').checked) {
      const robotMapX = (this.robotPose.x - origin.position.x) / resolution;
      const robotMapY = height - (this.robotPose.y - origin.position.y) / resolution;
      const rx = robotMapX - width / 2;
      const ry = robotMapY - height / 2;

      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(-this.robotPose.yaw);

      const lw = Math.max(1, 1.5 / this.mapZoom);
      const style = document.getElementById('robot-icon-style')?.value || 'amr';

      // Compute real-world size from footprint (in map pixels)
      const fp = this._footprintPoints;
      let realSize = null;
      if (fp && fp.length >= 3) {
        const maxX = Math.max(...fp.map(p => Math.abs(p.x)));
        const maxY = Math.max(...fp.map(p => Math.abs(p.y)));
        realSize = { halfL: maxX / resolution, halfW: maxY / resolution };
      }

      if (style === 'footprint') {
        this._drawRobotFootprint(ctx, resolution, lw);
      } else {
        const size = realSize ? realSize.halfL : Math.max(10, 14 / this.mapZoom);
        this._drawRobotIcon(ctx, size, lw, style, realSize);
      }

      ctx.restore();
    }

    // Draw dock pose markers (inside map transform)
    this._drawDockPoseMarkers(ctx, width, height, resolution, origin);

    ctx.restore();

    // Draw POI markers
    this._drawPOIs(ctx, width, height, resolution, origin);

    // Draw pose-set preview arrow (in canvas coordinates)
    if (this._poseMode && this._poseDragging) {
      this._drawPosePreview(ctx);
    }

    // Draw nav goal preview arrow (in canvas coordinates)
    if (this._navGoalMode && this._navGoalDragging) {
      this._drawNavGoalPreview(ctx);
    }

    // Draw waypoint select preview arrow (in canvas coordinates)
    if (this._waypointSelectMode && this._waypointDragging) {
      this._drawWaypointSelectPreview(ctx);
    }

    // Draw map edit overlays
    if (this._mapEditMode) {
      this._drawBrushCursor(ctx);
      this._drawScanFillSelection(ctx);
    }

    const zoomPct = Math.round(this.mapZoom * 100);
    document.getElementById('map-info').textContent = `${width}x${height} | ${resolution.toFixed(3)} m/px | ${rotation}\u00B0 | ${zoomPct}%`;
  },

  _drawPosePreview(ctx) {
    const sx = this._poseStartCanvasX;
    const sy = this._poseStartCanvasY;
    const ex = this._poseCurrentCanvasX;
    const ey = this._poseCurrentCanvasY;
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Circle at start point
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(46, 204, 113, 0.8)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (dist > 5) {
      // Arrow line
      const angle = Math.atan2(dy, dx);
      const arrowLen = Math.min(dist, 60);
      const tipX = sx + arrowLen * Math.cos(angle);
      const tipY = sy + arrowLen * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tipX, tipY);
      ctx.strokeStyle = 'rgba(46, 204, 113, 0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Arrowhead
      const headLen = 12;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - headLen * Math.cos(angle - 0.4), tipY - headLen * Math.sin(angle - 0.4));
      ctx.lineTo(tipX - headLen * Math.cos(angle + 0.4), tipY - headLen * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = 'rgba(46, 204, 113, 0.9)';
      ctx.fill();
    }

    ctx.restore();
  },

  _drawNavGoalPreview(ctx) {
    const sx = this._navGoalStartX;
    const sy = this._navGoalStartY;
    const ex = this._navGoalCurrentX;
    const ey = this._navGoalCurrentY;
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    ctx.save();
    // Circle at target point (blue/cyan)
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(52, 152, 219, 0.8)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Crosshair
    ctx.beginPath();
    ctx.moveTo(sx - 12, sy); ctx.lineTo(sx + 12, sy);
    ctx.moveTo(sx, sy - 12); ctx.lineTo(sx, sy + 12);
    ctx.strokeStyle = 'rgba(52, 152, 219, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (dist > 5) {
      const angle = Math.atan2(dy, dx);
      const arrowLen = Math.min(dist, 60);
      const tipX = sx + arrowLen * Math.cos(angle);
      const tipY = sy + arrowLen * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tipX, tipY);
      ctx.strokeStyle = 'rgba(52, 152, 219, 0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();

      const headLen = 12;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - headLen * Math.cos(angle - 0.4), tipY - headLen * Math.sin(angle - 0.4));
      ctx.lineTo(tipX - headLen * Math.cos(angle + 0.4), tipY - headLen * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = 'rgba(52, 152, 219, 0.9)';
      ctx.fill();
    }

    ctx.restore();
  },

  // Draw robot icon based on selected style
  // Draw robot using actual footprint polygon (real-world size)
  _drawRobotFootprint(ctx, resolution, lw) {
    // Default footprint if not received from robot (0.5m x 0.4m rectangle)
    const points = this._footprintPoints || [
      { x: 0.25, y: 0.2 },
      { x: -0.25, y: 0.2 },
      { x: -0.25, y: -0.2 },
      { x: 0.25, y: -0.2 }
    ];

    // Convert meters to map pixels (note: y is flipped)
    const pxPoints = points.map(p => ({
      x: p.x / resolution,
      y: -p.y / resolution
    }));

    // Fill body
    ctx.beginPath();
    ctx.moveTo(pxPoints[0].x, pxPoints[0].y);
    for (let i = 1; i < pxPoints.length; i++) {
      ctx.lineTo(pxPoints[i].x, pxPoints[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 150, 255, 0.3)';
    ctx.fill();
    ctx.strokeStyle = '#0096ff';
    ctx.lineWidth = lw * 1.5;
    ctx.stroke();

    // Direction indicator (front arrow)
    const frontX = Math.max(...pxPoints.map(p => p.x));
    const arrowSize = frontX * 0.4;
    ctx.beginPath();
    ctx.moveTo(frontX + arrowSize, 0);
    ctx.lineTo(frontX - arrowSize * 0.3, -arrowSize * 0.6);
    ctx.lineTo(frontX - arrowSize * 0.3, arrowSize * 0.6);
    ctx.closePath();
    ctx.fillStyle = '#0096ff';
    ctx.fill();

    // Center dot
    ctx.beginPath();
    ctx.arc(0, 0, lw * 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },

  _drawRobotIcon(ctx, size, lw, style, realSize) {
    switch (style) {
      case 'arrow':
        this._drawRobotArrow(ctx, size, lw);
        break;
      case 'circle':
        this._drawRobotCircle(ctx, size, lw);
        break;
      case 'triangle':
        this._drawRobotTriangle(ctx, size, lw);
        break;
      case 'turtle':
        this._drawRobotTurtle(ctx, size, lw);
        break;
      case 'amr':
      default:
        this._drawRobotAMR(ctx, size, lw, realSize);
        break;
    }
  },

  // AMR style (rectangular body with wheels) — uses real footprint size when available
  _drawRobotAMR(ctx, size, lw, realSize) {
    const bodyW = realSize ? realSize.halfL * 2 : size * 1.6;
    const bodyH = realSize ? realSize.halfW * 2 : size * 1.2;
    const r = Math.min(bodyW, bodyH) * 0.12;
    const x = -bodyW / 2, y = -bodyH / 2;

    // Body
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + bodyW - r, y);
    ctx.quadraticCurveTo(x + bodyW, y, x + bodyW, y + r);
    ctx.lineTo(x + bodyW, y + bodyH - r);
    ctx.quadraticCurveTo(x + bodyW, y + bodyH, x + bodyW - r, y + bodyH);
    ctx.lineTo(x + r, y + bodyH);
    ctx.quadraticCurveTo(x, y + bodyH, x, y + bodyH - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(52, 73, 94, 0.95)';
    ctx.fill();
    ctx.strokeStyle = '#ecf0f1';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Wheels
    const wheelW = bodyH * 0.15;
    const wheelH = bodyH * 0.35;
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(-bodyW / 2 - wheelW / 2, -wheelH / 2, wheelW, wheelH);
    ctx.fillRect(bodyW / 2 - wheelW / 2, -wheelH / 2, wheelW, wheelH);

    // Front arrow
    const arrowLen = bodyW * 0.15;
    ctx.beginPath();
    ctx.moveTo(bodyW / 2 + arrowLen, 0);
    ctx.lineTo(bodyW / 2 - arrowLen * 0.3, -bodyH * 0.2);
    ctx.lineTo(bodyW / 2 - arrowLen * 0.3, bodyH * 0.2);
    ctx.closePath();
    ctx.fillStyle = '#e74c3c';
    ctx.fill();

    // Center dot
    const dotR = Math.min(bodyW, bodyH) * 0.08;
    ctx.beginPath();
    ctx.arc(0, 0, dotR, 0, 2 * Math.PI);
    ctx.fillStyle = '#3498db';
    ctx.fill();
  },

  // Arrow style (classic RViz arrow)
  _drawRobotArrow(ctx, size, lw) {
    ctx.beginPath();
    ctx.moveTo(size * 1.5, 0);
    ctx.lineTo(-size, -size);
    ctx.lineTo(-size * 0.5, 0);
    ctx.lineTo(-size, size);
    ctx.closePath();

    ctx.fillStyle = 'rgba(233, 69, 96, 0.9)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.2, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },

  // Circle style (simple circle with direction)
  _drawRobotCircle(ctx, size, lw) {
    // Outer circle
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(46, 204, 113, 0.85)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Direction line
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(size * 1.2, 0);
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = lw * 2;
    ctx.stroke();

    // Arrow head
    ctx.beginPath();
    ctx.moveTo(size * 1.4, 0);
    ctx.lineTo(size * 0.9, -size * 0.3);
    ctx.lineTo(size * 0.9, size * 0.3);
    ctx.closePath();
    ctx.fillStyle = '#c0392b';
    ctx.fill();

    // Inner dot
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.25, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },

  // Triangle style
  _drawRobotTriangle(ctx, size, lw) {
    ctx.beginPath();
    ctx.moveTo(size * 1.3, 0);
    ctx.lineTo(-size * 0.7, -size);
    ctx.lineTo(-size * 0.7, size);
    ctx.closePath();

    ctx.fillStyle = 'rgba(155, 89, 182, 0.9)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.2, 0, 2 * Math.PI);
    ctx.fillStyle = '#f1c40f';
    ctx.fill();
  },

  // Turtle style (ROS turtle)
  _drawRobotTurtle(ctx, size, lw) {
    // Shell (ellipse)
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.9, size * 0.7, 0, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(39, 174, 96, 0.9)';
    ctx.fill();
    ctx.strokeStyle = '#1e8449';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Shell pattern
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.5, size * 0.35, 0, 0, 2 * Math.PI);
    ctx.strokeStyle = '#1e8449';
    ctx.lineWidth = lw * 0.7;
    ctx.stroke();

    // Head
    ctx.beginPath();
    ctx.ellipse(size * 1.1, 0, size * 0.35, size * 0.3, 0, 0, 2 * Math.PI);
    ctx.fillStyle = '#58d68d';
    ctx.fill();
    ctx.strokeStyle = '#1e8449';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Eyes
    ctx.beginPath();
    ctx.arc(size * 1.2, -size * 0.12, size * 0.08, 0, 2 * Math.PI);
    ctx.arc(size * 1.2, size * 0.12, size * 0.08, 0, 2 * Math.PI);
    ctx.fillStyle = '#2c3e50';
    ctx.fill();

    // Legs
    const legPositions = [
      { x: -size * 0.5, y: -size * 0.7 },
      { x: -size * 0.5, y: size * 0.7 },
      { x: size * 0.3, y: -size * 0.7 },
      { x: size * 0.3, y: size * 0.7 }
    ];
    ctx.fillStyle = '#58d68d';
    legPositions.forEach(pos => {
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y, size * 0.2, size * 0.15, 0, 0, 2 * Math.PI);
      ctx.fill();
    });

    // Tail
    ctx.beginPath();
    ctx.moveTo(-size * 0.9, 0);
    ctx.lineTo(-size * 1.2, -size * 0.1);
    ctx.lineTo(-size * 1.2, size * 0.1);
    ctx.closePath();
    ctx.fillStyle = '#58d68d';
    ctx.fill();
  },

  _renderLidarOnMap(ctx, mapWidth, mapHeight, resolution, origin) {
    const scan = this.lastScanMsg;
    const pose = this.robotPose;
    if (!scan || !pose) return;

    const angleMin = scan.angle_min;
    const angleIncrement = scan.angle_increment;
    const ranges = scan.ranges;
    const rangeMin = scan.range_min || 0.01;
    const rangeMax = scan.range_max || 30.0;

    // Robot position in map pixel coordinates
    const robotMapX = (pose.x - origin.position.x) / resolution;
    const robotMapY = mapHeight - (pose.y - origin.position.y) / resolution;

    // Translate to map-centered coords
    const rx = robotMapX - mapWidth / 2;
    const ry = robotMapY - mapHeight / 2;

    const lidarColor = document.getElementById('lidar-color')?.value || '#ff3333';
    const userPointSize = parseFloat(document.getElementById('lidar-point-size')?.value) || 2.5;

    ctx.save();
    // Move to robot position and rotate with robot
    ctx.translate(rx, ry);
    ctx.rotate(-pose.yaw);  // Rotate canvas to robot heading

    ctx.fillStyle = lidarColor;
    ctx.globalAlpha = 0.85;

    // P2 fix: 뷰포트 경계 계산 (컬링용)
    const canvas = document.getElementById('map-canvas');
    const halfCW = canvas.width / (2 * this.mapZoom);
    const halfCH = canvas.height / (2 * this.mapZoom);
    const viewLimitPx = Math.sqrt(halfCW * halfCW + halfCH * halfCH) + 50;

    const ps = Math.max(1, userPointSize / this.mapZoom);
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (r < rangeMin || r > rangeMax || !isFinite(r)) continue;

      const angle = angleMin + i * angleIncrement;
      const lx = r * Math.cos(angle) / resolution;
      const ly = -r * Math.sin(angle) / resolution;

      // P2 fix: 뷰포트 밖 포인트 스킵
      if (Math.abs(lx) > viewLimitPx || Math.abs(ly) > viewLimitPx) continue;

      ctx.fillRect(lx - ps / 2, ly - ps / 2, ps, ps);
    }

    ctx.restore();
  },

  rotateMap(delta) {
    this.mapRotation = (this.mapRotation + delta + 360) % 360;
    document.getElementById('map-rotation-value').textContent = `${this.mapRotation}\u00B0`;
    this.requestRender();
  },

  resetMapRotation() {
    this.mapRotation = 0;
    document.getElementById('map-rotation-value').textContent = '0\u00B0';
    this.requestRender();
  },

  // Auto-align map rotation so the rectangular map appears upright
  autoAlignMapRotation() {
    if (!this.lastMapMsg) {
      App.toast('No map data', 'error');
      return;
    }
    const msg = this.lastMapMsg;
    const width = msg.info.width;
    const height = msg.info.height;
    const data = msg.data;

    // Collect obstacle pixel positions (value >= 50 = occupied)
    const points = [];
    const step = Math.max(1, Math.floor(Math.min(width, height) / 200)); // sample for performance
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = (height - 1 - y) * width + x;
        if (data[idx] >= 50) {
          points.push({ x, y });
        }
      }
    }

    if (points.length < 10) {
      App.toast('Not enough obstacle data to detect angle', 'warning');
      return;
    }

    // Compute centroid
    let cx = 0, cy = 0;
    for (const p of points) { cx += p.x; cy += p.y; }
    cx /= points.length;
    cy /= points.length;

    // PCA: compute covariance matrix [cxx, cxy; cxy, cyy]
    let cxx = 0, cxy = 0, cyy = 0;
    for (const p of points) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      cxx += dx * dx;
      cxy += dx * dy;
      cyy += dy * dy;
    }

    // Principal angle from covariance matrix (atan2 of eigenvector)
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    // Convert to degrees
    let angleDeg = angle * 180 / Math.PI;

    // Snap to nearest 90° so the map appears upright
    // The PCA angle gives the dominant axis, we want to rotate so it aligns to 0°/90°
    const snapped = Math.round(angleDeg / 90) * 90;
    let correction = snapped - angleDeg;

    // Apply correction to current rotation
    this.mapRotation = Math.round(((this.mapRotation + correction) % 360 + 360) % 360);
    document.getElementById('map-rotation-value').textContent = `${this.mapRotation}\u00B0`;
    this._mapImageCanvas = null;
    this.requestRender();
    App.toast(`Auto-aligned: ${this.mapRotation}°`, 'info');
  },

  zoomMap(delta) {
    this.mapZoom = Math.max(0.1, Math.min(10, this.mapZoom + delta));
    document.getElementById('map-zoom-value').textContent = Math.round(this.mapZoom * 100) + '%';
    this.requestRender();
  },

  resetMapZoom() {
    this.mapZoom = 1.0;
    this.mapPanX = 0;
    this.mapPanY = 0;
    document.getElementById('map-zoom-value').textContent = '100%';
    this.requestRender();
  },

  // POI management
  _poiList: [],
  POI_STORAGE_KEY: 'mapPOIs',

  loadPOIs() {
    try { this._poiList = JSON.parse(localStorage.getItem(this.POI_STORAGE_KEY)) || []; }
    catch (e) { this._poiList = []; }
    this._renderPOISelect();
  },

  savePOIs() {
    // B13 fix: localStorage 예외처리
    try { localStorage.setItem(this.POI_STORAGE_KEY, JSON.stringify(this._poiList)); }
    catch (e) { console.warn('[RosManager] Failed to save POIs:', e.message); }
    this._renderPOISelect();
  },

  addPOI(name, x, y, yaw) {
    this._poiList.push({ name, x, y, yaw });
    this.savePOIs();
  },

  removePOI(index) {
    this._poiList.splice(index, 1);
    this.savePOIs();
  },

  // POI Bulk Import/Export
  exportPOIs() {
    if (!this._poiList.length) {
      App.toast('No POIs to export', 'info');
      return;
    }
    const csv = [
      'name,x,y,yaw',
      ...this._poiList.map(p => `${p.name},${p.x},${p.y},${p.yaw || 0}`)
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.download = `poi_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();
    App.toast(`${this._poiList.length} POIs exported`, 'success');
  },

  importPOIs(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.trim().split('\n');
        let imported = 0;

        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 3) {
            const name = parts[0].trim();
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const yaw = parseFloat(parts[3]) || 0;
            if (name && !isNaN(x) && !isNaN(y)) {
              this._poiList.push({ name, x, y, yaw });
              imported++;
            }
          }
        }

        this.savePOIs();
        this.requestRender();
        App.toast(`${imported} POIs imported`, 'success');
      } catch (err) {
        App.toast('Invalid CSV format', 'error');
      }
    };
    reader.readAsText(file);
  },

  showPOIBulkModal() {
    let modal = document.getElementById('poi-bulk-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'poi-bulk-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content poi-bulk-modal-content">
          <div class="modal-header">
            <h3>POI Bulk Import/Export</h3>
            <button class="modal-close" id="btn-poi-bulk-close">&times;</button>
          </div>
          <div class="poi-bulk-body">
            <div class="poi-bulk-section">
              <h4>Export POIs</h4>
              <p>Current POIs: <strong id="poi-count">${this._poiList.length}</strong></p>
              <button id="btn-poi-export" class="btn btn-primary">Export to CSV</button>
            </div>
            <div class="poi-bulk-section">
              <h4>Import POIs</h4>
              <p>CSV format: name,x,y,yaw</p>
              <input type="file" id="poi-import-file" accept=".csv" class="poi-import-input">
              <button id="btn-poi-import" class="btn btn-primary">Import</button>
            </div>
            <div class="poi-bulk-section">
              <h4>Clear All POIs</h4>
              <button id="btn-poi-clear-all" class="btn btn-danger">Clear All</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-poi-bulk-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      modal.querySelector('#btn-poi-export').addEventListener('click', () => this.exportPOIs());
      modal.querySelector('#btn-poi-import').addEventListener('click', () => {
        const file = document.getElementById('poi-import-file').files[0];
        if (file) {
          this.importPOIs(file);
          modal.classList.remove('active');
        } else {
          App.toast('Select a CSV file', 'error');
        }
      });
      modal.querySelector('#btn-poi-clear-all').addEventListener('click', () => {
        if (confirm('Clear all POIs?')) {
          this._poiList = [];
          this.savePOIs();
          this.requestRender();
          document.getElementById('poi-count').textContent = '0';
          App.toast('All POIs cleared', 'success');
        }
      });
    }

    document.getElementById('poi-count').textContent = this._poiList.length;
    modal.classList.add('active');
  },

  _renderPOISelect() {
    const sel = document.getElementById('poi-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- POI --</option>';
    this._poiList.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  },

  _drawDockPoseMarkers(ctx, mapWidth, mapHeight, resolution, origin) {
    if (!this._dockPose) return;
    const dp = this._dockPose;
    const mx = (dp.x - origin.position.x) / resolution - mapWidth / 2;
    const my = mapHeight - (dp.y - origin.position.y) / resolution - mapHeight / 2;
    const yaw = -dp.theta;

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(yaw);

    const len = Math.max(18, 24 / this.mapZoom);
    const lw = Math.max(2, 2.5 / this.mapZoom);
    const headLen = len * 0.35;
    const headAngle = 0.45;
    const color = 'rgba(30, 120, 255, 0.9)';

    // Arrow shaft
    ctx.beginPath();
    ctx.moveTo(-len * 0.5, 0);
    ctx.lineTo(len * 0.5, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();

    // Arrowhead (two lines, no fill)
    ctx.beginPath();
    ctx.moveTo(len * 0.5 - headLen * Math.cos(headAngle), -headLen * Math.sin(headAngle));
    ctx.lineTo(len * 0.5, 0);
    ctx.lineTo(len * 0.5 - headLen * Math.cos(headAngle), headLen * Math.sin(headAngle));
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.restore();

    // Label
    ctx.save();
    ctx.translate(mx, my);
    const fontSize = Math.max(6, 8 / this.mapZoom);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(30, 120, 255, 0.9)';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / this.mapZoom;
    const labelY = -len * 0.4 - 2 / this.mapZoom;
    ctx.strokeText('DOCK', 0, labelY);
    ctx.fillText('DOCK', 0, labelY);
    ctx.restore();
  },

  _drawPOIs(ctx, mapWidth, mapHeight, resolution, origin) {
    if (!this._poiList.length) return;
    this._poiList.forEach(p => {
      const mx = (p.x - origin.position.x) / resolution - mapWidth / 2;
      const my = mapHeight - (p.y - origin.position.y) / resolution - mapHeight / 2;
      ctx.save();
      // Diamond marker
      ctx.translate(mx, my);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.85)';
      ctx.beginPath();
      const s = 6 / this.mapZoom;
      ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1 / this.mapZoom; ctx.stroke();
      // Label
      ctx.fillStyle = '#facc15';
      ctx.font = `${Math.max(9, 11 / this.mapZoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.name, 0, -s - 3 / this.mapZoom);
      ctx.restore();
    });
  },

  setupPOIControls() {
    this.loadPOIs();
    const addBtn = document.getElementById('btn-poi-add');
    const goBtn = document.getElementById('btn-poi-go');
    const delBtn = document.getElementById('btn-poi-del');

    if (addBtn) addBtn.addEventListener('click', () => {
      if (!this.robotPose) { App.toast('No robot position', 'error'); return; }
      const name = prompt('POI name:', `POI_${this._poiList.length + 1}`);
      if (!name) return;
      this.addPOI(name, this.robotPose.x, this.robotPose.y, this.robotPose.yaw);
      this.requestRender();
      App.toast(`POI saved: ${name}`, 'success');
    });

    if (goBtn) goBtn.addEventListener('click', () => {
      const sel = document.getElementById('poi-select');
      const idx = parseInt(sel.value);
      if (isNaN(idx)) { App.toast('Please select a POI', 'info'); return; }
      const p = this._poiList[idx];
      if (!p) return;
      this._showNavGoalPopup(p.x, p.y, p.yaw || 0, document.getElementById('map-canvas'));
    });

    if (delBtn) delBtn.addEventListener('click', () => {
      const sel = document.getElementById('poi-select');
      const idx = parseInt(sel.value);
      if (isNaN(idx)) { App.toast('Please select a POI', 'info'); return; }
      this.removePOI(idx);
      this.requestRender();
      App.toast('POI deleted', 'success');
    });

    // POI Bulk Import/Export button
    const bulkBtn = document.getElementById('btn-poi-bulk');
    if (bulkBtn) bulkBtn.addEventListener('click', () => {
      this.showPOIBulkModal();
    });
  },

  startHzMonitor() {
    if (this._hzInterval) clearInterval(this._hzInterval);
    this._hzInterval = setInterval(() => {
      const keys = ['bms', 'workstate', 'pose', 'map', 'lidar'];
      keys.forEach(k => {
        this._hzValues[k] = this._hzCounters[k];
        this._hzCounters[k] = 0;
      });
      this._updateHzDisplay();
    }, 1000);
  },

  _updateHzDisplay() {
    const keys = ['bms', 'workstate', 'pose', 'map', 'lidar'];
    keys.forEach(k => {
      const el = document.getElementById(`hz-${k}-val`);
      if (!el) return;
      const hz = this._hzValues[k];
      el.textContent = hz > 0 ? `${hz} Hz` : '-- Hz';
      const item = document.getElementById(`hz-${k}`);
      if (item) {
        item.classList.toggle('hz-warn', hz === 0);
        item.classList.toggle('hz-ok', hz > 0);
      }
    });
  },

  setupMapInteraction() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;

    this.startHzMonitor();
    this.setupPOIControls();

    // Wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      this.mapZoom = Math.max(0.1, Math.min(10, this.mapZoom + delta));
      document.getElementById('map-zoom-value').textContent = Math.round(this.mapZoom * 100) + '%';
      this.requestRender();
    }, { passive: false });

    // Mouse down: pan mode, pose mode, nav goal mode, or waypoint select mode
    canvas.addEventListener('mousedown', (e) => {
      // Map edit mode handles its own events
      if (this._mapEditMode) return;

      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (this._poseMode) {
        this._poseDragging = true;
        this._poseStartCanvasX = cx;
        this._poseStartCanvasY = cy;
        this._poseCurrentCanvasX = cx;
        this._poseCurrentCanvasY = cy;
        return;
      }
      if (this._navGoalMode) {
        this._navGoalDragging = true;
        this._navGoalStartX = cx;
        this._navGoalStartY = cy;
        this._navGoalCurrentX = cx;
        this._navGoalCurrentY = cy;
        return;
      }
      if (this._waypointSelectMode) {
        this._waypointDragging = true;
        this._waypointStartX = cx;
        this._waypointStartY = cy;
        this._waypointCurrentX = cx;
        this._waypointCurrentY = cy;
        return;
      }
      // Right-click = rotate map
      if (e.button === 2) {
        const rect2 = canvas.getBoundingClientRect();
        const centerX = rect2.left + rect2.width / 2;
        const centerY = rect2.top + rect2.height / 2;
        this.mapRotating = true;
        this.mapRotateStartAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        this.mapRotateStartRot = this.mapRotation;
        canvas.style.cursor = 'crosshair';
        e.preventDefault();
        return;
      }

      this.mapDragging = true;
      this.mapDragStartX = e.clientX;
      this.mapDragStartY = e.clientY;
      this.mapPanStartX = this.mapPanX;
      this.mapPanStartY = this.mapPanY;
      canvas.style.cursor = 'grabbing';
      if (this._followRobot) {
        this._followRobot = false;
        const btnFollow = document.getElementById('btn-follow-robot');
        if (btnFollow) btnFollow.classList.remove('active');
      }
    });

    // Mouse move: pan, pose preview, or nav goal preview
    window.addEventListener('mousemove', (e) => {
      if (this._poseDragging) {
        const rect = canvas.getBoundingClientRect();
        this._poseCurrentCanvasX = e.clientX - rect.left;
        this._poseCurrentCanvasY = e.clientY - rect.top;
        this.requestRender();
        return;
      }
      if (this._navGoalDragging) {
        const rect = canvas.getBoundingClientRect();
        this._navGoalCurrentX = e.clientX - rect.left;
        this._navGoalCurrentY = e.clientY - rect.top;
        this.requestRender();
        return;
      }
      if (this._waypointDragging) {
        const rect = canvas.getBoundingClientRect();
        this._waypointCurrentX = e.clientX - rect.left;
        this._waypointCurrentY = e.clientY - rect.top;
        this.requestRender();
        return;
      }
      if (this.mapRotating) {
        const rect = canvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        const deltaAngle = (currentAngle - this.mapRotateStartAngle) * (180 / Math.PI);
        let rot = ((this.mapRotateStartRot + deltaAngle) % 360 + 360) % 360;
        if (e.shiftKey) rot = Math.round(rot / 5) * 5;
        this.mapRotation = rot;
        document.getElementById('map-rotation-value').textContent = `${Math.round(this.mapRotation)}\u00B0`;
        this.requestRender();
        return;
      }
      if (!this.mapDragging) return;
      this.mapPanX = this.mapPanStartX + (e.clientX - this.mapDragStartX);
      this.mapPanY = this.mapPanStartY + (e.clientY - this.mapDragStartY);
      this.requestRender();
    });

    // Mouse up: finish pan, commit pose, commit nav goal, or commit waypoint
    window.addEventListener('mouseup', (e) => {
      if (this._poseDragging) {
        this._poseDragging = false;
        this._commitClickPose(canvas);
        return;
      }
      if (this._navGoalDragging) {
        this._navGoalDragging = false;
        this._commitNavGoal(canvas);
        return;
      }
      if (this._waypointDragging) {
        this._waypointDragging = false;
        this._commitWaypointSelect(canvas);
        return;
      }
      if (this.mapRotating) {
        this.mapRotating = false;
        this.mapRotation = Math.round(this.mapRotation);
        document.getElementById('map-rotation-value').textContent = `${this.mapRotation}\u00B0`;
        canvas.style.cursor = 'grab';
        this.requestRender();
        return;
      }
      if (this.mapDragging) {
        this.mapDragging = false;
        canvas.style.cursor = (this._poseMode || this._navGoalMode || this._waypointSelectMode || this._mapEditMode) ? (this._mapEditTool === 'move' ? 'grab' : 'crosshair') : 'grab';
      }
    });

    canvas.style.cursor = 'grab';

    // Update cursor when edit mode changes
    this._updateMapCursor = () => {
      if (this._mapEditMode) {
        canvas.style.cursor = 'crosshair';
      } else if (this._poseMode || this._navGoalMode || this._waypointSelectMode) {
        canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.cursor = 'grab';
      }
    };

    // Set Pose mode toggle button
    const btnPoseMode = document.getElementById('btn-set-pose-mode');
    const btnNavGoal = document.getElementById('btn-nav-goal-mode');
    if (btnPoseMode) {
      btnPoseMode.addEventListener('click', () => {
        this._poseMode = !this._poseMode;
        if (this._poseMode) { this._navGoalMode = false; if (btnNavGoal) btnNavGoal.classList.remove('active'); }
        btnPoseMode.classList.toggle('active', this._poseMode);
        canvas.style.cursor = this._poseMode ? 'crosshair' : 'grab';
        if (this._poseMode) {
          App.toast('Click map to set position, drag to set direction', 'info');
        }
      });
    }

    // Nav Goal mode toggle button
    if (btnNavGoal) {
      btnNavGoal.addEventListener('click', () => {
        this._navGoalMode = !this._navGoalMode;
        if (this._navGoalMode) { this._poseMode = false; if (btnPoseMode) btnPoseMode.classList.remove('active'); }
        btnNavGoal.classList.toggle('active', this._navGoalMode);
        canvas.style.cursor = this._navGoalMode ? 'crosshair' : 'grab';
        if (this._navGoalMode) {
          App.toast('Click map to set goal, drag to set approach direction', 'info');
        }
      });
    }

    // Follow robot toggle
    const btnFollow = document.getElementById('btn-follow-robot');
    if (btnFollow) {
      btnFollow.addEventListener('click', () => {
        this._followRobot = !this._followRobot;
        btnFollow.classList.toggle('active', this._followRobot);
        if (this._followRobot && this.lastMapMsg) {
          this.renderMap(this.lastMapMsg);
        }
      });
    }

    // COV Reposition button
    const btnCov = document.getElementById('btn-cov-reposition');
    if (btnCov) {
      btnCov.addEventListener('click', () => this.callCovReposition());
    }





    // Map Fullscreen toggle
    const btnFullscreen = document.getElementById('btn-map-fullscreen');
    const panelMap = document.getElementById('panel-map');
    if (btnFullscreen && panelMap) {
      const enterFullscreen = () => {
        panelMap.classList.add('map-fullscreen');
        btnFullscreen.classList.add('active');
        btnFullscreen.innerHTML = '✕';
        btnFullscreen.title = 'Exit fullscreen (ESC)';
        setTimeout(() => this.requestRender(), 100);
      };

      const exitFullscreen = () => {
        panelMap.classList.add('map-fullscreen-exit');
        panelMap.classList.remove('map-fullscreen');
        btnFullscreen.classList.remove('active');
        btnFullscreen.innerHTML = '⤢';
        btnFullscreen.title = 'Map fullscreen (ESC to close)';
        setTimeout(() => {
          panelMap.classList.remove('map-fullscreen-exit');
          this.requestRender();
        }, 50);
      };

      btnFullscreen.addEventListener('click', () => {
        if (panelMap.classList.contains('map-fullscreen')) {
          exitFullscreen();
        } else {
          enterFullscreen();
        }
      });

      // ESC key to exit fullscreen
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panelMap.classList.contains('map-fullscreen')) {
          exitFullscreen();
        }
      });
    }

    // LiDAR color and size re-render on change
    const lidarColor = document.getElementById('lidar-color');
    const lidarSize = document.getElementById('lidar-point-size');
    if (lidarColor) lidarColor.addEventListener('input', () => { this.requestRender(); });
    if (lidarSize) lidarSize.addEventListener('input', () => { this.requestRender(); });

    // Robot icon style change
    const robotIconStyle = document.getElementById('robot-icon-style');
    if (robotIconStyle) robotIconStyle.addEventListener('change', () => { this.requestRender(); });
  },

  // Convert canvas pixel to map world coordinates
  _canvasToWorld(canvasX, canvasY, canvas) {
    if (!this.lastMapMsg) return null;
    const msg = this.lastMapMsg;
    const width = msg.info.width;
    const height = msg.info.height;
    const resolution = msg.info.resolution;
    const origin = msg.info.origin;
    const rotation = this.mapRotation * Math.PI / 180;

    // Reverse the render transform:
    // render: translate(cx + panX, cy + panY) → scale(zoom) → rotate(rot) → draw at (-w/2, -h/2)
    const cx = canvas.width / 2 + this.mapPanX;
    const cy = canvas.height / 2 + this.mapPanY;

    // Undo translate
    let dx = canvasX - cx;
    let dy = canvasY - cy;

    // Undo scale
    dx /= this.mapZoom;
    dy /= this.mapZoom;

    // Undo rotation
    const cosR = Math.cos(-rotation);
    const sinR = Math.sin(-rotation);
    const mx = dx * cosR - dy * sinR;
    const my = dx * sinR + dy * cosR;

    // Now mx, my are in map image pixel coords relative to center
    const mapPixelX = mx + width / 2;
    const mapPixelY = my + height / 2;

    // Convert map pixel to world coords
    // In _buildMapImage: srcIdx = (height - 1 - y) * width + x, so pixel Y is flipped
    const worldX = mapPixelX * resolution + origin.position.x;
    const worldY = (height - mapPixelY) * resolution + origin.position.y;

    return { x: worldX, y: worldY };
  },

  // Commit the pose from click+drag on canvas
  _commitClickPose(canvas) {
    const startWorld = this._canvasToWorld(this._poseStartCanvasX, this._poseStartCanvasY, canvas);
    if (!startWorld) {
      App.toast('No map data to compute position', 'error');
      return;
    }

    // Compute yaw from drag direction
    const dx = this._poseCurrentCanvasX - this._poseStartCanvasX;
    const dy = this._poseCurrentCanvasY - this._poseStartCanvasY;
    const dragDist = Math.sqrt(dx * dx + dy * dy);

    let yawRad = 0;
    if (dragDist > 5) {
      // Yaw from canvas drag direction, accounting for map rotation
      const canvasAngle = Math.atan2(-dy, dx); // canvas Y is down
      const rotRad = this.mapRotation * Math.PI / 180;
      yawRad = canvasAngle - rotRad;
    }

    // Publish
    const x = startWorld.x;
    const y = startWorld.y;
    const yawDeg = yawRad * 180 / Math.PI;

    this._publishInitialPoseValues(x, y, yawRad);

    // Exit pose mode
    this._poseMode = false;
    const btnPoseMode = document.getElementById('btn-set-pose-mode');
    if (btnPoseMode) btnPoseMode.classList.remove('active');
    canvas.style.cursor = 'grab';

    this.requestRender();
  },

  // Commit nav goal from click+drag on canvas
  _commitNavGoal(canvas) {
    const startWorld = this._canvasToWorld(this._navGoalStartX, this._navGoalStartY, canvas);
    if (!startWorld) {
      App.toast('Cannot calculate coordinates without map data', 'error');
      return;
    }

    const dx = this._navGoalCurrentX - this._navGoalStartX;
    const dy = this._navGoalCurrentY - this._navGoalStartY;
    const dragDist = Math.sqrt(dx * dx + dy * dy);

    let yawRad = 0;
    if (dragDist > 5) {
      const canvasAngle = Math.atan2(-dy, dx);
      const rotRad = this.mapRotation * Math.PI / 180;
      yawRad = canvasAngle - rotRad;
    }

    // Show parameter popup instead of publishing immediately
    this._showNavGoalPopup(startWorld.x, startWorld.y, yawRad, canvas);
  },

  _showNavGoalPopup(x, y, yawRad, canvas) {
    const popup = document.getElementById('nav-goal-popup');
    if (!popup) {
      this._publishNavGoal(x, y, yawRad);
      this._exitNavGoalMode(canvas);
      return;
    }

    // Fill coordinates
    document.getElementById('nav-goal-x').textContent = x.toFixed(2);
    document.getElementById('nav-goal-y').textContent = y.toFixed(2);
    document.getElementById('nav-goal-yaw').textContent = (yawRad * 180 / Math.PI).toFixed(1);

    // Position popup near the click point
    const mapPanel = document.getElementById('panel-map');
    if (mapPanel) {
      const rect = mapPanel.getBoundingClientRect();
      popup.style.top = (rect.top + 60) + 'px';
      popup.style.left = (rect.left + 10) + 'px';
    }

    popup.classList.remove('hidden');

    // Store pending goal data
    this._pendingNavGoal = { x, y, yawRad, canvas };

    // Wire up buttons (remove old listeners by cloning)
    const sendBtn = document.getElementById('btn-nav-goal-send');
    const cancelBtn = document.getElementById('btn-nav-goal-cancel');
    const newSend = sendBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(newSend, sendBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    newSend.addEventListener('click', () => {
      const params = {
        maxVel: parseFloat(document.getElementById('nav-goal-max-vel').value) || 0.8,
        passing: document.getElementById('nav-goal-passing').value === 'true',
        noAvoid: document.getElementById('nav-goal-avoid').value === 'true',
      };
      this._publishNavGoal(x, y, yawRad, params);
      popup.classList.add('hidden');
      this._exitNavGoalMode(canvas);
    });

    newCancel.addEventListener('click', () => {
      popup.classList.add('hidden');
      this._exitNavGoalMode(canvas);
    });
  },

  _exitNavGoalMode(canvas) {
    this._navGoalMode = false;
    const btnNavGoal = document.getElementById('btn-nav-goal-mode');
    if (btnNavGoal) btnNavGoal.classList.remove('active');
    if (canvas) canvas.style.cursor = 'grab';
    this.requestRender();
  },

  // Enter waypoint select mode (called from ActionSender)
  _enterWaypointSelectMode(callback) {
    // Disable other modes
    this._poseMode = false;
    this._navGoalMode = false;
    const btnPoseMode = document.getElementById('btn-set-pose-mode');
    const btnNavGoal = document.getElementById('btn-nav-goal-mode');
    if (btnPoseMode) btnPoseMode.classList.remove('active');
    if (btnNavGoal) btnNavGoal.classList.remove('active');

    this._waypointSelectMode = true;
    this._waypointSelectCallback = callback;
    const canvas = document.getElementById('map-canvas');
    if (canvas) canvas.style.cursor = 'crosshair';
  },

  // Exit waypoint select mode
  _exitWaypointSelectMode() {
    this._waypointSelectMode = false;
    this._waypointSelectCallback = null;
    this._waypointDragging = false;
    const canvas = document.getElementById('map-canvas');
    if (canvas) canvas.style.cursor = 'grab';
    this.requestRender();
  },

  // Commit waypoint selection from click+drag
  _commitWaypointSelect(canvas) {
    const startWorld = this._canvasToWorld(this._waypointStartX, this._waypointStartY, canvas);
    if (!startWorld) {
      App.toast('Cannot calculate coordinates without map data', 'error');
      return;
    }

    const dx = this._waypointCurrentX - this._waypointStartX;
    const dy = this._waypointCurrentY - this._waypointStartY;
    const dragDist = Math.sqrt(dx * dx + dy * dy);

    let yawRad = 0;
    if (dragDist > 5) {
      const canvasAngle = Math.atan2(-dy, dx);
      const rotRad = this.mapRotation * Math.PI / 180;
      yawRad = canvasAngle - rotRad;
    }

    // Call the callback with coordinates
    if (this._waypointSelectCallback) {
      this._waypointSelectCallback(startWorld.x, startWorld.y, yawRad);
    }
  },

  // Draw waypoint select preview arrow
  _drawWaypointSelectPreview(ctx) {
    const sx = this._waypointStartX;
    const sy = this._waypointStartY;
    const ex = this._waypointCurrentX;
    const ey = this._waypointCurrentY;

    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    ctx.save();

    // Draw start point (cyan for waypoint)
    ctx.fillStyle = '#00bcd4';
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, Math.PI * 2);
    ctx.fill();

    // Draw direction arrow if dragged
    if (dist > 5) {
      const angle = Math.atan2(dy, dx);
      const arrowLen = Math.min(dist, 60);

      ctx.strokeStyle = '#00bcd4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(angle) * arrowLen, sy + Math.sin(angle) * arrowLen);
      ctx.stroke();

      // Arrowhead
      const headLen = 12;
      const headAngle = Math.PI / 6;
      const tipX = sx + Math.cos(angle) * arrowLen;
      const tipY = sy + Math.sin(angle) * arrowLen;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - headLen * Math.cos(angle - headAngle), tipY - headLen * Math.sin(angle - headAngle));
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - headLen * Math.cos(angle + headAngle), tipY - headLen * Math.sin(angle + headAngle));
      ctx.stroke();
    }

    ctx.restore();
  },

  // Publish navigation goal to /move_base_simple/goal
  _publishNavGoal(x, y, yawRad, params) {
    const p = params || { maxVel: 0.8, passing: false, noAvoid: false };
    const ros = this.ros;
    const paramInfo = `vel=${p.maxVel}, passing=${p.passing}, noAvoid=${p.noAvoid}`;

    // In test mode, simulate navigation
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      App.toast(`[Test] Nav Goal: X=${x.toFixed(2)}, Y=${y.toFixed(2)}, Yaw=${(yawRad * 180 / Math.PI).toFixed(1)}° (${paramInfo})`, 'success');
      TestMode.navigateTo(x, y, yawRad);
      if (typeof App !== 'undefined' && App.eventLog) {
        App.eventLog.add('info', `Nav Goal sent: (${x.toFixed(2)}, ${y.toFixed(2)})`, 'nav');
      }
      return;
    }

    if (!ros) {
      App.toast('ROS is not connected', 'error');
      return;
    }

    const goalTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/move_base_simple/goal',
      messageType: 'geometry_msgs/PoseStamped'
    });

    // Convert yaw to quaternion
    const qz = Math.sin(yawRad / 2);
    const qw = Math.cos(yawRad / 2);

    const goalMsg = new ROSLIB.Message({
      header: { frame_id: 'map', stamp: { secs: 0, nsecs: 0 } },
      pose: {
        position: { x: x, y: y, z: 0 },
        orientation: { x: 0, y: 0, z: qz, w: qw }
      }
    });

    goalTopic.publish(goalMsg);
    App.toast(`Nav Goal sent: X=${x.toFixed(2)}, Y=${y.toFixed(2)}, Yaw=${(yawRad * 180 / Math.PI).toFixed(1)}° (${paramInfo})`, 'success');
    if (typeof App !== 'undefined' && App.eventLog) {
      App.eventLog.add('info', `Nav Goal: (${x.toFixed(2)}, ${y.toFixed(2)}) ${paramInfo}`, 'nav');
    }
  },

  // Call COV Reposition service
  callCovReposition() {
    const slotIndex = App.activeSlotIndex;
    const ros = this.getRos(slotIndex);
    const rid = this.getRobotId(slotIndex);

    if (!ros || !rid) {
      App.toast('Robot not connected', 'error');
      return;
    }

    const serviceName = `/${rid}/cov_reposition`;
    const service = new ROSLIB.Service({
      ros: ros,
      name: serviceName,
      serviceType: 'std_srvs/Empty'
    });

    App.toast('Requesting COV Reposition...', 'info');

    service.callService(new ROSLIB.ServiceRequest({}), (result) => {
      console.log(`[COV] ${serviceName} success:`, result);
      App.toast('COV Reposition complete', 'success');
    }, (error) => {
      console.error(`[COV] ${serviceName} error:`, error);
      App.toast(`COV Reposition failed: ${error}`, 'error');
    });
  },



  _publishInitialPoseValues(x, y, yawRad) {
    const slotIndex = App.activeSlotIndex;
    const ros = this.getRos(slotIndex);
    if (!ros) {
      App.toast('ROS not connected', 'error');
      return;
    }

    // In test mode, set estimate offset (don't teleport the robot)
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      TestMode._poseEstOffset = {
        x: x - TestMode._pose.x,
        y: y - TestMode._pose.y,
        yaw: yawRad - TestMode._pose.yaw
      };
      TestMode._stopNavigation();
    }

    const rid = this.getRobotId(slotIndex);
    const qz = Math.sin(yawRad / 2);
    const qw = Math.cos(yawRad / 2);
    const yawDeg = (yawRad * 180 / Math.PI).toFixed(1);

    const topic = new ROSLIB.Topic({
      ros: ros,
      name: `/${rid}/initialpose`,
      messageType: 'geometry_msgs/PoseWithCovarianceStamped'
    });

    const msg = new ROSLIB.Message({
      header: {
        frame_id: 'map',
        stamp: { secs: 0, nsecs: 0 }
      },
      pose: {
        pose: {
          position: { x: x, y: y, z: 0.0 },
          orientation: { x: 0, y: 0, z: qz, w: qw }
        },
        covariance: [
          0.25, 0, 0, 0, 0, 0,
          0, 0.25, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0.07
        ]
      }
    });

    topic.publish(msg);
    App.toast(`Initial pose: X=${x.toFixed(2)}, Y=${y.toFixed(2)}, Yaw=${yawDeg}°`, 'success');
    App.addEvent('map', 'Initial pose set', `X=${x.toFixed(2)}, Y=${y.toFixed(2)}, Yaw=${yawDeg}°`, 'info');
    console.log(`[RosManager] Published initialpose: X=${x.toFixed(3)}, Y=${y.toFixed(3)}, Yaw=${yawDeg}°`);
  },

  // Handle BMS data (active slot UI update)
  handleBmsData(msg) {
    const data = msg.data;

    document.getElementById('bms-content').textContent = JSON.stringify(data, null, 2);

    const soc = data.length > 2 ? data[2] : 0;
    const current = data.length > 1 ? data[1] : 0;
    const isCharging = current > this._bmsChargingCurrentThreshold;

    const gauge = document.getElementById('bms-gauge-fill').parentElement;
    const gaugeFill = document.getElementById('bms-gauge-fill');
    const gaugeText = document.getElementById('bms-gauge-text');

    if (gaugeFill && gaugeText) {
      const percentage = Math.min(100, Math.max(0, soc));
      gaugeFill.style.width = `${percentage}%`;
      gaugeText.textContent = `${percentage.toFixed(0)}%`;

      gaugeFill.classList.remove('low', 'medium');
      if (percentage <= 20) {
        gaugeFill.classList.add('low');
      } else if (percentage <= 50) {
        gaugeFill.classList.add('medium');
      }
    }

    if (gauge) {
      if (isCharging) {
        gauge.classList.add('charging');
      } else {
        gauge.classList.remove('charging');
      }
    }

    // SOC history ring buffer for charge/discharge rate estimation
    const now = Date.now();
    if (isCharging && soc > 0) {
      if (this._bmsChargeStartTime === null) {
        this._bmsChargeStartTime = now;
        this._bmsSocHistory = [];
      }
      this._bmsSocHistory.push({ soc, time: now });
      if (this._bmsSocHistory.length > this._bmsSocHistoryMax) {
        this._bmsSocHistory.shift();
      }
      // Reset discharge tracking when charging starts
      this._bmsDischargeStartTime = null;
      this._bmsDischargeHistory = [];
    } else if (!isCharging && soc > 0) {
      // Discharging - track SOC decrease
      if (this._bmsDischargeStartTime === null) {
        this._bmsDischargeStartTime = now;
        this._bmsDischargeHistory = [];
      }
      this._bmsDischargeHistory.push({ soc, time: now });
      if (this._bmsDischargeHistory.length > this._bmsDischargeHistoryMax) {
        this._bmsDischargeHistory.shift();
      }
      // Reset charge tracking
      this._bmsChargeStartTime = null;
      this._bmsSocHistory = [];
    }

    // Start/stop 30s ETA refresh timer (active for both charging and discharging)
    if (!this._bmsEtaTimer) {
      this._bmsEtaTimer = setInterval(() => this._refreshBmsEtaDisplay(), 30000);
    }

    this._bmsLastSoc = soc;
    this._bmsIsCharging = isCharging;
    this._bmsCurrentA = Number.isFinite(current) ? current : 0;
    this._bmsCurrentAh = data.length >= 6 && Number.isFinite(Number(data[4])) ? Number(data[4]) : null;
    this._bmsTotalAh = data.length >= 6 && Number.isFinite(Number(data[5])) ? Number(data[5]) : null;

    // Update detail modal values
    if (document.getElementById('bms-voltage')) {
      document.getElementById('bms-voltage').textContent = data.length > 0 ? `${data[0].toFixed(1)} V` : '--';
    }
    if (document.getElementById('bms-current')) {
      const currentText = data.length > 1 ? `${data[1].toFixed(2)} A` : '--';
      document.getElementById('bms-current').textContent = isCharging ? currentText + ' (charging)' : currentText;
    }
    if (document.getElementById('bms-soc')) {
      document.getElementById('bms-soc').textContent = data.length > 2 ? `${data[2].toFixed(1)} %` : '--';
    }

    this._refreshBmsEtaDisplay();
  },

  // Compute SOC rate from history using linear regression (least squares)
  // Returns %/sec (positive = charging, negative = discharging)
  _computeSocRate(history) {
    const h = history || this._bmsSocHistory;
    if (!h || h.length < this._bmsMinSamples) return null;

    const n = h.length;
    const t0 = h[0].time;

    // Linear regression: soc = a + b * t  (t in seconds relative to first sample)
    let sumT = 0, sumSoc = 0, sumTT = 0, sumTSoc = 0;
    for (let i = 0; i < n; i++) {
      const t = (h[i].time - t0) / 1000;
      const s = h[i].soc;
      sumT += t;
      sumSoc += s;
      sumTT += t * t;
      sumTSoc += t * s;
    }

    const denom = n * sumTT - sumT * sumT;
    if (Math.abs(denom) < 1e-9) return null;

    // slope = %/sec
    const slope = (n * sumTSoc - sumT * sumSoc) / denom;
    return slope;
  },

  _refreshBmsEtaDisplay() {
    const soc = this._bmsLastSoc;
    const isCharging = this._bmsIsCharging;
    const targetSoc = this._bmsTargetSoc;
    const now = Date.now();
    const currentA = this._bmsCurrentA;
    const currentAh = this._bmsCurrentAh;
    const totalAh = this._bmsTotalAh;
    const hasCapacityData = Number.isFinite(currentAh) && Number.isFinite(totalAh) && totalAh > 0 && currentAh >= 0;

    // --- Charge ETA ---
    let fullEtaText = '--';
    let targetEtaText = '--';
    const chargeElapsedMs = this._bmsChargeStartTime ? now - this._bmsChargeStartTime : 0;
    const chargeRate = this._computeSocRate(this._bmsSocHistory);
    const directChargeReady = isCharging && hasCapacityData && currentA > 0.01;
    const trendChargeReady = isCharging && chargeRate !== null && chargeRate > 0 && chargeElapsedMs >= this._bmsMinWarmupMs;
    const chargeWarmupReady = directChargeReady || trendChargeReady;
    const chargeWarmingUp = isCharging && !chargeWarmupReady;

    if (directChargeReady) {
      const remainToFullAh = Math.max(0, totalAh - currentAh);
      const targetAh = totalAh * (targetSoc / 100);
      const remainToTargetAh = Math.max(0, targetAh - currentAh);
      fullEtaText = remainToFullAh > 0
        ? this._formatDuration((remainToFullAh / currentA) * 3600)
        : '완충됨';
      targetEtaText = remainToTargetAh > 0
        ? this._formatDuration((remainToTargetAh / currentA) * 3600)
        : '도달';
    } else if (trendChargeReady) {
      const remainToFull = 100 - soc;
      const remainToTarget = targetSoc - soc;

      if (remainToFull > 0) {
        const secToFull = remainToFull / chargeRate;
        fullEtaText = this._formatDuration(secToFull);
      } else {
        fullEtaText = '완충됨';
      }
      if (remainToTarget > 0) {
        const secToTarget = remainToTarget / chargeRate;
        targetEtaText = this._formatDuration(secToTarget);
      } else {
        targetEtaText = '도달';
      }
    } else if (chargeWarmingUp) {
      const remainSec = Math.max(0, (this._bmsMinWarmupMs - chargeElapsedMs) / 1000);
      fullEtaText = `계산 중 (${Math.ceil(remainSec)}초)`;
      targetEtaText = '계산 중';
    }

    const fullEtaEl = document.getElementById('bms-charge-full-eta');
    const targetEtaEl = document.getElementById('bms-charge-target-eta');
    const chargeSection = document.getElementById('bms-charge-section');
    if (chargeSection) {
      chargeSection.style.display = isCharging ? 'block' : 'none';
    }
    if (fullEtaEl) {
      fullEtaEl.textContent = fullEtaText;
      fullEtaEl.classList.toggle('calculating', chargeWarmingUp);
    }
    if (targetEtaEl) {
      targetEtaEl.textContent = `To ${targetSoc}%: ${targetEtaText}`;
      targetEtaEl.classList.toggle('calculating', chargeWarmingUp);
    }

    // --- Discharge / Usage Time ETA ---
    let usageTimeText = '--';
    const dischargeElapsedMs = this._bmsDischargeStartTime ? now - this._bmsDischargeStartTime : 0;
    const dischargeRate = this._computeSocRate(this._bmsDischargeHistory);
    // dischargeRate is negative when discharging
    const directDischargeReady = !isCharging && hasCapacityData && currentAh > 0 && currentA < -0.01;
    const trendDischargeReady = !isCharging && dischargeRate !== null && dischargeRate < 0 && dischargeElapsedMs >= this._bmsMinWarmupMs;
    const dischargeWarmupReady = directDischargeReady || trendDischargeReady;
    const dischargeWarmingUp = !isCharging && !dischargeWarmupReady && this._bmsDischargeStartTime !== null;

    if (directDischargeReady) {
      usageTimeText = this._formatDuration((currentAh / Math.abs(currentA)) * 3600);
    } else if (trendDischargeReady) {
      const drainRatePerSec = Math.abs(dischargeRate); // %/sec positive
      if (soc > 0 && drainRatePerSec > 0) {
        const secToEmpty = soc / drainRatePerSec;
        usageTimeText = this._formatDuration(secToEmpty);
      } else {
        usageTimeText = '--';
      }
    } else if (dischargeWarmingUp) {
      const remainSec = Math.max(0, (this._bmsMinWarmupMs - dischargeElapsedMs) / 1000);
      usageTimeText = `계산 중 (${Math.ceil(remainSec)}초)`;
    }

    const usageSection = document.getElementById('bms-usage-section');
    const usageEtaEl = document.getElementById('bms-usage-time-eta');
    if (usageSection) {
      usageSection.style.display = !isCharging ? 'block' : 'none';
    }
    if (usageEtaEl) {
      usageEtaEl.textContent = usageTimeText;
      usageEtaEl.classList.toggle('calculating', dischargeWarmingUp);
    }

    // Compact estimate shown beside the header battery gauge.
    const summaryEl = document.getElementById('bms-time-estimate');
    if (summaryEl) {
      summaryEl.classList.toggle('charging', isCharging);
      summaryEl.classList.toggle('discharging', !isCharging);

      if (!soc || soc <= 0) {
        summaryEl.textContent = '예측 대기';
        summaryEl.title = '유효한 SOC 데이터 대기 중';
      } else if (isCharging && chargeWarmupReady) {
        summaryEl.textContent = fullEtaText === '완충됨' ? '완충됨' : `완충 ${fullEtaText}`;
        summaryEl.title = `${directChargeReady ? 'BMS 용량/전류' : 'SOC 변화율'} 기준 완충 예상 시간: ${fullEtaText}`;
      } else if (isCharging) {
        summaryEl.textContent = '완충 계산 중';
        summaryEl.title = '충전 속도 계산을 위해 배터리 데이터를 수집 중입니다';
      } else if (dischargeWarmupReady) {
        summaryEl.textContent = `사용 가능 ${usageTimeText}`;
        summaryEl.title = `${directDischargeReady ? 'BMS 용량/전류' : 'SOC 변화율'} 기준 사용 가능 예상 시간: ${usageTimeText}`;
      } else {
        summaryEl.textContent = '사용시간 계산 중';
        summaryEl.title = '방전 속도 계산을 위해 배터리 데이터를 수집 중입니다';
      }
    }

    // Update header gauge with charging ETA or usage time summary
    const chargingIcon = document.getElementById('bms-charging-icon');
    if (chargingIcon) {
      if (isCharging && chargeWarmupReady && fullEtaText !== '--' && fullEtaText !== '완충됨') {
        chargingIcon.textContent = '⚡';
        chargingIcon.title = `완충 예상: ${fullEtaText}`;
      } else if (isCharging) {
        chargingIcon.textContent = '⚡';
        chargingIcon.title = '충전 중';
      }
    }
  },

  _formatDuration(totalSec) {
    if (!isFinite(totalSec) || totalSec < 0) return '--';
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분`;
    return '1분 미만';
  },

  // Work state handling
  WORK_STATE_LABELS: {
    '-1': 'NOT RUNNING',
    '0': 'IDLE',
    '1': 'WORK',
    '2': 'DOCK',
    '3': 'PAUSE',
    '4': 'CANCEL',
    '5': 'ABORT',
    '7': 'STAND BY',
    '8': 'DOCK OUT',
    '9': 'FOLLOW ME',
    '10': 'MAPPING'
  },
  WORK_STATE_COLORS: [
    { value: '#ef4444', label: 'Red' },
    { value: '#f97316', label: 'Orange' },
    { value: '#eab308', label: 'Yellow' },
    { value: '#22c55e', label: 'Green' },
    { value: '#3b82f6', label: 'Blue' },
    { value: '#4f46e5', label: 'Indigo' },
    { value: '#a855f7', label: 'Purple' },
    { value: '#111111', label: 'Black' },
    { value: '#9ca3af', label: 'Gray' },
    { value: '#f5f5f5', label: 'White' }
  ],
  _workStateColorMap: {},
  _workStateStorageKey: 'workStateColorMap',

  initWorkStateConfig() {
    try {
      const saved = localStorage.getItem(this._workStateStorageKey);
      if (saved) {
        this._workStateColorMap = JSON.parse(saved);
      }
    } catch (e) {
      this._workStateColorMap = {};
    }
  },

  saveWorkStateConfig() {
    // B13 fix: localStorage 예외처리
    try { localStorage.setItem(this._workStateStorageKey, JSON.stringify(this._workStateColorMap)); }
    catch (e) { console.warn('[RosManager] Failed to save work state config:', e.message); }
  },

  handleWorkState(msg) {
    const state = msg.workstate !== undefined ? msg.workstate : (msg.data !== undefined ? msg.data : msg);
    this.displayWorkState(state);
  },

  // ===== SLAM / Lifelong / Save Map =====
  _slamRunning: false,
  _lifelongRunning: false,
  _modeManualSet: false,  // True if mode was manually set by user (disable auto-detection)
  _currentRoutineMode: 'NAV',  // Current routine mode from robot
  _tfTopic: null,            // TF subscription for SLAM mode (global /tf)
  _tfTopicNamespaced: null,  // TF subscription for namespaced /${rid}/tf
  _tfMapToOdom: null,        // Cached map->odom transform
  _tfOdomToBase: null,       // Cached odom->base_link transform
  _odomTopic: null,          // Odom subscription for SLAM fallback
  _lastTfPoseTime: 0,        // Timestamp when TF last updated pose (ms)
  _tfReceived: false,        // Whether valid TF has been received

  setupMappingControls() {
    // SLAM
    document.getElementById('btn-slam-start').addEventListener('click', () => this._startSlam());
    document.getElementById('btn-slam-stop').addEventListener('click', () => this._stopSlam());
    // Lifelong
    document.getElementById('btn-lifelong-start').addEventListener('click', () => this._startLifelong());
    document.getElementById('btn-lifelong-stop').addEventListener('click', () => this._stopLifelong());
    // Save Map
    document.getElementById('btn-save-map').addEventListener('click', () => this._saveMap());
  },

  _callMappingService(serviceName, serviceType, args, statusEl, successMsg, errorMsg, callback) {
    const slotIndex = App.activeSlotIndex;
    const ros = this.getRos(slotIndex);
    const rid = this.getRobotId(slotIndex);
    if (!ros || !rid) {
      if (statusEl) statusEl.textContent = 'Not connected';
      App.toast('Robot not connected', 'error');
      return;
    }

    const fullName = `/${rid}${serviceName}`;

    // Test mode: simulate service response (custom msg types not available in test rosbridge)
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      if (statusEl) {
        statusEl.textContent = 'Calling...';
        statusEl.style.color = '#f0ad4e';
      }
      setTimeout(() => {
        console.log(`[Mapping][TestMode] Simulated ${fullName} with args:`, args);
        if (statusEl) {
          statusEl.textContent = successMsg + ' (test)';
          statusEl.style.color = '#4ade80';
        }
        App.toast(`${fullName}: ${successMsg} (test mode)`, 'success');
        if (callback) callback(true, { success: true, message: 'test mode simulated' });
      }, 500);
      return;
    }

    if (statusEl) {
      statusEl.textContent = 'Calling...';
      statusEl.style.color = '#f0ad4e';
    }

    const service = new ROSLIB.Service({
      ros: ros,
      name: fullName,
      serviceType: serviceType
    });

    const request = new ROSLIB.ServiceRequest(args || {});
    service.callService(request, (result) => {
      console.log(`[Mapping] ${fullName} result:`, result);
      if (statusEl) {
        statusEl.textContent = successMsg;
        statusEl.style.color = '#4ade80';
      }
      App.toast(`${fullName}: ${successMsg}`, 'success');
      if (callback) callback(true, result);
    }, (error) => {
      console.error(`[Mapping] ${fullName} error:`, error);
      if (statusEl) {
        statusEl.textContent = errorMsg;
        statusEl.style.color = '#ff6b6b';
      }
      App.toast(`${fullName}: ${error}`, 'error');
      if (callback) callback(false, error);
    });
  },

  _updateSlamButtons() {
    document.getElementById('btn-slam-start').disabled = this._slamRunning;
    document.getElementById('btn-slam-stop').disabled = !this._slamRunning;
    const status = document.getElementById('slam-status');
    if (this._slamRunning) {
      status.textContent = 'Running';
      status.style.color = '#4ade80';
    } else {
      status.textContent = 'Off';
      status.style.color = '';
    }
  },

  _updateLifelongButtons() {
    document.getElementById('btn-lifelong-start').disabled = this._lifelongRunning;
    document.getElementById('btn-lifelong-stop').disabled = !this._lifelongRunning;
    const status = document.getElementById('lifelong-status');
    if (this._lifelongRunning) {
      status.textContent = 'Running';
      status.style.color = '#4ade80';
    } else {
      status.textContent = 'Off';
      status.style.color = '';
    }
  },

  _publishRoutineMode(mode, statusEl, successMsg, callback) {
    const slotIndex = App.activeSlotIndex;
    const ros = this.getRos(slotIndex);
    const rid = this.getRobotId(slotIndex);
    if (!ros || !rid) {
      if (statusEl) statusEl.textContent = 'Not connected';
      App.toast('Robot not connected', 'error');
      return;
    }

    const topicName = `/${rid}/sp_routine`;
    if (statusEl) {
      statusEl.textContent = 'Publishing...';
      statusEl.style.color = '#f0ad4e';
    }

    const topic = new ROSLIB.Topic({
      ros: ros,
      name: topicName,
      messageType: 'std_msgs/String'
    });

    const msg = new ROSLIB.Message({ data: mode });
    topic.publish(msg);
    console.log(`[Mapping] Published ${topicName}: "${mode}"`);

    if (statusEl) {
      statusEl.textContent = successMsg;
      statusEl.style.color = '#4ade80';
    }
    App.toast(`${topicName}: ${mode}`, 'success');
    if (callback) callback(true);
  },

  // Backup of lastMapMsg before SLAM/Lifelong, so edits survive the round-trip
  _preMapModeBackup: null,

  _startSlam() {
    if (this._lifelongRunning) {
      App.toast('Stop Lifelong first before starting SLAM', 'error');
      return;
    }
    // Auto-exit map edit mode (keep changes — don't discard edits)
    if (this._mapEditMode) {
      this._exitMapEditMode(false, true);
    }
    // Backup current map (including unsaved edits) before SLAM overwrites it
    this._preMapModeBackup = this.lastMapMsg ? {
      info: this.lastMapMsg.info,
      data: new Int8Array(this.lastMapMsg.data)
    } : null;
    this._mapLocked = false; // Unlock so SLAM map can render
    const statusEl = document.getElementById('slam-status');
    this._publishRoutineMode('SLAM', statusEl, 'Running', (ok) => {
      if (ok) {
        this._slamRunning = true;
        this._modeManualSet = true;  // Disable auto mode detection
        this._updateSlamButtons();
        this._subscribeSlamPose();
        // Clear map cache for fresh SLAM map
        this._mapImageCanvas = null;
        this._startSlamTrail();
      }
    });
  },

  _stopSlam() {
    const statusEl = document.getElementById('slam-status');
    this._publishRoutineMode('NAV', statusEl, 'Off', (ok) => {
      if (ok) {
        this._slamRunning = false;
        this._modeManualSet = false;  // Re-enable auto mode detection
        this._updateSlamButtons();
        this._unsubscribeSlamPose();
        this._stopSlamTrail();
        this._killSlamToolbox();
        this._restorePreMapModeBackup();
      }
    });
  },

  // SLAM pose: reuse slot TF subscription (no duplicate /tf subscribe)
  _subscribeSlamPose() {
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots[slotIndex];
    if (!slot) return;

    // Slot TF is already subscribed via _subscribeSlotTf(), just ensure it's active
    if (!slot.tfTopic) {
      this._subscribeSlotTf(slotIndex);
    }

    console.log('[SLAM] Using slot TF for pose (no duplicate subscription)');

    // Enable follow robot mode during SLAM for better UX
    this._followRobot = true;
    const btnFollow = document.getElementById('btn-follow-robot');
    if (btnFollow) btnFollow.classList.add('active');
  },

  // ── SLAM Trail Recording ──

  _startSlamTrail() {
    this._breadcrumbTrail = [];
    this._slamVertices = [];
    this._slamStartPose = this.robotPose ? { ...this.robotPose } : null;
    this._slamLastVertexDist = 0;

    // Record trail at 5Hz (200ms)
    if (this._slamTrailTimer) clearInterval(this._slamTrailTimer);
    this._slamTrailTimer = setInterval(() => this._recordSlamTrailPoint(), 200);
    console.log('[SLAM Trail] Started recording');
  },

  _stopSlamTrail() {
    if (this._slamTrailTimer) {
      clearInterval(this._slamTrailTimer);
      this._slamTrailTimer = null;
    }
    // Keep trail data for user to review — only clear on next SLAM start
    console.log(`[SLAM Trail] Stopped. ${this._breadcrumbTrail.length} points, ${this._slamVertices.length} vertices`);
  },

  _recordSlamTrailPoint() {
    if (!this.robotPose) return;
    const p = this.robotPose;
    const trail = this._breadcrumbTrail;

    // Check minimum distance from last point
    if (trail.length > 0) {
      const last = trail[trail.length - 1];
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this._breadcrumbMinDist) return; // Too close, skip

      // Accumulate distance for vertex placement
      this._slamLastVertexDist = (this._slamLastVertexDist || 0) + dist;
    }

    // Record trail point
    const point = { x: p.x, y: p.y, yaw: p.yaw, time: Date.now() };
    trail.push(point);

    // Cap trail size
    if (trail.length > this._breadcrumbMaxPoints) {
      trail.splice(0, trail.length - this._breadcrumbMaxPoints);
    }

    // Record vertex at intervals
    if (!this._slamStartPose && trail.length === 1) {
      this._slamStartPose = { ...point };
    }
    if (this._slamLastVertexDist >= this._slamVertexInterval) {
      this._slamLastVertexDist = 0;
      this._slamVertices.push({
        x: point.x, y: point.y, yaw: point.yaw,
        idx: this._slamVertices.length,
        time: point.time
      });
    }
  },

  // ── SLAM Trail Rendering (called from _doRenderMap) ──

  _renderSlamTrail(ctx, width, height, resolution, origin) {
    const trail = this._breadcrumbTrail;
    if (!trail || trail.length < 2) return;
    if (!this._slamRunning && !this._lifelongRunning && trail.length === 0) return;

    const toMapPx = (pt) => ({
      x: (pt.x - origin.position.x) / resolution - width / 2,
      y: height - (pt.y - origin.position.y) / resolution - height / 2
    });

    const lw = Math.max(1, 1.5 / this.mapZoom);

    // ── Draw trail path with gradient (blue → red) ──
    for (let i = 1; i < trail.length; i++) {
      const p0 = toMapPx(trail[i - 1]);
      const p1 = toMapPx(trail[i]);
      const t = i / trail.length; // 0 = oldest, 1 = newest

      // Blue(0) → Cyan(0.33) → Yellow(0.66) → Red(1)
      let r, g, b;
      if (t < 0.33) {
        const s = t / 0.33;
        r = 0; g = Math.round(s * 255); b = Math.round((1 - s) * 255);
      } else if (t < 0.66) {
        const s = (t - 0.33) / 0.33;
        r = Math.round(s * 255); g = 255; b = 0;
      } else {
        const s = (t - 0.66) / 0.34;
        r = 255; g = Math.round((1 - s) * 255); b = 0;
      }

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`;
      ctx.lineWidth = lw * 2;
      ctx.stroke();
    }

    // ── Draw vertices ──
    const fontSize = Math.max(7, 4 / this.mapZoom);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';

    for (const v of this._slamVertices) {
      const vp = toMapPx(v);
      const dotR = lw * 2.5;

      // Vertex dot
      ctx.beginPath();
      ctx.arc(vp.x, vp.y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = lw * 0.5;
      ctx.stroke();

      // Direction tick
      const tickLen = dotR * 2;
      ctx.beginPath();
      ctx.moveTo(vp.x, vp.y);
      ctx.lineTo(vp.x + Math.cos(-v.yaw) * tickLen, vp.y + Math.sin(-v.yaw) * tickLen);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = lw;
      ctx.stroke();

      // Vertex number (every 5th vertex to avoid clutter)
      if (v.idx % 5 === 0) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = lw * 0.5;
        ctx.strokeText(String(v.idx), vp.x, vp.y - dotR - 2);
        ctx.fillText(String(v.idx), vp.x, vp.y - dotR - 2);
      }
    }

    // ── Start marker ──
    if (this._slamStartPose) {
      const sp = toMapPx(this._slamStartPose);
      const sr = lw * 4;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 200, 0, 0.6)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = lw * 0.5;
      ctx.strokeText('S', sp.x, sp.y - sr - 2);
      ctx.fillText('S', sp.x, sp.y - sr - 2);
    }

    // ── Loop closure hint ──
    if (this._slamStartPose && this.robotPose && trail.length > 20) {
      const dx = this.robotPose.x - this._slamStartPose.x;
      const dy = this.robotPose.y - this._slamStartPose.y;
      const distToStart = Math.sqrt(dx * dx + dy * dy);

      if (distToStart < this._slamLoopClosureRadius && distToStart > 0.5) {
        // Draw dashed line from robot to start
        const rp = toMapPx(this.robotPose);
        const sp = toMapPx(this._slamStartPose);

        ctx.save();
        ctx.setLineDash([lw * 3, lw * 3]);
        ctx.beginPath();
        ctx.moveTo(rp.x, rp.y);
        ctx.lineTo(sp.x, sp.y);
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = lw * 2;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // "Loop" label at midpoint
        const mx = (rp.x + sp.x) / 2;
        const my = (rp.y + sp.y) / 2;
        const loopFontSize = Math.max(9, 6 / this.mapZoom);
        ctx.font = `bold ${loopFontSize}px sans-serif`;
        ctx.fillStyle = '#00ff88';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = lw;
        ctx.strokeText('LOOP', mx, my - 4);
        ctx.fillText('LOOP', mx, my - 4);
      }

      // Also check proximity to ANY earlier trail segment (not just start)
      // Highlight if current position is near a previously visited area
      if (distToStart >= this._slamLoopClosureRadius) {
        const rp = this.robotPose;
        const checkInterval = Math.max(1, Math.floor(trail.length / 100)); // Sample ~100 points
        for (let i = 0; i < trail.length - 30; i += checkInterval) {
          const t = trail[i];
          const tdx = rp.x - t.x;
          const tdy = rp.y - t.y;
          const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
          if (tdist < this._slamLoopClosureRadius && tdist > 0.5) {
            const tp = toMapPx(t);
            const rpPx = toMapPx(rp);

            ctx.save();
            ctx.setLineDash([lw * 2, lw * 2]);
            ctx.beginPath();
            ctx.moveTo(rpPx.x, rpPx.y);
            ctx.lineTo(tp.x, tp.y);
            ctx.strokeStyle = 'rgba(0, 255, 136, 0.4)';
            ctx.lineWidth = lw * 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
            break; // Only show nearest hint
          }
        }
      }
    }
  },

  // Combine two transforms: parent * child
  _combineTf(parent, child) {
    const p = parent.translation;
    const pq = parent.rotation;
    const c = child.translation;
    const cq = child.rotation;

    // Rotate child translation by parent quaternion
    const px = pq.x, py = pq.y, pz = pq.z, pw = pq.w;
    const cx = c.x, cy = c.y, cz = c.z;

    // Quaternion rotation: q * v * q^-1
    const rx = pw*pw*cx + 2*py*pw*cz - 2*pz*pw*cy + px*px*cx + 2*py*px*cy + 2*pz*px*cz - pz*pz*cx - py*py*cx;
    const ry = 2*px*py*cx + py*py*cy + 2*pz*py*cz + 2*pw*pz*cx - pz*pz*cy + pw*pw*cy - 2*px*pw*cz - px*px*cy;

    // Combined translation
    const tx = p.x + rx;
    const ty = p.y + ry;

    // Quaternion multiplication for rotation
    const qw = pw*cq.w - px*cq.x - py*cq.y - pz*cq.z;
    const qx = pw*cq.x + px*cq.w + py*cq.z - pz*cq.y;
    const qy = pw*cq.y - px*cq.z + py*cq.w + pz*cq.x;
    const qz = pw*cq.z + px*cq.y - py*cq.x + pz*cq.w;

    return {
      translation: { x: tx, y: ty, z: 0 },
      rotation: { x: qx, y: qy, z: qz, w: qw }
    };
  },

  _unsubscribeSlamPose() {
    // Slot TF subscription is managed by _subscribeSlotTf, don't touch it here
    console.log('[SLAM] Pose cleanup (slot TF remains active)');
  },

  // Re-subscribe to map topic to get the latched NAV map from map_server
  // Needed after SLAM/Lifelong stop because lastMapMsg holds the stale SLAM map
  // Also unlocks map so incoming messages are accepted
  _resubscribeMapTopic() {
    this._mapLocked = false;
    const slotIndex = App.activeSlotIndex;
    const slot = App.robotSlots[slotIndex];
    if (!slot || !slot.ros) return;
    const rid = slot.robotId;

    // Unsubscribe existing map topic
    if (slot.subscriptions && slot.subscriptions['map']) {
      slot.subscriptions['map'].unsubscribe();
      delete slot.subscriptions['map'];
    }

    // Clear cached map so we see the fresh one
    this.lastMapMsg = null;
    this._mapImageCanvas = null;

    // Re-subscribe — this will get the latched message from map_server
    const chkMap = document.getElementById('chk-map');
    if (chkMap && chkMap.checked) {
      const capturedIndex = slotIndex;
      this._subscribeSlotTopic(slotIndex, 'map', `/${rid}/map`, 'nav_msgs/OccupancyGrid', (msg) => {
        if (capturedIndex !== App.activeSlotIndex) return;
        this.renderMap(msg);
      });
      console.log('[Map] Re-subscribed to map topic');
    }
  },

  // Kill slam_toolbox node to stop it from publishing stale map data.
  // Tries both namespaced (/${rid}/slam_toolbox) and global (/slam_toolbox).
  async _killSlamToolbox() {
    const slotIndex = App.activeSlotIndex;
    const rid = this.getRobotId(slotIndex);
    const slot = App.robotSlots[slotIndex];
    if (!slot?.ip || !rid) return;

    const setupCmd = '. /opt/ros/noetic/setup.bash 2>/dev/null; . ~/catkin_ws/devel/setup.bash 2>/dev/null';
    try {
      // Try namespaced first, then global
      const r1 = await this._mapExec(`${setupCmd}; rosnode kill /${rid}/slam_toolbox 2>/dev/null || rosnode kill /slam_toolbox 2>/dev/null || true`);
      console.log('[SLAM] slam_toolbox kill result:', r1.success ? 'ok' : (r1.error || 'unknown'));
    } catch (err) {
      console.warn('[SLAM] slam_toolbox kill error:', err);
    }
  },

  // Restore pre-SLAM/Lifelong map backup.
  // Locks renderMap() to prevent map_server's stale latched message from
  // overwriting the restored map. map_server keeps old map in memory even
  // if the .pgm on disk was updated, until map_server is restarted.
  // Lock is released when: user toggles map checkbox, loadMap, or SLAM/Lifelong start.
  _restorePreMapModeBackup() {
    if (this._preMapModeBackup) {
      this._mapLocked = true;
      this.lastMapMsg = {
        info: this._preMapModeBackup.info,
        data: this._preMapModeBackup.data
      };
      this._mapImageCanvas = null;
      this._preMapModeBackup = null;
      this.requestRender();
      console.log('[Map] Restored pre-SLAM/Lifelong map backup (map locked)');
    } else {
      this._mapLocked = false;
      this.lastMapMsg = null;
      this._mapImageCanvas = null;
      this._resubscribeMapTopic();
    }
  },


  _startLifelong() {
    if (this._slamRunning) {
      App.toast('Stop SLAM first before starting Lifelong', 'error');
      return;
    }
    // Auto-exit map edit mode (keep changes — don't discard edits)
    if (this._mapEditMode) {
      this._exitMapEditMode(false, true);
    }
    // Backup current map (including unsaved edits) before Lifelong overwrites it
    this._preMapModeBackup = this.lastMapMsg ? {
      info: this.lastMapMsg.info,
      data: new Int8Array(this.lastMapMsg.data)
    } : null;
    this._mapLocked = false; // Unlock so Lifelong map can render
    const statusEl = document.getElementById('lifelong-status');
    this._publishRoutineMode('LIFELONG', statusEl, 'Running', (ok) => {
      if (ok) {
        this._lifelongRunning = true;
        this._modeManualSet = true;  // Disable auto mode detection
        this._updateLifelongButtons();
        this._subscribeSlamPose();
        // Clear map cache for fresh mapping
        this._mapImageCanvas = null;
        this._startSlamTrail();
      }
    });
  },

  _stopLifelong() {
    const statusEl = document.getElementById('lifelong-status');
    this._publishRoutineMode('NAV', statusEl, 'Off', (ok) => {
      if (ok) {
        this._lifelongRunning = false;
        this._modeManualSet = false;  // Re-enable auto mode detection
        this._updateLifelongButtons();
        this._unsubscribeSlamPose();
        this._stopSlamTrail();
        this._killSlamToolbox();
        this._restorePreMapModeBackup();
      }
    });
  },

  _saveMap() {
    const mapName = document.getElementById('save-map-name').value.trim();
    if (!mapName) {
      App.toast('Please enter map name', 'error');
      return;
    }
    const statusEl = document.getElementById('save-map-status');
    this._callMappingService(
      '/save_map', 'syscon_msgs/String_srv', { data: mapName },
      statusEl, 'Saved', 'Save failed',
      (ok, result) => {
        if (ok) {
          // Check service response for success
          if (result && result.success === false) {
            App.toast(`Map save failed: ${result.message || 'Unknown error'}`, 'error');
            if (statusEl) {
              statusEl.textContent = 'Failed';
              statusEl.style.color = '#ff6b6b';
            }
          } else {
            App.toast(`Map "${mapName}" saved`, 'success');
            if (statusEl) {
              statusEl.textContent = 'Saved';
              statusEl.style.color = '#4ade80';
            }
          }
        } else {
          App.toast(`Map save failed: ${result || 'Service call error'}`, 'error');
        }
      }
    );
  },

  // Service call (uses active slot's ROS)
  callService(name, type, args, callback) {
    const ros = this.getRos();
    if (!ros) {
      callback({ error: 'Not connected' });
      return;
    }

    const service = new ROSLIB.Service({
      ros: ros,
      name: name,
      serviceType: type
    });

    const request = new ROSLIB.ServiceRequest(args || {});

    service.callService(request, (result) => {
      callback({ success: true, result });
    }, (error) => {
      callback({ error: error });
    });
  },

  getParam(name, callback) {
    const ros = this.getRos();
    if (!ros) {
      callback({ error: 'Not connected' });
      return;
    }

    const param = new ROSLIB.Param({
      ros: ros,
      name: name
    });

    param.get((value) => {
      callback({ success: true, value });
    });
  },

  setParam(name, value, callback) {
    const ros = this.getRos();
    if (!ros) {
      callback({ error: 'Not connected' });
      return;
    }

    const param = new ROSLIB.Param({
      ros: ros,
      name: name
    });

    param.set(value, () => {
      callback({ success: true });
    });
  },

  subscribeCustomTopic(name, type, callback) {
    const ros = this.getRos();
    if (!ros) {
      return null;
    }

    const topic = new ROSLIB.Topic({
      ros: ros,
      name: name,
      messageType: type
    });

    topic.subscribe(callback);
    return topic;
  },

  // Legacy compatibility: connect() calls connectSlot(0)
  connect(ip, robotId) {
    // Add a slot if none exists, or update slot 0
    if (App.robotSlots.length === 0) {
      App.addRobotSlot(ip, robotId);
    }
    this.connectSlot(0, ip, robotId);
  },

  _tryAutoReconnect(index, ip, robotId) {
    if (!this._autoReconnect[index]) {
      this._autoReconnect[index] = { timer: null, attempt: 0, enabled: true };
    }
    const ar = this._autoReconnect[index];
    if (!ar.enabled) return;

    ar.attempt++;
    // Backoff: 3s, 5s, 10s, then stay at 10s
    const delays = [3000, 5000, 10000];
    const delay = delays[Math.min(ar.attempt - 1, delays.length - 1)];

    // Update reconnecting UI
    this._updateAutoReconnectUI(true);

    console.log(`Auto-reconnect slot[${index}] in ${delay / 1000}s (attempt #${ar.attempt})`);
    if (App.eventLog) App.eventLog.add('info', `Auto-reconnect attempt #${ar.attempt} (in ${delay / 1000}s, ${robotId})`, 'system');

    ar.timer = setTimeout(() => {
      if (!ar.enabled) return;
      // Only reconnect if still disconnected
      const slot = App.robotSlots[index];
      if (slot && !slot.connected && !slot.ros) {
        this.connectSlot(index, ip, robotId);
      }
    }, delay);

    // Stop after 10 attempts
    if (ar.attempt >= 10) {
      ar.enabled = false;
      if (App.eventLog) App.eventLog.add('error', `Auto-reconnect failed: exceeded 10 attempts (${robotId})`, 'system');
      App.toast(`Auto-reconnect failed: ${robotId} (exceeded 10 attempts)`, 'error');
    }
  },

  _clearAutoReconnect(index) {
    const ar = this._autoReconnect[index];
    if (ar) {
      if (ar.timer) clearTimeout(ar.timer);
      ar.attempt = 0;
      ar.enabled = true;
    }
    this._updateAutoReconnectUI(false);
  },

  _updateAutoReconnectUI(reconnecting) {
    const btn = document.getElementById('btn-auto-reconnect');
    if (!btn) return;
    const idx = App.activeSlotIndex >= 0 ? App.activeSlotIndex : 0;
    const ar = this._autoReconnect[idx];
    const enabled = ar ? ar.enabled : true;

    btn.classList.toggle('active', enabled);
    btn.classList.toggle('reconnecting', reconnecting && enabled);
    btn.title = `Auto Reconnect: ${enabled ? 'ON' : 'OFF'}`;
  },

  toggleAutoReconnect() {
    const idx = App.activeSlotIndex >= 0 ? App.activeSlotIndex : 0;
    if (!this._autoReconnect[idx]) {
      this._autoReconnect[idx] = { timer: null, attempt: 0, enabled: true };
    }
    const ar = this._autoReconnect[idx];
    ar.enabled = !ar.enabled;

    if (!ar.enabled && ar.timer) {
      clearTimeout(ar.timer);
      ar.timer = null;
    }

    this._updateAutoReconnectUI(false);
    App.toast(`Auto reconnect: ${ar.enabled ? 'ON' : 'OFF'}`, 'info');
  },

  setupAutoReconnectButton() {
    const btn = document.getElementById('btn-auto-reconnect');
    if (btn) {
      btn.addEventListener('click', () => this.toggleAutoReconnect());
      this._updateAutoReconnectUI(false);
    }
  },

  // ============================================
  // Custom Topic Mapping
  // ============================================
  loadTopicMappings() {
    try {
      this._topicMappings = JSON.parse(localStorage.getItem(this.TOPIC_MAPPING_KEY)) || {};
    } catch (e) {
      this._topicMappings = {};
    }
  },

  saveTopicMappings() {
    // B13 fix: localStorage 예외처리
    try { localStorage.setItem(this.TOPIC_MAPPING_KEY, JSON.stringify(this._topicMappings)); }
    catch (e) { console.warn('[RosManager] Failed to save topic mappings:', e.message); }
  },

  setTopicMapping(displayName, actualTopic) {
    if (!displayName || !actualTopic) return;
    this._topicMappings[displayName] = actualTopic;
    this.saveTopicMappings();
  },

  removeTopicMapping(displayName) {
    delete this._topicMappings[displayName];
    this.saveTopicMappings();
  },

  getTopicMappings() {
    return { ...this._topicMappings };
  },

  // Resolve display name to actual topic name
  resolveTopicName(name) {
    return this._topicMappings[name] || name;
  },

  // Show topic mapping modal
  showTopicMappingModal() {
    let modal = document.getElementById('topic-mapping-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'topic-mapping-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content topic-mapping-modal-content">
          <div class="modal-header">
            <h3>Custom Topic Mapping</h3>
            <button class="modal-close" id="btn-topic-mapping-close">&times;</button>
          </div>
          <div class="topic-mapping-body">
            <div class="topic-mapping-add">
              <input type="text" id="topic-map-display" placeholder="Display Name (alias)" class="topic-map-input">
              <input type="text" id="topic-map-actual" placeholder="Actual Topic Name" class="topic-map-input">
              <button id="btn-add-topic-mapping" class="btn btn-small btn-primary">Add</button>
            </div>
            <div id="topic-mapping-list" class="topic-mapping-list"></div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-topic-mapping-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

      modal.querySelector('#btn-add-topic-mapping').addEventListener('click', () => {
        const display = document.getElementById('topic-map-display').value.trim();
        const actual = document.getElementById('topic-map-actual').value.trim();
        if (display && actual) {
          this.setTopicMapping(display, actual);
          document.getElementById('topic-map-display').value = '';
          document.getElementById('topic-map-actual').value = '';
          this.renderTopicMappingList();
          App.toast(`Mapping added: ${display} → ${actual}`, 'success');
        }
      });
    }

    this.renderTopicMappingList();
    modal.classList.add('active');
  },

  renderTopicMappingList() {
    const list = document.getElementById('topic-mapping-list');
    if (!list) return;

    const mappings = this.getTopicMappings();
    const keys = Object.keys(mappings);

    if (keys.length === 0) {
      list.innerHTML = '<div class="topic-mapping-empty">No mappings defined</div>';
      return;
    }

    list.innerHTML = keys.map(display => {
      const actual = mappings[display];
      return `
        <div class="topic-mapping-item">
          <span class="topic-map-display">${display}</span>
          <span class="topic-map-arrow">→</span>
          <span class="topic-map-actual">${actual}</span>
          <button class="btn btn-mini btn-danger" data-remove-mapping="${display}">×</button>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-remove-mapping]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.removeMapping;
        this.removeTopicMapping(name);
        this.renderTopicMappingList();
        App.toast('Mapping removed', 'success');
      });
    });
  },

  disconnect() {
    const idx = App.activeSlotIndex >= 0 ? App.activeSlotIndex : 0;
    // Disable auto-reconnect when user manually disconnects
    if (this._autoReconnect[idx]) this._autoReconnect[idx].enabled = false;
    this.disconnectSlot(idx);
  },

  // ============================================
  // Map Edit Mode
  // ============================================
  _mapEditMode: false,
  _mapEditTool: 'obstacle',  // 'obstacle', 'free', 'unknown'
  _mapEditBrushSize: 3,      // Default brush (3 pixels - easier to draw)
  _mapEditBrushShape: 'circle', // 'circle' or 'square'
  _mapEditDrawing: false,
  _mapEditHistory: [],
  _mapEditHistoryMax: 50,
  _mapEditDirty: false,
  _mapEditOriginalData: null,
  _mapEditCursorX: 0,        // Brush cursor canvas position
  _mapEditCursorY: 0,
  _mapEditCursorInCanvas: false, // Track if cursor is inside canvas
  _mapEditLastPixelX: null,  // Last drawn pixel for interpolation
  _mapEditLastPixelY: null,
  _mapEditShiftKey: false,   // Shift key pressed for straight line
  _mapEditLineStartX: null,  // Start point for shift-line drawing
  _mapEditLineStartY: null,
  _mapEditPanning: false,    // Middle/right-click pan in edit mode
  _mapEditPanStartX: 0,
  _mapEditPanStartY: 0,
  _mapEditRotating: false,   // Right-click rotate in move tool
  _mapEditRotateStartAngle: 0, // Mouse angle at rotation start
  _mapEditRotateStartRot: 0,   // Map rotation at rotation start
  _mapEditSpaceKey: false,   // Space key for pan mode (Photoshop-style)
  _mapEditLastClickPixelX: null,  // Last click position for Shift+click line
  _mapEditLastClickPixelY: null,
  _mapEditLastClickCanvasX: null, // Canvas coords for preview line
  _mapEditLastClickCanvasY: null,
  _mapEditSelecting: false,       // Scan-fill rectangle selection active
  _mapEditSelectStartCX: 0,      // Selection start (canvas coords)
  _mapEditSelectStartCY: 0,
  _mapEditSelectEndCX: 0,        // Selection end (canvas coords)
  _mapEditSelectEndCY: 0,

  // Convert canvas coordinates to map pixel coordinates
  _canvasToMapPixel(canvasX, canvasY, canvas) {
    if (!this.lastMapMsg) return null;
    const msg = this.lastMapMsg;
    const width = msg.info.width;
    const height = msg.info.height;
    const rotation = this.mapRotation * Math.PI / 180;

    const cx = canvas.width / 2 + this.mapPanX;
    const cy = canvas.height / 2 + this.mapPanY;

    let dx = canvasX - cx;
    let dy = canvasY - cy;

    dx /= this.mapZoom;
    dy /= this.mapZoom;

    const cosR = Math.cos(-rotation);
    const sinR = Math.sin(-rotation);
    const mx = dx * cosR - dy * sinR;
    const my = dx * sinR + dy * cosR;

    const mapPixelX = Math.floor(mx + width / 2);
    const mapPixelY = Math.floor(my + height / 2);

    if (mapPixelX < 0 || mapPixelX >= width || mapPixelY < 0 || mapPixelY >= height) {
      return null;
    }

    return { x: mapPixelX, y: mapPixelY };
  },

  // Convert map pixel coordinates back to canvas coordinates
  _mapPixelToCanvas(pixelX, pixelY, canvas) {
    if (!this.lastMapMsg) return null;
    const msg = this.lastMapMsg;
    const width = msg.info.width;
    const height = msg.info.height;
    const rotation = this.mapRotation * Math.PI / 180;

    const mx = pixelX - width / 2;
    const my = pixelY - height / 2;

    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const dx = mx * cosR - my * sinR;
    const dy = mx * sinR + my * cosR;

    const cx = canvas.width / 2 + this.mapPanX;
    const cy = canvas.height / 2 + this.mapPanY;

    return {
      x: dx * this.mapZoom + cx,
      y: dy * this.mapZoom + cy
    };
  },

  // Apply brush stroke to map data at pixel position
  _applyEditBrushAt(pixelX, pixelY) {
    if (!this.lastMapMsg) return;
    const msg = this.lastMapMsg;
    const width = msg.info.width;
    const height = msg.info.height;
    const data = msg.data;
    // brushSize 1 = 1px (single pixel), 2 = 3px diameter, 3 = 5px, etc.
    const radius = this._mapEditBrushSize - 1;

    // Determine value based on tool
    let value;
    switch (this._mapEditTool) {
      case 'obstacle': value = 100; break;  // Occupied
      case 'free': value = 0; break;        // Free space
      case 'unknown': value = -1; break;    // Unknown
      default: value = 100;
    }

    if (radius <= 0) {
      // Single pixel
      if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
        const idx = (height - 1 - pixelY) * width + pixelX;
        data[idx] = value;
      }
      return;
    }

    // Apply brush based on shape
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const inBrush = this._mapEditBrushShape === 'square'
          ? true  // square: all pixels in the bounding box
          : (dx * dx + dy * dy <= radius * radius);  // circle
        if (inBrush) {
          const px = pixelX + dx;
          const py = pixelY + dy;
          if (px >= 0 && px < width && py >= 0 && py < height) {
            const idx = (height - 1 - py) * width + px;
            data[idx] = value;
          }
        }
      }
    }
  },

  // Apply brush with line interpolation for smooth strokes
  _applyEditBrush(pixelX, pixelY) {
    if (!this.lastMapMsg) return;

    // If we have a previous point, interpolate between them
    if (this._mapEditLastPixelX !== null && this._mapEditLastPixelY !== null) {
      const dx = pixelX - this._mapEditLastPixelX;
      const dy = pixelY - this._mapEditLastPixelY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Interpolate points along the line (every 0.5 pixel for smooth strokes)
      const step = 0.5;
      if (dist > step) {
        const steps = Math.ceil(dist / step);
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const px = Math.round(this._mapEditLastPixelX + dx * t);
          const py = Math.round(this._mapEditLastPixelY + dy * t);
          this._applyEditBrushAt(px, py);
        }
      } else {
        this._applyEditBrushAt(pixelX, pixelY);
      }
    } else {
      this._applyEditBrushAt(pixelX, pixelY);
    }

    // Update last position
    this._mapEditLastPixelX = pixelX;
    this._mapEditLastPixelY = pixelY;

    // Clear cached map image to force rebuild
    this._mapImageCanvas = null;
    this._mapEditDirty = true;
  },

  // Draw a straight line between two map pixels
  _applyEditLine(x0, y0, x1, y1) {
    if (!this.lastMapMsg) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(Math.ceil(dist), 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(x0 + dx * t);
      const py = Math.round(y0 + dy * t);
      this._applyEditBrushAt(px, py);
    }
    this._mapImageCanvas = null;
    this._mapEditDirty = true;
  },

  // Constrain point to straight line (horizontal, vertical, or 45° diagonal)
  _constrainToStraightLine(startX, startY, endX, endY) {
    const dx = endX - startX;
    const dy = endY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Determine the dominant direction
    // Angles: 0°, 45°, 90°, 135°, 180°, etc.
    // We snap to the nearest 45° increment
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const snappedAngle = Math.round(angle / 45) * 45;
    const radians = snappedAngle * Math.PI / 180;

    // Calculate distance along the constrained line
    const dist = Math.max(absDx, absDy);

    return {
      x: Math.round(startX + dist * Math.cos(radians)),
      y: Math.round(startY + dist * Math.sin(radians))
    };
  },

  // Apply scan-fill: clear region to free, then stamp LiDAR hits as obstacles
  _applyScanFillRegion(canvasX1, canvasY1, canvasX2, canvasY2) {
    if (!this.lastMapMsg || !this.lastScanMsg || !this.robotPose) {
      App.toast('Need map + LiDAR + robot pose data', 'error');
      return;
    }

    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;

    const msg = this.lastMapMsg;
    const width = msg.info.width;
    const height = msg.info.height;
    const resolution = msg.info.resolution;
    const origin = msg.info.origin;
    const data = msg.data;

    // Convert canvas rectangle corners to map pixel coords
    const p1 = this._canvasToMapPixel(canvasX1, canvasY1, canvas);
    const p2 = this._canvasToMapPixel(canvasX2, canvasY2, canvas);
    // Also try corner points for rotated maps
    const p3 = this._canvasToMapPixel(canvasX1, canvasY2, canvas);
    const p4 = this._canvasToMapPixel(canvasX2, canvasY1, canvas);

    const allPoints = [p1, p2, p3, p4].filter(p => p !== null);
    if (allPoints.length < 2) {
      App.toast('Selection outside map area', 'warning');
      return;
    }

    // Get bounding box in map pixel space
    const minPX = Math.max(0, Math.min(...allPoints.map(p => p.x)));
    const maxPX = Math.min(width - 1, Math.max(...allPoints.map(p => p.x)));
    const minPY = Math.max(0, Math.min(...allPoints.map(p => p.y)));
    const maxPY = Math.min(height - 1, Math.max(...allPoints.map(p => p.y)));

    if (maxPX <= minPX || maxPY <= minPY) {
      App.toast('Selection too small', 'warning');
      return;
    }

    // Save undo snapshot
    this._saveEditHistorySnapshot();

    // Step 1: Clear region to free space (value 0)
    for (let py = minPY; py <= maxPY; py++) {
      for (let px = minPX; px <= maxPX; px++) {
        const idx = (height - 1 - py) * width + px;
        data[idx] = 0; // free
      }
    }

    // Step 2: Stamp LiDAR scan points as obstacles within the region
    const scan = this.lastScanMsg;
    const pose = this.robotPose;
    const angleMin = scan.angle_min;
    const angleIncrement = scan.angle_increment;
    const ranges = scan.ranges;
    const rangeMin = scan.range_min || 0.01;
    const rangeMax = scan.range_max || 30.0;
    const brushR = 1; // 3px diameter stamp per lidar point

    let hitCount = 0;
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (r < rangeMin || r > rangeMax || !isFinite(r)) continue;

      // World coordinates of scan point
      const worldAngle = pose.yaw + angleMin + i * angleIncrement;
      const worldX = pose.x + r * Math.cos(worldAngle);
      const worldY = pose.y + r * Math.sin(worldAngle);

      // Convert to map image pixel coords (Y flipped: image Y=0 is top)
      const mapPX = Math.round((worldX - origin.position.x) / resolution);
      const mapPY = height - 1 - Math.round((worldY - origin.position.y) / resolution);

      // Check if within selection region
      if (mapPX < minPX - brushR || mapPX > maxPX + brushR ||
          mapPY < minPY - brushR || mapPY > maxPY + brushR) continue;

      // Apply small brush stamp
      for (let dy = -brushR; dy <= brushR; dy++) {
        for (let dx = -brushR; dx <= brushR; dx++) {
          if (dx * dx + dy * dy > brushR * brushR) continue;
          const px = mapPX + dx;
          const py = mapPY + dy;
          if (px >= minPX && px <= maxPX && py >= minPY && py <= maxPY) {
            const idx = (height - 1 - py) * width + px;
            data[idx] = 100; // obstacle
          }
        }
      }
      hitCount++;
    }

    this._mapImageCanvas = null;
    this._mapEditDirty = true;
    this.requestRender();

    const regionW = maxPX - minPX + 1;
    const regionH = maxPY - minPY + 1;
    App.toast(`Scan fill: ${regionW}x${regionH}px, ${hitCount} LiDAR points`, 'success');
  },

  // LiDAR Ray-casting update: trace each ray, mark path as free, endpoint as obstacle
  applyLidarRaycast() {
    if (!this.lastMapMsg) { App.toast('No map data', 'error'); return; }
    if (!this.lastScanMsg) { App.toast('No LiDAR data. Enable LiDAR first', 'error'); return; }
    if (!this.robotPose) { App.toast('No robot pose', 'error'); return; }

    // Read UI parameters
    const mode = (document.getElementById('raycast-mode') || {}).value || 'both';
    const maxRange = parseFloat((document.getElementById('raycast-max-range') || {}).value) || 10;
    const doDraw = mode === 'both' || mode === 'draw';
    const doClear = mode === 'both' || mode === 'clear';

    const msg = this.lastMapMsg;
    const width = msg.info.width;
    const height = msg.info.height;
    const resolution = msg.info.resolution;
    const origin = msg.info.origin;
    const data = msg.data;

    const scan = this.lastScanMsg;
    const pose = this.robotPose;
    const angleMin = scan.angle_min;
    const angleIncrement = scan.angle_increment;
    const ranges = scan.ranges;
    const rangeMin = scan.range_min || 0.01;

    // Robot position in map image pixels
    const robotIX = Math.round((pose.x - origin.position.x) / resolution);
    const robotIY = height - 1 - Math.round((pose.y - origin.position.y) / resolution);

    this._saveEditHistorySnapshot();

    // Pre-filter: reject outlier rays that jump too far from neighbors
    const OUTLIER_THRESHOLD = 0.5;
    const filtered = new Array(ranges.length);
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (!(r >= rangeMin && r <= maxRange && isFinite(r))) { filtered[i] = null; continue; }
      const prev = (i > 0 && isFinite(ranges[i - 1]) && ranges[i - 1] >= rangeMin) ? ranges[i - 1] : null;
      const next = (i < ranges.length - 1 && isFinite(ranges[i + 1]) && ranges[i + 1] >= rangeMin) ? ranges[i + 1] : null;
      const diffPrev = prev !== null ? Math.abs(r - prev) : 0;
      const diffNext = next !== null ? Math.abs(r - next) : 0;
      if (prev !== null && next !== null && diffPrev > OUTLIER_THRESHOLD && diffNext > OUTLIER_THRESHOLD) {
        filtered[i] = null;
      } else {
        filtered[i] = r;
      }
    }

    let freeCount = 0, obstacleCount = 0;

    for (let i = 0; i < ranges.length; i++) {
      const r = filtered[i];
      const validHit = r !== null;
      const traceR = validHit ? r : maxRange;

      const worldAngle = pose.yaw + angleMin + i * angleIncrement;
      const endWorldX = pose.x + traceR * Math.cos(worldAngle);
      const endWorldY = pose.y + traceR * Math.sin(worldAngle);

      const endIX = Math.round((endWorldX - origin.position.x) / resolution);
      const endIY = height - 1 - Math.round((endWorldY - origin.position.y) / resolution);

      // Bresenham line from robot to endpoint
      let x0 = robotIX, y0 = robotIY, x1 = endIX, y1 = endIY;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;

      while (true) {
        const atEnd = (x0 === x1 && y0 === y1);

        if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
          const idx = (height - 1 - y0) * width + x0;
          if (atEnd && validHit && doDraw) {
            data[idx] = 100;
            obstacleCount++;
          } else if (!atEnd && doClear) {
            data[idx] = 0;
            freeCount++;
          }
        }

        if (atEnd) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    }

    this._mapImageCanvas = null;
    this._mapEditDirty = true;
    this.requestRender();
    const modeLabel = mode === 'draw' ? 'Draw' : mode === 'clear' ? 'Clear' : 'Draw+Clear';
    App.toast(`Raycast (${modeLabel}, ${maxRange}m): ${obstacleCount} obstacle + ${freeCount} free`, 'success');
  },

  // Draw scan-fill selection rectangle preview
  _drawScanFillSelection(ctx) {
    if (!this._mapEditSelecting) return;

    const x1 = Math.min(this._mapEditSelectStartCX, this._mapEditSelectEndCX);
    const y1 = Math.min(this._mapEditSelectStartCY, this._mapEditSelectEndCY);
    const w = Math.abs(this._mapEditSelectEndCX - this._mapEditSelectStartCX);
    const h = Math.abs(this._mapEditSelectEndCY - this._mapEditSelectStartCY);

    if (w < 2 && h < 2) return;

    ctx.save();
    // Semi-transparent fill
    ctx.fillStyle = 'rgba(0, 180, 255, 0.12)';
    ctx.fillRect(x1, y1, w, h);

    // Dashed border
    ctx.strokeStyle = 'rgba(0, 180, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x1, y1, w, h);
    ctx.setLineDash([]);

    // Corner markers
    const cs = 6;
    ctx.fillStyle = 'rgba(0, 180, 255, 0.9)';
    ctx.fillRect(x1 - cs / 2, y1 - cs / 2, cs, cs);
    ctx.fillRect(x1 + w - cs / 2, y1 - cs / 2, cs, cs);
    ctx.fillRect(x1 - cs / 2, y1 + h - cs / 2, cs, cs);
    ctx.fillRect(x1 + w - cs / 2, y1 + h - cs / 2, cs, cs);

    // Size label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`SCAN FILL ${Math.round(w)}x${Math.round(h)}`, x1 + 4, y1 - 6);

    ctx.restore();
  },

  // Draw brush cursor preview on canvas
  _drawBrushCursor(ctx) {
    if (!this._mapEditMode || !this.lastMapMsg || !this._mapEditCursorInCanvas) return;
    // Don't show brush cursor when panning, selecting scan-fill region, or move tool
    if (this._mapEditPanning || this._mapEditSpaceKey || this._mapEditTool === 'move') return;
    // Skip brush cursor for scan-fill tool (uses rectangle selection instead)
    if (this._mapEditTool === 'scan-fill' && !this._mapEditSelecting) {
      // Just show crosshair hint
      const cx = this._mapEditCursorX;
      const cy = this._mapEditCursorY;
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 180, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy);
      ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0, 180, 255, 0.8)';
      ctx.font = '10px monospace';
      ctx.fillText('Drag to select area', cx + 14, cy - 8);
      ctx.restore();
      return;
    }
    if (this._mapEditTool === 'scan-fill') return;

    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;

    const cursorX = this._mapEditCursorX;
    const cursorY = this._mapEditCursorY;

    // Calculate brush size in canvas pixels (brushSize 1 = single pixel)
    const effectiveRadius = this._mapEditBrushSize - 1;
    const brushRadius = Math.max(effectiveRadius * this.mapZoom, 1);

    // Draw brush outline (circle or square)
    ctx.save();
    ctx.beginPath();
    if (this._mapEditBrushShape === 'square') {
      const side = brushRadius * 2;
      ctx.rect(cursorX - brushRadius, cursorY - brushRadius, side, side);
    } else {
      ctx.arc(cursorX, cursorY, brushRadius, 0, 2 * Math.PI);
    }

    // Color based on tool
    let strokeColor, fillColor;
    switch (this._mapEditTool) {
      case 'obstacle':
        strokeColor = 'rgba(255, 60, 60, 0.9)';
        fillColor = 'rgba(0, 0, 0, 0.3)';
        break;
      case 'free':
        strokeColor = 'rgba(60, 255, 60, 0.9)';
        fillColor = 'rgba(255, 255, 255, 0.3)';
        break;
      case 'unknown':
        strokeColor = 'rgba(255, 255, 60, 0.9)';
        fillColor = 'rgba(128, 128, 128, 0.3)';
        break;
      default:
        strokeColor = 'rgba(205, 133, 63, 0.8)';
        fillColor = 'rgba(205, 133, 63, 0.2)';
    }

    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw crosshair in center (larger for visibility)
    const chSize = Math.max(6, brushRadius * 0.5);
    ctx.beginPath();
    ctx.moveTo(cursorX - chSize, cursorY);
    ctx.lineTo(cursorX + chSize, cursorY);
    ctx.moveTo(cursorX, cursorY - chSize);
    ctx.lineTo(cursorX, cursorY + chSize);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Show brush size text near cursor
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '10px monospace';
    ctx.fillText(`${this._mapEditBrushSize}px`, cursorX + brushRadius + 4, cursorY - 4);

    // Show Shift+click line preview
    if (this._mapEditShiftKey && this._mapEditLastClickPixelX !== null) {
      // Convert last click pixel coords to current canvas coords (stays correct after pan/zoom)
      const lastCanvasPos = this._mapPixelToCanvas(
        this._mapEditLastClickPixelX, this._mapEditLastClickPixelY, canvas
      );
      if (lastCanvasPos) {
        // Draw preview line from last click to current cursor
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(255, 200, 100, 0.8)';
        ctx.lineWidth = 2;
        ctx.moveTo(lastCanvasPos.x, lastCanvasPos.y);
        ctx.lineTo(cursorX, cursorY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw start point marker
        ctx.beginPath();
        ctx.arc(lastCanvasPos.x, lastCanvasPos.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 200, 100, 0.5)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 200, 100, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Show "LINE" label
        ctx.fillStyle = 'rgba(255, 200, 100, 0.9)';
        ctx.font = 'bold 10px monospace';
        ctx.fillText('LINE', cursorX + brushRadius + 4, cursorY + 10);
      }
    } else if (this._mapEditShiftKey) {
      // No previous click - show hint text
      ctx.fillStyle = 'rgba(255, 200, 100, 0.7)';
      ctx.font = '10px monospace';
      ctx.fillText('Click to set start', cursorX + brushRadius + 4, cursorY + 10);
    }

    ctx.restore();
  },

  // Enter map edit mode
  _enterMapEditMode() {
    if (!this.lastMapMsg) {
      App.toast('No map data available', 'error');
      return;
    }

    // Clone map data for reset capability
    this._mapEditOriginalData = new Int8Array(this.lastMapMsg.data);
    this._mapEditHistory = [];
    this._mapEditDirty = false;
    this._mapEditMode = true;
    this._mapEditPanning = false;
    this._mapEditRotating = false;
    this._mapEditSpaceKey = false;
    this._mapEditLastClickPixelX = null;
    this._mapEditLastClickPixelY = null;

    // Update UI
    const editBtn = document.getElementById('btn-map-edit-toggle');
    const editPanel = document.getElementById('map-edit-controls');
    if (editBtn) editBtn.classList.add('active');
    if (editPanel) editPanel.style.display = 'flex';

    // Sync brush UI with current brush size
    this._syncBrushUI();

    const canvas = document.getElementById('map-canvas');
    if (canvas) {
      canvas.classList.add('map-edit-active');
      canvas.style.cursor = 'crosshair';
    }

    App.toast('Map edit mode started', 'info');
  },

  // Exit map edit mode
  // discard: true = restore original, false = keep changes
  // silent: true = don't show toast (used after save)
  _exitMapEditMode(discard = false, silent = false) {
    if (discard && this._mapEditOriginalData && this.lastMapMsg) {
      // Restore original data
      this.lastMapMsg.data = new Int8Array(this._mapEditOriginalData);
      this._mapImageCanvas = null;
    }

    this._mapEditMode = false;
    this._mapEditOriginalData = null;
    this._mapEditHistory = [];
    this._mapEditDirty = false;
    this._mapEditDrawing = false;
    this._mapEditPanning = false;
    this._mapEditRotating = false;
    this._mapEditSpaceKey = false;
    this._mapEditSelecting = false;
    this._mapEditTool = 'obstacle';

    // Update UI
    const editBtn = document.getElementById('btn-map-edit-toggle');
    const editPanel = document.getElementById('map-edit-controls');
    if (editBtn) editBtn.classList.remove('active');
    if (editPanel) editPanel.style.display = 'none';

    const canvas = document.getElementById('map-canvas');
    if (canvas) {
      canvas.classList.remove('map-edit-active');
      canvas.style.cursor = 'grab';
    }

    this.requestRender();
    if (!silent) {
      App.toast(discard ? 'Edit cancelled' : 'Edit mode ended', 'info');
    }
  },

  // Save history snapshot for undo
  _saveEditHistorySnapshot() {
    if (!this.lastMapMsg) return;
    const snapshot = new Int8Array(this.lastMapMsg.data);
    this._mapEditHistory.push(snapshot);
    if (this._mapEditHistory.length > this._mapEditHistoryMax) {
      this._mapEditHistory.shift();
    }
  },

  // Undo last edit
  _undoEdit() {
    if (this._mapEditHistory.length === 0) {
      App.toast('Nothing to undo', 'info');
      return;
    }
    const snapshot = this._mapEditHistory.pop();
    if (this.lastMapMsg) {
      this.lastMapMsg.data = snapshot;
      this._mapImageCanvas = null;
      this.requestRender();
    }
  },

  // Reset to original map
  _resetEdit() {
    if (!this._mapEditOriginalData || !this.lastMapMsg) return;
    this.lastMapMsg.data = new Int8Array(this._mapEditOriginalData);
    this._mapEditHistory = [];
    this._mapImageCanvas = null;
    this._mapEditDirty = false;
    this.requestRender();
    App.toast('Restored to original map', 'success');
  },

  // Generate PGM binary data from map
  _generatePGM() {
    if (!this.lastMapMsg) return null;
    const msg = this.lastMapMsg;
    const width = msg.info.width;
    const height = msg.info.height;
    const data = msg.data;

    // PGM P5 (binary) format
    const header = `P5\n${width} ${height}\n255\n`;
    const headerBytes = new TextEncoder().encode(header);
    const pixelData = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Map data is stored bottom-up, PGM is top-down
        const srcIdx = (height - 1 - y) * width + x;
        const dstIdx = y * width + x;
        const value = data[srcIdx];

        // Convert occupancy to grayscale
        // Free (0) -> 254 (white)
        // Occupied (100) -> 0 (black)
        // Unknown (-1) -> 205 (gray)
        let gray;
        if (value === -1) {
          gray = 205;  // Unknown
        } else if (value === 0) {
          gray = 254;  // Free space
        } else if (value === 100) {
          gray = 0;    // Occupied
        } else {
          // Linear interpolation for intermediate values
          gray = Math.round(254 - (value / 100) * 254);
        }
        pixelData[dstIdx] = gray;
      }
    }

    // Combine header and pixel data
    const pgmData = new Uint8Array(headerBytes.length + pixelData.length);
    pgmData.set(headerBytes, 0);
    pgmData.set(pixelData, headerBytes.length);

    return pgmData;
  },

  // Generate YAML metadata for map
  _generateMapYAML(mapName) {
    if (!this.lastMapMsg) return null;
    const msg = this.lastMapMsg;
    const resolution = msg.info.resolution;
    const origin = msg.info.origin;

    const yaml = `image: ${mapName}.pgm
resolution: ${resolution.toFixed(6)}
origin: [${origin.position.x.toFixed(6)}, ${origin.position.y.toFixed(6)}, 0.0]
negate: 0
occupied_thresh: 0.65
free_thresh: 0.196
`;
    return yaml;
  },

  // Save edited map to robot via SFTP
  async _saveEditedMap() {
    console.log('[MapEdit] _saveEditedMap called');

    if (!this.lastMapMsg) {
      App.toast('No map data available', 'error');
      return;
    }

    const slot = App.robotSlots[App.activeSlotIndex];
    if (!slot || !slot.ip) {
      App.toast('Robot is not connected', 'error');
      return;
    }

    // Fixed map name for robot
    const mapName = 'map';

    // Confirm before overwriting
    if (!confirm('Overwrite current map (map.pgm)?\nPath: ~/ROS_DB/map/map.pgm')) {
      return;
    }

    const statusEl = document.getElementById('map-edit-status');
    if (statusEl) statusEl.textContent = 'Connecting...';

    try {
      // Ensure SSH/SFTP connection using FileTransfer module
      if (typeof FileTransfer === 'undefined') {
        throw new Error('FileTransfer module not found');
      }

      const connResult = await FileTransfer.ensureConnection();
      if (!connResult.success) {
        throw new Error(connResult.message || 'SSH connection failed');
      }

      // Auto-backup current map before overwriting
      if (statusEl) statusEl.textContent = 'Backing up...';
      try {
        const now = new Date();
        const ts = now.getFullYear().toString() +
          String(now.getMonth() + 1).padStart(2, '0') +
          String(now.getDate()).padStart(2, '0') + '_' +
          String(now.getHours()).padStart(2, '0') +
          String(now.getMinutes()).padStart(2, '0') +
          String(now.getSeconds()).padStart(2, '0');
        const backupCmd = `mkdir -p ~/ROS_DB/map_${ts} && cp ~/ROS_DB/map/* ~/ROS_DB/map_${ts}/`;
        const backupResult = await this._mapExec(backupCmd);
        if (backupResult.success) {
          console.log(`[MapEdit] Backup created: map_${ts}`);
        } else {
          console.warn('[MapEdit] Backup failed:', backupResult.message);
        }
      } catch (backupErr) {
        console.warn('[MapEdit] Backup error (continuing with save):', backupErr);
      }

      if (statusEl) statusEl.textContent = 'Saving...';

      // Generate files
      const pgmData = this._generatePGM();
      const yamlContent = this._generateMapYAML(mapName);

      if (!pgmData || !yamlContent) {
        throw new Error('Map data generation failed');
      }

      // remotePath is directory only - filename comes from the uploaded file
      const remotePath = `/home/syscon/ROS_DB/map`;

      // Upload PGM file
      const pgmBlob = new Blob([pgmData], { type: 'application/octet-stream' });
      const pgmFormData = new FormData();
      pgmFormData.append('file', pgmBlob, `${mapName}.pgm`);
      pgmFormData.append('sessionId', FileTransfer.sessionId);
      pgmFormData.append('remotePath', remotePath);

      // B12 fix: fetch 타임아웃 적용 (업로드 60초)
      const pgmRes = await fetchWithTimeout('/api/sftp/upload', {
        method: 'POST',
        body: pgmFormData
      }, 60000);

      const pgmResult = await pgmRes.json();
      if (!pgmResult.success) {
        throw new Error('PGM upload failed: ' + (pgmResult.message || 'Unknown error'));
      }

      // Upload YAML file
      const yamlBlob = new Blob([yamlContent], { type: 'text/plain' });
      const yamlFormData = new FormData();
      yamlFormData.append('file', yamlBlob, `${mapName}.yaml`);
      yamlFormData.append('sessionId', FileTransfer.sessionId);
      yamlFormData.append('remotePath', remotePath);

      // B12 fix: fetch 타임아웃 적용 (업로드 60초)
      const yamlRes = await fetchWithTimeout('/api/sftp/upload', {
        method: 'POST',
        body: yamlFormData
      }, 60000);

      const yamlResult = await yamlRes.json();
      if (!yamlResult.success) {
        throw new Error('YAML upload failed: ' + (yamlResult.message || 'Unknown error'));
      }

      // Backup the newly saved map as well
      try {
        const now2 = new Date();
        const ts2 = now2.getFullYear().toString() +
          String(now2.getMonth() + 1).padStart(2, '0') +
          String(now2.getDate()).padStart(2, '0') + '_' +
          String(now2.getHours()).padStart(2, '0') +
          String(now2.getMinutes()).padStart(2, '0') +
          String(now2.getSeconds()).padStart(2, '0');
        const postBackupResult = await this._mapExec(`mkdir -p ~/ROS_DB/map_${ts2}_saved && cp ~/ROS_DB/map/* ~/ROS_DB/map_${ts2}_saved/`);
        if (postBackupResult.success) {
          console.log(`[MapEdit] Post-save backup created: map_${ts2}_saved`);
        }
      } catch (e) {
        console.warn('[MapEdit] Post-save backup error:', e);
      }

      if (statusEl) statusEl.textContent = 'Saved';
      App.toast(`Map saved: ${mapName}`, 'success');

      // Apply map if checkbox is checked
      const applyChk = document.getElementById('map-edit-apply-after-save');
      if (applyChk && applyChk.checked) {
        this._applyEditedMap(mapName);
      }

      this._mapEditDirty = false;

      // Exit edit mode after successful save (silent - no duplicate toast)
      this._exitMapEditMode(false, true);

    } catch (err) {
      console.error('[MapEdit] Save error:', err);
      if (statusEl) statusEl.textContent = 'Save failed';
      App.toast(`Map save failed: ${err.message}`, 'error');
    }
  },

  // Apply saved map to robot via amcl/change_map service
  async _applyEditedMap(mapName) {
    const slotIndex = App.activeSlotIndex;
    const ros = this.getRos(slotIndex);
    const rid = this.getRobotId(slotIndex);

    if (!ros || !rid) {
      App.toast('Robot is not connected', 'error');
      return;
    }

    // Get current robot pose for map change
    const currentPose = this.robotPose || { x: 0, y: 0, yaw: 0 };

    // Step 1: Call amcl/change_map to update AMCL
    const service = new ROSLIB.Service({
      ros: ros,
      name: `/${rid}/amcl/change_map`,
      serviceType: 'syscon_msgs/ChangeMap'
    });

    const request = new ROSLIB.ServiceRequest({
      path: `/home/syscon/ROS_DB/map/${mapName}.yaml`,
      pose: {
        x: currentPose.x,
        y: currentPose.y,
        theta: currentPose.yaw
      }
    });

    App.toast('Applying map...', 'info');

    service.callService(request, (result) => {
      if (result.success) {
        App.toast('AMCL map updated', 'success');
        console.log('[MapEdit] AMCL map applied successfully');
      } else {
        App.toast(`AMCL map apply failed (error_code: ${result.error_code})`, 'error');
        console.error('[MapEdit] AMCL map apply failed, error_code:', result.error_code);
      }
    }, (error) => {
      console.error('[MapEdit] AMCL change_map service error:', error);
    });

    // Step 2: Kill map_server so it respawns with the new map file
    try {
      const slot = App.robotSlots[slotIndex];
      if (!slot?.ip) {
        console.warn('[MapEdit] No robot IP for map_server restart');
        return;
      }

      App.toast('Restarting map_server...', 'info');

      const result = await this._mapExec(`. /opt/ros/noetic/setup.bash 2>/dev/null; . ~/catkin_ws/devel/setup.bash 2>/dev/null; rosnode kill /${rid}/map_server`);
      if (result.success) {
        App.toast('map_server restarting with new map...', 'success');
        console.log('[MapEdit] map_server killed, will respawn with new map');
      } else {
        console.warn('[MapEdit] map_server kill failed:', result.error);
        App.toast('map_server restart failed (map will apply on next robot reboot)', 'warning');
      }

      // Step 3: Kill slam_toolbox — it also latches the old map in memory
      this._killSlamToolbox();

    } catch (err) {
      console.error('[MapEdit] map_server restart error:', err);
      App.toast('map_server restart failed (map will apply on next robot reboot)', 'warning');
    }
  },

  // Dedicated SSH exec session (separate from FileTransfer's SFTP session)
  _mapExecSessionId: null,

  async _mapExec(command) {
    // Create or reuse a dedicated exec-only SSH session
    if (!this._mapExecSessionId) {
      const info = App.getConnectionInfo();
      const slot = App.robotSlots[App.activeSlotIndex];
      this._mapExecSessionId = 'map-exec-' + Date.now();
      const connRes = await fetchWithTimeout('/api/ssh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: info.ip,
          port: info.sshPort || 22,
          username: info.sshUser || slot?.sshUser || 'syscon',
          password: info.sshPassword || slot?.sshPassword || null,
          sessionId: this._mapExecSessionId
        })
      });
      const connResult = await connRes.json();
      if (!connResult.success) {
        this._mapExecSessionId = null;
        throw new Error(connResult.message || 'SSH exec connection failed');
      }
    }

    const res = await fetchWithTimeout('/api/ssh/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this._mapExecSessionId,
        command
      })
    });

    const result = await res.json();

    // If connection broke, clear session so next call reconnects
    if (!result.success && /not connected|channel/i.test(result.message || '')) {
      this._mapExecSessionId = null;
    }

    return result;
  },

  // Show map backups modal
  async _showMapBackups() {
    const modal = document.getElementById('map-backup-modal');
    if (!modal) return;

    const listEl = document.getElementById('map-backup-list');
    const restoreBtn = document.getElementById('btn-map-backup-restore');
    const deleteBtn = document.getElementById('btn-map-backup-delete');
    const renameBtn = document.getElementById('btn-map-backup-rename');
    const canvas = document.getElementById('map-backup-canvas');

    // Reset state
    this._selectedBackup = null;
    this._backupPreviewImg = null;
    if (restoreBtn) restoreBtn.disabled = true;
    if (deleteBtn) deleteBtn.disabled = true;
    if (renameBtn) renameBtn.disabled = true;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      canvas.width = 300;
      canvas.height = 300;
      ctx.fillStyle = '#0a0a14';
      ctx.fillRect(0, 0, 300, 300);
    }
    if (listEl) listEl.innerHTML = '<div class="map-backup-empty">Loading...</div>';

    modal.classList.add('show');
    this._setupBackupPreviewEvents();

    const slot = App.robotSlots[App.activeSlotIndex];
    if (!slot || !slot.ip) {
      if (listEl) listEl.innerHTML = '<div class="map-backup-empty">Robot not connected</div>';
      return;
    }

    try {
      const connResult = await FileTransfer.ensureConnection();
      if (!connResult.success) {
        if (listEl) listEl.innerHTML = '<div class="map-backup-empty">Connection failed</div>';
        return;
      }

      const res = await fetchWithTimeout('/api/sftp/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: FileTransfer.sessionId,
          remotePath: '/home/syscon/ROS_DB'
        })
      });

      const result = await res.json();
      if (!result.success || !result.files) {
        if (listEl) listEl.innerHTML = '<div class="map-backup-empty">Failed to list backups</div>';
        return;
      }

      // Filter map_* directories (backup folders)
      const backups = result.files
        .filter(f => f.isDirectory && /^map_/.test(f.name))
        .sort((a, b) => b.name.localeCompare(a.name)); // newest first

      if (backups.length === 0) {
        if (listEl) listEl.innerHTML = '<div class="map-backup-empty">No backups found</div>';
        return;
      }

      listEl.innerHTML = '';
      backups.forEach(backup => {
        const item = document.createElement('div');
        item.className = 'map-backup-item';
        item.dataset.folder = backup.name;

        // Parse date from folder name: map_YYYYMMDD_HHMMSS
        const match = backup.name.match(/^map_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
        let dateStr = backup.name;
        if (match) {
          dateStr = `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
        }

        item.innerHTML = `<div class="backup-date">${dateStr}</div><div class="backup-folder">${backup.name}</div>`;
        item.addEventListener('click', () => {
          listEl.querySelectorAll('.map-backup-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          this._selectedBackup = backup.name;
          if (restoreBtn) restoreBtn.disabled = false;
          if (deleteBtn) deleteBtn.disabled = false;
          if (renameBtn) renameBtn.disabled = false;
          this._loadBackupPreview(backup.name);
        });
        listEl.appendChild(item);
      });
    } catch (err) {
      console.error('[MapBackup] List error:', err);
      if (listEl) listEl.innerHTML = '<div class="map-backup-empty">Error loading backups</div>';
    }
  },

  // Load and preview a backup's PGM file
  async _loadBackupPreview(folderName) {
    try {
      await FileTransfer.ensureConnection();

      const res = await fetchWithTimeout('/api/sftp/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: FileTransfer.sessionId,
          remotePath: `/home/syscon/ROS_DB/${folderName}/map.pgm`
        })
      }, 60000);

      const result = await res.json();
      if (result.success && result.content) {
        this._previewMapPGM(result.content);
      } else {
        App.toast('Failed to load map preview', 'error');
      }
    } catch (err) {
      console.error('[MapBackup] Preview error:', err);
      App.toast('Preview load failed', 'error');
    }
  },

  // Render PGM binary (base64) onto backup preview canvas
  _previewMapPGM(base64) {
    const canvas = document.getElementById('map-backup-canvas');
    if (!canvas) return;

    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    // Parse PGM P5 format
    let offset = 0;
    if (bytes[0] !== 0x50 || bytes[1] !== 0x35) { // "P5"
      console.error('[MapBackup] Not a valid P5 PGM file');
      return;
    }
    offset = 2;

    const skipWS = () => {
      while (offset < bytes.length) {
        if (bytes[offset] === 0x23) {
          while (offset < bytes.length && bytes[offset] !== 0x0A) offset++;
          offset++;
        } else if (bytes[offset] <= 0x20) {
          offset++;
        } else {
          break;
        }
      }
    };

    const readNum = () => {
      skipWS();
      let num = 0;
      while (offset < bytes.length && bytes[offset] >= 0x30 && bytes[offset] <= 0x39) {
        num = num * 10 + (bytes[offset] - 0x30);
        offset++;
      }
      return num;
    };

    const width = readNum();
    const height = readNum();
    const maxVal = readNum();
    offset++;

    if (width === 0 || height === 0) {
      console.error('[MapBackup] Invalid PGM dimensions:', width, height);
      return;
    }

    // Create offscreen image from PGM data
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext('2d');
    const imgData = offCtx.createImageData(width, height);
    const pixelData = imgData.data;

    for (let i = 0; i < width * height && (offset + i) < bytes.length; i++) {
      const val = bytes[offset + i];
      const px = i * 4;

      if (val === 205 || (val >= 200 && val <= 210)) {
        // Unknown area - medium gray-blue
        pixelData[px] = 80;
        pixelData[px + 1] = 80;
        pixelData[px + 2] = 100;
        pixelData[px + 3] = 255;
      } else {
        pixelData[px] = val;
        pixelData[px + 1] = val;
        pixelData[px + 2] = val;
        pixelData[px + 3] = 255;
      }
    }
    offCtx.putImageData(imgData, 0, 0);

    // Store offscreen image for zoom/pan rendering
    this._backupPreviewImg = offscreen;
    this._backupPreviewZoom = 1;
    this._backupPreviewPanX = 0;
    this._backupPreviewPanY = 0;

    // Fit to container
    const container = document.getElementById('map-backup-preview');
    if (container) {
      const cw = container.clientWidth || 400;
      const ch = container.clientHeight || 400;
      this._backupPreviewZoom = Math.min(cw / (width + 12), ch / (height + 12), 2);
    }

    this._renderBackupPreview();
  },

  // Render backup preview with current zoom/pan
  _renderBackupPreview() {
    const canvas = document.getElementById('map-backup-canvas');
    const img = this._backupPreviewImg;
    if (!canvas || !img) return;

    const container = document.getElementById('map-backup-preview');
    const cw = container ? container.clientWidth : 500;
    const ch = container ? container.clientHeight : 400;
    canvas.width = cw;
    canvas.height = ch;

    const ctx = canvas.getContext('2d');
    const zoom = this._backupPreviewZoom || 1;
    const panX = this._backupPreviewPanX || 0;
    const panY = this._backupPreviewPanY || 0;

    // Background (outside map)
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, cw, ch);

    // Center the image
    const drawW = img.width * zoom;
    const drawH = img.height * zoom;
    const ox = (cw - drawW) / 2 + panX;
    const oy = (ch - drawH) / 2 + panY;

    // Border outline around map
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 1, oy - 1, drawW + 2, drawH + 2);

    // Draw map image
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, ox, oy, drawW, drawH);

    // Zoom info
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '11px monospace';
    ctx.fillText(`${Math.round(zoom * 100)}%  ${img.width}x${img.height}`, 6, ch - 6);
  },

  // Setup backup preview zoom/pan events
  _setupBackupPreviewEvents() {
    if (this._backupPreviewEventsSet) return;
    this._backupPreviewEventsSet = true;

    const canvas = document.getElementById('map-backup-canvas');
    if (!canvas) return;

    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this._backupPreviewImg) return;
      const delta = e.deltaY > 0 ? 0.85 : 1.18;
      this._backupPreviewZoom = Math.max(0.1, Math.min(20, (this._backupPreviewZoom || 1) * delta));
      this._renderBackupPreview();
    });

    // Mouse drag pan
    let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;
    canvas.addEventListener('mousedown', (e) => {
      if (!this._backupPreviewImg) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = this._backupPreviewPanX || 0;
      panStartY = this._backupPreviewPanY || 0;
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this._backupPreviewPanX = panStartX + (e.clientX - dragStartX);
      this._backupPreviewPanY = panStartY + (e.clientY - dragStartY);
      this._renderBackupPreview();
    });
    window.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        canvas.style.cursor = 'grab';
      }
    });
    canvas.style.cursor = 'grab';
  },

  // Restore a map backup
  async _restoreMapBackup(folderName) {
    if (!folderName) return;

    if (!confirm(`Restore map from backup "${folderName}"?\nThis will overwrite the current map.`)) {
      return;
    }

    const slot = App.robotSlots[App.activeSlotIndex];
    if (!slot || !slot.ip) {
      App.toast('Robot not connected', 'error');
      return;
    }

    try {
      App.toast('Restoring map...', 'info');

      const result = await this._mapExec(`cp /home/syscon/ROS_DB/${folderName}/* /home/syscon/ROS_DB/map/`);
      if (!result.success) {
        App.toast('Restore failed: ' + (result.message || 'Unknown error'), 'error');
        return;
      }
      if (result.exitCode !== 0) {
        App.toast('Restore failed: ' + (result.stderr || `exit code ${result.exitCode}`), 'error');
        return;
      }

      App.toast('Map restored successfully', 'success');

      // Apply restored map (amcl/change_map + map_server restart)
      this._applyEditedMap('map');

      // Exit map edit mode if active
      if (this._mapEditMode) {
        this._exitMapEditMode(true, true);
      }

      // Close modal
      const modal = document.getElementById('map-backup-modal');
      if (modal) modal.classList.remove('show');
    } catch (err) {
      console.error('[MapBackup] Restore error:', err);
      App.toast('Restore failed: ' + err.message, 'error');
    }
  },

  // Delete a map backup
  async _deleteMapBackup(folderName) {
    if (!folderName) return;

    if (!confirm(`Delete backup "${folderName}"?\nThis cannot be undone.`)) {
      return;
    }

    const slot = App.robotSlots[App.activeSlotIndex];
    if (!slot || !slot.ip) {
      App.toast('Robot not connected', 'error');
      return;
    }

    try {
      const result = await this._mapExec(`rm -rf /home/syscon/ROS_DB/${folderName}`);
      if (!result.success) {
        App.toast('Delete failed: ' + (result.message || 'Unknown error'), 'error');
        return;
      }
      if (result.exitCode !== 0) {
        App.toast('Delete failed: ' + (result.stderr || `exit code ${result.exitCode}`), 'error');
        return;
      }

      App.toast('Backup deleted', 'success');
      this._showMapBackups();
    } catch (err) {
      console.error('[MapBackup] Delete error:', err);
      App.toast('Delete failed: ' + err.message, 'error');
    }
  },

  // Rename a map backup
  async _renameMapBackup(folderName) {
    if (!folderName) return;

    const newName = prompt('Enter new backup name:', folderName);
    if (!newName || newName === folderName) return;

    // Validate: only allow safe characters
    if (!/^[a-zA-Z0-9_\-]+$/.test(newName)) {
      App.toast('Invalid name. Use only letters, numbers, _ and -', 'error');
      return;
    }

    const slot = App.robotSlots[App.activeSlotIndex];
    if (!slot || !slot.ip) {
      App.toast('Robot not connected', 'error');
      return;
    }

    try {
      const result = await this._mapExec(`mv /home/syscon/ROS_DB/${folderName} /home/syscon/ROS_DB/${newName}`);
      if (!result.success) {
        App.toast('Rename failed: ' + (result.message || 'Unknown error'), 'error');
        return;
      }
      if (result.exitCode !== 0) {
        App.toast('Rename failed: ' + (result.stderr || `exit code ${result.exitCode}`), 'error');
        return;
      }

      App.toast('Backup renamed', 'success');
      this._showMapBackups();
    } catch (err) {
      console.error('[MapBackup] Rename error:', err);
      App.toast('Rename failed: ' + err.message, 'error');
    }
  },

  // Setup map edit controls and event handlers
  setupMapEditControls() {
    const canvas = document.getElementById('map-canvas');
    const editBtn = document.getElementById('btn-map-edit-toggle');
    const toolBtns = document.querySelectorAll('.btn-edit-tool');
    const brushSlider = document.getElementById('map-edit-brush-size');
    const brushValue = document.getElementById('map-edit-brush-value');
    const undoBtn = document.getElementById('btn-map-edit-undo');
    const resetBtn = document.getElementById('btn-map-edit-reset');
    const saveBtn = document.getElementById('btn-map-edit-save');
    const cancelBtn = document.getElementById('btn-map-edit-cancel');

    if (!canvas || !editBtn) return;

    // Edit mode toggle
    editBtn.addEventListener('click', () => {
      if (this._mapEditMode) {
        if (this._mapEditDirty) {
          if (!confirm('There are unsaved changes. Exit edit mode?')) {
            return;
          }
        }
        this._exitMapEditMode(true);
      } else {
        this._enterMapEditMode();
      }
    });

    // Tool selection
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._mapEditTool = btn.dataset.tool;
      });
    });

    // Brush size
    if (brushSlider) {
      brushSlider.addEventListener('input', () => {
        this._mapEditBrushSize = parseInt(brushSlider.value);
        if (brushValue) brushValue.textContent = this._mapEditBrushSize;
      });
    }

    // Brush shape toggle
    const shapeBtn = document.getElementById('btn-brush-shape');
    if (shapeBtn) {
      shapeBtn.addEventListener('click', () => {
        this._mapEditBrushShape = this._mapEditBrushShape === 'circle' ? 'square' : 'circle';
        this._syncBrushShapeUI();
        this.requestRender();
      });
    }

    // Action buttons
    const raycastBtn = document.getElementById('btn-map-edit-raycast');
    if (raycastBtn) {
      raycastBtn.addEventListener('click', () => this.applyLidarRaycast());
    }
    if (undoBtn) undoBtn.addEventListener('click', () => this._undoEdit());
    if (resetBtn) resetBtn.addEventListener('click', () => this._resetEdit());
    if (saveBtn) {
      console.log('[MapEdit] Save button found, attaching listener');
      saveBtn.addEventListener('click', () => {
        console.log('[MapEdit] Save button clicked');
        this._saveEditedMap();
      });
    } else {
      console.warn('[MapEdit] Save button NOT found');
    }
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      if (this._mapEditDirty) {
        if (!confirm('Discard changes and exit?')) {
          return;
        }
      }
      this._exitMapEditMode(true);
    });

    // Map backup button
    const backupBtn = document.getElementById('btn-map-backup');
    if (backupBtn) {
      backupBtn.addEventListener('click', () => this._showMapBackups());
    }

    // Map backup modal controls
    const backupModal = document.getElementById('map-backup-modal');
    if (backupModal) {
      const closeBtn1 = document.getElementById('btn-map-backup-close');
      const closeBtn2 = document.getElementById('btn-map-backup-close2');
      const restoreBtn = document.getElementById('btn-map-backup-restore');
      const deleteBtnEl = document.getElementById('btn-map-backup-delete');
      const renameBtnEl = document.getElementById('btn-map-backup-rename');

      if (closeBtn1) closeBtn1.addEventListener('click', () => backupModal.classList.remove('show'));
      if (closeBtn2) closeBtn2.addEventListener('click', () => backupModal.classList.remove('show'));
      backupModal.addEventListener('click', (e) => { if (e.target === backupModal) backupModal.classList.remove('show'); });

      if (restoreBtn) restoreBtn.addEventListener('click', () => {
        if (this._selectedBackup) this._restoreMapBackup(this._selectedBackup);
      });
      if (deleteBtnEl) deleteBtnEl.addEventListener('click', () => {
        if (this._selectedBackup) this._deleteMapBackup(this._selectedBackup);
      });
      if (renameBtnEl) renameBtnEl.addEventListener('click', () => {
        if (this._selectedBackup) this._renameMapBackup(this._selectedBackup);
      });
    }

    // Mouse drawing on canvas - must be set up to intercept before pan mode
    canvas.addEventListener('mousedown', (e) => {
      if (!this._mapEditMode) return;
      if (this._poseMode || this._navGoalMode || this._waypointSelectMode) return;

      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      this._mapEditCursorX = cx;
      this._mapEditCursorY = cy;
      this._mapEditShiftKey = e.shiftKey;

      // Move tool: right-click = rotate map
      if (this._mapEditTool === 'move' && e.button === 2) {
        const rect2 = canvas.getBoundingClientRect();
        const centerX = rect2.left + rect2.width / 2;
        const centerY = rect2.top + rect2.height / 2;
        this._mapEditRotating = true;
        this._mapEditRotateStartAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        this._mapEditRotateStartRot = this.mapRotation;
        canvas.style.cursor = 'crosshair';
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Right-click or middle-click or Space+click or move tool left-click = pan
      if (e.button === 1 || e.button === 2 || this._mapEditSpaceKey || (this._mapEditTool === 'move' && e.button === 0)) {
        this._mapEditPanning = true;
        this._mapEditPanStartX = e.clientX;
        this._mapEditPanStartY = e.clientY;
        this.mapPanStartX = this.mapPanX;
        this.mapPanStartY = this.mapPanY;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Left-click
      if (e.button === 0) {
        // Scan-fill tool: start rectangle selection
        if (this._mapEditTool === 'scan-fill') {
          this._mapEditSelecting = true;
          this._mapEditSelectStartCX = cx;
          this._mapEditSelectStartCY = cy;
          this._mapEditSelectEndCX = cx;
          this._mapEditSelectEndCY = cy;
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        const pixel = this._canvasToMapPixel(cx, cy, canvas);

        // Shift+click: draw straight line from last click point to here
        if (e.shiftKey && this._mapEditLastClickPixelX !== null && pixel) {
          this._saveEditHistorySnapshot();
          this._applyEditLine(
            this._mapEditLastClickPixelX, this._mapEditLastClickPixelY,
            pixel.x, pixel.y
          );
          // Update last click to current for chaining
          this._mapEditLastClickPixelX = pixel.x;
          this._mapEditLastClickPixelY = pixel.y;
          this.requestRender();
          e.preventDefault();
          e.stopPropagation();
          return;  // Don't enter drag mode
        }

        // Normal drawing
        this._mapEditLastPixelX = null;
        this._mapEditLastPixelY = null;
        this._mapEditDrawing = true;
        this._saveEditHistorySnapshot();

        if (pixel) {
          this._mapEditLineStartX = pixel.x;
          this._mapEditLineStartY = pixel.y;
          this._applyEditBrush(pixel.x, pixel.y);
          // Store click position for future Shift+click line
          this._mapEditLastClickPixelX = pixel.x;
          this._mapEditLastClickPixelY = pixel.y;
          this.requestRender();
        }

        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // Disable context menu on canvas (right-click used for rotation)
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    canvas.addEventListener('mouseenter', () => {
      this._mapEditCursorInCanvas = true;
    }, true);

    // Use window mousemove so drawing continues outside canvas
    window.addEventListener('mousemove', (e) => {
      if (!this._mapEditMode) return;

      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      this._mapEditShiftKey = e.shiftKey;
      this._mapEditCursorX = cx;
      this._mapEditCursorY = cy;
      // Track if cursor is inside canvas bounds
      this._mapEditCursorInCanvas = (cx >= 0 && cy >= 0 && cx <= rect.width && cy <= rect.height);

      // Pan mode
      if (this._mapEditPanning) {
        this.mapPanX = this.mapPanStartX + (e.clientX - this._mapEditPanStartX);
        this.mapPanY = this.mapPanStartY + (e.clientY - this._mapEditPanStartY);
        this.requestRender();
        return;
      }

      // Rotate mode (move tool + right-drag)
      if (this._mapEditRotating) {
        const rect2 = canvas.getBoundingClientRect();
        const centerX = rect2.left + rect2.width / 2;
        const centerY = rect2.top + rect2.height / 2;
        const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        const deltaAngle = (currentAngle - this._mapEditRotateStartAngle) * (180 / Math.PI);
        let rot = ((this._mapEditRotateStartRot + deltaAngle) % 360 + 360) % 360;
        if (e.shiftKey) rot = Math.round(rot / 5) * 5;
        this.mapRotation = rot;
        document.getElementById('map-rotation-value').textContent = `${Math.round(this.mapRotation)}\u00B0`;
        this.requestRender();
        return;
      }

      // Scan-fill selection drag
      if (this._mapEditSelecting) {
        this._mapEditSelectEndCX = cx;
        this._mapEditSelectEndCY = cy;
        this.requestRender();
        return;
      }

      // Draw mode - continues even outside canvas
      if (this._mapEditDrawing) {
        let pixel = this._canvasToMapPixel(cx, cy, canvas);
        if (pixel) {
          if (this._mapEditShiftKey && this._mapEditLineStartX !== null) {
            pixel = this._constrainToStraightLine(
              this._mapEditLineStartX, this._mapEditLineStartY,
              pixel.x, pixel.y
            );
          }
          this._applyEditBrush(pixel.x, pixel.y);
        }
      }

      this.requestRender();
    });

    // Use window mouseup so strokes end even outside canvas
    window.addEventListener('mouseup', (e) => {
      if (!this._mapEditMode) return;

      if (this._mapEditRotating) {
        this._mapEditRotating = false;
        this.mapRotation = Math.round(this.mapRotation);
        document.getElementById('map-rotation-value').textContent = `${this.mapRotation}\u00B0`;
        canvas.style.cursor = 'grab';
        this.requestRender();
        return;
      }

      if (this._mapEditPanning) {
        this._mapEditPanning = false;
        canvas.style.cursor = this._mapEditTool === 'move' ? 'grab' : 'crosshair';
        return;
      }

      // Scan-fill selection complete → apply
      if (this._mapEditSelecting) {
        this._mapEditSelecting = false;
        const w = Math.abs(this._mapEditSelectEndCX - this._mapEditSelectStartCX);
        const h = Math.abs(this._mapEditSelectEndCY - this._mapEditSelectStartCY);
        if (w > 5 && h > 5) {
          this._applyScanFillRegion(
            this._mapEditSelectStartCX, this._mapEditSelectStartCY,
            this._mapEditSelectEndCX, this._mapEditSelectEndCY
          );
        }
        this.requestRender();
        return;
      }

      if (this._mapEditDrawing) {
        // Store final position for Shift+click line chaining
        const rect = canvas.getBoundingClientRect();
        const ux = e.clientX - rect.left;
        const uy = e.clientY - rect.top;
        const finalPixel = this._canvasToMapPixel(ux, uy, canvas);
        if (finalPixel) {
          this._mapEditLastClickPixelX = finalPixel.x;
          this._mapEditLastClickPixelY = finalPixel.y;
        }

        this._mapEditDrawing = false;
        this._mapEditLastPixelX = null;
        this._mapEditLastPixelY = null;
        this._mapEditLineStartX = null;
        this._mapEditLineStartY = null;
      }
    });

    canvas.addEventListener('mouseleave', () => {
      // Don't stop drawing on leave - window mousemove/mouseup handles it
      this._mapEditCursorInCanvas = false;
      this.requestRender();
    }, true);

    // Keyboard shortcuts for edit mode
    document.addEventListener('keydown', (e) => {
      if (!this._mapEditMode) return;

      // Shift key tracking
      if (e.key === 'Shift') {
        this._mapEditShiftKey = true;
        this.requestRender();
        return;
      }

      // Space = hold-to-pan (like Photoshop)
      if (e.code === 'Space' && !e.repeat) {
        this._mapEditSpaceKey = true;
        canvas.style.cursor = 'grab';
        e.preventDefault();
        return;
      }

      // Don't process shortcuts if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      // Ctrl+Z = undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        this._undoEdit();
        e.preventDefault();
        return;
      }

      // [ ] = brush size decrease/increase
      if (e.key === '[' || e.key === 'BracketLeft') {
        this._mapEditBrushSize = Math.max(1, this._mapEditBrushSize - 1);
        this._syncBrushUI();
        this.requestRender();
        return;
      }
      if (e.key === ']' || e.key === 'BracketRight') {
        this._mapEditBrushSize = Math.min(30, this._mapEditBrushSize + 1);
        this._syncBrushUI();
        this.requestRender();
        return;
      }

      // Q = toggle brush shape (circle/square)
      if (e.key === 'q' || e.key === 'Q') {
        this._mapEditBrushShape = this._mapEditBrushShape === 'circle' ? 'square' : 'circle';
        this._syncBrushShapeUI();
        this.requestRender();
        return;
      }

      // 1, 2, 3 = tool selection
      if (e.key === '1') { this._setEditTool('obstacle'); return; }
      if (e.key === '2') { this._setEditTool('free'); return; }
      if (e.key === '3') { this._setEditTool('unknown'); return; }
      if (e.key === '4') { this._setEditTool('scan-fill'); return; }
      if (e.key === '5') { this._setEditTool('move'); return; }
    });

    document.addEventListener('keyup', (e) => {
      if (!this._mapEditMode) return;
      if (e.key === 'Shift') {
        this._mapEditShiftKey = false;
        this.requestRender();
      }
      if (e.code === 'Space') {
        this._mapEditSpaceKey = false;
        if (!this._mapEditPanning) {
          canvas.style.cursor = this._mapEditTool === 'move' ? 'grab' : 'crosshair';
        }
      }
    });
  },

  // Sync brush slider UI with internal value
  _syncBrushUI() {
    const slider = document.getElementById('map-edit-brush-size');
    const valueEl = document.getElementById('map-edit-brush-value');
    if (slider) slider.value = this._mapEditBrushSize;
    if (valueEl) valueEl.textContent = this._mapEditBrushSize;
  },

  // Sync brush shape toggle UI
  _syncBrushShapeUI() {
    const btn = document.getElementById('btn-brush-shape');
    if (btn) {
      btn.textContent = this._mapEditBrushShape === 'circle' ? '●' : '■';
      btn.title = `Brush: ${this._mapEditBrushShape} [Q]`;
    }
  },

  // Set edit tool and update UI
  _setEditTool(tool) {
    this._mapEditTool = tool;
    const toolBtns = document.querySelectorAll('.btn-edit-tool');
    toolBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    const canvas = document.getElementById('map-canvas');
    if (canvas) {
      canvas.style.cursor = tool === 'move' ? 'grab' : 'crosshair';
    }
    this.requestRender();
  },

  // Latency monitoring
  startLatencyMonitor(index) {
    this.stopLatencyMonitor();
    const latencyEl = document.getElementById('ros-latency');

    this._latencyInterval = setInterval(() => {
      const slot = App.robotSlots[index];
      if (!slot || !slot.ros || !slot.connected) {
        if (latencyEl) {
          latencyEl.textContent = '--';
          latencyEl.className = 'ros-latency';
        }
        return;
      }

      const startTime = performance.now();
      const ros = slot.ros;

      // Use getTopics as a ping mechanism
      ros.getTopics((result) => {
        const rtt = Math.round(performance.now() - startTime);
        this._latencyMs = rtt;

        if (latencyEl) {
          latencyEl.textContent = `${rtt}ms`;
          if (rtt < 50) {
            latencyEl.className = 'ros-latency good';
          } else if (rtt < 150) {
            latencyEl.className = 'ros-latency warn';
          } else {
            latencyEl.className = 'ros-latency bad';
          }
        }
      }, (error) => {
        if (latencyEl) {
          latencyEl.textContent = 'ERR';
          latencyEl.className = 'ros-latency bad';
        }
      });
    }, 5000); // Check every 5 seconds
  },

  stopLatencyMonitor() {
    if (this._latencyInterval) {
      clearInterval(this._latencyInterval);
      this._latencyInterval = null;
    }
    const latencyEl = document.getElementById('ros-latency');
    if (latencyEl) {
      latencyEl.textContent = '--';
      latencyEl.className = 'ros-latency';
    }
  },

  // Fetch ROBOT_MODEL from connected robot via SSH
  async _fetchRobotModel(index) {
    const slot = App.robotSlots[index];
    if (!slot || !slot.ip) return;

    const modelEl = document.getElementById('robot-model-name');
    if (modelEl) modelEl.textContent = '...';

    try {
      const res = await fetchWithTimeout('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: slot.ip,
          user: 'syscon',
          password: slot.sshPassword || 'syscon',
          command: 'echo $ROBOT_MODEL'
        })
      });
      const data = await res.json();
      const model = data.success ? (data.stdout || '').trim() : '';

      slot.robotModel = model || null;
      if (modelEl) modelEl.textContent = model || '';
      if (model) console.log(`[RobotModel] ${slot.robotId}: ${model}`);
    } catch (e) {
      if (modelEl) modelEl.textContent = '';
      console.warn('[RobotModel] Failed to fetch:', e.message);
    }
  }
};

// Setup ROS Control tab event handlers
document.addEventListener('DOMContentLoaded', () => {
  // Service Call
  document.getElementById('btn-service-call').addEventListener('click', () => {
    const name = document.getElementById('service-name').value.trim();
    const argsStr = document.getElementById('service-args').value.trim();
    const resultEl = document.getElementById('service-result');

    if (!name) {
      resultEl.textContent = 'Error: Service name required';
      return;
    }

    let args = {};
    if (argsStr) {
      try {
        args = JSON.parse(argsStr);
      } catch (e) {
        resultEl.textContent = 'Error: Invalid JSON arguments';
        return;
      }
    }

    resultEl.textContent = 'Calling...';
    RosManager.callService(name, '', args, (result) => {
      resultEl.textContent = JSON.stringify(result, null, 2);
    });
  });

  // Param Get
  document.getElementById('btn-param-get').addEventListener('click', () => {
    const name = document.getElementById('param-name').value.trim();
    const resultEl = document.getElementById('param-result');

    if (!name) {
      resultEl.textContent = 'Error: Param name required';
      return;
    }

    RosManager.getParam(name, (result) => {
      resultEl.textContent = JSON.stringify(result, null, 2);
    });
  });

  // Param Set
  document.getElementById('btn-param-set').addEventListener('click', () => {
    const name = document.getElementById('param-name').value.trim();
    const value = document.getElementById('param-value').value.trim();
    const resultEl = document.getElementById('param-result');

    if (!name) {
      resultEl.textContent = 'Error: Param name required';
      return;
    }

    let parsedValue = value;
    try {
      parsedValue = JSON.parse(value);
    } catch (e) {
      // Keep as string if not valid JSON
    }

    RosManager.setParam(name, parsedValue, (result) => {
      resultEl.textContent = JSON.stringify(result, null, 2);
    });
  });

  // Topic Subscribe with Filter and Throttle
  let customTopicSub = null;
  let lastTopicUpdate = 0;
  let activeQuickTopicBtn = null;
  let activeQuickTopicConfig = null;

  function clearQuickTopicActive() {
    if (activeQuickTopicBtn) {
      activeQuickTopicBtn.classList.remove('active');
      activeQuickTopicBtn = null;
    }
    activeQuickTopicConfig = null;
  }

  function getActiveQuickRid() {
    const rid = RosManager.getRobotId();
    if (rid) return rid;
    const slot = App.robotSlots && App.robotSlots[App.activeSlotIndex];
    return slot ? slot.robotId : '';
  }

  function resolveQuickTopicConfig(config) {
    const rid = getActiveQuickRid();
    if (!rid) {
      App.toast('활성 로봇을 먼저 선택하거나 연결하세요', 'error');
      return null;
    }

    return {
      ...config,
      rid,
      name: config.topicTemplate.replace('{rid}', rid),
      throttleHz: parseInt(config.throttleHz, 10) || 5,
      filter: config.filter || '',
      displayMode: config.displayMode || 'raw',
    };
  }

  function setTopicFormValues(config) {
    document.getElementById('topic-name').value = config.name;
    document.getElementById('topic-type').value = config.type || '';
    document.getElementById('topic-filter').value = config.filter || '';
    document.getElementById('topic-throttle').value = String(config.throttleHz || 5);
  }

  function roundIfNumber(value, digits = 3) {
    return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
  }

  function quaternionToYawDeg(q) {
    if (!q) return null;
    const siny = 2 * ((q.w || 0) * (q.z || 0) + (q.x || 0) * (q.y || 0));
    const cosy = 1 - 2 * (((q.y || 0) * (q.y || 0)) + ((q.z || 0) * (q.z || 0)));
    return roundIfNumber(Math.atan2(siny, cosy) * 180 / Math.PI, 2);
  }

  function formatQuickTopicDisplay(msg, displayMode) {
    if (!msg || displayMode === 'raw') return msg;

    switch (displayMode) {
      case 'string':
        return msg.data !== undefined ? msg.data : msg;

      case 'int-array':
      case 'float-array':
        return {
          length: Array.isArray(msg.data) ? msg.data.length : 0,
          data: Array.isArray(msg.data) ? msg.data : msg.data
        };

      case 'twist':
        return {
          linear: {
            x: roundIfNumber(msg.linear?.x, 3),
            y: roundIfNumber(msg.linear?.y, 3),
            z: roundIfNumber(msg.linear?.z, 3),
          },
          angular: {
            x: roundIfNumber(msg.angular?.x, 3),
            y: roundIfNumber(msg.angular?.y, 3),
            z: roundIfNumber(msg.angular?.z, 3),
          }
        };

      case 'pose': {
        const pose = msg.pose?.pose || msg.pose || {};
        return {
          position: {
            x: roundIfNumber(pose.position?.x, 3),
            y: roundIfNumber(pose.position?.y, 3),
            z: roundIfNumber(pose.position?.z, 3),
          },
          yaw_deg: quaternionToYawDeg(pose.orientation),
        };
      }

      case 'odom': {
        const pose = msg.pose?.pose || {};
        const twist = msg.twist?.twist || {};
        return {
          position: {
            x: roundIfNumber(pose.position?.x, 3),
            y: roundIfNumber(pose.position?.y, 3),
            z: roundIfNumber(pose.position?.z, 3),
          },
          yaw_deg: quaternionToYawDeg(pose.orientation),
          twist: {
            linear_x: roundIfNumber(twist.linear?.x, 3),
            linear_y: roundIfNumber(twist.linear?.y, 3),
            angular_z: roundIfNumber(twist.angular?.z, 3),
          }
        };
      }

      case 'battery':
        return {
          voltage: roundIfNumber(msg.voltage, 3),
          current: roundIfNumber(msg.current, 3),
          percentage: roundIfNumber(msg.percentage, 3),
          power_supply_status: msg.power_supply_status,
          power_supply_health: msg.power_supply_health,
        };

      case 'laserscan': {
        const ranges = Array.isArray(msg.ranges) ? msg.ranges : [];
        const finiteRanges = ranges.filter(v => Number.isFinite(v));
        return {
          frame_id: msg.header?.frame_id || '',
          sample_count: ranges.length,
          angle_min: roundIfNumber(msg.angle_min, 3),
          angle_max: roundIfNumber(msg.angle_max, 3),
          range_min: roundIfNumber(msg.range_min, 3),
          range_max: roundIfNumber(msg.range_max, 3),
          nearest_range: finiteRanges.length ? roundIfNumber(Math.min(...finiteRanges), 3) : null,
          center_range: ranges.length ? roundIfNumber(ranges[Math.floor(ranges.length / 2)], 3) : null,
        };
      }

      case 'robot-state':
        return {
          workstate: msg.workstate,
          type: msg.type,
          pose: msg.pose ? {
            x: roundIfNumber(msg.pose.x, 3),
            y: roundIfNumber(msg.pose.y, 3),
            theta: roundIfNumber(msg.pose.theta, 3),
          } : null,
          feed_vel: msg.feed_vel ? {
            linear_x: roundIfNumber(msg.feed_vel.linear?.x, 3),
            linear_y: roundIfNumber(msg.feed_vel.linear?.y, 3),
            angular_z: roundIfNumber(msg.feed_vel.angular?.z, 3),
          } : null,
        };

      default:
        return msg;
    }
  }

  function unsubscribeCustomTopic(showMessage = true) {
    if (customTopicSub) {
      customTopicSub.unsubscribe();
      customTopicSub = null;
    }
    clearQuickTopicActive();
    if (showMessage) {
      document.getElementById('topic-result').textContent = 'Unsubscribed';
    }
  }

  function subscribeTopicWithConfig(config, quickBtn = null, rememberQuickConfig = null) {
    const resultEl = document.getElementById('topic-result');
    const throttleHz = parseInt(config.throttleHz, 10) || 10;
    const throttleMs = 1000 / throttleHz;

    if (!config.name || !config.type) {
      resultEl.textContent = 'Error: Topic name and type required';
      return false;
    }

    if (customTopicSub) {
      customTopicSub.unsubscribe();
      customTopicSub = null;
    }

    clearQuickTopicActive();
    lastTopicUpdate = 0;

    customTopicSub = RosManager.subscribeCustomTopic(config.name, config.type, (msg) => {
      const now = Date.now();
      if (now - lastTopicUpdate < throttleMs) return;
      lastTopicUpdate = now;

      let display = msg;
      if (config.filter) {
        try {
          const path = config.filter.replace(/^\./, '').split('.');
          let val = msg;
          for (const p of path) {
            if (val === null || val === undefined) break;
            val = val[p];
          }
          display = val !== undefined ? val : '(undefined)';
        } catch (e) {
          display = { _filterError: e.message, _rawMessage: msg };
        }
      }

      display = formatQuickTopicDisplay(display, config.displayMode);
      resultEl.textContent = typeof display === 'object'
        ? JSON.stringify(display, null, 2)
        : String(display);
    });

    if (!customTopicSub) {
      resultEl.textContent = 'Error: Topic subscribe failed (not connected)';
      return false;
    }

    if (quickBtn) {
      activeQuickTopicBtn = quickBtn;
      activeQuickTopicBtn.classList.add('active');
    }
    if (rememberQuickConfig) {
      activeQuickTopicConfig = { ...rememberQuickConfig };
    }

    resultEl.textContent = `Subscribed to ${config.name}` + (config.filter ? ` (filter: ${config.filter})` : '');
    return true;
  }

  document.getElementById('btn-topic-subscribe').addEventListener('click', () => {
    subscribeTopicWithConfig({
      name: document.getElementById('topic-name').value.trim(),
      type: document.getElementById('topic-type').value.trim(),
      filter: document.getElementById('topic-filter').value.trim(),
      throttleHz: parseInt(document.getElementById('topic-throttle').value, 10) || 10,
      displayMode: 'raw'
    });
  });

  document.getElementById('btn-topic-unsubscribe').addEventListener('click', () => {
    unsubscribeCustomTopic(true);
  });

  document.getElementById('btn-topic-clear').addEventListener('click', () => {
    document.getElementById('topic-result').textContent = '';
  });

  // Topic Mapping Button
  const topicMappingBtn = document.getElementById('btn-topic-mapping');
  if (topicMappingBtn) {
    RosManager.loadTopicMappings();
    topicMappingBtn.addEventListener('click', () => RosManager.showTopicMappingModal());
  }

  document.querySelectorAll('.topic-quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (activeQuickTopicBtn === btn && customTopicSub) {
        unsubscribeCustomTopic(true);
        return;
      }

      const quickConfig = {
        topicTemplate: btn.dataset.topicTemplate,
        type: btn.dataset.type,
        filter: btn.dataset.filter || '',
        throttleHz: btn.dataset.hz || '5',
        displayMode: btn.dataset.display || 'raw',
      };

      const resolved = resolveQuickTopicConfig(quickConfig);
      if (!resolved) return;

      setTopicFormValues(resolved);
      subscribeTopicWithConfig(resolved, btn, quickConfig);
    });
  });

  document.addEventListener('amr:active-robot-changed', () => {
    if (!activeQuickTopicConfig || !activeQuickTopicBtn) return;
    const resolved = resolveQuickTopicConfig(activeQuickTopicConfig);
    if (!resolved) return;
    setTopicFormValues(resolved);
    subscribeTopicWithConfig(resolved, activeQuickTopicBtn, activeQuickTopicConfig);
  });

  // --- Mapping Controls ---
  RosManager.setupMappingControls();

  // --- Auto Reconnect Button ---
  RosManager.setupAutoReconnectButton();

  // --- Work State Config ---
  RosManager.initWorkStateConfig();

  const wsLabels = RosManager.WORK_STATE_LABELS;
  const wsColors = RosManager.WORK_STATE_COLORS;

  function renderWorkStateColorList() {
    const list = document.getElementById('work-state-color-list');
    if (!list) return;
    const map = RosManager._workStateColorMap;

    const colorOptions = wsColors.map(c =>
      `<option value="${c.value}">${c.label}</option>`
    ).join('');

    list.innerHTML = Object.keys(wsLabels).map(key => {
      const label = wsLabels[key];
      const currentColor = map[key] || '';
      return `<div class="work-state-color-item">
        <span class="work-state-color-swatch" id="ws-swatch-${key}" style="background-color:${currentColor || '#9ca3af'}"></span>
        <span class="work-state-color-key">${key}: ${label}</span>
        <select class="work-state-color-select" data-ws-key="${key}">
          <option value="">Not set</option>
          ${colorOptions}
        </select>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-ws-key]').forEach(sel => {
      const key = sel.dataset.wsKey;
      if (map[key]) sel.value = map[key];
      sel.addEventListener('change', () => {
        if (sel.value) {
          RosManager._workStateColorMap[key] = sel.value;
        } else {
          delete RosManager._workStateColorMap[key];
        }
        const swatch = document.getElementById(`ws-swatch-${key}`);
        if (swatch) swatch.style.backgroundColor = sel.value || '#9ca3af';
        RosManager.saveWorkStateConfig();
      });
    });
  }

  const configToggle = document.getElementById('btn-work-state-config');
  const configPanel = document.getElementById('work-state-config-panel');
  if (configToggle && configPanel) {
    configToggle.addEventListener('click', () => {
      const visible = configPanel.style.display !== 'none';
      configPanel.style.display = visible ? 'none' : 'block';
      if (!visible) renderWorkStateColorList();
    });
  }

  const saveBtn = document.getElementById('btn-work-state-save-config');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      RosManager.saveWorkStateConfig();
      if (typeof App !== 'undefined' && App.toast) {
        App.toast('Color settings saved', 'success');
      }
    });
  }

  // --- ROS Info result helpers ---
  function showIntrospectResult(title, content) {
    const panel = document.getElementById('ros-introspect-result');
    const titleEl = document.getElementById('ros-introspect-result-title');
    const contentEl = document.getElementById('ros-introspect-result-content');
    titleEl.textContent = title;
    contentEl.textContent = content;
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  document.getElementById('btn-introspect-close').addEventListener('click', () => {
    document.getElementById('ros-introspect-result').style.display = 'none';
  });

  async function runRosCommand(command, title) {
    showIntrospectResult(title, 'Running...');

    // In test mode, SSH is not available — use rosapi services where possible
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      // Try to provide info via rosbridge/rosapi for supported commands
      const nodeInfoMatch = command.match(/rosnode info (.+)/);
      const topicInfoMatch = command.match(/rostopic info (.+)/);
      if (nodeInfoMatch && RosManager.ros) {
        const nodeName = nodeInfoMatch[1].trim();
        try {
          const svc = new ROSLIB.Service({ ros: RosManager.ros, name: '/rosapi/node_details', serviceType: 'rosapi/NodeDetails' });
          svc.callService(new ROSLIB.ServiceRequest({ node: nodeName }), (res) => {
            const lines = [`Node: ${nodeName}`, '', 'Subscriptions:', ...(res.subscribing || []).map(t => '  ' + t), '', 'Publications:', ...(res.publishing || []).map(t => '  ' + t), '', 'Services:', ...(res.services || []).map(t => '  ' + t)];
            showIntrospectResult(title, lines.join('\n'));
          }, (err) => {
            showIntrospectResult(title, `Test mode: rosapi query failed\n${err}`);
          });
        } catch (e) {
          showIntrospectResult(title, `Test mode: ${e}`);
        }
        return;
      }
      if (topicInfoMatch && RosManager.ros) {
        const topicName = topicInfoMatch[1].trim();
        try {
          const svc = new ROSLIB.Service({ ros: RosManager.ros, name: '/rosapi/topic_type', serviceType: 'rosapi/TopicType' });
          svc.callService(new ROSLIB.ServiceRequest({ topic: topicName }), (res) => {
            showIntrospectResult(title, `Topic: ${topicName}\nType: ${res.type || 'unknown'}`);
          }, (err) => {
            showIntrospectResult(title, `Test mode: rosapi query failed\n${err}`);
          });
        } catch (e) {
          showIntrospectResult(title, `Test mode: ${e}`);
        }
        return;
      }
      showIntrospectResult(title, 'SSH commands cannot be executed in test mode.\n\nCommand: ' + command);
      return;
    }

    try {
      const result = await SSHTerminal.execCommand(command);
      if (result.success) {
        showIntrospectResult(title, result.stdout || result.stderr || '(No output)');
      } else {
        showIntrospectResult(title, 'Error: ' + (result.stderr || result.error || result.message || 'Execution failed'));
      }
    } catch (e) {
      showIntrospectResult(title, 'SSH connection required.\n\n' + String(e));
    }
  }

  document.getElementById('ros-nodes').addEventListener('dblclick', (e) => {
    if (e.target.tagName === 'OPTION') {
      const node = e.target.value;
      runRosCommand(`rosnode info ${node}`, `rosnode info ${node}`);
    }
  });

  document.getElementById('ros-topics').addEventListener('dblclick', (e) => {
    if (e.target.tagName === 'OPTION') {
      const topic = e.target.value;
      const cmd = document.getElementById('ros-topic-cmd').value;
      if (cmd === 'echo') {
        const origIdx = RosInfo._data.topics.indexOf(topic);
        const topicType = origIdx >= 0 ? RosInfo._data.topicTypes[origIdx] : '';
        document.getElementById('topic-name').value = topic;
        document.getElementById('topic-type').value = topicType;
        document.getElementById('btn-topic-subscribe').click();
        document.getElementById('topic-name').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (cmd === 'hz' || cmd === 'bw') {
        runRosCommand(`timeout 5 rostopic ${cmd} ${topic}`, `rostopic ${cmd} ${topic}`);
      } else {
        runRosCommand(`rostopic ${cmd} ${topic}`, `rostopic ${cmd} ${topic}`);
      }
    }
  });

  document.getElementById('ros-services').addEventListener('dblclick', async (e) => {
    if (e.target.tagName === 'OPTION') {
      const svc = e.target.value;
      document.getElementById('service-name').value = svc;
      document.getElementById('service-args').value = '';
      document.getElementById('service-result').textContent = 'Querying service type...';
      document.getElementById('service-name').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      try {
        const typeResult = await SSHTerminal.execCommand(`rosservice type ${svc}`);
        if (typeResult.success && typeResult.stdout) {
          const svcType = typeResult.stdout.trim();
          document.getElementById('service-result').textContent = `Service type: ${svcType}\nReady to call. Enter request parameters and click "Call".`;
        } else {
          document.getElementById('service-result').textContent = 'Service type query failed. Call is still possible.';
        }
      } catch (err) {
        document.getElementById('service-result').textContent = `Ready to call (type query unavailable: SSH not connected)`;
      }
    }
  });

  document.getElementById('ros-params').addEventListener('dblclick', (e) => {
    if (e.target.tagName === 'OPTION') {
      const paramName = e.target.value;
      document.getElementById('param-name').value = paramName;
      document.getElementById('param-value').value = '';
      document.getElementById('param-result').textContent = 'Querying...';
      document.getElementById('param-name').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      RosManager.getParam(paramName, (result) => {
        if (result.success || result.value !== undefined) {
          const val = result.value !== undefined ? result.value : result;
          const display = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
          document.getElementById('param-result').textContent = display;
          document.getElementById('param-value').value = typeof val === 'object' ? JSON.stringify(val) : String(val);
        } else {
          document.getElementById('param-result').textContent = 'Query failed: ' + JSON.stringify(result);
        }
      });
    }
  });
});
