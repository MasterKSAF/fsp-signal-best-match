import test from 'node:test';
import assert from 'node:assert/strict';
import { FreshJsonPoolCache } from '../artifacts/api-server/src/lib/signal-fresh-pool-cache';
test('every hit requires a fresh complete fingerprint; same in-flight snapshot is coalesced and deeply frozen',async()=>{
  const cache=new FreshJsonPoolCache<{id:number;skills:string[]}>(); let reads=0; let release!:()=>void;
  const load=async()=>{reads++;await new Promise<void>(resolve=>release=resolve);return{fingerprint:'sha-A',data:[{id:1,skills:['Python']}]};};
  const first=cache.read('ordinary/matching','sha-A',load),second=cache.read('ordinary/matching','sha-A',load); release();
  assert.deepEqual(await first,await second);assert.equal(reads,1);
  const hit=await cache.read('ordinary/matching','sha-A',async()=>{throw new Error('Unexpected load');});
  assert.ok(Object.isFrozen(hit)&&Object.isFrozen(hit[0])&&Object.isFrozen(hit[0]!.skills));
  assert.throws(()=>hit[0]!.skills.push('SQL'),TypeError);
  const changed=await cache.read('ordinary/matching','sha-hidden',async()=>({fingerprint:'sha-hidden',data:[]}));assert.deepEqual(changed,[]);
  const scoped=await cache.read('reviewer/matching','sha-A',async()=>({fingerprint:'sha-A',data:[{id:2,skills:[]}]})); assert.equal(scoped[0]?.id,2);
});
test('a miss stores its content-own SQL fingerprint, never the earlier preflight fingerprint',async()=>{
  const cache=new FreshJsonPoolCache<number>(); await cache.read('scope','before',async()=>({fingerprint:'after',data:[2]}));
  let reads=0; const before=await cache.read('scope','before',async()=>{reads++;return{fingerprint:'before',data:[1]};}); assert.deepEqual(before,[1]);assert.equal(reads,1);
  const after=await cache.read('scope','after',async()=>{throw new Error('Should hit own hash');});assert.deepEqual(after,[2]);
});
test('entry count and conservative byte budget are hard boundaries; failed reads never poison a key',async()=>{
  const cache=new FreshJsonPoolCache<number>(2,4096);const put=(key:string,value:number)=>cache.read('scope',key,async()=>({fingerprint:key,data:[value]}));
  await put('a',1);await put('b',2);await put('c',3);let reread=false;
  await cache.read('scope','a',async()=>{reread=true;return{fingerprint:'a',data:[1]};});assert.ok(reread);
  const tiny=new FreshJsonPoolCache<string>(2,10);let reads=0;const large=()=>tiny.read('scope','large',async()=>{reads++;return{fingerprint:'large',data:['more than budget']};});await large();await large();assert.equal(reads,2);
  await assert.rejects(cache.read('scope','error',async()=>{throw new Error('DB failed');}),/DB failed/);
  assert.deepEqual(await put('error',4),[4]);
});

test('ABA visibility race never gives a late coalesced caller the earlier mismatched snapshot',async()=>{
  const cache=new FreshJsonPoolCache<{resumeId:number}>();let release!:()=>void,loads=0;
  const first=cache.read('scope/matching','hidden-A',async()=>{
    loads++;await new Promise<void>(resolve=>release=resolve);
    return {fingerprint:'visible-B',data:[{resumeId:7}]};
  });
  const late=cache.read('scope/matching','hidden-A',async()=>{
    loads++;return {fingerprint:'hidden-A',data:[]};
  });
  release();
  assert.deepEqual(await first,[{resumeId:7}]);
  assert.deepEqual(await late,[]);assert.equal(loads,2);
  assert.deepEqual(await cache.read('scope/matching','hidden-A',async()=>{throw new Error('Exact safe snapshot should hit');}),[]);
});

test('queued builders re-read their own current complete hash and never cross a hidden or moved reviewer pool',async()=>{
  const cache=new FreshJsonPoolCache<{resumeId:number}>();let release!:()=>void;
  const blocker=cache.read('other-context','other',async()=>{
    await new Promise<void>(resolve=>release=resolve);return{fingerprint:'other',data:[]};
  });
  let state='visible',freshReads=0,loads=0;
  const queued=cache.read('reviewer-A','visible',async()=>{
    loads++;return{fingerprint:state,data:state==='visible'?[{resumeId:7}]:[]};
  },async()=>{freshReads++;return state;});
  state='hidden-or-moved';assert.equal(freshReads,0,'Own fresh statement occurs after the queue, not before it');
  release();await blocker;assert.deepEqual(await queued,[]);assert.equal(freshReads,1);assert.equal(loads,1);
  const moved=await cache.read('reviewer-B','hidden-or-moved',async()=>({fingerprint:'hidden-or-moved',data:[{resumeId:8}]}));
  assert.deepEqual(moved,[{resumeId:8}],'Identical hash text cannot reuse another exact pool context');
  assert.equal(cache.diagnostics().peakSnapshotBuilders,1);
});

test('queue reuses retained content only after a new caller-owned exact hash; ABA mismatch also owns a current statement',async()=>{
  const cache=new FreshJsonPoolCache<number>();
  await cache.read('target','current-B',async()=>({fingerprint:'current-B',data:[2]}));
  let release!:()=>void,freshReads=0;
  const blocker=cache.read('blocker','blocked',async()=>{await new Promise<void>(resolve=>release=resolve);return{fingerprint:'blocked',data:[]};});
  const queued=cache.read('target','old-A',async()=>{throw new Error('Exact current B should reuse only after own fresh read');},async()=>{freshReads++;return'current-B';});
  assert.equal(freshReads,0);release();await blocker;assert.deepEqual(await queued,[2]);assert.equal(freshReads,1);assert.equal(cache.diagnostics().queuedReuses,1);
  let releaseABA!:()=>void,ownReads=0;
  const first=cache.read('aba','A',async()=>{await new Promise<void>(resolve=>releaseABA=resolve);return{fingerprint:'B',data:[7]};},async()=>{throw new Error('Immediate builder does not need extra preflight');});
  const late=cache.read('aba','A',async()=>({fingerprint:'A',data:[]}),async()=>{ownReads++;return'A';});
  releaseABA();assert.deepEqual(await first,[7]);assert.deepEqual(await late,[]);assert.equal(ownReads,1);
});

test('snapshot admission is FIFO, includes decoding/store, and rejection releases the permit without poisoning later callers',async()=>{
  const cache=new FreshJsonPoolCache<number>();let release!:()=>void,active=0,peak=0;const order:string[]=[];
  const first=cache.read('one','A',async()=>{active++;peak=Math.max(peak,active);order.push('one');await new Promise<void>(resolve=>release=resolve);active--;throw new Error('Failed own SQL');});
  const fail=assert.rejects(first,/Failed own SQL/);
  const build=(name:string)=>cache.read(name,name,async()=>{active++;peak=Math.max(peak,active);order.push(name);await Promise.resolve();active--;return{fingerprint:name,data:[name.length]};});
  const second=build('two'),third=build('three');release();await fail;
  assert.deepEqual(await second,[3]);assert.deepEqual(await third,[5]);assert.deepEqual(order,['one','two','three']);assert.equal(peak,1);
  assert.equal(cache.diagnostics().waitingBuilders,0);assert.equal(cache.diagnostics().snapshotBuilders,0);assert.equal(cache.diagnostics().inflight,0);
});
