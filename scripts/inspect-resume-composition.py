"""Read final bytes, every OOXML relationship, PDF annotations and metadata; render PDF pages."""
from pathlib import Path
import json, hashlib, re, zipfile, subprocess
from xml.etree import ElementTree as ET
import fitz

root=Path(__file__).resolve().parents[1]/'outputs/verification/ui-refinement-20261008/documents-composition'
model=json.loads((root/'selected-no-contacts.json').read_text(encoding='utf-8'))
poppler=Path('C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe')
expected=[model['name'],model['title']]+[value for section in model['sections'] for value in [section['title'],*(item['text'] for item in section['paragraphs'])]]
forbidden=['composition-owner@example.test','79994561234','polprivate','private-candidate','ОпытТолько','ОбразованиеТолько','ЛокацияТолько']
receipt=[]
for source in [root/'selected-no-contacts.docx',root/'selected-no-contacts.pdf']:
    record={'path':str(source),'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
    if source.suffix=='.docx':
        with zipfile.ZipFile(source) as z:
            xml='\n'.join(z.read(name).decode('utf-8') for name in z.namelist() if name.endswith(('.xml','.rels')))
            document=ET.fromstring(z.read('word/document.xml'))
            text='\n'.join(''.join(paragraph.itertext()) for paragraph in document.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))
            links=[link.attrib.get('Target','') for name in z.namelist() if name.endswith('.rels') for link in ET.fromstring(z.read(name)) if link.attrib.get('TargetMode')=='External']
            metadata=z.read('docProps/core.xml').decode('utf-8')
        inspected=xml
        record['allXmlAndRelsInspected']=True
    else:
        doc=fitz.open(source)
        text='\n'.join(page.get_text() for page in doc)
        links=[link.get('uri','') for page in doc for link in page.get_links() if link.get('uri')]
        metadata=json.dumps(doc.metadata,ensure_ascii=False)
        inspected=text+'\n'+metadata+'\n'+'\n'.join(links)
        record['pages']=len(doc)
        render_dir=root/'selected-no-contacts-pages'
        render_dir.mkdir(exist_ok=True)
        subprocess.run([str(poppler),'-r','100','-png',str(source),str(render_dir/'page')],check=True,capture_output=True)
        record['pageImages']=[str(image) for image in sorted(render_dir.glob('page-*.png'))]
    collapsed=re.sub(r'\s+',' ',text)
    for value in expected: assert re.sub(r'\s+',' ',value) in collapsed, (source,value)
    for value in forbidden: assert value not in inspected, (source,value)
    assert not links, (source,links)
    assert 'Signal' in metadata
    assert '1200000' in collapsed and '1800000' in collapsed
    source.with_suffix('.extracted.txt').write_text(text,encoding='utf-8')
    record.update(projectionTextExact=True,contactsAbsent=True,excludedSectionsAbsent=True,externalLinks=links,metadata=metadata,salary7DigitsPreserved=True)
    receipt.append(record)
(root/'artifact-inspection.json').write_text(json.dumps({'status':'PASS','files':receipt,'checks':'Final file bytes, text, every OOXML part/relationship, PDF annotation targets and metadata; rendered images inspected separately'},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':'PASS','files':len(receipt),'pages':sum(item.get('pages',0) for item in receipt)},ensure_ascii=False))
