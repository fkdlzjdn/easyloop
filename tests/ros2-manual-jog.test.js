const fs = require('fs'), path = require('path'), vm = require('vm');
const limits = { max_translation_m:0.1, max_rotation_rad:0.3, max_linear_speed_mps:0.1, max_angular_speed_radps:0.2,
  max_linear_accel_mps2:0.2, max_angular_accel_radps2:0.4, max_duration_sec:2, max_stop_wait_sec:1,
  position_tolerance:0.001, linear_stop_tolerance_mps:0.01, angular_stop_tolerance_radps:0.01 };
function harness() {
  const publishes = [], leaseTopics = [], document = { hidden:false };
  class Topic { constructor(options) { this.options = options; leaseTopics.push(this); } publish(msg) { publishes.push({topic:this.options.name,msg}); } unadvertise() { this.closed = true; } }
  let finish, fail;
  const result = new Promise((resolve,reject) => { finish=resolve; fail=reject; });
  const handle = {result,cancel:jest.fn(async()=>({cancelled:true}))};
  const createAction = jest.fn(()=>handle), safe = {value:true};
  const engine = vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/ros2-manual-jog.js'),'utf8')+'\nRos2ManualJog',
    {ROSLIB:{Topic,Message:class {constructor(x){Object.assign(this,x);}}},document,console,Date,setTimeout,clearTimeout,setInterval,clearInterval});
  const options = { ros:{}, robotId:'R_006', contract:{enabled:true,actionVerified:true,actionName:'/R_006/manual_jog/execute',limits:{...limits}},
    axis:'x',displacement:0.05,speed:0.05,createAction,canContinue:()=>safe.value };
  return {engine,options,handle,finish,fail,publishes,leaseTopics,createAction,safe,document};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
describe('bounded ROS2 ManualJog without any robot transport',()=>{
  beforeEach(()=>jest.useFakeTimers()); afterEach(()=>jest.useRealTimers());
  test('disabled, unconfigured and unsafe states never send a goal or lease',()=>{
    const h=harness();h.options.contract.enabled=false;expect(()=>h.engine.start(h.options)).toThrow();
    h.options.contract.enabled=true;h.options.contract.limits.max_translation_m=0;expect(()=>h.engine.start(h.options)).toThrow();
    h.options.contract.limits.max_translation_m=0.1;h.safe.value=false;expect(()=>h.engine.start(h.options)).toThrow();
    expect(h.createAction).not.toHaveBeenCalled();expect(h.publishes).toEqual([]);
  });
  test.each([{axis:'y'},{displacement:0},{displacement:NaN},{displacement:0.11},{speed:0.2},{axis:'theta',displacement:0.31}])('rejects invalid or excessive input %j before sending',change=>{
    const h=harness();Object.assign(h.options,change);expect(()=>h.engine.start(h.options)).toThrow();expect(h.createAction).not.toHaveBeenCalled();expect(h.publishes).toEqual([]);
  });
  test('uses the robot-specific action and matching lease ID; success requires stop proof',async()=>{
    const h=harness(),run=h.engine.start(h.options);const [name,type,goal,,options]=h.createAction.mock.calls[0];
    expect(name).toBe('/R_006/manual_jog/execute');expect(type).toBe('spx_task_msgs/action/ManualJog');
    expect(goal).toMatchObject({axis:'x',displacement:0.05,max_speed:0.05,timeout_sec:2,command_id:run.commandId});
    expect(options).toMatchObject({terminalResult:true,timeoutMs:5000});
    expect(h.publishes[0]).toEqual({topic:'/R_006/manual_jog/lease',msg:{data:run.commandId}});
    jest.advanceTimersByTime(100);expect(h.publishes).toHaveLength(3);
    h.finish({status:4,result:{success:true,stop_confirmed:true}});await expect(run.result).resolves.toMatchObject({phase:'completed',stopConfirmed:true});
    const count=h.publishes.length;jest.advanceTimersByTime(1000);expect(h.publishes).toHaveLength(count);expect(h.leaseTopics[0].closed).toBe(true);
  });
  test('release cancels only its own goal and waits for a stopped cancellation result',async()=>{
    const h=harness(),run=h.engine.start(h.options);run.stop();run.stop();await flush();
    expect(h.handle.cancel).toHaveBeenCalledTimes(1);expect(run.finished).toBe(false);expect(run.phase).toBe('stopping');
    const count=h.publishes.length;jest.advanceTimersByTime(500);expect(h.publishes).toHaveLength(count);
    h.finish({status:5,result:{success:false,stop_confirmed:true,error_code:'JOG_CANCELLED'}});
    await expect(run.result).resolves.toMatchObject({phase:'stopped',stopConfirmed:true});
  });
  test.each(['safety','hidden','timeout'])('%s stops renewing the lease and requests cancellation, not completion',async cause=>{
    const h=harness(),run=h.engine.start(h.options);
    if(cause==='safety')h.safe.value=false;if(cause==='hidden')h.document.hidden=true;
    jest.advanceTimersByTime(cause==='timeout'?2000:50);await flush();
    expect(run.stopped).toBe(true);expect(h.handle.cancel).toHaveBeenCalledTimes(1);expect(run.finished).toBe(false);
    h.finish({status:6,result:{success:false,stop_confirmed:true}});await run.result;
  });
  test('a claimed success without physical stop proof stays unknown',async()=>{
    const h=harness(),run=h.engine.start(h.options);h.finish({status:4,result:{success:true,stop_confirmed:false}});
    await expect(run.result).resolves.toMatchObject({phase:'unknown',stopConfirmed:false});
  });
  test('a lost result stops the lease and never reports a confirmed stop',async()=>{
    const h=harness(),run=h.engine.start(h.options);h.fail(new Error('connection lost'));
    await expect(run.result).resolves.toMatchObject({phase:'unknown',stopConfirmed:false});
    const count=h.publishes.length;jest.advanceTimersByTime(5000);expect(h.publishes).toHaveLength(count);
  });
  test('the identity cannot point to another robot or a legacy velocity action',()=>{
    const h=harness();h.options.contract.actionName='/R_025/manual_jog/execute';expect(()=>h.engine.start(h.options)).toThrow();
    expect(h.createAction).not.toHaveBeenCalled();
  });
});
