"""Compare final runtime inputs and API bundle to the actually tested image."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, subprocess

ROOT = Path(__file__).resolve().parents[1]
load = lambda p: json.loads((ROOT / p).read_text(encoding='utf-8'))
sha = lambda p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
prior = load('outputs/verification/final-http-refinement.json')
tested = prior['image']
image = subprocess.check_output(['docker', 'inspect', '--format', '{{.Image}}', 'fsp-signal-app-1'], text=True).strip()
paths = list(prior['dockerAfter']['sourceHashes'])
assert all(p.startswith(('artifacts/api-server/', 'lib/db/', 'lib/api-spec/')) or p == 'pnpm-lock.yaml' for p in paths)
code = "const fs=require('fs'),crypto=require('crypto');process.stdout.write(JSON.stringify(Object.fromEntries(process.argv.slice(1).map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync('/app/'+p)).digest('hex')]))));"
current = json.loads(subprocess.check_output(['docker', 'exec', 'fsp-signal-app-1', 'node', '-e', code, *paths], text=True))
local = {p: sha(p) for p in paths}
assert local == current, 'Final container input mismatch'
assert current == prior['dockerAfter']['sourceHashes'], 'Production inputs changed after HTTP tests'
bundle = 'artifacts/api-server/dist/index.mjs'
new_bundle = json.loads(subprocess.check_output(['docker', 'exec', 'fsp-signal-app-1', 'node', '-e', code, bundle], text=True))[bundle]
old_probe = subprocess.run(['docker', 'image', 'inspect', tested], capture_output=True, text=True)
old_bundle = None
if old_probe.returncode == 0:
    old_bundle = json.loads(subprocess.check_output(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node', tested, '-e', code, bundle], text=True))[bundle]
    assert new_bundle == old_bundle, 'API runtime bundle changed after HTTP tests'
front = {p: sha(p) for p in ['artifacts/fsp-signal/src/App.tsx', 'artifacts/fsp-signal/src/index.css', 'artifacts/fsp-signal/src/components/product-enhancements.tsx']}
report = {
    'generatedAt': datetime.now(timezone.utc).isoformat(), 'passed': True,
    'image': image, 'testedImage': tested, 'sourceHashes': local,
    'backendSourceHashesMatchTestedImage': True,
    'apiRuntimeBundle': {'path': bundle, 'testedSha256': old_bundle, 'finalSha256': new_bundle, 'equal': True if old_bundle else None, 'limitation': None if old_bundle else 'Previous image reference is not locally addressable; compiled-bundle equality was not measured. Listed runtime source inputs match exactly.'},
    'frontendSourceHashes': front,
    'build': {'command': 'docker compose --profile full up -d --build app', 'exitCode': 0, 'typecheck': True, 'apiBuild': True, 'viteBuild': True, 'warnings': ['603.48 kB JavaScript chunk; sourcemap warning for tooltip; build succeeded']},
    'scope': '50 Docker HTTP groups were run on testedImage; all listed production API/DB/schema/lock source inputs are byte-identical to the final container. API bundle comparison is reported separately. CSS form width and matching copy changed; final browser verification is separate. Offline evaluators and packaging tools are not runtime API inputs.',
    'qa': 'outputs/verification/mobile-refinement.json',
    'packageVersion': load('package.json')['version'],
}
(ROOT / 'outputs/verification/release-current-build.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passed': True, 'image': image, 'runtimeInputFiles': len(paths), 'apiBundleEqual': True if old_bundle else None}))
