import assert from 'node:assert/strict';

/** The presentation uses the same frozen original full-profile validator as the load owner. */
export {validateFullLoadProof} from './multi-resume-load-proof-v060.mjs';

/** Prevents old screenshots or human-pilot claims from becoming current slide evidence. */
export function validateMediaAgreement(content,agreement,browserSourceSha256,apiBundleSha256) {
  assert.equal(content.applicationVersion,'0.6.0');assert.equal(agreement.applicationVersion,'0.6.0');
  assert.equal(content.mediaCapture?.synthetic,true);assert.equal(content.mediaCapture?.technicalAgentCheck,true);
  assert.equal(content.mediaCapture?.humanPilot,false);
  assert.equal(agreement.passed,true);assert.equal(agreement.sameVisibleUI,true);
  assert.equal(agreement.browserSourceSha256,browserSourceSha256);assert.match(browserSourceSha256??'',/^[a-f0-9]{64}$/);
  assert.equal(agreement.apiBundleSha256,apiBundleSha256);assert.match(apiBundleSha256??'',/^[a-f0-9]{64}$/);
  const screenshots=Object.entries(content.screenshots??{});assert.equal(screenshots.length,8);
  for(const [key,record]of screenshots) {
    assert.ok(record.path?.startsWith('outputs/release-0.6.0/media/'));assert.match(record.sha256??'',/^[a-f0-9]{64}$/);
    assert.equal(agreement.originalMediaHashes?.[key],record.sha256);
  }
  assert.equal(Object.keys(agreement.originalMediaHashes??{}).length,8);
  assert.ok(Object.keys(agreement.currentUIHashes??{}).length>0);
  return {screenshots:8,synthetic:true,humanPilot:false,apiBundleSha256};
}

export function validateCleanSourceProof(report,seal) {
  assert.equal(report.passed,true);assert.equal(report.applicationVersion,'0.6.0');assert.equal(seal.applicationVersion,'0.6.0');assert.equal(report.sourceSha256,seal.sourceSha256);
  assert.match(report.sourceSha256??'',/^[a-f0-9]{64}$/);assert.match(seal.metadata?.matchingAlgorithmSha256??'',/^[a-f0-9]{64}$/);assert.match(report.runtime?.bundleSHA??'',/^[a-f0-9]{64}$/);
  assert.equal(report.freshDependencies,true);assert.equal(report.freshEmptyDatabase,true);assert.equal(report.unitSuite?.status,'PASS');assert.equal(report.cleanup,'complete');assert.equal(report.protectedRuntimePreserved,true);
  assert.equal(report.runtime?.sourceMatchesSealed,true);assert.equal(report.runtime?.bundleMatchesAccepted,true);assert.equal(report.runtime?.bundleSHA,seal.metadata?.acceptedRuntime?.bundleSHA);
  assert.ok(Object.keys(seal.metadata?.acceptedRuntime?.sourceHashes??{}).length>0);
  for(const [relative,expected]of Object.entries(seal.metadata.acceptedRuntime.sourceHashes))assert.equal(report.runtime?.sourceHashes?.[relative],expected);
  assert.equal(report.http?.status,'PASS');assert.equal(report.http?.realPdf,true);assert.equal(report.http?.ordinaryCleanup,true);assert.equal(report.http?.reviewerProof?.cleanup,true);assert.ok(report.http?.reviewerProof?.groups>=13);
  assert.equal(report.offlineReproduction?.length,3);assert.ok(report.offlineReproduction.every(row=>row.semanticOutcomesEqual===true&&row.actualSourceSHA===seal.metadata?.matchingAlgorithmSha256));
  return {unitTests:Number.isInteger(report.unitSuite.tests)&&report.unitSuite.tests>0?report.unitSuite.tests:null,sourceSha256:report.sourceSha256};
}
