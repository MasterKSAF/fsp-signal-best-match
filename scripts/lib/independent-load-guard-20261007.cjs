const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const target=Object.freeze({database:'signal_independent_load_20261007',apiPort:4369,origin:'http://127.0.0.1:4370',container:'signal-qa-cycle-01-db-1',postgresPort:55435});
function validateEnvironment(env) {
 assert.equal(env.SIGNAL_INDEPENDENT_PERF_ACCEPTANCE,'1');
 const u=new URL(env.DATABASE_URL);assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55435');assert.equal(u.pathname,'/'+target.database);
 assert.equal(env.LOAD_API_ORIGIN,'http://127.0.0.1:4369');assert.equal(env.INTEGRATION_APP_ORIGIN,target.origin);
 assert.ok(!env.NODE_OPTIONS?.trim(),'No inherited Node preload/profiler');
}
function assertContainer(container) {
 assert.equal(container.Name,'/'+target.container);assert.equal(container.State.Running,true);
 const ports=container.NetworkSettings.Ports['5432/tcp'];assert.equal(ports.length,1);assert.equal(ports[0].HostIp,'127.0.0.1');assert.equal(ports[0].HostPort,'55435');
}
function assertProcess(expected,actual,listenerPid) {
 assert.ok(Number.isSafeInteger(expected.Id)&&expected.Id>0);assert.equal(listenerPid,expected.Id);assert.equal(actual.Id,expected.Id);assert.equal(actual.StartTime,expected.StartTime);assert.equal(actual.ProcessName,'node');
 const escaped=expected.apiPath.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 assert.ok(new RegExp('(?:^|[ \\t])"?'+escaped+'"?(?=$|[ \\t])').test(actual.CommandLine),'Only our exact immutable runtime command is permitted');
}
function assertAssets(runtime,{checkHarness=true}={}) {
 assert.equal(runtime.owner,'qa01_control');assert.equal(runtime.database,target.database);assert.equal(runtime.apiPort,target.apiPort);
 assert.equal(runtime.runtimeKind,'normal-delivery');assert.equal(path.basename(runtime.apiPath),'index.mjs');
 const names=Object.keys(runtime.deliveryFiles).sort();assert.equal(names.length,11);
 assert.deepEqual(fs.readdirSync(path.dirname(runtime.apiPath)).sort(),names);
 for(const name of names) {assert.match(name,/^[A-Za-z0-9._-]+\.(mjs|map|json)$/);assert.equal(sha(path.join(path.dirname(runtime.apiPath),name)),runtime.deliveryFiles[name]);}
 assert.equal(sha(runtime.apiPath),runtime.apiSha256);
 assert.equal(sha(runtime.fixturePath),runtime.fixtureSha256);assert.equal(sha(runtime.formsPath),runtime.formsSha256);
 if(checkHarness)for(const [file,hash] of Object.entries(runtime.harnessSources))assert.equal(sha(file),hash,'Owned harness changed');
}
module.exports={sha,target,validateEnvironment,assertContainer,assertProcess,assertAssets};
