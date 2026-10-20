const fs = require('fs'), path = require('path'), vm = require('vm');
function harness() {
  const storage = new Map(), nodes = new Map(), listeners = new Map();
  const node = () => ({ value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {}, classList: { add: jest.fn(), remove: jest.fn(), contains: () => true }, appendChild: jest.fn(), addEventListener: jest.fn(), focus: jest.fn() });
  const document = { getElementById: id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node,
    addEventListener: (name, fn) => { listeners.set(name, fn); } };
  const slot = { ip: '192.168.20.56', robotId: 'R_006', sshPort: 22, connected: true, ros: {}, bms: { soc: 30, charging: false, socValid: true, receivedAt: Date.now() } };
  const queues = { wait: { queue: [{ actionType: '0x07', name: 'StandBy', args: [0] }], loopFlag: 1 } };
  const topics = [];
  const sender = { getSavedQueues: () => queues, _runningTasks: new Map(), _resolveTaskInterface: jest.fn(async () => ({ resultName: '/R_006/task/result', resultType: 'spx_task_msgs/msg/TaskResult' })),
    sendSavedQueueToSlot: jest.fn(async (_name, index, _loop, id, options) => { options.beforeSend(app.robotSlots[index]); sender._runningTasks.set(slot.robotId, { taskId: id, state: 'work' }); return { actionCount: 1 }; }), cancelTaskOnSlot: jest.fn(async () => ({ success: true })) };
  const app = { _userRole: 'engineer', activeSlotIndex: 0, robotSlots: [slot], toast: jest.fn() };
  const context = { document, window: { addEventListener: jest.fn() }, localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    App: app, ActionSender: sender, OpMode: { mode: 'auto', isAuto: true, onChange: jest.fn() }, _escapeHtml: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])),
    ROSLIB: { Topic: class { constructor(options) { this.options = options; topics.push(this); } subscribe(callback) { this.callback = callback; } unsubscribe() { this.closed = true; } } },
    RobotCompatibility: { get: () => ({}) }, RosManager: {}, Date, Math, Map, Set, Promise, console, confirm: jest.fn(() => true), setInterval, clearInterval, setTimeout, clearTimeout };
  const manager = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/mission-scheduler.js'), 'utf8') + '\nMissionScheduler', context);
  manager.api = jest.fn(async () => ({ success: true, reservations: [] })); manager._clientId = 'test-client';
  const realRender = manager.render.bind(manager), realRenderLog = manager.renderLog.bind(manager);
  manager.render = jest.fn(); manager.renderLog = jest.fn();
  const mission = (extra = {}) => ({ id: 'mission1', name: 'scheduler test', queueName: 'wait', target: manager.target(slot), taskSignature: manager._signature(queues.wait), enabled: true, mode: 'once', timeoutSec: 60, batteryArmed: true, ...extra });
  const save = (extra = {}) => { const m = mission(extra); manager.saveAll([m]); return m; };
  return { manager, context, app, slot, sender, storage, nodes, topics, queues, save, document, realRender, realRenderLog };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
