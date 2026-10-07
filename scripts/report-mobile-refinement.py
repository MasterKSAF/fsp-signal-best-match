"""Archive observed browser acceptance facts; this does not drive the browser."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
folder = root / 'outputs/verification/mobile-refinement'
observations = json.loads((folder / 'observations.json').read_text(encoding='utf-8'))
contrast = json.loads((folder / 'contrast.json').read_text(encoding='utf-8'))
build = json.loads((root / 'outputs/verification/release-current-build.json').read_text(encoding='utf-8'))

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

by_name = {row['name']: row for row in observations}
excluded = {'03-assessment-form', '21-reflow-200-simulated', '22-assessment-width-fixed'}
accepted = [row for row in observations if row['name'] not in excluded]
assert all(row['metrics']['scrollWidth'] <= row['metrics']['width'] for row in accepted)
entry_names = ['28-home-current-desktop', '32-home-phone-current', '33-home-small-phone',
               '34-small-phone-dark', '35-home-tablet-dark', '36-home-short-desktop-dark']
assert all(by_name[name]['metrics']['scrollHeight'] == by_name[name]['metrics']['height'] for name in entry_names)
settled = [row for row in contrast if row['name'] != 'candidate-light']
assert all(not row['failures'] for row in settled)
report = {
    'schemaVersion': 'signal-mobile-refinement-v1',
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'passed': True,
    'image': build['image'],
    'captureWindowUtc': [observations[0]['at'], observations[-1]['at']],
    'scope': 'Technical browser acceptance on synthetic ordinary accounts, plus explicitly isolated Demo comparison; not human usability research.',
    'provenance': {
        'ordinaryWorkflow': 'Captured before final UI-only rebuild; backend runtime inputs match the tested image in release-current-build.json. The complete ordinary workflow was not rerun after the final UI-only change.',
        'codeOverflowRetest': '23 and 24 captured on intermediate 22ee build with the final code overflow CSS; final change only separated the displayed FSP bonus.',
        'matchingRetest': '25 captured on intermediate 22ee build with ordinary zero-FSP score; 31 tests the final fd500 comparison and separate +3 FSP bonus.',
        'finalBuild': '27 through 36 observed on final fd500 build; public entry, PDF response, helper, Demo modal, comparison, themes, keyboard and motion.',
        'binaryBackendEquality': 'Not measured: the prior image is unavailable. Runtime source input equality is independently recorded; no binary equality is asserted.'
    },
    'checks': [
        ['ordinary candidate', 'Profile, privacy opt-in, six-question questionnaire, résumé and Middle v6 six-case assessment; immutable 100/100 result; answer draft survives reload.'],
        ['ordinary employer', 'Need creation and native required-field validation, coverage explanation, invitation with salary and candidate acceptance.'],
        ['vacancy lifecycle', 'Draft, publish, explicit application consent, employer review, v2 salary update; existing application retains original v1 180–240k conditions.'],
        ['company practice', 'Opt-in, real server periodic offer, explicit acceptance, persisted answer draft, visible 4/3/3 rubric review with reasons, 10/10 result, summary consent and opt-out.'],
        ['contact withdrawal', 'Candidate revokes company contact access across invitation/application; employer contact button disappears and revoked state is visible.'],
        ['PDF', 'Actual mobile button HTTP 200 application/pdf observed through browser Network events; binary validation belongs to HTTP protocol. Browser download file path was not observed.'],
        ['responsive forms', 'Found 560px document overflow at 360px. Fixed grid min-content sizing; new ordinary Senior six-case form document width 345px, code scrolls inside its own container.'],
        ['responsive entry', '1280×800, 1280×720, 768×1024, 360×740 and 320×568; measured document equals viewport, both audiences and footer visible.'],
        ['200% reflow', 'Simulated 640×400 CSS viewport at DPR2 for 1280×800 physical rendering; settled width625px. Direct native browser Ctrl-plus did not change zoom.'],
        ['dialogs and keyboard', 'Login focus trap remained inside over12 Tabs; Escape closes login, invitation, helper and comparison; focus returns to trigger. Theme closes after choice and outside click.'],
        ['Demo and assistant', 'Demo toggle belongs to login modal and fills selected role credentials. Helper offers three supported topics for an unrelated query rather than inventing an answer.'],
        ['reduced motion', 'Emulated prefers-reduced-motion: reduce; all six brand letters reported animation none / duration0. Media override restored after check.'],
        ['contrast sample', f"{sum(len(row['samples']) for row in settled)} settled solid foreground/background samples: no threshold failures. Partial sample, not WCAG certification."]
    ],
    'observations': observations,
    'excludedFromFinalAcceptance': [
        {'name': '03-assessment-form', 'reason': 'Actual baseline defect: horizontal overflow. Corrected and retested in23.'},
        {'name': '21-reflow-200-simulated', 'reason': 'Screenshot caught sidebar transition; settled retest26 used instead.'},
        {'name': '22-assessment-width-fixed', 'reason': '90-day cooldown blocked the attempt. This is not evidence for code form width; fresh ordinary account retest23 used.'}
    ],
    'contrast': {'report': 'outputs/verification/mobile-refinement/contrast.json',
                 'settledSamples': sum(len(row['samples']) for row in settled), 'settledFailures': 0,
                 'retainedTransient': {'name': 'candidate-light', 'failures': len(contrast[1]['failures']),
                                       'reason': 'Theme transition produced mixed old/new colors; settled retest retained separately.'}},
    'screenshots': [{'path': p.relative_to(root).as_posix(), 'sha256': sha(p)} for p in sorted(folder.glob('*.jpg'))],
    'frontendSourceHashes': build['frontendSourceHashes'],
    'cleanup': 'complete',
    'fixtureCleanup': 'scripts/mobile-qa-fixture.ts --cleanup completed successfully; exact three ordinary fixture accounts and their owned relations deleted, working accounts preserved.',
    'humanUsability': 'not_measured',
    'limitations': [
        'Synthetic ordinary accounts and agent execution do not establish independent human usability, completion time or assessment difficulty.',
        'Ordinary application pages can scroll vertically; only compact entry is required and verified to occupy one viewport.',
        'Solid-color contrast sample ignores gradients, opacity and canvas and covers observed viewports only.',
        '200% reflow is an explicit viewport/DPR simulation, not observed native browser zoom.',
        'Final source equality does not claim prior/final compiled API bundle identity; see build attestation.',
        'Browser PDF response and separate HTTP binary validation are observed; the download file path is not.'
    ]
}
(root / 'outputs/verification/mobile-refinement.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passed': True, 'image': report['image'], 'captures': len(report['screenshots']), 'settledContrastSamples': report['contrast']['settledSamples']}))
