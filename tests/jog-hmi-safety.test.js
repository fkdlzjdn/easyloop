const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeClassList() {
  const values = new Set();
  return {
    add: jest.fn(name => values.add(name)),
    remove: jest.fn(name => values.delete(name)),
    toggle: jest.fn((name, enabled) => enabled ? values.add(name) : values.delete(name)),
    contains: name => values.has(name)
  };
}

function makeElement(extra = {}) {
  return {
    textContent: '',
    className: '',
    disabled: false,
    value: '0',
    style: {},
    dataset: {},
    classList: makeClassList(),
    addEventListener: jest.fn(),
    setAttribute: jest.fn(),
    ...extra
  };
}

function loadJog() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'jog-control.js'),
    'utf8'
  );
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  getElement('jog-panel').style.display = 'flex';
  getElement('jog-drive-type').value = 'dd';
  getElement('jog-topic').value = '/cmd_vel';
  getElement('jog-linear-speed').value = '0.10';
  getElement('jog-angular-speed').value = '0.20';
  getElement('jog-turntable-target').value = '10';

  const listeners = {};
  const topics = [];
  const serviceCalls = [];
  class Topic {
    constructor(options) {
      this.options = options;
      topics.push(this);
    }
    subscribe(callback) { this.callback = callback; }
    unsubscribe() { this.unsubscribed = true; }
    publish() {}
  }
  class Message {
    constructor(values) { Object.assign(this, values); }
  }
  class ServiceRequest {
    constructor(values) { Object.assign(this, values); }
  }
  class Service {
    constructor(options) { this.options = options; }
    callService(request, success) {
      serviceCalls.push({ options: this.options, request });
      success({ success: true });
    }
  }

  const slot = {
    robotId: 'R_013',
    robotModel: 'stl1500w',
    connected: true,
    ros: {}
  };
  const compatibilityProfile = {
    discovered: true,
    controlReady: true,
    id: 'ros1_legacy',
    task: { verified: true, protocol: 'ros1_legacy', goalName: '/R_013/TARU/goal' },
    mapping: { verified: true, protocol: 'ros1_legacy' },
    lift: {
      verified: true,
      interface: 'service',
      service: '/R_013/Lift/cmd',
      serviceType: 'syscon_msgs/lift_cmd',
      feedbackTopic: '/R_013/Lift/feedback',
      feedbackType: 'syscon_msgs/LiftFeedback',
      commands: { stop: 0, up: 1, down: 2 }
    },
    actions: {
      turntable: {
        verified: true,
        service: '/R_013/Turntable/cmd',
        serviceType: 'syscon_msgs/turntable_cmd',
        feedbackTopic: '/R_013/Turntable/feedback',
        feedbackType: 'syscon_msgs/LiftFeedback',
        syncService: '/R_013/Turntable/sync_mode',
        syncType: 'std_srvs/SetBool'
      }
    },
    chassis: {
      verified: true,
      drive: { verified: true, topic: '/R_013/cmd_vel', topicType: 'geometry_msgs/Twist' },
      conveyor: { verified: false, reason: '미지원' }
    },
    monitoring: {
      verified: true,
      topics: {
        manualSelect: { name: '/R_013/io/select', type: 'std_msgs/Bool' },
        robotState: { name: '/R_013/robot_state', type: 'syscon_msgs/RobotState' },
        emergency: { name: '/R_013/emergency_sensor', type: 'std_msgs/Int32MultiArray' },
        sto: { name: '/R_013/sto_stop', type: 'std_msgs/Bool' },
        lidarField: { name: '/R_013/io/lidar_field', type: 'std_msgs/UInt8' },
        brakeReleased: { name: '/R_013/io/break_released', type: 'std_msgs/Bool' },
        motorStatus: { name: '/R_013/motor_status', type: 'syscon_msgs/MotorState' },
        odom: { name: '/R_013/odom', type: 'nav_msgs/Odometry' }
      }
    }
  };
  slot.compatibilityProfile = compatibilityProfile;
  const context = {
    App: {
      activeSlotIndex: 0,
      robotSlots: [slot],
      toast: jest.fn()
    },
    RosManager: {
      getRos: jest.fn(() => slot.ros),
      getRobotId: jest.fn(() => slot.robotId)
    },
    RobotCompatibility: {
      isStlUlsanModel: model => String(model).toLowerCase() === 'stl1500w',
      get: () => compatibilityProfile,
      requireCapability: (profile, name) => {
        const capability = name === 'turntable' ? profile.actions.turntable : profile[name];
        if (!capability?.verified) throw new Error(`${name} 미검증`);
        return capability;
      }
    },
    ActionSender: {
      sendJogActionToSlot: jest.fn().mockResolvedValue({}),
      cancelTaskOnSlot: jest.fn().mockResolvedValue({})
    },
    ROSLIB: { Topic, Message, Service, ServiceRequest },
    localStorage: { getItem: jest.fn(() => null), setItem: jest.fn() },
    confirm: jest.fn(() => true),
    document: {
      activeElement: null,
      hidden: false,
      addEventListener: jest.fn((name, callback) => { listeners[name] = callback; }),
      getElementById: jest.fn(getElement),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => [])
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__JogControl = JogControl;`, context);
  return { manager: context.__JogControl, context, slot, topics, serviceCalls, listeners, getElement };
}

function autoDriveFixture() {
  const h=loadJog(), at=Date.now();
  h.slot.robotModel='sl400_vri';h.slot.compatibilityProfile.transport={rosMajor:2};
  h.slot.compatibilityProfile.chassis.jog={protocol:'ros2_teleop',verified:true,motorMode:'auto',reason:''};
  h.slot.compatibilityProfile.chassis.boundedJog={protocol:'ros2_manual_jog',enabled:false};
  h.slot.compatibilityProfile.chassis.drive.topic='/R_013/cmd_vel_teleop';
  h.slot.compatibilityProfile.chassis.drive.topicType='geometry_msgs/msg/Twist';
  h.manager._safetyState=Object.fromEntries(['manual','idle','emo','sto','lidar','brake'].map(key=>[key,{value:key!=='manual',at}]));
  h.manager._nativeJogCharging={value:false,at};
  h.manager._teleopIoState={localRelease:{value:false,at},deviceHealthy:{value:true,at},bumper:{value:false,at},
    safetyAllowed:{value:true,at},safetyStatus:{value:'state=NORMAL reason=normal',at}};
  return h;
}

describe('AUTO motor-enable model uses its normal teleop contract',()=>{
  test('unresolved ROS2 adapters block motion without inventing a physical MANUAL requirement',()=>{
    const h=autoDriveFixture();h.slot.compatibilityProfile.chassis.jog={protocol:'ros2_manual_jog',integrated:true,enabled:true,
      actionVerified:true,limitsVerified:true,modePending:true,motorMode:'unknown',reason:'ROS2 Jog 구동 모드 확인 실패'};
    const evaluation=h.manager._safetyEvaluation();expect(evaluation.safe).toBe(false);
    expect(evaluation.reasons).toContain('ROS2 Jog 구동 모드 확인 실패');
    expect(evaluation.reasons.join(' ')).not.toMatch(/물리 MANUAL|MANUAL 모드|Brake Locked/);
    h.manager._refreshSafetyUi();expect(h.getElement('jog-safety-manual').textContent).toBe('MODE 확인 중');
    expect(h.getElement('jog-fwd').disabled).toBe(true);
    h.manager._syncNativeJogUi();expect(h.getElement('jog-native-settings').hidden).toBe(true);
    expect(h.getElement('jog-release-hint').hidden).toBe(true);
  });
  test('fresh AUTO with motors held and clear safety admits teleop even when the separate bounded Action is disabled',()=>{
    const h=autoDriveFixture();expect(h.manager._safetyEvaluation()).toMatchObject({safe:true,strict:true,reasons:[]});
    expect(h.manager._getTopicName()).toBe('/R_013/cmd_vel_teleop');
    h.manager._refreshSafetyUi();expect(h.getElement('jog-safety-manual').textContent).toBe('구동 허용(AUTO)');
    expect(h.getElement('jog-safety-manual').className).toContain('safe');
  });
  test('physical MANUAL still blocks this model because it releases the motors',()=>{
    const h=autoDriveFixture();h.manager._safetyState.manual.value=true;
    expect(h.manager._safetyEvaluation().safe).toBe(false);
    expect(h.manager._safetyEvaluation().reasons.join()).toContain('모터 해제(MANUAL)');
  });
  test.each(['sto','emo','idle','brake','lidar'])('%s remains an independent stop condition',key=>{
    const h=autoDriveFixture();h.manager._safetyState[key].value=false;expect(h.manager._safetyEvaluation().safe).toBe(false);
  });
  test.each(['localRelease','deviceHealthy','bumper'])('%s unsafe/unknown/stale values block command admission',key=>{
    const h=autoDriveFixture(), state=h.manager._teleopIoState[key];
    state.value=!state.value;expect(h.manager._safetyEvaluation().safe).toBe(false);
    state.value=null;expect(h.manager._safetyEvaluation().safe).toBe(false);
    state.value=key==='deviceHealthy';state.at=Date.now()-3000;expect(h.manager._safetyEvaluation().safe).toBe(false);
  });
  test('charging, stale AUTO and an in-flight Task cannot be overridden by teleop',()=>{
    const h=autoDriveFixture();h.manager._nativeJogCharging.value=true;expect(h.manager._safetyEvaluation().safe).toBe(false);
    h.manager._nativeJogCharging.value=false;h.manager._safetyState.manual.at=Date.now()-3000;expect(h.manager._safetyEvaluation().safe).toBe(false);
    h.manager._safetyState.manual.at=Date.now();h.context.ActionSender._runningTasks=new Map([[h.slot.robotId,{state:'work'}]]);
    expect(h.manager._safetyEvaluation().safe).toBe(false);
  });
  test('only an idle input watchdog can await a first held command; real gate stops remain blocked',()=>{
    const h=autoDriveFixture();h.manager._teleopIoState.safetyAllowed.value=false;
    for(const reason of ['startup_hold','command_timeout']){
      h.manager._teleopIoState.safetyStatus.value='state=STALE_SAFETY reason='+reason;
      expect(h.manager._safetyEvaluation().safe).toBe(true);
    }
    for(const status of ['state=STALE_SAFETY reason=stale_safety','state=COLLISION_HOLD reason=collision_hold','state=TASK_STOP reason=task_stop','state=STALE_SAFETY reason=manual_jog_stop_unconfirmed']){
      h.manager._teleopIoState.safetyStatus.value=status;expect(h.manager._safetyEvaluation().safe).toBe(false);
    }
    h.manager._teleopIoState.safetyStatus.at=Date.now()-3000;expect(h.manager._safetyEvaluation().safe).toBe(false);
  });
  test('unknown Bool/STO/RobotState values never count as safe or IDLE',()=>{
    const h=autoDriveFixture();h.manager._startTelemetry();
    try{
      const sto=h.topics.find(t=>t.options.name.endsWith('/sto_stop'));
      const state=h.topics.find(t=>t.options.name.endsWith('/robot_state'));
      sto.callback({data:null});state.callback({workstate:null});
      expect(h.manager._safetyState.sto.value).toBeNull();expect(h.manager._safetyState.idle.value).toBeNull();
    }finally{h.manager._stopTelemetry(false);}
  });
});

describe('ROS2 safety gate samples from independent DDS topics', () => {
  let active;
  afterEach(() => { active?.manager._stopTelemetry(false); });
  function monitoring() {
    const h = autoDriveFixture(); active = h;
    const initial = { _safetyState: h.manager._safetyState, _teleopIoState: h.manager._teleopIoState,
      _nativeJogCharging: h.manager._nativeJogCharging };
    Object.assign(h.slot.compatibilityProfile.monitoring.topics, {
      safetyAllowed: { name: '/R_013/cmd_safety_gate/allowed', type: 'std_msgs/msg/Bool' },
      safetyStatus: { name: '/R_013/cmd_safety_gate/status', type: 'std_msgs/msg/String' }
    });
    h.manager._startTelemetry(); Object.assign(h.manager, initial);
    h.manager._publishing = true;
    h.manager._stopJogControls = jest.fn(() => { h.manager._publishing = false; });
    h.allowed = h.topics.find(t => t.options.name.endsWith('/cmd_safety_gate/allowed'));
    h.status = h.topics.find(t => t.options.name.endsWith('/cmd_safety_gate/status'));
    return h;
  }
  test.each([true, false])('watchdog recovery does not abort held ingress when status arrives first=%s', statusFirst => {
    const h = monitoring();
    const status = () => h.status.callback({ data: 'state=STALE_SAFETY reason=command_timeout' });
    const denied = () => h.allowed.callback({ data: false });
    if (statusFirst) { status(); denied(); } else { denied(); status(); }
    h.status.callback({ data: 'state=NORMAL reason=normal' });
    h.allowed.callback({ data: true });
    expect(h.manager._publishing).toBe(true); expect(h.manager._stopJogControls).not.toHaveBeenCalled();
    expect(h.allowed.options).toMatchObject({ throttle_rate: 0, queue_length: 0 });
    expect(h.status.options).toMatchObject({ throttle_rate: 0, queue_length: 0 });
  });
  test.each(['state=EMERGENCY_STOP reason=emergency_stop', 'state=COLLISION_HOLD reason=collision_hold',
    'state=TASK_STOP reason=task_stop', 'state=STALE_SAFETY reason=stale_safety',
    'state=STALE_SAFETY reason=invalid_command', 'state=STALE_SAFETY reason=manual_jog_stop_unconfirmed',
    'state=NORMAL reason=unknown'])('real and unknown stop state %s blocks immediately even with allowed=true', status => {
    const h = monitoring(); h.status.callback({ data: status });
    expect(h.manager._publishing).toBe(false); expect(h.manager._stopJogControls).toHaveBeenCalledTimes(1);
    expect(h.manager._safetyEvaluation().reasons.join()).toContain(status);
  });
  test('missing, invalid or stale telemetry cannot be admitted by a normal status', () => {
    const h = monitoring();
    for (const value of [undefined, null, 'false', 0]) {
      h.manager._teleopIoState.safetyAllowed = { value, at: Date.now() };
      expect(h.manager._safetyEvaluation().safe).toBe(false);
    }
    h.manager._teleopIoState.safetyAllowed = { value: true, at: Date.now() - 3000 };
    expect(h.manager._safetyEvaluation().safe).toBe(false);
  });
  test('a late callback from an old telemetry generation cannot overwrite the new gate state', () => {
    const h = monitoring(), old = h.status;
    const initial = { _safetyState: h.manager._safetyState, _teleopIoState: h.manager._teleopIoState,
      _nativeJogCharging: h.manager._nativeJogCharging };
    h.manager._startTelemetry(); Object.assign(h.manager, initial);
    old.callback({ data: 'state=COLLISION_HOLD reason=collision_hold' });
    expect(h.manager._teleopIoState.safetyStatus.value).toBe('state=NORMAL reason=normal');
    expect(h.manager._stopJogControls).not.toHaveBeenCalled();
    const current = h.topics.filter(t => t.options.name.endsWith('/cmd_safety_gate/status')).at(-1);
    current.callback({ data: 'state=COLLISION_HOLD reason=collision_hold' });
    expect(h.manager._stopJogControls).toHaveBeenCalledTimes(1);
  });
});

describe('normal Jog release deceleration', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function running(worker = false, velocity = [0.2, 0, 0.5]) {
    const h = autoDriveFixture();
    h.manager._jogClock = () => Date.now();
    h.wire = [];
    h.manager._getTopic = () => ({ publish: message => h.wire.push(JSON.parse(JSON.stringify(message))) });
    if (worker) {
      let socket;
      class FakeSocket {
        constructor() { this.readyState = 1; socket = this; }
        send(raw) { const message = JSON.parse(raw); if (message.op === 'publish') h.wire.push(message.msg); }
        close() {}
      }
      FakeSocket.OPEN = 1;
      const workerContext = { WebSocket: FakeSocket, Date, setInterval, clearInterval, setTimeout, clearTimeout,
        self: { postMessage: jest.fn(), close() {} } };
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/jog-publisher-worker.js'), 'utf8'), workerContext);
      h.worker = { postMessage: jest.fn(message => workerContext.self.onmessage({ data: message })) };
      h.worker.postMessage({ type: 'configure', url: 'ws://mock-only', topic: '/R_013/cmd_vel_teleop', messageType: 'geometry_msgs/msg/Twist' });
      socket.onopen();
      h.manager._jogWorker = h.worker; h.manager._jogWorkerReady = true;
    }
    expect(h.manager._setVel(...velocity)).toBe(true);
    return h;
  }

  test.each([false, true])('release monotonically reaches zero in 500ms with worker=%s and keeps the heartbeat alive until then', worker => {
    const h = running(worker); const m = h.manager;
    m._releaseVel();
    expect(m._publishing).toBe(true);
    expect(h.getElement('jog-pub-status').textContent).toBe('감속 중');
    expect(h.wire.at(-1).linear.x).toBe(0.2);
    for (let i = 1; i < 10; i++) {
      const previous = h.wire.at(-1).linear.x;
      jest.advanceTimersByTime(50);
      const next = h.wire.at(-1);
      expect(next.linear.x).toBeGreaterThan(0);
      expect(next.linear.x).toBeLessThan(previous);
      expect(next.angular.z / next.linear.x).toBeCloseTo(2.5);
      expect(m._publishing).toBe(true);
    }
    jest.advanceTimersByTime(50);
    expect(h.wire.at(-1).linear.x).toBe(0); expect(h.wire.at(-1).angular.z).toBe(0);
    expect(m._publishing).toBe(false); expect(m._deceleration).toBeNull();
    const count = h.wire.length; jest.advanceTimersByTime(1000); expect(h.wire).toHaveLength(count);
    if (worker) expect(h.worker.postMessage).toHaveBeenLastCalledWith({ type: 'stop' });
  });

  test('reverse and strafe components keep their signs and do not cross zero', () => {
    const h = running(false, [-0.2, 0.1, -0.5]); h.manager._releaseVel();
    jest.advanceTimersByTime(250);
    expect(h.wire.at(-1)).toMatchObject({ linear: { x: -0.1, y: 0.05 }, angular: { z: -0.25 } });
    h.manager._stopVel();
  });

  test('repeated releases do not extend the stop deadline and a new explicit input cancels the ramp', () => {
    const h = running(); h.manager._releaseVel(); jest.advanceTimersByTime(200);
    const startedAt = h.manager._deceleration.startedAt;
    h.manager._releaseVel(); expect(h.manager._deceleration.startedAt).toBe(startedAt);
    h.manager._setVel(0.1, 0, 0); expect(h.manager._deceleration).toBeNull();
    jest.advanceTimersByTime(400); expect(h.wire.at(-1).linear.x).toBe(0.1);
    h.manager._stopVel();
  });

  test.each(['sto', 'manual'])('unsafe %s interrupts an active ramp immediately without later nonzero samples', key => {
    const h = running(true); h.manager._releaseVel(); jest.advanceTimersByTime(100);
    h.manager._recordSafety(key, key === 'manual');
    expect(h.manager._publishing).toBe(false); expect(h.wire.at(-1).linear.x).toBe(0);
    const count = h.wire.length; jest.advanceTimersByTime(600); expect(h.wire).toHaveLength(count);
  });

  test('STOP overrides the ramp immediately and a replacement ROS connection receives no ramp velocity', () => {
    const h = running(); h.manager._releaseVel(); jest.advanceTimersByTime(100);
    h.manager._stopJogControls(); expect(h.manager._publishing).toBe(false); expect(h.wire.at(-1).linear.x).toBe(0);
    h.manager._setVel(0.1, 0, 0); h.manager._releaseVel(); h.slot.ros = {};
    jest.advanceTimersByTime(50); expect(h.manager._publishing).toBe(false); expect(h.wire.at(-1).linear.x).toBe(0);
  });

  test('keyboard release ramps but unrelated keyup never stops a pointer hold', () => {
    const h = running(); h.manager._setupKeyboard(); h.manager._activeKeys.add('w');
    h.listeners.keyup({ key: 'Shift' }); expect(h.manager._deceleration).toBeNull();
    h.listeners.keyup({ key: 'w' }); expect(h.manager._deceleration).not.toBeNull();
    h.manager._stopVel();
  });

  test('a delayed Worker completion from the previous release cannot stop a new input/release', () => {
    const h = autoDriveFixture();
    h.context.Worker = class { postMessage() {} };
    h.manager._jogClock = () => Date.now();
    h.manager._jogWorkerConfig = () => ({ url: 'ws://mock-only', topic: '/R_013/cmd_vel_teleop', messageType: 'geometry_msgs/msg/Twist' });
    h.manager._ensureJogWorker(); const worker = h.manager._jogWorker;
    worker.onmessage({ data: { type: 'status', state: 'ready' } });
    h.manager._setVel(0.2, 0, 0); h.manager._releaseVel(); const first = h.manager._deceleration.id;
    h.manager._setVel(0.1, 0, 0); h.manager._releaseVel(); const second = h.manager._deceleration.id;
    worker.onmessage({ data: { type: 'deceleration-complete', id: first } });
    expect(h.manager._publishing).toBe(true); expect(h.manager._deceleration.id).toBe(second);
    worker.onmessage({ data: { type: 'deceleration-complete', id: second } });
    expect(h.manager._publishing).toBe(false);
  });
});

describe('HMI-derived Jog safety and telemetry', () => {
  test('switching back to ROS1 restores its slider bounds after native ROS2 Jog', () => {
    const { manager, slot, getElement } = loadJog();
    getElement('jog-linear-speed').min='0.1';getElement('jog-linear-speed').max='1';
    getElement('jog-angular-speed').min='0.1';getElement('jog-angular-speed').max='2';
    slot.compatibilityProfile.chassis.jog={protocol:'ros2_manual_jog',limitsVerified:true,limits:{max_translation_m:0.1,max_rotation_rad:0.2,max_linear_speed_mps:0.05,max_angular_speed_radps:0.1,max_duration_sec:2}};
    manager._syncNativeJogUi();expect(getElement('jog-linear-speed').max).toBe('0.05');
    delete slot.compatibilityProfile.chassis.jog;manager._syncNativeJogUi();
    expect(getElement('jog-linear-speed').max).toBe('1');expect(getElement('jog-angular-speed').max).toBe('2');
    expect(getElement('jog-native-settings').hidden).toBe(true);
  });
  test('configured native Jog uses the bounded Action and lease, never cmd_vel or the legacy Worker', async () => {
    const { manager, slot, context, getElement, topics } = loadJog();
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/ros2-manual-jog.js'),'utf8'),context);
    const limits={max_translation_m:0.1,max_rotation_rad:0.3,max_linear_speed_mps:0.1,max_angular_speed_radps:0.2,
      max_linear_accel_mps2:0.2,max_angular_accel_radps2:0.4,max_duration_sec:2,max_stop_wait_sec:1,
      position_tolerance:0.001,linear_stop_tolerance_mps:0.01,angular_stop_tolerance_radps:0.01};
    slot.compatibilityProfile.transport={rosMajor:2};
    slot.compatibilityProfile.chassis.jog={protocol:'ros2_manual_jog',integrated:true,enabled:true,actionVerified:true,limitsVerified:true,limits,actionName:'/R_013/manual_jog/execute',reason:''};
    const at=Date.now();manager._safetyState=Object.fromEntries(['manual','idle','emo','sto','lidar','brake'].map(key=>[key,{value:true,at}]));
    manager._nativeJogAvailability={value:true,at};manager._nativeJogCharging={value:false,at};
    getElement('jog-native-distance').value='0.05';
    let finish;
    const handle={result:new Promise(resolve=>{finish=resolve;}),cancel:jest.fn(async()=>({cancelled:true}))};
    context.RosManager.createRos2Action=jest.fn(()=>handle);
    manager._ensureJogWorker=jest.fn();
    expect(manager._setVel(0.05,0,0)).toBe(true);
    expect(context.RosManager.createRos2Action).toHaveBeenCalledWith('/R_013/manual_jog/execute','spx_task_msgs/action/ManualJog',
      expect.objectContaining({axis:'x',displacement:0.05,max_speed:0.05}),0,expect.any(Function),expect.objectContaining({terminalResult:true}));
    expect(manager._ensureJogWorker).not.toHaveBeenCalled();
    expect(topics.every(t=>t.options.name.endsWith('/manual_jog/lease'))).toBe(true);
    manager._stopVel();await Promise.resolve();await Promise.resolve();
    expect(handle.cancel).toHaveBeenCalledTimes(1);expect(manager._nativeJogRun).not.toBeNull();
    finish({status:5,result:{success:false,stop_confirmed:true}});await manager._nativeJogRun.result;await Promise.resolve();
    expect(manager._nativeJogRun).toBeNull();expect(slot.nativeJogUnconfirmed).toBeUndefined();
  });
  test('safety monitoring uses the lightweight telemetry connection when available', () => {
    const { manager, context, topics, slot } = loadJog();
    const telemetryRos = {}; context.RosManager.getTelemetryRos = () => telemetryRos;
    manager._startTelemetry();
    try {
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.every(topic => topic.options.ros === telemetryRos)).toBe(true);
      expect(topics.every(topic => topic.options.ros !== slot.ros)).toBe(true);
    } finally { manager._stopTelemetry(false); }
  });
  test('a confirmed physical AUTO mode is distinct from missing mode telemetry', () => {
    const { manager, slot } = loadJog();
    const at = Date.now();
    manager._safetyState = Object.fromEntries(['manual', 'idle', 'emo', 'sto', 'lidar', 'brake'].map(key => [key, { value: true, at }]));
    manager._safetyState.manual.value = false;
    expect(manager._safetyEvaluation().reasons).toContain('로봇이 AUTO 상태입니다. 물리 MANUAL 모드가 필요합니다.');
    manager._safetyState.manual.at = at - 10000;
    expect(manager._safetyEvaluation().reasons).toContain('MANUAL 모드 미확인');
    expect(slot.ros).toBeDefined();
  });

  test('native ROS2 ManualJog never falls back to continuous cmd_vel, even if every IO signal is clear', () => {
    const { manager, slot } = loadJog();
    slot.compatibilityProfile.transport = { rosMajor: 2 };
    slot.compatibilityProfile.chassis.jog = { protocol: 'ros2_manual_jog', integrated: false, enabled: false, reason: 'manual_jog.enabled=false' };
    const at = Date.now();
    manager._safetyState = Object.fromEntries(['manual', 'idle', 'emo', 'sto', 'lidar', 'brake'].map(key => [key, { value: true, at }]));
    expect(manager._safetyEvaluation()).toMatchObject({ safe: false, reasons: ['manual_jog.enabled=false'] });
    expect(manager._getTopicName()).toBeNull();
    expect(manager._getTopic()).toBeNull();
    manager._refreshSafetyUi();
    expect(manager._setVel(0.1, 0, 0)).toBe(false);
  });

  test('native ROS2 brake=false is locked for Jog; ROS1 release semantics stay separate', () => {
    const { manager, slot, topics } = loadJog();
    slot.compatibilityProfile.chassis.jog = { protocol: 'ros2_manual_jog', reason: 'adapter unavailable' };
    manager._startTelemetry();
    try {
      const brake = topics.find(t => t.options.name.endsWith('/io/break_released'));
      brake.callback({ data: false });
      expect(manager._safetyState.brake.value).toBe(true);
      brake.callback({ data: true });
      expect(manager._safetyState.brake.value).toBe(false);
      brake.callback({ data: null });
      expect(manager._safetyState.brake.value).toBeNull();
    } finally { manager._stopTelemetry(false); }
  });

  test('graph discovery refreshes an already-open panel only for its active robot', () => {
    const { manager, slot } = loadJog();
    manager._syncChassisModelUi = jest.fn(); manager._startTelemetry = jest.fn(); manager._stopVel = jest.fn();
    manager._onCompatibilityUpdated({ detail: { robotId: 'another-robot' } });
    expect(manager._startTelemetry).not.toHaveBeenCalled();
    manager._onCompatibilityUpdated({ detail: { robotId: slot.robotId } });
    expect(manager._startTelemetry).toHaveBeenCalledTimes(1);
    expect(manager._stopVel).not.toHaveBeenCalled();
    manager._publishing = true;
    manager._onCompatibilityUpdated({ detail: { robotId: slot.robotId } });
    expect(manager._stopVel).toHaveBeenCalledTimes(1);
  });
  test('renders the requested controls without an analog joystick', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    [
      'jog-safety-summary',
      'jog-command-velocity',
      'jog-actual-velocity',
      'jog-lift-height',
      'jog-turntable-angle',
      'jog-turntable-sync-on',
      'jog-turntable-sync-off'
    ].forEach(id => expect(html).toContain(`id="${id}"`));
    expect(html).not.toContain('id="jog-analog-joystick"');
    expect(html).toContain('<kbd>R</kbd><kbd>V</kbd><kbd>T</kbd>');
  });

  test('holds drive input with pointer capture until release', () => {
    const { manager, getElement } = loadJog();
    const button = getElement('jog-fwd');
    button.setPointerCapture = jest.fn();
    button.hasPointerCapture = jest.fn(() => true);
    button.releasePointerCapture = jest.fn();
    manager._setVel = jest.fn(() => true);
    manager._stopVel = jest.fn();
    manager._releaseVel = jest.fn();
    manager._setupButtons();
    const listener = name => button.addEventListener.mock.calls
      .find(([event]) => event === name)?.[1];

    listener('pointerdown')({ pointerId: 7, preventDefault: jest.fn() });
    expect(button.setPointerCapture).toHaveBeenCalledWith(7);
    expect(manager._setVel).toHaveBeenCalledTimes(1);
    expect(manager._stopVel).not.toHaveBeenCalled();

    listener('pointerup')({ pointerId: 7 });
    expect(button.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(manager._releaseVel).toHaveBeenCalledTimes(1);
    expect(manager._stopVel).not.toHaveBeenCalled();
  });

  test('fails closed until every required STL safety signal is fresh and safe', () => {
    const { manager } = loadJog();
    manager._stopVel = jest.fn();
    manager._safetyState = manager._emptySafetyState();

    expect(manager._requireSafety('주행 Jog')).toBe(false);
    expect(manager._stopVel).toHaveBeenCalled();

    const at = Date.now();
    manager._safetyState = Object.fromEntries(
      ['manual', 'idle', 'emo', 'sto', 'lidar', 'brake'].map(key => [key, { value: true, at }])
    );
    expect(manager._safetyEvaluation()).toMatchObject({ safe: true, strict: true });

    manager._safetyState.sto.at = at - manager.SAFETY_STALE_MS - 1;
    expect(manager._safetyEvaluation().reasons).toContain('STO 정상 미확인');
  });

  test('treats unavailable event safety topics as N/A but blocks an explicit unsafe event', () => {
    const { manager, getElement } = loadJog();
    const at = Date.now();
    manager._safetyState = manager._emptySafetyState();
    ['manual', 'idle', 'sto', 'brake'].forEach(key => {
      manager._safetyState[key] = { value: true, at };
    });

    expect(manager._safetyEvaluation()).toMatchObject({ safe: true, strict: true });
    manager._refreshSafetyUi();
    expect(getElement('jog-safety-emo').textContent).toBe('EMO N/A');
    expect(getElement('jog-safety-lidar').textContent).toBe('LIDAR N/A');

    manager._safetyState.emo = { value: false, at };
    expect(manager._safetyEvaluation().reasons).toContain('EMO 정상 미확인');
  });

  test('routes cmd_vel through the dedicated worker when it is ready', () => {
    const { manager } = loadJog();
    manager._jogWorker = { postMessage: jest.fn() };
    manager._jogWorkerReady = true;
    manager._publishing = true;
    manager._currentLx = 0.2;
    manager._currentLy = 0;
    manager._currentAz = -0.1;

    expect(manager._publishOnce()).toBe(true);
    expect(manager._jogWorker.postMessage).toHaveBeenCalledWith({
      type: 'command',
      active: true,
      velocity: { lx: 0.2, ly: 0, az: -0.1 }
    });
  });

  test('keeps current commands on the already connected ROS channel until the dedicated bridge is ready', () => {
    const { manager } = loadJog();
    const publish = jest.fn(); manager._getTopic = () => ({ publish });
    manager._jogWorker = { postMessage: jest.fn() }; manager._jogWorkerReady = false;
    manager._publishing = true; manager._currentLx = 0.05;
    expect(manager._publishOnce()).toBe(true);
    expect(publish.mock.calls[0][0].linear.x).toBe(0.05);
    expect(manager._jogWorker.postMessage).not.toHaveBeenCalled();
    manager._currentLx = 0; manager._publishing = false; manager._publishOnce();
    expect(publish.mock.calls.at(-1)[0].linear.x).toBe(0);
    manager._jogWorkerReady = true; manager._publishing = true; manager._currentLx = 0.05;
    manager._publishOnce();
    expect(manager._jogWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
    expect(publish).toHaveBeenCalledTimes(2);
  });

  test('subscribes safety, feedback, and actual velocity topics and renders values', () => {
    const { manager, topics, getElement } = loadJog();
    manager._startTelemetry();
    const send = (name, message) => topics.find(topic => topic.options.name === name).callback(message);

    send('/R_013/io/select', { data: false });
    send('/R_013/robot_state', { workstate: 0 });
    send('/R_013/emergency_sensor', { data: [0, 0, 0, 0] });
    send('/R_013/sto_stop', { data: false });
    send('/R_013/io/lidar_field', { data: 0 });
    send('/R_013/io/break_released', { data: true });
    send('/R_013/motor_status', {
      feed_vel: { linear: { x: 0.12, y: 0 }, angular: { z: -0.2 } }
    });
    send('/R_013/Lift/feedback', { height: 1234, status: 1, error_code: 0 });
    send('/R_013/Turntable/feedback', { height: -9000, status: 6, error_code: 2 });

    expect(manager._safetyEvaluation().safe).toBe(true);
    ['/R_013/motor_status', '/R_013/odom'].forEach(name => {
      const topic = topics.find(item => item.options.name === name);
      expect(topic.options.throttle_rate).toBe(manager.VELOCITY_THROTTLE_MS);
      expect(topic.options.queue_length).toBe(1);
    });
    expect(getElement('jog-actual-velocity').textContent).toContain('Lx 0.12');
    expect(getElement('jog-lift-height').textContent).toBe('12.34°');
    expect(getElement('jog-lift-feedback-status').textContent).toBe('RUNNING');
    expect(getElement('jog-turntable-angle').textContent).toBe('-90.00°');
    expect(getElement('jog-turntable-sync-state').textContent).toBe('ON');
    expect(getElement('jog-turntable-error').textContent).toBe('0x0002');
    manager._stopTelemetry();
    expect(topics.every(topic => topic.unsubscribed)).toBe(true);
  });

  test('uses fresh odometry instead of holding a slower motor velocity sample', () => {
    const { manager, getElement } = loadJog();
    const now = Date.now();
    manager._actualVelocity = {
      motor: { lx: 0.05, ly: 0, az: 0, at: now - 500 },
      odom: { lx: 0.42, ly: 0, az: -0.1, at: now }
    };

    manager._renderVelocityComparison();

    expect(getElement('jog-actual-velocity').textContent).toContain('Lx 0.42');
    expect(getElement('jog-velocity-source').textContent).toContain('odom.twist');
  });

  test('maps R, V, T shortcuts to target, cancel, and Sync toggle', () => {
    const { manager, listeners } = loadJog();
    manager._runStlTurntableTarget = jest.fn();
    manager._cancelStlTurntable = jest.fn();
    manager._setTurntableSync = jest.fn();
    manager._setupKeyboard();
    const event = key => ({
      key,
      repeat: false,
      preventDefault: jest.fn(),
      stopImmediatePropagation: jest.fn()
    });

    listeners.keydown(event('r'));
    listeners.keydown(event('v'));
    listeners.keydown(event('t'));

    expect(manager._runStlTurntableTarget).toHaveBeenCalledWith(10);
    expect(manager._cancelStlTurntable).toHaveBeenCalled();
    expect(manager._setTurntableSync).toHaveBeenCalledWith(true);
  });

  test('stops an active Jog as soon as a safety input becomes unsafe', () => {
    const { manager } = loadJog();
    const at = Date.now();
    manager._safetyState = Object.fromEntries(
      ['manual', 'idle', 'emo', 'sto', 'lidar', 'brake'].map(key => [key, { value: true, at }])
    );
    manager._publishing = true;
    manager._stopJogControls = jest.fn(() => { manager._publishing = false; });

    manager._recordSafety('sto', false);

    expect(manager._stopJogControls).toHaveBeenCalledTimes(1);
    expect(manager._safetyEvaluation().safe).toBe(false);
  });

  test('calls the RID-scoped Turntable Sync service after confirmation', async () => {
    const { manager, context, serviceCalls } = loadJog();
    const at = Date.now();
    manager._safetyState = Object.fromEntries(
      ['manual', 'idle', 'emo', 'sto', 'lidar', 'brake'].map(key => [key, { value: true, at }])
    );
    manager._stopVel = jest.fn();
    manager._stopManualLift = jest.fn();

    await manager._setTurntableSync(true);

    expect(serviceCalls[0]).toMatchObject({
      options: {
        name: '/R_013/Turntable/sync_mode',
        serviceType: 'std_srvs/SetBool'
      },
      request: { data: true }
    });
    expect(context.confirm.mock.calls[0][0]).toContain('대상 RID: R_013');
  });

  test('risk confirmation includes RID, endpoint, and payload', () => {
    const { manager, context } = loadJog();
    expect(manager._confirmRiskyCommand('시험 명령', {
      rid: 'R_013',
      endpoint: '/R_013/Turntable/sync_mode',
      payload: '{ data: true }'
    })).toBe(true);
    const text = context.confirm.mock.calls[0][0];
    expect(text).toContain('대상 RID: R_013');
    expect(text).toContain('ROS endpoint: /R_013/Turntable/sync_mode');
    expect(text).toContain('Payload: { data: true }');
  });
});


describe('native ROS2 Lift admission versus drive Jog', () => {
  test('AUTO permits native Lift but blocks manual drive, with stale STO rejected', () => {
    const { manager, slot } = loadJog();
    slot.robotModel = 'stl1000_ros2';
    slot.compatibilityProfile.transport = { rosMajor: 2 };
    slot.compatibilityProfile.lift.admission = 'auto';
    const at = Date.now();
    manager._safetyState = Object.fromEntries(['manual', 'idle', 'emo', 'sto', 'lidar', 'brake'].map(key => [key, { value: key !== 'manual', at }]));
    expect(manager._safetyEvaluation()).toMatchObject({ safe: false, strict: true });
    expect(manager._nativeLiftSafetyEvaluation().safe).toBe(true);
    manager._safetyState.manual.value = true;
    expect(manager._safetyEvaluation().safe).toBe(true);
    expect(manager._nativeLiftSafetyEvaluation().safe).toBe(false);
    manager._safetyState.manual.value = false;
    manager._safetyState.sto.at = at - manager.SAFETY_STALE_MS - 1;
    expect(manager._nativeLiftSafetyEvaluation().reasons).toContain('STO 정상 미확인');
  });
});
