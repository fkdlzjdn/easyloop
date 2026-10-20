const fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/test-mode.js'),'utf8');
test.each([['complete',true],['cancel',false],['error',false]])('virtual %s emits a correlated terminal result even for an inactive robot',(state,success)=>{
 const events=[];const context={document:{addEventListener:()=>{},dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},App:{activeSlotIndex:0},ActionSender:{_runningTasks:new Map(),_setTaskExecutionFeedback:jest.fn()},console,setTimeout,clearTimeout,setInterval,clearInterval};
 const manager=vm.runInNewContext(source+'\nTestMode',context);
 manager._notifyVirtualTaskFeedback({robotId:'R_901',slotIndex:1,completedLoops:1,task:{taskId:'scheduler-test',actionIndex:0,actions:[{}]}},state,'test terminal');
 expect(events).toHaveLength(1);expect(events[0].type).toBe('easyloop:task-result');expect(events[0].detail).toMatchObject({robotId:'R_901',task_id:'scheduler-test',success});
});
