import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const [raw,controlFile,preflightFile]=process.argv.slice(2);
assert.match(raw,/^outputs\/local-backup\/qa07-cpu-[a-f0-9]{8}\.cpuprofile$/);
const bytes=fs.readFileSync(raw),profile=JSON.parse(bytes),control=JSON.parse(fs.readFileSync(controlFile,'utf8').replace(/^\uFEFF/,'')),preflight=JSON.parse(fs.readFileSync(preflightFile,'utf8'));
const deadline=Date.parse(preflight.recordedAt)+28000;
assert.ok(Date.parse(control.disabledAt)<=deadline,'Profiler must be disabled at least2seconds before nominal warmup end');
if(control.inspectorClosedAt)assert.ok(control.inspectorClosed&&Date.parse(control.inspectorClosedAt)<=deadline,'Inspector must be confirmed closed at least2seconds before nominal warmup end');
const nodes=new Map(profile.nodes.map(node=>[node.id,node]));
const parents=new Map();for(const node of profile.nodes)for(const child of node.children||[])parents.set(child,node.id);
const exclusive=new Map(),inclusive=new Map();let totalMicroseconds=0;
for(let index=0;index<profile.samples.length;index++){
 const elapsed=profile.timeDeltas[index],nodeId=profile.samples[index];totalMicroseconds+=elapsed;
 exclusive.set(nodeId,(exclusive.get(nodeId)||0)+elapsed);
 for(let id=nodeId;id!==undefined;id=parents.get(id))inclusive.set(id,(inclusive.get(id)||0)+elapsed);
}
const row=(id,microseconds)=>{const frame=nodes.get(id).callFrame;return{functionName:frame.functionName||'(anonymous)',script:frame.url.startsWith('node:')?frame.url:frame.url.split('/').pop()||'(native)',line:Number(frame.lineNumber)+1,column:Number(frame.columnNumber)+1,milliseconds:microseconds/1000,fraction:microseconds/totalMicroseconds};};
const top=map=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,50).map(([id,elapsed])=>row(id,elapsed));
const summary={version:'signal-qa07-cpu-warmup-v1',measuredAt:new Date().toISOString(),passed:true,scope:'Actual serving NodePID1 during original32session30s warmup with1000 synthetic profiles; profiler disabled/inspector close scheduled before unprofiled180s measurement',apiImageId:preflight.imageId,fixtureHash:preflight.fixtureHash,loadScriptHash:preflight.scriptHash,preflightPath:preflightFile,control,disabledBeforeNominalWarmupEndMilliseconds:Date.parse(preflight.recordedAt)+30000-Date.parse(control.disabledAt),sampleCount:profile.samples.length,totalSampleMicroseconds:totalMicroseconds,exclusiveHotspots:top(exclusive),inclusiveHotspots:top(inclusive),rawProfile:{path:raw,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,privateNotPackaged:true},limitations:['Inclusive rows overlap and must not be summed.','Profiler covers warmup, not measured latency; full fixed-profile latency is recorded separately.','CPU sampler gives function/subtree time; no individual DB-query wall clock timers were inserted into accepted app.'],rawSourceOrProfileCandidateDataExported:false};
fs.writeFileSync('outputs/verification/qa07-cpu-warmup.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({passed:true,imageId:preflight.imageId,samples:summary.sampleCount,disabledBeforeWarmupEndMs:summary.disabledBeforeNominalWarmupEndMilliseconds,topExclusive:summary.exclusiveHotspots.slice(0,10),topInclusive:summary.inclusiveHotspots.slice(0,10)}));
