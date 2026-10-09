const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const RobotCompatibility = require('../public/js/robot-compatibility');
const fixture = require('./fixtures/r006-ros2-graph.json');

function manager(slot = {}) {
  const context = {
    App: { activeSlotIndex: 0, robotSlots: [slot], toast: jest.fn() },
    document: { addEventListener: jest.fn(), getElementById: jest.fn(() => null) },
    ROSLIB: {}, console, setTimeout, clearTimeout, setInterval, clearInterval,
    SSHTerminal: { execCommand: jest.fn(async () => ({ success: true, stdout: 'ROS1' })) },
    fetchWithTimeout: jest.fn(async () => ({ json: async () => ({ success: true, stdout: 'ROS2' }) }))
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/ros-manager.js'), 'utf8');
  const value = vm.runInNewContext(`${source}\nRosManager`, context);
  return { value, context, slot };
}

function build(extra = {}) {
  return RobotCompatibility._buildProfile({ robotId: 'R_006', rosMode: 'ros2', ...extra },
    Object.keys(fixture.services), Object.keys(fixture.topics), fixture.services, fixture.topics);
}

describe('ROS1 and ROS2 migration contracts', () => {
  test('uses the actual R006 snapshot for map saving, charging and node-local telemetry', () => {
    const profile = build();
    expect(profile.map.saveType).toBe('spx_mapping_msgs/srv/SaveMap');
    expect(profile.map.poseGraphSaveType).toBe('slam_toolbox/srv/SerializePoseGraph');
    expect(profile.map.reloadType).toBe('nav2_msgs/srv/LoadMap');
    expect(profile.monitoring.topics.bms.type).toBe('sensor_msgs/msg/BatteryState');
    expect(profile.monitoring.topics.chargeRelay.name).toBe('/R_006/io/do/charge_relay');
    expect(profile.task.verified).toBe(false);
  });

  test('a stopped local bringup never enables controls from a remote DDS graph', () => {
    const profile = build({ rosControlEnabled: false });
    expect(profile.controlReady).toBe(false);
    expect(profile.chassis.drive.verified).toBe(false);
    expect(profile.chassis.charge.verified).toBe(false);
    expect(profile.mapping.verified).toBe(false);
    expect(profile.map.saveService).toBeNull();
    expect(profile.map.reloadService).toBeNull();
    expect(profile.monitoring.topics.bms.name).toBe('/R_006/battery_state');
  });

  test('verifies actual mux, safety gate and wheel-driver endpoints before enabling ROS2 jog', async () => {
    const profile = build();
    const ns = '/R_006/';
    const info = (publishers, subscribers) => ({ publishers: publishers.map(node => ({ node: ns + node })),
      subscribers: subscribers.map(node => ({ node: ns + node })) });
    const snapshots = {
      [ns + 'cmd_vel_teleop']: info([], ['cmd_vel_mux']),
      [ns + 'cmd_vel_selected']: info(['cmd_vel_mux'], ['cmd_safety_gate']),
      [ns + 'cmd_vel']: info(['cmd_safety_gate'], ['wheel_driver_node_exe'])
    };
    const spy = jest.spyOn(RobotCompatibility, '_rosapi').mockImplementation((_ros, _name, _type, args) => Promise.resolve(snapshots[args.topic]));
    await RobotCompatibility._verifyRos2Drive({ robotId: 'R_006', ros2SessionId: 'session', ros: {} }, profile, 1000);
    expect(profile.chassis.drive.verified).toBe(true);
    snapshots[ns + 'cmd_vel'].subscribers = [];
    await RobotCompatibility._verifyRos2Drive({ robotId: 'R_006', ros2SessionId: 'session', ros: {} }, profile, 1000);
    expect(profile.chassis.drive.verified).toBe(false);
    spy.mockRestore();
  });

  test("ROS2 drive model uses the driver actual config-file metadata", async () => {
    const profile = build();
    const spy = jest.spyOn(RobotCompatibility, '_rosapi').mockResolvedValue({ controller_type: 'differential_drive',
      parameter: '/R_006/wheel_driver_node_exe::config_file', config_file: '/home/syscon/ros2_ws/install/wheel_params.yaml' });
    const model = await RobotCompatibility._discoverDriveModel({ robotId: 'R_006', ros2SessionId: 'session', ros: {} }, profile);
    expect(model).toMatchObject({ verified: true, kind: 'dd', actionModelType: 0 });
    expect(model.parameter).toBe('/R_006/wheel_driver_node_exe::config_file');
    spy.mockRestore();
  });

  test('ROS2 exec is bound to its own SSH session while ROS1 retains its existing executor', async () => {
    const { value, context, slot } = manager({ ros2SessionId: 'ros2-owner', ros: {} });
    await expect(value.execRuntimeCommand('ros2 node list')).resolves.toMatchObject({ stdout: 'ROS2' });
    expect(JSON.parse(context.fetchWithTimeout.mock.calls[0][1].body)).toEqual({ sessionId: 'ros2-owner', command: 'ros2 node list' });
    expect(context.SSHTerminal.execCommand).not.toHaveBeenCalled();
    delete slot.ros2SessionId;
    await expect(value.execRuntimeCommand('rosnode list')).resolves.toMatchObject({ stdout: 'ROS1' });
  });

  test('ROS2 get/set parameter errors use node-local rosapi calls and do not enter ROS1 Param', async () => {
    const { value, context } = manager({ ros2SessionId: 'ros2', ros: {} });
    value.ros2Api = jest.fn(async (operation, args) => {
      if (operation === 'get_param') return { value: '300' };
      if (args.value !== '500') throw new Error('read-only');
      return { success: true };
    });
    context.ROSLIB.Param = jest.fn();
    await expect(new Promise(resolve => value.getParam('/R_006/amcl::max_particles', resolve))).resolves.toEqual({ success: true, value: 300 });
    await expect(new Promise(resolve => value.setParam('/R_006/amcl::max_particles', 500, resolve))).resolves.toEqual({ success: true });
    await expect(new Promise(resolve => value.setParam('/R_006/amcl::max_particles', 600, resolve))).resolves.toEqual({ error: 'read-only' });
    expect(context.ROSLIB.Param).not.toHaveBeenCalled();
  });

  test('R006 never receives a fabricated NavigateToPose action', async () => {
    const { value } = manager({ robotId: 'R_006', ros2SessionId: 'ros2', ros: {} });
    value.ros2Api = jest.fn(async () => ({ actions: Object.keys(fixture.actions), types: Object.values(fixture.actions) }));
    value.createRos2Action = jest.fn();
    await expect(value._sendRos2Navigation(1, 2, 0)).rejects.toThrow('NavigateToPose');
    expect(value.createRos2Action).not.toHaveBeenCalled();
  });

  test('ROS2 action results and cancel requests clean their subscriptions', async () => {
    const ros = new EventEmitter();
    const { value, context, slot } = manager({ ros, robotId: 'R_006', ros2SessionId: 'ros2' });
    const topics = [];
    context.ROSLIB.Topic = class {
      constructor(options) { this.name = options.name; this.unsubscribe = jest.fn(); topics.push(this); }
      subscribe(callback) { this.callback = callback; }
    };
    const calls = [];
    value._callRosServicePromise = jest.fn(async (_ros, name, _type, args) => {
      calls.push({ name, args });
      return name.endsWith('/cancel_goal') ? { cancelled: true } : { accepted: true };
    });
    const action = value.createRos2Action('/R_006/follow_path', 'nav2_msgs/action/FollowPath', { path: {} });
    await expect(action.cancel()).resolves.toMatchObject({ cancelled: true });
    topics.find(topic => topic.name.endsWith('/result')).callback({ status: 4, result: { error_code: 0 } });
    await expect(action.result).resolves.toEqual({ error_code: 0 });
    expect(slot.ros2Actions.size).toBe(0);
    expect(ros.listenerCount('close')).toBe(0);
    expect(topics.every(topic => topic.unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(calls[0].args.action).toBe('/R_006/follow_path');
    expect(calls[1].args.id).toBe(action.id);
  });

  test('ROS2 action rejection is surfaced and the pending action is removed', async () => {
    const ros = new EventEmitter();
    const { value, context, slot } = manager({ ros, ros2SessionId: 'ros2' });
    context.ROSLIB.Topic = class { subscribe() {} unsubscribe() {} };
    value._callRosServicePromise = jest.fn(async () => { throw new Error('server rejected'); });
    const action = value.createRos2Action('/R_006/follow_path', 'nav2_msgs/action/FollowPath', {});
    await expect(action.result).rejects.toThrow('server rejected');
    expect(slot.ros2Actions.size).toBe(0);
  });
});
