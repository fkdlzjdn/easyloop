const Route = require('../public/js/ros2-route');
const RobotCompatibility = require('../public/js/robot-compatibility');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sample = require('./fixtures/r006-ros2-graph.json');
const options = { routeId: 'route-review', mapId: 'normal', robotId: 'R_025', points: [{ x: 1, y: 2, yaw: 0 }, { x: 3, y: 4, yaw: 0.5 }] };
function sender(profile) {
  const context = { App: { activeSlotIndex: 0, robotSlots: [{ robotId: 'R_025', connected: true, ros: {}, compatibilityProfile: profile }], toast: jest.fn() },
    Ros2Route: Route, RobotCompatibility, document: { addEventListener: jest.fn(), getElementById: () => null },
    console, setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: () => null, setItem: jest.fn() } };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/action-sender.js'), 'utf8');
  const value = vm.runInNewContext(source + '\nActionSender', context);
  value.getTargetSlot = () => 0;
  return { value, context };
}
const profile = () => ({ discovered: true, task: { protocol: 'ros2_spx', verified: true,
  actionCatalog: { attempted: true, verified: true, types: [48, 7], actions: [{ type: 48, key: 'route_navigation' }, { type: 7, key: 'standby' }] },
  routeContext: { schema: 'spx.route_contract.v2', mapId: 'normal', frameId: 'map', robot: { manufacturer: 'SysconRobotics', serial_number: 'R_025' } } },
  chassis: { driveModel: { verified: true, actionModelType: 0 } } });

