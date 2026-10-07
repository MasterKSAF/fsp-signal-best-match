"""Validate the actual cycle2 delivery after sealing, without resealing its source."""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import argparse, hashlib, json, shutil, zipfile

ROOT=Path(__file__).resolve().parents[1]
V=ROOT/'outputs/verification'
D=ROOT/'outputs/submission'
BASELINE_IMAGE='sha256:55a5c92928c6f0f9d22e07ca6d991e32fa39602d86f2ee871cbe41d3f83c0120'
CORE='5132063b3585b3e3c7a3cc98644287288058994c1e9b6b12a29ae016ab9bde44'
MODEL='8fb73421de22a16a38ac7befad4a62a585fa7d80af7e156dd3c0770ee0c97836'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(relative):return json.loads((ROOT/relative).read_text(encoding='utf-8-sig'))
def proof(relative):return {'file':relative,'sha256':sha(ROOT/relative)}

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--technical-proof',default='outputs/verification/qa-cycle-02-technical-description.json')
parser.add_argument('--presentation-proof',default='outputs/verification/qa-cycle-01-presentation.json')
args=parser.parse_args()
proof_paths={
 'functional':'outputs/verification/qa-cycle-02-functional-summary.json',
 'independent':'outputs/verification/qa-cycle-02-independent-acceptance.json',
 'independentMedia':'outputs/verification/qa-cycle-02-independent-media.json',
 'ordinaryUi':'outputs/verification/qa-cycle-02-ordinary-ui-workflow.json',
 'video':'outputs/verification/qa-cycle-02-video.json',
 'conversion':'outputs/verification/qa-cycle-02-video-conversion.json',
 'midpoints':'outputs/verification/qa-cycle-02-video-midpoints.json',
 'capture':'outputs/verification/qa-cycle-02-video-captures.json',
 'load':'outputs/verification/qa07-load.json',
 'loadMeasurement':'outputs/verification/load-scale.json',
 'clean':'outputs/verification/clean-source-launch.json',
 'privacy':'outputs/verification/source-privacy-audit.json',
 'technical':args.technical_proof,
 'presentation':args.presentation_proof,
 'presentationCompletion':'outputs/verification/presentation-completion.json',
 'presentationFinalization':'outputs/verification/presentation-finalization.json',
 'competitive':'outputs/quality/matching-competitive-v2-report.json',
 'intergroup':'outputs/quality/qa-cycle-01/intergroup-control-v1-report.json',
 'traceability':'outputs/quality/qa-cycle-01/traceability-regression-v1-report.json',
 'grades':'outputs/verification/qa-cycle-01-grade.json',
 'sourceInputs':'outputs/verification/qa-cycle-01-source-required-inputs.json',
 'currentRuntime':'outputs/verification/qa-cycle-04-working-runtime.json',
 'targetedAcceptance':'outputs/verification/qa-cycle-04-independent-acceptance.json',
 'currentFunctional':'outputs/verification/qa-cycle-04-functional-summary.json',
 'currentMatchingHttp':'outputs/verification/qa-cycle-04-matching-http.json',
 'currentSqlProjection':'outputs/verification/qa07-readonly-perf.json',
 'currentCatalog':'outputs/verification/qa-cycle-03-catalog-regression.json',
 'currentAdmission':'outputs/verification/qa-cycle-03-admission-regression.json',
 'currentQualityEquivalence':'outputs/verification/qa-cycle-04-quality-equivalence.json',
 'independentLoad':'outputs/verification/qa-cycle-04-independent-load.json',
 'mediaEquivalence':'outputs/verification/qa-cycle-02-presentation-equivalence.json',
 'loadHistory':'outputs/verification/qa07-fixed-profile-history.json',
}
reports={k:read(p) for k,p in proof_paths.items()}
current_runtime=reports['currentRuntime'];IMAGE=current_runtime['imageId']
assert IMAGE!=BASELINE_IMAGE and current_runtime['sourceMatches'] and len(current_runtime['sourceHashes'])==22
source=D/'fsp-signal-source.zip';source_sha=sha(source)
clean,privacy=reports['clean'],reports['privacy']
assert clean['passed'] and clean['containerCleanup']=='complete'
assert clean['sourceSha256']==clean['expectedSourceSha256']==source_sha
assert clean['freshDatabase'] and clean['freshDependencies'] and clean['offlineReproduction']['passed']
assert clean['protectedRootRecordsPreserved']
assert clean['applicationVersion']=='0.4.1' and clean['matchingAlgorithmVersion']=='fsp-signal-match-v5'
assert privacy['passed'] and privacy['sourceSha256']==source_sha and not privacy['findings'] and privacy['sealedArchiveUnchanged']

