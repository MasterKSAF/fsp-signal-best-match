"""Rebuild the technical PDF from Markdown and explicitly supplied release facts.

Use the bundled Python (reportlab, pypdf). No network, secret or database access.
After rendering with Poppler, inspect all pages; extraction is only a content check.
"""
from pathlib import Path
from html import escape
import argparse
from datetime import datetime, timezone
import hashlib
import json
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--evidence', type=Path, default=ROOT / 'docs/technical-release-input.json')
parser.add_argument('--source', type=Path, default=ROOT / 'docs/technical-description.md')
parser.add_argument('--output', type=Path, default=ROOT / 'outputs/submission/Signal-Technical-Description.pdf')
parser.add_argument('--audit-dir', type=Path, default=ROOT / 'outputs/verification/technical-description')
parser.add_argument('--layout-check', action='store_true', help='Measure source layout only, without generating a PDF')
args = parser.parse_args()
facts = json.loads(args.evidence.read_text(encoding='utf-8')) if args.evidence.exists() else {}
if facts.get('draft', True) and not args.layout_check:
    raise ValueError('PDF blocked until explicit current-build acceptance facts are supplied; pending later checks must be labelled')
source = args.source.resolve()
output = args.output.resolve()
audit_dir = args.audit_dir.resolve()
output.parent.mkdir(parents=True, exist_ok=True)
audit_dir.mkdir(parents=True, exist_ok=True)

font_root = Path('C:/Windows/Fonts')
local_font = ROOT / 'artifacts/fsp-signal/public/fonts/Manrope-Variable.ttf'
regular = font_root / 'arial.ttf' if (font_root / 'arial.ttf').exists() else local_font
bold = font_root / 'arialbd.ttf' if (font_root / 'arialbd.ttf').exists() else local_font
pdfmetrics.registerFont(TTFont('SignalBody', str(regular)))
pdfmetrics.registerFont(TTFont('SignalBold', str(bold)))
pdfmetrics.registerFontFamily('SignalBody', normal='SignalBody', bold='SignalBold', italic='SignalBody', boldItalic='SignalBold')
ink = colors.HexColor('#192031')
muted = colors.HexColor('#586174')
accent = colors.HexColor('#5139ba')
styles = {
    'title': ParagraphStyle('Title', fontName='SignalBold', fontSize=34, leading=40, textColor=accent, spaceAfter=14),
    'h1': ParagraphStyle('Heading', fontName='SignalBold', fontSize=21, leading=26, textColor=ink, spaceAfter=16, keepWithNext=True),
    'h2': ParagraphStyle('Subheading', fontName='SignalBold', fontSize=15, leading=19, textColor=accent, spaceAfter=12, keepWithNext=True),
    'h3': ParagraphStyle('Subsection', fontName='SignalBold', fontSize=11.8, leading=15, textColor=accent, spaceBefore=10, spaceAfter=6, keepWithNext=True),
    'p': ParagraphStyle('Body', fontName='SignalBody', fontSize=10.2, leading=14.5, textColor=ink, spaceAfter=9),
    'code': ParagraphStyle('Code', fontName='SignalBody', fontSize=9.3, leading=13.5, textColor=ink, leftIndent=11, borderColor=colors.HexColor('#ddd5f4'), borderWidth=0.5, borderPadding=9, backColor=colors.HexColor('#f7f5fc'), spaceBefore=5, spaceAfter=12),
    'cell': ParagraphStyle('Cell', fontName='SignalBody', fontSize=9.2, leading=12.8, textColor=ink),
    'cell_header': ParagraphStyle('HeaderCell', fontName='SignalBold', fontSize=9.2, leading=12.8, textColor=colors.white),
}

lock = (ROOT / 'pnpm-lock.yaml').read_text(encoding='utf-8')
def version(package):
    match = re.search(r"^  ['\"]?" + re.escape(package) + r'@([\d.]+)[\:\(\'\"]', lock, flags=re.M)
    if not match:
        raise ValueError(f'No pinned version for {package}')
    return match.group(1)

