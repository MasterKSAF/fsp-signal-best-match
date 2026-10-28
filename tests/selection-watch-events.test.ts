import assert from 'node:assert/strict';
import test,{before} from 'node:test';
process.env.DATABASE_URL??='postgresql://signal:unusable@127.0.0.1:1/signal';
let deriveWatchChanges:typeof import('../artifacts/api-server/src/lib/selection-watch').deriveWatchChanges;
let baselineWatchKeys:typeof import('../artifacts/api-server/src/lib/selection-watch').baselineWatchKeys;
before(async()=>{({deriveWatchChanges,baselineWatchKeys}=await import('../artifacts/api-server/src/lib/selection-watch'));});
const original={candidateId:11,resumeId:101,resumeRevision:1,proofHash:'hash-a',proofKeys:['proof-a'],position:11};
test('proof removal never looks like a new confirmation',()=>{
 assert.deepEqual(deriveWatchChanges([original],[{...original,proofHash:'revoked',proofKeys:[]}],baselineWatchKeys([original])).changes,[]);
});
test('a known person returning with a new proof keeps the proof reason and exact CV',()=>{
 const after={...original,resumeId:102,proofHash:'hash-b',proofKeys:['proof-b']};
 const changes=deriveWatchChanges([], [after],baselineWatchKeys([original])).changes;
 assert.equal(changes.length,1);assert.equal(changes[0].reason,'new_proof');assert.equal(changes[0].entry.resumeId,102);
});
test('the same confirmation returning after loss of access does not produce another proof event',()=>{
 assert.equal(deriveWatchChanges([], [original],baselineWatchKeys([original])).changes.length,0);
});
test('legacy baselines acquire proof-set keys without inventing confirmation history',()=>{
 const legacy={...original,proofKeys:undefined},updated={...original,proofHash:'b',proofKeys:['b']};
 const delta=deriveWatchChanges([legacy],[updated],baselineWatchKeys([legacy]));assert.equal(delta.changes.length,0);
 assert.equal(deriveWatchChanges([updated],[{...updated,proofHash:'c',proofKeys:['c']}],delta.seen).changes[0].reason,'new_proof');
});
test('top-entry has a separate reason and only occurs once for this evidence version',()=>{
 const top={...original,position:10},delta=deriveWatchChanges([original],[top],baselineWatchKeys([original]));
 assert.equal(delta.changes[0].reason,'entered_top');assert.equal(deriveWatchChanges([original],[top],delta.seen).changes.length,0);
});
