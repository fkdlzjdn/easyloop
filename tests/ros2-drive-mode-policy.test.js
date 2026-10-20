const fs=require('fs'),path=require('path'),vm=require('vm');
function fixture(policy={schema:1,modeTopic:'io/state_monitor/mode',brakeSwitchTopic:'',sourceTimeoutMs:20000}) {
  const slot={robotId:'R_006',robotModel:'sl400_vri',ros:{},ros2SessionId:'test-only'};
  const exec=jest.fn(async()=>({success:true,stdout:'EASYLOOP_DRIVE_MODE='+JSON.stringify(policy)}));
  const context={App:{robotSlots:[slot]},RosManager:{execRuntimeCommand:exec,_shellQuote:value=>"'"+String(value).replace(/'/g,"'\\''")+"'"},console,setTimeout,clearTimeout};
  const compatibility=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/robot-compatibility.js'),'utf8')+'\nRobotCompatibility',context);
  compatibility._rosapi=jest.fn(async()=>({value:JSON.stringify('/robot/param/sl400_vri/drivers/io_manager_params.yaml')}));
  const bounded={protocol:'ros2_manual_jog',enabled:false,integrated:true};
  const profile={chassis:{drive:{verified:true,topic:'/R_006/cmd_vel_teleop',topicType:'geometry_msgs/msg/Twist'},jog:bounded}};
  return{slot,profile,bounded,compatibility,exec,context};
}
describe('live ROS2 motor-mode contract discovery',()=>{
  test('a transient IO parameter failure is retried before considering the separate bounded adapter',async()=>{
    const h=fixture();h.compatibility._rosapi.mockRejectedValueOnce(new Error('metadata temporarily unavailable'));
    await h.compatibility._discoverRos2Jog(h.slot,h.profile,1000);
    expect(h.profile.chassis.jog).toMatchObject({protocol:'ros2_teleop',motorMode:'auto',modePending:false});
    expect(h.compatibility._rosapi).toHaveBeenCalledTimes(2);expect(h.exec).toHaveBeenCalledTimes(1);
    expect(h.compatibility._rosapi.mock.calls.every(call=>call[3].name.endsWith('/io_driver_node::config_path'))).toBe(true);
  });
  test('unavailable IO and native parameter reads remain unresolved, never establish physical MANUAL',async()=>{
    const h=fixture();h.compatibility._rosapi.mockRejectedValue(new Error('metadata unavailable'));
    await h.compatibility._discoverRos2Jog(h.slot,h.profile,1000);
    expect(h.profile.chassis.jog).toMatchObject({protocol:'ros2_manual_jog',modePending:true,motorMode:'unknown'});
    expect(h.profile.chassis.jog.reason).toContain('구동 모드 확인 실패');expect(h.exec).not.toHaveBeenCalled();
  });
  test('the IO file reader has a bounded retry and keeps an explicit failure reason',async()=>{
    const h=fixture();h.exec.mockResolvedValue({success:false,message:'inspection temporarily unavailable'});
    h.compatibility._rosapi.mockImplementation(async(_ros,_name,_type,args)=>({value:JSON.stringify(args.name.includes('manual_jog')?false:'/robot/io.yaml')}));
    await h.compatibility._discoverRos2Jog(h.slot,h.profile,1000);
    expect(h.exec).toHaveBeenCalledTimes(2);expect(h.profile.chassis.jog.modePending).toBe(true);
    expect(h.profile.chassis.jog.reason).toContain('inspection temporarily unavailable');
  });
  test('IO policy lookup uses the same-slot telemetry channel, and changed sessions cannot execute a stale file read',async()=>{
    const h=fixture(),telemetry={};h.context.RosManager.getTelemetryRos=()=>telemetry;
    expect(await h.compatibility._discoverAutoDriveTeleop(h.slot,h.profile,1000)).toBe(true);
    expect(h.compatibility._rosapi.mock.calls[0][0]).toBe(telemetry);
    const changed=fixture();changed.compatibility._rosapi.mockImplementation(async()=>{changed.slot.ros2SessionId='replacement';return{value:JSON.stringify('/robot/io.yaml')};});
    expect(await changed.compatibility._discoverAutoDriveTeleop(changed.slot,changed.profile,1000)).toBe(false);
    expect(changed.exec).not.toHaveBeenCalled();
  });
  test('presentation updates preserve verified adapters and the in-flight discovery token',()=>{
    const h=fixture();h.slot.compatibilityProfile=h.profile;h.slot.compatibilityDiscoveryToken=9;h.slot.robotModel='stl1500w';
    h.compatibility.updatePresentation(h.slot);
    expect(h.slot.compatibilityProfile.chassis.jog).toBe(h.bounded);expect(h.slot.compatibilityDiscoveryToken).toBe(9);
    expect(h.slot.compatibilityProfile).toMatchObject({model:'stl1500w',project:'stl_ulsan'});
  });
  test('selects the configured normal teleop path when MANUAL releases the motors; does not enable bounded ManualJog',async()=>{
    const h=fixture();await h.compatibility._discoverRos2Jog(h.slot,h.profile,1000);
    expect(h.profile.chassis.jog).toMatchObject({protocol:'ros2_teleop',verified:true,motorMode:'auto'});
    expect(h.profile.chassis.boundedJog).toBe(h.bounded);expect(h.bounded.enabled).toBe(false);
    expect(h.compatibility._rosapi).toHaveBeenCalledTimes(1);
    expect(h.compatibility._rosapi.mock.calls[0][3].name).toBe('/R_006/io_driver_node::config_path');
    expect(h.exec.mock.calls[0][0]).toContain('python3 -B -c');
    expect(h.exec.mock.calls[0][0]).not.toMatch(/set_parameters|set_param|send_goal|cmd_vel publish/);
  });
  test.each([{schema:1,modeTopic:'/R_025/io/state_monitor/mode',brakeSwitchTopic:'',sourceTimeoutMs:20000},
    {schema:1,modeTopic:'io/state_monitor/mode',brakeSwitchTopic:'io/brake_switch',sourceTimeoutMs:20000},
    {schema:1,modeTopic:'io/state_monitor/mode',brakeSwitchTopic:'',sourceTimeoutMs:0}])('a model name alone cannot override an unknown/different live policy %j',async policy=>{
    const h=fixture(policy);expect(await h.compatibility._discoverAutoDriveTeleop(h.slot,h.profile,1000)).toBe(false);
    expect(h.profile.chassis.jog.protocol).toBe('ros2_manual_jog');
  });
  test('unverified or direct final-velocity paths cannot select AUTO teleop',async()=>{
    const h=fixture();h.profile.chassis.drive.topic='/R_006/cmd_vel';
    expect(await h.compatibility._discoverAutoDriveTeleop(h.slot,h.profile,1000)).toBe(false);expect(h.exec).not.toHaveBeenCalled();
    h.profile.chassis.drive.topic='/R_006/cmd_vel_teleop';h.profile.chassis.drive.verified=false;
    expect(await h.compatibility._discoverAutoDriveTeleop(h.slot,h.profile,1000)).toBe(false);
  });
  test('a stale configuration read cannot authorize a replacement connection',async()=>{
    const h=fixture();let finish;h.exec.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=h.compatibility._discoverAutoDriveTeleop(h.slot,h.profile,1000);await new Promise(resolve=>setImmediate(resolve));
    h.slot.ros={};finish({success:true,stdout:'EASYLOOP_DRIVE_MODE='+JSON.stringify({schema:1,modeTopic:'io/state_monitor/mode',brakeSwitchTopic:'',sourceTimeoutMs:20000})});
    expect(await pending).toBe(false);expect(h.profile.chassis.jog.protocol).toBe('ros2_manual_jog');
  });
});