describe('mission scheduling and completion without robot access', () => {
  afterEach(() => jest.useRealTimers());
  test('manual once sends the bound robot and only becomes complete after its own result', async () => {
    const { manager:m, save, sender, topics } = harness(); save();
    const result = await m.executeMission('mission1', true); expect(result.ok).toBe(true);
    expect(m.getAll()[0].lastStatus).toBe('running'); expect(m.getAll()[0].lastSuccessAt).toBeUndefined();
    topics[0].callback({ task_id: 'someone-else', success: true }); expect(m._runs.size).toBe(1);
    topics[0].callback({ task_id: result.taskId, success: true }); await flush();
    expect(m._runs.size).toBe(0); expect(m.getAll()[0].lastStatus).toBe('completed'); expect(m.getAll()[0].lastSuccessAt).toBeDefined();
    expect(m.api).toHaveBeenCalledWith('release', expect.any(Object)); expect(sender._runningTasks.get('R_006').state).toBe('complete');
  });
  test('selecting another active robot does not retarget a scheduled Task', async () => {
    const { manager:m, save, app, sender } = harness(); save(); app.robotSlots.push({ ...app.robotSlots[0], ip: '192.168.20.75', robotId: 'R_025', ros: {} }); app.activeSlotIndex = 1;
    await m.executeMission('mission1', true); expect(sender.sendSavedQueueToSlot.mock.calls[0][1]).toBe(0);
  });
  test.each(['user','guest'])('rejects execution outside engineer role: %s', async role => {
    const { manager:m, save, app, sender } = harness(); save(); app._userRole = role; await m.executeMission('mission1', true); expect(sender.sendSavedQueueToSlot).not.toHaveBeenCalled();
  });
  test.each([{}, { socValid:false, soc:0, receivedAt:Date.now() }, { socValid:true, soc:20, receivedAt:Date.now()-16000 }, { socValid:true, soc:NaN, receivedAt:Date.now() }, { socValid:true, soc:'20', receivedAt:Date.now() }])('blocks missing/invalid/stale battery data %j', async bms => {
    const { manager:m, save, slot, sender } = harness(); save({ mode:'battery', batteryThreshold:40 }); slot.bms = bms;
    await m.executeMission('mission1', true); expect(sender.sendSavedQueueToSlot).not.toHaveBeenCalled();
  });
  test('charging permits only a real DockingOut first action, never its display name', async () => {
    const { manager:m, save, slot, sender, queues } = harness(); slot.bms.charging = true; queues.wait.queue[0].name = 'Docking Out'; save();
    await m.executeMission('mission1', true); expect(sender.sendSavedQueueToSlot).not.toHaveBeenCalled();
    queues.wait.queue[0].actionType = '0x10'; save(); expect((await m.executeMission('mission1', true)).ok).toBe(true);
  });
  test('changed task and infinite repetitions require operator correction', async () => {
    const { manager:m, save, queues, sender } = harness(); save(); queues.wait.queue[0].args = [9]; await m.executeMission('mission1', true);
    expect(sender.sendSavedQueueToSlot).not.toHaveBeenCalled(); queues.wait.loopFlag = 0; save(); await m.executeMission('mission1', true); expect(sender.sendSavedQueueToSlot).not.toHaveBeenCalled();
  });
  test('cannot send twice while preparing or running and waits for cancellation result', async () => {
    const { manager:m, save, sender, topics } = harness(); save(); const result = await m.executeMission('mission1', true);
    await m.executeMission('mission1', true); expect(sender.sendSavedQueueToSlot).toHaveBeenCalledTimes(1);
    await m.cancelMission('mission1'); expect(sender.cancelTaskOnSlot).toHaveBeenCalledWith(0); expect(m._runs.size).toBe(1);
    topics[0].callback({ task_id: result.taskId, success:false, message:'cancelled' }); await flush(); expect(m.getAll()[0].lastStatus).toBe('cancelled');
  });
  test('a rejected Task is failed; a lost post-send reply is unknown and keeps its reservation', async () => {
    const h = harness(); h.save();
    h.sender.sendSavedQueueToSlot.mockImplementation(async (_n,i,_l,_id,o) => { o.beforeSend(h.app.robotSlots[i]); throw Object.assign(new Error('rejected'), {code:'TASK_REJECTED'}); });
    await h.manager.executeMission('mission1',true); expect(h.manager.getAll()[0].lastStatus).toBe('failed'); expect(h.manager._runs.size).toBe(0);
    h.save(); h.manager.api.mockClear(); h.sender.sendSavedQueueToSlot.mockImplementation(async (_n,i,_l,_id,o) => { o.beforeSend(h.app.robotSlots[i]); throw new Error('network lost'); });
    await h.manager.executeMission('mission1',true); expect(h.manager.getAll()[0].lastStatus).toBe('unknown'); expect(h.manager._runs.size).toBe(1);
    expect(h.manager.api.mock.calls.some(([op])=>op==='release')).toBe(false);
  });
  test('a robot connection swap or logout during discovery is rechecked before the write', async () => {
    const h = harness(); h.save(); let release; h.manager._observe = () => new Promise(resolve => { release = resolve; });
    const running = h.manager.executeMission('mission1',true); await flush(); h.app.robotSlots[0] = {...h.slot,ros:{}}; release(); await running;
    expect(h.manager.getAll()[0].lastStatus).toBe('failed'); expect(h.sender._runningTasks.size).toBe(0);
  });
  test('cancel during preparation never writes the Task', async () => {
    const h = harness(); h.save(); let release; h.manager._observe = () => new Promise(resolve=> {release=resolve;});
    const running=h.manager.executeMission('mission1',true); await flush(); await h.manager.cancelMission('mission1'); release(); await running;
    expect(h.sender._runningTasks.size).toBe(0); expect(h.manager.getAll()[0].lastStatus).toBe('cancelled');
  });
  test('a result arriving before acceptance is held then processed correctly', async () => {
    const h=harness(); h.save(); h.sender.sendSavedQueueToSlot.mockImplementation(async (_n,i,_l,id,o)=>{o.beforeSend(h.slot);h.topics[0].callback({task_id:id,success:true});h.sender._runningTasks.set(h.slot.robotId,{taskId:id,state:'work'});return{};});
    await h.manager.executeMission('mission1',true); await flush(); expect(h.manager.getAll()[0].lastStatus).toBe('completed'); expect(h.sender._runningTasks.get(h.slot.robotId).state).toBe('complete');
  });
  test('cron runs once per local calendar day, never repeats within the matching minute', async () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-20T09:00:00'));
    const h=harness();h.save({mode:'cron',cronTime:'09:00'});h.manager._armed=true;h.manager.tick();await flushPromises();
    const run=[...h.manager._runs.values()][0];h.topics[0].callback({task_id:run.taskId,success:true});await flushPromises();
    jest.advanceTimersByTime(30000);h.slot.bms.receivedAt=Date.now();h.manager.tick();await flushPromises();expect(h.sender.sendSavedQueueToSlot).toHaveBeenCalledTimes(1);
  });
  test('battery edge is consumed once and rearmed only after leaving the condition', async () => {
    const h=harness();h.save({mode:'battery',batteryThreshold:40,batteryCondition:'below'});h.manager._armed=true;h.manager.tick();await flush();
    const run=[...h.manager._runs.values()][0];h.topics[0].callback({task_id:run.taskId,success:true});await flush();
    h.manager.tick();await flush();expect(h.sender.sendSavedQueueToSlot).toHaveBeenCalledTimes(1);
    h.slot.bms.soc=50;h.manager._update('mission1',{lastAttemptAt:0});h.manager.tick();expect(h.manager.getAll()[0].batteryArmed).toBe(true);
  });
  test('reservation collision blocks transmission and storage failure blocks a write', async () => {
    const h=harness();h.save();h.manager.api.mockRejectedValue(new Error('other tab owns robot'));await h.manager.executeMission('mission1',true);expect(h.sender.sendSavedQueueToSlot).not.toHaveBeenCalled();
    h.manager.api.mockResolvedValue({success:true});h.context.localStorage.setItem=()=>{throw new Error('quota');};await h.manager.executeMission('mission1',true);expect(h.sender.sendSavedQueueToSlot).not.toHaveBeenCalled();
  });
  test('reloaded in-flight execution remains unknown; scheduler never restores AUTO/armed state', () => {
    const h=harness();h.storage.set(h.manager.RUN_KEY,JSON.stringify([{id:'old',missionId:'mission1',target:h.manager.target(h.slot),taskId:'oldtask'}]));h.manager.init();
    expect(h.manager._armed).toBe(false);expect(h.manager._runs.get('old').phase).toBe('unknown');clearInterval(h.manager._timer);
  });
  test('interval never replays missed time while disarmed and arm restarts its delay', async () => {
    const h=harness();h.save({mode:'interval',intervalSec:60,nextDue:Date.now()-1000});h.manager.tick();await flush();expect(h.sender.sendSavedQueueToSlot).not.toHaveBeenCalled();
    await h.manager.arm();expect(h.manager.getAll()[0].nextDue).toBeGreaterThan(Date.now()+59000);h.manager.tick();await flush();expect(h.sender.sendSavedQueueToSlot).not.toHaveBeenCalled();
  });
  test('timeout holds an unknown task instead of reporting complete or canceling it automatically', async () => {
    const h=harness();h.save();await h.manager.executeMission('mission1',true);const run=[...h.manager._runs.values()][0];run.startedAt=Date.now()-61000;h.manager.tick();
    expect(run.phase).toBe('unknown');expect(h.manager.getAll()[0].lastSuccessAt).toBeUndefined();expect(h.sender.cancelTaskOnSlot).not.toHaveBeenCalled();
  });
  test('a confirmed cancel result permits a later manual run, never before the result',async()=>{
    const h=harness();h.save();const first=await h.manager.executeMission('mission1',true);await h.manager.cancelMission('mission1');await h.manager.executeMission('mission1',true);expect(h.sender.sendSavedQueueToSlot).toHaveBeenCalledTimes(1);
    h.topics[0].callback({task_id:first.taskId,success:false,message:'cancelled'});await flush();await h.manager.executeMission('mission1',true);expect(h.sender.sendSavedQueueToSlot).toHaveBeenCalledTimes(2);
  });
  test('cancel refuses to cancel a newer unrelated task on the same robot',async()=>{
    const h=harness();h.save();await h.manager.executeMission('mission1',true);h.sender._runningTasks.set(h.slot.robotId,{taskId:'operator-task',state:'work'});await h.manager.cancelMission('mission1');expect(h.sender.cancelTaskOnSlot).not.toHaveBeenCalled();expect(h.manager.getAll()[0].lastStatus).toBe('unknown');
  });
  test('a zero-percent valid reading is a real value; observation-only ROS2 cannot execute',async()=>{
    const h=harness();h.slot.bms.soc=0;h.save({mode:'battery',batteryThreshold:0});expect((await h.manager.executeMission('mission1',true)).ok).toBe(true);
    const blocked=harness();blocked.save();blocked.slot.rosControlEnabled=false;await blocked.manager.executeMission('mission1',true);expect(blocked.sender.sendSavedQueueToSlot).not.toHaveBeenCalled();
  });
  test('logout during asynchronous preparation blocks the eventual write',async()=>{
    const h=harness();h.save();let release;h.manager._observe=()=>new Promise(resolve=>{release=resolve;});const run=h.manager.executeMission('mission1',true);await flush();h.app._userRole='user';release();await run;expect(h.sender._runningTasks.size).toBe(0);
  });
  test('storage failure during automatic battery rearm disarms without an uncaught timer error',()=>{
    const h=harness();h.save({mode:'battery',batteryThreshold:40,batteryArmed:false});h.slot.bms.soc=60;h.manager._armed=true;h.context.localStorage.setItem=()=>{throw new Error('quota');};expect(()=>h.manager.tick()).not.toThrow();expect(h.manager._armed).toBe(false);expect(h.manager._storageFault).toBe(true);
  });
  test('another tab reviewing a changed Task while this run prepares invalidates the pending write',async()=>{
    const h=harness();h.save();let release;h.manager._observe=()=>new Promise(resolve=>{release=resolve;});const run=h.manager.executeMission('mission1',true);await flush();h.queues.wait.queue[0].args=[99];h.manager._update('mission1',{taskSignature:h.manager._signature(h.queues.wait)});release();await run;expect(h.sender._runningTasks.size).toBe(0);expect(h.manager.getAll()[0].lastReason).toContain('미션 정의가 변경');
  });
  test('a restored unknown execution cannot issue a blind robot-wide cancel',async()=>{
    const h=harness();h.storage.set(h.manager.RUN_KEY,JSON.stringify([{id:'restored',missionId:'mission1',target:h.manager.target(h.slot),taskId:'old'}]));h.manager.init();await h.manager.cancelMission('mission1');expect(h.sender.cancelTaskOnSlot).not.toHaveBeenCalled();expect(h.manager._runs.get('restored').phase).toBe('unknown');expect(h.app.toast).toHaveBeenCalled();clearInterval(h.manager._timer);
  });
  test('HTML in names or robot errors is escaped in scheduler and log rendering', () => {
    const h=harness();h.save({name:'<img src=x onerror=alert(1)>',lastReason:'<script>bad</script>'});h.realRender();h.manager.renderLog=h.realRenderLog;h.manager.addLog('<script>bad</script>');
    expect(h.nodes.get('scheduler-list').innerHTML).not.toContain('<img');expect(h.nodes.get('scheduler-log').innerHTML).not.toContain('<script>');
  });
});
async function flushPromises(){for(let i=0;i<20;i++)await Promise.resolve();}
