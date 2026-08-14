const RobotCompatibility = require('../public/js/robot-compatibility');
const fs = require('fs');
const path = require('path');

describe('RobotCompatibility runtime profiles', () => {
  test('allows slower ROS graph discovery through an SSH tunnel', () => {
    expect(RobotCompatibility._discoveryTimeout({ tunnelMode: true })).toBe(6000);
    expect(RobotCompatibility._discoveryTimeout({ tunnelMode: false })).toBe(2500);
  });

  test('exposes automatic and manual Task interface selection', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

    expect(html).toContain('id="task-interface-mode"');
    expect(html).toContain('<option value="auto">자동 감지</option>');
    expect(html).toContain('<option value="spx">SPX</option>');
    expect(html).toContain('<option value="legacy">Legacy (TARU)</option>');
    expect(html).toContain('id="task-interface-status"');
  });

  test.each(['stl1000w', 'stl1500w'])('detects %s as stl_ulsan with map, lift, turntable, and legacy Task interfaces', robotModel => {
    const slot = { robotId: 'R_013', robotModel };
    const ns = '/R_013';
    const services = [
      `${ns}/save_map`, `${ns}/change_map`, `${ns}/static_map`,
      `${ns}/slam_toolbox/serialize_map`,
      `${ns}/amcl/change_map`, `${ns}/Lift/cmd`, `${ns}/Lift/cancel`,
      `${ns}/Turntable/cmd`, `${ns}/Turntable/cancel`, `${ns}/Turntable/sync_mode`,
      `${ns}/TARU/goal`
    ];
    const topics = [
      `${ns}/map`, `${ns}/sp_routine`, `${ns}/spcore/MODE`,
      `${ns}/Lift/feedback`, `${ns}/TARU/feedback`, `${ns}/TARU/result`,
      `${ns}/taru_state`
    ];
    const profile = RobotCompatibility._buildProfile(slot, services, topics, {
      [`${ns}/save_map`]: 'syscon_msgs/SaveMap',
      [`${ns}/slam_toolbox/serialize_map`]: 'slam_toolbox_msgs/SerializePoseGraph',
      [`${ns}/change_map`]: 'map_server/LoadMap',
      [`${ns}/amcl/change_map`]: 'syscon_msgs/ChangeMap',
      [`${ns}/Lift/cmd`]: 'syscon_msgs/lift_cmd',
      [`${ns}/Lift/cancel`]: 'syscon_msgs/string_srv',
      [`${ns}/Turntable/cmd`]: 'syscon_msgs/turntable_cmd',
      [`${ns}/Turntable/cancel`]: 'syscon_msgs/string_srv',
      [`${ns}/Turntable/sync_mode`]: 'std_srvs/SetBool',
      [`${ns}/TARU/goal`]: 'sp_task/TaskGoal'
    });

    expect(profile.id).toBe('stl_ulsan');
    expect(profile.project).toBe('stl_ulsan');
    expect(profile.map).toMatchObject({
      topic: '/R_013/map',
      saveType: 'syscon_msgs/SaveMap',
      saveUsesName: false,
      baseName: 'map',
      directory: '/home/syscon/ROS_DB/map',
      poseGraphSaveService: '/R_013/slam_toolbox/serialize_map',
      reloadService: '/R_013/change_map',
      reloadType: 'map_server/LoadMap',
      managesRosNodes: true
    });
    expect(RobotCompatibility.mapSaveRequest(profile, 'ignored_name')).toEqual({
      save_in_db: true
    });
    expect(RobotCompatibility.mapPoseGraphSaveRequest(profile)).toEqual({
      filename: '/home/syscon/ROS_DB/map/map'
    });
    expect(RobotCompatibility.mapReloadRequest(profile, '/maps/map.yaml')).toEqual({
      map_url: '/maps/map.yaml'
    });
    expect(profile.lift).toMatchObject({
      interface: 'service',
      service: '/R_013/Lift/cmd',
      serviceType: 'syscon_msgs/lift_cmd',
      cancelService: '/R_013/Lift/cancel',
      cancelType: 'syscon_msgs/string_srv',
      commands: { stop: 0, up: 1, down: 2 }
    });
    expect(profile.actions.turntable).toMatchObject({
      enabled: true,
      argCount: 3,
      asyncModeArg: true,
      service: '/R_013/Turntable/cmd',
      serviceType: 'syscon_msgs/turntable_cmd',
      cancelService: '/R_013/Turntable/cancel',
      feedbackTopic: '/R_013/Turntable/feedback',
      syncService: '/R_013/Turntable/sync_mode',
      syncType: 'std_srvs/SetBool'
    });
    expect(profile.task).toMatchObject({
      variant: 'sp_task',
      goalName: '/R_013/TARU/goal',
      goalType: 'sp_task/TaskGoal',
      feedbackName: '/R_013/TARU/feedback',
      resultName: '/R_013/TARU/result',
      stateName: '/R_013/taru_state',
      stateType: 'std_msgs/Int32'
    });
  });

  test('does not infer stl_ulsan from matching ROS services when ROBOT_MODEL differs', () => {
    const ns = '/R_099';
    const profile = RobotCompatibility._buildProfile(
      { robotId: 'R_099', robotModel: 'sr5' },
      [`${ns}/save_map`, `${ns}/change_map`, `${ns}/Lift/cmd`, `${ns}/Turntable/cmd`],
      [`${ns}/map`],
      {
        [`${ns}/save_map`]: 'syscon_msgs/SaveMap',
        [`${ns}/Lift/cmd`]: 'syscon_msgs/lift_cmd',
        [`${ns}/Turntable/cmd`]: 'syscon_msgs/turntable_cmd'
      }
    );

    expect(profile.id).toBe('scorpion_service_lift');
    expect(profile.project).toBeNull();
    expect(profile.actions.turntable).toMatchObject({
      enabled: false,
      argCount: 2,
      asyncModeArg: false
    });
    expect(RobotCompatibility.isStlUlsanModel('STL1500W')).toBe(true);
    expect(RobotCompatibility.isStlUlsanModel('stl1500w_dev')).toBe(false);
  });

  test('keeps known stl_ulsan Lift and three-arg Turntable defaults before ROS discovery', () => {
    const profile = RobotCompatibility._defaultProfile({
      robotId: 'R_051',
      robotModel: 'stl1000w'
    });

    expect(profile.id).toBe('stl_ulsan');
    expect(profile.lift).toMatchObject({
      interface: 'service',
      service: '/R_051/Lift/cmd',
      cancelService: '/R_051/Lift/cancel',
      commands: { stop: 0, up: 1, down: 2 }
    });
    expect(profile.actions.turntable).toMatchObject({
      argCount: 3,
      asyncModeArg: true
    });
  });

  test('preserves the existing topic lift and fixes legacy saves to map', () => {
    const profile = RobotCompatibility._buildProfile(
      { robotId: 'R_001' },
      ['/R_001/TARU/goal'],
      ['/R_001/map', '/R_001/Lift/manual_cmd'],
      { '/R_001/TARU/goal': 'sp_task/TaskGoal' }
    );

    expect(profile.id).toBe('scorpion_legacy');
    expect(profile.lift).toMatchObject({
      interface: 'topic',
      topic: '/R_001/Lift/manual_cmd',
      commands: { stop: 0, up: 1, down: -1 }
    });
    expect(profile.actions.turntable).toMatchObject({
      enabled: false,
      argCount: 2,
      asyncModeArg: false
    });
    expect(RobotCompatibility.mapSaveRequest(profile, 'site_map')).toEqual({
      data: 'map'
    });
  });

  test('selects SPX Task only when its goal service is actually present', () => {
    const profile = RobotCompatibility._buildProfile(
      { robotId: 'R_009' },
      ['/R_009/spx/task/goal'],
      ['/R_009/map'],
      { '/R_009/spx/task/goal': 'spx_task_msgs/TaskGoal' }
    );

    expect(profile.task).toMatchObject({
      variant: 'spx',
      goalName: '/R_009/spx/task/goal',
      feedbackName: '/R_009/spx/task/feedback',
      resultName: '/R_009/spx/task/result'
    });
  });
});
