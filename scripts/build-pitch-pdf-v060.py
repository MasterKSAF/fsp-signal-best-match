"""PDF visual companion from exact saved 0.6.0 PPTX renders; no image drawing."""
from pathlib import Path
import json
import sys
from reportlab.pdfgen import canvas
from pypdf import PdfReader

directory = Path(sys.argv[1]).resolve()
count = int(sys.argv[2])
assert count == 10
pages = [directory / f'final-slide-{number}.png' for number in range(1, count + 1)]
assert all(page.is_file() for page in pages)
destination = directory / 'Signal-Pitch.pdf'
assert not destination.exists(), 'Use a new build directory, never overwrite reviewed media'
pdf = canvas.Canvas(str(destination), pagesize=(960, 540), pageCompression=1)
pdf.setTitle('Signal 0.6.0. Best Match. Специальный трек ФСП')
pdf.setAuthor('Best Match')
pdf.setSubject('Visual companion of exact saved PPTX slides. Editable source is PPTX.')
for page in pages:
    pdf.drawImage(str(page), 0, 0, width=960, height=540)
    pdf.showPage()
pdf.save()
document = PdfReader(destination)
assert len(document.pages) == count
assert all(tuple(map(float, page.mediabox[2:])) == (960.0, 540.0) for page in document.pages)
print(json.dumps({'pdf': str(destination), 'pages': count, 'visualCompanion': True, 'editablePptxSeparate': True}))