describe('native ROS2 RouteNavigation contracts', () => {
  test.each([1, 2, 3])('accepts current ROS2 sensor type %p', scanType => {
    const { value } = sender(profile());
    const action = Route.action(Route.build(options));
    expect(() => value._validateActionWireShape({ action_type: 48, action_args: [1, 1, scanType], action_params: action.params }, profile())).not.toThrow();
  });
  test.each([0, 4, 5, 6, 7])('rejects old/unsupported ROS2 sensor type %p before sending', scanType => {
    const { value } = sender(profile());
    const action = Route.action(Route.build(options));
    expect(() => value._validateActionWireShape({ action_type: 48, action_args: [1, 1, scanType], action_params: action.params }, profile())).toThrow('scan_type');
  });
  test('cfg selection survives native Task conversion and mismatched sensor modes are rejected', async () => {
    const { value, context } = sender(profile());
    const route = Route.build(options);
    route.docking_parameters = { 'rack.cfg': 'cfg/docking_vri_charger.cfg' };
    const action = Route.action(route);
    const wire = { action_id: 'charge-review', action_type: 48, action_args: [1, 1, 1], action_params: action.params };
    const [prepared] = await value._prepareActionsForSlot([wire], context.App.robotSlots[0], { taskId: 'offline-charge-review' });
    expect(JSON.parse(prepared.action_params[0].value).docking_parameters).toEqual(route.docking_parameters);
    expect(prepared.action_args).toEqual([1, 1, 1]);
    expect(() => value._validateActionWireShape({ ...wire, action_args: [1, 1, 2] }, profile())).toThrow('rack.cfg');
  });
  test('robot-planned goals use CURRENT_ROBOT_POSE and no supplied geometry', () => {
    const route = Route.build({ ...options, pathSource: 'ROBOT_FREESPACE' });
    expect(route.nodes[0].pose).toBeUndefined();
    expect(route.nodes[0].pose_source).toBe('CURRENT_ROBOT_POSE');
    expect(route.edges[0].planner_request.backend).toBe('NAV2_FREESPACE');
    expect(route.edges[0].control_points).toBeUndefined();
    expect(Route.validate(route)).toBe(route);
  });
  test('provided lines use schema-correct control points and identities', () => {
    const route = Route.build({ ...options, pathSource: 'PROVIDED_TRAJECTORY' });
    expect(route.edges[0].control_points).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    expect(route.edges[0].degree).toBeUndefined();
    expect(route.edges[0].vda5050.end_node_sequence_id).toBe(2);
  });
  test('NURBS curve degree, weights and knots round-trip', () => {
    const route = Route.build({ ...options, geometry: 'NURBS', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 2 }] });
    expect(route.edges[0].degree).toBe(3);
    expect(route.edges[0].knot_vector).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(Route.parse(JSON.stringify(route))).toEqual(route);
  });
  test('invalid chains, unknown maps and incorrect control point endpoints are rejected', () => {
    const route = Route.build(options);
    const broken = Route.clone(route); broken.edges[0].end_node_id = 'missing';
    expect(() => Route.validate(broken)).toThrow('연결');
    const points = Route.clone(route); points.edges[0].control_points[1].x = 100;
    expect(() => Route.validate(points)).toThrow('일치');
    const action = Route.action(route); action.action_id = 'a'; action.action_params = action.params;
    expect(() => Route.bind(action, { taskId: 't', mapId: 'another' })).toThrow('Map');
  });
  test('task and action identity is rebound without mutating saved payloads', async () => {
    const { value, context } = sender(profile());
    const route = Route.action(Route.build(options));
    const original = JSON.stringify(route);
    const wire = { action_id: '경로-1', action_type: 48, action_args: [], action_params: route.params };
    const [prepared] = await value._prepareActionsForSlot([wire], context.App.robotSlots[0], { taskId: '새-작업' });
    const payload = JSON.parse(prepared.action_params[0].value);
    expect(payload.correlation).toMatchObject({ order_id: '새-작업', action_id: '경로-1', command_id: '경로-1' });
    expect(payload.contract_id).toContain('새-작업');
    expect(JSON.stringify(route)).toBe(original);
  });
  test('Quick Task produces RouteNavigation for both former WayPoint and trajectory inputs', () => {
    const { value } = sender(profile());
    const actions = value.compileQuickTaskItems([{ kind: 'waypoint', pose: { x: 1, y: 2, theta: 0 } },
      { kind: 'trajectory', points: [{ x: 1, y: 2 }, { x: 4, y: 5, theta: 0.5 }], trajectory: {} },
      { kind: 'standby', duration: 3 }]);
    expect(actions.map(action => Number(action.action_type || action.actionType))).toEqual([48, 48, 7]);
    expect(JSON.parse(actions[0].params[0].value).path_source).toBe('ROBOT_FREESPACE');
    expect(JSON.parse(actions[1].params[0].value).path_source).toBe('PROVIDED_TRAJECTORY');
  });
  test('native JSON survives EasyLoop Task YAML export and import', () => {
    const { value } = sender(profile());
    const native = Route.action(Route.build(options));
    const yaml = value.serializeTaskYaml([{ taskId: 'ROS2 경로', loopFlag: 1, queue: [{ ...native, name: 'route_1', missionId: '1' }] }]);
    const parsed = value.parseTaskYaml(yaml);
    const action = parsed[0].queue[0];
    expect(Number(action.actionType)).toBe(48);
    expect(Route.parse(action.params[0].value)).toEqual(Route.build(options));
  });
  test('ROS2 TaskSender rejects unsupported loop and multi-mission before making a service', async () => {
    const { value } = sender(profile());
    await expect(value._callTaskService({}, '/R_025/spx/task/goal', 'spx_task_msgs/srv/TaskGoal', { loop_flag: 0, missions: [] })).rejects.toThrow('Mission');
  });
  test('native Lift types are resolved without enabling unsupported actions', () => {
    const services = { ...sample.services, '/R_006/Lift/cmd': 'spx_device_msgs/srv/LiftCmd', '/R_006/Lift/cancel': 'spx_task_msgs/srv/StringSrv' };
    const topics = { ...sample.topics, '/R_006/Lift/feedback': 'spx_device_msgs/msg/LiftFeedback' };
    const p = RobotCompatibility._buildProfile({ robotId: 'R_006' }, Object.keys(services), Object.keys(topics), services, topics);
    expect(p.lift).toMatchObject({ verified: true, admission: 'auto', feedbackUnit: 'mm' });
  });
  test('missing model metadata never silently resolves to differential drive', () => {
    expect(RobotCompatibility._normalizeDriveModel(null)).toBeNull();
    expect(RobotCompatibility._normalizeDriveModel(false)).toBeNull();
  });
});

