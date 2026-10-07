"""Bounded read-only outer delivery audit. Comparison values and matches never leave memory."""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
from io import BytesIO
from collections import Counter
import argparse
import hashlib
import html
import importlib.util
import json
import re
import stat
import sys
import warnings
import zipfile
import xml.etree.ElementTree as ET

# Importing the current read-only policy must not create bytecode in the project.
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / 'outputs/release-0.6.0'
OUTER = RELEASE / 'Signal-Best-Match-0.6.0.zip'
SOURCE = RELEASE / 'fsp-signal-source-0.6.0.zip'
OUTPUT = RELEASE / 'submission-privacy-audit.json'
PRIVATE_INPUTS = ()  # Actual run requires explicit bounded external --private-manifest inputs.
OLD_ROOT = ROOT / 'outputs/release-0.5.0'
OLD_OUTER = OLD_ROOT / 'Signal-Best-Match-0.5.0.zip'
OLD_OUTER_SHA = 'abe597bd502ecd3fcda4789cfa04960dd947d550749acdf0098c6cefb57797a5'
OLD_SOURCE_SHA = '4cce22072a8628c6ecc3fd2874460c331a9e2825837ee2b949c05e292f225e79'
SOURCE_MEMBER = 'fsp-signal-source-0.6.0.zip'
MANIFEST_MEMBER = 'submission-manifest.json'
MAX_MEMBERS = 4096
MAX_MEMBER_BYTES = 128 * 1024 * 1024
MAX_ARCHIVE_EXPANDED = 512 * 1024 * 1024
MAX_TOTAL_READ_BYTES = 768 * 1024 * 1024
MAX_PDF_PAGES = 128
MAX_DOCUMENT_TEXT = 16 * 1024 * 1024
MAX_OLD_FILES = 512
ALLOWED_TEAM_VALUES = {'kaleevaoksana7@gmail.com', '@sergeikaleev'}
sha = lambda data: hashlib.sha256(data).hexdigest()


def sha_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def load_current_policy():
    sys.path.insert(0, str(ROOT / 'scripts'))
    location = ROOT / 'scripts/audit-source-privacy-v060.py'
    spec = importlib.util.spec_from_file_location('submission_current_source_policy', location)
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    return policy


