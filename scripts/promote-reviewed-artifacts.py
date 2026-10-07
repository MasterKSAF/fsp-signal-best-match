"""Copy exact reviewed artifacts and record factual visual/package acceptance.

Run only after viewing every latest page and slide. This script cannot perform
visual review; --reviewed records the explicit review already performed.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import argparse
import hashlib
import json
import re
import shutil
import zipfile
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--pitch-build',type=Path,required=True)
parser.add_argument('--technical-build',type=Path,default=ROOT/'outputs/internal/technical-refinement')
parser.add_argument('--reviewed',action='store_true')
args=parser.parse_args()
if not args.reviewed:
    raise ValueError('View every latest page/slide before recording visual acceptance')
pitch=(ROOT/args.pitch_build).resolve()
technical=(ROOT/args.technical_build).resolve()
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
load=lambda path:json.loads(path.read_text(encoding='utf-8'))
save=lambda path,value:path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
now=datetime.now(timezone.utc).isoformat()
facts=load(ROOT/'docs/technical-release-input.json')
config=load(ROOT/'docs/presentation-content.json')
assert not facts['draft'] and not config['draft']
acceptance=ROOT/facts['provenance']['finalAcceptance']
assert sha(acceptance)==facts['provenance']['finalAcceptanceSha256']
for filename,expected in facts['provenance']['sourceHashes'].items():
    assert sha(ROOT/filename)==expected, f'Evidence source changed: {filename}'
pdf=technical/'Signal-Technical-Description.pdf'
pptx=pitch/'validated/Signal-Pitch.pptx'
pitch_pdf=pitch/'Signal-Pitch.pdf'
audit=load(technical/'audit/build.json')
provenance=load(pitch/'provenance.json')
receipt=load(pitch/'validation.json')
assert audit['sourceSha256']==sha(ROOT/'docs/technical-description.md')
assert audit['pdfSha256']==sha(pdf) and audit['textChecksPassed']
assert provenance['config']==config
assert provenance['pptxSha256']==sha(pptx)
assert provenance['pdfSha256']==sha(pitch_pdf)
assert receipt['finalSha256']==sha(pptx)
assert receipt['packageIntegrity']['status']=='pass' and receipt['packageIntegrity']['exitCode']==0
assert receipt['presentationLayout']['exitCode']==0 and receipt['presentationLayout']['findingCount']==0
assert receipt['fontSelection']['passed']
assert receipt['firstPartyImport']['passed'] and receipt['firstPartyImport']['sha256']==sha(pptx)
assert receipt['firstPartyImport']['slideCount']==8
with zipfile.ZipFile(pptx) as package:
    assert package.testzip() is None
    assert len([n for n in package.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml',n)])==8
    for name in package.namelist():
        part=PurePosixPath(name)
        assert not part.is_absolute() and '..' not in part.parts and '\\' not in name and ':' not in name
page_count=len(PdfReader(pdf).pages)
assert page_count==audit['pages']
assert len(PdfReader(pitch_pdf).pages)==8
technical_renders=[technical/f'page-{n:02d}.png' for n in range(1,page_count+1)]
slide_renders=[pitch/f'final-slide-{n}.png' for n in range(1,9)]
pitch_pdf_renders=[pitch/f'pdf-page-{n}.png' for n in range(1,9)]
assert all(path.is_file() for path in technical_renders+slide_renders+pitch_pdf_renders)
submission=ROOT/'outputs/submission'
history=ROOT/'outputs/history/media-before-refinement-2026-10-06'
history.mkdir(parents=True,exist_ok=True)
old=[]
for filename in ['Signal-Technical-Description.pdf','Signal-Pitch.pptx','Signal-Pitch.pdf']:
    existing=submission/filename
    if existing.exists():
        target=history/filename
        if target.exists():
            assert sha(target)==sha(existing), f'History already contains another revision: {filename}'
        else:
            shutil.copy2(existing,target)
        old.append({'file':filename,'sha256':sha(target),'bytes':target.stat().st_size})
for filename,target_name in [('presentation-completion.json','presentation-completion.json'),('presentation-finalization.json','presentation-finalization.json'),('technical-description/build.json','technical-description-build.json')]:
    existing=ROOT/'outputs/verification'/filename
    if existing.exists() and not (history/target_name).exists():
        shutil.copy2(existing,history/target_name)
save(history/'manifest.json',{'generatedAt':now,'scope':'Preserved artifacts before current refinement promotion','files':old})
for original in [pdf,pptx,pitch_pdf]:
    destination=submission/original.name
    shutil.copy2(original,destination)
    assert sha(original)==sha(destination)
audit.update({'passed':True,'promotedAt':now,'pdf':str(submission/pdf.name),
    'visualInspection':'passed after viewing every latest Poppler page',
    'visualReview':{'passed':True,'reviewedPages':page_count,'pageNumbers':list(range(1,page_count+1)),
        'renderCount':page_count,'artifactSha256':sha(pdf),'renderDirectory':str(technical),
        'renderHashes':{p.name:sha(p) for p in technical_renders},
        'scope':'Visual page layout, legibility, glyphs, tables, margins and clipping; not human usability research'}})
audit_dir=ROOT/'outputs/verification/technical-description'
audit_dir.mkdir(parents=True,exist_ok=True)
save(audit_dir/'build.json',audit)
shutil.copy2(technical/'audit/content.txt',audit_dir/'content.txt')
receipt.update({'passed':True,'promotedAt':now,'finalPath':str(submission/pptx.name),
    'sourceReceiptSha256':sha(pitch/'validation.json'),
    'aggregateScope':'Conjunction of actual package/layout/font/import acceptance; native PowerPoint execution not performed'})
save(ROOT/'outputs/verification/presentation-finalization.json',receipt)
provenance.update({'passed':True,'promotedAt':now,'slideCount':8,'pdfPages':8,
    'pptx':str(submission/pptx.name),'pdfPath':str(submission/pitch_pdf.name),
    'finalizer':'outputs/verification/presentation-finalization.json',
    'zipSafePathsAndCrcPassed':True,
    'visualReview':{'passed':True,'reviewedSlides':8,'slideNumbers':list(range(1,9)),'renderCount':8,
        'pdfReviewedPages':8,'pdfRenderCount':8,'pptxSha256':sha(pptx),'pdfSha256':sha(pitch_pdf),
        'renderHashes':{p.name:sha(p) for p in slide_renders+pitch_pdf_renders},
        'scope':'All exact saved PPTX renders and all eight Poppler PDF pages; official template, content, wrapping, screenshots, margins and glyphs',
        'warningDisposition':'One cover object extends beyond the slide boundary as in the source artwork; visually correct. No layout findings.'}})
save(ROOT/'outputs/verification/presentation-completion.json',provenance)
summary={'schemaVersion':'signal-reviewed-artifacts-v1','generatedAt':now,'passed':True,
    'acceptanceSha256':sha(acceptance),'image':facts['provenance']['image'],
    'artifacts':[
        {'path':'outputs/submission/'+pdf.name,'sha256':sha(pdf),'pages':page_count,'visualReviewed':page_count},
        {'path':'outputs/submission/'+pptx.name,'sha256':sha(pptx),'slides':8,'visualReviewed':8,'zipCrcAndPaths':True},
        {'path':'outputs/submission/'+pitch_pdf.name,'sha256':sha(pitch_pdf),'pages':8,'visualReviewed':8}],
    'audits':['outputs/verification/technical-description/build.json','outputs/verification/presentation-completion.json','outputs/verification/presentation-finalization.json'],
    'scope':'Factual local artifact acceptance. PDF pitch is a visual companion; PPTX remains editable. Native PowerPoint not executed.',
    'history':'outputs/history/media-before-refinement-2026-10-06'}
save(ROOT/'outputs/verification/artifact-visual-review.json',summary)
owned=[
    'docs/matching-v3.md','docs/technical-description.md','docs/pitch-script.md',
    'docs/technical-release-input.json','docs/presentation-content.json',
    'docs/artifact-acceptance-display.json','docs/artifact-screenshot-input.json',
    'docs/matching-competitive-control.md','scripts/prepare-refinement-artifact-facts.py',
    'scripts/build-technical-description.py','scripts/build-pitch.mjs','scripts/build-pitch-pdf.py',
    'scripts/promote-reviewed-artifacts.py',
]
save(ROOT/'outputs/verification/artifact-authoring-freeze.json',{'generatedAt':now,'scope':'Authoring sources owned by competitive_control; parent completes overall source seal','sha256':{p:sha(ROOT/p) for p in owned}})
print(json.dumps(summary,ensure_ascii=False,indent=2))