with zipfile.ZipFile(source) as archive:
 assert archive.testzip() is None
 names=archive.namelist();assert len(names)==len(set(names))
 assert all(name.startswith('fsp-signal/') and '..' not in PurePosixPath(name).parts for name in names)
 assert not any(any(part in PurePosixPath(name).parts for part in ['.git','node_modules','local-backup']) or (PurePosixPath(name).name.startswith('.env') and PurePosixPath(name).name!='.env.example') or name.endswith(('.dump','.db','.sqlite')) for name in names)
 manifest=json.loads(archive.read('fsp-signal/SOURCE-MANIFEST.json'))
 by_path={item['path']:item for item in manifest};assert len(by_path)==len(manifest)
 assert set(names)=={'fsp-signal/'+p for p in by_path}|{'fsp-signal/SOURCE-MANIFEST.json'}
 for item in manifest:
  data=archive.read('fsp-signal/'+item['path']);assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256'],item['path']
 metadata=json.loads(archive.read('fsp-signal/RELEASE-METADATA.json'))
assert metadata['applicationVersion']=='0.4.1' and metadata['matchingAlgorithmVersion']=='fsp-signal-match-v5'
assert metadata['programVersions']=={'backend-python':'signal-backend-python-v6','frontend-typescript':'signal-frontend-typescript-v2'}
def sealed(relative,expected=None):
 assert relative in by_path,'Missing sealed input: '+relative
 actual=sha(ROOT/relative);assert actual==by_path[relative]['sha256'],'Changed after seal: '+relative
 if expected is not None:assert actual==expected,'Evidence mismatch: '+relative
 return actual
for name,path in proof_paths.items():
 if name not in {'clean','privacy'}:sealed(path)
sealed('scripts/finalize-qa-cycle-02.py')
sealed('scripts/audit-source-privacy.py',privacy['scriptSha256'])
functional=reports['functional'];assert functional['passed'] and functional['acceptedRuntimeImage']==BASELINE_IMAGE
assert functional['checks']['unit']['passed']==121 and functional['checks']['typecheck']['passed']
assert functional['checks']['builtHttpGroups']==65 and functional['checks']['idRequests']['passed']==130
changed_application_paths={'artifacts/api-server/src/routes/signal-employer-matching.ts','artifacts/api-server/src/lib/assessment-ranking-evidence.ts','artifacts/api-server/src/lib/skill-catalog.ts','artifacts/api-server/src/lib/matching-pool-admission.ts'}
for path,digest in functional['sourceHashes'].items():
 if path not in changed_application_paths:sealed(path,digest)
for path,digest in current_runtime['sourceHashes'].items():sealed(path,digest)
current_functional=reports['currentFunctional'];assert current_functional['passed'] and current_functional['imageId']==IMAGE
assert current_functional['unit']['passed']==155 and current_functional['unit']['failed']==0 and current_functional['typecheck']['passed']
assert current_functional['targetedHttpGroups']==6 and current_functional['sqlProjection']['passed'] and current_functional['loaderRegression']['passed']
assert reports['currentCatalog']['passed'] and reports['currentAdmission']['passed'] and reports['currentQualityEquivalence']['passed']
for path,digest in reports['currentQualityEquivalence']['sourceHashes'].items():sealed(path,digest)
sealed(current_functional['loaderRegression']['proofPath'],current_functional['loaderRegression']['proofSha256'])
for key in ['catalogRegression','admissionRegression','qualityEquivalence']:
 sealed(current_functional[key]['proofPath'],current_functional[key]['proofSha256'])
