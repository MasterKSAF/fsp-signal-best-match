"""Read-only source/proof preflight. Writes a proposal, never a release freeze.

Reported PASS values retain their measured scope and source hashes. No runtime,
build, archive, migration or load action is performed by this helper.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import importlib.util
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from source_research_inputs_v050 import RESEARCH_SOURCE_INPUTS_V050


def module(name, leaf):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / leaf)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


packer = module('source050_proposal_packer', 'package-source-v050.py')
privacy = module('source050_proposal_privacy', 'audit-source-privacy-v050.py')
sha = lambda data: hashlib.sha256(data).hexdigest()

PROPOSED = [
    ('outputs/verification/assessment-purpose/stage-final-functional-0008.json', 'functional', '53 stage groups; native source execution, not clean archive acceptance'),
    ('outputs/verification/assessment-purpose/stage-final-runtime-snapshot.json', 'runtime', 'Measured stage PID/bundle/source attestation; final runtime equivalence still needs an exact freeze'),
    ('outputs/verification/assessment-purpose/stage-upgrade-0008.json', 'migration', 'Owned stage migration-only full-business-hash preservation, retained/deleted digest coverage'),
    ('outputs/verification/assessment-purpose/purpose-069326fe.json', 'functional', '10 immutable-purpose, explicit-grade and reviewer questionnaire groups'),
    ('outputs/verification/multi-resume-core-trust-http-coretrust-7f3c37d5.json', 'functional', '20 trust/appeal groups; immutable audit actors retained and retired, not deleted'),
    ('outputs/verification/assessment-purpose/managed-9095bce1.json', 'functional', '10 actual managed-bank and captured-attempt groups'),
    ('outputs/verification/reviewer-http-2026-10-06.json', 'functional', '13 real reviewer HTTP isolation/exam/cooldown groups with exact owned cleanup'),
    ('outputs/verification/assessment-purpose/full-fresh-3557777f.json', 'functional', '23 owned fresh local HTTP groups; SMTP branch is stage transport, not Compose REST'),
    ('outputs/verification/assessment-purpose/full-fresh-3557777f.json.runner.json', 'runtime', 'Runner source hashes and exact four-account cleanup for full fresh suite'),
    ('outputs/verification/assessment-purpose/fresh-full-setup.json', 'fresh', 'Owned separate fresh database/API setup; not sealed ZIP launch'),
    ('outputs/verification/assessment-purpose/fresh-full-upgrade-e9fda299.json', 'migration', 'Owned integration migration preservation, independent from working/stage DB'),
    ('outputs/verification/assessment-purpose/fresh-seed-rerun.json', 'seed', 'Exact CV row hashes including opt-out and ordinary/reviewer closed fixtures preserved by seed rerun'),
    ('outputs/verification/multi-resume/catalog-http.json', 'functional', 'Whole-resume filters/dedup/photo/pagination and invitation limits; measured source-specific'),
    ('outputs/verification/multi-resume/assessment-http.json', 'functional', 'Shared proof/selected resume/person-level cooldown mechanisms; measured source-specific'),
    ('outputs/verification/multi-resume/sql-acceptance-ab09b4c4480f.json', 'sql', 'Actual own SQL and warm-cache mutation/ABA/fresh evidence controls; exact referenced runtime only'),
    ('outputs/verification/multi-resume/cache-http-f8f3bbee8eab.json', 'http', 'Actual warm/cold HTTP byte equality and fresh authorization; exact referenced runtime only'),
    ('outputs/verification/assessment-purpose/performance-cache-independent-review.json', 'independent', '12 tiny independent behavior controls; no DB/HTTP/load or memory SLA'),
    ('outputs/verification/assessment-purpose/performance-cache-digest-independent-review.json', 'independent', 'Owned actual SQL/backfill/direct mutations; no stage/load/API actions or performance SLA'),
    ('outputs/verification/assessment-purpose/performance-cache-retention-independent-review.json', 'independent', 'Three small retention controls; estimates, not native process memory or all active data'),
    ('outputs/verification/assessment-purpose/reviewer-pdf-http.json', 'pdf', 'Real authenticated PDF binary/headers; not browser download event proof'),
    ('outputs/verification/assessment-purpose/reviewer-pdf-visual.json', 'pdf', 'All one-page PDF visuals checked separately from browser event'),
    ('outputs/verification/release-0.5.0-media-conversion.json', 'browser-media', 'Original JPEG hashes and lossless decoded-pixel PNG equality; no final runtime relabelling'),
    ('outputs/release-0.5.0/demo-video-visual-review.json', 'browser-media', 'Actual12-scene88-second video visual review; final source/runtime association remains a separate freeze gate'),
    ('outputs/verification/fsp-category-policy/current-behavior.json', 'fsp', 'Read-only existing policy analysis; synthetic outcomes, no formula change'),
    ('outputs/verification/fsp-category-policy/synthetic-input.json', 'fsp', 'Fixed independent synthetic category-versus-comparable-group inputs'),
    ('outputs/verification/multi-resume/load-comparison-4ff27b81a719.json', 'history-fail', 'Preserve actual earlier full-profile failure; does not establish final acceptance'),
    ('outputs/verification/multi-resume/load-comparison-34f199957a14.json', 'history-fail', 'Preserve earlier native process capacity failure with original criteria'),
    ('outputs/verification/multi-resume/load-comparison-67e29e502cbe.json', 'history-diagnostic', 'Short diagnostic only; never promoted to full original acceptance'),
    ('outputs/release-0.5.0/build-run-current.txt', 'build', 'Actual current build log, pending final freeze association'),
    ('outputs/release-0.5.0/unit-run-current.txt', 'unit', 'Actual unit log, derive test count from receipt; not historical155'),
]
PROPOSED += [(relative, 'research-historical', 'Frozen17-episode synthetic protocol; zero human participants, no production-grade effect') for relative in RESEARCH_SOURCE_INPUTS_V050]

REQUIRED_NEW_SOURCE = [
    'scripts/upgrade-owned-stage-v050.cjs', 'tests/owned-stage-upgrade-v050.test.ts',
    'lib/db/migrations/0008_resume_pool_digest.sql', 'lib/db/src/schema/signal-resume.ts',
    'artifacts/api-server/src/lib/signal-fresh-pool-cache.ts',
    'artifacts/api-server/src/lib/signal-fresh-ranking-cache.ts',
    'artifacts/api-server/src/lib/signal-readonly-resume.ts',
    'artifacts/api-server/src/lib/signal-resume-matching.ts',
    'artifacts/api-server/src/lib/assessment-ranking-evidence.ts',
    'artifacts/api-server/src/lib/signal-catalog-computation.ts',
    'tests/fresh-pool-cache.test.ts', 'tests/assessment-ranking-loader.test.ts',
    'tests/catalog-computation.test.ts', 'tests/readonly-resume.test.ts',
    'scripts/performance-cache-independent-review.ts',
    'scripts/performance-cache-digest-independent-review.ts',
    'scripts/performance-cache-retention-independent-review.ts',
    'scripts/source_research_inputs_v050.py',
]


def current_source_mismatches(value):
    sources = value.get('sourceHashes', {})
    if isinstance(value.get('runtimeSourceFiles'), list):
        sources = {item['path']: item['sha256'] for item in value['runtimeSourceFiles']}
    return [{'path': relative, 'measuredSHA': expected,
             'currentSHA': sha((ROOT / relative).read_bytes()) if (ROOT / relative).is_file() else None}
            for relative, expected in sources.items()
            if not (ROOT / relative).is_file() or sha((ROOT / relative).read_bytes()) != expected]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private-manifest', action='append', default=[])
    args = parser.parse_args()
    selected = packer.collect_source()
    secret_values, comparison = privacy.audit.known_values()
    extra = privacy.private_values(args.private_manifest)
    secret_values.update(extra)
    proofs, findings = [], []
    pattern = re.compile(r'BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|Bearer [a-zA-Z0-9._~-]{20,}')
    for relative, category, scope in PROPOSED:
        path = ROOT / relative
        if not path.is_file() or path.is_symlink() or not privacy.public_proof_path(relative):
            raise ValueError('Proposed public proof missing/unsafe')
        raw = path.read_bytes()
        text = raw.decode('utf-8-sig')
        value = json.loads(text) if path.suffix == '.json' else {}
        if pattern.search(text) or any(secret in text for secret in secret_values):
            findings.append({'path': relative, 'category': 'known_private_value_or_secret_pattern'})
        proofs.append({'path': relative, 'sha256': sha(raw), 'bytes': len(raw), 'category': category,
                       'reportedStatus': value.get('status', value.get('passed', 'text-only')),
                       'scope': scope, 'sourceDriftSinceMeasurement': current_source_mismatches(value)})
    assert len(proofs) <= 64 and len({item['path'].casefold() for item in proofs}) == len(proofs)
    required = [{'path': relative, 'selected': relative in selected,
                 'sha256': sha((ROOT / relative).read_bytes())} for relative in REQUIRED_NEW_SOURCE]
    assert all(item['selected'] for item in required)
    docs = [{'path': relative, 'selected': relative in selected, 'sha256': sha((ROOT / relative).read_bytes())}
            for relative in ['docs/browser-acceptance-0.5.0.md', 'docs/technical-description-0.5.0.md',
                             'docs/source-release-0.5.0.md', 'docs/confirmation-research-protocol-v1.md',
                             'docs/confirmation-research-report-v1.md']]
    report = {'schemaVersion': 1, 'applicationVersion': '0.5.0',
              'status': 'PROPOSED_NOT_FROZEN', 'generatedAt': datetime.now(timezone.utc).isoformat(),
              'archiveWritten': False, 'releaseFreezeCreated': False, 'runtimeActions': False,
              'publicProofInputs': [{'path': item['path'], 'sha256': item['sha256']} for item in proofs],
              'proofCount': len(proofs), 'proofDetails': proofs, 'sourceFilesSelected': len(selected),
              'requiredNewSource': required, 'alwaysSelectedDocuments': docs,
              'loadRuntimeSelected': any('.load-runtime' in relative.split('/') for relative in selected),
              'proofTextPrivacy': {'passed': not findings, 'findingCount': len(findings), 'findings': findings,
                                  'localKnownValueCount': len(secret_values),
                                  'externalManifestCount': len(args.private_manifest), 'externalKnownValueCount': len(extra),
                                  'privateValuesAndPathsExported': False},
              'pendingBeforeFreeze': ['Full original acceptance load5000×1→5/32/30+180 with unrelaxed criteria',
                                     'Final source/runtime/compiled bundle association and source-specific review freshness',
                                     'Final browser/source/media agreement and final document/artifact facts'],
              'postSealCompanionsExcluded': ['source-seal.json', 'source-privacy-audit.json', 'clean-source-launch.json', 'final-report.json'],
              'limitations': ['Proposal hashes are snapshots, must refresh only after root freezes all sources/proofs.',
                              'Reported PASS retains its actual measured scope; mismatches do not silently become final acceptance.',
                              'Historical FAIL/diagnostic and synthetic research are not new full load or human validation.',
                              'Known-value/limited-pattern checks are not a universal secret detector.']}
    destination = ROOT / 'outputs/release-0.5.0/proposed-freeze-inputs.json'
    if destination.exists():
        previous = destination.read_bytes()
        preserved = destination.parent / 'history/preparation' / sha(previous) / destination.name
        preserved.parent.mkdir(parents=True, exist_ok=True)
        if not preserved.exists():
            preserved.write_bytes(previous)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'proofCount': len(proofs), 'sourceFilesSelected': len(selected),
                      'newRequiredSourceSelected': len(required), 'proofTextPrivacyPassed': not findings,
                      'report': destination.relative_to(ROOT).as_posix(), 'sha256': sha(destination.read_bytes()),
                      'freezeCreated': False, 'archiveWritten': False}))
    return 0 if not findings else 1


if __name__ == '__main__':
    raise SystemExit(main())
