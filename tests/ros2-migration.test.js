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
  test('native ManualJog is discovered as a separate contract and disabled state is read without a write', async () => {
    const topics = { ...fixture.topics, '/R_006/manual_jog/available': 'std_msgs/msg/Bool', '/R_006/manual_jog/status': 'std_msgs/msg/String' };
    const profile = RobotCompatibility._buildProfile({ robotId: 'R_006', rosMode: 'ros2' }, Object.keys(fixture.services), Object.keys(topics), fixture.services, topics);
    expect(profile.chassis.jog).toMatchObject({ protocol: 'ros2_manual_jog', integrated: true, enabled: null, actionVerified: false });
    const spy = jest.spyOn(RobotCompatibility, '_rosapi').mockResolvedValue({ value: 'false' });
    try {
      await RobotCompatibility._discoverRos2Jog({ robotId: 'R_006', ros: {} }, profile, 1000);
      expect(profile.chassis.jog).toMatchObject({ enabled: false, integrated: true, actionVerified: false });
      expect(profile.chassis.jog.reason).toContain('manual_jog.enabled=false');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0].slice(1, 4)).toEqual(['/rosapi/get_param', 'rosapi/srv/GetParam', { name: '/R_006/cmd_safety_gate::manual_jog.enabled', default: '' }]);
    } finally { spy.mockRestore(); }
  });

  test('a ROS2 enabled flag alone never makes the native Jog transport implemented', async () => {
    const profile = { chassis: { jog: { protocol: 'ros2_manual_jog', integrated: false, enabled: null, reason: '전용 Action 연동 필요' } } };
    const spy = jest.spyOn(RobotCompatibility, '_rosapi').mockResolvedValue({ value: 'true' });
    try {
      await RobotCompatibility._discoverRos2Jog({ robotId: 'R_006', ros: {} }, profile, 1000);
      expect(profile.chassis.jog).toMatchObject({ integrated: false, enabled: true, limitsVerified: false, actionVerified: false });
    } finally { spy.mockRestore(); }
  });
  test('enabled native Jog still requires all positive limits and the exact action type', async () => {
    const keys=['max_translation_m','max_rotation_rad','max_linear_speed_mps','max_angular_speed_radps','max_linear_accel_mps2','max_angular_accel_radps2','max_duration_sec','max_stop_wait_sec','position_tolerance','linear_stop_tolerance_mps','angular_stop_tolerance_radps'];
    const numbers=[0.1,0.3,0.1,0.2,0.2,0.4,2,1,0.001,0.01,0.01];
    const profile={chassis:{jog:{protocol:'ros2_manual_jog',integrated:true,actionName:'/R_006/manual_jog/execute'}}};
    let actionType='spx_task_msgs/action/ManualJog';
    const spy=jest.spyOn(RobotCompatibility,'_rosapi').mockImplementation(async(_ros,name,_type,args)=>{
      if(name==='/rosapi/get_param')return{value:'true'};
      if(name==='/rosapi/actions')return{actions:['/R_006/manual_jog/execute'],types:[actionType]};
      expect(args.names).toEqual(keys.map(key=>'manual_jog.'+key));
      return{values:numbers.map(double_value=>({type:3,double_value}))};
    });
    try{
      await RobotCompatibility._discoverRos2Jog({robotId:'R_006',ros:{}},profile,1000);
      expect(profile.chassis.jog).toMatchObject({enabled:true,limitsVerified:true,actionVerified:true,reason:''});
      actionType='other_msgs/action/Move';
      await RobotCompatibility._discoverRos2Jog({robotId:'R_006',ros:{}},profile,1000);
      expect(profile.chassis.jog.actionVerified).toBe(false);
      numbers[0]=0;
      await RobotCompatibility._discoverRos2Jog({robotId:'R_006',ros:{}},profile,1000);
      expect(profile.chassis.jog.limitsVerified).toBe(false);
    }finally{spy.mockRestore();}
  });
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

  test('native Jog cancellation preserves the robot stop proof and ROS status', async () => {
    const ros = new EventEmitter();
    const { value, context } = manager({ ros, robotId:'R_006', ros2SessionId:'ros2' });
    const topics=[];
    context.ROSLIB.Topic=class {constructor(options){this.name=options.name;topics.push(this);}subscribe(callback){this.callback=callback;}unsubscribe(){}};
    value._callRosServicePromise=jest.fn(async()=>({accepted:true}));
    const action=value.createRos2Action('/R_006/manual_jog/execute','spx_task_msgs/action/ManualJog',{},0,null,{terminalResult:true,timeoutMs:1000});
    topics.find(t=>t.name.endsWith('/result')).callback({status:5,result:{success:false,stop_confirmed:true,error_code:'JOG_CANCELLED'}});
    await expect(action.result).resolves.toEqual({status:5,result:{success:false,stop_confirmed:true,error_code:'JOG_CANCELLED'}});
  });
});