sealed('artifacts/api-server/src/lib/signal-matching.ts',CORE)
sealed('scripts/lib/grade-transfer-model.ts',MODEL)
sealed('outputs/verification/qa-cycle-01-grade.json','d8e733cec65a93aed7d7994d1a6a343569c3beb8fdca123a4001be12e7aa4846')
for path,digest in clean['runtimeSourceAttestation']['sourceHashes'].items():assert by_path[path]['sha256']==digest,path
independent=reports['independent'];assert independent['passed'] and independent['imageId']==BASELINE_IMAGE and independent['uniqueBuiltRuntimeGroups']==60
assert independent['matcherSha256']==CORE and independent['securityHttpRequests']==184
targeted=reports['targetedAcceptance'];assert targeted['passed'] and targeted['imageId']==IMAGE and targeted['targetedBuiltRuntimeGroups']==20
assert set(targeted['changedApplicationPaths'])==changed_application_paths
assert targeted['apiBundleSha256']==current_runtime['bundleSHA'] and targeted['matcherSha256']==CORE
for path,digest in targeted['sourceHashes'].items():sealed(path,digest)
assert targeted['mediaCompatibility']['passed'] and targeted['mediaCompatibility']['sameFrontendBytes']
assert targeted['mediaCompatibility']['captureImageId']==BASELINE_IMAGE
media_equivalence=reports['mediaEquivalence']
assert media_equivalence['passed'] and media_equivalence['captureImageId']==BASELINE_IMAGE and media_equivalence['acceptedImageId']==IMAGE
assert media_equivalence['acceptedBundleSHA']==current_runtime['bundleSHA']
assert media_equivalence['sourceUIUnchanged'] and media_equivalence['backendEquivalenceVerified']
assert media_equivalence['captureFrontendManifestSHA']==media_equivalence['acceptedFrontendManifestSHA']==targeted['frontendManifestSha256']
assert media_equivalence['matchingCoreSHA']==CORE and media_equivalence['transferModelSHA']==MODEL
assert {item['path'] for item in media_equivalence['changedBackendPaths']}==changed_application_paths
for item in media_equivalence['changedBackendPaths']:sealed(item['path'],item['sourceSHA'])
for key in ['targetedMatchingAcceptance','currentFunctional','qualityEquivalence','loadAcceptance','captureProvenance','originalIndependent60']:
 sealed(media_equivalence[key]['proofPath'],media_equivalence[key]['proofSHA'])
assert reports['ordinaryUi']['passed'] and not reports['ordinaryUi']['cleanupPending']
assert reports['ordinaryUi']['cleanup']['exactCapturedAccounts']==2
video=reports['video'];assert video['passed'] and video['imageId']==BASELINE_IMAGE and video['seconds']==138 and video['scenes']==21
assert video['videoSha256']==sha(D/'Signal-Demo.mp4')==reports['independentMedia']['videoSha256']
assert reports['independentMedia']['passed'] and reports['independentMedia']['visualReview']['status']=='pass'
assert reports['conversion']['passed'] and reports['conversion']['decodedPixelEquality']
assert reports['midpoints']['passed'] and reports['midpoints']['sceneCount']==21
assert video['fullDecodePassed'] and video['allEncodedSceneMidpointsViewed'] and video['allCaptionsReviewed']
load,measurement=reports['load'],reports['loadMeasurement']
assert load['passed'] and load['imageId']==IMAGE and load['matcherSha256']==CORE
assert load['protectedOrdinaryRecordsPreserved'] and load['exactOwnCleanup']
assert load['loadReportSha256']==sha(ROOT/proof_paths['loadMeasurement']) and measurement['passed']
assert measurement['preflight']['imageId']==IMAGE
fixture=measurement['preflight']['fixture'];assert fixture['candidates']==1000 and fixture['sessions']==32 and fixture['warmupSeconds']==30 and fixture['measuredSeconds']==180
independent_load=reports['independentLoad']
assert independent_load['passed'] and independent_load['imageId']==IMAGE and independent_load['apiBundleSha256']==current_runtime['bundleSHA']
assert independent_load['sourceHashCount']==22 and independent_load['matcherSha256']==CORE
assert independent_load['profileAndLimitsUnchanged'] and independent_load['runtimeStableDuringRun']
assert independent_load['totalRequests']==8726 and independent_load['errors']==0
assert independent_load['protectedOrdinaryRecordsPreserved'] and independent_load['exactOwnCleanup'] and independent_load['ownLoadFixturesRemaining']==0
assert not independent_load['diagnosticProfilerUsedThisRun']
assert len(independent_load['failedHistory'])==3 and all(item['failed'] and item['preservedExact'] for item in independent_load['failedHistory'])
for path,digest in measurement['preflight']['checkedSourceHashes'].items():sealed(path,digest)
assert measurement['preflight']['scriptHash']==sealed('scripts/load-scale.ts')
technical,presentation=reports['technical'],reports['presentation']
assert technical.get('passed',technical.get('verified')) is True,'Technical content/render acceptance incomplete'
assert technical['applicationVersion']=='0.4.1' and technical['matchingVersion']=='fsp-signal-match-v5' and technical['imageId']==IMAGE
assert technical['artifact']['sha256']==sha(D/'Signal-Technical-Description.pdf')
assert technical['artifact']['pages']==21 and technical['artifact']['bytes']==(D/'Signal-Technical-Description.pdf').stat().st_size
assert technical['apiBundleSha256']==current_runtime['bundleSHA'] and technical['sourceManifest']['sourceHashes']==current_runtime['sourceHashes']
assert technical['officialRequiredTopicCount']==len(technical['officialRequiredTopics'])==8 and all(technical['checks'].values())
assert technical['mediaScope']['captureMode']=='ordinary-accounts-only; demoMode=false'
assert technical['mediaScope']['capturedImageId']==BASELINE_IMAGE and technical['mediaScope']['mp4']['sha256']==video['videoSha256']
for group in ['sources','runtimeProofs']:
 for item in technical[group].values():sealed(item['path'],item['sha256'])
