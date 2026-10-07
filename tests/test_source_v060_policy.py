"""Pure source-selection/freeze guards. No archive, process, build or DB is created."""
from pathlib import Path
import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import source_qa_inputs as inputs
from source_research_inputs_v050 import RESEARCH_SOURCE_INPUTS_V050


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


packer = module('source_v060_packer_under_test', 'package-source-v060.py')
historical_code_policy = dict(inputs.QA_SOURCE_CODE_INPUTS)
historical_required_policy = dict(inputs.QA_SOURCE_REQUIRED_INPUTS)
privacy = module('source_v060_privacy_under_test', 'audit-source-privacy-v060.py')


class VersionedSourcePolicy(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='signal-v060-policy-')
        self.root = Path(self.temporary.name).resolve()
        self.files = {}
        for relative in packer.CRITICAL_FROZEN_INPUTS:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic frozen bytes: ' + relative, encoding='utf-8')
            self.files[relative] = path
        self.hashes = {relative: hashlib.sha256(path.read_bytes()).hexdigest() for relative, path in self.files.items()}
        self.freeze = {'schemaVersion': 1, 'applicationVersion': '0.6.0', 'status': 'frozen-for-source-seal',
                       'frozenAt': '2026-10-06T15:00:00Z', 'sourceHashes': self.hashes,
                       'acceptedRuntime': {'applicationVersion': '0.6.0', 'bundleSHA': 'a' * 64,
                                           'sourceHashes': {key: self.hashes[key] for key in sorted(self.hashes)[:2]}},
                       'publicProofInputs': []}
        self.baseline_items = {}
        for name, data in {'policyQuality': {'sourceHashes': {'artifacts/api-server/src/lib/signal-matching.ts': self.hashes['artifacts/api-server/src/lib/signal-matching.ts']}},
                           'traceabilityDelta': {'algorithmSha256': self.hashes['artifacts/api-server/src/lib/signal-matching.ts']}}.items():
            relative = 'outputs/quality/0.6.0/fsp-category/' + name + '.json'
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({'applicationVersion': '0.6.0', **data}), encoding='utf-8')
            self.baseline_items[name] = {'path': relative, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        self.freeze['offlineBaselines'] = self.baseline_items
        self.freeze['publicProofInputs'] = list(self.baseline_items.values())
        for relative in RESEARCH_SOURCE_INPUTS_V050:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / relative).read_bytes())

    def tearDown(self):
        self.temporary.cleanup()

    def read_freeze(self, receipt=None, files=None):
        path = self.root / 'release-freeze.json'
        path.write_text(json.dumps(self.freeze if receipt is None else receipt), encoding='utf-8')
        with patch.object(packer, 'ROOT', self.root):
            return packer.read_freeze(path, dict(self.files) if files is None else files)

    def test_historical_policy_is_not_mutated_by_versioned_privacy_import(self):
        self.assertEqual(inputs.QA_SOURCE_REQUIRED_INPUTS, historical_required_policy)
        self.assertEqual(inputs.QA_SOURCE_CODE_INPUTS, historical_code_policy)
        self.assertEqual(len(inputs.QA_SOURCE_REQUIRED_INPUTS), 9)
        self.assertEqual(len(inputs.QA_SOURCE_CODE_INPUTS), 2)

    def test_versioned_zip_time_uses_the_freeze_instant_without_rewriting_bytes(self):
        import io
        import zipfile
        first = packer.freeze_zip_timestamp('2026-10-06T22:30:24.528972+00:00')
        second = packer.freeze_zip_timestamp('2026-10-07T01:45:51.100000+03:00')
        self.assertEqual(first, (2026, 10, 6, 22, 30, 24))
        self.assertEqual(second, (2026, 10, 6, 22, 45, 50))
        self.assertNotEqual(first, second)
        self.assertEqual(first, packer.freeze_zip_timestamp('2026-10-07T01:30:24.528972+03:00'))
        versioned_bytes = [b'{"version":"0.4.1"}', b'{"version":"0.6.0"}']
        self.assertEqual(len(versioned_bytes[0]), len(versioned_bytes[1]))
        for data, timestamp in zip(versioned_bytes, [first, second]):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as archive:
                archive.writestr(zipfile.ZipInfo('fsp-signal/package.json', timestamp), data)
            with zipfile.ZipFile(io.BytesIO(buffer.getvalue())) as archive:
                self.assertEqual(archive.read('fsp-signal/package.json'), data)
                self.assertEqual(archive.getinfo('fsp-signal/package.json').date_time, timestamp)
        for invalid in ['2026-10-06T22:30:24', 'not-a-date', '1979-10-06T22:30:24Z', '2108-10-06T22:30:24Z', None]:
            with self.assertRaises(ValueError):
                packer.freeze_zip_timestamp(invalid)

    def test_only_exact_reviewed_historical_sources_and_prepolicy_json_are_added(self):
        self.assertEqual(len(inputs.QA_SOURCE_V060_ONLY_REQUIRED_INPUTS), 3)
        self.assertEqual(len(inputs.QA_SOURCE_V060_ADDITIONAL_INPUTS), 5)
        for relative, expected in inputs.QA_SOURCE_V060_ADDITIONAL_INPUTS.items():
            self.assertEqual(hashlib.sha256((ROOT / relative).read_bytes()).hexdigest(), expected)
            self.assertIsNone(privacy.audit.exclusion_category('fsp-signal/' + relative))
        self.assertIsNotNone(privacy.audit.exclusion_category('fsp-signal/outputs/verification/history/unreviewed/source.ts'))
        self.assertIsNotNone(privacy.audit.exclusion_category('fsp-signal/outputs/quality/0.6.0/fsp-category/history/unreviewed.ts'))
        self.assertEqual(privacy.audit.exclusion_category('fsp-signal/artifacts/api-server/.load-runtime/owned/api.mjs'), 'private_or_generated_directory')

    def test_privacy_delegates_archive_sha_without_replacing_it_with_runtime_source_sha(self):
        core, auth = b'synthetic current matcher', b'synthetic current auth'
        digest = lambda data: hashlib.sha256(data).hexdigest()
        expected_archive_sha = 'a' * 64
        core_relative = 'artifacts/api-server/src/lib/signal-matching.ts'
        auth_relative = 'artifacts/api-server/src/lib/signal-auth.ts'
        baselines = {}
        for name, measured in {'policyQuality': {'sourceHashes': {core_relative: digest(core)}}, 'traceabilityDelta': {'algorithmSha256': digest(core)}}.items():
            relative = 'outputs/quality/0.6.0/fsp-category/' + name + '.json'
            data = json.dumps({'applicationVersion': '0.6.0', **measured}).encode()
            baselines[name] = {'path': relative, 'sha256': digest(data), 'bytes': data}
        metadata = {'applicationVersion': '0.6.0', 'freezeReceiptSha256': 'b' * 64,
                    'matchingAlgorithmSha256': digest(core), 'publicProofInputs': [{k: v for k, v in item.items() if k != 'bytes'} for item in baselines.values()],
                    'offlineBaselines': {name: {k: v for k, v in item.items() if k != 'bytes'} for name, item in baselines.items()},
                    'acceptedRuntime': {'applicationVersion': '0.6.0', 'bundleSHA': 'c' * 64,
                                        'sourceHashes': {core_relative: digest(core), auth_relative: digest(auth)}}}
        entries = {'fsp-signal/RELEASE-METADATA.json': json.dumps(metadata).encode(),
                   'fsp-signal/' + core_relative: core, 'fsp-signal/' + auth_relative: auth}
        entries.update({'fsp-signal/' + item['path']: item['bytes'] for item in baselines.values()})
        entries.update({'fsp-signal/' + relative: (ROOT / relative).read_bytes() for relative in RESEARCH_SOURCE_INPUTS_V050})
        self.assertNotEqual(expected_archive_sha, digest(auth))

        class SyntheticArchiveReader:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def namelist(self):
                return list(entries)

            def read(self, name):
                return entries[name]

        archive_path, secret_values = self.root / 'never-opened.zip', {'synthetic-private-value'}
        with patch.object(privacy.zipfile, 'ZipFile', return_value=SyntheticArchiveReader()), \
                patch.object(privacy.audit, 'inspect_archive', return_value={'syntheticPassed': True}) as base:
            result = privacy.inspect_v060(archive_path, expected_archive_sha, secret_values)
            base.assert_called_once_with(archive_path, expected_archive_sha, secret_values)
            self.assertEqual(result, {'syntheticPassed': True})
        self.assertFalse(archive_path.exists(), 'No archive is opened or written by this regression')

    def test_noncanonical_relative_paths_are_rejected(self):
        self.assertTrue(packer.safe_relative('scripts/tool.py'))
        for value in [None, '', '/absolute', '../outside', 'outputs//extra', './file', 'C:/private', 'scripts\\file']:
            with self.subTest(value=value):
                self.assertFalse(packer.safe_relative(value))

    def test_selection_excludes_private_environment_dependencies_and_historical_helper(self):
        paths = ['.env', '.env.local', '.env.example', 'node_modules/x.json', 'local-backup/file.json',
                 'scripts/snapshot-qa-preserved-state.ts', 'outputs/screens/raw.json', 'artifacts/api-server/.load-runtime/owned/api.mjs', 'src/app.ts']
        for relative in paths:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('synthetic selection fixture', encoding='utf-8')
        with patch.object(packer, 'ROOT', self.root), patch.object(packer, 'validate_qa_source_inputs_v060', return_value=[]):
            selected = packer.collect_source()
        self.assertIn('.env.example', selected)
        self.assertIn('src/app.ts', selected)
        for relative in paths[:-1]:
            if relative != '.env.example':
                self.assertNotIn(relative, selected)

    def test_valid_freeze_accepts_exact_runtime_inputs(self):
        self.assertEqual(self.read_freeze()['acceptedRuntime']['sourceHashes'], self.freeze['acceptedRuntime']['sourceHashes'])

    def test_research_is_exact_and_untrusted_siblings_never_enter_selection(self):
        siblings = ['outputs/research/confirmation-v1/unreviewed.json',
                    'outputs/research/confirmation-v1/another.sha256',
                    'outputs/research/other/protocol.json']
        for relative in siblings:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('synthetic unreviewed sibling', encoding='utf-8')
        with patch.object(packer, 'ROOT', self.root), patch.object(packer, 'validate_qa_source_inputs_v060', return_value=[]):
            selected = packer.collect_source()
        for relative, digest in RESEARCH_SOURCE_INPUTS_V050.items():
            self.assertIn(relative, selected)
            self.assertEqual(hashlib.sha256(selected[relative].read_bytes()).hexdigest(), digest)
            self.assertTrue(privacy.public_proof_path(relative))
            self.assertIsNone(privacy.audit.exclusion_category('fsp-signal/' + relative))
        for relative in siblings:
            self.assertNotIn(relative, selected)
            self.assertFalse(privacy.public_proof_path(relative))
            self.assertIsNotNone(privacy.audit.exclusion_category('fsp-signal/' + relative))

    def test_research_missing_or_changed_bytes_cannot_be_silently_selected(self):
        relative = next(iter(RESEARCH_SOURCE_INPUTS_V050))
        (self.root / relative).write_text('changed synthetic protocol', encoding='utf-8')
        with patch.object(packer, 'ROOT', self.root), patch.object(packer, 'validate_qa_source_inputs_v060', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'research input'):
                packer.collect_source()
        self.freeze['publicProofInputs'] = [{'path': relative, 'sha256': hashlib.sha256((self.root / relative).read_bytes()).hexdigest()}]
        with self.assertRaisesRegex(ValueError, 'reviewed SHA'):
            self.read_freeze()

    def test_freeze_adds_only_exact_research_leaves_not_same_prefix_siblings(self):
        self.freeze['publicProofInputs'].extend({'path': relative, 'sha256': digest} for relative, digest in RESEARCH_SOURCE_INPUTS_V050.items())
        selected = dict(self.files)
        self.read_freeze(files=selected)
        self.assertTrue(set(RESEARCH_SOURCE_INPUTS_V050).issubset(selected))
        changed = copy.deepcopy(self.freeze)
        changed['publicProofInputs'].append({'path': 'outputs/research/confirmation-v1/private.json', 'sha256': 'a' * 64})
        with self.assertRaisesRegex(ValueError, 'public bounded'):
            self.read_freeze(changed)

    def test_changed_source_bytes_are_rejected(self):
        next(iter(self.files.values())).write_text('changed synthetic bytes', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'drifted'):
            self.read_freeze()

    def test_runtime_must_be_nonempty_and_match_frozen_current_inputs(self):
        for runtime in [{}, {'sourceHashes': {}}, {'sourceHashes': {'unselected.ts': 'a' * 64}},
                        {'sourceHashes': {next(iter(self.hashes)): 'b' * 64}}]:
            changed = copy.deepcopy(self.freeze)
            changed['acceptedRuntime'] = {'applicationVersion': '0.6.0', 'bundleSHA': 'a' * 64, **runtime}
            with self.subTest(runtime=runtime), self.assertRaisesRegex(ValueError, 'Accepted runtime'):
                self.read_freeze(changed)

    def test_missing_new_feature_freeze_and_old_version_are_rejected(self):
        for required in ['lib/db/migrations/0007_reviewer_scope.sql',
                         'lib/db/migrations/0008_resume_pool_digest.sql', 'lib/db/src/schema/signal-resume.ts',
                         'lib/db/migrations/0009_microtask_resume.sql', 'artifacts/api-server/src/lib/microtask-resume-policy.ts']:
            changed = copy.deepcopy(self.freeze)
            del changed['sourceHashes'][required]
            with self.subTest(required=required), self.assertRaisesRegex(ValueError, 'new feature'):
                self.read_freeze(changed)
        changed = copy.deepcopy(self.freeze)
        changed['applicationVersion'] = '0.5.0'
        with self.assertRaisesRegex(ValueError, '0.6.0'):
            self.read_freeze(changed)

    def test_only_explicit_exact_public_proof_is_added(self):
        relative = 'outputs/release-0.6.0/acceptance/safe.json'
        proof = self.root / relative
        proof.parent.mkdir(parents=True, exist_ok=True)
        proof.write_text('{"status":"PASS","synthetic":true}', encoding='utf-8')
        self.freeze['publicProofInputs'].append({'path': relative, 'sha256': hashlib.sha256(proof.read_bytes()).hexdigest()})
        selected = dict(self.files)
        self.read_freeze(files=selected)
        self.assertIn(relative, selected)
        self.assertTrue(privacy.public_proof_path(relative))

    def test_public_input_cannot_recurse_to_private_or_postseal_data(self):
        for relative in ['outputs/release-0.6.0/private/accounts.json', 'outputs/release-0.6.0/clean-deadbeef/http.json',
                         'outputs/verification/screens/raw.json', 'outputs/quality/../private.json',
                         'outputs/release-0.6.0/source-seal.json', 'outputs/release-0.6.0/nested.ts']:
            changed = copy.deepcopy(self.freeze)
            changed['publicProofInputs'] = [{'path': relative, 'sha256': 'a' * 64}]
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                self.read_freeze(changed)
            self.assertFalse(privacy.public_proof_path(relative))

    def test_duplicate_or_unbounded_proof_inputs_are_rejected(self):
        relative = 'outputs/verification/one.json'
        proof = self.root / relative
        proof.parent.mkdir(parents=True, exist_ok=True)
        proof.write_text('{}', encoding='utf-8')
        item = {'path': relative, 'sha256': hashlib.sha256(proof.read_bytes()).hexdigest()}
        self.freeze['publicProofInputs'] = [item, item]
        with self.assertRaisesRegex(ValueError, 'unique'):
            self.read_freeze()
        self.freeze['publicProofInputs'] = [item, {**item, 'path': 'outputs/verification/ONE.json'}]
        with self.assertRaisesRegex(ValueError, 'unique'):
            self.read_freeze()
        self.freeze['publicProofInputs'] = [item] * 65
        with self.assertRaisesRegex(ValueError, 'bounded'):
            self.read_freeze()

    def test_current_policy_baselines_are_mandatory_exact_and_cannot_reuse_old_pass(self):
        missing = copy.deepcopy(self.freeze)
        del missing['offlineBaselines']
        with self.assertRaisesRegex(ValueError, 'offline baselines'):
            self.read_freeze(missing)
        unbound = copy.deepcopy(self.freeze)
        unbound['offlineBaselines'] = copy.deepcopy(unbound['offlineBaselines'])
        unbound['offlineBaselines']['policyQuality']['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'exact frozen public proof'):
            self.read_freeze(unbound)
        for change in [{'applicationVersion': '0.5.0'}, {'sourceHashes': {'artifacts/api-server/src/lib/signal-matching.ts': 'a' * 64}}]:
            changed = copy.deepcopy(self.freeze)
            item = changed['offlineBaselines']['policyQuality']
            path = self.root / item['path']
            data = json.loads(path.read_text())
            data.update(change)
            path.write_text(json.dumps(data), encoding='utf-8')
            item['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            changed['publicProofInputs'] = list(changed['offlineBaselines'].values())
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'current policy'):
                self.read_freeze(changed)


if __name__ == '__main__':
    unittest.main()
