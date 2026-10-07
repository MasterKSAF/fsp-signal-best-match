"""Independent actual-PDF extraction and geometry controls; never touches an API/DB."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import pdfplumber
from pypdf import PdfReader

root = Path.cwd()
inputs = root / 'outputs/verification/assessment-purpose/resume-pdf-layout-inputs-v050.json'
fixture_report = json.loads(inputs.read_text(encoding='utf-8'))
checks, pdfs = [], []
footer_text = 'Контактные поля аккаунта в этот файл не добавляются. Текст резюме и ссылки сохранены как указаны кандидатом.'
for fixture in fixture_report['outputs']:
    source = Path(fixture['path'])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == fixture['sha256']
    reader = PdfReader(source)
    with pdfplumber.open(source) as document:
        texts = [page.extract_text(x_tolerance=2, y_tolerance=3) or '' for page in document.pages]
        full_text = ' '.join(' '.join(texts).split())
        assert fixture['minimumPages'] <= len(document.pages) <= fixture['maximumPages'], len(document.pages)
        assert fixture['expectedName'] in full_text
        assert fixture['otherDocumentName'] not in full_text, 'Independent PDFs leaked another document name'
        assert footer_text in full_text
        assert 'Телефон и электронная почта в этот файл не включены.' not in full_text
        for marker in fixture['markers']:
            assert marker in full_text, marker
        for account_field in fixture['accountFieldsMustBeAbsent']:
            assert account_field not in full_text, 'Account contact field exported'
        page_results = []
        font_names, embedded_font_hashes = set(), set()
        for index, (page, text, pdf_page) in enumerate(zip(document.pages, texts, reader.pages)):
            assert abs(page.width - 595.28) < .1 and abs(page.height - 841.89) < .1
            footer = f"Signal · {fixture['expectedDate']} · {index + 1} / {len(document.pages)}"
            assert footer in ' '.join(text.split()), footer
            assert all(c['x0'] >= 47 and c['x1'] <= page.width - 46 for c in page.chars if c['text'].strip()), 'Horizontal clipping'
            assert all(c['top'] >= 46 and c['bottom'] <= page.height - 24 for c in page.chars if c['text'].strip()), 'Vertical clipping'
            body = [c for c in page.chars if c['top'] < page.height - 58 and c['text'].strip()]
            bottom_region = [c for c in page.chars if c['top'] >= page.height - 58 and c['text'].strip()]
            assert body and all(c['top'] >= page.height - 38 for c in bottom_region), 'Text intersects protected bottom margin/footer'
            resources = pdf_page['/Resources'].get_object()['/Font'].get_object()
            for font in resources.values():
                font_object = font.get_object()
                font_names.add(str(font_object['/BaseFont']).split('+')[-1])
                descriptor = font_object['/DescendantFonts'][0].get_object()['/FontDescriptor'].get_object()
                embedded_font_hashes.add(hashlib.sha256(descriptor['/FontFile2'].get_object().get_data()).hexdigest())
            links = []
            for annotation in pdf_page.get('/Annots', []):
                action = annotation.get_object().get('/A')
                if action and '/URI' in action:
                    links.append(str(action['/URI']))
            page_results.append({'number': index + 1, 'characters': len(page.chars), 'footer': footer, 'links': links, 'bodyBottom': round(max(c['bottom'] for c in body), 2)})
        # Both bundled static font assets retain the upstream internal name
        # Manrope-ExtraLight; their actual 400/600 weights are distinct.
        assert font_names == {'Manrope-ExtraLight'}, font_names
        assert len(embedded_font_hashes) == 2, 'Expected two distinct embedded font subsets'
        if fixture['minimumPages'] > 1:
            assert 'https://example.test/portfolio' in [link for page in page_results for link in page['links']]
        checks.extend([fixture['name'] + ': schema-valid fixture; actual UTF-8/Cyrillic/currency/footer extracted', fixture['name'] + ': A4, all-page boundaries/footer and independent document identity', fixture['name'] + ': account contact fields absent, free text/links preserved when provided', fixture['name'] + ': exactly two distinct embedded font subsets; clickable URLs preserved'])
        pdfs.append({'path': str(source), 'sha256': fixture['sha256'], 'bytes': fixture['bytes'], 'pages': page_results, 'fontInternalNames': sorted(font_names), 'embeddedFontSha256': sorted(embedded_font_hashes)})
report = {'verifiedAt': datetime.now(timezone.utc).isoformat(), 'sourceSha256': fixture_report['sourceSha256'], 'status': 'PASS', 'checks': checks, 'pdfs': pdfs, 'limitations': ['Synthetic typography/layout fixtures; no human qualification, security penetration, concurrency or performance SLA claim.', 'Geometry and text checks do not replace visual verification; all-page PNG inspection is recorded separately.']}
output = root / 'outputs/verification/assessment-purpose/resume-pdf-layout-v050.json'
output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'status': report['status'], 'checks': len(checks), 'pages': [len(pdf['pages']) for pdf in pdfs], 'report': str(output)}, ensure_ascii=False))
