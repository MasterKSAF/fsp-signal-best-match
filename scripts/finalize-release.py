"""Validate current post-seal evidence beside the ZIP; never reseal the source.

Historical final-report.json stays untouched. Counts, versions and input hashes
come from actual current protocols instead of assertions about an earlier build.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import hashlib
import json
import math
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
verification = root / 'outputs/verification'
delivery = root / 'outputs/submission'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(relative):
    return json.loads((root / relative).read_text(encoding='utf-8-sig'))


proof_names = {
    'clean': 'outputs/verification/clean-source-launch.json',
    'privacy': 'outputs/verification/source-privacy-audit.json',
    'local': 'outputs/verification/final-tests-local-refinement.json',
    'http': 'outputs/verification/final-http-refinement.json',
    'build': 'outputs/verification/release-current-build.json',
    'ui': 'outputs/verification/mobile-refinement.json',
    'uiObservations': 'outputs/verification/mobile-refinement/observations.json',
    'uiContrast': 'outputs/verification/mobile-refinement/contrast.json',
    'load': 'outputs/verification/load-scale.json',
    'backup': 'outputs/verification/backup-restore.json',
    'grades': 'outputs/quality/assessment-validation-after.json',
    'gradeChecks': 'outputs/verification/grade-validation-checks.json',
    'pilot': 'outputs/verification/pilot-cli-http.json',
    'matching': 'outputs/quality/matching-competitive-v1-report.json',
    'technical': 'outputs/verification/technical-description/build.json',
    'presentation': 'outputs/verification/presentation-completion.json',
    'presentationFinalization': 'outputs/verification/presentation-finalization.json',
    'artifactReview': 'outputs/verification/artifact-visual-review.json',
    'artifactFreeze': 'outputs/verification/artifact-authoring-freeze.json',
    'artifactAcceptance': 'outputs/verification/refinement-artifact-acceptance.json',
    'video': 'outputs/verification/demo-video-refinement.json',
    'videoConversion': 'outputs/verification/video-refinement-conversion.json',
    'videoMidpoints': 'outputs/verification/demo-video-midpoints.json',
}
proofs = {key: read(name) for key, name in proof_names.items()}
for key, proof in proofs.items():
    if key not in {'matching', 'uiObservations', 'uiContrast', 'videoMidpoints', 'artifactFreeze'}:
        assert proof.get('passed') is True, f'{proof_names[key]} did not pass'

source = delivery / 'fsp-signal-source.zip'
source_sha = digest(source)
clean, privacy = proofs['clean'], proofs['privacy']
assert clean['containerCleanup'] == 'complete'
assert clean['sourceSha256'] == source_sha, 'Source archive changed after clean launch'
assert privacy['sourceSha256'] == source_sha and privacy.get('sealedArchiveUnchanged') is True, 'Privacy audit belongs to another seal'
assert not privacy.get('findings'), 'Privacy audit contains findings'

with zipfile.ZipFile(source) as archive:
    assert archive.testzip() is None, 'Source ZIP CRC failed'
    names = archive.namelist()
    assert len(names) == len(set(names)), 'Duplicate source ZIP paths'
    forbidden = [name for name in names if
                 not name.startswith('fsp-signal/') or '..' in PurePosixPath(name).parts or
                 any(part in PurePosixPath(name).parts for part in ['.git', 'node_modules', 'local-backup']) or
                 (PurePosixPath(name).name.startswith('.env') and PurePosixPath(name).name != '.env.example') or
                 name.endswith(('.dump', '.sqlite', '.db'))]
    assert not forbidden, forbidden
    manifest = json.loads(archive.read('fsp-signal/SOURCE-MANIFEST.json'))
    manifest_by_path = {item['path']: item for item in manifest}
    assert len(manifest_by_path) == len(manifest), 'Duplicate manifest paths'
    assert set(names) == {'fsp-signal/' + item['path'] for item in manifest} | {'fsp-signal/SOURCE-MANIFEST.json'}, 'Unmanifested ZIP members'
    for item in manifest:
        data = archive.read('fsp-signal/' + item['path'])
        assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], item['path']
    metadata = json.loads(archive.read('fsp-signal/RELEASE-METADATA.json'))


def sealed_hash(relative, expected=None):
    """Both the actual working input and sealed copy must match the evidence."""
    assert relative in manifest_by_path, f'Input absent from sealed source: {relative}'
    observed = digest(root / relative)
    assert observed == manifest_by_path[relative]['sha256'], f'Changed after seal: {relative}'
    if expected is not None:
        assert observed == expected, f'Protocol input hash differs: {relative}'
    return observed


def check_hashes(mapping, label):
    assert isinstance(mapping, dict) and mapping, f'Missing input hashes: {label}'
    for relative, expected in mapping.items():
        sealed_hash(relative, expected)


# Self-identifying post-seal companions cannot be inside the ZIP they identify.
for key, name in proof_names.items():
    if key not in {'clean', 'privacy'}:
        sealed_hash(name)
sealed_hash('scripts/audit-source-privacy.py', privacy['scriptSha256'])

local, http, build, ui, load = [proofs[key] for key in ['local', 'http', 'build', 'ui', 'load']]
for key in ['clean', 'local', 'http', 'grades', 'gradeChecks', 'pilot']:
    assert proofs[key]['programVersions'] == metadata['programVersions'], f'Wrong current bank versions: {key}'
assert clean['applicationVersion'] == metadata['applicationVersion']
assert clean['matchingAlgorithmVersion'] == metadata['matchingAlgorithmVersion']
check_hashes(local['sourceHashes'], 'local production source')
check_hashes(local['localDiagnosticHashes'], 'local offline evaluator')
assert http['sourceHashes'] == local['sourceHashes']
assert http['dockerBefore']['sourceHashes'] == http['sourceHashes'] == http['dockerAfter']['sourceHashes']
assert http['dockerBefore']['image'] == http['image'] == http['dockerAfter']['image']
assert http['dockerBefore']['containerId'] == http['dockerAfter']['containerId']
assert local['currentDockerImageReference'] == http['image']
current_hashes = build.get('sourceHashes', build.get('backendSourceHashes'))
check_hashes(current_hashes, 'current Docker production source')
assert all(current_hashes.get(name) == expected for name, expected in http['sourceHashes'].items()), 'Final image changed tested backend inputs'
assert build['testedImage'] == http['image'], 'Build attestation references another tested image'
assert build['backendSourceHashesMatchTestedImage'] is True
assert (ui.get('image') or ui.get('imageId')) == build['image'], 'Browser QA belongs to another image'
check_hashes(build['frontendSourceHashes'], 'current built frontend')
check_hashes(ui['frontendSourceHashes'], 'browser checked frontend')
assert ui['frontendSourceHashes'] == build['frontendSourceHashes'], 'Browser QA and current build frontend input maps differ'
assert proofs['uiObservations'] == ui['observations'], 'Raw browser observations differ from the acceptance report'
assert ui['contrast']['report'] == proof_names['uiContrast']
transient_name = ui['contrast']['retainedTransient']['name']
settled = [record for record in proofs['uiContrast'] if record['name'] != transient_name]
settled_samples = [sample for record in settled for sample in record['samples']]
assert len(settled_samples) == ui['contrast']['settledSamples']
assert sum(len(record['failures']) for record in settled) == ui['contrast']['settledFailures'] == 0
assert all(sample['pass'] and math.isfinite(sample['ratio']) and sample['ratio'] >= sample['threshold'] for sample in settled_samples), 'Logged settled contrast samples failed their actual thresholds'

commands = {command['name']: command for command in local['commands']}
assert all(command['passed'] and command['exitCode'] == 0 for command in local['commands'])
unit = commands['unit']
assert unit['tests'] == unit['passedTests'] and unit['failedTests'] == 0
assert commands['typecheck']['passed']
assert commands['production-isolation']['checks'] > 0
docker_suites = http['dockerSuites']
for suite in docker_suites + [http['isolatedResearchSuite'], http['operatorCliSuite']]:
    assert suite['passed'] and suite['groups'] > 0
    sealed_hash(suite['file'], suite['sha256'])
docker_groups = sum(suite['groups'] for suite in docker_suites)
research_groups = http['isolatedResearchSuite']['groups']
cli_groups = http['operatorCliSuite']['groups']
assert docker_groups == http['distinctDockerScenarioGroups']
assert docker_groups + research_groups == http['distinctMainHttpScenarioGroups']
assert cli_groups == http['operatorCliScenarioGroups']

assert load['cleanup'] == 'complete' and load['remainingSyntheticUsers'] == 0
assert load['datasetStable'] and load['telemetryComplete'] and load['imageStable'] and load['memoryPassed']
check_hashes(load['preflight']['checkedSourceHashes'], 'load-test inputs')
sealed_hash('scripts/load-scale.ts', load['scriptHash'])
assert load['imageId'] == build['image'], 'Load run must use final Docker image'
backup = proofs['backup']
assert backup['cleanup'] == 'complete' and backup['schedulerStarted'] is False and backup['mailSent'] is False
assert backup['workingDataPreserved'] is True
check_hashes(backup['functionalSourceHashes'], 'restored HTTP functional source')
sealed_hash('scripts/backup-restore-check.ts', backup['scriptSha256'])
for key in ['grades', 'gradeChecks', 'pilot']:
    check_hashes(proofs[key]['sourceHashes'], key)
assert proofs['grades']['counts']['answerErrors'] == 0 and proofs['grades']['counts']['scoringErrors'] == 0
assert proofs['grades']['counts']['teamLabelDisagreements'] == 0
matching = proofs['matching']
assert matching['algorithmVersion'] == metadata['matchingAlgorithmVersion']
sealed_hash('artifacts/api-server/src/lib/signal-matching.ts', matching['algorithmSha256'])
sealed_hash('artifacts/api-server/src/lib/matching-competitive-quality.ts', matching['evaluatorSha256'])
sealed_hash('artifacts/api-server/src/lib/matching-competitive-data.json', matching['datasetSha256'])
assert all(matching['diagnostics']['checks'].values()), 'Competitive control mechanics failed'
for error_kind in ['falseExclusions', 'falseAdmissions', 'privacyViolations']:
    assert not matching['summary']['admission'][error_kind], f'Competitive control {error_kind}'

technical, presentation, receipt = [proofs[key] for key in ['technical', 'presentation', 'presentationFinalization']]
artifact_review = proofs['artifactReview']
assert artifact_review['image'] == build['image']
sealed_hash(proof_names['artifactAcceptance'], artifact_review['acceptanceSha256'])
assert proofs['artifactAcceptance']['image'] == build['image']
for filename, expected in proofs['artifactAcceptance']['proofHashes'].items():
    sealed_hash('outputs/verification/' + filename, expected)
check_hashes(proofs['artifactFreeze']['sha256'], 'frozen document authoring inputs')
for item in artifact_review['artifacts']:
    assert item['sha256'] == digest(root / item['path']), 'Visual artifact receipt references changed bytes'
    assert item['visualReviewed'] == (item.get('pages') or item.get('slides')) > 0
assert set(artifact_review['audits']) == {proof_names['technical'], proof_names['presentation'], proof_names['presentationFinalization']}
assert technical['pdfSha256'] == digest(delivery / 'Signal-Technical-Description.pdf'), 'Technical PDF differs from the reviewed artifact'
assert technical['textChecksPassed'] is True and technical['pages'] > 0
assert technical['visualReview']['passed'] is True
assert technical['visualReview']['reviewedPages'] == technical['visualReview']['renderCount'] == technical['pages'], 'Technical PDF page review is incomplete'
assert presentation['pptxSha256'] == receipt['finalSha256'] == digest(delivery / 'Signal-Pitch.pptx'), 'Pitch PPTX differs from import/layout/visual receipts'
assert presentation['pdfSha256'] == digest(delivery / 'Signal-Pitch.pdf'), 'Pitch PDF differs from the reviewed export'
assert presentation['exactSavedPptxImportedAndRendered'] is True
assert presentation['visualReview']['passed'] is True
assert presentation['visualReview']['reviewedSlides'] == presentation['visualReview']['renderCount'] == presentation['slideCount'] == presentation['pdfPages'] == 8
assert presentation['visualReview']['pdfReviewedPages'] == presentation['visualReview']['pdfRenderCount'] == presentation['pdfPages'], 'Pitch PDF page review is incomplete'
assert receipt['packageIntegrity']['status'] == 'pass' and receipt['packageIntegrity']['exitCode'] == 0 and receipt['packageIntegrity']['findingCount'] == 0
assert receipt['presentationLayout']['exitCode'] == 0 and receipt['presentationLayout']['findingCount'] == 0
assert receipt['fontSelection']['passed'] is True and receipt['firstPartyImport']['passed'] is True
assert receipt['firstPartyImport']['sha256'] == presentation['pptxSha256'] and receipt['firstPartyImport']['slideCount'] == presentation['slideCount']
with zipfile.ZipFile(delivery / 'Signal-Pitch.pptx') as pptx:
    assert pptx.testzip() is None
    actual_slides = [name for name in pptx.namelist() if name.startswith('ppt/slides/slide') and name.endswith('.xml') and '/' not in name[len('ppt/slides/'):]]
    assert len(actual_slides) == presentation['slideCount']
for filename in ['Signal-Technical-Description.pdf', 'Signal-Pitch.pdf']:
    assert (delivery / filename).read_bytes().startswith(b'%PDF-'), 'Reviewed PDF is not a PDF binary'

video = json.loads((delivery / 'Signal-Demo-audit.json').read_text(encoding='utf-8-sig'))
video_proof, conversion, midpoints = [proofs[key] for key in ['video', 'videoConversion', 'videoMidpoints']]
assert video['passed'] is True
assert video['videoSha256'] == video_proof['videoSha256'] == midpoints['videoSha256'] == digest(delivery / 'Signal-Demo.mp4'), 'Demo video differs from its technical/visual audits'
assert video_proof['auditSha256'] == digest(delivery / 'Signal-Demo-audit.json')
for audited in [video, video_proof]:
    assert audited['technicalVerification']['ffprobe'] is True and audited['technicalVerification']['fullDecode'] is True and audited['technicalVerification']['noAudioTracks'] is True
    assert audited['visualReview']['passed'] is True
    assert audited['visualReview']['scenesReviewed'] == len(video['scenes'])
    assert audited['matchingVersion'] == metadata['matchingAlgorithmVersion']
    assert audited['bankVersions'] == metadata['bankVersions']
    assert audited['currentImage'] == build['image']
assert video_proof['sceneCount'] == len(video['scenes']) == len(midpoints['midpointFrames'])
assert video_proof['durationSeconds'] == video['durationSeconds']
assert video_proof['visualReview']['midpointsReport'] == proof_names['videoMidpoints']
sealed_hash(proof_names['videoMidpoints'], video_proof['visualReview']['midpointsReportSha256'])
assert conversion['decodedPixelEquality'] is True and all(frame['decodedPixelEquality'] for frame in conversion['frames'])
assert len(conversion['frames']) == video_proof['conversion']['frameCount'] == video_proof['sceneCount']
assert conversion['sourceBrowserReport'] == proof_names['ui']
sealed_hash(proof_names['ui'], conversion['sourceBrowserReportSha256'])
assert video_proof['conversion']['receipt'] == proof_names['videoConversion'] and video_proof['conversion']['decodedPixelEquality'] is True
sealed_hash(proof_names['videoConversion'], video_proof['conversion']['receiptSha256'])
video_versions = video.get('bankVersions')
video_current = video_versions == metadata['bankVersions']
assert video_current or video.get('historicalCaptureDisclosure'), 'Older video must disclose the versions/screens it demonstrates'
files = ['README-FIRST.md', 'Signal-Technical-Description.pdf', 'Signal-Pitch.pptx', 'Signal-Pitch.pdf', 'Signal-Demo.mp4', 'Signal-Demo-audit.json']
for name in files:
    assert (delivery / name).is_file() and (delivery / name).stat().st_size > 0, f'Missing deliverable: {name}'
report = {
    'generatedAt': datetime.now(timezone.utc).isoformat(), 'passed': True,
    'scope': 'Local competition prototype, synthetic technical control and real local UI operation; no human validation or contest submission',
    'applicationVersion': metadata['applicationVersion'], 'programVersions': metadata['programVersions'],
    'bankVersions': metadata['bankVersions'], 'matchingAlgorithmVersion': metadata['matchingAlgorithmVersion'],
    'sourceSha256': source_sha, 'sourceFiles': len(manifest),
    'finalImage': build['image'], 'httpTestedImage': http['image'], 'cleanImage': clean['image'],
    'backendInputsIdentical': True, 'backendEqualityScope': 'Listed runtime source inputs; not compiled-bundle equality',
    'apiRuntimeBundle': build['apiRuntimeBundle'], 'build': {'report': proof_names['build'], 'passed': True},
    'unitTests': unit['tests'], 'distinctDockerScenarioGroups': docker_groups,
    'isolatedResearchHttpGroups': research_groups, 'distinctMainHttpScenarioGroups': docker_groups + research_groups,
    'operatorCliHttpGroups': cli_groups, 'productionIsolationChecks': commands['production-isolation']['checks'],
    'httpProvenance': http['provenance'],
    'load': {'report': proof_names['load'], 'passed': True, 'image': load['imageId'], 'fixture': load['fixture'],
             'totalRequests': load['totalRequests'], 'requestsPerSecond': load['requestsPerSecond'], 'results': load['results'],
             'limits': load['limits'], 'peakAppMemoryBytes': load['peakAppMemoryBytes'], 'cleanup': load['cleanup'],
             'scope': load['scope']},
    'backupRestore': {'report': proof_names['backup'], 'passed': True, 'cleanup': backup['cleanup'], 'timingsSeconds': backup['timingsSeconds']},
    'browser': {'report': proof_names['ui'], 'passed': True, 'syntheticData': True, 'scope': ui.get('scope'), 'limitations': ui.get('limitations', [])},
    'cleanLaunch': {'report': proof_names['clean'], 'passed': True, 'freshDependencies': clean['freshDependencies'],
                    'freshDatabase': clean['freshDatabase'], 'cleanup': clean['containerCleanup']},
    'assessmentValidation': {'report': proof_names['grades'], 'counts': proofs['grades']['counts'],
                             'humanMeasures': proofs['grades']['humanMeasures'], 'limitations': proofs['grades']['limitations']},
    'matchingControl': {'report': proof_names['matching'], 'datasetVersion': matching['datasetVersion'],
                        'annotationSource': matching['annotationSource'], 'summary': matching['summary'], 'limitations': matching['limitations']},
    'pilot': {'report': proof_names['pilot'], 'mechanicsPassed': True, 'humanResults': 'not_measured', 'guide': 'docs/pilot/operator-guide.md'},
    'sourcePrivacy': {'report': proof_names['privacy'], 'passed': True, 'sealedArchiveUnchanged': True},
    'media': {'technical': {'report': proof_names['technical'], 'pages': technical['pages'], 'reviewedPages': technical['visualReview']['reviewedPages']},
             'pitch': {'report': proof_names['presentation'], 'receipt': proof_names['presentationFinalization'], 'slides': presentation['slideCount'], 'pdfPages': presentation['pdfPages'], 'nativePowerPoint': presentation['powerPointNativeCheck']},
             'video': {'report': proof_names['video'], 'auditSha256': video_proof['auditSha256'], 'durationSeconds': video['durationSeconds'], 'scenesReviewed': video_proof['sceneCount'], 'fullDecode': True, 'scope': video['kind'], 'captureProvenance': video_proof['captureProvenance']}},
    'proofFiles': [{'file': name, 'sha256': digest(root / name)} for name in proof_names.values()],
    'deliverables': [{'file': name, 'bytes': (delivery / name).stat().st_size, 'sha256': digest(delivery / name)} for name in files],
    'externalRemaining': ['Conduct the planned human A/B pilot and blinded independent reviews to establish human validity; these are not measured by synthetic controls',
                          'Provide the actual repository/video submission links and submit through the contest cabinet'],
    'limits': ['Synthetic grade and ranking controls do not establish human grade validity or hiring accuracy',
               'Official FSP integration remains an adapter until the organizer supplies API access; ATS and anti-fake are architectural scope',
               'Mail delivery was checked through local Mailpit; no real SMTP delivery or public deployment is claimed',
               video.get('kind', 'See the accompanying demo audit for screenshot staging and capture provenance')],
    'videoCurrentBankVersions': video_current,
}
report_path = verification / 'final-report-refinement.json'
if '--check-only' not in sys.argv:
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'checkOnly': '--check-only' in sys.argv, 'passed': True, 'sourceSha256': source_sha,
                  'sourceFiles': len(manifest), 'unitTests': unit['tests'], 'dockerGroups': docker_groups,
                  'researchGroups': research_groups, 'operatorCliGroups': cli_groups, 'report': str(report_path)}, ensure_ascii=False))