deps = [
    ('React / React DOM', f"{version('react')} / {version('react-dom')}"),
    ('Vite / TypeScript', f"{version('vite')} / {version('typescript')}"),
    ('TanStack Query / Wouter', f"{version('@tanstack/react-query')} / {version('wouter')}"),
    ('Tailwind CSS / Lucide React', f"{version('tailwindcss')} / {version('lucide-react')}"),
    ('Express / Zod', f"{version('express')} / {version('zod')}"),
    ('Drizzle ORM / node-postgres', f"{version('drizzle-orm')} / {version('pg')}"),
    ('PDFKit / Nodemailer', f"{version('pdfkit')} / {version('nodemailer')}"),
    ('Orval / tsx', f"{version('orval')} / {version('tsx')}"),
    ('Node.js / pnpm', '24 / 11.25.0'),
    ('PostgreSQL / Mailpit', '17-alpine / образ с digest в compose.yaml'),
]
dependency_table = '| Компонент | Зафиксированная версия |\n| --- | --- |\n' + '\n'.join(f'| {name} | {value} |' for name, value in deps)

default_checks = [('Итог текущей сборки', 'Требуется фактический протокол. Прежние результаты не подтверждают новую сборку.')]
checks = facts.get('checks', default_checks)
verification_table = '| Проверка | Фактический результат / протокол |\n| --- | --- |\n' + '\n'.join(f'| {name} | {value} |' for name, value in checks)
summary = facts.get('releaseSummary', 'Итоговые результаты нагрузки, проверки чистого архива и ID финального образа фиксируются в сопровождающем release manifest. До наличия соответствующего успешного протокола этот документ не утверждает прохождение этих проверок.')
image=facts.get('provenance',{}).get('image') or 'Итоговый image ещё не предоставлен.'
provenance_note = facts.get('provenance', {}).get('runtimeScope', 'Связь измерений с текущим образом не предоставлена; прежние протоколы не подтверждают этот образ.')
build_provenance='Текущий Docker image:\n\n```text\n'+image+'\n```\n\n'+provenance_note
text = source.read_text(encoding='utf-8').replace('{{dependency_table}}', dependency_table).replace('{{verification_table}}', verification_table).replace('{{release_summary}}', summary).replace('{{build_provenance}}',build_provenance)
if re.search(r'\{\{[a-z_]+\}\}', text):
    raise ValueError('Unresolved technical-document placeholder')
# Normal hyphens are used for portable and consistent glyph rendering.
text = text.replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-')
pages = text.split('<!-- page -->')

def inline(value):
    value = escape(value)
    value = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', value)
    value = re.sub(r'`([^`]+)`', r'<font color="#5139ba">\1</font>', value)
    return value

def table(lines):
    rows = [[cell.strip() for cell in line.strip().strip('|').split('|')] for line in lines]
    rows = [row for row in rows if not all(re.fullmatch(r'[-: ]+', c) for c in row)]
    count = len(rows[0])
    widths = [168, 347] if count == 2 else [515 / count] * count
    content = [[Paragraph(inline(cell), styles['cell_header' if ri == 0 else 'cell']) for cell in row] for ri, row in enumerate(rows)]
    result = Table(content, colWidths=widths, hAlign='LEFT', repeatRows=1)
    result.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), accent),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#f4f2fa'), colors.white]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LINEBELOW', (0, -1), (-1, -1), 0.4, colors.HexColor('#ded9ec')),
    ]))
    return result

