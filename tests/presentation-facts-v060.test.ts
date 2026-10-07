import assert from 'node:assert/strict';
import test from 'node:test';
import {validateMediaAgreement,validateCleanSourceProof,validateFullLoadProof} from '../scripts/lib/presentation-facts-v060.mjs';

function media(): any {
  const screenshots=Object.fromEntries(Array.from({length:8},(_,i)=>[`screen${i}`,{path:`outputs/release-0.6.0/media/screen-${i}.jpg`,sha256:String(i).repeat(64)}]));
  const content={applicationVersion:'0.6.0',mediaCapture:{synthetic:true,technicalAgentCheck:true,humanPilot:false},screenshots};
  const agreement={applicationVersion:'0.6.0',passed:true,sameVisibleUI:true,browserSourceSha256:'a'.repeat(64),apiBundleSha256:'b'.repeat(64),currentUIHashes:{'artifacts/fsp-signal/src/App.tsx':'c'.repeat(64)},originalMediaHashes:Object.fromEntries(Object.entries(screenshots).map(([key,value]:any)=>[key,value.sha256]))};
  return {content,agreement};
}

test('current eight technical screenshots keep explicit synthetic and no-human scope',()=>{
  const {content,agreement}=media();assert.deepEqual(validateMediaAgreement(content,agreement,'a'.repeat(64),'b'.repeat(64)),{screenshots:8,synthetic:true,humanPilot:false,apiBundleSha256:'b'.repeat(64)});
});
test('an old screenshot, changed source, changed bundle or partial media agreement cannot become current evidence',()=>{
  const mutations=[(c:any)=>c.screenshots.screen0.path='outputs/release-0.5.0/media/screen-0.jpg',(c:any)=>c.screenshots.screen0.sha256=null,(_c:any,a:any)=>a.apiBundleSha256='d'.repeat(64),(_c:any,a:any)=>a.browserSourceSha256='d'.repeat(64),(_c:any,a:any)=>delete a.originalMediaHashes.screen0,(_c:any,a:any)=>a.currentUIHashes={},(_c:any,a:any)=>a.sameVisibleUI=false];
  for(const mutate of mutations){const {content,agreement}=media();mutate(content,agreement);assert.throws(()=>validateMediaAgreement(content,agreement,'a'.repeat(64),'b'.repeat(64)));}
});
test('synthetic reviewer evidence cannot be relabeled a human pilot or a legacy release',()=>{
  for(const mutate of [(c:any)=>c.mediaCapture.humanPilot=true,(c:any)=>c.mediaCapture.synthetic=false,(c:any)=>c.mediaCapture.technicalAgentCheck=false,(_c:any,a:any)=>a.applicationVersion='0.5.0']){const {content,agreement}=media();mutate(content,agreement);assert.throws(()=>validateMediaAgreement(content,agreement,'a'.repeat(64),'b'.repeat(64)));}
});
test('legacy full-load and clean PASS labels alone cannot authorize 0.6 slide claims',()=>{
  assert.throws(()=>validateFullLoadProof({status:'PASS',executionMode:'acceptance',applicationVersion:'0.5.0',target:{key:'dedicated-v1'}}));
  assert.throws(()=>validateCleanSourceProof({passed:true,applicationVersion:'0.5.0'},{applicationVersion:'0.5.0'}));
});
