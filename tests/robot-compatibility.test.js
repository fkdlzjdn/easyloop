const fs = require('fs');
const path = require('path');
const RobotCompatibility = require('../public/js/robot-compatibility');

function endpointMaps(entries) {
  return Object.fromEntries(entries);
}

function legacyFixture(rid = 'R_001', projectHint = 'sr300_wia') {
  const ns = `/${rid}`;
  const services = [
    `${ns}/TARU/goal`, `${ns}/TARU/pause`, `${ns}/TARU/resume`, `${ns}/TARU/cancel`,
    `${ns}/save_map`, `${ns}/change_map`, `${ns}/amcl/change_map`
  ];
  const topics = [
    `${ns}/TARU/feedback`, `${ns}/TARU/result`, `${ns}/taru_state`,
    `${ns}/sp_routine`, `${ns}/spcore/MODE`, `${ns}/map`, `${ns}/cmd_vel`,
    `${ns}/Lift/manual_cmd`, `${ns}/bms`, `${ns}/robot_state`, `${ns}/odom`
  ];
  const serviceTypes = endpointMaps([
    [`${ns}/TARU/goal`, 'sp_task/TaskGoal'],
    [`${ns}/TARU/pause`, 'sp_task/Int32_srv'],
    [`${ns}/TARU/resume`, 'sp_task/Int32_srv'],
    [`${ns}/TARU/cancel`, 'sp_task/String_srv'],
    [`${ns}/save_map`, 'syscon_msgs/String_srv'],
    [`${ns}/change_map`, 'map_server/LoadMap'],
    [`${ns}/amcl/change_map`, 'syscon_msgs/ChangeMap']
  ]);
  const topicTypes = endpointMaps([
    [`${ns}/TARU/feedback`, 'sp_task/Feedback'],
    [`${ns}/TARU/result`, 'sp_task/Result'],
    [`${ns}/taru_state`, 'std_msgs/Int32'],
    [`${ns}/sp_routine`, 'std_msgs/String'],
    [`${ns}/spcore/MODE`, 'std_msgs/String'],
    [`${ns}/map`, 'nav_msgs/OccupancyGrid'],
    [`${ns}/cmd_vel`, 'geometry_msgs/Twist'],
    [`${ns}/Lift/manual_cmd`, 'std_msgs/Int8'],
    [`${ns}/bms`, 'std_msgs/Float32MultiArray'],
    [`${ns}/robot_state`, 'syscon_msgs/RobotState'],
    [`${ns}/odom`, 'nav_msgs/Odometry']
  ]);
  return {
    slot: { robotId: rid, projectHint }, services, topics, serviceTypes, topicTypes
  };
}

function spxFixture({ rid = 'R_009', rosMajor = 1, includeLegacy = false } = {}) {
  const ns = `/${rid}`;
  const suffix = rosMajor === 2 ? {
    goal: 'spx_task_msgs/srv/TaskGoal', pause: 'spx_task_msgs/srv/TaskPause',
    resume: 'spx_task_msgs/srv/TaskResume', cancel: 'spx_task_msgs/srv/TaskCancel',
    feedback: 'spx_task_msgs/msg/TaskFeedback', result: 'spx_task_msgs/msg/TaskResult',
    mode: 'spx_robot_msgs/srv/SetMode', string: 'std_msgs/msg/String',
    map: 'nav_msgs/msg/OccupancyGrid', twist: 'geometry_msgs/msg/Twist',
    save: 'spx_mapping_msgs/srv/SaveMap'
  } : {
    goal: 'spx_task_msgs/TaskGoal', pause: 'spx_task_msgs/TaskPause',
    resume: 'spx_task_msgs/TaskResume', cancel: 'spx_task_msgs/TaskCancel',
    feedback: 'spx_task_msgs/TaskFeedback', result: 'spx_task_msgs/TaskResult',
    mode: 'spx_msgs/SetMode', string: 'std_msgs/String',
    map: 'nav_msgs/OccupancyGrid', twist: 'geometry_msgs/Twist',
    save: 'spx_msgs/SaveMap'
  };
  const services = [
    `${ns}/spx/task/goal`, `${ns}/spx/task/pause`, `${ns}/spx/task/resume`,
    `${ns}/spx/task/cancel`, `${ns}/spx/set_mode`, `${ns}/save_map`
  ];
  const topics = [
    `${ns}/spx/task/feedback`, `${ns}/spx/task/result`, `${ns}/spx/operation_mode`,
    `${ns}/map`, `${ns}/cmd_vel`
  ];
  const serviceTypes = endpointMaps([
    [`${ns}/spx/task/goal`, suffix.goal],
    [`${ns}/spx/task/pause`, suffix.pause],
    [`${ns}/spx/task/resume`, suffix.resume],
    [`${ns}/spx/task/cancel`, suffix.cancel],
    [`${ns}/spx/set_mode`, suffix.mode],
    [`${ns}/save_map`, suffix.save]
  ]);
  const topicTypes = endpointMaps([
    [`${ns}/spx/task/feedback`, suffix.feedback],
    [`${ns}/spx/task/result`, suffix.result],
    [`${ns}/spx/operation_mode`, suffix.string],
    [`${ns}/map`, suffix.map],
    [`${ns}/cmd_vel`, suffix.twist]
  ]);
  if (includeLegacy) {
    services.push(`${ns}/TARU/goal`, `${ns}/TARU/pause`, `${ns}/TARU/resume`, `${ns}/TARU/cancel`);
    Object.assign(serviceTypes, {
      [`${ns}/TARU/goal`]: 'sp_task/TaskGoal',
      [`${ns}/TARU/pause`]: 'sp_task/Int32_srv',
      [`${ns}/TARU/resume`]: 'sp_task/Int32_srv',
      [`${ns}/TARU/cancel`]: 'sp_task/String_srv'
    });
  }
  return { slot: { robotId: rid }, services, topics, serviceTypes, topicTypes };
}

