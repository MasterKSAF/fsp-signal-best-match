"""Inspect the actual API files (not regenerated models): text, metadata, links, all OOXML; render every PDF."""
from pathlib import Path
import hashlib,json,re,subprocess,zipfile
from xml.etree import ElementTree as ET
import fitz

root=Path(__file__).resolve().parents[1]/'outputs/verification/ui-refinement-20261008/documents-http'
receipt=json.loads((root/'http.json').read_text(encoding='utf-8'))
assert receipt['status']=='PASS'
poppler=Path('C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe')
private=[receipt['observations']['ownerEmail'],'79991112233','999 444 55 66','privateorlov','export-private.example.test']
selected=json.loads((root/'selected-model.json').read_text(encoding='utf-8'))
expected_selected=[selected['name'],selected['title']]+[value for section in selected['sections'] for value in [section['title'],*(item['text'] for item in section['paragraphs'])]]
entries=[]
for source in sorted([*root.glob('*.docx'),*root.glob('*.pdf')]):
    entry={'path':str(source),'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
    if source.suffix=='.docx':
        with zipfile.ZipFile(source) as z:
            xml='\n'.join(z.read(name).decode('utf-8') for name in z.namelist() if name.endswith(('.xml','.rels')))
            document=ET.fromstring(z.read('word/document.xml'))
            text='\n'.join(''.join(paragraph.itertext()) for paragraph in document.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))
            links=[link.attrib.get('Target','') for name in z.namelist() if name.endswith('.rels') for link in ET.fromstring(z.read(name)) if link.attrib.get('TargetMode')=='External']
            metadata=z.read('docProps/core.xml').decode('utf-8')
        inspected=xml;entry['allXmlAndRelsInspected']=True
    else:
        pdf=fitz.open(source)
        text='\n'.join(page.get_text() for page in pdf)
        links=[link.get('uri','') for page in pdf for link in page.get_links() if link.get('uri')]
        metadata=json.dumps(pdf.metadata,ensure_ascii=False)
        inspected=text+'\n'+metadata+'\n'+'\n'.join(links);entry['pages']=len(pdf)
        images=root/(source.stem+'-pages');images.mkdir(exist_ok=True)
        subprocess.run([str(poppler),'-r','85','-png',str(source),str(images/'page')],check=True,capture_output=True)
        entry['pageImages']=[str(page) for page in sorted(images.glob('page-*.png'))]
    collapsed=re.sub(r'\s+',' ',text)
    for value in private: assert value not in inspected,(source,value)
    assert len(links)==0,(source,links)
    assert 'Signal' in metadata
    assert 'от 1200000 до 1800000' in collapsed,(source,collapsed)
    assert 'Авторская должность инженера' in collapsed
    assert 'Грейд не подтверждён' in collapsed
    if source.name.startswith('restricted'):
        for value in ['Орлов','Кирилл','Сергеевич']: assert value not in inspected,(source,value)
        assert 'Инженер сервисов' in collapsed
    else: assert 'Кирилл Сергеевич Орлов' in collapsed
    if source.name.startswith('restricted-selected'):
        for value in ['ОпытТолько','ОбразованиеТолько','ЛокацияТолько']: assert value not in inspected,(source,value)
        for value in expected_selected: assert re.sub(r'\s+',' ',value) in collapsed,(source,value)
    elif source.name.startswith(('owner-no-contacts','granted-a-selected')):
        for value in ['ОпытТолько','ОбразованиеТолько','ЛокацияТолько']: assert value in collapsed,(source,value)
    source.with_suffix('.extracted.txt').write_text(text,encoding='utf-8')
    entry.update(contactPolicyCorrect=True,projectionCorrect=True,sevenDigitSalaryPreserved=True,externalLinks=links,metadataAuthorSignal=True)
    entries.append(entry)
(root/'artifact-inspection.json').write_text(json.dumps({'status':'PASS','files':entries,'limits':['DOCX inspected structurally including text, every XML part and relationship. Native Word/LibreOffice rendering not available; PDF images are inspected separately.']},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':'PASS','files':len(entries),'pdfPages':sum(entry.get('pages',0) for entry in entries)},ensure_ascii=False))