def canonical(name):
    if not isinstance(name, str) or not name:
        return False
    path = PurePosixPath(name)
    reserved = {'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(1,10)),*(f'LPT{i}' for i in range(1,10))}
    return (name == path.as_posix() and not path.is_absolute()
            and ':' not in name and '\\' not in name
            and all(not part.endswith(('.', ' '))
                    and part.split('.')[0].upper() not in reserved
                    and not re.search(r'[<>"|?*\x00-\x1f]', part) for part in path.parts)
            and not any(part.casefold() in {'.', '..', 'private', 'local-backup', '.load-runtime'}
                        for part in path.parts))


class Audit:
    def __init__(self, values, patterns):
        self.values = set(values) - ALLOWED_TEAM_VALUES
        self.encoded_values = tuple(value.encode('utf-8') for value in self.values)
        self.patterns = dict(patterns)
        self.patterns.update({
            'aws_access_key_literal': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
            'github_access_token_literal': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b'),
            'openai_key_literal': re.compile(r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b'),
            'stripe_live_key_literal': re.compile(r'\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b'),
        })
        self.findings = []
        self.counts = Counter()
        self.read_bytes = 0
        self.stats = Counter()

    def finding(self, category, context=''):
        # Neither names nor source content are public: only category and opaque name hash.
        self.findings.append({'category': category, 'memberNameSha256': sha(context.encode('utf-8'))})
        self.counts[category] += 1

    def read_member(self, package, item):
        self.read_bytes += item.file_size
        if self.read_bytes > MAX_TOTAL_READ_BYTES:
            raise ValueError('Bounded read budget exceeded')
        return package.read(item)

    def scan_text(self, text, context):
        if len(text) > MAX_DOCUMENT_TEXT:
            raise ValueError('Bounded document text budget exceeded')
        self.stats['textRepresentationsScanned'] += 1
        variants = {text, html.unescape(text)}
        if any(value in variant for value in self.values for variant in variants):
            self.finding('known_local_private_value', context)
        for category, pattern in self.patterns.items():
            if any(pattern.search(variant) for variant in variants):
                self.finding(category, context)

    def scan_xml(self, data, context):
        self.stats['xmlMembersScanned'] += 1
        # Reviewed OOXML is UTF-8. Reject alternate encodings before DTD checks.
        try:
            xml_text = data.decode('utf-8-sig')
        except UnicodeError:
            self.finding('unsupported_xml_encoding', context)
            return
        if '\x00' in xml_text:
            self.finding('unsupported_xml_encoding', context)
            return
        # Standard-library parsing only: no network, DTD expansion or external entities.
        if '<!DOCTYPE' in xml_text.upper() or '<!ENTITY' in xml_text.upper():
            self.finding('unexpected_xml_entity_declaration', context)
            return
        root = ET.fromstring(xml_text)
        nodes = list(root.iter())
        if len(nodes) > 200000:
            raise ValueError('Bounded XML node budget exceeded')
        values = [text for text in root.itertext() if text]
        attributes = [value for node in nodes for value in node.attrib.values()]
        # No-space form detects values broken into PowerPoint text runs.
        self.scan_text(''.join(values), context)
        self.scan_text(' '.join(values + attributes), context)

    def scan_pdf(self, data, context):
        from pypdf import PdfReader
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            reader = PdfReader(BytesIO(data), strict=True)
            if reader.is_encrypted:
                self.finding('unreadable_encrypted_pdf', context)
                return
            if len(reader.pages) > MAX_PDF_PAGES:
                raise ValueError('Bounded PDF page budget exceeded')
            self.stats['pdfDocumentsScanned'] += 1
            self.stats['pdfPagesExtracted'] += len(reader.pages)
            self.scan_text('\n'.join(page.extract_text() or '' for page in reader.pages), context)
            metadata = reader.metadata or {}
            self.scan_text('\n'.join(str(key) + '=' + str(value) for key, value in metadata.items()), context)
            stream = reader.trailer['/Root'].get('/Metadata')
            if stream is not None:
                xml = stream.get_object().get_data()
                if len(xml) > MAX_DOCUMENT_TEXT:
                    raise ValueError('Bounded PDF XMP budget exceeded')
                self.scan_xml(xml, context)
            # Attachments would introduce a new undocumented binary/text container.
            if list(reader.attachments):
                self.finding('unexpected_pdf_attachments', context)

    def scan_blob(self, data, name, depth):
        self.stats['memberBytePayloadsCompared'] += 1
        if any(value in data for value in self.encoded_values):
            self.finding('known_local_private_value_raw_bytes', name)
        suffix = PurePosixPath(name).suffix.lower()
        if suffix in {'.zip', '.pptx'}:
            if depth >= 2:
                self.finding('unreviewed_nested_archive_depth', name)
                return
            self.inspect_zip(BytesIO(data), name, depth + 1)
            return
        if suffix == '.pdf':
            self.scan_pdf(data, name)
            return
        if suffix in {'.xml', '.rels'}:
            self.scan_xml(data, name)
        try:
            text = data.decode('utf-8-sig')
        except UnicodeError:
            self.stats['binaryMembersWithoutTextDecode'] += 1
            return
        if '\x00' not in text:
            self.scan_text(text, name)

    def inspect_zip(self, input_file, context, depth=0, source_sha=None):
        self.stats['zipContainersScanned'] += 1
        with zipfile.ZipFile(input_file) as package:
            entries = package.infolist()
            if len(entries) > MAX_MEMBERS:
                raise ValueError('Bounded archive member budget exceeded')
            names = [item.filename for item in entries]
            if len(set(name.casefold() for name in names)) != len(names):
                self.finding('duplicate_or_case_colliding_zip_members', context)
            if sum(item.file_size for item in entries) > MAX_ARCHIVE_EXPANDED:
                raise ValueError('Bounded expanded archive budget exceeded')
            for item in entries:
                if (not canonical(item.filename) or item.is_dir()
                        or stat.S_ISLNK(item.external_attr >> 16)
                        or item.flag_bits & 1 or item.file_size > MAX_MEMBER_BYTES):
                    self.finding('unsafe_or_unbounded_zip_member', context + '/' + item.filename)
            # Reads enforce CRC independently of manifest SHA checks.
            payloads = {}
            for item in entries:
                if item.file_size > MAX_MEMBER_BYTES:
                    continue
                member_context = context + '/' + item.filename
                data = self.read_member(package, item)
                if depth == 0 or item.filename in {'fsp-signal/SOURCE-MANIFEST.json', 'fsp-signal/RELEASE-METADATA.json'}:
                    payloads[item.filename] = data
                self.scan_blob(data, member_context, depth)
            if depth == 0:
                self.verify_outer_manifest(payloads, names, source_sha)
            elif context.endswith('/' + SOURCE_MEMBER):
                self.verify_source_manifest(package, payloads, names)

    def verify_outer_manifest(self, payloads, names, source_sha):
        manifest = json.loads(payloads[MANIFEST_MEMBER].decode('utf-8-sig'))
        if manifest.get('schemaVersion') != 1 or manifest.get('applicationVersion') != '0.6.0':
            self.finding('outer_manifest_version_mismatch')
        if manifest.get('sourceSha256') != source_sha or sha(payloads[SOURCE_MEMBER]) != source_sha:
            self.finding('outer_source_seal_mismatch')
        records = manifest.get('files', [])
        if not isinstance(records, list) or len(records) > 128:
            raise ValueError('Bounded outer manifest required')
        recorded = set()
        for record in records:
            name = record.get('file')
            if (not canonical(name) or name in recorded or not isinstance(record.get('bytes'), int)
                    or not re.fullmatch(r'[a-f0-9]{64}', record.get('sha256', ''))):
                self.finding('invalid_outer_manifest_record')
                continue
            recorded.add(name)
            data = payloads.get(name)
            if data is None or len(data) != record['bytes'] or sha(data) != record['sha256']:
                self.finding('outer_manifest_member_hash_or_size_mismatch', name)
        if set(names) != recorded | {MANIFEST_MEMBER}:
            self.finding('outer_manifest_incomplete_or_extra_members')
        self.stats['outerManifestRecords'] = len(records)

    def verify_source_manifest(self, package, payloads, names):
        manifest_name = 'fsp-signal/SOURCE-MANIFEST.json'
        records = json.loads(payloads[manifest_name].decode('utf-8-sig'))
        if not isinstance(records, list) or len(records) > MAX_MEMBERS:
            raise ValueError('Bounded embedded source manifest required')
        recorded = set()
        for record in records:
            relative = record.get('path')
            if (not canonical(relative) or not isinstance(record.get('bytes'), int)
                    or not re.fullmatch(r'[a-f0-9]{64}', record.get('sha256', ''))):
                self.finding('invalid_embedded_source_manifest_record')
                continue
            name = 'fsp-signal/' + relative
            if name in recorded:
                self.finding('duplicate_embedded_source_manifest_record')
            recorded.add(name)
            if name not in names:
                self.finding('embedded_source_manifest_member_missing', name)
                continue
            data = self.read_member(package, package.getinfo(name))
            if len(data) != record['bytes'] or sha(data) != record['sha256']:
                self.finding('embedded_source_manifest_hash_or_size_mismatch', name)
        if set(names) != recorded | {manifest_name}:
            self.finding('embedded_source_manifest_incomplete_or_extra_members')
        metadata = json.loads(payloads['fsp-signal/RELEASE-METADATA.json'].decode('utf-8-sig'))
        if metadata.get('applicationVersion') != '0.6.0':
            self.finding('embedded_source_version_mismatch')
        self.stats['embeddedSourceManifestRecords'] = len(records)


def old_inventory():
    if not OLD_ROOT.is_dir() or OLD_ROOT.is_symlink():
        raise ValueError('Historical protected directory missing/unsafe')
    result = {}
    total_bytes = 0
    names = ('Signal-Best-Match-0.5.0.zip', 'fsp-signal-source-0.5.0.zip', 'final-report.json',
             'Signal-Technical-Description.pdf', 'Signal-Pitch.pptx', 'Signal-Pitch.pdf',
             'Signal-Demo.mp4', 'Signal-Demo-audit.json', 'submission-manifest.json',
             'package-ready.json', 'submission-privacy-audit.json')
    for name in names:
        path = OLD_ROOT / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 512 * 1024 * 1024:
            raise ValueError('Protected historical companion missing/unsafe')
        total_bytes += path.stat().st_size
        if total_bytes > 1024 * 1024 * 1024:
            raise ValueError('Bounded historical inventory total exceeded')
        result[name] = sha_file(path)
    if result.get(OLD_OUTER.name) != OLD_OUTER_SHA:
        raise ValueError('Authoritative historical outer seal differs')
    if result.get('fsp-signal-source-0.5.0.zip') != OLD_SOURCE_SHA:
        raise ValueError('Authoritative historical source seal differs')
    return result


def self_test():
    # All controls are in-memory and fabricated; never load local private inputs.
    checks = 0
    key = 'FabricatedPrivateValueForAudit012345'
    def scanner():
        return Audit({key}, {'private_key_block': re.compile(r'-----BEGIN (?:RSA )?PRIVATE KEY-----')})
    test = scanner(); test.scan_text('Public team contact kaleevaoksana7@gmail.com', 'text')
    assert not test.findings; checks += 1
    test = scanner(); test.scan_text(key, 'text'); assert test.counts['known_local_private_value']; checks += 1
    test = scanner(); test.scan_text('-----BEGIN RSA PRIVATE KEY-----', 'text'); assert test.counts['private_key_block']; checks += 1
    test = scanner(); test.scan_xml(('<p><r>' + key[:12] + '</r><r>' + key[12:] + '</r></p>').encode(), 'xml'); assert test.counts['known_local_private_value']; checks += 1
    test = scanner(); test.scan_xml(b'<!DOCTYPE root><root/>', 'xml'); assert test.counts['unexpected_xml_entity_declaration']; checks += 1
    test = scanner(); test.scan_xml('<!DOCTYPE root [<!ENTITY x "fake">]><root>&x;</root>'.encode('utf-16'), 'xml'); assert test.counts['unsupported_xml_encoding']; checks += 1
    assert not canonical('../file') and not canonical('A\\B') and not canonical('CON.txt') and not canonical('a.') and not canonical('a ') and canonical('verification/a.json'); checks += 1
    def archive(files):
        out = BytesIO()
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
            for name, data in files:
                z.writestr(name, data)
        out.seek(0)
        return out
    test = scanner(); nested = archive([('slide.xml', ('<p>' + key + '</p>').encode())]); test.scan_blob(nested.getvalue(), 'test.pptx', 0); assert test.counts['known_local_private_value']; checks += 1
    test = scanner(); test.inspect_zip(archive([('A.txt', b'public'), ('a.txt', b'public')]), 'test.pptx', 1); assert test.counts['duplicate_or_case_colliding_zip_members']; checks += 1
    test = scanner(); test.inspect_zip(archive([('../bad.txt', b'public')]), 'test.pptx', 1); assert test.counts['unsafe_or_unbounded_zip_member']; checks += 1
    from pypdf import PdfWriter
    out = BytesIO(); writer = PdfWriter(); writer.add_blank_page(width=72, height=72); writer.add_metadata({'/Author': key}); writer.write(out)
    test = scanner(); test.scan_pdf(out.getvalue(), 'test.pdf'); assert test.counts['known_local_private_value']; checks += 1
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    out = BytesIO(); writer = PdfWriter(); page = writer.add_blank_page(width=300, height=72)
    font = DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
    stream = DecodedStreamObject(); stream.set_data(('BT /F1 10 Tf 10 30 Td (' + key + ') Tj ET').encode())
    page[NameObject('/Contents')] = writer._add_object(stream); writer.write(out)
    test = scanner(); test.scan_pdf(out.getvalue(), 'test.pdf'); assert test.counts['known_local_private_value']; checks += 1
    test = scanner(); body = b'public'; manifest = {'schemaVersion':1,'applicationVersion':'0.6.0','sourceSha256':sha(body),'files':[{'file':SOURCE_MEMBER,'bytes':len(body),'sha256':'0'*64}]}; test.verify_outer_manifest({SOURCE_MEMBER:body,MANIFEST_MEMBER:json.dumps(manifest).encode()},[SOURCE_MEMBER,MANIFEST_MEMBER],sha(body)); assert test.counts['outer_manifest_member_hash_or_size_mismatch']; checks += 1
    assert Audit(ALLOWED_TEAM_VALUES, {}).values == set(); checks += 1
    print(json.dumps({'passed':True,'selfTestChecks':checks,'scope':'In-memory fabricated controls only; no release archive, database, runtime or private comparison values read'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-outer-sha256')
    parser.add_argument('--expected-source-sha256')
    parser.add_argument('--private-manifest', action='append', default=[])
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if not 1 <= len(args.private_manifest) <= 16:
        raise ValueError('Explicit bounded external private comparison manifests required')
    if any(not re.fullmatch(r'[a-f0-9]{64}', value or '') for value in [args.expected_outer_sha256,args.expected_source_sha256]):
        raise ValueError('Exact expected seal hashes required')
    for path in [OUTER,SOURCE]:
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 256 * 1024 * 1024:
            raise ValueError('Fixed bounded release seals required')
    protected_before = old_inventory()
    before_outer, before_source = sha_file(OUTER), sha_file(SOURCE)
    policy = load_current_policy()
    values, comparison = policy.audit.known_values()
    private = policy.private_values(args.private_manifest)
    values.update(private)
    audit = Audit(values, policy.audit.CONTENT_PATTERNS)
    if before_outer != args.expected_outer_sha256:
        audit.finding('expected_outer_seal_sha_mismatch')
    if before_source != args.expected_source_sha256:
        audit.finding('expected_source_seal_sha_mismatch')
    # Silence parsing diagnostics, which may include a matched private string.
    import logging
    logging.getLogger('pypdf').setLevel(logging.CRITICAL)
    audit.inspect_zip(OUTER, 'outer', source_sha=args.expected_source_sha256)
    after_outer, after_source, protected_after = sha_file(OUTER),sha_file(SOURCE),old_inventory()
    if before_outer != after_outer:
        audit.finding('outer_seal_changed_during_audit')
    if before_source != after_source:
        audit.finding('source_seal_changed_during_audit')
    if protected_before != protected_after:
        audit.finding('historical_inventory_changed_during_audit')
    report = {'schemaVersion':1,'applicationVersion':'0.6.0','auditVersion':'signal-submission-privacy-v060',
              'generatedAt':datetime.now(timezone.utc).isoformat(),'passed':not audit.findings,
              'outerSha256':before_outer,'expectedOuterSha256':args.expected_outer_sha256,
              'sourceSha256':before_source,'expectedSourceSha256':args.expected_source_sha256,
              'outerArchiveBytes':OUTER.stat().st_size,'scriptSha256':sha_file(Path(__file__)),
              'policyScriptSha256':sha_file(ROOT / 'scripts/audit-source-privacy-v060.py'),
              'integrity':'ZIP member CRC, safe unique bounded paths, outer and embedded source manifest SHA256/byte lengths, exact member sets',
              'knownValueComparison':{**comparison,'externalPrivateManifestsCompared':len(args.private_manifest),'externalPrivateValuesCompared':len(private),'uniqueKnownValuesCompared':len(audit.values),'privateValuesPathsAndMatchesExported':False,'confirmedTeamContactsExcluded':True},
              'scanned':dict(audit.stats),'findings':audit.findings,'findingCounts':dict(audit.counts),'totalFindings':len(audit.findings),
              'outerArchiveUnchanged':before_outer==after_outer,'sourceSealUnchanged':before_source==after_source,
              'historical050':{'authoritativeOuterSha256':OLD_OUTER_SHA,'authoritativeSourceSha256':OLD_SOURCE_SHA,'inventoryFiles':len(protected_before),'scope':'Exact sealed outer/source and nine named final companions; not every historical working file','inventoryDigest':sha(json.dumps(protected_before,sort_keys=True).encode()),'unchanged':protected_before==protected_after},
              'scope':'Read-only actual outer submission ZIP after sealing; no archive modification or external publication',
              'limitations':['Known-value comparison and the listed credential patterns are not a universal secret detector.',
                             'Binary image/video frames, visual content and audio are not OCR/transcription audited.',
                             'PDF extracted text, Info/XMP metadata and ZIP/XML text are inspected; this is not a forensic decoder of every binary field.',
                             'Authorized public team contacts and existing source-policy template exclusions are intentional content.',
                             'Private values, private input paths and matching content are never printed or recorded.']}
    if OUTPUT.exists():
        raise ValueError('Post-seal audit receipt already exists; do not overwrite history')
    OUTPUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key:report[key] for key in ['passed','outerSha256','sourceSha256','totalFindings','findingCounts','outerArchiveUnchanged','sourceSealUnchanged']},ensure_ascii=False))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # Never emit parser/path exception text or traceback from local private inputs.
        print(json.dumps({'passed':False,'auditFailureCategory':type(error).__name__,'privateValuesPathsAndMatchesExported':False,'scope':'Audit could not complete; no universal privacy claim'}))
        raise SystemExit(1)