story = []
page_heights = []
for page_number, page in enumerate(pages):
    if page_number:
        story.append(PageBreak())
    page_start = len(story)
    blocks = re.split(r'\n\s*\n', page.strip())
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        if block.startswith('```'):
            lines = block.splitlines()[1:-1]
            story.append(Paragraph('<br/>'.join(escape(line) for line in lines), styles['code']))
        elif block.startswith('|'):
            story.extend([table(block.splitlines()), Spacer(1, 10)])
        elif block.startswith('# '):
            lines = block.splitlines()
            for line in lines:
                if line.startswith('## '):
                    story.append(Paragraph(inline(line[3:]), styles['h2']))
                else:
                    story.append(Paragraph(inline(line[2:]), styles['title' if page_number == 0 else 'h1']))
        elif block.startswith('### '):
            story.append(Paragraph(inline(block[4:]), styles['h3']))
        elif block.startswith('## '):
            story.append(Paragraph(inline(block[3:]), styles['h2']))
        elif re.match(r'^\d+\. ', block):
            story.append(Paragraph('<br/>'.join(inline(line) for line in block.splitlines()), styles['p']))
        else:
            story.append(Paragraph(inline(' '.join(block.splitlines())), styles['p']))
    height = 0
    for item in story[page_start:]:
        _, item_height = item.wrap(515, 10000)
        height += item_height + item.getSpaceBefore() + item.getSpaceAfter()
    page_heights.append({'page':page_number+1,'heading':page.strip().splitlines()[0], 'estimatedPoints':round(height,2), 'availablePoints':round(A4[1]-38-56,2)})

if args.layout_check:
    print(json.dumps({'pages':len(pages),'layoutOnly':True,'pageHeights':page_heights},ensure_ascii=False,indent=2))
    raise SystemExit(0)

def footer(canvas, document):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#d8d3e6'))
    canvas.setLineWidth(0.5)
    canvas.line(40, 42, A4[0] - 40, 42)
    canvas.setFont('SignalBody', 8)
    canvas.setFillColor(muted)
    canvas.drawString(40, 28, 'Signal · Best Match · Техническое описание · ' + facts.get('sliceDate','06.10.2026'))
    canvas.drawRightString(A4[0] - 40, 28, f'{document.page} / {len(pages)}')
    canvas.restoreState()

# SimpleDocTemplate's frame adds 6 pt of padding on each edge. Compensate so
# the visible content margins and 515 pt table width match the layout preflight.
document = SimpleDocTemplate(str(output), pagesize=A4, rightMargin=34, leftMargin=34, topMargin=32, bottomMargin=50, title='Signal - техническое описание', author='Best Match', subject='Специальный трек ФСП ЛЦТ 2026', pageCompression=1)
document.build(story, onFirstPage=footer, onLaterPages=footer)
reader = PdfReader(output)
extracted = '\n'.join(page.extract_text() for page in reader.pages)
assert len(reader.pages) == len(pages), f'Expected {len(pages)} designed pages, got {len(reader.pages)}; inspect overflow.'
for page_number, original in enumerate(pages):
    heading = original.strip().splitlines()[0][2:]
    page_text = ' '.join(reader.pages[page_number].extract_text().split())
    assert heading in page_text, f'Misplaced heading: {heading}'
assert '\u25a0' not in extracted and '{{' not in extracted
required_topics = [
    'Функциональная и компонентная архитектура',
    'Механика проверки и устойчивость к распространению',
    'Подбор и категоризация',
    'Процедура валидации и результаты',
    'Предполагаемая интеграция с ФСП',
    'Описание API',
    'Библиотеки и версии',
    'Сборка, развёртывание и локальный запуск',
]
normalized_text = ' '.join(extracted.split())
for topic in required_topics:
    assert topic in normalized_text, f'Missing official documentation topic: {topic}'
audit = {
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'factsGeneratedAt': facts.get('generatedAt'),
    'source': str(source), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'evidenceInput': str(args.evidence), 'evidenceInputPresent': args.evidence.exists(),
    'evidenceInputSha256': hashlib.sha256(args.evidence.read_bytes()).hexdigest(),
    'builderSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'lockfileSha256': hashlib.sha256((ROOT / 'pnpm-lock.yaml').read_bytes()).hexdigest(),
    'pdf': str(output), 'pdfSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    'pages': len(reader.pages), 'bytes': output.stat().st_size,
    'font': str(regular), 'dependencies': dict(deps),
    'releaseFacts': facts, 'designedPageHeights': page_heights,
    'officialRequiredTopics': required_topics,
    'textChecksPassed': True, 'visualInspection': 'pending; render every page after latest build',
}
(audit_dir / 'build.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
(audit_dir / 'content.txt').write_text(extracted, encoding='utf-8')
print(json.dumps({'pages': len(reader.pages), 'bytes': output.stat().st_size, 'pdf': str(output)}, ensure_ascii=False))
