// Action Sender - ROS Service Call to TARU
const ActionSender = {
  STORAGE_KEY: 'actionSenderLastParams',
  QUEUE_STORAGE_KEY: 'actionSenderSavedQueues',
  TASK_FILE_SELECTION_KEY: 'actionSenderTaskFileSelection',
  LOCAL_TASK_SOURCE: '__local__',
  BUILTIN_TASK_VERSION: 3,
  DOCKING_TARGET_CFG_MODEL: 'sl400_vri',
  actionQueue: [],
  _undoStack: [],
  _redoStack: [],
  _maxUndoStack: 30,
  _waypointSelectMode: false, // Map click mode for waypoint selection
  _actionNameCounters: {}, // Counter for auto-generating action names
  _dockingCfgCache: new Map(),
  _dockingCoreCfgCache: new Map(),
  _remoteHomeCache: new Map(),
  _expandedTaskNames: new Set(),
  _taskTelemetry: null,
  _taskTelemetryToken: 0,
  _taskCancelRequests: new Map(),
  _builderMode: 'list',
  _editingTaskName: '',
  _activeTaskSource: '__local__',
  _quickTaskItems: [],
  _quickTaskMode: '',
  _quickTrajectoryDraft: [],
  _quickTaskSequence: 0,

  // Action type definitions with default args and params
  // Based on sp_task action modules from stl_ulsan
  // Reference: ROS_Topic_Response.xlsx - Action_arguments_and_parameters sheet

  // Common parameters shared by all actions
  commonParams: [
    { name: 'common/sound_trigger', type: 'bool', default: 'false', desc: 'Sound trigger (auto OFF after action)' },
    { name: 'common/footprint', type: 'string', default: '0', desc: 'Robot size (0=default, [[x,y],...] polygon)' },
    { name: 'common/obstacle_enabled', type: 'bool', default: 'false', desc: 'local_obstacle_layer ON/OFF' },
    { name: 'common/rgbd_obstacle_enabled', type: 'bool', default: 'false', desc: 'local_rgbd_obstacle_layer ON/OFF' },
    { name: 'common/fake_localization_enabled', type: 'bool', default: 'false', desc: 'Fake localization mode ON/OFF' }
  ],

  fieldLabels: {
    x: '목표 X',
    y: '목표 Y',
    theta: '목표 방향',
    x0: '경유점 X',
    y0: '경유점 Y',
    target_x: 'X축 이동 거리',
    target_y: 'Y축 이동 거리',
    init_x: '초기 X',
    init_y: '초기 Y',
    init_theta: '초기 방향',
    move_type: '이동 종류',
    move_amount: '거리 / 각도',
    move_vel: '이동 속도',
    duration: '대기 시간',
    id: '신호 ID',
    is_charge: '충전 여부',
    direction: '도킹 방향',
    scan_type: '마커 종류',
    end_condition: '완료 판정',
    dock_dist: '도킹 시작 거리',
    dock_dist_flag: '거리 기준',
    scan_view: '스캔 방향',
    x_offset: 'X 오프셋',
    y_offset: 'Y 오프셋',
    center_offset: '중심 / 방향 오프셋',
    v_angle: 'V 마커 각도',
    mark_size: '마커 길이',
    marker_type: '마커 위치',
    target_id: '마커 ID',
    target_size: '마커 크기',
    cradle_width: '거치대 폭',
    cradle_depth: '거치대 길이',
    model_type: '주행 모델',
    target_cfg: '도킹 설정 파일',
    distance: '이동 거리',
    is_crab_motion: '횡이동 사용',
    lane_name: 'Lane 이름',
    driving_type: '주행 방식',
    lane_direction: 'Lane 주행 방향',
    lane_type: 'Lane 경로 방식',
    max_trans_vel: '최대 직진 속도',
    max_rot_vel: '최대 회전 속도',
    xy_goal_tolerance: '좌표 오차 허용',
    yaw_goal_tolerance: '각도 오차 허용',
    passing_flag: '통과 주행',
    passing_dist: '통과 인식 거리',
    straight_path: '직선 주행',
    avoid_mode: '장애물 회피',
    road_width: '주행 폭',
    backward_driving: '후진 주행',
    set_local_planner: '주행 플래너',
    qr_correction_mode: 'QR 위치 보정',
    sync_mode_enabled: '동기 주행',
    using_basic_footprint: '기본 풋프린트 사용',
    collision_detect_range: '충돌 감지 거리',
    mode: '동작 모드',
    target: '목표값',
    lccs_loading_mode: '다리형 적재물 모드',
    map_id: '맵 ID',
    cmd_type: '구동 명령',
    floor: '컨베이어 층',
    heading_yaw: '로봇 회전 각도',
    rotate_first: '선회 후 이동',
    value: '제어값',
    request_vision_update: '비전 갱신 요청',
    'common/sound_trigger': '음향 알림',
    'common/footprint': '로봇 풋프린트',
    'common/obstacle_enabled': '장애물 레이어',
    'common/rgbd_obstacle_enabled': 'RGBD 장애물 레이어',
    'common/fake_localization_enabled': '가상 위치 추정'
  },

  actionTypes: {
    '0x01': {
      name: 'Way_Point',
      desc: 'Navigate to target coordinates',
      args: [
        { name: 'x', label: '목표 X', unit: 'm', default: 0.0, desc: 'Target X coordinate (m)' },
        { name: 'y', label: '목표 Y', unit: 'm', default: 0.0, desc: 'Target Y coordinate (m)' },
        { name: 'theta', label: '목표 방향', unit: 'rad', default: 0.0, desc: 'Target orientation (rad)' }
      ],
      params: [
        { name: 'max_trans_vel', type: 'float', default: '0.7', desc: 'Max linear velocity (m/s), range: 0~1.8' },
        { name: 'max_rot_vel', type: 'float', default: '0.6', desc: 'Max angular velocity (rad/s), range: 0~1.8' },
        { name: 'xy_goal_tolerance', type: 'float', default: '0.15', desc: 'Position tolerance (m)' },
        { name: 'yaw_goal_tolerance', type: 'float', default: '0.05', desc: 'Angle tolerance (rad)' },
        { name: 'passing_flag', type: 'bool', default: 'false', desc: 'Ignore angle, check distance only' },
        { name: 'passing_dist', type: 'float', default: '0.03', desc: 'Recognition distance for passing (m)' },
        { name: 'straight_path', type: 'bool', default: 'false', desc: 'Straight path mode (no A*)' },
        { name: 'avoid_mode', type: 'bool', default: 'true', desc: 'Obstacle avoidance mode' },
        { name: 'road_width', type: 'float', default: '4.0', desc: 'Rollout avoidance width (m)' },
        { name: 'backward_driving', type: 'bool', default: 'false', desc: 'Backward driving' },
        { name: 'model_type', type: 'int', default: '0', desc: '0:DD(normal), 1:QD(fixed heading), 2:Trailer' },
        { name: 'set_local_planner', type: 'int', default: '0', desc: '0:Pure, 1:TEB, 2:MPC, 3:DWA' }
      ]
    },
    '0x02': {
      name: 'Basic_Move',
      desc: 'Basic move (linear/rotation)',
      args: [
        {
          name: 'move_type',
          label: '이동 종류',
          default: 0,
          desc: '0: Linear, 1: Rotation',
          enumValues: [
            { value: 0, label: '직진' },
            { value: 1, label: '회전' }
          ]
        },
        { name: 'move_amount', label: '거리 / 각도', default: 1.0, desc: 'Distance(m, max 10) or angle(deg, ±180)' }
      ],
      params: [
        { name: 'move_vel', type: 'float', default: '0.5', desc: 'Move velocity (m/s or rad/s)' }
      ]
    },
    '0x07': {
      name: 'Stand_By',
      desc: 'Wait (timed or infinite)',
      args: [
        { name: 'duration', label: '대기 시간', unit: 'sec', default: 5, desc: 'Wait time(sec), 0=infinite (until resume signal)' }
      ],
      params: [
        { name: 'id', type: 'string', default: '', desc: 'wake_up condition ID (empty=any condition)' },
        { name: 'common/sound_trigger', type: 'bool', default: 'false', desc: 'Sound trigger enable' }
      ]
    },
    '0x08': {
      name: 'Docking',
      desc: 'Docking operation',
      args: [
        {
          name: 'is_charge',
          label: '충전 여부',
          default: 0,
          desc: '0: No charge request, 1: Charge request',
          enumValues: [
            { value: 0, label: '충전 안 함' },
            { value: 1, label: '충전 요청' }
          ]
        },
        {
          name: 'direction',
          label: '도킹 방향',
          default: 1,
          desc: '1:Front, -1:Rear, 2:Left, 3:Right',
          enumValues: [
            { value: 1, label: '전방' },
            { value: -1, label: '후방' },
            { value: 2, label: '왼쪽' },
            { value: 3, label: '오른쪽' }
          ]
        },
        {
          name: 'scan_type',
          label: '마커 종류',
          default: 1,
          desc: '1:L, 2:LV, 3:Cradle, 4:Rack, 5:Aruco, 6:ML-LV, 7:Direct',
          enumValues: [
            { value: 1, label: 'L 마커' },
            { value: 2, label: 'LV 마커' },
            { value: 3, label: 'Cradle' },
            { value: 4, label: 'Rack / CFG' },
            { value: 5, label: 'Aruco' },
            { value: 6, label: 'ML-LV' },
            { value: 7, label: 'Direct' }
          ]
        },
        {
          name: 'end_condition',
          label: '완료 판정',
          default: 1,
          desc: '1:dock_dist, 2:IR_state, 3:Charge_contact',
          enumValues: [
            { value: 1, label: '거리 / 위치 도달' },
            { value: 2, label: 'IR 센서' },
            { value: 3, label: '충전 접점' }
          ]
        }
      ],
      params: [
        { name: 'dock_dist', type: 'float', default: '1.2', desc: 'Docking completion distance (m)' },
        { name: 'dock_dist_flag', type: 'bool', default: 'false', desc: 'true:Robot center ref, false:Robot edge ref' },
        { name: 'scan_view', type: 'int', default: '0', desc: '0:front, 1:left, 2:rear, 3:right' },
        { name: 'x_offset', type: 'float', default: '0.0', desc: 'X-axis offset (m)' },
        { name: 'y_offset', type: 'float', default: '0.0', desc: 'Y-axis offset (m)' },
        { name: 'center_offset', type: 'float', default: '0.0', desc: 'Heading offset (deg), 360=auto' },
        { name: 'v_angle', type: 'int', default: '90', desc: 'LV marker V-groove angle (90/120)' },
        { name: 'mark_size', type: 'float', default: '0.1', desc: 'Marker size (m)' },
        { name: 'marker_type', type: 'int', default: '1', desc: 'LV marker position (1:Center, 2:Right)' },
        { name: 'target_id', type: 'string', default: '', desc: 'Marker ID (e.g. "1,2")' },
        { name: 'target_size', type: 'float', default: '0.1', desc: 'Aruco marker size (m)' },
        { name: 'cradle_width', type: 'float', default: '0.0', desc: 'Cradle width (m)' },
        { name: 'cradle_depth', type: 'float', default: '0.0', desc: 'Cradle depth (m)' },
        { name: 'model_type', type: 'int', default: '0', desc: '0:DD, 1:QD' },
        { name: 'target_cfg', type: 'string', default: '', desc: 'Target model cfg override (e.g. docking_pallet_mspe.cfg, docking_rack.cfg)' }
      ]
    },
    '0x10': {
      name: 'DockingOut',
      desc: 'Undocking (0x10)',
      args: [
        { name: 'distance', label: '이동 거리', unit: 'm', default: -1.0, desc: 'Move distance (m), +:Forward, -:Backward' }
      ],
      params: [
        { name: 'cradle_width', type: 'float', default: '0', desc: 'Cradle width (m)' },
        { name: 'cradle_depth', type: 'float', default: '0', desc: 'Cradle depth (m)' },
        { name: 'x_offset', type: 'float', default: '0', desc: 'X-axis offset (m)' },
        { name: 'is_crab_motion', type: 'bool', default: 'false', desc: 'Y-axis undocking (-:Right, +:Left)' }
      ]
    },
    '0x12': {
      name: 'DockingOut_0x12',
      desc: 'Undocking (0x12)',
      args: [
        { name: 'distance', default: -1.0, desc: 'Move distance (m), +:Forward, -:Backward' }
      ],
      params: [
        { name: 'cradle_width', type: 'float', default: '0', desc: 'Cradle width (m)' },
        { name: 'cradle_depth', type: 'float', default: '0', desc: 'Cradle depth (m)' },
        { name: 'x_offset', type: 'float', default: '0', desc: 'X-axis offset (m)' },
        { name: 'is_crab_motion', type: 'bool', default: 'false', desc: 'Y-axis undocking' }
      ]
    },
    '0x15': {
      name: 'TrajectoryFollowing',
      desc: 'Trajectory following (WayPoint Global Path)',
      args: [
        { name: 'x0', default: 0.0, desc: 'waypoint_0 X (m)' },
        { name: 'y0', default: 0.0, desc: 'waypoint_0 Y (m)' },
        { name: 'theta', default: 0.0, desc: 'Final point theta (rad)' }
      ],
      params: [
        { name: 'lane_name', type: 'string', default: 'lane_tmp', desc: 'Lane name' },
        { name: 'driving_type', type: 'int', default: '0', desc: '0:Following, 1:Overtake, 2:StopAndGo, 3:ObstacleAvoid, 4:Carriageway, 5:Bypass' },
        { name: 'lane_direction', type: 'int', default: '0', desc: '0:Forward, 3:Backward' },
        { name: 'lane_type', type: 'int', default: '0', desc: '0:Strict(straight), 1:Smooth, 2:Off' },
        { name: 'max_trans_vel', type: 'float', default: '1.8', desc: 'Max velocity (m/s)' },
        { name: 'max_rot_vel', type: 'float', default: '1.0', desc: 'Max angular velocity (rad/s)' },
        { name: 'xy_goal_tolerance', type: 'float', default: '0.15', desc: 'XY tolerance (m)' },
        { name: 'yaw_goal_tolerance', type: 'float', default: '0.05', desc: 'Angle tolerance (rad)' },
        { name: 'road_width', type: 'float', default: '4.0', desc: 'Rollout avoidance width (m)' },
        { name: 'passing_flag', type: 'bool', default: 'false', desc: 'Ignore angle' },
        { name: 'passing_dist', type: 'float', default: '0.03', desc: 'Passing recognition distance (m)' },
        { name: 'backward_driving', type: 'bool', default: 'false', desc: 'Backward driving' },
        { name: 'qr_correction_mode', type: 'bool', default: 'true', desc: 'QR recognition 50mm arrival complete' },
        { name: 'sync_mode_enabled', type: 'bool', default: 'false', desc: 'Turntable sync drive when lifted' },
        { name: 'using_basic_footprint', type: 'bool', default: 'false', desc: 'Use basic footprint when lifted' },
        { name: 'collision_detect_range', type: 'float', default: '0.15', desc: 'Collision detect range (m)' }
      ]
    },
    '0x16': {
      name: 'Lift',
      desc: 'Lift operation',
      args: [
        {
          name: 'mode',
          label: '동작',
          default: 1,
          desc: '0:Stop, 1:Up, 2:Down, 3:Position, 4:Height, 5:SensorInit, 6:ErrorReset',
          enumValues: [
            { value: 0, label: '정지' },
            { value: 1, label: '리프트 업' },
            { value: 2, label: '리프트 다운' },
            { value: 3, label: 'Position 이동' },
            { value: 4, label: 'Height 이동' },
            { value: 5, label: '센서 초기화' },
            { value: 6, label: '에러 리셋' }
          ]
        },
        { name: 'target', label: '목표값', default: 0, desc: 'mode3: position value, mode4: height(mm), others: 0' }
      ],
      params: [
        { name: 'lccs_loading_mode', type: 'bool', default: 'false', desc: 'Loading mode for legged cargo' }
      ]
    },
    '0x17': {
      name: 'Change_Map',
      desc: 'Change map and set initial pose',
      args: [
        { name: 'init_x', default: 0.0, desc: 'Initial X coordinate (m)' },
        { name: 'init_y', default: 0.0, desc: 'Initial Y coordinate (m)' },
        { name: 'init_theta', default: 0.0, desc: 'Initial orientation (rad)' }
      ],
      params: [
        { name: 'map_id', type: 'string', default: '', desc: 'Map folder name (ROS_DB/map/map_list/folder)' }
      ]
    },
    '0x18': {
      name: 'Conveyor',
      desc: 'Conveyor operation',
      args: [
        { name: 'cmd_type', default: 3, desc: '0x01:Reset, 0x02:Stop, 0x03:FrontLoad, 0x04:FrontUnload, 0x05:RearLoad, 0x06:RearUnload' },
        {
          name: 'floor',
          default: 1,
          desc: '컨베이어 구동 층 (미선택 시 1층)',
          enumValues: [
            { value: 1, label: '1층 (기본)' },
            { value: 2, label: '2층' }
          ]
        }
      ],
      params: []
    },
    '0x19': {
      name: 'Quad_Basic_Move',
      desc: '4WD basic move',
      args: [
        { name: 'target_x', default: 0.0, desc: 'X-axis move distance (m)' },
        { name: 'target_y', default: 0.0, desc: 'Y-axis move distance (m)' }
      ],
      params: [
        { name: 'heading_yaw', type: 'float', default: '0', desc: 'Robot rotation angle (deg)' },
        { name: 'rotate_first', type: 'bool', default: 'true', desc: 'true:Rotate then move, false:Move while rotating' }
      ]
    },
    '0x21': {
      name: 'Forklift',
      desc: 'Forklift module control',
      args: [
        { name: 'mode', default: 1, desc: '1:Lift, 2:Shift, 3:Positioning, 4:Tilt' },
        { name: 'value', default: 0, desc: 'Lift:0~2990, Shift:0~100, Positioning:400~1000, Tilt:0(Down)/2(Up) (mm)' }
      ],
      params: [
        { name: 'request_vision_update', type: 'bool', default: 'false', desc: 'Request vision data update (for lift/shift)' }
      ]
    },
    '0x22': {
      name: 'Turntable',
      desc: 'Turntable rotation',
      args: [
        { name: 'mode', default: 3, desc: '0:Stop, 1:CCW90°, 2:CW90°, 3:Target, 4:SlowCCW, 5:SlowCW, 6:Nearest, 11~16:KIVA turn, 20~21:Reset' },
        { name: 'target', default: 0, desc: 'mode3,13: Target angle (deg)' }
      ],
      params: []
    }
  },

  defaultTaskSpecs: [
    { name: '기본 - 도킹', actionType: '0x08', args: [0, 1, 1, 1] },
    { name: '기본 - 도킹아웃', actionType: '0x10', args: [-1.0] },
    { name: '기본 - WayPoint', actionType: '0x01', args: [0, 0, 0] },
    { name: '기본 - Standby', actionType: '0x07', args: [5] },
    { name: '기본 - TrajectoryFollowing', actionType: '0x15', args: [0, 0, 0] },
    { name: '기본 - 리프트 업', actionType: '0x16', args: [1, 0] },
    { name: '기본 - 리프트 다운', actionType: '0x16', args: [2, 0] },
    {
      name: '기본 - 컨베이어 구동',
      actionType: '0x18',
      args: [3, 1],
      conveyorFloor: 1
    }
  ],

  init() {
    this._activeTaskSource = localStorage.getItem(this.TASK_FILE_SELECTION_KEY)
      || this.LOCAL_TASK_SOURCE;
    this.setupEventListeners();
    this.setupCommonParamsUI();
    this.updateActionForm('0x01'); // Default to WayPoint
    this.ensureDefaultTasks();
    this.refreshSavedQueueList();
    this._subscribeTaskTelemetry();
  },

  _fieldLabel(field) {
    if (!field) return '';
    return field.label || this.fieldLabels[field.name] || field.name;
  },

  _fieldLabelMarkup(field, unit = '') {
    const friendly = this._fieldLabel(field);
    const rawName = field?.name || '';
    const unitText = unit || field?.unit || '';
    return `<span class="action-field-friendly">${friendly}${unitText ? ` [${unitText}]` : ''}</span>` +
      `<small class="action-field-key">${rawName}</small>`;
  },

  _buildDefaultTaskItem(spec) {
    const config = this.actionTypes[spec.actionType];
    if (!config) return null;
    const args = config.args.map((arg, index) =>
      spec.args[index] !== undefined ? spec.args[index] : arg.default
    );
    const params = config.params.map(param => ({
      param_name: param.name,
      type: param.type,
      value: String(param.default !== undefined ? param.default : '')
    }));
    const actionName = spec.name;
    const item = this.normalizeActionForSend({
      name: actionName,
      actionType: spec.actionType,
      args,
      params,
      summary: `${actionName}: ${config.name}`
    });
    if (spec.conveyorFloor !== undefined) item.conveyorFloor = spec.conveyorFloor;
    return item;
  },

  ensureDefaultTasks() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(this.QUEUE_STORAGE_KEY)) || {};
    } catch (e) {
      saved = {};
    }
    let addedCount = 0;
    this.defaultTaskSpecs.forEach(spec => {
      const existing = saved[spec.name];
      if (existing && (!existing.builtin || existing.builtinVersion === this.BUILTIN_TASK_VERSION)) return;
      const item = this._buildDefaultTaskItem(spec);
      if (!item) return;
      saved[spec.name] = {
        queue: [item],
        savedAt: Date.now(),
        loopFlag: 1,
        builtin: true,
        builtinVersion: this.BUILTIN_TASK_VERSION
      };
      addedCount += 1;
    });
    if (addedCount > 0) {
      try { localStorage.setItem(this.QUEUE_STORAGE_KEY, JSON.stringify(saved)); }
      catch (e) { console.warn('Failed to seed default tasks:', e.message); }
      this._notifyTaskStoreChanged();
    }
    return addedCount;
  },

  // Setup common params UI
  setupCommonParamsUI() {
    const container = document.getElementById('action-common-params-container');
    const toggle = document.getElementById('common-params-toggle');
    if (!container || !toggle) return;

    // Setup collapsible toggle
    toggle.addEventListener('click', () => {
      const isHidden = container.style.display === 'none';
      container.style.display = isHidden ? 'block' : 'none';
      toggle.querySelector('.collapse-icon').textContent = isHidden ? '▼' : '▶';
    });

    // Generate common params inputs
    container.innerHTML = '';
    this.commonParams.forEach((param, idx) => {
      const div = document.createElement('div');
      div.className = 'action-input-row';

      let inputHtml;
      if (param.type === 'bool') {
        inputHtml = `
          <select id="common-param-${idx}" data-name="${param.name}" data-type="${param.type}">
            <option value="false" ${param.default === 'false' ? 'selected' : ''}>false</option>
            <option value="true" ${param.default === 'true' ? 'selected' : ''}>true</option>
          </select>
        `;
      } else {
        inputHtml = `
          <input type="text" id="common-param-${idx}" value="${param.default}"
                 data-name="${param.name}" data-type="${param.type}" placeholder="${param.desc}">
        `;
      }

      div.innerHTML = `
        <label title="${param.desc}">${this._fieldLabelMarkup(param)}</label>
        ${inputHtml}
      `;
      container.appendChild(div);
    });
  },

  setupEventListeners() {
    // Action type change
    document.getElementById('action-type').addEventListener('change', (e) => {
      this.updateActionForm(e.target.value);
    });

    document.addEventListener('amr:active-robot-changed', () => {
      this._subscribeTaskTelemetry();
      const typeSelect = document.getElementById('action-type');
      if (typeSelect?.value !== '0x08') return;
      this._closeTargetCfgDetails();
      const config = this.actionTypes['0x08'];
      const targetCfgIndex = config.params.findIndex(param => param.name === 'target_cfg');
      if (targetCfgIndex >= 0) this._loadTargetCfgOptions(targetCfgIndex, true);
    });

    // Add to queue button
    document.getElementById('btn-add-to-queue').addEventListener('click', () => {
      this.addToQueue();
    });

    // Send action button
    document.getElementById('btn-send-action').addEventListener('click', () => {
      this.confirmAndSend();
    });

    // Cancel action button
    document.getElementById('btn-cancel-action').addEventListener('click', () => {
      this.cancelAction();
    });

    const librarySearch = document.getElementById('task-library-search');
    librarySearch?.addEventListener('input', () => this.renderTaskLibrary(librarySearch.value));
    document.getElementById('task-yaml-file-select')?.addEventListener('change', event => {
      this._activeTaskSource = event.target.value || this.LOCAL_TASK_SOURCE;
      try {
        localStorage.setItem(this.TASK_FILE_SELECTION_KEY, this._activeTaskSource);
      } catch (error) {
        console.warn('Task YAML selection save failed:', error.message);
      }
      this.refreshSavedQueueList();
    });
    document.getElementById('btn-task-library-refresh')?.addEventListener('click', () => {
      this.refreshSavedQueueList();
      this.renderTaskLibrary(librarySearch?.value || '');
    });
    document.getElementById('btn-new-task')?.addEventListener('click', () => {
      this.openTaskBuilder();
    });
    document.getElementById('btn-quick-task')?.addEventListener('click', () => {
      this.openQuickTaskBuilder();
    });
    document.getElementById('btn-close-quick-task')?.addEventListener('click', () => {
      this.closeQuickTaskBuilder();
    });
    document.getElementById('btn-save-quick-task')?.addEventListener('click', () => {
      this.finishQuickTask(true);
    });
    document.getElementById('btn-run-quick-task')?.addEventListener('click', event => {
      this.saveAndRunQuickTask(event.currentTarget);
    });
    document.getElementById('btn-quick-task-edit')?.addEventListener('click', () => {
      this.finishQuickTask(false);
    });
    document.getElementById('btn-quick-waypoint')?.addEventListener('click', () => {
      this.startQuickMapCapture('waypoint');
    });
    document.getElementById('btn-quick-trajectory')?.addEventListener('click', () => {
      this.startQuickMapCapture('trajectory');
    });
    document.getElementById('btn-quick-trajectory-finish')?.addEventListener('click', () => {
      this.finishQuickTrajectory();
    });
    document.getElementById('btn-quick-docking')?.addEventListener('click', () => {
      this.startQuickMapCapture('docking');
    });
    document.getElementById('btn-quick-standby')?.addEventListener('click', () => {
      this.addQuickStandby();
    });
    document.getElementById('btn-quick-task-undo')?.addEventListener('click', () => {
      this.undoQuickTaskItem();
    });
    document.getElementById('btn-quick-task-clear')?.addEventListener('click', () => {
      this.clearQuickTask();
    });
    document.getElementById('btn-close-task-builder')?.addEventListener('click', () => {
      this.closeTaskBuilder();
    });
    document.getElementById('btn-save-task-builder')?.addEventListener('click', () => {
      this.saveQueue();
    });
    document.getElementById('btn-pause-task')?.addEventListener('click', event => {
      this._controlActiveTask('pause', event.currentTarget);
    });
    document.getElementById('btn-resume-task')?.addEventListener('click', event => {
      this._controlActiveTask('resume', event.currentTarget);
    });
    document.getElementById('btn-cancel-task')?.addEventListener('click', event => {
      this._controlActiveTask('cancel', event.currentTarget);
    });

    // Clear queue button
    document.getElementById('btn-clear-queue').addEventListener('click', () => {
      this.clearQueue();
    });

    // Undo/Redo buttons
    const undoBtn = document.getElementById('btn-undo-queue');
    const redoBtn = document.getElementById('btn-redo-queue');
    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
    if (redoBtn) redoBtn.addEventListener('click', () => this.redo());

    // Queue save/load buttons
    document.getElementById('btn-save-queue').addEventListener('click', () => {
      this.saveQueue();
    });

    document.getElementById('btn-load-queue').addEventListener('click', () => {
      this.loadQueue();
    });

    document.getElementById('action-queue-load-select').addEventListener('change', (event) => {
      const name = event.target.value;
      const entry = this.getSavedQueues()[name];
      const nameInput = document.getElementById('action-queue-save-name');
      const taskIdInput = document.getElementById('action-work-id');
      const loopInput = document.getElementById('action-loop-count');
      const taskId = entry?.yamlTaskId || name;
      if (name && nameInput) nameInput.value = taskId;
      if (name && taskIdInput) taskIdInput.value = taskId;
      if (entry && loopInput) loopInput.value = String(entry.loopFlag ?? 1);
      this.renderTaskDetail(document.getElementById('action-saved-task-detail'), name);
    });

    document.getElementById('btn-delete-saved-queue').addEventListener('click', () => {
      this.deleteSavedQueue();
    });

    // Mission Export/Import
    document.getElementById('btn-export-mission').addEventListener('click', () => {
      this.exportMission();
    });

    document.getElementById('btn-import-mission').addEventListener('click', () => {
      document.getElementById('mission-import-file').click();
    });

    document.getElementById('mission-import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.importMission(file);
        e.target.value = '';
      }
    });

    const taskNameInput = document.getElementById('action-queue-save-name');
    const taskIdInput = document.getElementById('action-work-id');
    let previousTaskName = taskNameInput?.value || '';
    taskNameInput?.addEventListener('input', () => {
      if (taskIdInput && (!taskIdInput.value || taskIdInput.value === previousTaskName)) {
        taskIdInput.value = taskNameInput.value;
      }
      previousTaskName = taskNameInput.value;
    });

    // Loop count hint update
    const loopInput = document.getElementById('action-loop-count');
    const loopHint = document.getElementById('action-loop-hint');
    loopInput.addEventListener('input', () => {
      const v = parseInt(loopInput.value);
      if (v === 0) {
        loopHint.textContent = '무한 반복';
        loopHint.style.color = '#e94560';
      } else if (v === 1 || isNaN(v)) {
        loopHint.textContent = '1회 · 0은 무한 반복';
        loopHint.style.color = '';
      } else {
        loopHint.textContent = `${v}회 반복`;
        loopHint.style.color = '';
      }
    });
  },

  // Get the active robot slot index
  getTargetSlot() {
    return App.activeSlotIndex;
  },

  // Update target robot connection status display (called by App on switch)
  updateTargetStatus() {
    App.updateActionTargetLabel();
    this._updateTaskControlsAvailability();
    this._updateQuickTaskRunAvailability();
    this.renderTaskLibrary(document.getElementById('task-library-search')?.value || '');
  },

  onSlotConnectionChanged(slotIndex, connected) {
    if (slotIndex !== this.getTargetSlot()) return;
    const slot = App.robotSlots?.[slotIndex];
    if (slot && connected) delete slot.taskInterface;
    this.updateTargetStatus();
    this._subscribeTaskTelemetry();
  },

  openQuickTaskBuilder() {
    const libraryView = document.getElementById('task-library-view');
    const builderView = document.getElementById('task-builder-view');
    const quickView = document.getElementById('quick-task-builder-view');
    if (!libraryView || !quickView) return;

    this._exitWaypointSelectMode();
    this._builderMode = 'quick';
    this._editingTaskName = '';
    this._quickTaskItems = [];
    this._quickTrajectoryDraft = [];
    this._quickTaskMode = '';
    this._quickTaskSequence = 0;

    const nameInput = document.getElementById('quick-task-name');
    const loopInput = document.getElementById('quick-task-loop');
    if (nameInput) nameInput.value = `quick_task_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
    if (loopInput) loopInput.value = '1';

    libraryView.hidden = true;
    if (builderView) builderView.hidden = true;
    quickView.hidden = false;
    const mapPanel = document.getElementById('panel-map');
    if (mapPanel?.classList?.contains('collapsed')) {
      document.getElementById('btn-map-panel-expand')?.click();
    }
    this._setQuickTaskMapHudVisible(true);
    this._updateQuickTaskRunAvailability();
    this.renderQuickTask();
    this._setQuickTaskStatus('도구를 선택한 뒤 왼쪽 맵에서 위치를 지정하세요.');
    quickView.scrollIntoView?.({ block: 'start' });
  },

  closeQuickTaskBuilder(force = false) {
    const hasDraft = this._quickTaskItems.length > 0 || this._quickTrajectoryDraft.length > 0;
    if (!force && hasDraft && typeof confirm === 'function'
        && !confirm('작성 중인 Quick Task를 취소하시겠습니까?')) {
      return;
    }
    this._stopQuickMapCapture();
    this._quickTaskItems = [];
    this._quickTrajectoryDraft = [];
    this._syncQuickTaskOverlay();
    this._setQuickTaskMapHudVisible(false);
    const quickView = document.getElementById('quick-task-builder-view');
    const libraryView = document.getElementById('task-library-view');
    if (quickView) quickView.hidden = true;
    if (libraryView) {
      libraryView.hidden = false;
      libraryView.scrollIntoView?.({ block: 'start' });
    }
    this._builderMode = 'list';
    this.refreshSavedQueueList();
  },

  _setQuickTaskMapHudVisible(visible) {
    const hud = document.getElementById('quick-task-map-hud');
    if (hud) hud.hidden = !visible;
  },

  _updateQuickTaskRunAvailability() {
    const button = document.getElementById('btn-run-quick-task');
    if (!button || button.classList.contains('loading')) return;
    const slot = App.robotSlots?.[this.getTargetSlot()];
    button.disabled = !slot?.connected || !slot.ros;
    button.title = button.disabled
      ? '활성 로봇이 연결되면 저장 후 바로 실행할 수 있습니다.'
      : `${slot.robotId}에 현재 Quick Task를 저장 후 실행합니다.`;
  },

  startQuickMapCapture(mode) {
    if (typeof RosManager === 'undefined' || !RosManager.lastMapMsg) {
      this._setQuickTaskStatus('현재 표시할 맵 데이터가 없습니다.', true);
      return;
    }

    if (this._quickTaskMode === 'trajectory' && mode !== 'trajectory'
        && this._quickTrajectoryDraft.length > 0) {
      if (this._quickTrajectoryDraft.length < 2) {
        this._setQuickTaskStatus('Trajectory는 두 점 이상 필요합니다. 완료하거나 마지막 취소를 눌러주세요.', true);
        return;
      }
      this.finishQuickTrajectory();
    } else {
      this._stopQuickMapCapture();
    }

    this._quickTaskMode = mode;
    this._updateQuickTaskToolState();
    RosManager._enterWaypointSelectMode((x, y, theta) => {
      const pose = {
        x: Number(x.toFixed(3)),
        y: Number(y.toFixed(3)),
        theta: Number(theta.toFixed(3))
      };
      if (mode === 'trajectory') {
        this._quickTrajectoryDraft.push(pose);
        this._setQuickTaskStatus(
          `Trajectory 경유점 ${this._quickTrajectoryDraft.length}개 · 계속 찍거나 "Trajectory 완료"를 누르세요.`
        );
        this._syncQuickTaskOverlay();
        this.renderQuickTask();
        return;
      }
      if (mode === 'docking') {
        this._quickTaskItems.push({
          kind: 'docking',
          pose,
          docking: this._readQuickDockingOptions()
        });
        this._setQuickTaskStatus(
          `도킹 시작점 추가: (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}, ${(pose.theta * 180 / Math.PI).toFixed(1)}°)`
        );
      } else {
        this._quickTaskItems.push({ kind: 'waypoint', pose });
        this._setQuickTaskStatus(
          `WayPoint 추가: (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}, ${(pose.theta * 180 / Math.PI).toFixed(1)}°)`
        );
      }
      this._quickTaskSequence += 1;
      this._stopQuickMapCapture();
      this.renderQuickTask();
    });

    const label = mode === 'trajectory'
      ? 'Trajectory 경유점을 순서대로 찍으세요. 마지막 점은 드래그해서 최종 방향을 지정할 수 있습니다.'
      : mode === 'docking'
        ? '맵에서 도킹 주행을 시작할 위치를 클릭하고, 드래그해서 진입 방향을 지정하세요.'
        : '맵에서 WayPoint 위치를 클릭하고, 드래그해서 도착 방향을 지정하세요.';
    this._setQuickTaskStatus(label);
  },

  _stopQuickMapCapture() {
    this._quickTaskMode = '';
    if (typeof RosManager !== 'undefined') RosManager._exitWaypointSelectMode();
    this._updateQuickTaskToolState();
  },

  _updateQuickTaskToolState() {
    const modes = {
      waypoint: 'btn-quick-waypoint',
      trajectory: 'btn-quick-trajectory',
      docking: 'btn-quick-docking'
    };
    Object.entries(modes).forEach(([mode, id]) => {
      document.getElementById(id)?.classList?.toggle('active', this._quickTaskMode === mode);
    });
    const trajectoryButton = document.getElementById('btn-quick-trajectory');
    if (trajectoryButton) {
      trajectoryButton.textContent = this._quickTaskMode === 'trajectory'
        ? '〰 Trajectory 입력 중'
        : '〰 Trajectory 시작';
    }
    const finishButton = document.getElementById('btn-quick-trajectory-finish');
    if (finishButton) {
      finishButton.disabled = this._quickTaskMode !== 'trajectory'
        || this._quickTrajectoryDraft.length < 2;
    }
  },

  finishQuickTrajectory() {
    if (this._quickTrajectoryDraft.length < 2) {
      this._setQuickTaskStatus('Trajectory는 경유점이 두 개 이상 필요합니다.', true);
      return false;
    }
    this._quickTaskItems.push({
      kind: 'trajectory',
      points: JSON.parse(JSON.stringify(this._quickTrajectoryDraft)),
      trajectory: this._readQuickTrajectoryOptions()
    });
    this._quickTaskSequence += 1;
    const pointCount = this._quickTrajectoryDraft.length;
    this._quickTrajectoryDraft = [];
    this._stopQuickMapCapture();
    this._setQuickTaskStatus(`Trajectory 추가 완료: ${pointCount}개 경유점`);
    this.renderQuickTask();
    return true;
  },

  _readQuickTrajectoryOptions() {
    return {
      laneName: document.getElementById('quick-trajectory-lane')?.value?.trim() || 'lane_tmp',
      maxTransVel: Number(document.getElementById('quick-trajectory-velocity')?.value) || 0.7,
      laneType: Number(document.getElementById('quick-trajectory-lane-type')?.value) || 0,
      laneDirection: Number(document.getElementById('quick-trajectory-direction')?.value) || 0
    };
  },

  _readQuickDockingOptions() {
    return {
      isCharge: Number(document.getElementById('quick-dock-charge')?.value) || 0,
      direction: Number(document.getElementById('quick-dock-direction')?.value) || 1,
      scanType: Number(document.getElementById('quick-dock-scan-type')?.value) || 1,
      endCondition: Number(document.getElementById('quick-dock-end-condition')?.value) || 1
    };
  },

  addQuickStandby() {
    if (this._quickTaskMode === 'trajectory' && this._quickTrajectoryDraft.length > 0) {
      if (!this.finishQuickTrajectory()) return;
    }
    const durationInput = document.getElementById('quick-standby-duration');
    const duration = Math.max(0, Number(durationInput?.value));
    if (!Number.isFinite(duration)) {
      this._setQuickTaskStatus('Standby 시간을 확인해주세요.', true);
      return;
    }
    this._quickTaskItems.push({ kind: 'standby', duration });
    this._quickTaskSequence += 1;
    this._setQuickTaskStatus(`Standby ${duration}초 추가`);
    this.renderQuickTask();
  },

  undoQuickTaskItem() {
    if (this._quickTrajectoryDraft.length > 0) {
      this._quickTrajectoryDraft.pop();
      this._setQuickTaskStatus(
        this._quickTrajectoryDraft.length > 0
          ? `Trajectory 경유점 ${this._quickTrajectoryDraft.length}개`
          : 'Trajectory 경유점을 모두 취소했습니다.'
      );
    } else {
      this._quickTaskItems.pop();
      this._setQuickTaskStatus('마지막 항목을 취소했습니다.');
    }
    this.renderQuickTask();
  },

  clearQuickTask() {
    if ((this._quickTaskItems.length > 0 || this._quickTrajectoryDraft.length > 0)
        && typeof confirm === 'function'
        && !confirm('Quick Task 항목을 모두 비우시겠습니까?')) {
      return;
    }
    this._quickTaskItems = [];
    this._quickTrajectoryDraft = [];
    this._stopQuickMapCapture();
    this._setQuickTaskStatus('모든 항목을 비웠습니다.');
    this.renderQuickTask();
  },

  moveQuickTaskItem(index, direction) {
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this._quickTaskItems.length) return;
    const [item] = this._quickTaskItems.splice(index, 1);
    this._quickTaskItems.splice(target, 0, item);
    this.renderQuickTask();
  },

  removeQuickTaskItem(index) {
    if (index < 0 || index >= this._quickTaskItems.length) return;
    this._quickTaskItems.splice(index, 1);
    this.renderQuickTask();
  },

  renderQuickTask() {
    const list = document.getElementById('quick-task-sequence');
    const count = document.getElementById('quick-task-count');
    const undoButton = document.getElementById('btn-quick-task-undo');
    if (count) count.textContent = String(this._quickTaskItems.length);
    if (undoButton) {
      undoButton.disabled = this._quickTaskItems.length === 0
        && this._quickTrajectoryDraft.length === 0;
    }
    this._updateQuickTaskToolState();
    this._syncQuickTaskOverlay();
    if (!list) return;
    list.innerHTML = '';
    if (this._quickTaskItems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'quick-task-empty';
      empty.textContent = this._quickTrajectoryDraft.length > 0
        ? `Trajectory 경유점 ${this._quickTrajectoryDraft.length}개 입력 중`
        : '아직 추가된 항목이 없습니다.';
      list.appendChild(empty);
      return;
    }

    this._quickTaskItems.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `quick-task-item quick-task-item-${item.kind}`;
      const labels = {
        waypoint: {
          icon: '📍',
          title: 'WayPoint',
          detail: `0x01 · x=${item.pose.x}, y=${item.pose.y}, θ=${item.pose.theta}`
        },
        trajectory: {
          icon: '〰',
          title: 'TrajectoryFollowing',
          detail: `0x15 · ${item.points.length} points · ${item.trajectory.laneName}`
        },
        standby: {
          icon: '⏸',
          title: 'Standby',
          detail: `0x07 · ${item.duration} sec`
        },
        docking: {
          icon: '🔌',
          title: '도킹 시작점 + Docking',
          detail: `0x01 → 0x08 · x=${item.pose.x}, y=${item.pose.y}, θ=${item.pose.theta}`
        }
      };
      const label = labels[item.kind];
      row.innerHTML = `
        <span class="quick-task-item-num">${index + 1}</span>
        <span class="quick-task-item-icon">${label.icon}</span>
        <span class="quick-task-item-main"><strong></strong><small></small></span>
        <span class="quick-task-item-actions">
          <button type="button" class="btn-mini quick-item-up" title="위로" ${index === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="btn-mini quick-item-down" title="아래로" ${index === this._quickTaskItems.length - 1 ? 'disabled' : ''}>▼</button>
          <button type="button" class="btn-mini quick-item-remove" title="삭제">✕</button>
        </span>`;
      row.querySelector('.quick-task-item-main strong').textContent = label.title;
      row.querySelector('.quick-task-item-main small').textContent = label.detail;
      row.querySelector('.quick-item-up')?.addEventListener('click', () => this.moveQuickTaskItem(index, -1));
      row.querySelector('.quick-item-down')?.addEventListener('click', () => this.moveQuickTaskItem(index, 1));
      row.querySelector('.quick-item-remove')?.addEventListener('click', () => this.removeQuickTaskItem(index));
      list.appendChild(row);
    });
  },

  _setQuickTaskStatus(message, error = false) {
    const status = document.getElementById('quick-task-status');
    if (status) {
      status.textContent = message;
      status.classList.toggle('error', error);
    }
    const mapStatus = document.getElementById('quick-task-map-hud-status');
    if (mapStatus) mapStatus.textContent = message;
  },

  _syncQuickTaskOverlay() {
    if (typeof RosManager === 'undefined' || typeof RosManager.setQuickTaskOverlay !== 'function') return;
    const overlay = [];
    this._quickTaskItems.forEach((item, itemIndex) => {
      if (item.kind === 'waypoint' || item.kind === 'docking') {
        overlay.push({
          ...item.pose,
          kind: item.kind,
          label: String(itemIndex + 1),
          group: `item-${itemIndex}`
        });
      } else if (item.kind === 'trajectory') {
        item.points.forEach((point, pointIndex) => overlay.push({
          ...point,
          kind: 'trajectory',
          label: `${itemIndex + 1}.${pointIndex + 1}`,
          group: `trajectory-${itemIndex}`
        }));
      }
    });
    this._quickTrajectoryDraft.forEach((point, pointIndex) => overlay.push({
      ...point,
      kind: 'trajectory-draft',
      label: `T${pointIndex + 1}`,
      group: 'trajectory-draft'
    }));
    RosManager.setQuickTaskOverlay(overlay);
  },

  _buildQuickAction(actionType, args, name, overrides = {}) {
    const config = this.actionTypes[actionType];
    const params = (config?.params || []).map(param => ({
      param_name: param.name,
      type: param.type,
      value: String(Object.prototype.hasOwnProperty.call(overrides, param.name)
        ? overrides[param.name]
        : param.default ?? '')
    }));
    return {
      name,
      actionType,
      args: Array.from(args || []),
      params,
      summary: `${name}: ${config?.name || actionType}`,
      missionId: 'quick_mission',
      missionIndex: 0
    };
  },

  compileQuickTaskItems(items = this._quickTaskItems) {
    const actions = [];
    let waypointIndex = 0;
    let trajectoryIndex = 0;
    let standbyIndex = 0;
    let dockingIndex = 0;
    (items || []).forEach(item => {
      if (item.kind === 'waypoint') {
        waypointIndex += 1;
        actions.push(this._buildQuickAction(
          '0x01',
          [item.pose.x, item.pose.y, item.pose.theta],
          `WayPoint_${waypointIndex}`
        ));
      } else if (item.kind === 'trajectory') {
        trajectoryIndex += 1;
        const finalTheta = item.points.at(-1)?.theta || 0;
        const args = item.points.flatMap(point => [point.x, point.y]);
        args.push(finalTheta);
        actions.push(this._buildQuickAction(
          '0x15',
          args,
          `Trajectory_${trajectoryIndex}`,
          {
            lane_name: item.trajectory?.laneName || 'lane_tmp',
            max_trans_vel: item.trajectory?.maxTransVel ?? 0.7,
            lane_type: item.trajectory?.laneType ?? 1,
            lane_direction: item.trajectory?.laneDirection ?? 0,
            backward_driving: Number(item.trajectory?.laneDirection) === 3
          }
        ));
      } else if (item.kind === 'standby') {
        standbyIndex += 1;
        actions.push(this._buildQuickAction(
          '0x07',
          [item.duration],
          `Standby_${standbyIndex}`
        ));
      } else if (item.kind === 'docking') {
        dockingIndex += 1;
        actions.push(this._buildQuickAction(
          '0x01',
          [item.pose.x, item.pose.y, item.pose.theta],
          `Dock_Start_${dockingIndex}`
        ));
        const dock = item.docking || {};
        actions.push(this._buildQuickAction(
          '0x08',
          [
            dock.isCharge ?? 0,
            dock.direction ?? 1,
            dock.scanType ?? 1,
            dock.endCondition ?? 1
          ],
          `Docking_${dockingIndex}`
        ));
      }
    });
    return actions;
  },

  finishQuickTask(saveNow = true) {
    if (this._quickTrajectoryDraft.length > 0 && !this.finishQuickTrajectory()) return false;
    const name = document.getElementById('quick-task-name')?.value?.trim() || '';
    if (!name) {
      this._setQuickTaskStatus('Task 이름을 입력하세요.', true);
      return false;
    }
    const actions = this.compileQuickTaskItems();
    if (actions.length === 0) {
      this._setQuickTaskStatus('Task에 항목을 하나 이상 추가하세요.', true);
      return false;
    }

    this._stopQuickMapCapture();
    this.actionQueue = actions;
    this._undoStack = [];
    this._redoStack = [];
    const queueName = document.getElementById('action-queue-save-name');
    const taskId = document.getElementById('action-work-id');
    const loopInput = document.getElementById('action-loop-count');
    if (queueName) queueName.value = name;
    if (taskId) taskId.value = name;
    if (loopInput) loopInput.value = String(
      Math.max(0, Number(document.getElementById('quick-task-loop')?.value) || 0)
    );
    this._editingTaskName = '';
    this._builderMode = 'create';
    this.renderQueue();
    this._updateUndoRedoButtons();
    this._quickTaskItems = [];
    this._quickTrajectoryDraft = [];
    this._syncQuickTaskOverlay();
    this._setQuickTaskMapHudVisible(false);

    if (saveNow) return this.saveQueue();

    const quickView = document.getElementById('quick-task-builder-view');
    const builderView = document.getElementById('task-builder-view');
    const title = document.getElementById('task-builder-title');
    if (quickView) quickView.hidden = true;
    if (builderView) {
      builderView.hidden = false;
      builderView.scrollIntoView?.({ block: 'start' });
    }
    if (title) title.textContent = `Task 상세 편집 · ${name}`;
    App.toast('Quick Task를 일반 편집기로 넘겼습니다.', 'success');
    return true;
  },

  async saveAndRunQuickTask(button) {
    const slot = App.robotSlots?.[this.getTargetSlot()];
    if (!slot?.connected || !slot.ros) {
      this._setQuickTaskStatus('활성 로봇이 연결되어 있지 않습니다.', true);
      return false;
    }
    const saved = this.finishQuickTask(true);
    if (!saved) return false;
    const storageKey = document.getElementById('action-queue-load-select')?.value;
    if (!storageKey) {
      App.toast('저장된 Quick Task를 찾을 수 없습니다.', 'error');
      return false;
    }
    await this.runSavedTask(storageKey, button);
    return true;
  },

  openTaskBuilder(taskName = '') {
    const libraryView = document.getElementById('task-library-view');
    const builderView = document.getElementById('task-builder-view');
    const quickView = document.getElementById('quick-task-builder-view');
    if (!libraryView || !builderView) return;

    this._stopQuickMapCapture();
    this._syncQuickTaskOverlay();
    this._setQuickTaskMapHudVisible(false);
    this._builderMode = taskName ? 'edit' : 'create';
    this._editingTaskName = taskName || '';
    const title = document.getElementById('task-builder-title');
    const entry = taskName ? this.getSavedQueues()[taskName] : null;
    const displayName = entry?.yamlTaskId || taskName;
    if (title) title.textContent = taskName ? `Task 수정 · ${displayName}` : '새 Task 만들기';

    if (taskName) {
      this.loadSavedQueue(taskName, { silent: true });
    } else {
      this.actionQueue = [];
      this._undoStack = [];
      this._redoStack = [];
      this.renderQueue();
      this._updateUndoRedoButtons();
      const nameInput = document.getElementById('action-queue-save-name');
      const taskIdInput = document.getElementById('action-work-id');
      const loopInput = document.getElementById('action-loop-count');
      const savedSelect = document.getElementById('action-queue-load-select');
      if (nameInput) nameInput.value = '';
      if (taskIdInput) taskIdInput.value = '';
      if (loopInput) loopInput.value = '1';
      if (savedSelect) savedSelect.value = '';
    }

    libraryView.hidden = true;
    if (quickView) quickView.hidden = true;
    builderView.hidden = false;
    builderView.scrollIntoView?.({ block: 'start' });
  },

  closeTaskBuilder() {
    const libraryView = document.getElementById('task-library-view');
    const builderView = document.getElementById('task-builder-view');
    const quickView = document.getElementById('quick-task-builder-view');
    if (!libraryView || !builderView) return;
    this._stopQuickMapCapture();
    this._quickTaskItems = [];
    this._quickTrajectoryDraft = [];
    this._syncQuickTaskOverlay();
    this._setQuickTaskMapHudVisible(false);
    builderView.hidden = true;
    if (quickView) quickView.hidden = true;
    libraryView.hidden = false;
    this._builderMode = 'list';
    this._editingTaskName = '';
    this.refreshSavedQueueList();
    libraryView.scrollIntoView?.({ block: 'start' });
  },

  _updateTaskControlsAvailability() {
    const slot = App.robotSlots?.[this.getTargetSlot()];
    const disabled = !slot?.connected || !slot.ros;
    ['btn-pause-task', 'btn-resume-task', 'btn-cancel-task'].forEach(id => {
      const button = document.getElementById(id);
      if (button && !button.classList.contains('loading')) button.disabled = disabled;
    });
  },

  updateActionForm(actionType) {
    const config = this.actionTypes[actionType];
    if (!config) return;

    // Exit waypoint select mode when changing action type
    this._exitWaypointSelectMode();

    // Update args container
    const argsContainer = document.getElementById('action-args-container');
    argsContainer.innerHTML = '';

    config.args.forEach((arg, idx) => {
      const div = document.createElement('div');
      const inputHtml = Array.isArray(arg.enumValues)
        ? `<select id="action-arg-${idx}">
            ${arg.enumValues.map(option =>
              `<option value="${option.value}" ${Number(option.value) === Number(arg.default) ? 'selected' : ''}>${option.label}</option>`
            ).join('')}
          </select>`
        : `<input type="number" step="any" id="action-arg-${idx}" value="${arg.default}"
                  ${arg.min !== undefined ? `min="${arg.min}"` : ''}
                  ${arg.max !== undefined ? `max="${arg.max}"` : ''}
                  placeholder="${arg.desc}">`;
      div.className = 'action-input-row';
      div.innerHTML = `
        <label title="${arg.desc}">${this._fieldLabelMarkup(arg)}</label>
        ${inputHtml}
      `;
      argsContainer.appendChild(div);
    });

    // Add position helper buttons for Way_Point (0x01) and Change_Map (0x17)
    if (actionType === '0x01' || actionType === '0x17') {
      const helperDiv = document.createElement('div');
      helperDiv.className = 'action-input-row action-position-helpers';
      helperDiv.innerHTML = `
        <button type="button" id="btn-waypoint-from-map" class="btn btn-small" title="Select coordinates from map">📍 Pick from Map</button>
        <button type="button" id="btn-waypoint-from-robot" class="btn btn-small" title="Use current robot position">📌 Robot Position</button>
      `;
      argsContainer.appendChild(helperDiv);

      // Setup event listeners for helper buttons
      setTimeout(() => this._setupWaypointHelperButtons(), 0);
    }

    // Update params container
    const paramsContainer = document.getElementById('action-params-container');
    paramsContainer.innerHTML = '';

    if (config.params.length === 0) {
      paramsContainer.innerHTML = '<p class="no-params">No parameters for this action</p>';
    } else {
      config.params.forEach((param, idx) => {
        const div = document.createElement('div');
        div.className = 'action-input-row';

        let inputHtml;
        if (param.type === 'bool') {
          inputHtml = `
            <select id="action-param-${idx}" data-name="${param.name}" data-type="${param.type}">
              <option value="true" ${param.default === 'true' ? 'selected' : ''}>true</option>
              <option value="false" ${param.default === 'false' ? 'selected' : ''}>false</option>
            </select>
          `;
        } else if (actionType === '0x08' && param.name === 'target_cfg') {
          inputHtml = `
            <div class="target-cfg-control" data-param-index="${idx}">
              <select id="action-param-${idx}-cfg-list" class="target-cfg-list"
                      aria-label="현재 로봇 모델의 도킹 cfg 목록">
                <option value="">현재 로봇 CFG 확인 중...</option>
              </select>
              <button type="button" id="btn-target-cfg-refresh" class="btn btn-small"
                      title="현재 활성 로봇에서 cfg 목록을 다시 읽습니다">새로고침</button>
              <button type="button" id="btn-target-cfg-manual" class="btn btn-small"
                      aria-pressed="false">직접 입력</button>
              <input type="text" id="action-param-${idx}" value="${param.default}"
                     class="target-cfg-manual-input" hidden
                     data-name="${param.name}" data-type="${param.type}" placeholder="${param.desc}">
              <button type="button" id="btn-target-cfg-details" class="btn btn-small target-cfg-details-toggle"
                      aria-expanded="false">더 자세히 보기</button>
              <div id="target-cfg-details" class="target-cfg-details" hidden>
                <div class="target-cfg-details-header">
                  <strong>공통 도킹 CFG 전체 목록</strong>
                  <code>~/catkin_ws/src/core_docking/sp2_docking/src/sp2_docking/cfg</code>
                </div>
                <select id="action-param-${idx}-core-cfg-list" class="target-cfg-core-list"
                        size="7" aria-label="core_docking 전체 cfg 목록">
                  <option value="">더 자세히 보기를 누르면 불러옵니다.</option>
                </select>
                <small id="target-cfg-details-status">목록에서 선택하면 target_cfg에 바로 반영됩니다.</small>
              </div>
              <small id="target-cfg-status" class="target-cfg-status">현재 활성 로봇의 모델을 확인하고 있습니다.</small>
            </div>
          `;
        } else {
          inputHtml = `
            <input type="text" id="action-param-${idx}" value="${param.default}"
                   data-name="${param.name}" data-type="${param.type}" placeholder="${param.desc}">
          `;
        }

        div.innerHTML = `
          <label title="${param.desc}">
            ${this._fieldLabelMarkup(param)}
            <small class="action-field-type">${param.type}</small>
          </label>
          ${inputHtml}
        `;
        paramsContainer.appendChild(div);
      });
    }

    // Apply saved values after form is rendered
    this.applySavedParams(actionType);

    if (actionType === '0x08') {
      const targetCfgIndex = config.params.findIndex(param => param.name === 'target_cfg');
      if (targetCfgIndex >= 0) {
        this._setupTargetCfgControl(targetCfgIndex);
        this._loadTargetCfgOptions(targetCfgIndex);
      }
    }
  },

  // Read current form values and return an action object
  readCurrentAction() {
    const actionType = document.getElementById('action-type').value;
    const config = this.actionTypes[actionType];
    if (!config) return null;

    const actionArgs = [];
    config.args.forEach((arg, idx) => {
      const input = document.getElementById(`action-arg-${idx}`);
      actionArgs.push(parseFloat(input.value) || 0);
    });

    const actionParams = [];
    config.params.forEach((param, idx) => {
      const input = document.getElementById(`action-param-${idx}`);
      actionParams.push({
        param_name: input.dataset.name,
        type: input.dataset.type,
        value: input.value
      });
    });

    // Add common params (only if changed from default)
    this.commonParams.forEach((param, idx) => {
      const input = document.getElementById(`common-param-${idx}`);
      if (input && input.value !== param.default) {
        actionParams.push({
          param_name: param.name,
          type: param.type,
          value: input.value
        });
      }
    });

    // Build summary string
    const argSummary = config.args.map((arg, idx) => `${arg.name}:${actionArgs[idx]}`).join(', ');
    const summary = `${config.name} (${argSummary})`;

    const action = this.normalizeActionForSend({
      actionType,
      args: actionArgs,
      params: actionParams,
      summary
    });
    if (actionType === '0x18') action.conveyorFloor = Number(actionArgs[1]) || 1;
    return action;
  },

  normalizeActionForSend(action) {
    if (!action) return action;

    const actionType = parseInt(action.actionType !== undefined ? action.actionType : action.action_type);
    const args = action.args || action.action_args || [];
    let params = action.params || action.action_params || [];

    if (actionType === 0x08) {
      const scanType = parseInt(args[2]);
      params = params.filter((param) => {
        if (!param || param.param_name !== 'target_id') return true;

        const targetId = String(param.value || '').trim();
        return scanType === 5 && targetId.length > 0;
      });
    }

    if (action.params) {
      action.params = params;
    }
    if (action.action_params) {
      action.action_params = params;
    }

    return action;
  },

  addToQueue() {
    const item = this.readCurrentAction();
    if (!item) return;

    // Get action name from input or generate default
    const nameInput = document.getElementById('action-name');
    let actionName = nameInput ? nameInput.value.trim() : '';

    if (!actionName) {
      // Auto-generate name: ActionName_N
      const config = this.actionTypes[item.actionType];
      const baseName = config ? config.name : 'Action';
      if (!this._actionNameCounters[baseName]) {
        this._actionNameCounters[baseName] = 0;
      }
      this._actionNameCounters[baseName]++;
      actionName = `${baseName}_${this._actionNameCounters[baseName]}`;
    }

    item.name = actionName;
    item.summary = `${actionName}: ${item.summary.split('(')[1] ? '(' + item.summary.split('(')[1] : ''}`;

    this._saveSnapshot();
    this.actionQueue.push(item);
    this.renderQueue();

    // Clear name input for next action
    if (nameInput) nameInput.value = '';

    App.toast(`Added to queue: ${actionName}`, 'info');
  },

  removeFromQueue(index) {
    if (index < 0 || index >= this.actionQueue.length) return;
    this._saveSnapshot();
    this.actionQueue.splice(index, 1);
    this.renderQueue();
  },

  duplicateAction(index) {
    if (index < 0 || index >= this.actionQueue.length) return;
    this._saveSnapshot();
    const source = this.actionQueue[index];
    const copy = JSON.parse(JSON.stringify(source));
    const originalName = copy.name || copy.action_id || `Action_${index + 1}`;
    const existingNames = new Set(this.actionQueue.map(item => item.name || item.action_id));
    let copyName = `${originalName}_copy`;
    let suffix = 2;
    while (existingNames.has(copyName)) {
      copyName = `${originalName}_copy${suffix}`;
      suffix += 1;
    }
    copy.name = copyName;
    if (copy.action_id !== undefined) copy.action_id = copyName;
    const config = this.actionTypes[this._actionTypeKey(copy)];
    copy.summary = `${copyName}: ${config?.name || this._actionTypeKey(copy)}`;
    this.actionQueue.splice(index + 1, 0, copy);
    this.renderQueue();
    App.toast(`Action "${originalName}"을 복사했습니다.`, 'success');
  },

  _saveSnapshot() {
    this._undoStack.push(JSON.stringify(this.actionQueue));
    if (this._undoStack.length > this._maxUndoStack) this._undoStack.shift();
    this._redoStack = [];
    this._updateUndoRedoButtons();
  },

  _updateUndoRedoButtons() {
    const undoBtn = document.getElementById('btn-undo-queue');
    const redoBtn = document.getElementById('btn-redo-queue');
    if (undoBtn) undoBtn.disabled = this._undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this._redoStack.length === 0;
  },

  undo() {
    if (this._undoStack.length === 0) return;
    this._redoStack.push(JSON.stringify(this.actionQueue));
    this.actionQueue = JSON.parse(this._undoStack.pop());
    this.renderQueue();
    this._updateUndoRedoButtons();
  },

  redo() {
    if (this._redoStack.length === 0) return;
    this._undoStack.push(JSON.stringify(this.actionQueue));
    this.actionQueue = JSON.parse(this._redoStack.pop());
    this.renderQueue();
    this._updateUndoRedoButtons();
  },

  clearQueue() {
    this._saveSnapshot();
    this.actionQueue = [];
    this.renderQueue();
  },

  moveInQueue(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this.actionQueue.length) return;
    this._saveSnapshot();
    const temp = this.actionQueue[index];
    this.actionQueue[index] = this.actionQueue[newIndex];
    this.actionQueue[newIndex] = temp;
    this.renderQueue();
  },

  renderQueue() {
    const listEl = document.getElementById('action-queue-list');
    const countEl = document.getElementById('action-queue-count');
    countEl.textContent = this.actionQueue.length;

    if (this.actionQueue.length === 0) {
      listEl.innerHTML = '<p class="action-queue-empty">위에서 Action을 선택해 Task에 추가하세요.</p>';
      return;
    }

    let html = '';
    this.actionQueue.forEach((item, idx) => {
      const typeKey = this._actionTypeKey(item);
      html += `<div class="action-queue-item" data-idx="${idx}" title="Double-click to edit">
        <span class="action-queue-num">${idx + 1}.</span>
        <span class="action-queue-type">${typeKey || '--'}</span>
        <span class="action-queue-summary">${item.summary}</span>
        <span class="action-queue-actions">
          <button class="btn-mini" onclick="ActionSender.moveInQueue(${idx}, -1)" title="Up" ${idx === 0 ? 'disabled' : ''}>&#9650;</button>
          <button class="btn-mini" onclick="ActionSender.moveInQueue(${idx}, 1)" title="Down" ${idx === this.actionQueue.length - 1 ? 'disabled' : ''}>&#9660;</button>
          <button class="btn-mini" onclick="ActionSender.duplicateAction(${idx})" title="Action 복사">복사</button>
          <button class="btn-mini" onclick="ActionSender.removeFromQueue(${idx})" title="Remove" style="color:#ff6b6b;">&#10005;</button>
        </span>
      </div>`;
    });
    listEl.innerHTML = html;

    // Add double-click event to load action into form
    listEl.querySelectorAll('.action-queue-item').forEach(el => {
      el.addEventListener('dblclick', (e) => {
        // Ignore if clicked on buttons
        if (e.target.closest('.btn-mini')) return;
        const idx = parseInt(el.dataset.idx);
        this.loadActionToForm(idx);
      });
    });
  },

  // Load action from queue into the form for editing
  loadActionToForm(index) {
    if (index < 0 || index >= this.actionQueue.length) return;
    const item = this.actionQueue[index];

    // Set action type
    const typeSelect = document.getElementById('action-type');
    typeSelect.value = item.actionType;
    this.updateActionForm(item.actionType);

    // Set args
    const config = this.actionTypes[item.actionType];
    if (config && item.args) {
      const formArgs = item.actionType === '0x15' && item.args.length > 3
        ? [item.args[0], item.args[1], item.args.at(-1)]
        : item.args;
      config.args.forEach((arg, i) => {
        const el = document.getElementById(`action-arg-${i}`);
        if (el && formArgs[i] !== undefined) el.value = formArgs[i];
      });
    }

    // Set params
    if (config && item.params) {
      item.params.forEach((param, i) => {
        const el = document.getElementById(`action-param-${i}`);
        if (el) el.value = param.value;
      });
      this._syncTargetCfgControl();
    }

    // Highlight the selected item
    document.querySelectorAll('.action-queue-item').forEach(el => el.classList.remove('editing'));
    const itemEl = document.querySelector(`.action-queue-item[data-idx="${index}"]`);
    if (itemEl) itemEl.classList.add('editing');

    App.toast(`Action #${index + 1} loaded - Edit and Add to Queue`, 'info');
  },

  // Check if robot is currently charging
  isRobotCharging() {
    const gauge = document.getElementById('bms-gauge-fill');
    if (!gauge) return false;
    return gauge.parentElement.classList.contains('charging');
  },

  // Confirm before sending
  confirmAndSend() {
    // Check charging status
    if (this.isRobotCharging()) {
      App.toast('Cannot send action while charging. Disconnect charger first.', 'error', 5000);
      this.showResult('Error: Robot is charging. Disconnect charger before sending.', true);
      return;
    }

    const actionCount = this.actionQueue.length > 0 ? this.actionQueue.length : 1;
    const loopRaw = parseInt(document.getElementById('action-loop-count').value);
    const loopCount = isNaN(loopRaw) ? 1 : loopRaw;
    const slotIndex = this.getTargetSlot();
    const robotId = RosManager.getRobotId(slotIndex) || '(none)';
    const loopInfo = loopCount === 0 ? ' (INFINITE LOOP)' : loopCount > 1 ? ` x${loopCount} loops` : '';
    const msg = `Send ${actionCount} action(s)${loopInfo} to ${robotId}?`;

    if (!confirm(msg)) return;

    this.sendAction();
  },

  async sendAction() {
    const sendButton = document.getElementById('btn-send-action');
    const slotIndex = this.getTargetSlot();
    const ros = RosManager.getRos(slotIndex);

    if (!ros) {
      const robotLabel = slotIndex >= 0 && App.robotSlots[slotIndex] ? App.robotSlots[slotIndex].robotId : '(none)';
      this.showResult(`Error: ${robotLabel} ROS is not connected`, true);
      App.addEvent('action', 'Send failed', 'ROS not connected', 'error');
      return;
    }

    const taskId = document.getElementById('action-work-id').value || 'test_task';
    const robotId = RosManager.getRobotId(slotIndex) || 'R_001';

    // Build actions array: use queue if non-empty, otherwise single current action
    let actions;
    if (this.actionQueue.length > 0) {
      actions = this.actionQueue.map(item => {
        const rawType = item.actionType !== undefined ? item.actionType : item.action_type;
        return this.normalizeActionForSend({
          action_type: parseInt(rawType),
          action_args: item.args || item.action_args || [],
          action_params: item.params || item.action_params || [],
          conveyorFloor: item.conveyorFloor
        });
      });
    } else {
      const current = this.readCurrentAction();
      if (!current) return;
      actions = [this.normalizeActionForSend({
        action_type: parseInt(current.actionType),
        action_args: current.args,
        action_params: current.params,
        conveyorFloor: current.conveyorFloor
      })];
      // Save current params before sending (single action mode)
      this.saveLastParams(current.actionType);
    }

    try {
      const slot = App.robotSlots?.[slotIndex] || { ros, robotId };
      actions = await this._prepareActionsForSlot(actions, slot);
    } catch (error) {
      const message = `컨베이어 명령 준비 실패: ${error.message}`;
      this.showResult(message, true);
      App.addEvent('action', 'Send failed', message, 'error');
      return;
    }

    const loopRaw = parseInt(document.getElementById('action-loop-count').value);
    const loopCount = isNaN(loopRaw) ? 1 : loopRaw;
    const loopLabel = loopCount === 0 ? 'infinite' : `${loopCount}`;

    const mission = {
      mission_id: taskId + '_mission',
      actions: actions
    };

    const request = {
      task_id: taskId,
      loop_flag: loopCount,
      missions: [mission]
    };

    let serviceName = `/${robotId}/TARU/goal`;
    App.setButtonLoading(sendButton, true, 'Sending');
    // Record to action history
    const currentForHistory = this.readCurrentAction();
    if (currentForHistory && typeof ActionHistory !== 'undefined') ActionHistory.record(currentForHistory);

    // Test mode: intercept service call, simulate success + robot movement
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      try {
        const simResult = await TestMode.runTask(slotIndex, request);
        this.showResult(`[TestMode] Simulated Success!\nTask ID: ${taskId} (${actions.length} action(s))\nTarget: ${robotId}\n\nResponse:\n${JSON.stringify(simResult, null, 2)}`);
        App.addEvent('action', `Send success (${taskId}, ${actions.length} actions)`, `${serviceName} [${robotId}] [TestMode]`, 'success');
      } catch (error) {
        this.showResult(`[TestMode] 실행 실패: ${error.message || error}`, true);
        App.addEvent('action', `Send failed (${taskId})`, String(error), 'error');
      } finally {
        App.setButtonLoading(sendButton, false);
      }
      return; // skip real service call
    }

    try {
      const slot = App.robotSlots?.[slotIndex] || { ros, robotId };
      const taskInterface = await this._resolveTaskInterface(slot);
      serviceName = taskInterface.goalName;
      this.showResult(`[${robotId}] Sending to ${serviceName} (${actions.length} action(s), loop: ${loopLabel}):\n${JSON.stringify(request, null, 2)}`);
      const result = await this._callTaskService(ros, serviceName, taskInterface.goalType, request);
      if (result.success) {
        this.showResult(`Success!\nTask ID: ${taskId} (${actions.length} action(s))\nTarget: ${robotId}\n\nResponse:\n${JSON.stringify(result, null, 2)}`);
        App.addEvent('action', `Send success (${taskId}, ${actions.length} actions)`, `${serviceName} [${robotId}]`, 'success');
        // Audit log
        if (typeof App !== 'undefined' && App.logAudit) {
          App.logAudit('action_send', { taskId, robotId, actionCount: actions.length, actionTypes: actions.map(a => a.action_type) });
        }
      } else {
        this.showResult(`Failed!\nError code: ${result.error_code}\nMessage: ${result.message}`, true);
        App.addEvent('action', `Send failed (${taskId})`, result.message || 'Execution failed', 'error');
      }
    } catch (error) {
      this.showResult(`Service call failed: ${error}`, true);
      App.addEvent('action', `Send failed (${taskId})`, String(error), 'error');
    } finally {
      App.setButtonLoading(sendButton, false);
    }
  },

  async cancelAction() {
    const slotIndex = this.getTargetSlot();
    const ros = RosManager.getRos(slotIndex);

    if (!ros) {
      const robotLabel = slotIndex >= 0 && App.robotSlots[slotIndex] ? App.robotSlots[slotIndex].robotId : '(none)';
      this.showResult(`Error: ${robotLabel} ROS is not connected`, true);
      App.addEvent('action', 'Cancel failed', 'ROS not connected', 'error');
      return;
    }

    const robotId = RosManager.getRobotId(slotIndex) || 'R_001';

    // Test mode: stop navigation + CANCEL then IDLE, skip real service call
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      await TestMode.controlTask(slotIndex, 'cancel');
      this.showResult('[TestMode] Action cancelled');
      this._setTaskExecutionFeedback('idle', `${robotId} · Task 취소됨 · 대기`);
      App.addEvent('action', 'Cancel success', `${robotId} [TestMode]`, 'success');
      return;
    }

    try {
      await this.cancelTaskOnSlot(slotIndex);
      this.showResult('Action cancelled successfully');
      this._setTaskExecutionFeedback('idle', `${robotId} · Task 취소됨 · 대기`);
      App.addEvent('action', 'Cancel success', robotId, 'success');
    } catch (error) {
      this.showResult(`Cancel service call failed: ${error}`, true);
      App.addEvent('action', 'Cancel failed', String(error), 'error');
    }
  },

  // Queue save/load from localStorage
  saveQueue() {
    const nameInput = document.getElementById('action-queue-save-name');
    const name = nameInput.value.trim();
    if (!name) {
      App.toast('Task 이름을 입력하세요.', 'error');
      return false;
    }
    if (this.actionQueue.length === 0) {
      App.toast('Task에 Action을 하나 이상 추가하세요.', 'error');
      return false;
    }

    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(this.QUEUE_STORAGE_KEY)) || {};
    } catch (e) {
      saved = {};
    }

    const previousKey = this._editingTaskName;
    const previousEntry = previousKey ? saved[previousKey] : null;
    const sourceFile = previousEntry?.importedFrom
      || (this._activeTaskSource !== this.LOCAL_TASK_SOURCE ? this._activeTaskSource : '');
    const duplicateKey = Object.keys(saved).find(key => {
      if (key === previousKey) return false;
      const entry = saved[key];
      return (entry.yamlTaskId || key) === name
        && (entry.importedFrom || '') === sourceFile;
    });
    if (duplicateKey && !confirm(`"${name}" Task가 이미 있습니다. 덮어쓰시겠습니까?`)) {
      return false;
    }

    let storageKey = previousKey || duplicateKey || name;
    if (!previousKey && !duplicateKey && Object.prototype.hasOwnProperty.call(saved, storageKey)) {
      const sourceLabel = sourceFile || 'local';
      storageKey = `${name} (${sourceLabel})`;
      let suffix = 2;
      while (Object.prototype.hasOwnProperty.call(saved, storageKey)) {
        storageKey = `${name} (${sourceLabel} ${suffix})`;
        suffix += 1;
      }
    }
    if (duplicateKey && duplicateKey !== storageKey) delete saved[duplicateKey];
    saved[storageKey] = {
      ...(previousEntry || {}),
      queue: this.actionQueue,
      savedAt: Date.now(),
      loopFlag: Math.max(0, Math.min(9999, parseInt(document.getElementById('action-loop-count')?.value, 10) || 0)),
      yamlTaskId: name,
      ...(sourceFile ? { importedFrom: sourceFile } : {})
    };

    try {
      localStorage.setItem(this.QUEUE_STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
      console.warn('localStorage.setItem QUEUE_STORAGE_KEY failed:', error.message);
      App.toast(`Task 저장 실패: ${error.message}`, 'error');
      return false;
    }
    this.refreshSavedQueueList();
    const select = document.getElementById('action-queue-load-select');
    if (select) select.value = storageKey;
    const taskIdInput = document.getElementById('action-work-id');
    if (taskIdInput) taskIdInput.value = name;
    this.renderTaskDetail(document.getElementById('action-saved-task-detail'), storageKey);
    this._notifyTaskStoreChanged();
    App.toast(`Task "${name}"을 저장했습니다 (${this.actionQueue.length} Actions)`, 'success');
    if (this._builderMode !== 'list') this.closeTaskBuilder();
    return true;
  },

  loadQueue() {
    const select = document.getElementById('action-queue-load-select');
    const name = select.value;
    if (!name) {
      App.toast('Select a queue to load', 'error');
      return;
    }
    this.loadSavedQueue(name);
  },

  loadSavedQueue(name, options = {}) {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(this.QUEUE_STORAGE_KEY)) || {};
    } catch (e) {
      App.toast('Failed to load saved queues', 'error');
      return;
    }

    const entry = saved[name];
    if (!entry || !entry.queue) {
      App.toast('Queue not found', 'error');
      return;
    }

    this.actionQueue = JSON.parse(JSON.stringify(entry.queue));
    this.renderQueue();
    const nameInput = document.getElementById('action-queue-save-name');
    const taskIdInput = document.getElementById('action-work-id');
    const loopInput = document.getElementById('action-loop-count');
    const taskId = entry.yamlTaskId || name;
    if (entry.importedFrom) this._activeTaskSource = entry.importedFrom;
    if (nameInput) nameInput.value = taskId;
    if (taskIdInput) taskIdInput.value = taskId;
    if (loopInput) loopInput.value = String(entry.loopFlag ?? 1);
    this.renderTaskDetail(document.getElementById('action-saved-task-detail'), name);
    const select = document.getElementById('action-queue-load-select');
    if (select) select.value = name;
    if (!options.silent) {
      App.toast(`Task "${taskId}"을 편집기에 불러왔습니다 (${this.actionQueue.length} Actions)`, 'success');
    }
  },

  deleteSavedQueue() {
    const select = document.getElementById('action-queue-load-select');
    const name = select.value;
    if (!name) {
      App.toast('Select a queue to delete', 'error');
      return;
    }

    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(this.QUEUE_STORAGE_KEY)) || {};
    } catch (e) {
      saved = {};
    }

    const displayName = saved[name]?.yamlTaskId || name;
    delete saved[name];
    // B13 fix: localStorage 안전 쓰기
    try { localStorage.setItem(this.QUEUE_STORAGE_KEY, JSON.stringify(saved)); }
    catch (e) { console.warn('localStorage.setItem QUEUE_STORAGE_KEY failed:', e.message); }
    this.refreshSavedQueueList();
    this._notifyTaskStoreChanged();
    App.toast(`Task "${displayName}"을 삭제했습니다`, 'success');
  },

  refreshSavedQueueList() {
    const select = document.getElementById('action-queue-load-select');
    if (!select) return;

    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(this.QUEUE_STORAGE_KEY)) || {};
    } catch (e) {
      saved = {};
    }

    this._refreshTaskFileSelect(saved);
    const visibleNames = this._getVisibleTaskKeys(saved);
    const previous = select.value;
    select.innerHTML = '<option value="">-- 저장 Task --</option>';
    visibleNames.forEach(name => {
      const entry = saved[name];
      const count = entry.queue ? entry.queue.length : 0;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = `${entry.yamlTaskId || name} (${count})`;
      select.appendChild(opt);
    });
    if (visibleNames.includes(previous)) select.value = previous;
    this.renderTaskDetail(document.getElementById('action-saved-task-detail'), select.value);
    if (typeof JogControl !== 'undefined' && JogControl.refreshQuickTaskOptions) {
      JogControl.refreshQuickTaskOptions();
    }
    const search = document.getElementById('task-library-search');
    this.renderTaskLibrary(search?.value || '');
  },

  getSavedQueues() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.QUEUE_STORAGE_KEY)) || {};
      return saved && typeof saved === 'object' ? saved : {};
    } catch (e) {
      return {};
    }
  },

  getSavedQueueNames() {
    return Object.keys(this.getSavedQueues()).sort((a, b) => a.localeCompare(b));
  },

  _getTaskSources(saved = this.getSavedQueues()) {
    return Array.from(new Set(
      Object.values(saved)
        .map(entry => entry?.importedFrom)
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
  },

  _getVisibleTaskKeys(saved = this.getSavedQueues()) {
    const source = this._activeTaskSource || this.LOCAL_TASK_SOURCE;
    return Object.keys(saved)
      .filter(key => source === this.LOCAL_TASK_SOURCE
        ? !saved[key]?.importedFrom
        : saved[key]?.importedFrom === source)
      .sort((a, b) => {
        const aName = saved[a]?.yamlTaskId || a;
        const bName = saved[b]?.yamlTaskId || b;
        return aName.localeCompare(bName);
      });
  },

  _refreshTaskFileSelect(saved = this.getSavedQueues()) {
    const fileSelect = document.getElementById('task-yaml-file-select');
    if (!fileSelect) return;
    const sources = this._getTaskSources(saved);
    if (this._activeTaskSource !== this.LOCAL_TASK_SOURCE
        && !sources.includes(this._activeTaskSource)) {
      this._activeTaskSource = this.LOCAL_TASK_SOURCE;
    }
    fileSelect.innerHTML = '<option value="__local__">로컬 Task</option>';
    sources.forEach(source => {
      const option = document.createElement('option');
      option.value = source;
      option.textContent = source;
      fileSelect.appendChild(option);
    });
    fileSelect.value = this._activeTaskSource;

    const visible = this._getVisibleTaskKeys(saved);
    const summary = document.getElementById('task-yaml-file-summary');
    if (summary) {
      summary.textContent = this._activeTaskSource === this.LOCAL_TASK_SOURCE
        ? `브라우저 저장 Task ${visible.length}개`
        : `${this._activeTaskSource} · Task ${visible.length}개`;
    }
    const exportButton = document.getElementById('btn-export-mission');
    if (exportButton) {
      const exportableCount = visible.filter(key => !saved[key]?.builtin).length;
      exportButton.disabled = exportableCount === 0;
    }
  },

  _notifyTaskStoreChanged() {
    if (typeof document === 'undefined' ||
        typeof document.dispatchEvent !== 'function' ||
        typeof CustomEvent === 'undefined') return;
    document.dispatchEvent(new CustomEvent('easyloop:tasks-changed', {
      detail: { names: this.getSavedQueueNames() }
    }));
  },

  _actionTypeKey(item) {
    const raw = item?.actionType !== undefined ? item.actionType : item?.action_type;
    const value = typeof raw === 'string' && raw.toLowerCase().startsWith('0x')
      ? parseInt(raw, 16)
      : Number(raw);
    return Number.isFinite(value) ? `0x${value.toString(16).padStart(2, '0')}` : '';
  },

  getTaskDetailModel(taskName) {
    const entry = this.getSavedQueues()[taskName];
    if (!entry || !Array.isArray(entry.queue)) return null;
    return {
      name: entry.yamlTaskId || taskName,
      loopFlag: entry.loopFlag ?? 1,
      missionCount: this._queueToMissionGroups(entry.queue).length,
      actions: entry.queue.map((item, index) => {
        const typeKey = this._actionTypeKey(item);
        const config = this.actionTypes[typeKey];
        const args = Array.from(item.args || item.action_args || []);
        const argFields = typeKey === '0x15' && args.length >= 3
          ? args.slice(0, -1).map((_, argIndex) => ({
            name: `${argIndex % 2 === 0 ? 'x' : 'y'}${Math.floor(argIndex / 2)}`,
            label: `Trajectory ${Math.floor(argIndex / 2) + 1} · ${argIndex % 2 === 0 ? 'X' : 'Y'}`
          })).concat([{ name: 'theta', label: '최종 방향' }])
          : config?.args || [];
        const params = Array.from(item.params || item.action_params || []).map(param => ({
          name: param?.param_name ?? param?.name ?? '',
          label: this.fieldLabels[param?.param_name ?? param?.name ?? ''] || param?.param_name || param?.name || '',
          type: param?.type ?? 'string',
          value: param?.value ?? ''
        }));
        return {
          id: item.name || item.action_id || `action_${index + 1}`,
          missionId: item.missionId ?? 1,
          type: Number.parseInt(typeKey, 16),
          typeKey,
          typeName: config?.name || `Unknown (${typeKey || 'type'})`,
          args: args.map((value, argIndex) => ({
            name: argFields[argIndex]?.name || `arg${argIndex + 1}`,
            label: argFields[argIndex]?.label || this._fieldLabel(argFields[argIndex] || {
              name: `arg${argIndex + 1}`
            }),
            value
          })),
          params
        };
      })
    };
  },

  renderTaskDetail(container, taskName) {
    if (!container) return;
    container.innerHTML = '';
    const model = this.getTaskDetailModel(taskName);
    if (!model) {
      container.textContent = 'Task를 선택하면 Action과 파라미터가 표시됩니다.';
      return;
    }

    const header = document.createElement('div');
    header.className = 'task-detail-header';
    const title = document.createElement('strong');
    title.textContent = model.name;
    const meta = document.createElement('span');
    meta.textContent = `${model.missionCount} Missions · ${model.actions.length} Actions · 반복 ${model.loopFlag}`;
    header.appendChild(title);
    header.appendChild(meta);
    container.appendChild(header);

    model.actions.forEach((action, index) => {
      const card = document.createElement('div');
      card.className = 'task-detail-action';
      const actionHeader = document.createElement('div');
      actionHeader.className = 'task-detail-action-header';
      const actionTitle = document.createElement('strong');
      actionTitle.textContent = `${index + 1}. ${action.id}`;
      const type = document.createElement('span');
      type.textContent = `Mission ${action.missionId} · ${action.typeKey} · ${action.typeName}`;
      actionHeader.appendChild(actionTitle);
      actionHeader.appendChild(type);
      card.appendChild(actionHeader);

      const args = document.createElement('div');
      args.className = 'task-detail-line';
      args.textContent = action.args.length
        ? `Args · ${action.args.map(arg =>
          `${arg.label} [${arg.name}]=${arg.value}`
        ).join(', ')}`
        : 'Args · 없음';
      card.appendChild(args);

      const params = document.createElement('div');
      params.className = 'task-detail-params';
      if (action.params.length === 0) {
        params.textContent = 'Params · 없음';
      } else {
        action.params.forEach(param => {
          const line = document.createElement('div');
          const friendly = document.createElement('span');
          friendly.textContent = `${param.label} = ${param.value}`;
          const key = document.createElement('small');
          key.className = 'task-detail-param-key';
          key.textContent = `${param.name} · ${param.type}`;
          line.appendChild(friendly);
          line.appendChild(key);
          params.appendChild(line);
        });
      }
      card.appendChild(params);
      container.appendChild(card);
    });
  },

  renderTaskLibrary(filterText = '') {
    const grid = document.getElementById('task-library-grid');
    if (!grid) return;
    const saved = this.getSavedQueues();
    const filter = String(filterText || '').trim().toLocaleLowerCase();
    const names = this._getVisibleTaskKeys(saved).filter(name =>
      !filter || (saved[name]?.yamlTaskId || name).toLocaleLowerCase().includes(filter)
    );
    grid.innerHTML = '';

    if (names.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'task-library-empty';
      empty.textContent = filter ? '검색 결과가 없습니다.' : '저장된 Task가 없습니다.';
      grid.appendChild(empty);
      return;
    }

    names.forEach(name => {
      const entry = saved[name];
      const model = this.getTaskDetailModel(name);
      if (!model) return;
      const expanded = this._expandedTaskNames.has(name);
      const card = document.createElement('article');
      card.className = `task-library-card${expanded ? ' expanded' : ''}`;

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'task-library-card-head';
      head.setAttribute('aria-expanded', String(expanded));
      const titleRow = document.createElement('span');
      titleRow.className = 'task-library-card-title';
      const arrow = document.createElement('span');
      arrow.className = 'task-library-card-arrow';
      arrow.textContent = expanded ? '▼' : '▶';
      const title = document.createElement('strong');
      title.textContent = entry.yamlTaskId || name;
      titleRow.appendChild(arrow);
      titleRow.appendChild(title);
      if (entry.builtin) {
        const builtin = document.createElement('small');
        builtin.textContent = '기본';
        titleRow.appendChild(builtin);
      }
      const meta = document.createElement('span');
      meta.className = 'task-library-card-meta';
      meta.textContent = `${model.missionCount} Missions · ${model.actions.length} Actions · 반복 ${model.loopFlag}`;
      head.appendChild(titleRow);
      head.appendChild(meta);
      head.addEventListener('click', () => {
        if (this._expandedTaskNames.has(name)) this._expandedTaskNames.delete(name);
        else this._expandedTaskNames.add(name);
        this.renderTaskLibrary(document.getElementById('task-library-search')?.value || '');
      });
      card.appendChild(head);

      const preview = document.createElement('div');
      preview.className = 'task-library-preview';
      preview.textContent = model.actions
        .slice(0, 3)
        .map(action => `${action.typeKey} · ${action.typeName}`)
        .join(' → ') + (model.actions.length > 3 ? ` 외 ${model.actions.length - 3}개` : '');
      card.appendChild(preview);

      if (expanded) {
        const detail = document.createElement('div');
        detail.className = 'task-detail-view task-library-detail';
        this.renderTaskDetail(detail, name);
        card.appendChild(detail);
      }

      const controls = document.createElement('div');
      controls.className = 'task-library-card-controls';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'btn btn-small';
      editButton.textContent = '수정';
      editButton.addEventListener('click', () => this.openTaskBuilder(name));
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'btn btn-small';
      copyButton.textContent = '복사';
      copyButton.title = '이 Task와 모든 Action을 현재 YAML 파일 안에 복사합니다.';
      copyButton.addEventListener('click', () => this.duplicateSavedQueue(name));
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn btn-small btn-danger';
      deleteButton.textContent = '삭제';
      deleteButton.addEventListener('click', () => this.deleteSavedQueueByName(name));
      const runButton = document.createElement('button');
      runButton.type = 'button';
      runButton.className = 'btn btn-small btn-primary task-library-run';
      runButton.textContent = '실행';
      const activeSlot = App.robotSlots?.[this.getTargetSlot()];
      runButton.disabled = !activeSlot?.connected || !activeSlot.ros || model.actions.length === 0;
      runButton.addEventListener('click', () => this.runSavedTask(name, runButton));
      controls.appendChild(editButton);
      controls.appendChild(copyButton);
      controls.appendChild(deleteButton);
      controls.appendChild(runButton);
      card.appendChild(controls);
      grid.appendChild(card);
    });
  },

  duplicateSavedQueue(name) {
    const saved = this.getSavedQueues();
    const source = saved[name];
    if (!source) return '';
    const originalName = source.yamlTaskId || name;
    const sourceFile = source.importedFrom || '';
    const displayNames = new Set(
      Object.entries(saved)
        .filter(([, entry]) => (entry.importedFrom || '') === sourceFile)
        .map(([key, entry]) => entry.yamlTaskId || key)
    );
    let copyName = `${originalName}_copy`;
    let suffix = 2;
    while (displayNames.has(copyName)) {
      copyName = `${originalName}_copy${suffix}`;
      suffix += 1;
    }

    let storageKey = copyName;
    if (Object.prototype.hasOwnProperty.call(saved, storageKey)) {
      storageKey = `${copyName} (${sourceFile || 'local'})`;
      let storageSuffix = 2;
      while (Object.prototype.hasOwnProperty.call(saved, storageKey)) {
        storageKey = `${copyName} (${sourceFile || 'local'} ${storageSuffix})`;
        storageSuffix += 1;
      }
    }

    const copied = JSON.parse(JSON.stringify(source));
    copied.yamlTaskId = copyName;
    copied.queue = Array.from(copied.queue || []).map(item => ({ ...item }));
    copied.savedAt = Date.now();
    copied.builtin = false;
    delete copied.builtinVersion;
    saved[storageKey] = copied;
    try {
      localStorage.setItem(this.QUEUE_STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
      App.toast(`Task 복사 실패: ${error.message}`, 'error');
      return '';
    }
    this._expandedTaskNames.add(storageKey);
    this.refreshSavedQueueList();
    this._notifyTaskStoreChanged();
    App.toast(`Task "${originalName}"을 "${copyName}"으로 복사했습니다.`, 'success');
    return storageKey;
  },

  deleteSavedQueueByName(name) {
    const saved = this.getSavedQueues();
    if (!saved[name]) return;
    const displayName = saved[name].yamlTaskId || name;
    if (!confirm(`"${displayName}" Task를 삭제하시겠습니까?`)) return;
    delete saved[name];
    try {
      localStorage.setItem(this.QUEUE_STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
      App.toast(`Task 삭제 실패: ${error.message}`, 'error');
      return;
    }
    this._expandedTaskNames.delete(name);
    this.refreshSavedQueueList();
    this._notifyTaskStoreChanged();
    App.toast(`Task "${displayName}"을 삭제했습니다`, 'success');
  },

  async runSavedTask(name, button) {
    const slotIndex = this.getTargetSlot();
    const slot = App.robotSlots?.[slotIndex];
    if (!slot?.connected || !slot.ros) {
      App.toast('활성 로봇이 연결되어 있지 않습니다.', 'error');
      return;
    }
    const entry = this.getSavedQueues()[name];
    if (!entry?.queue?.length) {
      App.toast(`Task "${name}"을 찾을 수 없습니다.`, 'error');
      return;
    }
    const displayName = entry.yamlTaskId || name;
    if (!confirm(`${slot.robotId}에서 "${displayName}" Task를 실행하시겠습니까?`)) return;
    App.setButtonLoading(button, true, '전송 중');
    this._setTaskExecutionFeedback('work', `${slot.robotId} · ${displayName} 전송 중...`);
    try {
      const sent = await this.sendSavedQueueToSlot(name, slotIndex, entry.loopFlag ?? 1, displayName);
      this._setTaskExecutionFeedback(
        'work',
        `${sent.robotId} · ${displayName} 실행 요청 완료 · ${sent.actionCount} Actions`
      );
      App.toast(`${sent.robotId}: "${displayName}" Task 실행 요청 완료`, 'success');
    } catch (error) {
      this._setTaskExecutionFeedback('error', `실행 실패 · ${error.message || error}`);
      App.toast(`Task 실행 실패: ${error.message || error}`, 'error');
    } finally {
      App.setButtonLoading(button, false);
    }
  },

  async sendSavedQueueToSlot(queueName, slotIndex, loopCount = 1, taskId = queueName) {
    const saved = this.getSavedQueues();
    const entry = saved[queueName];
    if (!entry || !Array.isArray(entry.queue) || entry.queue.length === 0) {
      throw new Error(`저장된 Task "${queueName}"을 찾을 수 없습니다`);
    }
    const slot = App.robotSlots[slotIndex];
    if (!slot?.connected || !slot.ros) throw new Error('선택한 로봇이 연결되어 있지 않습니다');
    const robotId = slot.robotId;
    const missionGroups = this._queueToMissionGroups(entry.queue);
    const normalizedGroups = missionGroups.map(group => ({
      mission_id: group.missionId,
      actions: group.actions.map((item, index) => {
        const rawType = item.actionType !== undefined ? item.actionType : item.action_type;
        const normalized = this.normalizeActionForSend({
          action_type: parseInt(rawType),
          action_args: item.args || item.action_args || [],
          action_params: item.params || item.action_params || [],
          conveyorFloor: item.conveyorFloor
        });
        normalized.action_id = item.name || `a${index + 1}`;
        return normalized;
      })
    }));
    const preparedActions = await this._prepareActionsForSlot(
      normalizedGroups.flatMap(group => group.actions),
      slot
    );
    let preparedIndex = 0;
    const missions = normalizedGroups.map(group => ({
      mission_id: group.mission_id,
      actions: group.actions.map(() => preparedActions[preparedIndex++])
    }));
    const request = {
      task_id: taskId || queueName,
      loop_flag: Number.isFinite(Number(loopCount)) ? Number(loopCount) : 1,
      missions
    };
    if (typeof TestMode !== 'undefined' && TestMode.enabled && slot.virtualTestRobot) {
      const result = await TestMode.runTask(slotIndex, request);
      if (typeof App.logAudit === 'function') {
        App.logAudit('fleet_task_send', {
          taskId: taskId || queueName,
          sourceQueue: queueName,
          robotId,
          actionCount: preparedActions.length,
          loopCount: request.loop_flag,
          mode: 'test'
        });
      }
      return {
        result,
        robotId,
        actionCount: preparedActions.length,
        serviceName: '[TestMode virtual task]'
      };
    }
    const taskInterface = await this._resolveTaskInterface(slot);
    const result = await this._callTaskService(slot.ros, taskInterface.goalName, taskInterface.goalType, request);
    if (result && result.success === false) {
      throw new Error(result.message || `error_code=${result.error_code}`);
    }
    if (typeof App.logAudit === 'function') {
      App.logAudit('fleet_task_send', {
        taskId: taskId || queueName,
        sourceQueue: queueName,
        robotId,
        actionCount: preparedActions.length,
        loopCount: request.loop_flag
      });
    }
    return { result, robotId, actionCount: preparedActions.length, serviceName: taskInterface.goalName };
  },

  async _prepareActionsForSlot(actions, slot) {
    const prepared = (actions || []).map(action => ({ ...action }));
    const floorActions = prepared.filter(action =>
      Number(action.action_type) === 0x18 && action.conveyorFloor !== undefined
    );

    if (floorActions.length > 0) {
      const conveyorCount = await this._resolveConveyorCount(slot);
      floorActions.forEach(action => {
        const floor = Number(action.conveyorFloor) || 1;
        if (![1, 2].includes(floor)) throw new Error(`지원하지 않는 층입니다: ${floor}`);
        if (floor > conveyorCount) {
          throw new Error(`${slot.robotId}은(는) ${conveyorCount}단 컨베이어로 확인되어 ${floor}층을 구동할 수 없습니다`);
        }

        const command = Number(action.action_args?.[0]);
        const physicalArgs = Array(conveyorCount * 2).fill(0);
        physicalArgs[(floor - 1) * 2] = Number.isFinite(command) ? command : 3;
        physicalArgs[((floor - 1) * 2) + 1] = 1;
        action.action_args = physicalArgs;
      });
    }

    prepared.forEach(action => delete action.conveyorFloor);
    return prepared;
  },

  async _resolveConveyorCount(slot) {
    if (Number.isInteger(slot.conveyorCount) && slot.conveyorCount > 0) {
      return slot.conveyorCount;
    }
    if (!slot?.ros || !slot.robotId) throw new Error('로봇 연결 정보가 없습니다');

    const names = [
      `/${slot.robotId}/SUBCON_/conv_count`,
      `/${slot.robotId}/basic_settings/conv_count`
    ];
    const values = await Promise.all(names.map(name => this._readRosParam(slot.ros, name)));
    const conveyorCount = values
      .map(value => Number(value))
      .find(value => Number.isInteger(value) && value > 0);

    if (!conveyorCount) {
      throw new Error(`${slot.robotId}의 conv_count를 확인할 수 없어 안전상 전송하지 않았습니다`);
    }
    slot.conveyorCount = conveyorCount;
    return conveyorCount;
  },

  _readRosParam(ros, name, timeoutMs = 1200) {
    return new Promise(resolve => {
      let settled = false;
      const done = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      try {
        const param = new ROSLIB.Param({ ros, name });
        param.get(value => done(value), () => done(undefined));
      } catch (error) {
        done(undefined);
      }
    });
  },

  _setupTargetCfgControl(paramIndex) {
    const select = document.getElementById(`action-param-${paramIndex}-cfg-list`);
    const input = document.getElementById(`action-param-${paramIndex}`);
    const refreshButton = document.getElementById('btn-target-cfg-refresh');
    const manualButton = document.getElementById('btn-target-cfg-manual');
    const detailsButton = document.getElementById('btn-target-cfg-details');
    const coreSelect = document.getElementById(`action-param-${paramIndex}-core-cfg-list`);
    if (!select || !input || !refreshButton || !manualButton || !detailsButton || !coreSelect) return;

    select.addEventListener('change', () => {
      input.value = select.value;
      this._syncTargetCfgControl(paramIndex);
    });
    coreSelect.addEventListener('change', () => {
      if (!coreSelect.value) return;
      input.value = coreSelect.value;
      this._syncTargetCfgControl(paramIndex);
    });
    refreshButton.addEventListener('click', async () => {
      await this._loadTargetCfgOptions(paramIndex, true);
      const details = document.getElementById('target-cfg-details');
      if (details && !details.hidden) await this._loadTargetCfgDetails(paramIndex, true);
    });
    detailsButton.addEventListener('click', () => this._toggleTargetCfgDetails(paramIndex));
    manualButton.addEventListener('click', () => {
      const manual = manualButton.getAttribute('aria-pressed') !== 'true';
      manualButton.setAttribute('aria-pressed', String(manual));
      manualButton.textContent = manual ? '목록 선택' : '직접 입력';
      input.hidden = !manual;
      select.hidden = manual;
      if (manual) this._closeTargetCfgDetails();
      if (!manual) input.value = select.value;
      if (manual) {
        input.focus();
        input.select();
      }
    });
    this._syncTargetCfgControl(paramIndex);
  },

  _syncTargetCfgControl(paramIndex = null) {
    const config = this.actionTypes['0x08'];
    const index = paramIndex ?? config.params.findIndex(param => param.name === 'target_cfg');
    if (index < 0) return;
    const input = document.getElementById(`action-param-${index}`);
    const select = document.getElementById(`action-param-${index}-cfg-list`);
    const coreSelect = document.getElementById(`action-param-${index}-core-cfg-list`);
    if (!input || !select) return;

    const value = String(input.value || '');
    if (value && !Array.from(select.options).some(option => option.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${value} (현재 값)`;
      select.appendChild(option);
    }
    select.value = value;
    if (coreSelect) {
      coreSelect.value = Array.from(coreSelect.options).some(option => option.value === value)
        ? value
        : '';
    }
  },

  _closeTargetCfgDetails() {
    const details = document.getElementById('target-cfg-details');
    const button = document.getElementById('btn-target-cfg-details');
    if (details) details.hidden = true;
    if (button) {
      button.setAttribute('aria-expanded', 'false');
      button.textContent = '더 자세히 보기';
    }
  },

  async _toggleTargetCfgDetails(paramIndex) {
    const details = document.getElementById('target-cfg-details');
    const button = document.getElementById('btn-target-cfg-details');
    if (!details || !button) return;
    const opening = details.hidden;
    if (!opening) {
      this._closeTargetCfgDetails();
      return;
    }

    const manualButton = document.getElementById('btn-target-cfg-manual');
    const input = document.getElementById(`action-param-${paramIndex}`);
    const select = document.getElementById(`action-param-${paramIndex}-cfg-list`);
    if (manualButton?.getAttribute('aria-pressed') === 'true') {
      manualButton.setAttribute('aria-pressed', 'false');
      manualButton.textContent = '직접 입력';
      if (input) input.hidden = true;
      if (select) select.hidden = false;
    }
    details.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    button.textContent = '간단히 보기';
    await this._loadTargetCfgDetails(paramIndex);
  },

  _setTargetCfgDetailsStatus(message, isError = false) {
    const status = document.getElementById('target-cfg-details-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
  },

  _setTargetCfgStatus(message, isError = false) {
    const status = document.getElementById('target-cfg-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
  },

  async _resolveDockingRobotType(slot) {
    if (slot?.robotType) return String(slot.robotType);
    if (!slot?.ros || !slot.robotId) return '';

    const rid = slot.robotId;
    const names = [
      `/${rid}/robot_type`,
      `/${rid}/basic_settings/robot_type`,
      `/${rid}/basic_setting/robot_type`,
      '/robot_type'
    ];
    const values = await Promise.all(names.map(name => this._readRosParam(slot.ros, name)));
    const robotType = values
      .map(value => typeof value === 'string' ? value.trim() : '')
      .find(value => /^[A-Za-z0-9_.-]+$/.test(value));
    if (robotType) slot.robotType = robotType;
    return robotType || '';
  },

  async _findRosParametersGroupPath() {
    const command = "bash -lc '. /opt/ros/noetic/setup.bash 2>/dev/null || . /opt/ros/melodic/setup.bash 2>/dev/null; . ~/catkin_ws/devel/setup.bash 2>/dev/null; rospack find ros_parameters_group 2>/dev/null'";
    try {
      const response = await fetchWithTimeout('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: FileTransfer.sessionId, command })
      });
      const result = await response.json();
      const packagePath = String(result.stdout || '').trim().split(/\r?\n/)[0];
      return result.success && /^\/[A-Za-z0-9_./-]+$/.test(packagePath) ? packagePath : '';
    } catch (error) {
      return '';
    }
  },

  async _findRemoteHome() {
    if (typeof FileTransfer === 'undefined' || !FileTransfer.sessionId) return '';
    const cacheKey = FileTransfer.sessionId;
    if (this._remoteHomeCache.has(cacheKey)) return this._remoteHomeCache.get(cacheKey);
    const command = "bash -lc 'printf \"%s\" \"$HOME\"'";
    try {
      const response = await fetchWithTimeout('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: FileTransfer.sessionId, command })
      });
      const result = await response.json();
      const remoteHome = String(result.stdout || '').trim();
      if (result.success && /^\/[A-Za-z0-9_./-]+$/.test(remoteHome)) {
        this._remoteHomeCache.set(cacheKey, remoteHome);
        return remoteHome;
      }
    } catch (error) {
      // 아래 사용자명 기반 경로 후보로 계속 확인한다.
    }
    return '';
  },

  async _listRemoteCfgFiles(remotePath) {
    try {
      const response = await fetchWithTimeout('/api/sftp/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: FileTransfer.sessionId, remotePath })
      });
      const result = await response.json();
      if (!result.success) return [];
      return (result.files || [])
        .filter(file => !file.isDirectory && /\.cfg$/i.test(file.name))
        .map(file => file.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (error) {
      return [];
    }
  },

  async _fetchDockingCfgFiles(slot, robotType = this.DOCKING_TARGET_CFG_MODEL) {
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      return {
        files: ['docking_common.cfg', 'docking_direct.cfg', 'docking_lv120.cfg'],
        path: `/test/ros_parameters_group/param/${robotType}/docking/cfg`
      };
    }
    if (typeof FileTransfer === 'undefined') throw new Error('SFTP 모듈을 사용할 수 없습니다');

    const connection = await FileTransfer.ensureConnection();
    if (!connection.success) throw new Error(connection.message || 'SSH 연결 실패');

    const remoteHome = await this._findRemoteHome();
    const sshUserValue = document.getElementById('ssh-user')?.value?.trim() || 'syscon';
    const sshUser = /^[A-Za-z0-9_-]+$/.test(sshUserValue) ? sshUserValue : 'syscon';
    const paths = [
      remoteHome ? `${remoteHome}/catkin_ws/src/ros_parameters_group/param/${robotType}/docking/cfg` : '',
      `/home/${sshUser}/catkin_ws/src/ros_parameters_group/param/${robotType}/docking/cfg`,
      `/root/catkin_ws/src/ros_parameters_group/param/${robotType}/docking/cfg`,
      // 구버전 workspace 호환 후보. 요청 경로를 먼저 확인한 뒤에만 사용한다.
      `/home/${sshUser}/catkin_ws/src/ros_parameters_group`,
      `/home/${sshUser}/catkin_ws/src/scorpion_ros/ros_parameters_group`,
      `/home/${sshUser}/catkin_ws/src/core_package/ros_parameters_group`,
      '/root/catkin_ws/src/ros_parameters_group',
      '/root/catkin_ws/src/scorpion_ros/ros_parameters_group'
    ].map(path => path.endsWith('/ros_parameters_group')
      ? `${path}/param/${robotType}/docking/cfg`
      : path
    ).filter((path, index, all) => path && all.indexOf(path) === index);

    for (const path of paths) {
      const files = await this._listRemoteCfgFiles(path);
      if (files.length > 0) return { files, path };
    }
    return { files: [], path: '' };
  },

  async _fetchDockingCoreCfgFiles(slot) {
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      return {
        files: [
          'docking_common.cfg',
          'docking_direct.cfg',
          'docking_lv120.cfg',
          'docking_rack.cfg'
        ],
        path: '/test/core_docking/sp2_docking/src/sp2_docking/cfg'
      };
    }
    if (typeof FileTransfer === 'undefined') throw new Error('SFTP 모듈을 사용할 수 없습니다');

    const connection = await FileTransfer.ensureConnection();
    if (!connection.success) throw new Error(connection.message || 'SSH 연결 실패');

    const remoteHome = await this._findRemoteHome();
    const sshUserValue = document.getElementById('ssh-user')?.value?.trim() || 'syscon';
    const sshUser = /^[A-Za-z0-9_-]+$/.test(sshUserValue) ? sshUserValue : 'syscon';
    const paths = [
      remoteHome ? `${remoteHome}/catkin_ws/src/core_docking/sp2_docking/src/sp2_docking/cfg` : '',
      `/home/${sshUser}/catkin_ws/src/core_docking/sp2_docking/src/sp2_docking/cfg`,
      '/root/catkin_ws/src/core_docking/sp2_docking/src/sp2_docking/cfg'
    ].filter((path, index, all) => path && all.indexOf(path) === index);
    for (const path of paths) {
      const files = await this._listRemoteCfgFiles(path);
      if (files.length > 0) return { files, path };
    }
    return { files: [], path: '' };
  },

  async _loadTargetCfgDetails(paramIndex, force = false) {
    const select = document.getElementById(`action-param-${paramIndex}-core-cfg-list`);
    const input = document.getElementById(`action-param-${paramIndex}`);
    if (!select || !input) return;

    const slot = App.robotSlots?.[App.activeSlotIndex];
    if (!slot?.connected || !slot.ros) {
      select.innerHTML = '<option value="">연결된 활성 로봇 없음</option>';
      this._setTargetCfgDetailsStatus('데이터 수신 중인 로봇을 먼저 선택하세요.', true);
      return;
    }

    const cacheKey = slot.ip || slot.robotId;
    if (force) this._dockingCoreCfgCache.delete(cacheKey);
    select.disabled = true;
    this._setTargetCfgDetailsStatus(`${slot.robotId}: core_docking cfg 전체 목록 읽는 중...`);
    try {
      let result = this._dockingCoreCfgCache.get(cacheKey);
      if (!result) {
        result = await this._fetchDockingCoreCfgFiles(slot);
        if (result.files.length > 0) this._dockingCoreCfgCache.set(cacheKey, result);
      }

      select.innerHTML = '';
      if (result.files.length === 0) {
        select.innerHTML = '<option value="">core_docking cfg 파일 없음</option>';
        this._setTargetCfgDetailsStatus(
          '~/catkin_ws/src/core_docking/sp2_docking/src/sp2_docking/cfg에서 cfg를 찾지 못했습니다.',
          true
        );
        return;
      }
      result.files.forEach(fileName => {
        const option = document.createElement('option');
        option.value = fileName;
        option.textContent = fileName;
        select.appendChild(option);
      });
      select.value = result.files.includes(input.value) ? input.value : '';
      this._setTargetCfgDetailsStatus(
        `${result.files.length}개 cfg · 선택 시 target_cfg에 파일명이 반영됩니다.`
      );
    } catch (error) {
      select.innerHTML = '<option value="">core_docking cfg 확인 실패</option>';
      this._setTargetCfgDetailsStatus(`${error.message || error}`, true);
    } finally {
      select.disabled = false;
    }
  },

  async _loadTargetCfgOptions(paramIndex, force = false) {
    const select = document.getElementById(`action-param-${paramIndex}-cfg-list`);
    const input = document.getElementById(`action-param-${paramIndex}`);
    if (!select || !input) return;

    const slot = App.robotSlots?.[App.activeSlotIndex];
    if (!slot?.connected || !slot.ros) {
      select.innerHTML = '<option value="">연결된 활성 로봇 없음</option>';
      this._setTargetCfgStatus('데이터 수신 중인 로봇을 선택하면 cfg 목록을 불러옵니다.', true);
      this._syncTargetCfgControl(paramIndex);
      return;
    }

    const loadToken = Symbol('target-cfg-load');
    this._targetCfgLoadToken = loadToken;
    select.disabled = true;
    const robotType = this.DOCKING_TARGET_CFG_MODEL;
    this._setTargetCfgStatus(
      `${slot.robotId}: ~/catkin_ws/src/ros_parameters_group/param/${robotType}/docking/cfg 확인 중...`
    );

    try {
      if (this._targetCfgLoadToken !== loadToken) return;

      const cacheKey = `${slot.ip}|${robotType}`;
      if (force) this._dockingCfgCache.delete(cacheKey);
      let result = this._dockingCfgCache.get(cacheKey);
      if (!result) {
        this._setTargetCfgStatus(`${slot.robotId} · ${robotType}: cfg 목록 읽는 중...`);
        result = await this._fetchDockingCfgFiles(slot, robotType);
        if (result.files.length > 0) this._dockingCfgCache.set(cacheKey, result);
      }
      if (this._targetCfgLoadToken !== loadToken) return;

      const previousValue = input.value;
      select.innerHTML = '<option value="">기본 cfg 사용 (target_cfg 비움)</option>';
      result.files.forEach(fileName => {
        const option = document.createElement('option');
        option.value = fileName;
        option.textContent = fileName;
        select.appendChild(option);
      });
      input.value = previousValue;
      this._syncTargetCfgControl(paramIndex);

      if (result.files.length === 0) {
        this._setTargetCfgStatus(
          `${slot.robotId} · ~/catkin_ws/src/ros_parameters_group/param/${robotType}/docking/cfg · cfg 파일 없음`,
          true
        );
      } else {
        this._setTargetCfgStatus(
          `${slot.robotId} · ~/catkin_ws/src/ros_parameters_group/param/${robotType}/docking/cfg · ${result.files.length}개`
        );
      }
    } catch (error) {
      if (this._targetCfgLoadToken !== loadToken) return;
      select.innerHTML = '<option value="">cfg 목록 확인 실패</option>';
      this._syncTargetCfgControl(paramIndex);
      this._setTargetCfgStatus(`${error.message} · 직접 입력 가능`, true);
    } finally {
      if (this._targetCfgLoadToken === loadToken) select.disabled = false;
    }
  },

  async _controlTaskOnSlot(slotIndex, kind) {
    const slot = App.robotSlots[slotIndex];
    if (!slot?.connected || !slot.ros) throw new Error('선택한 로봇이 연결되어 있지 않습니다');
    if (typeof TestMode !== 'undefined' && TestMode.enabled && slot.virtualTestRobot) {
      if (kind === 'cancel') this._taskCancelRequests.set(slot.robotId, Date.now());
      return TestMode.controlTask(slotIndex, kind);
    }
    const taskInterface = await this._resolveTaskInterface(slot);
    const serviceName = taskInterface[`${kind}Name`];
    const serviceType = taskInterface[`${kind}Type`];
    const serviceArgs = taskInterface[`${kind}Args`];
    if (!serviceName || !serviceType) throw new Error(`${kind} 서비스 정보를 확인할 수 없습니다`);
    if (kind === 'cancel') this._taskCancelRequests.set(slot.robotId, Date.now());
    try {
      const result = await this._callTaskService(
        slot.ros,
        serviceName,
        serviceType,
        serviceArgs
      );
      if (result && result.success === false) {
        throw new Error(result.message || `Task ${kind} 요청이 거부되었습니다`);
      }
      return result;
    } catch (error) {
      if (kind === 'cancel') this._taskCancelRequests.delete(slot.robotId);
      throw error;
    }
  },

  pauseTaskOnSlot(slotIndex) {
    return this._controlTaskOnSlot(slotIndex, 'pause');
  },

  resumeTaskOnSlot(slotIndex) {
    return this._controlTaskOnSlot(slotIndex, 'resume');
  },

  cancelTaskOnSlot(slotIndex) {
    return this._controlTaskOnSlot(slotIndex, 'cancel');
  },

  async _controlActiveTask(kind, button) {
    const slotIndex = this.getTargetSlot();
    const slot = App.robotSlots?.[slotIndex];
    const labels = { pause: '일시정지', resume: '재개', cancel: '취소' };
    if (!slot?.connected || !slot.ros) {
      this._setTaskExecutionFeedback('error', '활성 로봇이 연결되어 있지 않습니다.');
      return;
    }
    if (kind === 'cancel' && !confirm(`${slot.robotId}에서 실행 중인 Task를 취소하시겠습니까?`)) return;
    const keepCancelEnabled = kind === 'cancel';
    if (!keepCancelEnabled) App.setButtonLoading(button, true, '요청 중');
    try {
      await this._controlTaskOnSlot(slotIndex, kind);
      const state = kind === 'pause' ? 'pause' : kind === 'resume' ? 'work' : 'idle';
      const statusText = kind === 'cancel'
        ? `${slot.robotId} · Task 취소됨 · 대기`
        : `${slot.robotId} · Task ${labels[kind]} 요청 완료`;
      this._setTaskExecutionFeedback(state, statusText);
      App.toast(`${slot.robotId}: Task ${labels[kind]} 요청 완료`, 'success');
    } catch (error) {
      this._setTaskExecutionFeedback('error', `${labels[kind]} 실패 · ${error.message || error}`);
      App.toast(`Task ${labels[kind]} 실패: ${error.message || error}`, 'error');
    } finally {
      if (!keepCancelEnabled) App.setButtonLoading(button, false);
    }
  },

  _setTaskExecutionFeedback(state, message, detail = '') {
    const container = document.getElementById('task-execution-feedback');
    if (!container) return;
    const labels = {
      idle: 'IDLE',
      work: 'WORK',
      complete: 'COMPLETE',
      pause: 'PAUSE',
      cancel: 'CANCEL',
      abort: 'ABORT',
      recovery: 'RECOVERY',
      error: 'ERROR'
    };
    container.dataset.state = state;
    const badge = container.querySelector('.task-state-badge');
    const messageEl = container.querySelector('.task-feedback-message');
    if (badge) badge.textContent = labels[state] || String(state || 'IDLE').toUpperCase();
    if (messageEl) messageEl.textContent = [message, detail].filter(Boolean).join(' · ');
    this._updateTaskControlsAvailability();
  },

  _unsubscribeTaskTelemetry() {
    if (!this._taskTelemetry) return;
    try { this._taskTelemetry.feedback?.unsubscribe(); } catch (error) { /* noop */ }
    try { this._taskTelemetry.result?.unsubscribe(); } catch (error) { /* noop */ }
    this._taskTelemetry = null;
  },

  async _subscribeTaskTelemetry() {
    const token = ++this._taskTelemetryToken;
    this._unsubscribeTaskTelemetry();
    const slotIndex = this.getTargetSlot();
    const slot = App.robotSlots?.[slotIndex];
    if (!slot?.connected || !slot.ros ||
        typeof ROSLIB === 'undefined' || typeof ROSLIB.Topic !== 'function') {
      this._updateTaskControlsAvailability();
      this._setTaskExecutionFeedback('idle', '실행 중인 Task 정보가 없습니다.');
      return;
    }
    if (typeof TestMode !== 'undefined' && TestMode.enabled && slot.virtualTestRobot) {
      const robot = TestMode.virtualRobots.get(slotIndex);
      this._updateTaskControlsAvailability();
      if (robot?.task) {
        TestMode._syncActiveVirtualRobot();
      } else {
        this._setTaskExecutionFeedback('idle', `${slot.robotId} · Test Mode Task 대기`);
      }
      return;
    }
    try {
      const taskInterface = await this._resolveTaskInterface(slot);
      if (token !== this._taskTelemetryToken) return;
      const feedback = new ROSLIB.Topic({
        ros: slot.ros,
        name: taskInterface.feedbackName,
        messageType: taskInterface.feedbackType
      });
      const result = new ROSLIB.Topic({
        ros: slot.ros,
        name: taskInterface.resultName,
        messageType: taskInterface.resultType
      });
      feedback.subscribe(message => this._handleTaskFeedback(slot.robotId, message, taskInterface.variant));
      result.subscribe(message => this._handleTaskResult(slot.robotId, message, taskInterface.variant));
      this._taskTelemetry = { feedback, result, slotIndex };
      this._updateTaskControlsAvailability();
      this._setTaskExecutionFeedback('idle', `${slot.robotId} · Task 상태 수신 대기`);
    } catch (error) {
      if (token === this._taskTelemetryToken) {
        this._setTaskExecutionFeedback('error', `Task 상태 연결 실패 · ${error.message || error}`);
      }
    }
  },

  _handleTaskFeedback(robotId, message = {}, variant = 'spx') {
    const paused = Boolean(message.is_paused);
    const rawState = variant === 'sp_task' ? (paused ? 3 : 1) : Number(message.state ?? 0);
    const states = ['idle', 'work', 'complete', 'pause', 'cancel', 'abort', 'recovery'];
    const state = states[rawState] || 'work';
    const taskId = message.task_id || 'Task';
    if (rawState === 4) {
      this._taskCancelRequests.set(robotId, Date.now());
      this._setTaskExecutionFeedback('idle', `${robotId} · ${taskId} · 취소됨`);
      return;
    }
    const mission = Number(message.mission_idx ?? 0);
    const action = Number(message.action_idx ?? 0);
    const loop = Number(message.loop_count ?? 0);
    const elapsed = Number(message.elapsed_time ?? 0);
    const parts = [`mission ${mission}`, `action ${action}`];
    if (loop > 0) parts.push(`loop ${loop}`);
    if (elapsed > 0) parts.push(`${elapsed.toFixed(1)}s`);
    if (message.state_message) parts.push(message.state_message);
    this._setTaskExecutionFeedback(state, `${robotId} · ${taskId}`, parts.join(' · '));
  },

  _handleTaskResult(robotId, message = {}, variant = 'spx') {
    const success = Boolean(message.success);
    const cancelRequestedAt = this._taskCancelRequests.get(robotId) || 0;
    const cancelRequested = Date.now() - cancelRequestedAt < 60000;
    const cancelMessage = /cancel|취소/i.test(String(message.message || ''));
    if (!success && (cancelRequested || cancelMessage)) {
      this._taskCancelRequests.delete(robotId);
      this._setTaskExecutionFeedback(
        'idle',
        `${robotId} · ${message.task_id || 'Task'} · 취소됨`
      );
      return;
    }
    this._taskCancelRequests.delete(robotId);
    const elapsed = Number(
      variant === 'sp_task' ? message.elapsed_time : message.total_elapsed_time
    ) || 0;
    const parts = [];
    if (!success) parts.push(`error_code=${message.error_code ?? 0}`);
    if (message.message) parts.push(message.message);
    if (elapsed > 0) parts.push(`${elapsed.toFixed(1)}s`);
    this._setTaskExecutionFeedback(
      success ? 'complete' : 'abort',
      `${robotId} · ${message.task_id || 'Task'} · ${success ? '완료' : '실패'}`,
      parts.join(' · ')
    );
  },

  _resolveTaskInterface(slot) {
    if (slot.taskInterface) return Promise.resolve(slot.taskInterface);
    const rid = slot.robotId;
    const modern = {
      goalName: `/${rid}/spx/task/goal`,
      goalType: 'spx_task_msgs/TaskGoal',
      pauseName: `/${rid}/spx/task/pause`,
      pauseType: 'spx_task_msgs/TaskPause',
      pauseArgs: {},
      resumeName: `/${rid}/spx/task/resume`,
      resumeType: 'spx_task_msgs/TaskResume',
      resumeArgs: {},
      cancelName: `/${rid}/spx/task/cancel`,
      cancelType: 'spx_task_msgs/TaskCancel',
      cancelArgs: {},
      feedbackName: `/${rid}/spx/task/feedback`,
      feedbackType: 'spx_task_msgs/TaskFeedback',
      resultName: `/${rid}/spx/task/result`,
      resultType: 'spx_task_msgs/TaskResult',
      variant: 'spx'
    };
    const legacy = {
      goalName: `/${rid}/TARU/goal`,
      goalType: 'sp_task/TaskGoal',
      pauseName: `/${rid}/TARU/pause`,
      pauseType: 'sp_task/Int32_srv',
      pauseArgs: { data: 0 },
      resumeName: `/${rid}/TARU/resume`,
      resumeType: 'sp_task/Int32_srv',
      resumeArgs: { data: 0 },
      cancelName: `/${rid}/TARU/cancel`,
      cancelType: 'sp_task/String_srv',
      cancelArgs: { data: '' },
      feedbackName: `/dt/ros/task/${rid}/feedback`,
      feedbackType: 'sp_task/Feedback',
      resultName: `/dt/ros/task/${rid}/result`,
      resultType: 'sp_task/Result',
      variant: 'sp_task'
    };
    return new Promise(resolve => {
      let settled = false;
      const done = services => {
        if (settled) return;
        settled = true;
        const list = Array.isArray(services) ? services : [];
        slot.taskInterface = list.includes(modern.goalName)
          ? modern
          : legacy;
        resolve(slot.taskInterface);
      };
      const timer = setTimeout(() => done([]), 1500);
      try {
        const service = new ROSLIB.Service({
          ros: slot.ros,
          name: '/rosapi/services',
          serviceType: 'rosapi/Services'
        });
        service.callService(new ROSLIB.ServiceRequest({}), result => {
          clearTimeout(timer);
          done(result?.services || []);
        }, () => {
          clearTimeout(timer);
          done([]);
        });
      } catch (error) {
        clearTimeout(timer);
        done([]);
      }
    });
  },

  _callTaskService(ros, name, serviceType, args) {
    return new Promise((resolve, reject) => {
      const service = new ROSLIB.Service({ ros, name, serviceType });
      service.callService(
        new ROSLIB.ServiceRequest(args || {}),
        resolve,
        error => reject(new Error(String(error || `${name} 호출 실패`)))
      );
    });
  },

  showResult(message, isError = false) {
    const resultEl = document.getElementById('action-result');
    resultEl.textContent = message;
    resultEl.style.color = isError ? '#ff6b6b' : '#fff';
    App.toast(message.split('\n')[0], isError ? 'error' : 'success');
  },

  // Export every Task in the selected ROS_DB/sp_task/rviz-style YAML file.
  exportMission() {
    const saved = this.getSavedQueues();
    const taskKeys = this._getVisibleTaskKeys(saved).filter(key => !saved[key]?.builtin);
    const tasks = taskKeys.map(key => ({
      taskId: saved[key].yamlTaskId || key,
      loopFlag: saved[key].loopFlag ?? 1,
      queue: saved[key].queue || [],
      missionsEmpty: Boolean(saved[key].missionsEmpty)
    }));

    if (tasks.length === 0) {
      App.toast('YAML로 저장할 Task가 없습니다', 'error');
      return;
    }

    const yaml = this.serializeTaskYaml(tasks);
    const blob = new Blob([yaml], { type: 'text/yaml;charset=utf-8' });
    const link = document.createElement('a');
    const selectedSource = this._activeTaskSource || this.LOCAL_TASK_SOURCE;
    const requestedName = selectedSource === this.LOCAL_TASK_SOURCE ? 'task.yaml' : selectedSource;
    const safeName = requestedName.replace(/[\\/:*?"<>|]/g, '_') || 'task.yaml';
    link.download = /\.ya?ml$/i.test(safeName) ? safeName : `${safeName}.yaml`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);

    App.toast(`"${link.download}" 저장 완료 (${tasks.length} Tasks)`, 'success');
  },

  serializeTaskYaml(tasks) {
    const lines = [];
    (tasks || []).forEach(task => {
      const queue = Array.from(task.queue || []);
      lines.push(`- task_id: ${this._yamlString(task.taskId || 'task')}`);
      lines.push(`  loop_flag: ${Math.max(0, parseInt(task.loopFlag, 10) || 0)}`);
      lines.push('  missions:');
      if (task.missionsEmpty && queue.length === 0) {
        lines.push('    []');
        return;
      }
      this._queueToMissionGroups(queue).forEach(group => {
        lines.push(`    - mission_id: ${this._yamlScalar(group.missionId)}`);
        lines.push('      actions:');
        group.actions.forEach((item, index) => {
          const typeKey = this._actionTypeKey(item);
          const actionType = Number.parseInt(typeKey, 16);
          const args = Array.from(item.args || item.action_args || []);
          const params = Array.from(item.params || item.action_params || []);
          lines.push(`        - action_id: ${this._yamlString(item.name || item.action_id || `action_${index + 1}`)}`);
          lines.push(`          action_type: ${Number.isFinite(actionType) ? actionType : 0}`);
          lines.push(`          action_args: [${args.map(value => this._yamlScalar(value)).join(', ')}]`);
          lines.push('          action_params:');
          if (params.length === 0) {
            lines.push('            []');
          } else {
            params.forEach(param => {
              const name = param?.param_name ?? param?.name ?? '';
              const type = param?.type || 'string';
              const value = this._yamlParamValue(param?.value, type);
              lines.push(`            - [${this._yamlString(name)}, ${this._yamlString(type)}, ${value}]`);
            });
          }
        });
      });
    });
    return `${lines.join('\n')}\n`;
  },

  _queueToMissionGroups(queue) {
    const groups = [];
    let fallbackGroup = null;
    Array.from(queue || []).forEach(item => {
      const hasMissionIndex = Number.isInteger(item?.missionIndex);
      let group = hasMissionIndex
        ? groups.find(entry => entry.missionIndex === item.missionIndex)
        : fallbackGroup;
      if (!group) {
        group = {
          missionId: item?.missionId ?? 1,
          missionIndex: hasMissionIndex ? item.missionIndex : null,
          actions: []
        };
        groups.push(group);
        if (!hasMissionIndex) fallbackGroup = group;
      }
      group.actions.push(item);
    });
    return groups.length > 0 ? groups : [{ missionId: 1, missionIndex: null, actions: [] }];
  },

  _yamlString(value) {
    const text = String(value ?? '');
    return /^[A-Za-z0-9_./-]+$/.test(text) && !/^(true|false|null|[-+]?\d+(?:\.\d+)?)$/i.test(text)
      ? text
      : JSON.stringify(text);
  },

  _yamlScalar(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    const numeric = Number(value);
    if (String(value).trim() !== '' && Number.isFinite(numeric)) return String(numeric);
    return this._yamlString(value);
  },

  _yamlParamValue(value, type) {
    if (type === 'bool') return String(value).toLowerCase() === 'true' ? 'true' : 'false';
    if (type === 'int' || type === 'float' || type === 'double') {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? String(numeric) : '0';
    }
    return this._yamlString(value);
  },

  parseTaskYaml(text) {
    const tasks = [];
    let task = null;
    let action = null;
    let missionId = 1;
    let missionIndex = -1;
    String(text || '').split(/\r?\n/).forEach(rawLine => {
      const line = rawLine.replace(/\s+$/, '');
      let match = line.match(/^- task_id:\s*(.*)$/);
      if (match) {
        const parsedTaskId = String(this._parseYamlScalar(match[1]));
        task = {
          taskId: parsedTaskId || `(이름 없는 Task ${tasks.length + 1})`,
          loopFlag: 1,
          queue: [],
          missionsEmpty: false
        };
        tasks.push(task);
        action = null;
        missionId = 1;
        missionIndex = -1;
        return;
      }
      if (!task) return;
      if (/^\s{4}\[\]\s*$/.test(line)) {
        task.missionsEmpty = true;
        return;
      }
      match = line.match(/^\s+loop_flag:\s*(.*)$/);
      if (match) {
        task.loopFlag = Math.max(0, parseInt(this._parseYamlScalar(match[1]), 10) || 0);
        return;
      }
      match = line.match(/^\s{4}- mission_id:\s*(.*)$/);
      if (match) {
        missionId = this._parseYamlScalar(match[1]);
        missionIndex += 1;
        action = null;
        return;
      }
      match = line.match(/^\s{8}- action_id:\s*(.*)$/);
      if (match) {
        action = {
          name: String(this._parseYamlScalar(match[1])),
          actionType: '',
          args: [],
          params: [],
          missionId,
          missionIndex: Math.max(0, missionIndex)
        };
        task.queue.push(action);
        return;
      }
      if (!action) return;
      match = line.match(/^\s+action_type:\s*(.*)$/);
      if (match) {
        const type = Number(this._parseYamlScalar(match[1]));
        action.actionType = Number.isFinite(type) ? `0x${type.toString(16).padStart(2, '0')}` : '';
        return;
      }
      match = line.match(/^\s+action_args:\s*(\[.*\])\s*$/);
      if (match) {
        action.args = this._parseYamlInlineArray(match[1]);
        return;
      }
      match = line.match(/^\s{12}-\s*(\[.*\])\s*$/);
      if (match) {
        const values = this._parseYamlInlineArray(match[1]);
        action.params.push({
          param_name: String(values[0] ?? ''),
          type: String(values[1] ?? 'string'),
          value: String(values[2] ?? '')
        });
      }
    });

    tasks.forEach(parsedTask => {
      parsedTask.queue.forEach((item, index) => {
        const config = this.actionTypes[item.actionType];
        const argText = item.args.map((value, argIndex) =>
          `${config?.args?.[argIndex]?.name || `arg${argIndex + 1}`}:${value}`
        ).join(', ');
        if (!item.name) item.name = `${config?.name || 'Action'}_${index + 1}`;
        item.summary = `${item.name}: ${config?.name || item.actionType} (${argText})`;
      });
    });
    return tasks;
  },

  _parseYamlInlineArray(source) {
    const body = String(source || '').trim().replace(/^\[/, '').replace(/\]$/, '');
    if (!body.trim()) return [];
    const values = [];
    let token = '';
    let quote = '';
    let escaped = false;
    for (const char of body) {
      if (escaped) {
        token += char;
        escaped = false;
      } else if (char === '\\' && quote === '"') {
        token += char;
        escaped = true;
      } else if (quote) {
        token += char;
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") {
        quote = char;
        token += char;
      } else if (char === ',') {
        values.push(this._parseYamlScalar(token));
        token = '';
      } else {
        token += char;
      }
    }
    values.push(this._parseYamlScalar(token));
    return values;
  },

  _parseYamlScalar(source) {
    const value = String(source ?? '').trim();
    if (!value) return '';
    if (value.startsWith('"') && value.endsWith('"')) {
      try { return JSON.parse(value); } catch (error) { return value.slice(1, -1); }
    }
    if (value.startsWith("'") && value.endsWith("'")) {
      return value.slice(1, -1).replace(/''/g, "'");
    }
    if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
    if (/^null$/i.test(value)) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  },

  // Import ROS Task YAML. Legacy JSON mission files remain supported.
  importMission(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const source = String(e.target.result || '');
        if (/\.json$/i.test(file.name || '') || source.trim().startsWith('{')) {
          const mission = JSON.parse(source);
          if (!mission.actions || !Array.isArray(mission.actions)) throw new Error('Invalid mission format');
          this._saveSnapshot();
          this.actionQueue = mission.actions;
          this.renderQueue();
          App.toast(`Mission imported: ${mission.actions.length} actions`, 'success');
          return;
        }

        const tasks = this.parseTaskYaml(source);
        if (tasks.length === 0) throw new Error('task_id와 actions를 찾을 수 없습니다');
        const saved = this.getSavedQueues();
        const sourceFile = file.name || 'task.yaml';
        const existingKeys = Object.keys(saved).filter(key => saved[key]?.importedFrom === sourceFile);
        if (existingKeys.length > 0 &&
            !confirm(`"${sourceFile}"에서 불러온 Task ${existingKeys.length}개를 새 내용으로 교체하시겠습니까?`)) {
          return;
        }
        existingKeys.forEach(key => delete saved[key]);
        const importedNames = [];
        tasks.forEach(task => {
          let name = task.taskId;
          let suffix = 2;
          while (Object.prototype.hasOwnProperty.call(saved, name)) {
            name = `${task.taskId} (${sourceFile} ${suffix})`;
            suffix += 1;
          }
          saved[name] = {
            queue: task.queue,
            loopFlag: task.loopFlag,
            savedAt: Date.now(),
            importedFrom: sourceFile,
            yamlTaskId: task.taskId,
            missionsEmpty: Boolean(task.missionsEmpty)
          };
          importedNames.push(name);
        });
        localStorage.setItem(this.QUEUE_STORAGE_KEY, JSON.stringify(saved));
        this._activeTaskSource = sourceFile;
        localStorage.setItem(this.TASK_FILE_SELECTION_KEY, sourceFile);
        const first = saved[importedNames[0]];
        this._saveSnapshot();
        this.actionQueue = JSON.parse(JSON.stringify(first.queue));
        this.renderQueue();
        const nameInput = document.getElementById('action-queue-save-name');
        const taskIdInput = document.getElementById('action-work-id');
        const loopInput = document.getElementById('action-loop-count');
        if (nameInput) nameInput.value = first.yamlTaskId || importedNames[0];
        if (taskIdInput) taskIdInput.value = first.yamlTaskId || importedNames[0];
        if (loopInput) loopInput.value = String(first.loopFlag ?? 1);
        this.refreshSavedQueueList();
        const select = document.getElementById('action-queue-load-select');
        if (select) select.value = importedNames[0];
        this.renderTaskDetail(document.getElementById('action-saved-task-detail'), importedNames[0]);
        this._notifyTaskStoreChanged();
        App.toast(`"${sourceFile}"에서 Task ${importedNames.length}개를 불러왔습니다`, 'success');
      } catch (err) {
        App.toast('Task 파일 오류: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  },

  // Save current form values to localStorage
  saveLastParams(actionType) {
    const config = this.actionTypes[actionType];
    if (!config) return;

    // Load existing saved data
    let savedData = {};
    try {
      savedData = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
    } catch (e) {
      savedData = {};
    }

    // Collect current args
    const args = [];
    config.args.forEach((arg, idx) => {
      const input = document.getElementById(`action-arg-${idx}`);
      args.push(input ? input.value : arg.default);
    });

    // Collect current params
    const params = [];
    config.params.forEach((param, idx) => {
      const input = document.getElementById(`action-param-${idx}`);
      params.push({
        name: param.name,
        value: input ? input.value : param.default
      });
    });

    // Save task ID
    const taskId = document.getElementById('action-work-id').value;

    // Store for this action type
    savedData[actionType] = {
      args: args,
      params: params,
      taskId: taskId
    };

    // B13 fix: localStorage 안전 쓰기
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(savedData)); }
    catch (e) { console.warn('localStorage.setItem ActionSender STORAGE_KEY failed:', e.message); }
    console.log('[ActionSender] Saved params for', actionType);
  },

  // Load saved values for an action type
  loadLastParams(actionType) {
    try {
      const savedData = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
      return savedData[actionType] || null;
    } catch (e) {
      return null;
    }
  },

  // Apply saved values to the form
  applySavedParams(actionType) {
    const saved = this.loadLastParams(actionType);
    if (!saved) return;

    const config = this.actionTypes[actionType];
    if (!config) return;

    // Apply saved args
    if (saved.args && saved.args.length > 0) {
      saved.args.forEach((value, idx) => {
        const input = document.getElementById(`action-arg-${idx}`);
        if (input) input.value = value;
      });
    }

    // Apply saved params
    if (saved.params && saved.params.length > 0) {
      saved.params.forEach((savedParam, idx) => {
        const input = document.getElementById(`action-param-${idx}`);
        if (input) input.value = savedParam.value;
      });
      this._syncTargetCfgControl();
    }

    // Apply saved task ID
    if (saved.taskId) {
      document.getElementById('action-work-id').value = saved.taskId;
    }

    console.log('[ActionSender] Loaded saved params for', actionType);
  },

  // Setup waypoint helper buttons (map selection, robot position)
  _setupWaypointHelperButtons() {
    const btnFromMap = document.getElementById('btn-waypoint-from-map');
    const btnFromRobot = document.getElementById('btn-waypoint-from-robot');

    if (btnFromMap) {
      btnFromMap.addEventListener('click', () => {
        this._enterWaypointSelectMode();
      });
    }

    if (btnFromRobot) {
      btnFromRobot.addEventListener('click', () => {
        this._fillFromRobotPosition();
      });
    }
  },

  // Enter map click mode for waypoint selection
  _enterWaypointSelectMode() {
    this._waypointSelectMode = true;
    const btnFromMap = document.getElementById('btn-waypoint-from-map');
    if (btnFromMap) btnFromMap.classList.add('active');

    // Notify RosManager to enter waypoint select mode
    if (typeof RosManager !== 'undefined') {
      RosManager._enterWaypointSelectMode((x, y, theta) => {
        this._fillWaypointArgs(x, y, theta);
        this._exitWaypointSelectMode();
      });
    }

    App.toast('Click map for target, drag for direction', 'info');
  },

  // Exit map click mode
  _exitWaypointSelectMode() {
    if (!this._waypointSelectMode) return;
    this._waypointSelectMode = false;
    const btnFromMap = document.getElementById('btn-waypoint-from-map');
    if (btnFromMap) btnFromMap.classList.remove('active');

    if (typeof RosManager !== 'undefined') {
      RosManager._exitWaypointSelectMode();
    }
  },

  // Fill waypoint args from coordinates
  _fillWaypointArgs(x, y, theta) {
    const xInput = document.getElementById('action-arg-0');
    const yInput = document.getElementById('action-arg-1');
    const thetaInput = document.getElementById('action-arg-2');

    if (xInput) xInput.value = x.toFixed(3);
    if (yInput) yInput.value = y.toFixed(3);
    if (thetaInput) thetaInput.value = theta.toFixed(3);

    App.toast(`Coordinates set: x=${x.toFixed(2)}, y=${y.toFixed(2)}, θ=${(theta * 180 / Math.PI).toFixed(1)}°`, 'success');
  },

  // Fill waypoint args from current robot position
  _fillFromRobotPosition() {
    const pose = RosManager.robotPose;
    if (!pose) {
      App.toast('Robot position not available', 'error');
      return;
    }

    this._fillWaypointArgs(pose.x, pose.y, pose.yaw);
  },

  // Test mode: simulate work state transitions and robot movement
  _simulateTestModeAction(actions, robotId) {
    if (!TestMode.enabled) return;

    // Collect Way_Point actions for navigation
    const waypoints = [];
    let hasNonNavAction = false;

    for (const act of actions) {
      const at = act.action_type;
      if (at === 0x01) {
        // Way_Point: args = [x, y, theta]
        const args = act.action_args || act.args || [];
        waypoints.push({
          x: parseFloat(args[0]) || 0,
          y: parseFloat(args[1]) || 0,
          theta: parseFloat(args[2]) || 0
        });
      } else if (at === 0x15) {
        // TrajectoryFollowing: args = [x0, y0, x1, y1, ..., final_theta]
        const args = act.action_args || act.args || [];
        const finalTheta = parseFloat(args.at(-1)) || 0;
        for (let index = 0; index + 1 < args.length - 1; index += 2) {
          const nextX = parseFloat(args[index + 2]);
          const nextY = parseFloat(args[index + 3]);
          const segmentTheta = Number.isFinite(nextX) && Number.isFinite(nextY)
            ? Math.atan2(nextY - Number(args[index + 1]), nextX - Number(args[index]))
            : finalTheta;
          waypoints.push({
            x: parseFloat(args[index]) || 0,
            y: parseFloat(args[index + 1]) || 0,
            theta: index + 2 < args.length - 1 ? segmentTheta : finalTheta
          });
        }
      } else if (at === 0x02) {
        // Basic_Move: args = [move_type, amount]
        const args = act.action_args || act.args || [];
        const moveType = parseInt(args[0]) || 0;
        const amount = parseFloat(args[1]) || 0;
        if (moveType === 0) {
          // Linear: move forward by amount in current yaw direction
          const curYaw = TestMode._pose.yaw;
          waypoints.push({
            x: TestMode._pose.x + Math.cos(curYaw) * amount,
            y: TestMode._pose.y + Math.sin(curYaw) * amount,
            theta: curYaw
          });
        } else {
          // Rotation: rotate by amount degrees
          const rad = (amount * Math.PI) / 180;
          waypoints.push({
            x: TestMode._pose.x,
            y: TestMode._pose.y,
            theta: TestMode._pose.yaw + rad
          });
        }
      } else {
        hasNonNavAction = true;
      }
    }

    // Execute navigation for waypoints
    if (waypoints.length > 0) {
      if (waypoints.length === 1) {
        TestMode.navigateTo(waypoints[0].x, waypoints[0].y, waypoints[0].theta);
      } else {
        TestMode.navigateQueue(waypoints);
      }
      return; // navigateTo handles workState itself
    }

    // Non-navigation actions: apply static work state
    if (hasNonNavAction) {
      const actionType = actions[0] ? actions[0].action_type : 0;
      const ACTION_STATE_MAP = {
        0x07: 7,  // Stand_By → STAND BY
        0x08: 2,  // Docking → DOCK
        0x10: 8,  // DockingOut → DOCK OUT
        0x12: 8,  // DockingOut_0x12 → DOCK OUT
        0x15: 1,  // TrajectoryFollowing → WORK
        0x16: 1,  // Lift → WORK
        0x17: 1,  // Change_Map → WORK
        0x18: 1,  // Conveyor → WORK
        0x19: 1,  // Quad_Basic_Move → WORK
        0x21: 1,  // Forklift → WORK
        0x22: 1   // Turntable → WORK
      };
      const state = ACTION_STATE_MAP[actionType];
      if (state !== undefined) {
        TestMode.setWorkState(state);
        const delay = (actionType === 0x08 || actionType === 0x10) ? 5000 : 8000;
        setTimeout(() => {
          if (TestMode.enabled && TestMode._workState === state) {
            TestMode.setWorkState(0);
          }
        }, delay);
      }
    }
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  ActionSender.init();
});