for key in ['build','extractedContent','visualReview']:
 sealed(technical['audit'][key]['path'],technical['audit'][key]['sha256'])
assert presentation.get('verified',presentation.get('passed')) is True
assert presentation['builtPptxVerified'] and presentation['pdfVerified'] and presentation['slideCount']==8
assert presentation['runtimeImage']==IMAGE and presentation['apiBundleSha256']==current_runtime['bundleSHA']
assert presentation['matchingSourceSHA']==CORE and presentation['transferSourceSHA']==MODEL
assert presentation['visualReview']['passed'] and presentation['visualReview']['reviewedSlides']==presentation['visualReview']['pdfReviewedPages']==8
assert presentation['nativePreservation']['originalNativeObjectIDsAndCountsPreserved'] and presentation['nativePreservation']['originalSlideCanvasPreserved']
assert {item['path'] for item in presentation['artifacts']}=={'outputs/submission/Signal-Pitch.pptx','outputs/submission/Signal-Pitch.pdf'}
for item in presentation['artifacts']:
 assert item['sha256']==sha(ROOT/item['path']) and item['bytes']==(ROOT/item['path']).stat().st_size
assert reports['presentationFinalization']['finalSha256']==sha(D/'Signal-Pitch.pptx')
assert reports['presentationCompletion']['pptxSha256']==sha(D/'Signal-Pitch.pptx') and reports['presentationCompletion']['pdfSha256']==sha(D/'Signal-Pitch.pdf')
for path,digest in presentation['files'].items():sealed(path,digest)
for key in ['targetedMatchingAcceptance','loadAcceptance','boundedMediaEquivalence','qualityEquivalence','currentFunctional','independentLoadAcceptance']:
 sealed(presentation[key]['proofPath'],presentation[key]['proofSHA'])
for name in ['Signal-Technical-Description.pdf','Signal-Pitch.pptx','Signal-Pitch.pdf']:
 assert (D/name).is_file() and (D/name).stat().st_size>10000
for path in ['README.md','docs/completion-status.md','docs/technical-description.md','docs/technical-release-input.json','docs/presentation-content.json','docs/pitch-script.md','docs/matching-v5.md','docs/demo-video-scenes.json']:
 sealed(path)
assert read('docs/presentation-content.json')['draft'] is False
# Every nested proof retained below is self-contained inside source/companion delivery.
proofs=[proof(p) for p in proof_paths.values()]
proofs.append(proof(current_functional['loaderRegression']['proofPath']))
for item in technical['runtimeProofs'].values():proofs.append(proof(item['path']))
for key in ['build','extractedContent','visualReview']:proofs.append(proof(technical['audit'][key]['path']))
for item in independent_load['inputs']:
 sealed(item['file'],item['sha256']);proofs.append(proof(item['file']))
for item in independent_load['failedHistory']:
 path='outputs/verification/load-scale-'+item['run']+'.json'
 sealed(path,item['sha256']);proofs.append(proof(path))
for key in ['unit','typecheck']:
 assert 'path' not in functional['checks'][key]
for item in functional['checks']['builtHttp'].values():
 sealed(item['path'],item['sha256']);proofs.append(proof(item['path']))
