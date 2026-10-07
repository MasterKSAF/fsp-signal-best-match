// Passed as owned source to docker exec node -e; never installed into serving code.
const fs=require('node:fs');
const id=process.argv[1];
if(!/^[a-f0-9]{8}$/.test(id||''))throw Error('Exact diagnostic run ID required');
(async()=>{
 const targets=await(await fetch('http://127.0.0.1:9229/json/list')).json();
 const target=targets.find(t=>t.type==='node');if(!target)throw Error('PID1 inspector target unavailable');
 const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let sequence=0;
 ws.onmessage=e=>{const response=JSON.parse(e.data);if(response.id){const item=pending.get(response.id);if(item){pending.delete(response.id);response.error?item.reject(Error(response.error.message)):item.resolve(response.result);}}};
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const number=++sequence;pending.set(number,{resolve,reject});ws.send(JSON.stringify({id:number,method,params}));});
 await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:1000});await call('Profiler.start');
 const startedAt=new Date().toISOString();
 await new Promise(resolve=>setTimeout(resolve,20000));
 const result=await call('Profiler.stop'),stopAcknowledgedAt=new Date().toISOString();
 await call('Profiler.disable');const disabledAt=new Date().toISOString();
 const file=`/tmp/fsp-qa07-${id}.cpuprofile`;fs.writeFileSync(file,JSON.stringify(result.profile));
 const closing=await call('Runtime.evaluate',{expression:"(()=>{setTimeout(()=>process.getBuiltinModule('node:inspector').close(),200);return true;})()",returnByValue:true});
 if(closing.exceptionDetails||closing.result?.value!==true){ws.close();throw Error('Inspector close expression did not execute');}
 ws.close();
 await new Promise(resolve=>setTimeout(resolve,500));
 let inspectorClosed=false;
 try{await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(1000)});}catch(error){if(error.cause?.code==='ECONNREFUSED')inspectorClosed=true;}
 if(!inspectorClosed)throw Error('Inspector port closure before measured load not confirmed');
 const inspectorClosedAt=new Date().toISOString();
 console.log(JSON.stringify({passed:true,runId:id,startedAt,stopAcknowledgedAt,disabledAt,profilePath:file,samplingIntervalMicroseconds:1000,durationSeconds:20,inspectorCloseScheduled:true,inspectorClosed,inspectorClosedAt}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
