import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { projectResumeDocument, renderResumeDocx, renderResumePdf, restrictedDocumentText } from '../artifacts/api-server/src/lib/resume-document';
import { emptyResume } from '../artifacts/api-server/src/lib/signal-resume-contract';

const profile={displayName:'Андрей Викторович Лебедев',professionalAlias:'Python Engineer',contactEmail:'private@example.test',phone:'+7 (999) 123-45-67',title:'Backend-разработчик',specialization:'Backend / Python',assumedGrade:'Middle',verifiedGrade:null,verifiedSkills:[],stack:['Python','SQL'],skills:[],yearsExperience:5,workFormat:'Удалённо',salaryMin:180000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross'};
const qualification={verifiedGrade:null,skills:[{label:'Python',level:'Junior',programVersion:'python-junior-v1',verifiedAt:'2026-10-08T10:00:00Z'}],category:null,source:'skill_matrix'};
const preferences={location:'Казань',schedule:'Полный день',employment:'Постоянная работа',relocation:false,startAvailability:'Через две недели'};
const content={...emptyResume(),summary:'Андрей Викторович Лебедев. Пишу сервисы. private@example.test, +7 (999) 123-45-67, @privatehandle https://t.me/privatehandle',experience:[{company:'Технологическая компания',role:'Инженер',start:'2021-02',end:'2025-11',description:'Надёжные системы. Альтернативный телефон: +7 999 876 54 32, alt [at] example.test'}],projects:[{title:'Распределённая очередь',role:'Разработчик',description:'Надёжная обработка сообщений.',url:'https://example.test/private-profile'}],education:[{institution:'Казанский университет',qualification:'Информатика',start:'2015-09',end:'2019-06'}],portfolio:[{title:'Портфолио',url:'https://example.test/private-profile'}]};
const model=(contactsAllowed=false)=>projectResumeDocument({resumeId:42,revision:3,profile,content,audience:'employer',contactsAllowed,publicIdentity:false,qualification,preferences});

test('employer without consent has no known identity, contact, alternate phone, handle or hyperlinks anywhere',()=>{
  const document=model();const encoded=JSON.stringify(document);
  for(const sensitive of ['Лебедев','Андрей','Викторович','private@example.test','999','privatehandle','https://','alt [at]'])assert.ok(!encoded.includes(sensitive),sensitive);
  assert.equal(document.name,'Python Engineer');assert.equal(document.contactsAllowed,false);
  assert.ok(encoded.includes('2021-02 - 2025-11'));assert.ok(encoded.includes('Казанский университет'));assert.ok(encoded.includes('08.10.2026'));
});
test('grant is explicit projection input, owner and permitted employer receive original content',()=>{
  const granted=model(true);assert.equal(granted.name,profile.displayName);assert.ok(JSON.stringify(granted).includes(profile.contactEmail));assert.ok(granted.sections.some(s=>s.title==='Портфолио'));
  const owner=projectResumeDocument({resumeId:42,revision:3,profile,content,audience:'owner',contactsAllowed:false,publicIdentity:false,qualification,preferences});assert.equal(owner.contactsAllowed,true);assert.equal(owner.name,profile.displayName);
});
test('individual Python Junior evidence cannot become total Middle or fabricate React evidence',()=>{
  const encoded=JSON.stringify(model());assert.ok(encoded.includes('Python - Junior'));assert.ok(encoded.includes('Заявленный грейд: Middle'));assert.ok(!encoded.includes('Подтверждённый грейд: Middle'));assert.ok(!encoded.includes('React'));
});
test('normalization removes zero width contacts and unicode compatibility characters',()=>{
  assert.ok(!restrictedDocumentText('private@\u200bexample.test +７ ９９９ １２３ ４５ ６７',profile,true).includes('example.test'));
});
test('restricted document keeps validated historical year-only education dates without mistaking the range for a phone',()=>{
  const years={...content,education:[{...content.education[0],start:'2018',end:'2022'}]};
  const document=projectResumeDocument({resumeId:42,revision:3,profile,content:years,audience:'employer',contactsAllowed:false,publicIdentity:false,qualification,preferences});assert.ok(JSON.stringify(document).includes('2018 - 2022'));
});

test('every projected text field, including top-level identity and specialization, applies the same contact policy',()=>{
  const sentinel='private@example.test +7 (999) 123-45-67 https://secret.example.test/contact @privatehandle Андрей Викторович Лебедев';
  const paths=[['profile','title'],['profile','specialization'],['profile','professionalAlias'],['profile','displayName'],['profile','assumedGrade'],['profile','verifiedGrade'],['profile','workFormat'],['profile','stack',0],['profile','skills',0],['content','summary'],['content','softSkills',0],['content','experience',0,'company'],['content','experience',0,'role'],['content','experience',0,'description'],['content','experience',0,'start'],['content','experience',0,'end'],['content','projects',0,'title'],['content','projects',0,'role'],['content','projects',0,'description'],['content','projects',0,'url'],['content','education',0,'institution'],['content','education',0,'qualification'],['content','education',0,'start'],['content','education',0,'end'],['content','portfolio',0,'title'],['content','portfolio',0,'url'],['qualification','verifiedGrade'],['qualification','skills',0,'label'],['qualification','skills',0,'level'],['qualification','skills',0,'programVersion'],['qualification','limitation'],['qualification','category','matrixVersion'],['preferences','location'],['preferences','schedule'],['preferences','employment'],['preferences','startAvailability']];
  for(const field of paths){
    const input:any=structuredClone({resumeId:42,revision:3,profile,content,qualification:{...qualification,category:{matrixVersion:'test'}},preferences,audience:'employer',contactsAllowed:false,publicIdentity:false});
    let target=input;for(const key of field.slice(0,-1))target=target[key];target[field.at(-1)!]=sentinel;
    const encoded=JSON.stringify(projectResumeDocument(input));
    for(const secret of ['private@example.test','999','secret.example.test','privatehandle','Лебедев','Андрей','Викторович'])assert.ok(!encoded.includes(secret),`${field.join('.')}: ${secret}`);
  }
});

test('validated monthly and annual salaries bypass phone masking while actual prose phones stay hidden',()=>{
  for(const [min,max,period]of[[180000,220000,'month'],[1200000,1800000,'year'],[1000000,1200000,'month'],[999999,1000000,'year']]as const){
    const document=projectResumeDocument({resumeId:42,revision:3,profile:{...profile,salaryMin:min,salaryMax:max,salaryPeriod:period},content,audience:'employer',contactsAllowed:false,publicIdentity:false,qualification,preferences});
    const encoded=JSON.stringify(document);assert.ok(encoded.includes(`от ${min} до ${max} ₽ / ${period==='year'?'год':'месяц'}`));assert.ok(!encoded.includes('999 876 54 32'));assert.ok(encoded.includes('[телефон скрыт]'));
  }
  const malformed=projectResumeDocument({resumeId:42,revision:3,profile:{...profile,salaryMin:'private@example.test' as unknown as number},content,audience:'employer',contactsAllowed:false,publicIdentity:false,qualification,preferences});assert.ok(!JSON.stringify(malformed).includes('private@example.test'));
});

test('owner and exact contact recipient retain specialization text; links only accept HTTP(S) without credentials',()=>{
  const specialization='Backend / Python private@example.test';
  for(const audience of ['owner','employer']as const){
    const document=projectResumeDocument({resumeId:42,revision:3,profile:{...profile,specialization},content:{...content,projects:[{...content.projects[0],url:'javascript:alert(1)'}],portfolio:[{title:'Unsafe',url:'https://user:password@example.test/secret'},{title:'Safe',url:'https://example.test/allowed'}]},audience,contactsAllowed:audience==='employer',publicIdentity:false,qualification,preferences});
    assert.equal(document.specialization,specialization);assert.equal(document.name,profile.displayName);
    const links=document.sections.flatMap(section=>section.paragraphs.flatMap(paragraph=>paragraph.link?[paragraph.link]:[]));assert.deepEqual(links,['https://example.test/allowed']);
  }
});

test('restricted DOCX/PDF regression preserves annual sums and masks contact specialization including all metadata',async()=>{
  const document=projectResumeDocument({resumeId:42,revision:3,profile:{...profile,specialization:'Backend / Python private@example.test',salaryMin:1200000,salaryMax:1800000,salaryPeriod:'year'},content,audience:'employer',contactsAllowed:false,publicIdentity:false,qualification,preferences});
  const [docx,pdf]=await Promise.all([renderResumeDocx(document),renderResumePdf(document)]);
  const req=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));const inner=createRequire(req.resolve('docx'));const zip=await inner('jszip').loadAsync(docx);
  const xml=(await Promise.all(Object.values(zip.files).filter((f:any)=>f.name.endsWith('.xml')||f.name.endsWith('.rels')).map((f:any)=>f.async('string')))).join('\n');
  assert.ok(!xml.includes('private@example.test'));assert.ok(!xml.includes('Лебедев'));assert.ok(xml.includes('от 1200000 до 1800000'));assert.ok(xml.includes('<dc:creator>Signal</dc:creator>'));assert.ok(!xml.includes('Target="https://'));
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  if(process.env.SIGNAL_DOCUMENT_CORRECTION_PROOFS){const dir=path.resolve(process.env.SIGNAL_DOCUMENT_CORRECTION_PROOFS);await mkdir(dir,{recursive:true});await Promise.all([writeFile(path.join(dir,'correction-restricted.docx'),docx),writeFile(path.join(dir,'correction-restricted.pdf'),pdf),writeFile(path.join(dir,'correction-restricted.json'),JSON.stringify(document,null,2))]);}
});
test('real DOCX OOXML has Cyrillic, exact safe projection, no hidden owner data or hyperlink relationships',async()=>{
  const bytes=await renderResumeDocx(model());assert.equal(bytes.subarray(0,2).toString(),'PK');
  const req=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));const inner=createRequire(req.resolve('docx'));const JSZip=inner('jszip');const zip=await JSZip.loadAsync(bytes);
  const parts=await Promise.all(Object.values(zip.files).filter((f:any)=>f.name.endsWith('.xml')||f.name.endsWith('.rels')).map((f:any)=>f.async('string')));
  const xml=parts.join('\n');assert.ok(xml.includes('Казанский университет'));assert.ok(xml.includes('Python - Junior'));assert.ok(!xml.includes('private@example.test'));assert.ok(!xml.includes('Лебедев'));assert.ok(!xml.includes('Target="https://'));assert.ok(xml.includes('<dc:creator>Signal</dc:creator>'));
});
test('PDF is real with multiple pages and portable Cyrillic font; write bounded acceptance specimens',async()=>{
  const long={...content,summary:('Проектировал сервисы обработки событий, проверял целостность данных и наблюдаемость.\n').repeat(22),experience:Array.from({length:6},(_,i)=>({...content.experience[0],company:`Компания ${i+1}`,description:('Обеспечивал безопасные контракты и понятные метрики. ').repeat(12)}))};
  const document=projectResumeDocument({resumeId:42,revision:3,profile,content:long,audience:'owner',contactsAllowed:true,publicIdentity:true,qualification,preferences});
  const [pdf,docx,safePdf,safeDocx]=await Promise.all([renderResumePdf(document),renderResumeDocx(document),renderResumePdf(model()),renderResumeDocx(model())]);
  assert.ok(pdf.subarray(0,5).equals(Buffer.from('%PDF-')));assert.ok(pdf.toString('latin1').includes('/FontFile2'));assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g)??[]).length>=3);
  if(process.env.SIGNAL_DOCUMENT_PROOFS){const directory=path.resolve(process.env.SIGNAL_DOCUMENT_PROOFS);await mkdir(directory,{recursive:true});await Promise.all([writeFile(path.join(directory,'long-owner.pdf'),pdf),writeFile(path.join(directory,'long-owner.docx'),docx),writeFile(path.join(directory,'restricted-employer.pdf'),safePdf),writeFile(path.join(directory,'restricted-employer.docx'),safeDocx),writeFile(path.join(directory,'restricted-preview.json'),JSON.stringify(model(),null,2))]);}
});