function build(fixture) {
  return RobotCompatibility._buildProfile(
    fixture.slot,
    fixture.services,
    fixture.topics,
    fixture.serviceTypes,
    fixture.topicTypes
  );
}

describe('RobotCompatibility four-generation runtime profiles', () => {
  test('catalog contains exactly the supported 13/24/4/1 projects', () => {
    expect(RobotCompatibility.PROJECT_GENERATIONS.map(item => item.projects.length))
      .toEqual([13, 24, 4, 1]);
    expect(RobotCompatibility.projectGeneration('FAE_template')).toBeNull();
    expect(RobotCompatibility.projectGeneration('sr2_pilot_ws')).toBeNull();
    expect(RobotCompatibility.projectGeneration('stl_ulsan').id).toBe('core_submodule');
  });

  test('allows slower ROS graph discovery through an SSH tunnel', () => {
    expect(RobotCompatibility._discoveryTimeout({ tunnelMode: true })).toBe(6000);
    expect(RobotCompatibility._discoveryTimeout({ tunnelMode: false })).toBe(2500);
  });

  test('pure legacy graph selects verified ros1_legacy adapters', () => {
    const profile = build(legacyFixture());
    expect(profile).toMatchObject({ id: 'ros1_legacy', discovered: true, controlReady: true });
    expect(profile.lineage.id).toBe('legacy');
    expect(profile.task).toMatchObject({
      verified: true,
      protocol: 'ros1_legacy',
      goalType: 'sp_task/TaskGoal',
      cancelType: 'sp_task/String_srv'
    });
    expect(profile.mapping).toMatchObject({
      verified: true,
      protocol: 'ros1_legacy',
      commandInterface: 'topic'
    });
    expect(profile.lift).toMatchObject({
      verified: true,
      interface: 'topic',
      topicType: 'std_msgs/Int8'
    });
    expect(profile.chassis.drive).toMatchObject({ verified: true, type: 'geometry_msgs/Twist' });
  });

  test('core-submodule lineage can use the same TARU runtime protocol', () => {
    const fixture = legacyFixture('R_020', 'sr5_stator');
    const profile = build(fixture);
    expect(profile.lineage.id).toBe('core_submodule');
    expect(profile.task.protocol).toBe('ros1_legacy');
  });

  test('ROS1 SPX is preferred when native SPX and TARU both exist', () => {
    const profile = build(spxFixture({ includeLegacy: true }));
    expect(profile.id).toBe('ros1_spx');
    expect(profile.task.protocol).toBe('ros1_spx');
    expect(profile.task.adapters).toEqual(expect.objectContaining({
      ros1_spx: expect.objectContaining({ verified: true }),
      ros1_legacy: expect.objectContaining({ verified: true })
    }));
  });

  test('ROS2 endpoint spelling selects ros2_spx without confusing it with ROS1', () => {
    const profile = build(spxFixture({ rosMajor: 2 }));
    expect(profile).toMatchObject({
      id: 'ros2_spx',
      transport: { available: true, rosMajor: 2, protocol: 'ros2_spx' }
    });
    expect(profile.task).toMatchObject({ protocol: 'ros2_spx', goalType: 'spx_task_msgs/srv/TaskGoal' });
    expect(profile.mapping.commandType).toBe('spx_robot_msgs/srv/SetMode');
    expect(profile.map.saveType).toBe('spx_mapping_msgs/srv/SaveMap');
    expect(RobotCompatibility.mapSaveRequest(profile)).toEqual({ save_in_db: true });
  });

  test('mixed graph selects task, mode, and map independently', () => {
    const fixture = legacyFixture('R_030', 'sr3_dilli');
    const ns = '/R_030';
    fixture.services.push(`${ns}/spx/set_mode`);
    fixture.topics.push(`${ns}/spx/operation_mode`);
    fixture.serviceTypes[`${ns}/spx/set_mode`] = 'spx_msgs/SetMode';
    fixture.topicTypes[`${ns}/spx/operation_mode`] = 'std_msgs/String';
    const profile = build(fixture);
    expect(profile.task.protocol).toBe('ros1_legacy');
    expect(profile.mapping.protocol).toBe('ros1_spx');
    expect(profile.map.saveType).toBe('syscon_msgs/String_srv');
  });

  test('keeps the verified map output primary and records slam_toolbox map as a candidate', () => {
    const fixture = legacyFixture('R_013', 'stl_ulsan');
    const toolboxMap = '/R_013/slam_toolbox/map';
    fixture.topics.push(toolboxMap);
    fixture.topicTypes[toolboxMap] = 'nav_msgs/OccupancyGrid';

    const profile = build(fixture);

    expect(profile.map.topic).toBe('/R_013/map');
    expect(profile.map.mappingTopic).toBe('/R_013/map');
    expect(profile.map.mappingTopicCandidates).toEqual([
      '/R_013/map',
      toolboxMap
    ]);
  });

  test('type mismatch is fail-closed even when endpoint name exists', () => {
    const fixture = spxFixture();
    fixture.serviceTypes['/R_009/spx/task/goal'] = 'wrong_pkg/TaskGoal';
    const profile = build(fixture);
    expect(profile.task.verified).toBe(false);
    expect(profile.task.goalName).toBeNull();
    expect(profile.task.adapters).toEqual({});
  });

  test('manual protocol choice can only use an adapter present in verified graph', () => {
    const profile = build(legacyFixture());
    expect(profile.task.adapters.ros1_legacy.verified).toBe(true);
    expect(profile.task.adapters.ros1_spx).toBeUndefined();
    expect(profile.task.adapters.ros2_spx).toBeUndefined();
  });

  test.each(['stl1000w', 'stl1500w'])('%s without Lift/Turntable endpoint stays blocked', robotModel => {
    const fixture = legacyFixture('R_051', 'stl_ulsan');
    fixture.slot.robotModel = robotModel;
    const profile = build(fixture);
    expect(profile.project).toBe('stl_ulsan');
    expect(profile.lift.interface).toBe('topic');
    expect(profile.actions.turntable).toMatchObject({ verified: false, enabled: false });
  });

  test('STL controls are enabled only when model hint and graph types are both valid', () => {
    const fixture = legacyFixture('R_051', 'stl_ulsan');
    const ns = '/R_051';
    fixture.slot.robotModel = 'stl1500w';
    fixture.services.push(
      `${ns}/Lift/cmd`, `${ns}/Lift/cancel`, `${ns}/Turntable/cmd`,
      `${ns}/Turntable/cancel`, `${ns}/Turntable/sync_mode`
    );
    fixture.topics.push(`${ns}/Lift/feedback`, `${ns}/Turntable/feedback`);
    Object.assign(fixture.serviceTypes, {
      [`${ns}/Lift/cmd`]: 'syscon_msgs/lift_cmd',
      [`${ns}/Lift/cancel`]: 'syscon_msgs/string_srv',
      [`${ns}/Turntable/cmd`]: 'syscon_msgs/turntable_cmd',
      [`${ns}/Turntable/cancel`]: 'syscon_msgs/string_srv',
      [`${ns}/Turntable/sync_mode`]: 'std_srvs/SetBool'
    });
    Object.assign(fixture.topicTypes, {
      [`${ns}/Lift/feedback`]: 'syscon_msgs/LiftFeedback',
      [`${ns}/Turntable/feedback`]: 'syscon_msgs/LiftFeedback'
    });
    const profile = build(fixture);
    expect(profile.lift).toMatchObject({ verified: true, interface: 'service' });
    expect(profile.actions.turntable).toMatchObject({
      verified: true, enabled: true, argCount: 3, asyncModeArg: true
    });
  });

  test('discovery error returns an unavailable profile and never a legacy control default', async () => {
    const slot = { robotId: 'R_FAIL', ros: {} };
    const spy = jest.spyOn(RobotCompatibility, '_discover').mockRejectedValue(new Error('rosapi timeout'));
    const profile = await RobotCompatibility.discover(slot, { force: true });
    expect(profile).toMatchObject({ discovered: false, controlReady: false, id: 'unverified' });
    expect(profile.task.goalName).toBeNull();
    expect(profile.reason).toContain('rosapi timeout');
    spy.mockRestore();
  });

  test('keeps a verified profile when a same-connection refresh times out', async () => {
    const slot = { robotId: 'R_CACHE', ros: {} };
    const verified = build(legacyFixture('R_CACHE'));
    slot.compatibilityProfile = verified;
    const spy = jest.spyOn(RobotCompatibility, '_discover')
      .mockRejectedValue(new Error('/rosapi/services timeout'));

    const profile = await RobotCompatibility.discover(slot, { force: true });

    expect(profile.discovered).toBe(true);
    expect(profile.chassis.drive).toMatchObject({
      verified: true,
      topic: '/R_CACHE/cmd_vel',
      topicType: 'geometry_msgs/Twist'
    });
    expect(profile.discoveryWarning).toContain('/rosapi/services timeout');
    spy.mockRestore();
    RobotCompatibility.clear(slot);
  });

  test('service-list timeout does not block a verified cmd_vel topic', async () => {
    const slot = { robotId: 'R_003', ros: {} };
    const originalRosapi = RobotCompatibility._rosapi;
    RobotCompatibility._rosapi = jest.fn(async (_ros, name, _type, args) => {
      if (name === '/rosapi/services') throw new Error('/rosapi/services timeout');
      if (name === '/rosapi/topics') {
        return { topics: ['/R_003/cmd_vel', '/R_003/robot_state', '/R_003/odom'] };
      }
      if (name === '/rosapi/topic_type') {
        const types = {
          '/R_003/cmd_vel': 'geometry_msgs/Twist',
          '/R_003/robot_state': 'syscon_msgs/RobotState',
          '/R_003/odom': 'nav_msgs/Odometry'
        };
        return { type: types[args.topic] || '' };
      }
      if (name === '/rosapi/get_param') throw new Error('param unavailable');
      throw new Error(`unexpected ${name}`);
    });

    try {
      const profile = await RobotCompatibility._discover(slot);
      expect(profile).toMatchObject({ discovered: true, controlReady: true });
      expect(profile.chassis.drive).toMatchObject({
        verified: true,
        topic: '/R_003/cmd_vel',
        topicType: 'geometry_msgs/Twist'
      });
      expect(profile.discoveryWarnings).toContain('services: /rosapi/services timeout');
    } finally {
      RobotCompatibility._rosapi = originalRosapi;
    }
  });

  test('stale discovery response cannot overwrite a reconnect profile', async () => {
    const slot = { robotId: 'R_STALE', ros: { id: 1 } };
    let resolveOld;
    const oldResponse = new Promise(resolve => { resolveOld = resolve; });
    const oldProfile = { ...RobotCompatibility._defaultProfile(slot), id: 'old', discovered: true };
    const newProfile = { ...RobotCompatibility._defaultProfile(slot), id: 'new', discovered: true };
    const spy = jest.spyOn(RobotCompatibility, '_discover')
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(newProfile);
    const oldRequest = RobotCompatibility.discover(slot, { force: true });
    RobotCompatibility.clear(slot);
    slot.ros = { id: 2 };
    const newRequest = RobotCompatibility.discover(slot, { force: true });
    await newRequest;
    resolveOld(oldProfile);
    await oldRequest;
    expect(slot.compatibilityProfile.id).toBe('new');
    spy.mockRestore();
  });

  test('map request normalizers require verified adapters', () => {
    const profile = build(legacyFixture());
    expect(RobotCompatibility.mapSaveRequest(profile)).toEqual({ data: 'map' });
    expect(RobotCompatibility.mapReloadRequest(profile, '/maps/map.yaml'))
      .toEqual({ map_url: '/maps/map.yaml' });
    expect(() => RobotCompatibility.mapReloadRequest(
      RobotCompatibility._defaultProfile({ robotId: 'R_X' }), '/maps/map.yaml'
    )).toThrow('검증되지 않았습니다');
  });

  test('map manager no longer calls TARU/change_map directly', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'map-file-manager.js'), 'utf8'
    );
    expect(source).not.toContain('/TARU/change_map');
    expect(source).toContain('RobotCompatibility.mapReloadRequest');
  });

  test('ROS2 rosapi prerequisite failure exposes transport error and no SSH control', async () => {
    const slot = { robotId: 'R_ROS2', ros: {} };
    const spy = jest.spyOn(RobotCompatibility, '_discover')
      .mockRejectedValue(new Error('ROS2 rosbridge/rosapi 미가동'));
    const profile = await RobotCompatibility.discover(slot, { force: true });
    expect(profile.transport.available).toBe(false);
    expect(profile.reason).toContain('rosbridge/rosapi');
    expect(profile.task.goalName).toBeNull();
    spy.mockRestore();
  });

  test('integration: ROSLIB rosapi snapshot selects exact ROS2 service/topic types', async () => {
    const fixture = spxFixture({ rid: 'R_BASE2', rosMajor: 2 });
    fixture.services.push('/spx/task/actions/info');
    fixture.serviceTypes['/spx/task/actions/info'] = 'spx_task_msgs/srv/GetActionsInfo';
    const calls = [];
    class ServiceRequest {
      constructor(values) { Object.assign(this, values); }
    }
    class Service {
      constructor(options) { this.options = options; }
      callService(request, success, failure) {
        calls.push({ options: this.options, request });
        if (this.options.name === '/rosapi/services') return success({ services: fixture.services });
        if (this.options.name === '/rosapi/topics') return success({ topics: fixture.topics });
        if (this.options.name === '/rosapi/service_type') {
          return success({ type: fixture.serviceTypes[request.service] || '' });
        }
        if (this.options.name === '/rosapi/topic_type') {
          return success({ type: fixture.topicTypes[request.topic] || '' });
        }
        if (this.options.name === '/spx/task/actions/info') {
          return success({
            success: true,
            actions: [
              { name: 'WaypointPlugin', type: 1, key: 'waypoint' },
              { name: 'BasicMovePlugin', type: 2, key: 'basic_move' },
              { name: 'StandByPlugin', type: 7, key: 'standby' }
            ]
          });
        }
        if (this.options.name === '/rosapi/get_param') {
          return success({
            value: request.name === '/R_BASE2/basic_settings/model_type' ? '"qd"' : '""'
          });
        }
        return failure('unexpected rosapi call');
      }
    }
    global.ROSLIB = { Service, ServiceRequest };
    const slot = { ...fixture.slot, ros: {} };
    try {
      const profile = await RobotCompatibility.discover(slot, { force: true });
      expect(profile.task).toMatchObject({
        verified: true,
        protocol: 'ros2_spx',
        goalType: 'spx_task_msgs/srv/TaskGoal'
      });
      expect(profile.chassis.drive.topicType).toBe('geometry_msgs/msg/Twist');
      expect(profile.task.actionCatalog).toMatchObject({
        attempted: true,
        verified: true,
        service: '/spx/task/actions/info',
        types: [1, 2, 7]
      });
      expect(profile.chassis.driveModel).toMatchObject({
        verified: true,
        kind: 'qd',
        actionModelType: 1,
        parameter: '/R_BASE2/basic_settings/model_type'
      });
      expect(calls.find(call => call.options.name === '/rosapi/get_param')?.options.serviceType)
        .toBe('rosapi/srv/GetParam');
      expect(calls.some(call => call.options.name === '/rosapi/service_type')).toBe(true);
      expect(calls.some(call => call.options.name === '/rosapi/topic_type')).toBe(true);
    } finally {
      delete global.ROSLIB;
      RobotCompatibility.clear(slot);
    }
  });

  test('Task interface selector remains available but is validated centrally', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    expect(html).toContain('<option value="auto">자동 감지</option>');
    expect(html).toContain('<option value="spx">SPX</option>');
    expect(html).toContain('<option value="legacy">Legacy (TARU)</option>');
  });
});
