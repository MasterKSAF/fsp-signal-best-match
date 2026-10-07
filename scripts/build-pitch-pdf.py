"""Visual PDF companion from exact final PPTX renders; editable text stays in PPTX."""
from pathlib import Path
import sys
from reportlab.pdfgen import canvas
from pypdf import PdfReader

directory = Path(sys.argv[1]).resolve()
pages = [directory / f"final-slide-{number}.png" for number in range(1, 9)]
assert all(page.is_file() for page in pages)
destination = directory / "Signal-Pitch.pdf"
pdf = canvas.Canvas(str(destination), pagesize=(960, 540), pageCompression=1)
pdf.setTitle("Signal — Best Match — специальный трек ФСП")
pdf.setAuthor("Best Match")
pdf.setSubject("Визуальная копия презентации. Редактируемый оригинал: Signal-Pitch.pptx")
for page in pages:
    pdf.drawImage(str(page), 0, 0, width=960, height=540)
    pdf.showPage()
pdf.save()
document = PdfReader(destination)
assert len(document.pages) == 8
assert all(tuple(map(float, page.mediabox[2:])) == (960.0, 540.0) for page in document.pages)
print(f"PDF visual companion: {destination}")
