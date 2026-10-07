// Owned diagnostic cleanup controller, passed to docker exec node -e only.
(async()=>{
 const origin='http://127.0.0.1:9229';
 const targets=await(await fetch(origin+'/json/list',{signal:AbortSignal.timeout(1000)})).json();
 const target=targets.find(item=>item.type==='node');
 if(!target)throw Error('Exact Node inspector target unavailable');
 const ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Inspector cleanup CDP timeout')),2000);
  ws.onmessage=event=>{const response=JSON.parse(event.data);if(response.id===1){clearTimeout(timer);response.error?reject(Error(response.error.message)):resolve(response.result);}};
  ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:"(()=>{setTimeout(()=>process.getBuiltinModule('node:inspector').close(),200);return true;})()",returnByValue:true}}));
 });
 if(result.exceptionDetails||result.result?.value!==true){ws.close();throw Error('Inspector close expression did not execute');}
 ws.close();
 await new Promise(resolve=>setTimeout(resolve,500));
 let reachable=true;
 try{await fetch(origin+'/json/list',{signal:AbortSignal.timeout(1000)});}catch(error){if(error.cause?.code!=='ECONNREFUSED')throw Error('Inspector close probe was inconclusive');reachable=false;}
 if(reachable)throw Error('Inspector port remains reachable after cleanup');
 console.log(JSON.stringify({passed:true,confirmedClosed:true,confirmedAt:new Date().toISOString(),scope:'Diagnostic inspector cleanup only, after original full load measurement; Profiler stop/disable occurred before measurement separately'}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