deliverable_names=['README-FIRST.md','fsp-signal-source.zip','Signal-Technical-Description.pdf','Signal-Pitch.pptx','Signal-Pitch.pdf','Signal-Demo.mp4','Signal-Demo-audit.json']
deliverables=[{'file':name,'bytes':(D/name).stat().st_size,'sha256':sha(D/name)} for name in deliverable_names]
report={'schemaVersion':'signal-final-qa-cycle-02-v1','generatedAt':datetime.now(timezone.utc).isoformat(),'passed':True,'allIssuesComplete':True,'localDeliveryComplete':True,'applicationVersion':'0.4.1','programVersions':metadata['programVersions'],'bankVersions':metadata['bankVersions'],'matchingAlgorithmVersion':'fsp-signal-match-v5','matchingPolicyVersion':'need-fit-traceability-comparable-queues-v2','matcherSha256':CORE,'transferModelVersion':'signal-source-mechanism-transfer-v4','transferModelSha256':MODEL,'acceptedRuntimeImage':IMAGE,'acceptedApiBundleSha256':functional['apiBundleSha256'],'cleanBuildImage':clean['image'],'sourceSha256':source_sha,'sourceManifestRecords':len(manifest),'checks':{'functional':{'passed':True,'unit':121,'builtHttpGroups':65,'idRequests':130,'browserQualityGroups':8,'sourceResearchHttpGroupsSeparate':7},'independentRuntime':{'passed':True,'uniqueGroups':60,'securityRequests':184},'ordinaryUi':{'passed':True,'accounts':2,'fixturesCleaned':True},'video':{'passed':True,'seconds':138,'scenes':21,'independentlyAccepted':True},'load':{'passed':True,'fixture':fixture},'technicalPdf':{'passed':True},'presentation':{'passed':True,'slides':8},'sourcePrivacy':{'passed':True,'findings':0},'cleanLaunch':{'passed':True,'freshDependencies':True,'freshDatabase':True,'offlineReproduction':True}},'closedIssues':['QA-01','QA-01b','QA-02','QA-02b','QA-03','QA-04','QA-05','QA-06','QA-07'],'proofFiles':proofs,'deliverables':deliverables,'sourceInputs':{p:by_path[p]['sha256'] for p in functional['sourceHashes']},'documentationInputs':{p:by_path[p]['sha256'] for p in ['docs/completion-status.md','docs/technical-description.md','docs/pitch-script.md','docs/presentation-content.json','docs/technical-release-input.json']},'residualActionsOutsideCurrentScope':['Provide jury-accessible external links and submit through competition account.','Live pitch rehearsal and deferred visual polishing.'],'measurementLimits':['All finite technical/control fixtures and video identities synthetic; no human difficulty/time/usability/hiring measurements.','Used matching controls retained as regression, including losses; no unused final-policy holdout claim.','Transfer model restricted to one core source mechanism with five other competencies frozen correct; unsupported not_evaluated.','Local workload is not production capacity; the protected audit candidate adds one profile to the1000 owned load fixtures.','Official FSP API, real SMTP/HTTPS and external ATS not deployed; integration architecture and local Mailpit are explicit.','Presentation PDF comes from exact PPTX renders; no native PowerPoint validation.','Whole-package post-seal report sits beside ZIP, not inside the seal it identifies.'],'authority':'No commits, push, publication, expenses, live-person messages or competition submission performed.'}
report['schemaVersion']='signal-final-qa-cycle-04-v1'
report['acceptedApiBundleSha256']=current_runtime['bundleSHA']
report['sourceInputs']={p:by_path[p]['sha256'] for p in current_runtime['sourceHashes']}
report['checks']['functional']['scope']='Historical image55a5 full functional checkpoint; retained without relabelling'
report['checks']['currentTargetedFunctional']={
 'passed':True,'unit':current_functional['unit']['passed'],'typecheck':True,
 'builtMatchingHttpGroups':6,'sqlProjection':True,'loaderRegression':True,'imageId':IMAGE,
}
report['checks']['independentRuntime']={
 'passed':True,'baselineImageId':BASELINE_IMAGE,'baselineUniqueGroups':60,'baselineSecurityRequests':184,
 'currentImageId':IMAGE,'currentTargetedMatchingGroups':20,'scope':'Independent targeted retest after four backend performance paths changed; unchanged domains retain their previous checkpoint.',
}
report['checks']['load'].update({'independentlyAccepted':True,'requests':8726,'errors':0,'p95Ms':{item['route']:item['p95Ms'] for item in independent_load['routes']},'peakMemoryMiB':independent_load['peakMemoryMiB'],'previousMeasuredFailuresRetained':3})
report['checks']['currentTargetedFunctional'].update({'catalogRegression':True,'admissionRegression':True,'qualityControlsExactlyReproduced':3})
report['checks']['video']['captureImageId']=BASELINE_IMAGE
report['checks']['video']['equivalentAcceptedRuntimeImageId']=IMAGE
report['measurementLimits'].append('Video and presentation captures retain image55a5 provenance; the new runtime has identical frontend bytes and a separately accepted backend-only performance repair.')
for filename in ['final-report-qa-cycle-02.json','final-report-refinement.json']:
 target=V/filename
 if target.exists():
  history=V/'history';history.mkdir(exist_ok=True);previous=history/(filename.removesuffix('.json')+'-'+sha(target)[:12]+'.json')
  if not previous.exists():shutil.copyfile(target,previous)
 target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
assert sha(source)==source_sha
print(json.dumps({'passed':True,'allIssuesComplete':True,'sourceSha256':source_sha,'report':'outputs/verification/final-report-qa-cycle-02.json','deliverables':len(deliverables)}))
