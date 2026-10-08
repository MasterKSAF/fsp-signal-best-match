from pathlib import Path
import hashlib, json

base=Path('C:/Users/Misha/Documents/ChatGPT/LCT/fsp-signal')
manifest={x['path']:x['sha256'] for x in json.loads((base/'outputs/verification/candidate-workspace-skill-matrix-20261008/source-fingerprints.json').read_text(encoding='utf-8-sig'))}
file='artifacts/fsp-signal/src/components/my-resumes.tsx'
data=(base/file).read_bytes().decode('utf-8')
data=data.replace("import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';\nimport { useGetCurrentUser } from '@workspace/api-client-react';\n", "import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';\r\n")
for inserted in ["import { SkillChips } from './skill-chip';", "import { InlineInfo } from './inline-info';", "import { DictionaryCombobox } from './dictionary-input';", "import { ROLE_OPTIONS } from '../lib/professional-dictionaries';", "import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';"]:
    assert inserted+'\n' in data
    data=data.replace(inserted+'\n','',1)
start=data.index('type DocumentModel = ')
end=data.index('const stamp=', start)
data=data[:start]+"type DocumentModel = {resumeId:number;revision:number;name:string;title:string;specialization:string;contactsAllowed:boolean;audience:string;sections:{title:string;paragraphs:{text:string;link?:string}[]}[]};\r\n"+data[end:]
start=data.index('export function ResumeDocumentPreview(')
end=data.index('export function ResumeDocumentButton(',start)
lines=[
("export function ResumeDocumentPreview({resumeId,onClose}:{resumeId:number;onClose:()=>void}) {",'\r\n'),
("  const [view,setView]=useState<'document'|'pdf'>('document');",'\r\n'),
("  const preview=useQuery({queryKey:['resume-document-preview',resumeId],queryFn:()=>resumeRequest<DocumentModel>(`/resumes/${resumeId}/document-preview`),staleTime:0,gcTime:0});",'\r\n'),
("  // This component is mounted by an explicit user action. Loading list/detail queries never produce a view event.",'\r\n'),
("  useEffect(()=>{void resumeRequest(`/resumes/${resumeId}/view`,{method:'POST'}).catch(()=>{});},[resumeId]);",'\r\n'),
('  return <Dialog title="Предпросмотр резюме" wide onClose={onClose}>','\n'),
('    <h3 className="resume-preview-heading">Предпросмотр резюме</h3>','\n'),
('    <div className="resume-preview-actions"><div className="resume-preview-tabs"><button className={`button ${view===\'document\'?\'secondary\':\'ghost\'}`} onClick={()=>setView(\'document\')}>Документ</button><button className={`button ${view===\'pdf\'?\'secondary\':\'ghost\'}`} onClick={()=>setView(\'pdf\')}>PDF</button></div>{!preview.isError&&preview.data&&<div className="resume-preview-downloads"><a className="button secondary" href={`/api/resumes/${resumeId}/document.docx`}><Download size={15}/> Word</a><a className="button secondary" href={`/api/resumes/${resumeId}/document.pdf`}><Download size={15}/> PDF</a></div>}</div>','\n'),
('    {preview.isPending&&<p role="status">Готовим документ…</p>}{preview.isError&&<p role="alert">{preview.error.message} <button className="button ghost" onClick={()=>preview.refetch()}>Повторить</button></p>}','\r\n'),
('    {!preview.isError&&preview.data&&<>{preview.data.audience===\'employer\'&&!preview.data.contactsAllowed&&<p className="resume-preview-permission">Контакты и личные ссылки закрыты. В файлах действуют те же разрешения.</p>}{view===\'pdf\'?<ResumePdfViewer key={resumeId} resumeId={resumeId} accessKey={`${preview.data.audience}:${preview.data.contactsAllowed}:${preview.data.revision}`} />:<article className="resume-document-paper"><h2>{preview.data.name}</h2><p className="resume-document-specialty">{preview.data.specialization}</p>{preview.data.sections.map((section,index)=><section key={`${index}-${section.title}`}><h3>{section.title}</h3>{section.paragraphs.map((item,line)=><p key={line}>{item.link?<a href={item.link} target="_blank" rel="noopener noreferrer">{item.text}</a>:item.text}</p>)}</section>)}</article>}</>}','\n'),
('  </Dialog>;','\r\n'),
('}','\r\n'),
]
data=data[:start]+''.join(line+ending for line,ending in lines)+data[end:]
updates={file:data.encode('utf-8')}
file='artifacts/fsp-signal/src/components/resume-pdf-viewer.tsx'
data=(base/file).read_bytes().decode('utf-8')
for before,after in [
("accessKey?: string; fields?:string };","accessKey?: string };"),
("async function readPdf(resumeId: number, signal: AbortSignal, fields?:string)","async function readPdf(resumeId: number, signal: AbortSignal)"),
("`/api/resumes/${resumeId}/preview.pdf${fields===undefined?'':`?fields=${encodeURIComponent(fields)}`}`","`/api/resumes/${resumeId}/preview.pdf`"),
("title = 'PDF резюме', accessKey, fields }","title = 'PDF резюме', accessKey }"),
("readPdf(resumeId, controller.signal, fields)","readPdf(resumeId, controller.signal)"),
("[resumeId, revision, accessKey, fields]","[resumeId, revision, accessKey]"),
]:
    assert before in data, before
    data=data.replace(before,after,1)
updates[file]=data.encode('utf-8')
for file,bytes_ in updates.items():
    actual=hashlib.sha256(bytes_).hexdigest()
    assert actual==manifest[file], f'{file}: reconstructed hash {actual}, expected {manifest[file]}; NO WRITES'
for file,bytes_ in updates.items():
    (base/file).write_bytes(bytes_)
    print(json.dumps({'file':file,'sha256':hashlib.sha256(bytes_).hexdigest(),'matches_accepted':True}))
