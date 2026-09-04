// Action Sender - ROS Service Call to TARU
const ActionSender = {
  STORAGE_KEY: 'actionSenderLastParams',
  QUEUE_STORAGE_KEY: 'actionSenderSavedQueues',
  TASK_FILE_SELECTION_KEY: 'actionSenderTaskFileSelection',
  TASK_INTERFACE_MODE_KEY: 'actionSenderTaskInterfaceModeByRobot',
  TASK_INTERFACE_DISCOVERY_TIMEOUT_MS: 2500,
  TUNNEL_TASK_INTERFACE_DISCOVERY_TIMEOUT_MS: 6000,
  BUILTIN_TASK_PANEL_KEY: 'actionSenderBuiltinTaskPanelOpen',
  RECENT_TASK_RUNS_KEY: 'actionSenderRecentTaskRuns',
  MAX_RECENT_TASK_RUNS: 3,
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
  _taskCancelPromises: new Map(),
  _builderMode: 'list',
  _editingTaskName: '',
  _editingActionIndex: -1,
  _editingActionBaselineSignature: '',
  _activeTaskSource: '__local__',
  _quickTaskItems: [],
  _quickTaskMode: '',
  _quickTrajectoryDraft: [],
  _quickFreehandDraft: [],
  _quickTaskSequence: 0,
  _quickDockWizard: null,
  _quickDriveCaptureStartIndex: 0,
  _quickTerminalActionContext: null,
  _quickTaskDeleteUndoStack: [],
  _quickTaskSelectedAction: null,
  _runningTasks: new Map(),
  _recentTaskRuns: [],
  _taskInfoMiniDismissed: new Set(),
  _taskInfoModalMode: '',
  _editingBuiltinTaskName: '',
  _activeTaskDisplay: { showRoute: true, showSummary: false },
  _taskPreview: null,
  _taskInterfaceModes: {},
  _taskInterfaceUiToken: 0,

  // Action type definitions with default args and params
  // Based on the live r51 sp_task action modules and params_mapper.yaml
  // Snapshot: 2026-08-11, /home/syscon/catkin_ws/src/core_system/sp_task

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
    free_goal_vel: '목표점 속도 유지',
    motion_direction: '주행 방향 모드',
    prediction_horizon: 'MPC 예측 구간',
    control_horizon: 'MPC 제어 구간',
    forklift_lift: '주행 중 포크 승강',
    qr_bottom_reading_mode: '하부 QR 판독',
    qr_target: 'QR 목표값',
    pause_on_qr_undetected: 'QR 미검출 시 일시정지',
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
    async_mode: '비동기 완료 사용',
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
        { name: 'set_local_planner', type: 'int', default: '0', desc: '0:Pure, 1:TEB, 2:MPC, 3:DWA' },
        { name: 'free_goal_vel', type: 'bool', default: 'false', desc: 'TEB: keep velocity at the goal' },
        { name: 'motion_direction', type: 'int', default: '0', desc: 'Pure/MPC motion direction' },
        { name: 'prediction_horizon', type: 'int', default: '20', desc: 'MPC prediction horizon' },
        { name: 'control_horizon', type: 'int', default: '6', desc: 'MPC control horizon' },
        { name: 'forklift_lift', type: 'int', default: '0', desc: 'Optional simultaneous forklift lift command' },
        { name: 'qr_bottom_reading_mode', type: 'bool', default: 'false', desc: 'Enable bottom QR reading' },
        { name: 'qr_target', type: 'float', default: '360.0', desc: 'Bottom QR target value' },
        { name: 'pause_on_qr_undetected', type: 'bool', default: 'false', desc: 'Pause when the expected QR is not detected' }
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
        { name: 'id', type: 'string', default: '', desc: 'wake_up condition ID (empty=any condition)' }
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
        { name: 'dock_dist', type: 'float', default: '1.2', desc: 'Docking start/completion distance (m, end_condition=1)' },
        { name: 'dock_dist_flag', type: 'bool', default: 'false', desc: 'true:Robot center ref, false:Robot edge ref' },
        { name: 'scan_view', type: 'int', default: '0', desc: '0:front, 1:left, 2:rear, 3:right' },
        { name: 'x_offset', type: 'float', default: '0.0', desc: 'X-axis offset (m)' },
        { name: 'y_offset', type: 'float', default: '0.0', desc: 'Y-axis offset (m)' },
        { name: 'center_offset', type: 'float', default: '0.0', desc: 'L-marker offset or target-mode final heading offset (deg)' },
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
        { name: 'driving_type', type: 'int', default: '1', desc: '0:Following, 1:Overtake, 2:StopAndGo, 3:ObstacleAvoid, 4:Carriageway, 5:Bypass' },
        { name: 'lane_direction', type: 'int', default: '0', desc: '0:Forward, 1:ForwardLeft, 2:ForwardRight, 3:Backward, 4:BackwardLeft, 5:BackwardRight' },
        { name: 'lane_type', type: 'int', default: '0', desc: '0:Strict(straight), 1:Smooth, 2:Off' },
        { name: 'max_trans_vel', type: 'float', default: '1.8', desc: 'Max velocity (m/s)' },
        { name: 'max_rot_vel', type: 'float', default: '1.0', desc: 'Max angular velocity (rad/s)' },
        { name: 'xy_goal_tolerance', type: 'float', default: '0.15', desc: 'XY tolerance (m)' },
        { name: 'yaw_goal_tolerance', type: 'float', default: '0.05', desc: 'Angle tolerance (rad)' },
        { name: 'road_width', type: 'float', default: '4.0', desc: 'Rollout avoidance width (m)' },
        { name: 'passing_flag', type: 'bool', default: 'false', desc: 'Ignore angle' },
        { name: 'passing_dist', type: 'float', default: '0.03', desc: 'Passing recognition distance (m)' },
        { name: 'backward_driving', type: 'bool', default: 'false', desc: 'Backward driving' },
        { name: 'set_local_planner', type: 'int', default: '0', desc: '0:Pure, 1:TEB, 2:MPC, 3:DWA' },
        { name: 'free_goal_vel', type: 'bool', default: 'false', desc: 'TEB: keep velocity at the goal' },
        { name: 'model_type', type: 'int', default: '0', desc: 'MPC model type' },
        { name: 'motion_direction', type: 'int', default: '0', desc: 'MPC motion direction' },
        { name: 'prediction_horizon', type: 'int', default: '20', desc: 'MPC prediction horizon' },
        { name: 'control_horizon', type: 'int', default: '6', desc: 'MPC control horizon' },
        { name: 'avoid_mode', type: 'bool', default: 'true', desc: 'MPC rollout-path obstacle avoidance' },
        { name: 'forklift_lift', type: 'int', default: '0', desc: 'Optional simultaneous forklift lift command' },
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
        { name: 'move_vel', type: 'float', default: '0.5', desc: 'Maximum translation/rotation command magnitude' },
        { name: 'heading_yaw', type: 'float', default: '0', desc: 'Robot rotation angle (deg)' },
        { name: 'rotate_first', type: 'bool', default: 'true', desc: 'true:Rotate then move, false:Move while rotating' }
      ]
    },
    '0x21': {
      name: 'Forklift',
      desc: 'Forklift module control',
      args: [
        {
          name: 'mode',
          default: 1,
          desc: '0:Stop, 1:Lift, 2:Shift, 3:Positioning, 4:Tilt',
          enumValues: [
            { value: 0, label: '정지' },
            { value: 1, label: 'Lift' },
            { value: 2, label: 'Shift' },
            { value: 3, label: 'Positioning' },
            { value: 4, label: 'Tilt' }
          ]
        },
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
        {
          name: 'mode',
          default: 3,
          desc: '0:Stop, 1:CCW, 2:CW, 3:Target, 4:LoadCCW, 5:LoadCW, 6:Nearest, 11~16:KIVA, 20:Reset',
          enumValues: [
            { value: 0, label: '정지' },
            { value: 1, label: 'CCW' },
            { value: 2, label: 'CW' },
            { value: 3, label: '목표 각도' },
            { value: 4, label: 'Load CCW' },
            { value: 5, label: 'Load CW' },
            { value: 6, label: '가장 가까운 각도' },
            { value: 11, label: 'KIVA CCW' },
            { value: 12, label: 'KIVA CW' },
            { value: 13, label: 'KIVA 목표 각도' },
            { value: 14, label: 'KIVA Load CCW' },
            { value: 15, label: 'KIVA Load CW' },
            { value: 16, label: 'KIVA 가장 가까운 각도' },
            { value: 20, label: 'Reset Routine' }
          ]
        },
        { name: 'target', default: 0, desc: 'mode3,13: Target angle (deg)' }
      ],
      params: []
    }
  },

  turntableAsyncArg: {
    name: 'async_mode',
    label: '3번째 인자 · 비동기 완료',
    type: 'bool',
    default: 0,
    desc: '체크 시 asyncmode=1, 해제 시 asyncmode=0으로 전달합니다.'
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
    this._loadTaskInterfaceModes();
    this.setupEventListeners();
    this._setupTaskInterfaceSelector();
    this.setupCommonParamsUI();
    this.updateActionForm('0x01'); // Default to WayPoint
    this.ensureDefaultTasks();
    this.refreshSavedQueueList();
    this._loadRecentTaskRuns();
    this.renderRecentTaskRuns();
    this._subscribeTaskTelemetry();
    this._syncActionCompatibilityUi();
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
      if (existing && (
        !existing.builtin
        || existing.builtinCustomized
        || existing.builtinVersion === this.BUILTIN_TASK_VERSION
      )) return;
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

  _getDefaultTaskSpec(name) {
    return this.defaultTaskSpecs.find(spec => spec.name === name) || null;
  },

  _createBuiltinTaskSettingControl(field, value, kind, index) {
    let control;
    if (Array.isArray(field.enumValues)) {
      control = document.createElement('select');
      field.enumValues.forEach(option => {
        const element = document.createElement('option');
        element.value = String(option.value);
        element.textContent = option.label;
        control.appendChild(element);
      });
    } else if (field.type === 'bool') {
      control = document.createElement('select');
      [
        { value: 'false', label: '사용 안 함' },
        { value: 'true', label: '사용' }
      ].forEach(option => {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        control.appendChild(element);
      });
    } else {
      control = document.createElement('input');
      const numeric = kind === 'arg' || field.type === 'int' || field.type === 'float';
      control.type = numeric ? 'number' : 'text';
      if (numeric) control.step = field.type === 'int' ? '1' : 'any';
    }
    control.value = String(value ?? field.default ?? '');
    control.dataset.builtinKind = kind;
    control.dataset.index = String(index);
    control.dataset.name = field.name || '';
    control.dataset.type = field.type || (kind === 'arg' ? 'float' : 'string');
    control.setAttribute('aria-label', this._fieldLabel(field));
    return control;
  },

  _appendBuiltinTaskSettingSection(body, title, fields, values, kind) {
    if (!fields.length) return;
    const section = document.createElement('section');
    section.className = 'builtin-task-setting-section';
    const heading = document.createElement('h4');
    heading.textContent = title;
    section.appendChild(heading);
    const grid = document.createElement('div');
    grid.className = 'builtin-task-setting-grid';
    fields.forEach((field, index) => {
      const row = document.createElement('label');
      row.className = 'builtin-task-setting-row';
      const label = document.createElement('span');
      const friendly = document.createElement('strong');
      friendly.textContent = this._fieldLabel(field);
      const key = document.createElement('small');
      key.textContent = field.name || '';
      label.appendChild(friendly);
      label.appendChild(key);
      const control = this._createBuiltinTaskSettingControl(
        field,
        values[index],
        kind,
        index
      );
      const description = document.createElement('small');
      description.className = 'builtin-task-setting-description';
      description.textContent = field.desc || '';
      row.appendChild(label);
      row.appendChild(control);
      row.appendChild(description);
      grid.appendChild(row);
    });
    section.appendChild(grid);
    body.appendChild(section);
  },

  openBuiltinTaskSettings(name) {
    const saved = this.getSavedQueues();
    const entry = saved[name];
    const item = entry?.queue?.[0];
    const actionType = this._actionTypeKey(item);
    const config = this.actionTypes[actionType];
    const modal = document.getElementById('builtin-task-settings-modal');
    const body = document.getElementById('builtin-task-settings-body');
    if (!entry?.builtin || !item || !config || !modal || !body) {
      App.toast('기본 Task 설정 정보를 불러올 수 없습니다.', 'error');
      return false;
    }

    this._editingBuiltinTaskName = name;
    const title = document.getElementById('builtin-task-settings-title');
    const subtitle = document.getElementById('builtin-task-settings-subtitle');
    const status = document.getElementById('builtin-task-settings-status');
    if (title) title.textContent = `용도별 설정 · ${entry.yamlTaskId || name}`;
    if (subtitle) subtitle.textContent = `${actionType} · ${config.name} · 저장 후 이 PC의 EasyLoop에서 계속 사용`;
    if (status) {
      status.textContent = entry.builtinCustomized
        ? '현재 사용자 설정값을 불러왔습니다.'
        : '현재 추천 초기값을 사용 중입니다.';
      status.dataset.state = entry.builtinCustomized ? 'saved' : 'default';
    }

    body.innerHTML = '';
    this._appendBuiltinTaskSettingSection(
      body,
      '필수 입력 · Arguments',
      config.args,
      Array.from(item.args || item.action_args || []),
      'arg'
    );
    const paramMap = new Map(
      Array.from(item.params || item.action_params || [])
        .map(param => [param.param_name || param.name, String(param.value ?? '')])
    );
    this._appendBuiltinTaskSettingSection(
      body,
      '주행·동작 상세 · Parameters',
      config.params,
      config.params.map(param => paramMap.has(param.name) ? paramMap.get(param.name) : param.default),
      'param'
    );
    this._appendBuiltinTaskSettingSection(
      body,
      '공통 동작 설정 · Common Parameters',
      this.commonParams,
      this.commonParams.map(param => paramMap.has(param.name) ? paramMap.get(param.name) : param.default),
      'common'
    );

    const loopSection = document.createElement('section');
    loopSection.className = 'builtin-task-setting-section builtin-task-loop-setting';
    const loopLabel = document.createElement('label');
    loopLabel.className = 'builtin-task-setting-row';
    loopLabel.innerHTML = '<span><strong>반복 횟수</strong><small>loop_flag · 0은 무한 반복</small></span>';
    const loopInput = document.createElement('input');
    loopInput.type = 'number';
    loopInput.min = '0';
    loopInput.max = '9999';
    loopInput.step = '1';
    loopInput.value = String(entry.loopFlag ?? 1);
    loopInput.dataset.builtinKind = 'loop';
    loopLabel.appendChild(loopInput);
    loopSection.appendChild(loopLabel);
    body.appendChild(loopSection);

    modal.classList.add('show');
    body.querySelector('[data-builtin-kind]')?.focus?.();
    return true;
  },

  closeBuiltinTaskSettings() {
    document.getElementById('builtin-task-settings-modal')?.classList.remove('show');
    this._editingBuiltinTaskName = '';
  },

  saveBuiltinTaskSettings() {
    const name = this._editingBuiltinTaskName;
    const saved = this.getSavedQueues();
    const entry = saved[name];
    const original = entry?.queue?.[0];
    const actionType = this._actionTypeKey(original);
    const config = this.actionTypes[actionType];
    const body = document.getElementById('builtin-task-settings-body');
    if (!entry?.builtin || !original || !config || !body) return false;

    const args = Array(config.args.length).fill(0);
    body.querySelectorAll('[data-builtin-kind="arg"]').forEach(control => {
      args[Number(control.dataset.index)] = Number(control.value) || 0;
    });
    const params = [];
    body.querySelectorAll('[data-builtin-kind="param"]').forEach(control => {
      params.push({
        param_name: control.dataset.name,
        type: control.dataset.type,
        value: control.value
      });
    });
    body.querySelectorAll('[data-builtin-kind="common"]').forEach(control => {
      const definition = this.commonParams[Number(control.dataset.index)];
      if (!definition || control.value === String(definition.default ?? '')) return;
      params.push({
        param_name: control.dataset.name,
        type: control.dataset.type,
        value: control.value
      });
    });
    const loopControl = body.querySelector('[data-builtin-kind="loop"]');
    const loopFlag = Math.max(0, Math.min(9999, Number(loopControl?.value) || 0));
    const item = this.normalizeActionForSend({
      ...JSON.parse(JSON.stringify(original)),
      name,
      actionType,
      args,
      params,
      summary: `${name}: ${config.name}`
    });
    if (actionType === '0x18') item.conveyorFloor = Number(args[1]) || 1;

    saved[name] = {
      ...entry,
      queue: [item],
      loopFlag,
      savedAt: Date.now(),
      builtin: true,
      builtinVersion: this.BUILTIN_TASK_VERSION,
      builtinCustomized: true
    };
    try {
      localStorage.setItem(this.QUEUE_STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
      App.toast(`기본 Task 설정 저장 실패: ${error.message}`, 'error');
      return false;
    }
    this.refreshSavedQueueList();
    this._notifyTaskStoreChanged();
    App.toast(`"${name}" 용도별 설정을 이 PC에 저장했습니다.`, 'success');
    this.closeBuiltinTaskSettings();
    return true;
  },

  resetDefaultTask(name = this._editingBuiltinTaskName, requireConfirm = true) {
    const spec = this._getDefaultTaskSpec(name);
    if (!spec) return false;
    if (requireConfirm && !confirm(`"${name}" 설정을 추천 초기값으로 복원하시겠습니까?`)) {
      return false;
    }
    const item = this._buildDefaultTaskItem(spec);
    if (!item) return false;
    const saved = this.getSavedQueues();
    saved[name] = {
      queue: [item],
      savedAt: Date.now(),
      loopFlag: 1,
      builtin: true,
      builtinVersion: this.BUILTIN_TASK_VERSION,
      builtinCustomized: false
    };
    try {
      localStorage.setItem(this.QUEUE_STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
      App.toast(`기본값 복원 실패: ${error.message}`, 'error');
      return false;
    }
    this.refreshSavedQueueList();
    this._notifyTaskStoreChanged();
    App.toast(`"${name}" 추천 초기값을 복원했습니다.`, 'success');
    if (document.getElementById('builtin-task-settings-modal')?.classList?.contains('show')) {
      this.openBuiltinTaskSettings(name);
    }
    return true;
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
      this._syncActionEditButtons();
    });
    const taskBuilderView = document.getElementById('task-builder-view');
    ['input', 'change'].forEach(eventName => {
      taskBuilderView?.addEventListener(eventName, event => {
        if (event.target?.closest?.('.action-buttons')) return;
        this._syncActionEditButtons();
        if (this._editingActionIndex >= 0) {
          this._showEditorTaskPreview(this._editingActionIndex, true);
        }
      });
    });

    document.addEventListener('amr:active-robot-changed', () => {
      this._syncTaskInterfaceSelector();
      this._subscribeTaskTelemetry();
      this._syncActiveRunningTask();
      this._syncActionCompatibilityUi();
      const typeSelect = document.getElementById('action-type');
      if (typeSelect?.value !== '0x08') return;
      this._closeTargetCfgDetails();
      const config = this.actionTypes['0x08'];
      const targetCfgIndex = config.params.findIndex(param => param.name === 'target_cfg');
      if (targetCfgIndex >= 0) this._loadTargetCfgOptions(targetCfgIndex, true);
    });
    document.addEventListener('amr:compatibility-updated', () => {
      this._syncActionCompatibilityUi();
      const typeSelect = document.getElementById('action-type');
      if (typeSelect?.value) this.updateActionForm(typeSelect.value);
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
    const builtinTaskToggle = document.getElementById('builtin-task-toggle');
    try {
      if (builtinTaskToggle) {
        builtinTaskToggle.open = localStorage.getItem(this.BUILTIN_TASK_PANEL_KEY) === 'true';
      }
    } catch (error) {
      console.warn('기본 Task 토글 상태 불러오기 실패:', error.message);
    }
    builtinTaskToggle?.addEventListener('toggle', () => {
      try {
        localStorage.setItem(this.BUILTIN_TASK_PANEL_KEY, String(builtinTaskToggle.open));
      } catch (error) {
        console.warn('기본 Task 토글 상태 저장 실패:', error.message);
      }
    });
    document.getElementById('btn-builtin-task-settings-save')?.addEventListener('click', () => {
      this.saveBuiltinTaskSettings();
    });
    [
      'btn-builtin-task-settings-close',
      'btn-builtin-task-settings-cancel'
    ].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        this.closeBuiltinTaskSettings();
      });
    });
    document.getElementById('btn-builtin-task-settings-reset')?.addEventListener('click', () => {
      this.resetDefaultTask(this._editingBuiltinTaskName, true);
    });
    document.getElementById('builtin-task-settings-modal')?.addEventListener('click', event => {
      if (event.target?.id === 'builtin-task-settings-modal') this.closeBuiltinTaskSettings();
    });
    document.addEventListener('keydown', event => {
      const modal = document.getElementById('builtin-task-settings-modal');
      if (event.key === 'Escape' && modal?.classList?.contains('show')) {
        this.closeBuiltinTaskSettings();
      }
    });
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
    document.getElementById('btn-global-quick-task')?.addEventListener('click', () => {
      this.openQuickTaskFromHeader();
    });
    document.getElementById('btn-close-quick-task')?.addEventListener('click', () => {
      this.closeQuickTaskBuilder();
    });
    document.getElementById('btn-quick-task-info')?.addEventListener('click', () => {
      const name = document.getElementById('quick-task-name')?.value?.trim() || 'Quick Task';
      const loopFlag = Number(document.getElementById('quick-task-loop')?.value) || 0;
      const items = [...this._quickTaskItems];
      if (this._quickTrajectoryDraft.length > 0) {
        items.push({
          kind: 'trajectory',
          points: JSON.parse(JSON.stringify(this._quickTrajectoryDraft)),
          trajectory: this._readQuickTrajectoryOptions()
        });
      }
      this.showTaskInfoFromQueue(name, this.compileQuickTaskItems(items), loopFlag, '작성 중');
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
    document.getElementById('btn-quick-freehand')?.addEventListener('click', () => {
      this.startQuickFreehandCapture();
    });
    document.getElementById('btn-quick-trajectory-finish')?.addEventListener('click', () => {
      this.finishQuickDrivingInput();
    });
    document.getElementById('btn-quick-docking')?.addEventListener('click', () => {
      this.startQuickMapCapture('docking');
    });
    document.getElementById('btn-quick-docking-inline')?.addEventListener('click', () => {
      this.addQuickDocking();
    });
    ['btn-quick-docking-out', 'btn-quick-docking-out-inline'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        this.addQuickDockingOut();
      });
    });
    document.getElementById('btn-quick-docking-out-map')?.addEventListener('click', () => {
      this.startQuickDockingOutMapCapture();
    });
    document.getElementById('btn-quick-standby')?.addEventListener('click', () => {
      this.addQuickStandby();
    });
    document.getElementById('btn-quick-terminal-docking')?.addEventListener('click', () => {
      this._selectQuickTerminalAction('docking');
    });
    document.getElementById('btn-quick-terminal-docking-out')?.addEventListener('click', () => {
      this._selectQuickTerminalAction('docking-out');
    });
    document.getElementById('btn-quick-terminal-standby')?.addEventListener('click', () => {
      this._selectQuickTerminalAction('standby');
    });
    const closeTerminalChooser = () => this._selectQuickTerminalAction('none');
    document.getElementById('btn-quick-terminal-none')?.addEventListener('click', closeTerminalChooser);
    document.getElementById('btn-quick-terminal-close')?.addEventListener('click', closeTerminalChooser);
    document.getElementById('quick-terminal-action-modal')?.addEventListener('click', event => {
      if (event.target?.id === 'quick-terminal-action-modal') closeTerminalChooser();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this._quickTerminalActionContext) closeTerminalChooser();
    });
    document.getElementById('btn-quick-task-undo')?.addEventListener('click', () => {
      this.undoQuickTaskItem();
    });
    document.getElementById('btn-quick-task-clear')?.addEventListener('click', () => {
      this.clearQuickTask();
    });
    document.getElementById('btn-quick-action-undo-delete')?.addEventListener('click', () => {
      this.undoQuickActionDelete();
    });
    document.addEventListener('keydown', event => {
      this._handleQuickTaskShortcut(event);
    }, true);
    document.addEventListener('keydown', event => {
      this._handleBuilderEscape(event);
    }, true);
    document.getElementById('btn-close-task-builder')?.addEventListener('click', () => {
      this.closeTaskBuilder();
    });
    document.getElementById('btn-builder-task-info')?.addEventListener('click', () => {
      const name = document.getElementById('action-queue-save-name')?.value?.trim()
        || document.getElementById('action-work-id')?.value?.trim()
        || '작성 중 Task';
      const loopFlag = Number(document.getElementById('action-loop-count')?.value) || 0;
      this.showTaskInfoFromQueue(name, this.actionQueue, loopFlag, '작성 중');
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
    document.getElementById('btn-running-task-info')?.addEventListener('click', () => {
      this.showActiveRunningTaskInfo();
    });
    document.getElementById('btn-active-task-info')?.addEventListener('click', () => {
      this.showActiveRunningTaskInfo();
    });
    document.getElementById('btn-task-preview-map-close')?.addEventListener('click', () => {
      this.clearTaskPreview();
    });
    document.getElementById('btn-task-preview-map-all')?.addEventListener('click', () => {
      if (!this._taskPreview) return;
      this.showTaskPreview(
        this._taskPreview.taskName,
        this._taskPreview.queue,
        null,
        {
          source: this._taskPreview.source,
          storageKey: this._taskPreview.storageKey
        }
      );
    });
    document.getElementById('active-task-show-route')?.addEventListener('change', event => {
      this._activeTaskDisplay.showRoute = event.target.checked;
      this._syncActiveRunningTask();
    });
    document.getElementById('active-task-show-summary')?.addEventListener('change', event => {
      this._activeTaskDisplay.showSummary = event.target.checked;
      this._syncActiveRunningTask();
    });
    document.getElementById('btn-task-info-close')?.addEventListener('click', () => {
      this.closeTaskInfo();
    });
    document.getElementById('btn-task-info-close2')?.addEventListener('click', () => {
      this.closeTaskInfo();
    });
    document.getElementById('task-info-modal')?.addEventListener('click', event => {
      if (event.target?.id === 'task-info-modal') this.closeTaskInfo();
    });
    document.addEventListener('keydown', event => {
      const modal = document.getElementById('task-info-modal');
      if (event.key === 'Escape' && modal?.classList?.contains('show')) {
        this.closeTaskInfo();
      }
    });
    document.getElementById('btn-task-info-mini-open')?.addEventListener('click', () => {
      const slot = App.robotSlots?.[App.activeSlotIndex];
      if (slot?.robotId) this._taskInfoMiniDismissed.delete(slot.robotId);
      this.showActiveRunningTaskInfo();
    });
    document.getElementById('btn-task-info-mini-close')?.addEventListener('click', () => {
      const slot = App.robotSlots?.[App.activeSlotIndex];
      if (slot?.robotId) this._taskInfoMiniDismissed.add(slot.robotId);
      const mini = document.getElementById('task-info-mini');
      if (mini) mini.hidden = true;
    });
    document.getElementById('btn-quick-dock-next')?.addEventListener('click', () => {
      this._advanceQuickDockWizard();
    });
    document.getElementById('btn-quick-dock-back')?.addEventListener('click', () => {
      this._backQuickDockWizard();
    });
    document.getElementById('btn-quick-dock-defaults')?.addEventListener('click', () => {
      this._finishQuickDockWizardWithRecommendations();
    });
    const cancelDockWizard = () => this._cancelQuickDockWizard();
    document.getElementById('btn-quick-dock-cancel')?.addEventListener('click', cancelDockWizard);
    document.getElementById('btn-quick-dock-cancel-x')?.addEventListener('click', cancelDockWizard);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this._quickDockWizard) cancelDockWizard();
    });

    // Clear queue button
    document.getElementById('btn-clear-queue').addEventListener('click', () => {
      this.clearQueue();
    });
    document.getElementById('btn-save-selected-action')?.addEventListener('click', () => {
      this.saveSelectedAction();
    });
    document.getElementById('btn-apply-params-same-type')?.addEventListener('click', () => {
      this.openSameTypeParamSelector();
    });
    ['btn-action-param-target-close', 'btn-action-param-target-cancel'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        this.closeSameTypeParamSelector();
      });
    });
    document.getElementById('action-param-target-modal')?.addEventListener('click', event => {
      if (event.target?.id === 'action-param-target-modal') {
        this.closeSameTypeParamSelector();
      }
    });
    document.addEventListener('keydown', event => {
      const modal = document.getElementById('action-param-target-modal');
      if (event.key === 'Escape' && modal?.classList?.contains('show')) {
        this.closeSameTypeParamSelector();
      }
    });
    document.getElementById('action-param-target-all')?.addEventListener('change', event => {
      document.querySelectorAll('[data-action-param-target]').forEach(checkbox => {
        checkbox.checked = event.target.checked;
      });
      this._syncParamTargetSelectionStatus();
    });
    document.getElementById('action-param-target-list')?.addEventListener('change', () => {
      this._syncParamTargetSelectionStatus();
    });
    document.getElementById('btn-action-param-target-apply')?.addEventListener('click', () => {
      const selected = Array.from(
        document.querySelectorAll('[data-action-param-target]:checked')
      ).map(checkbox => Number(checkbox.dataset.actionParamTarget));
      if (this.applyParamsToSameType(selected)) this.closeSameTypeParamSelector();
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
      if (name && entry?.queue) this.showSavedTaskPreview(name);
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
    this._syncTaskInterfaceSelector();
    this._updateTaskControlsAvailability();
    this._updateQuickTaskRunAvailability();
    this.renderRecentTaskRuns();
    this.renderTaskLibrary(document.getElementById('task-library-search')?.value || '');
  },

  onSlotConnectionChanged(slotIndex, connected) {
    if (slotIndex !== this.getTargetSlot()) return;
    const slot = App.robotSlots?.[slotIndex];
    if (slot && connected) {
      delete slot.taskInterface;
      delete slot.taskInterfaceModeResolved;
    }
    this.updateTargetStatus();
    this._subscribeTaskTelemetry();
  },

  onCompatibilityProfileChanged(slotIndex) {
    if (slotIndex !== this.getTargetSlot()) return;
    const typeSelect = document.getElementById('action-type');
    if (typeSelect?.value !== '0x22') return;

    const currentArgs = [0, 1].map(index =>
      Number(document.getElementById(`action-arg-${index}`)?.value) || 0
    );
    if (this._turntableUsesAsyncArg(App.robotSlots?.[slotIndex])) {
      currentArgs.push(document.getElementById('action-arg-2')?.checked ? 1 : 0);
    }
    this.updateActionForm('0x22', currentArgs);
    this._actionArgDefinitions('0x22', currentArgs).forEach((definition, index) => {
      const input = document.getElementById(`action-arg-${index}`);
      if (!input) return;
      if (definition.type === 'bool') input.checked = Number(currentArgs[index]) !== 0;
      else input.value = currentArgs[index];
    });
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
    this._quickFreehandDraft = [];
    this._quickTaskMode = '';
    this._quickTaskSequence = 0;
    this._quickDriveCaptureStartIndex = 0;
    this._quickTerminalActionContext = null;
    document.getElementById('quick-terminal-action-modal')?.classList.remove('show');
    this._quickTaskDeleteUndoStack = [];
    this._quickTaskSelectedAction = null;

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

  openQuickTaskFromHeader() {
    const quickView = document.getElementById('quick-task-builder-view');
    const draftAlreadyOpen = this._builderMode === 'quick'
      && Boolean(quickView && !quickView.hidden);
    document.querySelector('.tab-btn[data-tab="tab-action"]')?.click();

    if (!draftAlreadyOpen) {
      this.openQuickTaskBuilder();
      return;
    }

    const mapPanel = document.getElementById('panel-map');
    if (mapPanel?.classList?.contains('collapsed')) {
      document.getElementById('btn-map-panel-expand')?.click();
    }
    this._setQuickTaskMapHudVisible(true);
    quickView.scrollIntoView?.({ block: 'start' });
  },

  closeQuickTaskBuilder(force = false) {
    const hasDraft = this._quickTaskItems.length > 0
      || this._quickTrajectoryDraft.length > 0
      || this._quickFreehandDraft.length > 0;
    if (!force && hasDraft && typeof confirm === 'function'
        && !confirm('작성 중인 Quick Task를 취소하시겠습니까?')) {
      return;
    }
    this._stopQuickMapCapture();
    document.getElementById('quick-dock-wizard')?.classList.remove('show');
    document.getElementById('quick-terminal-action-modal')?.classList.remove('show');
    this._quickDockWizard = null;
    this._quickTerminalActionContext = null;
    this._quickTaskItems = [];
    this._quickTrajectoryDraft = [];
    this._quickFreehandDraft = [];
    this._quickTaskDeleteUndoStack = [];
    this._quickTaskSelectedAction = null;
    this._syncQuickTaskOverlay();
    this._updateQuickTaskMapActionSelection();
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
    const { profile, catalog } = this._taskActionCatalog(slot);
    const actionTypes = this.compileQuickTaskItems().map(item => parseInt(item.actionType));
    const unsupported = actionTypes.find(type => !this._actionTypeSupported(type, slot));
    button.disabled = !slot?.connected || !slot.ros || unsupported !== undefined
      || Boolean(catalog?.attempted && !catalog.verified);
    if (!slot?.connected || !slot.ros) {
      button.title = '활성 로봇이 연결되면 저장 후 바로 실행할 수 있습니다.';
    } else if (catalog?.attempted && !catalog.verified) {
      button.title = catalog.reason || '등록 Action 목록 미검증';
    } else if (unsupported !== undefined) {
      const model = profile?.chassis?.driveModel;
      button.title = this._requiresDetectedActionModel(unsupported)
          && model?.attempted && !model.verified
        ? model.reason || '차상 model_type 미검증'
        : `현재 로봇에 Action 0x${unsupported.toString(16).padStart(2, '0')}가 등록되지 않았습니다.`;
    } else {
      button.title = `${slot.robotId}에 현재 Quick Task를 저장 후 실행합니다.`;
    }
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
    if (mode === 'waypoint' || mode === 'trajectory') {
      this._quickDriveCaptureStartIndex = this._quickTaskItems.length;
    }
    this._updateQuickTaskToolState();
    const selectionOptions = {
      twoClick: true,
      onPhaseChange: (phase, point) => {
        if (phase !== 'direction') return;
        const prefix = mode === 'trajectory'
          ? `Trajectory ${this._quickTrajectoryDraft.length + 1}번 점`
          : mode === 'docking'
            ? '도킹 시작점'
            : mode === 'docking-out'
              ? 'DockingOut 시작점'
            : 'WayPoint';
        this._setQuickTaskStatus(
          `${prefix} 위치 (${point.x.toFixed(2)}, ${point.y.toFixed(2)}) 설정됨 · 두 번째 클릭으로 방향을 지정하세요.`
        );
      }
    };
    const capturePoint = (x, y, theta) => {
      if (!this._isQuickTaskBuilderOpen()) {
        this._stopQuickMapCapture();
        return;
      }
      const pose = {
        x: Number(x.toFixed(3)),
        y: Number(y.toFixed(3)),
        theta: Number(theta.toFixed(3))
      };
      if (mode === 'trajectory') {
        this._quickTrajectoryDraft.push(pose);
        this._setQuickTaskStatus(
          `Trajectory 경유점 ${this._quickTrajectoryDraft.length}개 · 계속 찍거나 "주행 입력 완료"를 누르세요.`
        );
        this._syncQuickTaskOverlay();
        this.renderQuickTask();
        return;
      }
      if (mode === 'docking') {
        this._stopQuickMapCapture();
        this._startQuickDockWizard(pose);
        return;
      } else if (mode === 'docking-out') {
        const distance = this._readQuickDockingOutDistance();
        if (distance === null) {
          this._stopQuickMapCapture();
          return;
        }
        this._quickTaskItems.push({ kind: 'docking-out', distance, pose });
        this._quickTaskSequence += 1;
        this._stopQuickMapCapture();
        this._setQuickTaskStatus(
          `맵 지정 DockingOut 추가 · (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)})에서 ${distance} m`
        );
        this.renderQuickTask();
        return;
      } else {
        this._quickTaskItems.push({ kind: 'waypoint', pose });
        this._setQuickTaskStatus(
          `WayPoint 추가: (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}, ${(pose.theta * 180 / Math.PI).toFixed(1)}°) · 다음 위치를 클릭하거나 "WayPoint 입력 완료"를 누르세요.`
        );
      }
      this._quickTaskSequence += 1;
      this.renderQuickTask();
      // RosManager atomically re-arms the next position after every completed
      // click pair. Keep this callback stable so the next click becomes a new
      // WayPoint instead of re-entering the old point's direction phase.
      if (mode === 'waypoint') {
        return;
      }
      this._stopQuickMapCapture();
    };
    RosManager._enterWaypointSelectMode(capturePoint, selectionOptions);

    const label = mode === 'trajectory'
      ? '각 경유점마다 첫 클릭은 위치, 두 번째 클릭은 진행 방향입니다. 최종 점 방향이 Action의 최종 θ로 전송됩니다.'
      : mode === 'docking'
        ? '첫 클릭으로 도킹 시작 위치, 두 번째 클릭으로 진입 방향을 지정하면 Argument/Parameter 질문이 시작됩니다.'
        : '첫 클릭으로 WayPoint 위치, 두 번째 클릭으로 도착 방향을 지정하세요.';
    this._setQuickTaskStatus(label);
  },

  startQuickFreehandCapture() {
    if (typeof RosManager === 'undefined' || !RosManager.lastMapMsg) {
      this._setQuickTaskStatus('현재 표시할 맵 데이터가 없습니다.', true);
      return;
    }
    if (this._quickTaskMode === 'trajectory' && this._quickTrajectoryDraft.length > 0) {
      if (!this.finishQuickTrajectory()) return;
    } else {
      this._stopQuickMapCapture();
    }

    this._quickTaskMode = 'freehand';
    this._quickFreehandDraft = [];
    this._updateQuickTaskToolState();
    RosManager._enterFreehandPathMode({
      onUpdate: points => {
        if (!this._isQuickTaskBuilderOpen() || this._quickTaskMode !== 'freehand') return;
        this._quickFreehandDraft = this._prepareFreehandTrajectory(points, true)?.points || [];
        this._syncQuickTaskOverlay();
        this._setQuickTaskStatus(
          `곡선 입력 중 · 원본 ${points.length}점 / 경로 ${this._quickFreehandDraft.length}점`
        );
      },
      onComplete: points => {
        if (!this._isQuickTaskBuilderOpen() || this._quickTaskMode !== 'freehand') return;
        const trajectory = this._prepareFreehandTrajectory(points, false);
        this._quickFreehandDraft = [];
        if (!trajectory || trajectory.length < 0.25 || trajectory.points.length < 2) {
          this._setQuickTaskStatus('경로가 너무 짧습니다. 맵에서 0.25 m 이상 곡선을 그려주세요.', true);
          this._syncQuickTaskOverlay();
          return;
        }
        this._quickTaskItems.push({
          kind: 'trajectory',
          points: trajectory.points,
          trajectory: this._readQuickTrajectoryOptions(),
          source: 'freehand',
          sourcePointCount: points.length,
          pathLength: trajectory.length
        });
        this._quickTaskSequence += 1;
        this.renderQuickTask();
        this._stopQuickMapCapture();
        this._openQuickTerminalActionChooser(
          `곡선 Trajectory ${trajectory.points.length}개 경유점 · ${trajectory.length.toFixed(2)} m`
        );
      }
    });
    this._setQuickTaskStatus('맵에서 마우스 왼쪽 버튼을 누른 채 곡선을 그리고, 끝점에서 놓으세요.');
  },

  _polylineLength(points = []) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.hypot(
        Number(points[index].x) - Number(points[index - 1].x),
        Number(points[index].y) - Number(points[index - 1].y)
      );
    }
    return total;
  },

  _distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const ratio = Math.max(0, Math.min(1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)
    ));
    return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
  },

  _simplifyFreehandPoints(points, tolerance) {
    if (points.length <= 2) return points.map(point => ({ ...point }));
    let farthestDistance = 0;
    let farthestIndex = -1;
    for (let index = 1; index < points.length - 1; index += 1) {
      const distance = this._distanceToSegment(points[index], points[0], points.at(-1));
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestDistance <= tolerance || farthestIndex < 0) {
      return [{ ...points[0] }, { ...points.at(-1) }];
    }
    const left = this._simplifyFreehandPoints(points.slice(0, farthestIndex + 1), tolerance);
    const right = this._simplifyFreehandPoints(points.slice(farthestIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  },

  _resampleFreehandPoints(points, spacing, maxPoints) {
    const length = this._polylineLength(points);
    if (points.length < 2 || length <= 0) return points.map(point => ({ ...point }));
    const targetCount = Math.max(2, Math.min(
      maxPoints,
      Math.ceil(length / Math.max(0.01, spacing)) + 1
    ));
    const interval = length / (targetCount - 1);
    const result = [{ ...points[0] }];
    let segmentIndex = 1;
    let traversed = 0;
    let segmentLength = Math.hypot(
      points[1].x - points[0].x,
      points[1].y - points[0].y
    );
    for (let targetIndex = 1; targetIndex < targetCount - 1; targetIndex += 1) {
      const targetDistance = targetIndex * interval;
      while (segmentIndex < points.length - 1
          && traversed + segmentLength < targetDistance) {
        traversed += segmentLength;
        segmentIndex += 1;
        segmentLength = Math.hypot(
          points[segmentIndex].x - points[segmentIndex - 1].x,
          points[segmentIndex].y - points[segmentIndex - 1].y
        );
      }
      const start = points[segmentIndex - 1];
      const end = points[segmentIndex];
      const ratio = segmentLength > 0
        ? Math.max(0, Math.min(1, (targetDistance - traversed) / segmentLength))
        : 0;
      result.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio
      });
    }
    result.push({ ...points.at(-1) });
    return result;
  },

  _prepareFreehandTrajectory(rawPoints = [], preview = false) {
    const cleaned = [];
    rawPoints.forEach(point => {
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const previous = cleaned.at(-1);
      if (!previous || Math.hypot(x - previous.x, y - previous.y) >= 0.01) {
        cleaned.push({ x, y });
      }
    });
    if (cleaned.length < 2) return null;
    const stride = Math.max(1, Math.ceil(cleaned.length / 600));
    const bounded = stride === 1
      ? cleaned
      : cleaned.filter((point, index) => index % stride === 0 || index === cleaned.length - 1);

    const configuredSpacing = Number(document.getElementById('quick-freehand-spacing')?.value);
    const spacing = preview
      ? Math.max(0.08, Math.min(0.2, (configuredSpacing || 0.25) / 2))
      : Math.max(0.1, Math.min(1, configuredSpacing || 0.25));
    const tolerance = preview ? 0.03 : Math.min(0.08, spacing * 0.25);
    const simplified = this._simplifyFreehandPoints(bounded, tolerance);
    const sampled = this._resampleFreehandPoints(simplified, spacing, preview ? 160 : 120);
    const points = sampled.map((point, index) => {
      const next = sampled[index + 1] || point;
      const previous = sampled[index - 1] || point;
      const from = index < sampled.length - 1 ? point : previous;
      const to = index < sampled.length - 1 ? next : point;
      return {
        x: Number(point.x.toFixed(3)),
        y: Number(point.y.toFixed(3)),
        theta: Number(Math.atan2(to.y - from.y, to.x - from.x).toFixed(3))
      };
    });
    return { points, length: this._polylineLength(cleaned) };
  },

  _stopQuickMapCapture() {
    this._quickTaskMode = '';
    this._quickFreehandDraft = [];
    if (typeof RosManager !== 'undefined') {
      RosManager._exitWaypointSelectMode();
      RosManager._exitFreehandPathMode?.();
    }
    this._updateQuickTaskToolState();
  },

  _isQuickTaskBuilderOpen() {
    const view = document.getElementById('quick-task-builder-view');
    const taskTab = document.getElementById('tab-action');
    return this._builderMode === 'quick'
      && Boolean(view && !view.hidden)
      && Boolean(taskTab?.classList?.contains('active'));
  },

  _isTaskBuilderOpen() {
    const view = document.getElementById('task-builder-view');
    const taskTab = document.getElementById('tab-action');
    return this._builderMode !== 'list'
      && this._builderMode !== 'quick'
      && Boolean(view && !view.hidden)
      && Boolean(taskTab?.classList?.contains('active'));
  },

  _cancelSelectedActionEdit() {
    if (this._editingActionIndex < 0) return false;
    this._editingActionIndex = -1;
    this._editingActionBaselineSignature = '';
    this.renderQueue();
    this._showEditorTaskPreview(null);
    this._syncActionEditButtons();
    App.toast('Action 수정을 취소하고 Task 수정 화면으로 돌아왔습니다.', 'info');
    return true;
  },

  _handleBuilderEscape(event = {}) {
    if (event.key !== 'Escape') return false;

    // The first Escape belongs to the currently open child flow. A second
    // Escape then leaves its parent editor, which keeps navigation predictable.
    if (this._quickTerminalActionContext || this._quickDockWizard
        || document.querySelector?.('.modal.show, .modal.active')) {
      return false;
    }
    if (this._isQuickTaskBuilderOpen()) {
      if (this._quickTaskMode) return false;
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      this.closeQuickTaskBuilder();
      return true;
    }
    if (!this._isTaskBuilderOpen()) return false;

    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    if (this._cancelSelectedActionEdit()) return true;
    this.closeTaskBuilder();
    return true;
  },

  _handleQuickTaskShortcut(event = {}) {
    if (!this._isQuickTaskBuilderOpen()) return false;
    // When Jog is open, overlapping movement/IO keys belong to Jog first.
    // Returning without consuming lets JogControl's capture listener handle them.
    if (typeof JogControl !== 'undefined' && JogControl._ownsKeyboardEvent?.(event)) {
      return false;
    }

    const key = String(event.key || '');
    const normalized = key.toLowerCase();
    const target = event.target || document.activeElement;
    const tag = String(target?.tagName || '').toUpperCase();
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      || Boolean(target?.isContentEditable);
    const saveAndRun = key === 'Enter' && (event.ctrlKey || event.metaKey);
    const saveTask = normalized === 's' && (event.ctrlKey || event.metaKey);

    // The terminal chooser reuses the same D/O/S Action keys and adds N/0 for none.
    if (this._quickTerminalActionContext) {
      return this._handleQuickTerminalShortcut(event, normalized);
    }
    // Field editing and the sequential docking wizard own their keyboard input.
    if ((isTyping && !saveAndRun && !saveTask) || this._quickDockWizard) {
      return false;
    }
    if ((event.ctrlKey || event.metaKey || event.altKey) && !saveAndRun && !saveTask) {
      return false;
    }

    const buttonByKey = {
      w: 'btn-quick-waypoint',
      t: 'btn-quick-trajectory',
      g: 'btn-quick-freehand',
      d: 'btn-quick-docking',
      o: 'btn-quick-docking-out',
      s: 'btn-quick-standby',
      f: 'btn-quick-trajectory-finish',
      i: 'btn-quick-task-info',
      e: 'btn-quick-task-edit'
    };
    const shiftedButtonByKey = {
      d: 'btn-quick-docking-inline',
      o: 'btn-quick-docking-out-map'
    };
    const shortcutButtonId = event.shiftKey && shiftedButtonByKey[normalized]
      ? shiftedButtonByKey[normalized]
      : buttonByKey[normalized];
    const shortcutKey = saveAndRun || saveTask || Boolean(shortcutButtonId)
      || key === 'Backspace' || (key === 'Escape' && this._quickTaskMode);
    if (event.repeat && shortcutKey) {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      return true;
    }
    let handled = false;
    if (saveAndRun) {
      document.getElementById('btn-run-quick-task')?.click();
      handled = true;
    } else if (saveTask) {
      document.getElementById('btn-save-quick-task')?.click();
      handled = true;
    } else if (shortcutButtonId) {
      document.getElementById(shortcutButtonId)?.click();
      handled = true;
    } else if (key === 'Backspace') {
      this.undoQuickTaskItem();
      handled = true;
    } else if (key === 'Escape' && this._quickTaskMode) {
      this._stopQuickMapCapture();
      this._setQuickTaskStatus('맵 입력을 중지했습니다. W/T/G/D로 다시 시작할 수 있습니다.');
      handled = true;
    }
    if (!handled) return false;

    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    return true;
  },

  _handleQuickTerminalShortcut(event = {}, normalizedKey = '') {
    if (!this._quickTerminalActionContext) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const actionByKey = {
      d: 'docking',
      o: 'docking-out',
      s: 'standby',
      n: 'none',
      0: 'none'
    };
    const action = event.key === 'Escape' ? 'none' : actionByKey[normalizedKey];
    if (!action) return false;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    if (!event.repeat) this._selectQuickTerminalAction(action);
    return true;
  },

  _updateQuickTaskToolState() {
    const modes = {
      waypoint: 'btn-quick-waypoint',
      trajectory: 'btn-quick-trajectory',
      freehand: 'btn-quick-freehand',
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
    const freehandButton = document.getElementById('btn-quick-freehand');
    if (freehandButton) {
      freehandButton.textContent = this._quickTaskMode === 'freehand'
        ? '✍ 곡선 경로 입력 중'
        : '✍ 곡선 경로 그리기';
    }
    const finishButton = document.getElementById('btn-quick-trajectory-finish');
    if (finishButton) {
      const waypointReady = this._quickTaskMode === 'waypoint'
        && this._quickTaskItems.length > this._quickDriveCaptureStartIndex;
      const trajectoryReady = this._quickTaskMode === 'trajectory'
        && this._quickTrajectoryDraft.length >= 2;
      finishButton.disabled = !waypointReady && !trajectoryReady;
      finishButton.textContent = this._quickTaskMode === 'waypoint'
        ? '✓ WayPoint 입력 완료'
        : this._quickTaskMode === 'trajectory'
          ? '✓ Trajectory 입력 완료'
          : '✓ 주행 입력 완료';
    }
  },

  finishQuickDrivingInput() {
    if (this._quickTaskMode === 'trajectory') {
      return this.finishQuickTrajectory({ offerTerminalAction: true });
    }
    if (this._quickTaskMode === 'waypoint') {
      const pointCount = this._quickTaskItems.length - this._quickDriveCaptureStartIndex;
      if (pointCount < 1) {
        this._setQuickTaskStatus('WayPoint를 하나 이상 입력하세요.', true);
        return false;
      }
      this._stopQuickMapCapture();
      this._openQuickTerminalActionChooser(`WayPoint ${pointCount}개`);
      return true;
    }
    this._setQuickTaskStatus('먼저 WayPoint 또는 Trajectory 경로를 입력하세요.', true);
    return false;
  },

  finishQuickTrajectory(options = {}) {
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
    if (options.offerTerminalAction) {
      this._openQuickTerminalActionChooser(`Trajectory ${pointCount}개 경유점`);
    }
    return true;
  },

  _openQuickTerminalActionChooser(contextLabel = '주행 경로') {
    this._quickTerminalActionContext = { label: contextLabel };
    const context = document.getElementById('quick-terminal-action-context');
    if (context) {
      context.textContent = `${contextLabel} 입력이 완료되었습니다. 마지막에 실행할 동작을 선택하세요.`;
    }
    document.getElementById('quick-terminal-action-modal')?.classList.add('show');
    this._setQuickTaskStatus(`${contextLabel} 입력 완료 · 마지막 동작을 선택하세요.`);
    document.getElementById('btn-quick-terminal-none')?.focus?.();
  },

  _closeQuickTerminalActionChooser() {
    document.getElementById('quick-terminal-action-modal')?.classList.remove('show');
    this._quickTerminalActionContext = null;
  },

  _selectQuickTerminalAction(action) {
    if (!this._quickTerminalActionContext) return false;
    const contextLabel = this._quickTerminalActionContext.label;
    this._closeQuickTerminalActionChooser();
    if (action === 'docking') {
      return this.addQuickDocking(contextLabel);
    }
    if (action === 'docking-out') {
      this.addQuickDockingOut();
      return true;
    }
    if (action === 'standby') {
      this.addQuickStandby();
      return true;
    }
    this._setQuickTaskStatus(`${contextLabel}까지만 구성했습니다. 마지막 추가 액션은 없습니다.`);
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

  _quickDockRecommendation(field, pose) {
    const recommendations = {
      is_charge: '반복 주행 시험이면 0, 실제 충전 도킹이면 1을 권장합니다.',
      direction: '일반 전면 도킹은 1(전방)을 권장합니다.',
      scan_type: 'L 마커는 1, LV는 2, Rack cfg 기반이면 4를 권장합니다.',
      end_condition: '기본 위치 도달 판정은 1, 충전 접점 확인은 3을 권장합니다.',
      dock_dist: '일반적인 도킹 시작 거리는 1.2 m를 권장합니다.',
      dock_dist_flag: '로봇 외곽 기준을 사용하는 false가 기본 권장값입니다.',
      scan_view: '전방 스캐너는 0, 좌/후/우는 각각 1/2/3입니다.',
      x_offset: '별도 보정값이 없다면 0.0 m를 권장합니다.',
      y_offset: '별도 보정값이 없다면 0.0 m를 권장합니다.',
      center_offset: '기본 0°, 방향 자동 탐색이 필요하면 360을 사용합니다.',
      v_angle: '일반 LV 마커는 90°를 권장합니다.',
      mark_size: '실제 마커 실측값을 입력하며 기본 추천은 0.1 m입니다.',
      marker_type: '중앙 마커는 1, 우측 마커는 2입니다.',
      target_id: 'Aruco를 사용할 때 실제 ID를 입력하세요. 미사용 시 빈 값입니다.',
      target_size: 'Aruco 실측 크기를 입력하며 기본 추천은 0.1 m입니다.',
      cradle_width: 'Cradle/Rack 실측 폭을 입력하세요. 미사용 시 0.0 m입니다.',
      cradle_depth: 'Cradle/Rack 실측 깊이를 입력하세요. 미사용 시 0.0 m입니다.',
      model_type: 'DD는 0, QD는 1을 권장합니다.',
      target_cfg: 'Rack/특수 도킹에서만 cfg 파일명을 입력하고 일반 도킹은 비웁니다.'
    };
    if (field.name === 'approach_theta') {
      if (!pose) {
        return '맵 시작점을 추가하지 않는 Docking 전용 Action입니다. 현장 도킹 기준값을 사용하세요.';
      }
      return `맵에서 지정한 추천 방향: ${(Number(pose?.theta || 0) * 180 / Math.PI).toFixed(1)}°`;
    }
    return recommendations[field.name] || field.desc || '현장 조건에 맞는 값을 입력하세요.';
  },

  _quickDockWizardFields(pose) {
    const config = this.actionTypes['0x08'];
    return [
      ...config.args.map((field, index) => ({
        ...field,
        section: 'Argument',
        valueKey: `arg:${field.name}`,
        index
      })),
      ...config.params.map((field, index) => ({
        ...field,
        section: 'Parameter',
        valueKey: `param:${field.name}`,
        index
      }))
    ].map(field => ({
      ...field,
      recommendation: this._quickDockRecommendation(field, pose)
    }));
  },

  _startQuickDockWizard(pose = null) {
    const preset = this._readQuickDockingOptions();
    const fields = this._quickDockWizardFields(pose);
    const values = {};
    fields.forEach(field => {
      values[field.valueKey] = field.default ?? '';
    });
    values['arg:is_charge'] = preset.isCharge;
    values['arg:direction'] = preset.direction;
    values['arg:scan_type'] = preset.scanType;
    values['arg:end_condition'] = preset.endCondition;
    this._quickDockWizard = {
      pose: pose ? { ...pose } : null,
      fields,
      values,
      index: 0
    };
    document.getElementById('quick-dock-wizard')?.classList.add('show');
    this._renderQuickDockWizard();
  },

  _renderQuickDockWizard() {
    const wizard = this._quickDockWizard;
    if (!wizard) return;
    const field = wizard.fields[wizard.index];
    if (!field) {
      this._completeQuickDockWizard();
      return;
    }
    const label = document.getElementById('quick-dock-wizard-label');
    const key = document.getElementById('quick-dock-wizard-key');
    const progress = document.getElementById('quick-dock-wizard-progress');
    const description = document.getElementById('quick-dock-wizard-description');
    const recommendation = document.getElementById('quick-dock-wizard-recommendation');
    const control = document.getElementById('quick-dock-wizard-control');
    const back = document.getElementById('btn-quick-dock-back');
    const next = document.getElementById('btn-quick-dock-next');
    if (label) label.textContent = this._fieldLabel(field);
    if (key) key.textContent = `${field.section} · ${field.name} · ${field.type || 'number'}`;
    if (progress) {
      progress.textContent = wizard.pose
        ? `${field.section} ${wizard.index + 1}/${wizard.fields.length} · 도킹 시작 θ=${(wizard.pose.theta * 180 / Math.PI).toFixed(1)}°`
        : `${field.section} ${wizard.index + 1}/${wizard.fields.length} · 현재 Task 맨 뒤에 Docking만 추가`;
    }
    if (description) description.textContent = field.desc || '';
    if (recommendation) {
      recommendation.textContent = `추천값: ${field.default ?? '(빈 값)'} · ${field.recommendation}`;
    }
    if (back) back.disabled = wizard.index === 0;
    if (next) next.textContent = wizard.index === wizard.fields.length - 1 ? '도킹 추가' : '다음';
    if (!control) return;
    control.innerHTML = '';

    let input;
    if (Array.isArray(field.enumValues) && field.enumValues.length > 0) {
      input = document.createElement('select');
      field.enumValues.forEach(optionInfo => {
        const option = document.createElement('option');
        option.value = String(optionInfo.value);
        option.textContent = `${optionInfo.value} · ${optionInfo.label}`;
        input.appendChild(option);
      });
    } else if (field.type === 'bool') {
      input = document.createElement('select');
      ['false', 'true'].forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        input.appendChild(option);
      });
    } else {
      input = document.createElement('input');
      input.type = field.type === 'string' ? 'text' : 'number';
      if (input.type === 'number') input.step = field.type === 'int' ? '1' : '0.01';
      input.placeholder = String(field.default ?? '');
    }
    input.id = 'quick-dock-wizard-input';
    input.value = String(wizard.values[field.valueKey] ?? field.default ?? '');
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') this._advanceQuickDockWizard();
    });
    control.appendChild(input);
    setTimeout(() => input.focus(), 0);
  },

  _saveQuickDockWizardValue() {
    const wizard = this._quickDockWizard;
    if (!wizard) return false;
    const field = wizard.fields[wizard.index];
    const input = document.getElementById('quick-dock-wizard-input');
    if (!field || !input) return false;
    const raw = input.value;
    const numeric = field.section === 'Argument' || field.type === 'float' || field.type === 'int';
    if (numeric && raw !== '' && !Number.isFinite(Number(raw))) {
      App.toast(`${this._fieldLabel(field)} 값을 숫자로 입력하세요.`, 'error');
      input.focus();
      return false;
    }
    wizard.values[field.valueKey] = numeric && raw !== '' ? Number(raw) : raw;
    return true;
  },

  _advanceQuickDockWizard() {
    const wizard = this._quickDockWizard;
    if (!wizard || !this._saveQuickDockWizardValue()) return;
    if (wizard.index >= wizard.fields.length - 1) {
      this._completeQuickDockWizard();
      return;
    }
    wizard.index += 1;
    this._renderQuickDockWizard();
  },

  _backQuickDockWizard() {
    const wizard = this._quickDockWizard;
    if (!wizard) return;
    if (!this._saveQuickDockWizardValue()) return;
    wizard.index = Math.max(0, wizard.index - 1);
    this._renderQuickDockWizard();
  },

  _finishQuickDockWizardWithRecommendations() {
    const wizard = this._quickDockWizard;
    if (!wizard || !this._saveQuickDockWizardValue()) return;
    for (let index = wizard.index + 1; index < wizard.fields.length; index += 1) {
      const field = wizard.fields[index];
      wizard.values[field.valueKey] = field.default ?? '';
    }
    this._completeQuickDockWizard();
  },

  _completeQuickDockWizard() {
    const wizard = this._quickDockWizard;
    if (!wizard) return;
    const args = this.actionTypes['0x08'].args.map(field =>
      Number(wizard.values[`arg:${field.name}`] ?? field.default ?? 0)
    );
    const params = {};
    this.actionTypes['0x08'].params.forEach(field => {
      params[field.name] = String(wizard.values[`param:${field.name}`] ?? field.default ?? '');
    });
    const item = {
      kind: 'docking',
      docking: {
        args,
        params,
        isCharge: args[0],
        direction: args[1],
        scanType: args[2],
        endCondition: args[3]
      }
    };
    if (wizard.pose) item.pose = { ...wizard.pose };
    this._quickTaskItems.push(item);
    this._quickTaskSequence += 1;
    document.getElementById('quick-dock-wizard')?.classList.remove('show');
    this._closeQuickTerminalActionChooser();
    this._quickDockWizard = null;
    this._setQuickTaskStatus(wizard.pose
      ? `맵 지정 도킹 추가 완료 · 시작 (${wizard.pose.x.toFixed(2)}, ${wizard.pose.y.toFixed(2)}) · θ ${(wizard.pose.theta * 180 / Math.PI).toFixed(1)}°`
      : 'Docking Action만 현재 Task 맨 뒤에 추가했습니다.');
    this.renderQuickTask();
  },

  _cancelQuickDockWizard() {
    document.getElementById('quick-dock-wizard')?.classList.remove('show');
    this._quickDockWizard = null;
    this._setQuickTaskStatus('도킹 설정을 취소했습니다.');
  },

  addQuickStandby() {
    if (this._quickTaskMode === 'trajectory' && this._quickTrajectoryDraft.length > 0) {
      if (!this.finishQuickTrajectory()) return;
    } else if (this._quickTaskMode) {
      this._stopQuickMapCapture();
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

  addQuickDocking(contextLabel = '') {
    if (this._quickTaskMode === 'trajectory' && this._quickTrajectoryDraft.length > 0) {
      if (!this.finishQuickTrajectory()) return false;
    } else if (this._quickTaskMode) {
      this._stopQuickMapCapture();
    }
    this._startQuickDockWizard(null);
    this._setQuickTaskStatus(
      `${contextLabel ? `${contextLabel} 다음 ` : ''}Docking만 Task 맨 뒤에 추가합니다.`
    );
    return true;
  },

  _readQuickDockingOutDistance() {
    const distance = Number(document.getElementById('quick-docking-out-distance')?.value);
    if (!Number.isFinite(distance)) {
      this._setQuickTaskStatus('DockingOut 이동 거리를 확인해주세요.', true);
      return null;
    }
    return distance;
  },

  addQuickDockingOut() {
    if (this._quickTaskMode === 'trajectory' && this._quickTrajectoryDraft.length > 0) {
      if (!this.finishQuickTrajectory()) return;
    } else if (this._quickTaskMode) {
      this._stopQuickMapCapture();
    }
    const distance = this._readQuickDockingOutDistance();
    if (distance === null) return false;
    this._quickTaskItems.push({ kind: 'docking-out', distance });
    this._quickTaskSequence += 1;
    this._setQuickTaskStatus(`DockingOut Action만 Task 맨 뒤에 추가: ${distance} m`);
    this.renderQuickTask();
    return true;
  },

  startQuickDockingOutMapCapture() {
    if (this._readQuickDockingOutDistance() === null) return false;
    this._setQuickTaskStatus('DockingOut 시작 위치와 방향을 맵에서 지정하세요.');
    this.startQuickMapCapture('docking-out');
    return this._quickTaskMode === 'docking-out';
  },

  undoQuickTaskItem() {
    this._quickTaskSelectedAction = null;
    if (this._quickFreehandDraft.length > 0) {
      this._stopQuickMapCapture();
      this._setQuickTaskStatus('입력 중인 곡선 경로를 취소했습니다.');
    } else if (this._quickTrajectoryDraft.length > 0) {
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
    if ((this._quickTaskItems.length > 0
        || this._quickTrajectoryDraft.length > 0
        || this._quickFreehandDraft.length > 0)
        && typeof confirm === 'function'
        && !confirm('Quick Task 항목을 모두 비우시겠습니까?')) {
      return;
    }
    document.getElementById('quick-dock-wizard')?.classList.remove('show');
    this._closeQuickTerminalActionChooser();
    this._quickDockWizard = null;
    this._quickTaskItems = [];
    this._quickTrajectoryDraft = [];
    this._quickFreehandDraft = [];
    this._quickTaskDeleteUndoStack = [];
    this._quickTaskSelectedAction = null;
    this._stopQuickMapCapture();
    this._setQuickTaskStatus('모든 항목을 비웠습니다.');
    this.renderQuickTask();
  },

  moveQuickTaskItem(index, direction) {
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this._quickTaskItems.length) return;
    const [item] = this._quickTaskItems.splice(index, 1);
    this._quickTaskItems.splice(target, 0, item);
    this._quickTaskSelectedAction = null;
    this.renderQuickTask();
  },

  removeQuickTaskItem(index) {
    if (index < 0 || index >= this._quickTaskItems.length) return;
    const [item] = this._quickTaskItems.splice(index, 1);
    this._quickTaskDeleteUndoStack.push({
      isDraft: false,
      index,
      item: JSON.parse(JSON.stringify(item))
    });
    if (this._quickTaskDeleteUndoStack.length > 30) this._quickTaskDeleteUndoStack.shift();
    this._quickTaskSelectedAction = null;
    this._setQuickTaskStatus('구성 항목 삭제 · "삭제 취소"로 복원할 수 있습니다.');
    this.renderQuickTask();
  },

  renderQuickTask() {
    const list = document.getElementById('quick-task-sequence');
    const count = document.getElementById('quick-task-count');
    const undoButton = document.getElementById('btn-quick-task-undo');
    if (count) count.textContent = String(this._quickTaskItems.length);
    if (undoButton) {
      undoButton.disabled = this._quickTaskItems.length === 0
        && this._quickTrajectoryDraft.length === 0
        && this._quickFreehandDraft.length === 0;
    }
    this._updateQuickTaskToolState();
    this._syncQuickTaskOverlay();
    this._renderQuickActionPreview();
    if (!list) return;
    list.innerHTML = '';
    if (this._quickTaskItems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'quick-task-empty';
      empty.textContent = this._quickFreehandDraft.length > 0
        ? `곡선 경로 ${this._quickFreehandDraft.length}개 점 입력 중`
        : this._quickTrajectoryDraft.length > 0
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
          title: item.source === 'freehand' ? '곡선 TrajectoryFollowing' : 'TrajectoryFollowing',
          detail: `0x15 · ${item.points.length} points · ${item.trajectory.laneName}`
        },
        standby: {
          icon: '⏸',
          title: 'Standby',
          detail: `0x07 · ${item.duration} sec`
        },
        docking: {
          icon: '🔌',
          title: item.pose ? '맵 지정 + Docking' : 'Docking만 추가',
          detail: item.pose
            ? `0x01 → 0x08 · x=${item.pose.x}, y=${item.pose.y}, θ=${item.pose.theta} · args=[${(item.docking?.args || []).join(', ')}]`
            : `0x08 · args=[${(item.docking?.args || []).join(', ')}]`
        },
        'docking-out': {
          icon: '↩',
          title: item.pose ? '맵 지정 + DockingOut' : 'DockingOut만 추가',
          detail: item.pose
            ? `0x01 → 0x10 · x=${item.pose.x}, y=${item.pose.y}, θ=${item.pose.theta} · distance=${item.distance} m`
            : `0x10 · distance=${item.distance} m`
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

  _quickTaskPreviewEntries() {
    const items = [...this._quickTaskItems];
    const metadata = items.map((item, sourceItemIndex) => ({
      item,
      sourceItemIndex,
      isDraft: false
    }));
    if (this._quickTrajectoryDraft.length > 0) {
      const draft = {
        kind: 'trajectory',
        points: JSON.parse(JSON.stringify(this._quickTrajectoryDraft)),
        trajectory: this._readQuickTrajectoryOptions()
      };
      items.push(draft);
      metadata.push({
        item: draft,
        sourceItemIndex: this._quickTaskItems.length,
        isDraft: true
      });
    }
    const actions = this.compileQuickTaskItems(items);
    const entries = [];
    let actionIndex = 0;
    metadata.forEach(meta => {
      const actionCount = (
        meta.item.kind === 'docking' || meta.item.kind === 'docking-out'
      ) && meta.item.pose ? 2 : 1;
      for (let actionOffset = 0; actionOffset < actionCount; actionOffset += 1) {
        const action = actions[actionIndex];
        if (!action) break;
        entries.push({
          ...meta,
          action,
          actionIndex,
          actionOffset,
          key: `${meta.isDraft ? 'draft' : 'item'}:${meta.sourceItemIndex}:${actionOffset}`
        });
        actionIndex += 1;
      }
    });
    return entries;
  },

  _renderQuickActionPreview() {
    const list = document.getElementById('quick-task-action-preview');
    const count = document.getElementById('quick-task-action-count');
    const undoButton = document.getElementById('btn-quick-action-undo-delete');
    if (!list) return;
    const entries = this._quickTaskPreviewEntries();
    if (count) count.textContent = String(entries.length);
    if (undoButton) undoButton.disabled = this._quickTaskDeleteUndoStack.length === 0;
    list.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'quick-action-preview-empty';
      empty.textContent = '추가된 Action 없음';
      list.appendChild(empty);
      this._quickTaskSelectedAction = null;
      this._syncQuickTaskOverlay();
      this._updateQuickTaskMapActionSelection();
      return;
    }
    if (this._quickTaskSelectedAction
        && !entries.some(entry => entry.key === this._quickTaskSelectedAction.key)) {
      this._quickTaskSelectedAction = null;
    }
    entries.forEach((entry, index) => {
      const { action } = entry;
      const typeKey = this._actionTypeKey(action);
      const config = this.actionTypes[typeKey];
      const chip = document.createElement('div');
      chip.className = 'quick-action-preview-chip';
      if (entry.key === this._quickTaskSelectedAction?.key) chip.classList.add('selected');
      chip.title = '클릭하면 맵에서 이 Action을 강조합니다.';
      const number = document.createElement('span');
      number.className = 'quick-action-preview-number';
      number.textContent = String(index + 1);
      const type = document.createElement('strong');
      type.textContent = typeKey;
      const name = document.createElement('span');
      name.textContent = action.name;
      const args = document.createElement('small');
      const compactArgs = Array.from(action.args || []).map(value =>
        typeof value === 'number' ? Number(value.toFixed?.(3) ?? value) : value
      );
      args.textContent = `${config?.name || 'Action'} · [${compactArgs.join(', ')}]`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'quick-action-preview-remove';
      remove.textContent = '×';
      remove.title = entry.item.pose && (
        entry.item.kind === 'docking' || entry.item.kind === 'docking-out'
      )
        ? '시작 WayPoint와 마지막 Action 묶음 전체 삭제'
        : '이 Action 삭제';
      chip.appendChild(number);
      chip.appendChild(type);
      chip.appendChild(name);
      chip.appendChild(args);
      chip.appendChild(remove);
      chip.addEventListener('click', () => this._selectQuickActionPreview(entry));
      remove.addEventListener('click', event => {
        event.stopPropagation();
        this.deleteQuickActionPreviewEntry(entry);
      });
      list.appendChild(chip);
    });
    this._updateQuickTaskMapActionSelection();
  },

  _selectQuickActionPreview(entry) {
    this._quickTaskSelectedAction = this._quickTaskSelectedAction?.key === entry.key
      ? null
      : {
        key: entry.key,
        sourceItemIndex: entry.sourceItemIndex,
        actionOffset: entry.actionOffset,
        isDraft: entry.isDraft
      };
    this._renderQuickActionPreview();
    this._syncQuickTaskOverlay();
  },

  deleteQuickActionPreviewEntry(entry) {
    if (!entry) return;
    let deleted;
    if (entry.isDraft) {
      deleted = {
        isDraft: true,
        index: this._quickTaskItems.length,
        item: JSON.parse(JSON.stringify(this._quickTrajectoryDraft))
      };
      this._quickTrajectoryDraft = [];
    } else {
      const [item] = this._quickTaskItems.splice(entry.sourceItemIndex, 1);
      if (!item) return;
      deleted = {
        isDraft: false,
        index: entry.sourceItemIndex,
        item: JSON.parse(JSON.stringify(item))
      };
    }
    this._quickTaskDeleteUndoStack.push(deleted);
    if (this._quickTaskDeleteUndoStack.length > 30) this._quickTaskDeleteUndoStack.shift();
    this._quickTaskSelectedAction = null;
    const label = entry.item.pose && (
      entry.item.kind === 'docking' || entry.item.kind === 'docking-out'
    )
      ? '시작 WayPoint + 마지막 Action 묶음'
      : entry.action.name;
    this._setQuickTaskStatus(`${label} 삭제 · "삭제 취소"로 복원할 수 있습니다.`);
    this.renderQuickTask();
  },

  undoQuickActionDelete() {
    const deleted = this._quickTaskDeleteUndoStack.pop();
    if (!deleted) return;
    if (deleted.isDraft) {
      this._quickTrajectoryDraft = JSON.parse(JSON.stringify(deleted.item));
    } else {
      const index = Math.max(0, Math.min(deleted.index, this._quickTaskItems.length));
      this._quickTaskItems.splice(index, 0, JSON.parse(JSON.stringify(deleted.item)));
    }
    this._quickTaskSelectedAction = null;
    this._setQuickTaskStatus('삭제한 Action을 복원했습니다.');
    this.renderQuickTask();
  },

  _updateQuickTaskMapActionSelection() {
    const panel = document.getElementById('quick-task-map-action-selection');
    if (!panel) return;
    const selected = this._quickTaskSelectedAction;
    const entry = selected
      ? this._quickTaskPreviewEntries().find(candidate => candidate.key === selected.key)
      : null;
    if (!entry) {
      panel.hidden = true;
      return;
    }
    const title = document.getElementById('quick-task-map-action-title');
    const detail = document.getElementById('quick-task-map-action-detail');
    const typeKey = this._actionTypeKey(entry.action);
    if (title) title.textContent = `${typeKey} · ${entry.action.name}`;
    let positionText = '맵 좌표 없음';
    if (entry.item.pose) {
      positionText = `x=${entry.item.pose.x}, y=${entry.item.pose.y}, θ=${entry.item.pose.theta}`;
    } else if (Array.isArray(entry.item.points) && entry.item.points.length > 0) {
      const start = entry.item.points[0];
      const end = entry.item.points.at(-1);
      positionText = `${entry.item.points.length} points · (${start.x}, ${start.y}) → (${end.x}, ${end.y})`;
    }
    if (detail) {
      detail.textContent = `${positionText} · args=[${Array.from(entry.action.args || []).join(', ')}]`;
    }
    panel.hidden = false;
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
    const selected = this._quickTaskSelectedAction;
    this._quickTaskItems.forEach((item, itemIndex) => {
      if ((item.kind === 'waypoint' || item.kind === 'docking'
          || item.kind === 'docking-out') && item.pose) {
        overlay.push({
          ...item.pose,
          kind: item.kind,
          label: String(itemIndex + 1),
          group: `item-${itemIndex}`,
          selected: !selected?.isDraft && selected?.sourceItemIndex === itemIndex
        });
      } else if (item.kind === 'trajectory') {
        item.points.forEach((point, pointIndex) => overlay.push({
          ...point,
          kind: 'trajectory',
          label: `${itemIndex + 1}.${pointIndex + 1}`,
          group: `trajectory-${itemIndex}`,
          selected: !selected?.isDraft && selected?.sourceItemIndex === itemIndex
        }));
      }
    });
    this._quickTrajectoryDraft.forEach((point, pointIndex) => overlay.push({
      ...point,
      kind: 'trajectory-draft',
      label: `T${pointIndex + 1}`,
      group: 'trajectory-draft',
      selected: Boolean(selected?.isDraft)
    }));
    this._quickFreehandDraft.forEach((point, pointIndex) => overlay.push({
      ...point,
      kind: 'trajectory-freehand-draft',
      label: pointIndex === 0
        ? '시작'
        : (pointIndex === this._quickFreehandDraft.length - 1 ? '끝' : ''),
      group: 'trajectory-freehand-draft',
      selected: false
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
    let dockingOutIndex = 0;
    (items || []).forEach(item => {
      if (item.kind === 'waypoint') {
        waypointIndex += 1;
        actions.push(this._buildQuickAction(
          '0x01',
          [item.pose.x, item.pose.y, item.pose.theta],
          `WayPoint_${waypointIndex}`,
          {
            avoid_mode: true,
            straight_path: false
          }
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
        if (item.pose) {
          actions.push(this._buildQuickAction(
            '0x01',
            [item.pose.x, item.pose.y, item.pose.theta],
            `Dock_Start_${dockingIndex}`
          ));
        }
        const dock = item.docking || {};
        const dockArgs = Array.isArray(dock.args)
          ? dock.args
          : [
            dock.isCharge ?? 0,
            dock.direction ?? 1,
            dock.scanType ?? 1,
            dock.endCondition ?? 1
          ];
        actions.push(this._buildQuickAction(
          '0x08',
          dockArgs,
          `Docking_${dockingIndex}`,
          dock.params || {}
        ));
      } else if (item.kind === 'docking-out') {
        dockingOutIndex += 1;
        if (item.pose) {
          actions.push(this._buildQuickAction(
            '0x01',
            [item.pose.x, item.pose.y, item.pose.theta],
            `DockingOut_Start_${dockingOutIndex}`
          ));
        }
        actions.push(this._buildQuickAction(
          '0x10',
          [item.distance],
          `DockingOut_${dockingOutIndex}`
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
    this._editingActionIndex = -1;
    this._editingActionBaselineSignature = '';
    this._builderMode = 'create';
    this.renderQueue();
    this._updateUndoRedoButtons();
    this._quickTaskItems = [];
    this._quickTrajectoryDraft = [];
    this._quickFreehandDraft = [];
    this._quickTaskDeleteUndoStack = [];
    this._quickTaskSelectedAction = null;
    this._syncQuickTaskOverlay();
    this._updateQuickTaskMapActionSelection();
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
    this._quickTaskSelectedAction = null;
    this._syncQuickTaskOverlay();
    this._updateQuickTaskMapActionSelection();
    this._setQuickTaskMapHudVisible(false);
    this._builderMode = taskName ? 'edit' : 'create';
    this._editingTaskName = taskName || '';
    this._editingActionIndex = -1;
    this._editingActionBaselineSignature = '';
    const title = document.getElementById('task-builder-title');
    const entry = taskName ? this.getSavedQueues()[taskName] : null;
    const displayName = entry?.yamlTaskId || taskName;
    if (title) title.textContent = taskName ? `Task 수정 · ${displayName}` : '새 Task 만들기';

    if (taskName) {
      this.loadSavedQueue(taskName, { silent: true });
    } else {
      this.clearTaskPreview();
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
    this._quickFreehandDraft = [];
    this._quickTaskDeleteUndoStack = [];
    this._quickTaskSelectedAction = null;
    this._syncQuickTaskOverlay();
    this._updateQuickTaskMapActionSelection();
    this._setQuickTaskMapHudVisible(false);
    builderView.hidden = true;
    if (quickView) quickView.hidden = true;
    libraryView.hidden = false;
    this._builderMode = 'list';
    this._editingTaskName = '';
    this._editingActionIndex = -1;
    this._editingActionBaselineSignature = '';
    this.refreshSavedQueueList();
    libraryView.scrollIntoView?.({ block: 'start' });
  },

  _updateTaskControlsAvailability() {
    const slot = App.robotSlots?.[this.getTargetSlot()];
    const profile = typeof RobotCompatibility !== 'undefined'
      ? RobotCompatibility.get(slot)
      : slot?.compatibilityProfile;
    const controls = {
      'btn-pause-task': 'pause',
      'btn-resume-task': 'resume',
      'btn-cancel-task': 'cancel'
    };
    Object.entries(controls).forEach(([id, kind]) => {
      const button = document.getElementById(id);
      if (!button || button.classList.contains('loading')) return;
      const operationVerified = Boolean(profile?.task?.verified
        && profile.task[`${kind}Name`] && profile.task[`${kind}Type`]);
      button.disabled = !slot?.connected || !slot.ros || !operationVerified;
      button.title = operationVerified
        ? `${profile.task[`${kind}Name`]} · ${profile.task[`${kind}Type`]}`
        : profile?.task?.operations?.[kind]?.reason || profile?.reason || 'Task graph 미검증';
    });
  },

  _taskActionCatalog(slot = App.robotSlots?.[this.getTargetSlot()]) {
    const profile = typeof RobotCompatibility !== 'undefined'
      ? RobotCompatibility.get(slot)
      : slot?.compatibilityProfile;
    return { profile, catalog: profile?.task?.actionCatalog };
  },

  _actionTypeSupported(actionType, slot = App.robotSlots?.[this.getTargetSlot()]) {
    const { profile, catalog } = this._taskActionCatalog(slot);
    if (!catalog?.attempted) return true;
    if (!catalog.verified || !catalog.types.includes(Number(actionType))) return false;
    const model = profile?.chassis?.driveModel;
    return !(this._requiresDetectedActionModel(actionType)
      && model?.attempted && !model.verified);
  },

  _requiresDetectedActionModel(actionType) {
    return [0x01, 0x08, 0x15].includes(Number(actionType));
  },

  _syncActionCompatibilityUi() {
    const slot = App.robotSlots?.[this.getTargetSlot()];
    const { profile, catalog } = this._taskActionCatalog(slot);
    const status = document.getElementById('action-compatibility-status');
    const model = profile?.chassis?.driveModel;
    if (status) {
      if (!slot?.connected || !slot.ros) {
        status.textContent = '로봇 연결 후 등록 Action과 차상 model_type을 자동 확인합니다.';
        status.className = 'action-compatibility-status';
      } else if (catalog?.verified && model?.attempted && !model.verified) {
        status.textContent = `${slot.robotId} · Action ${catalog.types.length}개 · 차상 model_type 미확인 · 모델 의존 Action 차단`;
        status.className = 'action-compatibility-status blocked';
        status.title = model.reason || '차상 model_type 자동감지 실패';
      } else if (catalog?.verified) {
        const modelLabel = model?.verified
          ? `${String(model.kind).toUpperCase()} · model_type=${model.actionModelType}`
          : '차상 model_type 미확인';
        status.textContent = `${slot.robotId} · Action ${catalog.types.length}개 자동감지 · ${modelLabel}`;
        status.className = 'action-compatibility-status ready';
        status.title = `${catalog.service} · ${catalog.serviceType}`;
      } else if (catalog?.attempted) {
        status.textContent = `Task 실행 차단 · ${catalog.reason}`;
        status.className = 'action-compatibility-status blocked';
      } else {
        status.textContent = '등록 Action 목록 확인 중...';
        status.className = 'action-compatibility-status';
      }
    }

    const select = document.getElementById('action-type');
    if (select?.options) {
      Array.from(select.options).forEach(option => {
        if (!option.dataset.baseLabel) option.dataset.baseLabel = option.textContent;
        const supported = this._actionTypeSupported(parseInt(option.value), slot);
        option.disabled = !supported;
        option.textContent = `${option.dataset.baseLabel}${supported ? '' : ' · 미지원'}`;
      });
      const selected = select.options[select.selectedIndex];
      if (selected?.disabled) {
        const firstSupported = Array.from(select.options).find(option => !option.disabled);
        if (firstSupported) select.value = firstSupported.value;
      }
    }

    const selectedType = select?.value ? parseInt(select.value) : null;
    const addButton = document.getElementById('btn-add-to-queue');
    if (addButton) {
      const supported = selectedType === null || this._actionTypeSupported(selectedType, slot);
      addButton.disabled = !supported;
      addButton.title = supported
        ? '현재 Action을 Task 대기열에 추가합니다.'
        : catalog?.reason || '현재 로봇에 등록되지 않은 Action입니다.';
    }

    const quickTypes = {
      'btn-quick-waypoint': 0x01,
      'btn-quick-trajectory': 0x15,
      'btn-quick-freehand': 0x15,
      'btn-quick-docking': 0x08,
      'btn-quick-docking-inline': 0x08,
      'btn-quick-docking-out': 0x10,
      'btn-quick-docking-out-inline': 0x10,
      'btn-quick-docking-out-map': 0x10,
      'btn-quick-standby': 0x07
    };
    Object.entries(quickTypes).forEach(([id, type]) => {
      const button = document.getElementById(id);
      if (!button) return;
      const supported = this._actionTypeSupported(type, slot);
      button.disabled = !supported;
      if (!supported) {
        button.title = catalog?.verified
          ? `현재 로봇 scheduler에 Action 0x${type.toString(16).padStart(2, '0')} 미등록`
          : catalog?.reason || '등록 Action 목록 미검증';
      }
    });
    this._updateQuickTaskRunAvailability();
  },

  _turntableUsesAsyncArg(slot = App.robotSlots?.[this.getTargetSlot()]) {
    const profile = typeof RobotCompatibility !== 'undefined'
      ? RobotCompatibility.get(slot)
      : slot?.compatibilityProfile;
    return Boolean(profile?.actions?.turntable?.verified
      && profile.actions.turntable.asyncModeArg);
  },

  _actionArgDefinitions(actionType, existingArgs = null, slot = App.robotSlots?.[this.getTargetSlot()]) {
    const config = this.actionTypes[actionType];
    if (!config) return [];
    const definitions = Array.from(config.args || []);
    if (actionType === '0x02' && this._usesNativeSpxBasicMove(slot)) {
      definitions[0] = {
        ...definitions[0],
        desc: 'SPX BasicMove는 직진만 지원하며 전송 시 거리(m)를 mm로 자동 변환합니다.',
        enumValues: [{ value: 0, label: '직진 · SPX 자동 변환' }]
      };
    }
    const hasSavedAsyncArg = actionType === '0x22'
      && Array.isArray(existingArgs)
      && existingArgs.length >= 3;
    if (actionType === '0x22' && (this._turntableUsesAsyncArg(slot) || hasSavedAsyncArg)) {
      definitions.push(this.turntableAsyncArg);
    }
    return definitions;
  },

  updateActionForm(actionType, existingArgs = null) {
    const config = this.actionTypes[actionType];
    if (!config) return;

    // Exit waypoint select mode when changing action type
    this._exitWaypointSelectMode();

    // Update args container
    const argsContainer = document.getElementById('action-args-container');
    argsContainer.innerHTML = '';

    const actionArgDefinitions = this._actionArgDefinitions(actionType, existingArgs);
    actionArgDefinitions.forEach((arg, idx) => {
      const div = document.createElement('div');
      const inputHtml = arg.type === 'bool'
        ? `<label class="action-boolean-check" title="${arg.desc}">
            <input type="checkbox" id="action-arg-${idx}" ${Number(arg.default) !== 0 ? 'checked' : ''}>
            <span>사용</span>
          </label>`
        : Array.isArray(arg.enumValues)
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
    this._applyDetectedModelToForm(actionType);

    if (actionType === '0x08') {
      const targetCfgIndex = config.params.findIndex(param => param.name === 'target_cfg');
      if (targetCfgIndex >= 0) {
        this._setupTargetCfgControl(targetCfgIndex);
        this._loadTargetCfgOptions(targetCfgIndex);
      }
    }
  },

  _usesNativeSpxBasicMove(slot = App.robotSlots?.[this.getTargetSlot()]) {
    const { profile, catalog } = this._taskActionCatalog(slot);
    if (!['ros1_spx', 'ros2_spx'].includes(profile?.task?.protocol) || !catalog?.verified) {
      return false;
    }
    const action = catalog.actions.find(item => Number(item.type) === 0x02);
    return Boolean(action && (
      String(action.key).toLowerCase() === 'basic_move'
      || /basicmoveplugin/i.test(String(action.name))
    ));
  },

  _applyDetectedModelToForm(actionType) {
    if (!['0x01', '0x08', '0x15'].includes(actionType)) return;
    const slot = App.robotSlots?.[this.getTargetSlot()];
    const { profile } = this._taskActionCatalog(slot);
    const model = profile?.chassis?.driveModel;
    if (!model?.verified || !Number.isInteger(model.actionModelType)) return;
    const config = this.actionTypes[actionType];
    const index = config?.params?.findIndex(param => param.name === 'model_type');
    if (index < 0) return;
    const input = document.getElementById(`action-param-${index}`);
    if (!input) return;
    input.value = String(model.actionModelType);
    input.readOnly = true;
    input.title = `${model.parameter}에서 ${String(model.kind).toUpperCase()} 자동감지`;
  },

  // Read current form values and return an action object
  readCurrentAction() {
    const actionType = document.getElementById('action-type').value;
    const config = this.actionTypes[actionType];
    if (!config) return null;

    const actionArgs = [];
    const actionArgDefinitions = this._actionArgDefinitions(actionType);
    actionArgDefinitions.forEach((arg, idx) => {
      const input = document.getElementById(`action-arg-${idx}`);
      actionArgs.push(arg.type === 'bool'
        ? (input?.checked ? 1 : 0)
        : (parseFloat(input?.value) || 0));
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
    const argSummary = actionArgDefinitions
      .map((arg, idx) => `${arg.name}:${actionArgs[idx]}`)
      .join(', ');
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
    this._editingActionIndex = -1;
    this._editingActionBaselineSignature = '';
    this.renderQueue();
    if (this._builderMode !== 'list') this._showEditorTaskPreview(null);

    // Clear name input for next action
    if (nameInput) nameInput.value = '';

    App.toast(`Added to queue: ${actionName}`, 'info');
  },

  removeFromQueue(index) {
    if (index < 0 || index >= this.actionQueue.length) return;
    this._saveSnapshot();
    this.actionQueue.splice(index, 1);
    if (this._editingActionIndex === index) {
      this._editingActionIndex = -1;
      this._editingActionBaselineSignature = '';
    }
    else if (this._editingActionIndex > index) this._editingActionIndex -= 1;
    this.renderQueue();
    if (this._builderMode !== 'list') this._showEditorTaskPreview(this._editingActionIndex);
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
    if (this._editingActionIndex > index) this._editingActionIndex += 1;
    this.renderQueue();
    if (this._builderMode !== 'list') this._showEditorTaskPreview(index + 1);
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
    if (this._builderMode !== 'list') this._showEditorTaskPreview(this._editingActionIndex);
  },

  redo() {
    if (this._redoStack.length === 0) return;
    this._undoStack.push(JSON.stringify(this.actionQueue));
    this.actionQueue = JSON.parse(this._redoStack.pop());
    this.renderQueue();
    this._updateUndoRedoButtons();
    if (this._builderMode !== 'list') this._showEditorTaskPreview(this._editingActionIndex);
  },

  clearQueue() {
    this._saveSnapshot();
    this.actionQueue = [];
    this._editingActionIndex = -1;
    this._editingActionBaselineSignature = '';
    this.renderQueue();
    if (this._builderMode !== 'list') this._showEditorTaskPreview(null);
  },

  moveInQueue(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this.actionQueue.length) return;
    this._saveSnapshot();
    const temp = this.actionQueue[index];
    this.actionQueue[index] = this.actionQueue[newIndex];
    this.actionQueue[newIndex] = temp;
    if (this._editingActionIndex === index) this._editingActionIndex = newIndex;
    else if (this._editingActionIndex === newIndex) this._editingActionIndex = index;
    this.renderQueue();
    if (this._builderMode !== 'list') this._showEditorTaskPreview(this._editingActionIndex);
  },

  renderQueue() {
    const listEl = document.getElementById('action-queue-list');
    const countEl = document.getElementById('action-queue-count');
    countEl.textContent = this.actionQueue.length;

    if (this.actionQueue.length === 0) {
      listEl.innerHTML = '<p class="action-queue-empty">위에서 Action을 선택해 Task에 추가하세요.</p>';
      this._syncActionEditButtons();
      this._syncTaskPreviewSelections();
      return;
    }

    let html = '';
    this.actionQueue.forEach((item, idx) => {
      const typeKey = this._actionTypeKey(item);
      html += `<div class="action-queue-item${idx === this._editingActionIndex ? ' editing' : ''}" data-idx="${idx}" title="더블클릭하여 수정">
        <span class="action-queue-num">${idx + 1}.</span>
        <span class="action-queue-type">${typeKey || '--'}</span>
        <span class="action-queue-summary">${item.summary}</span>
        <span class="action-queue-actions">
          <button class="btn-mini" onclick="ActionSender.moveInQueue(${idx}, -1)" title="Up" ${idx === 0 ? 'disabled' : ''}>&#9650;</button>
          <button class="btn-mini" onclick="ActionSender.moveInQueue(${idx}, 1)" title="Down" ${idx === this.actionQueue.length - 1 ? 'disabled' : ''}>&#9660;</button>
          <button class="btn-mini" onclick="ActionSender.duplicateAction(${idx})" title="Action 복사">복사</button>
          <button class="btn-mini" onclick="ActionSender.loadActionToForm(${idx})" title="이 Action 수정">수정</button>
          <button class="btn-mini" onclick="ActionSender.removeFromQueue(${idx})" title="Remove" style="color:#ff6b6b;">&#10005;</button>
        </span>
      </div>`;
    });
    listEl.innerHTML = html;

    // Add double-click event to load action into form
    listEl.querySelectorAll('.action-queue-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.btn-mini')) return;
        const idx = parseInt(el.dataset.idx);
        this._showEditorTaskPreview(idx);
      });
      el.addEventListener('dblclick', (e) => {
        // Ignore if clicked on buttons
        if (e.target.closest('.btn-mini')) return;
        const idx = parseInt(el.dataset.idx);
        this.loadActionToForm(idx);
      });
    });
    this._syncActionEditButtons();
    this._syncTaskPreviewSelections();
  },

  _syncActionEditButtons() {
    const selected = this._editingActionIndex >= 0
      && this._editingActionIndex < this.actionQueue.length;
    const selectedType = selected
      ? this._actionTypeKey(this.actionQueue[this._editingActionIndex])
      : '';
    const sameTypeCount = selectedType
      ? this.actionQueue.filter(item => this._actionTypeKey(item) === selectedType).length
      : 0;
    const saveButton = document.getElementById('btn-save-selected-action');
    const applyButton = document.getElementById('btn-apply-params-same-type');
    const changeStatus = document.getElementById('action-edit-change-status');
    const changed = selected && this._hasSelectedActionChanges();
    if (saveButton) {
      saveButton.disabled = !changed;
      saveButton.classList.toggle('action-save-dirty', changed);
      saveButton.textContent = changed ? '변경사항 Action 저장' : 'Action 저장';
      saveButton.title = changed
        ? '원본과 다른 내용이 있습니다. 이 Action만 저장합니다.'
        : (selected ? '변경사항이 없습니다.' : '먼저 수정할 Action을 선택하세요.');
    }
    if (applyButton) {
      applyButton.disabled = !selected || sameTypeCount < 2;
      applyButton.textContent = sameTypeCount > 1
        ? `적용 대상 선택 · ${sameTypeCount - 1}개`
        : '파라미터 적용 대상 선택';
    }
    if (changeStatus) {
      changeStatus.textContent = !selected
        ? '수정할 Action을 선택하세요.'
        : (changed ? '● 원본과 다른 변경사항이 있습니다.' : '✓ 원본과 동일합니다.');
      changeStatus.classList.toggle('dirty', changed);
      changeStatus.classList.toggle('clean', selected && !changed);
    }
  },

  _actionEditSignature(action) {
    const params = Array.from(action?.params || action?.action_params || [])
      .map(param => ({
        name: String(param?.param_name || ''),
        type: String(param?.type || ''),
        value: String(param?.value ?? '')
      }))
      .sort((left, right) =>
        `${left.name}\u0000${left.type}`.localeCompare(`${right.name}\u0000${right.type}`)
      );
    return JSON.stringify({
      type: this._actionTypeKey(action),
      name: String(action?.name || action?.action_id || ''),
      args: Array.from(action?.args || action?.action_args || []).map(value => Number(value)),
      params,
      conveyorFloor: Number(action?.conveyorFloor || 0)
    });
  },

  _hasSelectedActionChanges(editedAction = null) {
    const index = this._editingActionIndex;
    const original = this.actionQueue[index];
    if (!original) return false;
    try {
      const edited = editedAction || this.readCurrentAction();
      if (!edited) return false;
      const merged = this._mergeEditedAction(original, edited);
      const baseline = this._editingActionBaselineSignature
        || this._actionEditSignature(original);
      return baseline !== this._actionEditSignature(merged);
    } catch (error) {
      return false;
    }
  },

  // Load action from queue into the form for editing
  loadActionToForm(index) {
    if (index < 0 || index >= this.actionQueue.length) return;
    const item = this.actionQueue[index];
    this._editingActionIndex = index;

    // Set action type
    const typeSelect = document.getElementById('action-type');
    typeSelect.value = item.actionType;
    const itemArgs = item.args || item.action_args || [];
    this.updateActionForm(item.actionType, itemArgs);

    // Set args
    const config = this.actionTypes[item.actionType];
    if (config && itemArgs.length > 0) {
      const formArgs = item.actionType === '0x15' && itemArgs.length > 3
        ? [itemArgs[0], itemArgs[1], itemArgs.at(-1)]
        : itemArgs;
      this._actionArgDefinitions(item.actionType, itemArgs).forEach((arg, i) => {
        const el = document.getElementById(`action-arg-${i}`);
        if (!el || formArgs[i] === undefined) return;
        if (arg.type === 'bool') el.checked = Number(formArgs[i]) !== 0;
        else el.value = formArgs[i];
      });
    }

    // Set params
    const itemParams = Array.from(item.params || item.action_params || []);
    if (config) {
      config.params.forEach((definition, i) => {
        const param = itemParams.find(entry => entry.param_name === definition.name);
        const el = document.getElementById(`action-param-${i}`);
        if (el) el.value = param ? param.value : definition.default;
      });
      this.commonParams.forEach((definition, i) => {
        const param = itemParams.find(entry => entry.param_name === definition.name);
        const el = document.getElementById(`common-param-${i}`);
        if (el) el.value = param ? param.value : definition.default;
      });
      this._syncTargetCfgControl();
    }
    const nameInput = document.getElementById('action-name');
    if (nameInput) nameInput.value = item.name || item.action_id || '';
    const baselineEdited = this.readCurrentAction();
    this._editingActionBaselineSignature = baselineEdited
      ? this._actionEditSignature(this._mergeEditedAction(item, baselineEdited))
      : this._actionEditSignature(item);

    // Highlight the selected item
    document.querySelectorAll('.action-queue-item').forEach(el => el.classList.remove('editing'));
    const itemEl = document.querySelector(`.action-queue-item[data-idx="${index}"]`);
    if (itemEl) itemEl.classList.add('editing');
    this._syncActionEditButtons();
    this._showEditorTaskPreview(index);

    App.toast(`Action #${index + 1} 수정 중 · 변경 후 "선택 Action 저장"을 누르세요.`, 'info');
  },

  _escapeActionEditText(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  },

  _sameTypeParamTargets() {
    const sourceIndex = this._editingActionIndex;
    const sourceType = this._actionTypeKey(this.actionQueue[sourceIndex]);
    if (!sourceType) return [];
    return this.actionQueue
      .map((action, index) => ({ action, index }))
      .filter(item =>
        item.index !== sourceIndex && this._actionTypeKey(item.action) === sourceType
      );
  },

  openSameTypeParamSelector() {
    const targets = this._sameTypeParamTargets();
    if (targets.length === 0) {
      App.toast('같은 종류의 다른 Action이 없습니다.', 'info');
      return false;
    }
    const modal = document.getElementById('action-param-target-modal');
    const list = document.getElementById('action-param-target-list');
    const subtitle = document.getElementById('action-param-target-subtitle');
    if (!modal || !list) return false;
    const source = this.actionQueue[this._editingActionIndex];
    const sourceType = this._actionTypeKey(source);
    if (subtitle) {
      subtitle.textContent = `기준: #${this._editingActionIndex + 1} `
        + `${source.name || source.action_id || sourceType} · ${sourceType}`;
    }
    list.innerHTML = targets.map(({ action, index }) => {
      const name = action.name || action.action_id || `Action_${index + 1}`;
      const summary = action.summary || this.actionTypes[sourceType]?.name || sourceType;
      return `
        <label class="action-param-target-item">
          <input type="checkbox" data-action-param-target="${index}">
          <span class="action-param-target-number">#${index + 1}</span>
          <span class="action-param-target-copy">
            <strong>${this._escapeActionEditText(name)}</strong>
            <small>${this._escapeActionEditText(summary)}</small>
          </span>
        </label>`;
    }).join('');
    const selectAll = document.getElementById('action-param-target-all');
    if (selectAll) selectAll.checked = false;
    modal.classList.add('show');
    this._syncParamTargetSelectionStatus();
    return true;
  },

  closeSameTypeParamSelector() {
    document.getElementById('action-param-target-modal')?.classList.remove('show');
  },

  _syncParamTargetSelectionStatus() {
    const checkboxes = Array.from(
      document.querySelectorAll('[data-action-param-target]')
    );
    const selectedCount = checkboxes.filter(checkbox => checkbox.checked).length;
    const selectAll = document.getElementById('action-param-target-all');
    if (selectAll) {
      selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
    }
    const status = document.getElementById('action-param-target-status');
    if (status) {
      status.textContent = selectedCount > 0
        ? `${selectedCount}개 선택 · 좌표·방향·Action 이름은 유지됩니다.`
        : '적용할 Action을 하나 이상 선택하세요.';
      status.classList.toggle('error', selectedCount === 0);
    }
    const applyButton = document.getElementById('btn-action-param-target-apply');
    if (applyButton) applyButton.disabled = selectedCount === 0;
  },

  _mergeEditedAction(original, edited) {
    const merged = JSON.parse(JSON.stringify(original || {}));
    const originalType = this._actionTypeKey(original);
    const editedType = this._actionTypeKey(edited);
    merged.actionType = editedType;
    if (merged.action_type !== undefined) merged.action_type = parseInt(editedType);

    const editedArgs = Array.from(edited.args || []);
    const originalArgs = Array.from(original?.args || original?.action_args || []);
    let args = editedArgs;
    if (originalType === '0x15' && editedType === '0x15' && originalArgs.length > 3) {
      args = [...originalArgs];
      args[0] = editedArgs[0];
      args[1] = editedArgs[1];
      args[args.length - 1] = editedArgs.at(-1);
    }
    if (merged.args !== undefined || merged.action_args === undefined) merged.args = args;
    if (merged.action_args !== undefined) merged.action_args = args;

    const editedParams = Array.from(edited.params || []);
    const editedNames = new Set(editedParams.map(param => param.param_name));
    const originalParams = Array.from(original?.params || original?.action_params || []);
    const params = [
      ...editedParams,
      ...originalParams
        .filter(param => !editedNames.has(param.param_name))
        .map(param => ({ ...param }))
    ];
    if (merged.params !== undefined || merged.action_params === undefined) merged.params = params;
    if (merged.action_params !== undefined) merged.action_params = params;

    const nameInput = document.getElementById('action-name');
    const requestedName = nameInput?.value?.trim();
    if (requestedName) {
      merged.name = requestedName;
      if (merged.action_id !== undefined) merged.action_id = requestedName;
    }
    const config = this.actionTypes[editedType];
    const displayName = merged.name || merged.action_id || `Action_${this._editingActionIndex + 1}`;
    merged.summary = `${displayName}: ${config?.name || editedType}`;
    if (edited.conveyorFloor !== undefined) merged.conveyorFloor = edited.conveyorFloor;
    return merged;
  },

  _persistEditedActions(indices) {
    if (!this._editingTaskName) return false;
    const saved = this.getSavedQueues();
    const entry = saved[this._editingTaskName];
    if (!entry?.queue) return false;
    const queue = Array.from(entry.queue);
    indices.forEach(index => {
      if (index >= 0 && index < this.actionQueue.length) {
        queue[index] = JSON.parse(JSON.stringify(this.actionQueue[index]));
      }
    });
    entry.queue = queue;
    entry.savedAt = Date.now();
    if (entry.builtin) entry.builtinCustomized = true;
    try {
      localStorage.setItem(this.QUEUE_STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
      App.toast(`Action 저장 실패: ${error.message}`, 'error');
      return false;
    }
    this._notifyTaskStoreChanged();
    this.refreshSavedQueueList();
    return true;
  },

  saveSelectedAction() {
    const index = this._editingActionIndex;
    if (index < 0 || index >= this.actionQueue.length) {
      App.toast('먼저 수정할 Action을 선택하세요.', 'error');
      return false;
    }
    const edited = this.readCurrentAction();
    if (!edited) return false;
    this._saveSnapshot();
    this.actionQueue[index] = this._mergeEditedAction(this.actionQueue[index], edited);
    this._editingActionBaselineSignature = this._actionEditSignature(this.actionQueue[index]);
    const persisted = this._persistEditedActions([index]);
    this.renderQueue();
    this._showEditorTaskPreview(index);
    App.toast(
      persisted
        ? `Action #${index + 1}만 저장했습니다.`
        : `Action #${index + 1}을 반영했습니다. 새 Task는 Task 저장 시 영구 저장됩니다.`,
      'success'
    );
    return true;
  },

  _replaceActionParams(action, params) {
    const updated = JSON.parse(JSON.stringify(action));
    if (updated.params !== undefined || updated.action_params === undefined) {
      updated.params = JSON.parse(JSON.stringify(params));
    }
    if (updated.action_params !== undefined) {
      updated.action_params = JSON.parse(JSON.stringify(params));
    }
    return updated;
  },

  applyParamsToSameType(selectedTargetIndices = []) {
    const sourceIndex = this._editingActionIndex;
    if (sourceIndex < 0 || sourceIndex >= this.actionQueue.length) {
      App.toast('기준 Action을 먼저 선택하세요.', 'error');
      return false;
    }
    const edited = this.readCurrentAction();
    if (!edited) return false;
    const sourceType = this._actionTypeKey(this.actionQueue[sourceIndex]);
    const allowedIndices = new Set(this._sameTypeParamTargets().map(item => item.index));
    const targetIndices = Array.from(new Set(selectedTargetIndices))
      .filter(index => allowedIndices.has(index));
    if (targetIndices.length === 0) {
      App.toast('적용할 같은 종류의 Action을 선택하세요.', 'info');
      return false;
    }

    this._saveSnapshot();
    const editedSource = this._mergeEditedAction(this.actionQueue[sourceIndex], edited);
    const sourceParams = JSON.parse(JSON.stringify(
      editedSource.params || editedSource.action_params || []
    ));
    this.actionQueue[sourceIndex] = this._replaceActionParams(
      this.actionQueue[sourceIndex],
      sourceParams
    );
    this._editingActionBaselineSignature = this._actionEditSignature(
      this.actionQueue[sourceIndex]
    );
    targetIndices.forEach(index => {
      this.actionQueue[index] = this._replaceActionParams(
        this.actionQueue[index],
        sourceParams
      );
    });
    const affected = [sourceIndex, ...targetIndices];
    const persisted = this._persistEditedActions(affected);
    this.renderQueue();
    this._showEditorTaskPreview(sourceIndex);
    App.toast(
      `${sourceType} 파라미터를 ${targetIndices.length}개 Action에 적용했습니다`
      + (persisted ? ' · 즉시 저장됨' : ''),
      'success'
    );
    return true;
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
      const message = `Task Action 준비 실패: ${error.message}`;
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

    let serviceName = '[runtime Task adapter 확인 전]';
    App.setButtonLoading(sendButton, true, 'Sending');
    // Record to action history
    const currentForHistory = this.readCurrentAction();
    if (currentForHistory && typeof ActionHistory !== 'undefined') ActionHistory.record(currentForHistory);

    // Test mode: intercept service call, simulate success + robot movement
    if (typeof TestMode !== 'undefined' && TestMode.enabled) {
      try {
        const simResult = await TestMode.runTask(slotIndex, request);
        this._registerRunningTask(slotIndex, taskId, actions, loopCount);
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
        this._registerRunningTask(slotIndex, taskId, actions, loopCount);
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
      this.showResult('Task cancel accepted; waiting for robot IDLE state');
      this._setTaskExecutionFeedback('cancel', `${robotId} · Task 취소 요청 승인 · 종료 상태 확인 중`);
      App.addEvent('action', 'Cancel accepted', robotId, 'success');
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
    if (this._builderMode !== 'list') {
      this.closeTaskBuilder();
      this.showSavedTaskPreview(storageKey);
    }
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
    this._editingActionIndex = -1;
    this._editingActionBaselineSignature = '';
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
    this.showTaskPreview(taskId, this.actionQueue, null, {
      source: this._builderMode === 'edit' ? 'editor' : 'library',
      storageKey: name
    });
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

  updateSavedTaskLoopFlag(taskName, rawValue) {
    if (String(rawValue ?? '').trim() === '') {
      App.toast('반복 횟수를 입력하세요. 0은 무한 반복입니다.', 'error');
      return false;
    }
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) {
      App.toast('반복 횟수는 0 이상의 숫자로 입력하세요.', 'error');
      return false;
    }
    const loopFlag = Math.max(0, Math.min(9999, Math.trunc(numeric)));
    const saved = this.getSavedQueues();
    const entry = saved[taskName];
    if (!entry) {
      App.toast('반복 횟수를 변경할 Task를 찾을 수 없습니다.', 'error');
      return false;
    }
    saved[taskName] = {
      ...entry,
      loopFlag,
      savedAt: Date.now(),
      ...(entry.builtin ? { builtinCustomized: true } : {})
    };
    try {
      localStorage.setItem(this.QUEUE_STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
      App.toast(`반복 횟수 저장 실패: ${error.message}`, 'error');
      return false;
    }
    this._notifyTaskStoreChanged();
    this.refreshSavedQueueList();
    App.toast(
      `"${entry.yamlTaskId || taskName}" 반복을 ${loopFlag === 0 ? '무한' : `${loopFlag}회`}로 저장했습니다.`,
      'success'
    );
    return loopFlag;
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
    return this._buildTaskDetailModel(
      entry.yamlTaskId || taskName,
      entry.queue,
      entry.loopFlag ?? 1
    );
  },

  _buildTaskDetailModel(name, queue, loopFlag = 1) {
    const taskQueue = Array.from(queue || []);
    return {
      name,
      loopFlag,
      missionCount: this._queueToMissionGroups(taskQueue).length,
      queue: taskQueue,
      actions: taskQueue.map((item, index) => {
        const typeKey = this._actionTypeKey(item);
        const config = this.actionTypes[typeKey];
        const args = Array.from(item.args || item.action_args || []);
        const argFields = typeKey === '0x15' && args.length >= 3
          ? args.slice(0, -1).map((_, argIndex) => ({
            name: `${argIndex % 2 === 0 ? 'x' : 'y'}${Math.floor(argIndex / 2)}`,
            label: `Trajectory ${Math.floor(argIndex / 2) + 1} · ${argIndex % 2 === 0 ? 'X' : 'Y'}`
          })).concat([{ name: 'theta', label: '최종 방향' }])
          : this._actionArgDefinitions(typeKey, args);
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
    if (model) model.storageKey = taskName;
    this._renderTaskDetailModel(container, model);
  },

  _renderTaskDetailModel(container, model) {
    if (!container) return;
    container.innerHTML = '';
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
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.title = '클릭하면 지도에서 이 Action의 위치와 경로를 강조합니다.';
      card.dataset.taskPreviewName = model.name;
      card.dataset.taskPreviewAction = String(index);
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
      const selectOnMap = () => {
        this.showTaskPreview(model.name, model.queue, index, {
          source: 'detail',
          storageKey: model.storageKey || ''
        });
      };
      card.addEventListener('click', selectOnMap);
      card.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectOnMap();
      });
      container.appendChild(card);
    });
    this._syncTaskPreviewSelections();
  },

  showTaskInfoFromQueue(name, queue, loopFlag = 1, contextLabel = '', options = {}) {
    const modal = document.getElementById('task-info-modal');
    const body = document.getElementById('task-info-modal-body');
    const title = document.getElementById('task-info-modal-title');
    const subtitle = document.getElementById('task-info-modal-subtitle');
    if (!modal || !body) return;
    const model = this._buildTaskDetailModel(name, queue, loopFlag);
    if (title) title.textContent = `Task Info · ${name}`;
    if (subtitle) {
      subtitle.textContent = [
        contextLabel,
        `${model.missionCount} Missions`,
        `${model.actions.length} Actions`,
        `반복 ${model.loopFlag === 0 ? '무한' : model.loopFlag}`
      ].filter(Boolean).join(' · ');
    }
    if (model.actions.length === 0) {
      body.innerHTML = '<p class="task-info-empty">아직 추가된 Action이 없습니다.</p>';
    } else {
      this._renderTaskDetailModel(body, model);
    }
    this._taskInfoModalMode = options.running ? 'running' : 'general';
    modal.classList.add('show');
    this._syncTaskInfoMiniWindow();
  },

  _findSavedTaskById(taskId) {
    const saved = this.getSavedQueues();
    const key = Object.keys(saved).find(name =>
      name === taskId || saved[name]?.yamlTaskId === taskId
    );
    return key ? { key, entry: saved[key] } : null;
  },

  _extractTaskRoute(queue) {
    const points = [];
    Array.from(queue || []).forEach((item, actionIndex) => {
      const typeKey = this._actionTypeKey(item);
      const actionId = item.name || item.action_id || `Action_${actionIndex + 1}`;
      const args = Array.from(item.args || item.action_args || []).map(Number);
      if ((typeKey === '0x01' || typeKey === '0x17')
          && args.length >= 3
          && args.slice(0, 3).every(Number.isFinite)) {
        points.push({
          x: args[0],
          y: args[1],
          theta: args[2],
          actionIndex,
          actionId,
          typeKey,
          pointIndex: 0,
          kind: typeKey === '0x17' ? 'change-map' : 'waypoint',
          label: `A${actionIndex + 1}`
        });
      } else if (typeKey === '0x15' && args.length >= 3) {
        const finalTheta = Number(args.at(-1)) || 0;
        const trajectory = [];
        for (let index = 0; index + 1 < args.length - 1; index += 2) {
          if (!Number.isFinite(args[index]) || !Number.isFinite(args[index + 1])) continue;
          trajectory.push({ x: args[index], y: args[index + 1] });
        }
        trajectory.forEach((point, pointIndex) => {
          const next = trajectory[pointIndex + 1];
          points.push({
            ...point,
            theta: next ? Math.atan2(next.y - point.y, next.x - point.x) : finalTheta,
            actionIndex,
            actionId,
            typeKey,
            pointIndex,
            kind: 'trajectory',
            label: `A${actionIndex + 1}.${pointIndex + 1}`
          });
        });
      }
    });
    return points;
  },

  _taskPreviewAction(queue, actionIndex) {
    if (!Number.isInteger(actionIndex)) return null;
    const item = Array.from(queue || [])[actionIndex];
    if (!item) return null;
    const typeKey = this._actionTypeKey(item);
    return {
      index: actionIndex,
      id: item.name || item.action_id || `Action_${actionIndex + 1}`,
      typeKey,
      typeName: this.actionTypes[typeKey]?.name || typeKey || 'Unknown'
    };
  },

  showTaskPreview(taskName, queue, selectedActionIndex = null, options = {}) {
    const taskQueue = JSON.parse(JSON.stringify(Array.from(queue || [])));
    const normalizedIndex = Number.isInteger(selectedActionIndex)
      && selectedActionIndex >= 0
      && selectedActionIndex < taskQueue.length
      ? selectedActionIndex
      : null;
    const points = this._extractTaskRoute(taskQueue);
    const action = this._taskPreviewAction(taskQueue, normalizedIndex);
    const selectedPoints = action
      ? points.filter(point => point.actionIndex === action.index)
      : points;
    this._taskPreview = {
      taskName: String(taskName || 'Task'),
      queue: taskQueue,
      points,
      selectedActionIndex: normalizedIndex,
      source: options.source || 'library',
      storageKey: options.storageKey || ''
    };

    if (typeof RosManager !== 'undefined') {
      RosManager.setTaskPreviewOverlay?.({
        taskName: this._taskPreview.taskName,
        points,
        selectedActionIndex: normalizedIndex,
        showRoute: true
      });
    }

    const panel = document.getElementById('task-preview-map-panel');
    const title = document.getElementById('task-preview-map-title');
    const detail = document.getElementById('task-preview-map-detail');
    const badge = document.getElementById('task-preview-map-badge');
    const allButton = document.getElementById('btn-task-preview-map-all');
    if (panel) panel.hidden = false;
    if (title) title.textContent = this._taskPreview.taskName;
    if (detail) {
      detail.textContent = action
        ? `Action ${action.index + 1} · ${action.id} · ${action.typeKey} ${action.typeName}`
        : `${taskQueue.length} Actions · 지도 포인트 ${points.length}개`;
    }
    if (badge) {
      badge.textContent = action
        ? (selectedPoints.length > 0
          ? `선택 Action · 포인트 ${selectedPoints.length}개`
          : '선택 Action · 지도 좌표 없음')
        : '전체 Task 경로';
      badge.classList.toggle('no-point', Boolean(action && selectedPoints.length === 0));
    }
    if (allButton) allButton.hidden = normalizedIndex === null;
    this._syncTaskPreviewSelections();
    return this._taskPreview;
  },

  showSavedTaskPreview(taskName, selectedActionIndex = null) {
    const entry = this.getSavedQueues()[taskName];
    if (!entry?.queue) return null;
    return this.showTaskPreview(
      entry.yamlTaskId || taskName,
      entry.queue,
      selectedActionIndex,
      { source: 'library', storageKey: taskName }
    );
  },

  clearTaskPreview() {
    this._taskPreview = null;
    const panel = document.getElementById('task-preview-map-panel');
    if (panel) panel.hidden = true;
    if (typeof RosManager !== 'undefined') RosManager.setTaskPreviewOverlay?.(null);
    this._syncTaskPreviewSelections();
  },

  _syncTaskPreviewSelections() {
    const preview = this._taskPreview;
    Array.from(document.querySelectorAll?.('[data-task-preview-action]') || []).forEach(card => {
      const sameTask = card.dataset.taskPreviewName === preview?.taskName;
      const sameAction = Number(card.dataset.taskPreviewAction)
        === Number(preview?.selectedActionIndex);
      card.classList.toggle('map-selected', Boolean(
        sameTask && preview?.selectedActionIndex !== null && sameAction
      ));
    });
    Array.from(document.querySelectorAll?.('.action-queue-item') || []).forEach(card => {
      card.classList.toggle('map-selected', Boolean(
        preview?.source === 'editor'
        && preview.selectedActionIndex !== null
        && Number(card.dataset.idx) === Number(preview.selectedActionIndex)
      ));
    });
  },

  _showEditorTaskPreview(actionIndex = null, useCurrentForm = false) {
    const queue = JSON.parse(JSON.stringify(this.actionQueue));
    if (useCurrentForm
        && Number.isInteger(actionIndex)
        && queue[actionIndex]) {
      const edited = this.readCurrentAction();
      if (edited) queue[actionIndex] = this._mergeEditedAction(queue[actionIndex], edited);
    }
    const name = document.getElementById('action-queue-save-name')?.value?.trim()
      || document.getElementById('action-work-id')?.value?.trim()
      || this._editingTaskName
      || '수정 중 Task';
    return this.showTaskPreview(name, queue, actionIndex, { source: 'editor' });
  },

  _registerRunningTask(slotIndex, taskId, queue, loopFlag = 1, state = 'work') {
    const slot = App.robotSlots?.[slotIndex];
    if (!slot?.robotId) return null;
    const actions = JSON.parse(JSON.stringify(Array.from(queue || [])));
    const record = {
      robotId: slot.robotId,
      taskId: taskId || 'Task',
      queue: actions,
      loopFlag,
      state,
      missionIndex: 0,
      actionIndex: 0,
      loopCount: 0,
      startedAt: Date.now(),
      points: this._extractTaskRoute(actions)
    };
    this._runningTasks.set(slot.robotId, record);
    this._taskInfoMiniDismissed.delete(slot.robotId);
    if (slotIndex === App.activeSlotIndex) this._syncActiveRunningTask();
    return record;
  },

  _ensureRunningTask(robotId, taskId) {
    let record = this._runningTasks.get(robotId);
    if (record && (!taskId || record.taskId === taskId)) return record;
    const saved = this._findSavedTaskById(taskId);
    record = {
      robotId,
      taskId: taskId || 'Task',
      queue: JSON.parse(JSON.stringify(saved?.entry?.queue || [])),
      loopFlag: saved?.entry?.loopFlag ?? 1,
      state: 'work',
      missionIndex: 0,
      actionIndex: 0,
      loopCount: 0,
      startedAt: Date.now()
    };
    record.points = this._extractTaskRoute(record.queue);
    this._runningTasks.set(robotId, record);
    return record;
  },

  _flattenTaskActionIndex(record, missionIndex, actionIndex) {
    const groups = this._queueToMissionGroups(record?.queue || []);
    const mission = Math.max(0, Number(missionIndex) || 0);
    const action = Math.max(0, Number(actionIndex) || 0);
    return groups.slice(0, mission).reduce((sum, group) => sum + group.actions.length, 0)
      + action;
  },

  _taskSummaryText(record) {
    if (!record) return '';
    const model = this._buildTaskDetailModel(record.taskId, record.queue, record.loopFlag);
    const header = [
      `Task: ${record.taskId}`,
      `State: ${String(record.state || 'idle').toUpperCase()}`,
      `Mission: ${Number(record.missionIndex) + 1}/${Math.max(1, model.missionCount)}`,
      model.actions.length > 0
        ? `Action: ${Math.min(Number(record.actionIndex) + 1, model.actions.length)}/${model.actions.length}`
        : 'Action: 정보 없음',
      `Loop: ${Number(record.loopCount) + 1}${record.loopFlag === 0 ? '/∞' : `/${record.loopFlag}`}`
    ].join(' · ');
    const actions = model.actions.map((action, index) => {
      const marker = index === Number(record.actionIndex) ? '▶' : ' ';
      const args = action.args.map(arg => `${arg.name}=${arg.value}`).join(', ');
      return `${marker} ${index + 1}. ${action.id} · ${action.typeKey} ${action.typeName}${args ? ` · ${args}` : ''}`;
    });
    return [header, ...actions].join('\n');
  },

  _syncActiveRunningTask() {
    const slot = App.robotSlots?.[App.activeSlotIndex];
    const panel = document.getElementById('active-task-map-panel');
    const record = slot?.robotId ? this._runningTasks.get(slot.robotId) : null;
    if (!panel || !record) {
      if (panel) panel.hidden = true;
      this._syncTaskInfoMiniWindow(record);
      if (typeof RosManager !== 'undefined') RosManager.setActiveTaskOverlay?.(null);
      if (typeof FleetControl !== 'undefined' && FleetControl._active) {
        FleetControl._updateTaskPanel?.();
        FleetControl.requestRender?.();
      }
      return;
    }
    panel.hidden = false;
    const title = document.getElementById('active-task-map-title');
    const robot = document.getElementById('active-task-map-robot');
    const state = document.getElementById('active-task-map-state');
    const routeToggle = document.getElementById('active-task-show-route');
    const summaryToggle = document.getElementById('active-task-show-summary');
    const summary = document.getElementById('active-task-map-summary');
    if (title) title.textContent = record.taskId;
    if (robot) {
      robot.textContent = record.queue.length > 0
        ? `${record.robotId} · Action ${Math.min(Number(record.actionIndex) + 1, record.queue.length)}/${record.queue.length}`
        : `${record.robotId} · Action 정보 수신 대기`;
    }
    if (state) state.textContent = String(record.state || 'idle').toUpperCase();
    if (routeToggle) routeToggle.checked = this._activeTaskDisplay.showRoute;
    if (summaryToggle) summaryToggle.checked = this._activeTaskDisplay.showSummary;
    if (summary) {
      summary.hidden = !this._activeTaskDisplay.showSummary;
      summary.textContent = this._taskSummaryText(record);
    }
    if (typeof RosManager !== 'undefined') {
      RosManager.setActiveTaskOverlay?.({
        ...record,
        currentActionIndex: record.actionIndex,
        showRoute: this._activeTaskDisplay.showRoute
      });
    }
    if (typeof FleetControl !== 'undefined' && FleetControl._active) {
      FleetControl._updateTaskPanel?.();
      FleetControl.requestRender?.();
    }
    this._syncTaskInfoMiniWindow(record);
  },

  showActiveRunningTaskInfo() {
    const slot = App.robotSlots?.[App.activeSlotIndex];
    const record = slot?.robotId ? this._runningTasks.get(slot.robotId) : null;
    if (!record) {
      App.toast('활성 로봇에서 확인할 실행 Task가 없습니다.', 'info');
      return;
    }
    this.showTaskInfoFromQueue(
      record.taskId,
      record.queue,
      record.loopFlag,
      `${record.robotId} · ${String(record.state || 'idle').toUpperCase()} · ${
        record.queue.length > 0
          ? `Action ${Math.min(Number(record.actionIndex) + 1, record.queue.length)}/${record.queue.length}`
          : 'Action 정보 없음'
      }`,
      { running: true }
    );
  },

  closeTaskInfo() {
    const modal = document.getElementById('task-info-modal');
    modal?.classList.remove('show');
    this._taskInfoModalMode = '';
    this._syncTaskInfoMiniWindow();
  },

  _syncTaskInfoMiniWindow(recordOverride) {
    const mini = document.getElementById('task-info-mini');
    if (!mini) return;
    const slot = App.robotSlots?.[App.activeSlotIndex];
    const record = recordOverride === undefined
      ? (slot?.robotId ? this._runningTasks.get(slot.robotId) : null)
      : recordOverride;
    const activeStates = new Set(['work', 'pause', 'recovery']);
    const modalOpen = document.getElementById('task-info-modal')
      ?.classList?.contains('show');
    const dismissed = Boolean(record?.robotId
      && this._taskInfoMiniDismissed.has(record.robotId));
    const visible = Boolean(
      record
      && activeStates.has(String(record.state || '').toLowerCase())
      && !modalOpen
      && !dismissed
    );
    mini.hidden = !visible;
    if (!visible) return;

    const actionCount = record.queue.length;
    const actionNumber = actionCount > 0
      ? Math.min(Number(record.actionIndex) + 1, actionCount)
      : 0;
    const action = actionCount > 0 ? record.queue[Math.max(0, actionNumber - 1)] : null;
    const typeKey = action ? this._actionTypeKey(action) : '';
    const typeName = typeKey ? (this.actionTypes[typeKey]?.name || typeKey) : 'Action 정보 수신 대기';
    const progress = actionCount > 0 ? actionNumber / actionCount * 100 : 0;
    const title = document.getElementById('task-info-mini-title');
    const robot = document.getElementById('task-info-mini-robot');
    const state = document.getElementById('task-info-mini-state');
    const detail = document.getElementById('task-info-mini-detail');
    const fill = document.getElementById('task-info-mini-progress-fill');
    if (title) title.textContent = record.taskId;
    if (robot) robot.textContent = `${record.robotId} · Action ${actionNumber}/${actionCount || '?'}`;
    if (state) {
      state.textContent = String(record.state || 'work').toUpperCase();
      state.dataset.state = String(record.state || 'work').toLowerCase();
    }
    if (detail) {
      detail.textContent = [
        action?.name || action?.action_id || typeName,
        typeName,
        `Loop ${Number(record.loopCount) + 1}${record.loopFlag === 0 ? '/∞' : `/${record.loopFlag}`}`
      ].join(' · ');
    }
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, progress)).toFixed(1)}%`;
  },

  _loadRecentTaskRuns() {
    let records = [];
    try {
      if (typeof sessionStorage !== 'undefined') {
        records = JSON.parse(sessionStorage.getItem(this.RECENT_TASK_RUNS_KEY)) || [];
      }
    } catch (error) {
      console.warn('최근 실행 Task 불러오기 실패:', error.message);
    }
    this._recentTaskRuns = Array.from(records || [])
      .filter(record =>
        record
        && record.id
        && record.entry
        && Array.isArray(record.entry.queue)
        && record.entry.queue.length > 0
      )
      .slice(0, this.MAX_RECENT_TASK_RUNS);
    return this._recentTaskRuns;
  },

  _saveRecentTaskRuns() {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(
          this.RECENT_TASK_RUNS_KEY,
          JSON.stringify(this._recentTaskRuns.slice(0, this.MAX_RECENT_TASK_RUNS))
        );
      }
    } catch (error) {
      console.warn('최근 실행 Task 임시저장 실패:', error.message);
    }
  },

  _rememberRecentTaskRun({
    sourceQueue,
    taskId,
    entry,
    robotId,
    actionCount,
    executedAt = Date.now()
  }) {
    if (!entry?.queue?.length) return null;
    const record = {
      id: `${executedAt}-${Math.random().toString(36).slice(2, 8)}`,
      sourceQueue: String(sourceQueue || taskId || ''),
      taskId: String(taskId || sourceQueue || 'Task'),
      robotId: String(robotId || '--'),
      actionCount: Number(actionCount) || entry.queue.length,
      executedAt,
      entry: {
        queue: JSON.parse(JSON.stringify(entry.queue)),
        loopFlag: Number.isFinite(Number(entry.loopFlag)) ? Number(entry.loopFlag) : 1,
        yamlTaskId: String(entry.yamlTaskId || taskId || sourceQueue || 'Task')
      }
    };
    this._recentTaskRuns = [
      record,
      ...Array.from(this._recentTaskRuns || [])
    ].slice(0, this.MAX_RECENT_TASK_RUNS);
    this._saveRecentTaskRuns();
    this.renderRecentTaskRuns();
    return record;
  },

  _formatRecentTaskTime(timestamp) {
    const date = new Date(Number(timestamp) || Date.now());
    return date.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  },

  renderRecentTaskRuns() {
    const section = document.getElementById('recent-task-runs');
    const list = document.getElementById('recent-task-runs-list');
    if (!section || !list) return;
    const records = Array.from(this._recentTaskRuns || []).slice(0, this.MAX_RECENT_TASK_RUNS);
    section.hidden = records.length === 0;
    list.innerHTML = '';
    if (records.length === 0) return;

    const slot = App.robotSlots?.[this.getTargetSlot()];
    const canReplay = Boolean(slot?.connected && slot.ros);
    records.forEach((record, index) => {
      const card = document.createElement('article');
      card.className = 'recent-task-run-card';

      const rank = document.createElement('span');
      rank.className = 'recent-task-run-rank';
      rank.textContent = index === 0 ? '방금' : String(index + 1);

      const copy = document.createElement('span');
      copy.className = 'recent-task-run-copy';
      const title = document.createElement('strong');
      title.textContent = record.taskId;
      title.title = record.taskId;
      const meta = document.createElement('small');
      meta.textContent = [
        record.robotId,
        `${record.actionCount} Actions`,
        this._formatRecentTaskTime(record.executedAt)
      ].join(' · ');
      copy.appendChild(title);
      copy.appendChild(meta);

      const replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'recent-task-replay';
      replay.textContent = '▶';
      replay.disabled = !canReplay;
      replay.title = canReplay
        ? `"${record.taskId}"을(를) 활성 로봇 ${slot.robotId}에서 다시 실행`
        : '활성 로봇을 연결하면 다시 실행할 수 있습니다.';
      replay.setAttribute('aria-label', `${record.taskId} 다시 실행`);
      replay.addEventListener('click', () => this.replayRecentTask(record.id, replay));

      card.appendChild(rank);
      card.appendChild(copy);
      card.appendChild(replay);
      list.appendChild(card);
    });
  },

  async replayRecentTask(recordId, button) {
    const record = Array.from(this._recentTaskRuns || [])
      .find(item => item.id === recordId);
    if (!record?.entry?.queue?.length) {
      App.toast('다시 실행할 최근 Task 정보를 찾을 수 없습니다.', 'error');
      return false;
    }
    const slotIndex = this.getTargetSlot();
    const slot = App.robotSlots?.[slotIndex];
    if (!slot?.connected || !slot.ros) {
      App.toast('활성 로봇이 연결되어 있지 않습니다.', 'error');
      return false;
    }
    if (!confirm(
      `${slot.robotId}에서 최근 Task "${record.taskId}"을(를) 다시 실행하시겠습니까?\n`
      + `${record.actionCount} Actions · 반복 ${record.entry.loopFlag}`
    )) return false;

    App.setButtonLoading(button, true, '…');
    this._setTaskExecutionFeedback('work', `${slot.robotId} · ${record.taskId} 다시 전송 중...`);
    try {
      const sent = await this._sendQueueEntryToSlot(
        record.entry,
        record.sourceQueue || record.taskId,
        slotIndex,
        record.entry.loopFlag,
        record.taskId
      );
      this._setTaskExecutionFeedback(
        'work',
        `${sent.robotId} · ${record.taskId} 다시 실행 요청 완료 · ${sent.actionCount} Actions`
      );
      App.toast(`${sent.robotId}: "${record.taskId}" 다시 실행 요청 완료`, 'success');
      return true;
    } catch (error) {
      this._setTaskExecutionFeedback('error', `다시 실행 실패 · ${error.message || error}`);
      App.toast(`최근 Task 다시 실행 실패: ${error.message || error}`, 'error');
      return false;
    } finally {
      App.setButtonLoading(button, false);
    }
  },

  renderTaskLibrary(filterText = '') {
    const builtinGrid = document.getElementById('builtin-task-grid');
    const userGrid = document.getElementById('task-library-grid');
    if (!userGrid) return;
    const saved = this.getSavedQueues();
    const filter = String(filterText || '').trim().toLocaleLowerCase();
    const matchesFilter = name =>
      !filter || (saved[name]?.yamlTaskId || name).toLocaleLowerCase().includes(filter);
    const builtinNames = Object.keys(saved)
      .filter(name => saved[name]?.builtin && matchesFilter(name))
      .sort((a, b) => {
        const left = this.defaultTaskSpecs.findIndex(spec => spec.name === a);
        const right = this.defaultTaskSpecs.findIndex(spec => spec.name === b);
        return (left < 0 ? Number.MAX_SAFE_INTEGER : left)
          - (right < 0 ? Number.MAX_SAFE_INTEGER : right);
      });
    const userNames = this._getVisibleTaskKeys(saved)
      .filter(name => !saved[name]?.builtin && matchesFilter(name));
    if (builtinGrid) builtinGrid.innerHTML = '';
    userGrid.innerHTML = '';

    const builtinCount = document.getElementById('builtin-task-count');
    const userCount = document.getElementById('user-task-count');
    if (builtinCount) builtinCount.textContent = String(builtinNames.length);
    if (userCount) userCount.textContent = String(userNames.length);
    if (filter && builtinNames.length > 0) {
      const toggle = document.getElementById('builtin-task-toggle');
      if (toggle) toggle.open = true;
    }

    const renderEmpty = (grid, text) => {
      if (!grid) return;
      const empty = document.createElement('p');
      empty.className = 'task-library-empty';
      empty.textContent = text;
      grid.appendChild(empty);
    };

    const renderCards = (grid, names, builtinSection = false) => {
      if (!grid) return;
      names.forEach(name => {
        const entry = saved[name];
        const model = this.getTaskDetailModel(name);
        if (!model) return;
        const expanded = this._expandedTaskNames.has(name);
        const card = document.createElement('article');
        card.className = `task-library-card${builtinSection ? ' builtin' : ''}${
          builtinSection && entry.builtinCustomized ? ' customized' : ''
        }${expanded ? ' expanded' : ''}${
          this._taskPreview?.storageKey === name ? ' map-preview-selected' : ''
        }`;

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
        if (builtinSection) {
          const builtin = document.createElement('small');
          builtin.textContent = entry.builtinCustomized ? '사용자 설정' : '추천 기본값';
          titleRow.appendChild(builtin);
        }
        const meta = document.createElement('span');
        meta.className = 'task-library-card-meta';
        meta.textContent = `${model.missionCount} Missions · ${model.actions.length} Actions · 반복 ${
          model.loopFlag === 0 ? '무한' : model.loopFlag
        }`;
        head.appendChild(titleRow);
        head.appendChild(meta);
        head.addEventListener('click', () => {
          this.showSavedTaskPreview(name);
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
        const loopEditor = document.createElement('label');
        loopEditor.className = 'task-library-loop-editor';
        loopEditor.title = '0은 무한 반복입니다.';
        const loopLabel = document.createElement('span');
        loopLabel.textContent = '반복';
        const loopInput = document.createElement('input');
        loopInput.type = 'number';
        loopInput.min = '0';
        loopInput.max = '9999';
        loopInput.step = '1';
        loopInput.value = String(model.loopFlag);
        loopInput.setAttribute('aria-label', `${model.name} 반복 횟수`);
        loopInput.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          loopInput.blur();
        });
        loopInput.addEventListener('change', () => {
          const updated = this.updateSavedTaskLoopFlag(name, loopInput.value);
          if (updated === false) loopInput.value = String(model.loopFlag);
        });
        const loopHint = document.createElement('small');
        loopHint.textContent = '0=∞';
        loopEditor.appendChild(loopLabel);
        loopEditor.appendChild(loopInput);
        loopEditor.appendChild(loopHint);
        const infoButton = document.createElement('button');
        infoButton.type = 'button';
        infoButton.className = 'btn btn-small';
        infoButton.textContent = 'Task Info';
        infoButton.addEventListener('click', () => {
          this.showTaskInfoFromQueue(
            model.name,
            entry.queue,
            model.loopFlag,
            builtinSection ? '기본 Task' : '저장 Task'
          );
        });
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'btn btn-small';
        editButton.textContent = builtinSection ? '용도별 설정' : '수정';
        editButton.addEventListener('click', () => {
          if (builtinSection) this.openBuiltinTaskSettings(name);
          else this.openTaskBuilder(name);
        });
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'btn btn-small';
        copyButton.textContent = builtinSection ? '내 Task로 복사' : '복사';
        copyButton.title = builtinSection
          ? '현재 설정값을 수정 가능한 사용자 Task로 복사합니다.'
          : '이 Task와 모든 Action을 현재 YAML 파일 안에 복사합니다.';
        copyButton.addEventListener('click', () => this.duplicateSavedQueue(name));
        const runButton = document.createElement('button');
        runButton.type = 'button';
        runButton.className = 'btn btn-small btn-primary task-library-run';
        runButton.textContent = '실행';
        const activeSlot = App.robotSlots?.[this.getTargetSlot()];
        runButton.disabled = !activeSlot?.connected || !activeSlot.ros || model.actions.length === 0;
        runButton.addEventListener('click', () => this.runSavedTask(name, runButton));
        controls.appendChild(loopEditor);
        controls.appendChild(infoButton);
        controls.appendChild(editButton);
        controls.appendChild(copyButton);
        if (!builtinSection) {
          const deleteButton = document.createElement('button');
          deleteButton.type = 'button';
          deleteButton.className = 'btn btn-small btn-danger';
          deleteButton.textContent = '삭제';
          deleteButton.addEventListener('click', () => this.deleteSavedQueueByName(name));
          controls.appendChild(deleteButton);
        }
        controls.appendChild(runButton);
        card.appendChild(controls);
        grid.appendChild(card);
      });
    };

    if (builtinNames.length === 0) {
      renderEmpty(
        builtinGrid,
        filter ? '검색 조건에 맞는 기본 Task가 없습니다.' : '기본 Task를 준비 중입니다.'
      );
    } else {
      renderCards(builtinGrid, builtinNames, true);
    }
    if (userNames.length === 0) {
      renderEmpty(
        userGrid,
        filter ? '검색 조건에 맞는 사용자 Task가 없습니다.' : '저장된 사용자 Task가 없습니다.'
      );
    } else {
      renderCards(userGrid, userNames, false);
    }
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
    delete copied.builtinCustomized;
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
    return this._sendQueueEntryToSlot(entry, queueName, slotIndex, loopCount, taskId);
  },

  async _sendQueueEntryToSlot(entry, sourceQueue, slotIndex, loopCount = 1, taskId = sourceQueue) {
    if (!entry || !Array.isArray(entry.queue) || entry.queue.length === 0) {
      throw new Error(`실행할 Task "${taskId || sourceQueue}" 정보를 찾을 수 없습니다`);
    }
    const slot = App.robotSlots[slotIndex];
    if (!slot?.connected || !slot.ros) throw new Error('선택한 로봇이 연결되어 있지 않습니다');
    const robotId = slot.robotId;
    const missionGroups = this._queueToMissionGroups(entry.queue);
    const normalizedGroups = missionGroups.map(group => ({
      // missions.mission_id is a ROS string field. Older locally saved Tasks
      // may contain the fallback numeric value 1, so normalize at the wire
      // boundary instead of relying on every stored/imported record.
      mission_id: this._normalizeMissionId(group.missionId),
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
      task_id: taskId || sourceQueue,
      loop_flag: Number.isFinite(Number(loopCount)) ? Number(loopCount) : 1,
      missions
    };
    if (typeof TestMode !== 'undefined' && TestMode.enabled && slot.virtualTestRobot) {
      const result = await TestMode.runTask(slotIndex, request);
      this._registerRunningTask(
        slotIndex,
        taskId || sourceQueue,
        entry.queue,
        request.loop_flag
      );
      if (typeof App.logAudit === 'function') {
        App.logAudit('fleet_task_send', {
          taskId: taskId || sourceQueue,
          sourceQueue,
          robotId,
          actionCount: preparedActions.length,
          loopCount: request.loop_flag,
          mode: 'test'
        });
      }
      this._rememberRecentTaskRun({
        sourceQueue,
        taskId: taskId || sourceQueue,
        entry: { ...entry, loopFlag: request.loop_flag },
        robotId,
        actionCount: preparedActions.length
      });
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
    this._registerRunningTask(
      slotIndex,
      taskId || sourceQueue,
      entry.queue,
      request.loop_flag
    );
    if (typeof App.logAudit === 'function') {
      App.logAudit('fleet_task_send', {
        taskId: taskId || sourceQueue,
        sourceQueue,
        robotId,
        actionCount: preparedActions.length,
        loopCount: request.loop_flag
      });
    }
    this._rememberRecentTaskRun({
      sourceQueue,
      taskId: taskId || sourceQueue,
      entry: { ...entry, loopFlag: request.loop_flag },
      robotId,
      actionCount: preparedActions.length
    });
    return { result, robotId, actionCount: preparedActions.length, serviceName: taskInterface.goalName };
  },

  async sendJogActionToSlot(slotIndex, actionType, args, taskId = '') {
    const slot = App.robotSlots?.[slotIndex];
    if (!slot?.connected || !slot.ros) throw new Error('활성 로봇이 연결되어 있지 않습니다');
    const resolvedTaskId = taskId || `easyloop_jog_${Date.now()}`;
    const normalized = this.normalizeActionForSend({
      action_type: Number(actionType),
      action_args: Array.from(args || []),
      action_params: []
    });
    normalized.action_id = 'jog_action';
    const [action] = await this._prepareActionsForSlot([normalized], slot);
    const request = {
      task_id: resolvedTaskId,
      loop_flag: 1,
      missions: [{ mission_id: '1', actions: [action] }]
    };

    if (typeof TestMode !== 'undefined' && TestMode.enabled && slot.virtualTestRobot) {
      const result = await TestMode.runTask(slotIndex, request);
      this._registerRunningTask(slotIndex, resolvedTaskId, [{
        actionType: Number(actionType),
        args: action.action_args,
        params: []
      }], 1);
      return { result, robotId: slot.robotId, request, serviceName: '[TestMode virtual task]' };
    }

    const taskInterface = await this._resolveTaskInterface(slot);
    const result = await this._callTaskService(
      slot.ros,
      taskInterface.goalName,
      taskInterface.goalType,
      request
    );
    if (result && result.success === false) {
      throw new Error(result.message || `error_code=${result.error_code}`);
    }
    this._registerRunningTask(slotIndex, resolvedTaskId, [{
      actionType: Number(actionType),
      args: action.action_args,
      params: []
    }], 1);
    return { result, robotId: slot.robotId, request, serviceName: taskInterface.goalName };
  },

  async _prepareActionsForSlot(actions, slot) {
    const prepared = (actions || []).map(action => ({ ...action }));
    let profile = typeof RobotCompatibility !== 'undefined'
      ? RobotCompatibility.get(slot)
      : slot?.compatibilityProfile;
    if (typeof RobotCompatibility !== 'undefined' && slot?.ros && !profile?.discovered) {
      if (slot.compatibilityPromise) await slot.compatibilityPromise;
      else if (typeof RobotCompatibility.discover === 'function') {
        await RobotCompatibility.discover(slot);
      }
      profile = RobotCompatibility.get(slot);
    }
    const catalog = profile?.task?.actionCatalog;
    if (catalog?.attempted && !catalog.verified) {
      throw new Error(`등록 Action 자동감지 실패: ${catalog.reason || 'ActionInfo 미검증'}`);
    }
    if (catalog?.verified) {
      prepared.forEach(action => {
        const type = Number(action.action_type);
        if (!catalog.types.includes(type)) {
          throw new Error(
            `Action 0x${type.toString(16).padStart(2, '0')} 차단: 현재 scheduler에 등록되지 않았습니다.`
          );
        }
      });
    }
    const turntableActions = prepared.filter(action => Number(action.action_type) === 0x22);
    if (turntableActions.length > 0 && (!profile?.discovered
        || !profile?.actions?.turntable?.verified)) {
      throw new Error(
        `Turntable action 차단: ${profile?.actions?.turntable?.reason || profile?.reason || 'endpoint/type 미검증'}`
      );
    }
    const turntableAsyncMode = Boolean(profile?.actions?.turntable?.asyncModeArg);

    turntableActions.forEach(action => {
        const args = Array.from(action.action_args || []).map(value => Number(value) || 0);
        if (turntableAsyncMode === true) {
          action.action_args = [args[0] || 0, args[1] || 0, args[2] ? 1 : 0];
        } else if (turntableAsyncMode === false) {
          action.action_args = args.slice(0, 2);
        }
      });

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

    prepared.forEach(action => this._normalizeActionContractForProfile(action, profile));
    prepared.forEach(action => delete action.conveyorFloor);
    return prepared;
  },

  _registeredAction(profile, actionType) {
    return profile?.task?.actionCatalog?.actions?.find(
      item => Number(item.type) === Number(actionType)
    ) || null;
  },

  _actionParamValue(action, name, fallback = undefined) {
    const param = Array.from(action?.action_params || []).find(item =>
      String(item?.param_name || item?.name || '') === name
    );
    return param ? param.value : fallback;
  },

  _setActionWireParam(action, name, type, value) {
    const params = Array.from(action.action_params || []);
    const index = params.findIndex(item => String(item?.param_name || item?.name || '') === name);
    const next = { param_name: name, type, value: String(value) };
    if (index >= 0) params[index] = { ...params[index], ...next };
    else params.push(next);
    action.action_params = params;
  },

  _usesNativeSpxBasicMoveProfile(profile) {
    if (!['ros1_spx', 'ros2_spx'].includes(profile?.task?.protocol)) return false;
    const registered = this._registeredAction(profile, 0x02);
    return Boolean(registered && (
      String(registered.key).toLowerCase() === 'basic_move'
      || /basicmoveplugin/i.test(String(registered.name))
    ));
  },

  _normalizeNativeSpxBasicMove(action) {
    const args = Array.from(action.action_args || []).map(Number);
    if (args.length !== 2 || !args.every(Number.isFinite)) {
      throw new Error('SPX Basic_Move 변환 실패: EasyLoop 입력 [move_type, move_amount] 2개가 필요합니다.');
    }
    const [moveType, moveAmount] = args;
    if (moveType !== 0) {
      throw new Error('SPX BasicMovePlugin은 직진만 지원합니다. 회전 입력은 전송하지 않았습니다.');
    }
    if (moveAmount <= 0 || moveAmount > 10) {
      throw new Error('SPX BasicMovePlugin 직진 거리는 0 초과 10 m 이하여야 합니다.');
    }
    const speed = Number(this._actionParamValue(action, 'move_vel', 0.3));
    if (!Number.isFinite(speed) || speed <= 0 || speed > 1.8) {
      throw new Error('SPX BasicMovePlugin 속도는 0 초과 1.8 m/s 이하여야 합니다.');
    }
    action.action_args = [moveAmount * 1000, speed];
    action.action_params = Array.from(action.action_params || []).filter(item =>
      String(item?.param_name || item?.name || '') !== 'move_vel'
    );
  },

  _validateActionWireShape(action, profile) {
    const type = Number(action.action_type);
    const args = Array.from(action.action_args || []).map(Number);
    if (!Number.isInteger(type) || type <= 0) throw new Error(`잘못된 action_type: ${action.action_type}`);
    if (!args.every(Number.isFinite)) {
      throw new Error(`Action 0x${type.toString(16).padStart(2, '0')} 인자에 숫자가 아닌 값이 있습니다.`);
    }
    const exactCounts = new Map([
      [0x01, 3], [0x02, 2], [0x07, 1], [0x08, 4], [0x10, 1], [0x12, 1],
      [0x16, 2], [0x17, 3], [0x19, 2], [0x21, 2]
    ]);
    if (type === 0x22) exactCounts.set(type, profile?.actions?.turntable?.argCount || 2);
    const expected = exactCounts.get(type);
    if (expected !== undefined && args.length !== expected) {
      throw new Error(
        `Action 0x${type.toString(16).padStart(2, '0')} 인자는 ${expected}개여야 합니다. 현재 ${args.length}개입니다.`
      );
    }
    if (type === 0x15 && (args.length < 3 || args.length % 2 !== 1)) {
      throw new Error('TrajectoryFollowing 인자는 [x,y,...,final_theta] 형태의 홀수 개여야 합니다.');
    }
    if (type === 0x18 && (args.length < 2 || args.length % 2 !== 0)) {
      throw new Error('Conveyor 인자는 [cmd_type,count] 쌍으로 구성되어야 합니다.');
    }
    if (type === 0x08) {
      const [isCharge, direction, scanType, endCondition] = args;
      if (![0, 1].includes(isCharge)
          || ![1, -1, 2, 3].includes(direction)
          || scanType < 1 || scanType > 7
          || endCondition < 1 || endCondition > 3) {
        throw new Error('Docking 인자 범위가 현재 로봇 계약과 맞지 않습니다.');
      }
    }
    if (type === 0x17) {
      const mapId = String(this._actionParamValue(action, 'map_id', '')).trim();
      if (!mapId) throw new Error('Change_Map Action에는 map_id 파라미터가 필요합니다.');
    }
    action.action_args = args;
  },

  _normalizeActionContractForProfile(action, profile) {
    const type = Number(action.action_type);
    if (this._usesNativeSpxBasicMoveProfile(profile) && type === 0x02) {
      this._normalizeNativeSpxBasicMove(action);
    }
    const driveModel = profile?.chassis?.driveModel;
    if (this._requiresDetectedActionModel(type)
        && driveModel?.attempted && !driveModel.verified) {
      throw new Error(
        `Action 0x${type.toString(16).padStart(2, '0')} 차단: ${driveModel.reason || '차상 model_type 자동감지 실패'}`
      );
    }
    if (driveModel?.verified && Number.isInteger(driveModel.actionModelType)
        && this._requiresDetectedActionModel(type)) {
      this._setActionWireParam(action, 'model_type', 'int', driveModel.actionModelType);
    }
    this._validateActionWireShape(action, profile);
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

  async _fetchDockingCoreCfgFiles(_slot) {
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
        serviceArgs,
        4000
      );
      if (result && result.success === false) {
        throw new Error(result.message || `Task ${kind} 요청이 거부되었습니다`);
      }
      return result;
    } catch (error) {
      if (kind === 'cancel' && error.code !== 'TASK_CONTROL_TIMEOUT') {
        this._taskCancelRequests.delete(slot.robotId);
      }
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
    const slot = App.robotSlots?.[slotIndex];
    const key = String(slot?.robotId || slotIndex);
    const pending = this._taskCancelPromises.get(key);
    if (pending) return pending;
    const request = this._controlTaskOnSlot(slotIndex, 'cancel');
    this._taskCancelPromises.set(key, request);
    request.finally(() => {
      if (this._taskCancelPromises.get(key) === request) {
        this._taskCancelPromises.delete(key);
      }
    }).catch(() => {});
    return request;
  },

  async _controlActiveTask(kind, button) {
    const slotIndex = this.getTargetSlot();
    const slot = App.robotSlots?.[slotIndex];
    const labels = { pause: '일시정지', resume: '재개', cancel: '취소' };
    if (!slot?.connected || !slot.ros) {
      this._setTaskExecutionFeedback('error', '활성 로봇이 연결되어 있지 않습니다.');
      return;
    }
    const keepCancelEnabled = kind === 'cancel';
    if (keepCancelEnabled) {
      this._setTaskExecutionFeedback('cancel', `${slot.robotId} · Task 취소 요청 전송 중…`);
    } else {
      App.setButtonLoading(button, true, '요청 중');
    }
    try {
      await this._controlTaskOnSlot(slotIndex, kind);
      const state = kind === 'pause' ? 'pause' : kind === 'resume' ? 'work' : 'cancel';
      const running = this._runningTasks.get(slot.robotId);
      if (running) {
        running.state = kind === 'cancel' ? 'cancel' : state;
        this._syncActiveRunningTask();
      }
      const statusText = kind === 'cancel'
        ? `${slot.robotId} · Task 취소 요청 승인 · 종료 상태 확인 중`
        : `${slot.robotId} · Task ${labels[kind]} 요청 완료`;
      this._setTaskExecutionFeedback(state, statusText);
      App.toast(`${slot.robotId}: Task ${labels[kind]} 요청 완료`, 'success');
    } catch (error) {
      const message = error.code === 'TASK_CONTROL_TIMEOUT' && kind === 'cancel'
        ? '취소 요청은 전송됐지만 로봇 서비스 응답이 없습니다. Task 상태를 확인하세요.'
        : `${labels[kind]} 실패 · ${error.message || error}`;
      this._setTaskExecutionFeedback('error', message);
      App.toast(message, 'error');
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
    try { this._taskTelemetry.state?.unsubscribe(); } catch (error) { /* noop */ }
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
      const state = taskInterface.stateName && taskInterface.stateType
        ? new ROSLIB.Topic({
          ros: slot.ros,
          name: taskInterface.stateName,
          messageType: taskInterface.stateType
        })
        : null;
      feedback.subscribe(message => this._handleTaskFeedback(slot.robotId, message, taskInterface.variant));
      result.subscribe(message => this._handleTaskResult(slot.robotId, message, taskInterface.variant));
      state?.subscribe(message => this._handleTaskState(slot.robotId, message));
      this._taskTelemetry = { feedback, result, state, slotIndex };
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
    const running = this._ensureRunningTask(robotId, taskId);
    running.state = state;
    running.missionIndex = Number(message.mission_idx ?? 0);
    running.actionIndex = this._flattenTaskActionIndex(
      running,
      running.missionIndex,
      Number(message.action_idx ?? 0)
    );
    running.loopCount = Number(message.loop_count ?? 0);
    if (rawState === 4) {
      this._taskCancelRequests.set(robotId, Date.now());
      running.state = 'cancel';
      this._syncActiveRunningTask();
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
    this._syncActiveRunningTask();
    this._setTaskExecutionFeedback(state, `${robotId} · ${taskId}`, parts.join(' · '));
  },

  _handleTaskState(robotId, message = {}) {
    const rawState = Number(message.data);
    if (!Number.isInteger(rawState) || rawState < 0) return;
    const running = this._runningTasks.get(robotId);
    if (rawState === 0) {
      const cancelRequestedAt = this._taskCancelRequests.get(robotId) || 0;
      const cancelCompleted = Date.now() - cancelRequestedAt < 60000;
      if (cancelCompleted) this._taskCancelRequests.delete(robotId);
      if (running) running.state = cancelCompleted ? 'cancel' : 'idle';
      this._syncActiveRunningTask();
      this._setTaskExecutionFeedback(
        'idle',
        cancelCompleted ? `${robotId} · Task 취소 완료 · IDLE` : `${robotId} · Task 대기 · IDLE`
      );
      return;
    }
    const states = ['idle', 'work', 'complete', 'pause', 'cancel', 'abort', 'recovery'];
    const state = states[rawState] || 'work';
    if (rawState === 4 && !this._taskCancelRequests.has(robotId)) {
      this._taskCancelRequests.set(robotId, Date.now());
    }
    if (running) running.state = state;
    this._syncActiveRunningTask();
    const labels = {
      work: 'Task 실행 중',
      complete: 'Task 완료 처리 중',
      pause: 'Task 일시정지',
      cancel: 'Task 취소 처리 중',
      abort: 'Task 중단 처리 중',
      recovery: 'Task 복구 중'
    };
    this._setTaskExecutionFeedback(state, `${robotId} · ${labels[state] || `Task state ${rawState}`}`);
  },

  _handleTaskResult(robotId, message = {}, variant = 'spx') {
    const success = Boolean(message.success);
    const cancelRequestedAt = this._taskCancelRequests.get(robotId) || 0;
    const cancelRequested = Date.now() - cancelRequestedAt < 60000;
    const cancelMessage = /cancel|취소/i.test(String(message.message || ''));
    if (!success && (cancelRequested || cancelMessage)) {
      this._taskCancelRequests.delete(robotId);
      const cancelled = this._ensureRunningTask(robotId, message.task_id || 'Task');
      cancelled.state = 'cancel';
      this._syncActiveRunningTask();
      this._setTaskExecutionFeedback(
        'idle',
        `${robotId} · ${message.task_id || 'Task'} · 취소됨`
      );
      return;
    }
    this._taskCancelRequests.delete(robotId);
    const running = this._ensureRunningTask(robotId, message.task_id || 'Task');
    running.state = success ? 'complete' : 'abort';
    if (success && running.queue.length > 0) running.actionIndex = running.queue.length - 1;
    this._syncActiveRunningTask();
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

  _loadTaskInterfaceModes() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.TASK_INTERFACE_MODE_KEY) || '{}');
      this._taskInterfaceModes = stored && typeof stored === 'object' && !Array.isArray(stored)
        ? stored
        : {};
    } catch (error) {
      this._taskInterfaceModes = {};
      console.warn('Task 인터페이스 선택값 불러오기 실패:', error.message);
    }
  },

  _taskInterfaceKey(slot) {
    return String(slot?.robotId || slot?.ip || '').replace(/^\//, '') || 'default';
  },

  _normalizeTaskInterfaceMode(mode) {
    return ['auto', 'spx', 'legacy'].includes(mode) ? mode : 'auto';
  },

  _getTaskInterfaceMode(slot) {
    return this._normalizeTaskInterfaceMode(
      this._taskInterfaceModes?.[this._taskInterfaceKey(slot)]
    );
  },

  _setTaskInterfaceMode(slot, mode, persist = true) {
    const normalized = this._normalizeTaskInterfaceMode(mode);
    this._taskInterfaceModes = this._taskInterfaceModes || {};
    this._taskInterfaceModes[this._taskInterfaceKey(slot)] = normalized;
    if (persist) {
      try {
        localStorage.setItem(
          this.TASK_INTERFACE_MODE_KEY,
          JSON.stringify(this._taskInterfaceModes)
        );
      } catch (error) {
        console.warn('Task 인터페이스 선택값 저장 실패:', error.message);
      }
    }
    return normalized;
  },

  _taskInterfaceLabel(taskInterface) {
    if (taskInterface?.protocol === 'ros2_spx') return 'SPX ROS2';
    if (taskInterface?.protocol === 'ros1_spx') return 'SPX ROS1';
    if (taskInterface?.protocol === 'ros1_legacy') return 'Legacy (TARU)';
    return '미검증';
  },

  _setTaskInterfaceStatus(state, message) {
    const status = document.getElementById('task-interface-status');
    if (!status) return;
    status.dataset.state = state;
    status.textContent = message;
  },

  _setupTaskInterfaceSelector() {
    const select = document.getElementById('task-interface-mode');
    if (!select || select.dataset.bound === 'true') return;
    select.dataset.bound = 'true';
    select.addEventListener('change', async () => {
      const slot = App.robotSlots?.[this.getTargetSlot()];
      if (!slot?.connected || !slot.ros) {
        select.value = 'auto';
        this._setTaskInterfaceStatus('idle', '로봇 연결 대기');
        return;
      }
      const previousMode = this._getTaskInterfaceMode(slot);
      const requestedMode = this._normalizeTaskInterfaceMode(select.value);
      const token = ++this._taskInterfaceUiToken;
      this._setTaskInterfaceMode(slot, requestedMode, false);
      delete slot.taskInterface;
      delete slot.taskInterfaceModeResolved;
      this._setTaskInterfaceStatus('checking', '서비스 확인 중…');
      try {
        const taskInterface = await this._resolveTaskInterface(slot, { forceDiscovery: true });
        if (token !== this._taskInterfaceUiToken) return;
        this._setTaskInterfaceMode(slot, requestedMode, true);
        const label = this._taskInterfaceLabel(taskInterface);
        this._setTaskInterfaceStatus(
          'ready',
          requestedMode === 'auto' ? `자동 선택: ${label}` : `${label} 고정`
        );
        App.toast?.(`Task 인터페이스: ${label}`, 'success');
        this._subscribeTaskTelemetry();
      } catch (error) {
        if (token !== this._taskInterfaceUiToken) return;
        this._setTaskInterfaceMode(slot, previousMode, false);
        delete slot.taskInterface;
        delete slot.taskInterfaceModeResolved;
        select.value = previousMode;
        this._setTaskInterfaceStatus('error', error.message || String(error));
        App.toast?.(error.message || String(error), 'error');
      }
    });
    this._syncTaskInterfaceSelector();
  },

  _syncTaskInterfaceSelector() {
    const select = document.getElementById('task-interface-mode');
    if (!select) return;
    const slot = App.robotSlots?.[this.getTargetSlot()];
    const connected = Boolean(slot?.connected && slot.ros);
    const mode = this._getTaskInterfaceMode(slot);
    select.disabled = !connected;
    select.value = mode;
    const token = ++this._taskInterfaceUiToken;
    if (!connected) {
      this._setTaskInterfaceStatus('idle', '로봇 연결 대기');
      return;
    }
    this._setTaskInterfaceStatus('checking', '서비스 확인 중…');
    this._resolveTaskInterface(slot).then(taskInterface => {
      if (token !== this._taskInterfaceUiToken) return;
      if (slot !== App.robotSlots?.[this.getTargetSlot()]) return;
      if (mode !== this._getTaskInterfaceMode(slot)) return;
      const label = this._taskInterfaceLabel(taskInterface);
      this._setTaskInterfaceStatus(
        'ready',
        mode === 'auto' ? `자동 선택: ${label}` : `${label} 고정`
      );
    }).catch(error => {
      if (token === this._taskInterfaceUiToken) {
        this._setTaskInterfaceStatus('error', error.message || String(error));
      }
    });
  },

  _cacheTaskInterface(slot, taskInterface, mode) {
    slot.taskInterface = { ...taskInterface };
    slot.taskInterfaceModeResolved = mode;
    return slot.taskInterface;
  },

  async _resolveTaskInterface(slot, options = {}) {
    if (!slot?.robotId || !slot.ros) {
      throw new Error('Task 인터페이스를 확인할 로봇 연결이 없습니다.');
    }
    if (typeof RobotCompatibility === 'undefined') {
      throw new Error('중앙 호환성 검사기를 사용할 수 없어 Task 제어를 차단했습니다.');
    }
    const mode = this._getTaskInterfaceMode(slot);
    if (!options.forceDiscovery && slot.taskInterface && (
      slot.taskInterfaceModeResolved === mode ||
      (!slot.taskInterfaceModeResolved && mode === 'auto')
    )) {
      slot.taskInterfaceModeResolved = mode;
      return slot.taskInterface;
    }
    const profile = options.forceDiscovery
      ? await RobotCompatibility.discover(slot, { force: true })
      : (slot.compatibilityPromise
        ? await slot.compatibilityPromise
        : (RobotCompatibility.get(slot).discovered
          ? RobotCompatibility.get(slot)
          : await RobotCompatibility.discover(slot)));
    if (!profile?.discovered) {
      throw new Error(`Task 제어 차단: ${profile?.reason || 'ROS graph 검증 실패'}`);
    }
    const adapters = profile.task?.adapters || {};
    let selected = profile.task;
    if (mode === 'legacy') selected = adapters.ros1_legacy;
    if (mode === 'spx') selected = adapters.ros2_spx || adapters.ros1_spx;
    if (!selected?.verified || !selected.goalName || !selected.goalType) {
      const requested = mode === 'auto' ? '지원 Task' : (mode === 'spx' ? 'SPX' : 'Legacy (TARU)');
      throw new Error(`${requested} endpoint/type이 실제 ROS graph에서 검증되지 않았습니다.`);
    }
    return this._cacheTaskInterface(slot, selected, mode);
  },

  _callTaskService(ros, name, serviceType, args, timeoutMs = 0) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        callback(value);
      };
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const error = new Error(`${name} 응답 시간 초과 (${timeoutMs}ms)`);
          error.code = 'TASK_CONTROL_TIMEOUT';
          finish(reject, error);
        }, timeoutMs);
      }
      const service = new ROSLIB.Service({ ros, name, serviceType });
      service.callService(
        new ROSLIB.ServiceRequest(args || {}),
        result => finish(resolve, result),
        error => finish(reject, new Error(String(error || `${name} 호출 실패`)))
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
          missionId: this._normalizeMissionId(item?.missionId),
          missionIndex: hasMissionIndex ? item.missionIndex : null,
          actions: []
        };
        groups.push(group);
        if (!hasMissionIndex) fallbackGroup = group;
      }
      group.actions.push(item);
    });
    return groups.length > 0 ? groups : [{ missionId: '1', missionIndex: null, actions: [] }];
  },

  _normalizeMissionId(value, fallback = '1') {
    const text = String(value ?? '').trim();
    return text || fallback;
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
    this._actionArgDefinitions(actionType).forEach((arg, idx) => {
      const input = document.getElementById(`action-arg-${idx}`);
      args.push(arg.type === 'bool'
        ? (input?.checked ? 1 : 0)
        : (input ? input.value : arg.default));
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
        if (!input) return;
        const definition = this._actionArgDefinitions(actionType, saved.args)[idx];
        if (definition?.type === 'bool') input.checked = Number(value) !== 0;
        else input.value = value;
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
  _simulateTestModeAction(actions, _robotId) {
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