describe('ROS1 task migration review and changed ROS2 parameters', () => {
  test('legacy route coordinates and maximum speed migrate while unknown parameters are reviewed', () => {
    const old = { name: 'legacy_wp', actionType: '0x01', args: [2, 3, 0.5], params: [
      { param_name: 'max_trans_vel', type: 'float', value: '0.3' }, { param_name: 'xy_goal_tolerance', type: 'float', value: '0.1' },
      { param_name: 'backward_driving', type: 'bool', value: 'true' }] };
    const before = JSON.stringify(old);
    const conversion = Route.convertLegacy(old, { mapId: 'normal', robotId: 'R_025' });
    expect(conversion.action.params.find(param => param.param_name === 'maximum_speed_mps').value).toBe('0.3');
    expect(conversion.unmapped).toEqual(['xy_goal_tolerance']);
    expect(JSON.parse(conversion.action.params[0].value).edges[0].motion_direction).toBe('BACKWARD');
    expect(JSON.stringify(old)).toBe(before);
  });
  test('changed speed name is checked against the deployment maximum before wire transmission', async () => {
    const p = profile(); p.task.routeContext.maximumSpeed = 0.5;
    const { value, context } = sender(p);
    const action = Route.action(Route.build(options), 'r', { maximumSpeed: 0.6 });
    await expect(value._prepareActionsForSlot([{ action_type: 48, action_args: [], action_params: action.params }], context.App.robotSlots[0], { taskId: 't' })).rejects.toThrow('factsheet.maximum_speed');
  });
  test('old non-equivalent planner parameters are rejected in v2 instead of ignored', () => {
    const route = Route.build(options); route.max_trans_vel = 1;
    expect(() => Route.validate(route)).toThrow('max_trans_vel');
  });
});


describe('native ROS2 send guards', () => {
  test('route parameters are not silently ignored, and duplicate speed is rejected', async () => {
    const { value, context } = sender(profile());
    const make = () => ({ action_type: 48, action_args: [], action_params: Route.action(Route.build(options), 'r', { maximumSpeed: 0.3 }).params });
    const legacy = make(); legacy.action_params.push({ param_name: 'xy_goal_tolerance', type: 'float', value: '0.1' });
    await expect(value._prepareActionsForSlot([legacy], context.App.robotSlots[0], { taskId: 't' })).rejects.toThrow('xy_goal_tolerance');
    const duplicate = make(); duplicate.action_params.push({ ...duplicate.action_params[1] });
    await expect(value._prepareActionsForSlot([duplicate], context.App.robotSlots[0], { taskId: 't' })).rejects.toThrow('중복');
  });
  test('an unavailable backend blocks registered actions before service calls', async () => {
    const p = profile(); p.task.actionCatalog.executionAvailable = false; p.task.actionCatalog.message = 'EXECUTION_BACKEND_UNAVAILABLE';
    const { value, context } = sender(p);
    expect(value._actionTypeSupported(48, context.App.robotSlots[0])).toBe(false);
    await expect(value._prepareActionsForSlot([{ action_type: 7, action_args: [1] }], context.App.robotSlots[0])).rejects.toThrow('backend');
  });
  test('native StandBy accepts empty arguments; ROS1 keeps its own contract', () => {
    const { value } = sender(profile());
    expect(() => value._validateActionWireShape({ action_type: 7, action_args: [] }, profile())).not.toThrow();
    expect(() => value._validateActionWireShape({ action_type: 7, action_args: [] }, { task: { protocol: 'ros1_legacy' } })).toThrow();
  });
  test('a second conflicting carrier is rejected and matching carriers are rebound together', () => {
    const route = Route.build(options);
    const action = { action_id: 'a', action_params: Route.action(route).params, acs_data: ['route_contract_json=' + JSON.stringify(route)] };
    Route.bind(action, { taskId: 't', mapId: 'normal' });
    expect(action.acs_data[0]).toBe('route_contract_json=' + action.action_params[0].value);
    const conflict = Route.clone(action); const changed = JSON.parse(conflict.action_params[0].value); changed.route_id = 'different';
    conflict.acs_data = ['route_contract_json=' + JSON.stringify(changed)];
    expect(() => Route.bind(conflict, { taskId: 't' })).toThrow('다릅니다');
  });
});


test('NURBS preview samples the curve rather than joining only its endpoints', () => {
  const route = Route.build({ ...options, geometry: 'NURBS', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 2 }] });
  const preview = Route.preview(Route.action(route));
  expect(preview).toHaveLength(61);
  expect(preview[0]).toMatchObject({ x: 0, y: 0 });
  expect(preview.at(-1)).toMatchObject({ x: 3, y: 2 });
  expect(preview[30]).toMatchObject({ x: 1.125, y: 1 });
});


test('v1-only heading overrides and lateral lane directions require v2 migration review', () => {
  const route = Route.build(options);
  const action = { action_id: 'a', action_params: [...Route.action(route).params, { param_name: 'start_heading_policy.source', type: 'string', value: 'FIRST_EDGE' }] };
  expect(() => Route.bind(action, { taskId: 't' })).toThrow('start_heading_policy.source');
  const conversion = Route.convertLegacy({ actionType: '0x15', args: [0, 0, 1, 1, 0], params: [{ param_name: 'lane_direction', value: '4' }] }, { mapId: 'normal', robotId: 'R_025' });
  expect(conversion.unmapped).toContain('lane_direction');
});
