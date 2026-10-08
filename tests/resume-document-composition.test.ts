import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {guardResumeDocumentProjection,parseResumeDocumentFields,projectResumeDocument,resumeDocumentFields,renderResumeDocx,renderResumePdf,type ResumeDocumentField} from '../artifacts/api-server/src/lib/resume-document';
import {emptyResume} from '../artifacts/api-server/src/lib/signal-resume-contract';
import {qualificationGradeLabel,qualificationSourceLabel} from '../artifacts/fsp-signal/src/lib/qualification-presentation';

const profile={displayName:'Ирина Сергеевна Полякова',professionalAlias:'Инженер интерфейсов',contactEmail:'composition-owner@example.test',phone:'+79994561234',title:'Авторская должность',specialization:'Frontend / TypeScript',assumedGrade:'Senior',verifiedGrade:'Middle',verifiedSkills:[],stack:['TypeScript','SQL','PostgreSQL'],skills:['ts','Python','FastAPI'],yearsExperience:6,workFormat:'Удалённо',salaryMin:1200000,salaryMax:1800000,salaryPeriod:'year',salaryType:'gross'};
const content={...emptyResume('Frontend / TypeScript'),summary:'Профиль composition-owner@example.test, +79994561234, @polprivate https://t.me/polprivate',softSkills:['Командная работа'],experience:[{company:'ОпытТолько',role:'Автор',start:'2020-01',end:null,description:'Поставлял программные продукты.'}],projects:[{title:'ПроектТолько',role:'Автор',description:'Быстрые интерфейсы composition-owner@example.test',url:'https://example.test/private-candidate'}],education:[{institution:'ОбразованиеТолько',qualification:'Информатика',start:'2014',end:'2018'}],portfolio:[{title:'Работы',url:'https://example.test/private-candidate'}]};
const preferences={location:'ЛокацияТолько',schedule:'Гибкий',employment:'Проект',relocation:true,startAvailability:'Через неделю'};
const qualification={verifiedGrade:'Middle',source:'assessment',category:null,skills:[{label:'TypeScript',level:'Junior',programVersion:'ts-junior-v1',verifiedAt:'2026-10-08T10:00:00Z'}],historical:{date:'2026-10-06T13:00:00Z',programVersion:'frontend-complex-v1'}};
const input={resumeId:73,revision:9,profile,content,preferences,qualification,audience:'owner' as const,contactsAllowed:true,publicIdentity:true};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('file field parser is a strict canonical whitelist; omitted and empty mean different compositions',()=>{
  assert.deepEqual(parseResumeDocumentFields(undefined),resumeDocumentFields);
  assert.deepEqual(parseResumeDocumentFields(''),[]);
  assert.deepEqual(parseResumeDocumentFields('salary,contacts,salary'),['contacts','salary']);
  for(const value of ['contactEmail','contacts,admin','contacts,','*', ['contacts'], {contacts:true},null,1])assert.throws(()=>parseResumeDocumentFields(value));
});

test('all 1024 field combinations are projections, preserve the CV exactly, and never grant employer contacts',()=>{
  const before=hash(input);
  for(let mask=0;mask<2**resumeDocumentFields.length;mask++){
    const fields=resumeDocumentFields.filter((_,index)=>(mask&(1<<index))!==0);
    const owner=projectResumeDocument({...input,fields});
    const restricted=projectResumeDocument({...input,audience:'employer',contactsAllowed:false,publicIdentity:false,fields});
    assert.equal(owner.contactsAllowed,fields.includes('contacts'));
    assert.equal(restricted.contactsAllowed,false);
    assert.ok(!restricted.composition.includes('contacts'));assert.ok(!restricted.composition.includes('portfolio'));
    for(const secret of [profile.contactEmail,profile.phone,'polprivate','https://example.test/private-candidate','Полякова','Ирина','Сергеевна'])assert.ok(!JSON.stringify(restricted).includes(secret),`mask ${mask}: ${secret}`);
    const titles=owner.sections.map(section=>section.title);
    for(const [field,title] of [['salary','Зарплатные ожидания'],['conditions','Условия работы'],['summary','О себе'],['skills','Навыки'],['experience','Опыт работы'],['projects','Проект'],['education','Образование'],['softSkills','Личные навыки']] as [ResumeDocumentField,string][])assert.equal(titles.includes(title),fields.includes(field),`${mask}: ${field}`);
    assert.ok(JSON.stringify(owner).includes('Грейд: Middle · по экзамену'));assert.equal(owner.title,'Авторская должность');
  }
  assert.equal(hash(input),before);
});

test('owner and granted employer can opt out of contacts everywhere without losing salary, identity, or historical grade',()=>{
  for(const audience of ['owner','employer'] as const){
    const model=projectResumeDocument({...input,audience,fields:resumeDocumentFields.filter(field=>field!=='contacts')});
    const json=JSON.stringify(model);assert.equal(model.name,profile.displayName);assert.equal(model.contactsPermitted,true);assert.equal(model.contactsAllowed,false);
    for(const secret of [profile.contactEmail,profile.phone,'polprivate','https://example.test/private-candidate'])assert.ok(!json.includes(secret));
    assert.ok(json.includes('от 1200000 до 1800000 ₽ / год'));assert.ok(json.includes('Грейд: Middle · по экзамену'));assert.ok(json.includes('06.10.2026'));
  }
});

test('one exact skills list deduplicates aliases, preserves actual Junior, and does not verify adjacent PostgreSQL/FastAPI',()=>{
  const model=projectResumeDocument(input);const skills=model.sections.find(section=>section.title==='Навыки')!;
  assert.equal(skills.paragraphs.filter(item=>item.text.startsWith('TypeScript - Junior')).length,1);
  assert.equal(skills.paragraphs.filter(item=>item.text.startsWith('ts ')).length,0);
  for(const label of ['SQL','PostgreSQL','Python','FastAPI'])assert.equal(skills.paragraphs.filter(item=>item.text===`${label} · заявлен`).length,1);
  assert.ok(!JSON.stringify(model).includes('Заявленный стек'));assert.ok(!JSON.stringify(model).includes('Заявленные навыки'));
});

test('grade presentation keeps valid complex Middle separate from zero individual proofs and never invents a numeric grade',()=>{
  const historical={...qualification,skills:[]};const before=hash(historical);
  const document=projectResumeDocument({...input,qualification:historical});
  assert.equal(qualificationGradeLabel(historical),'Грейд: Middle · по экзамену');assert.equal(qualificationSourceLabel(historical),'По экзамену');
  assert.equal(qualificationGradeLabel({...historical,verifiedGrade:null}),'Грейд не подтверждён');
  assert.equal(qualificationGradeLabel({...historical,source:'legacy'}),'Грейд: Middle · по сохранённому результату');
  assert.ok(JSON.stringify(document).includes('Грейд: Middle · по экзамену'));assert.equal(historical.skills.length,0);assert.equal(hash(historical),before);
});

test('saved PDF/DOCX use the selected projection, fixed metadata, and no contact or hyperlink residue',async()=>{
  const fields=['salary','skills','projects'] as ResumeDocumentField[];
  const document=projectResumeDocument({...input,fields});
  const [docx,pdf]=await Promise.all([renderResumeDocx(document),renderResumePdf(document)]);
  const req=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));const inner=createRequire(req.resolve('docx'));const zip=await inner('jszip').loadAsync(docx);
  const xml=(await Promise.all(Object.values(zip.files).filter((file:any)=>file.name.endsWith('.xml')||file.name.endsWith('.rels')).map((file:any)=>file.async('string')))).join('\n');
  for(const secret of [profile.contactEmail,profile.phone,'polprivate','private-candidate','ОпытТолько','ОбразованиеТолько','ЛокацияТолько'])assert.ok(!xml.includes(secret),secret);
  assert.ok(xml.includes('от 1200000 до 1800000'));assert.ok(xml.includes('Грейд: Middle'));assert.ok(xml.includes('Авторская должность'));assert.ok(!xml.includes('Target="https://'));
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const directory=path.resolve(process.env.SIGNAL_COMPOSITION_PROOFS??'outputs/verification/ui-refinement-20261008/documents-composition');await mkdir(directory,{recursive:true});
  await Promise.all([writeFile(path.join(directory,'selected-no-contacts.docx'),docx),writeFile(path.join(directory,'selected-no-contacts.pdf'),pdf),writeFile(path.join(directory,'selected-no-contacts.json'),JSON.stringify(document,null,2))]);
});

test('access revocation or source changes during real asynchronous DOCX rendering discard all completed bytes',async()=>{
  const initial={resumeId:73,revision:9,contactsPermitted:true,publicIdentity:false,identityRevision:'original-identity',projectionVersion:projectResumeDocument(input).projectionVersion};
  for(const change of [null,{...initial,contactsPermitted:false},{...initial,publicIdentity:true},{...initial,revision:10},{...initial,identityRevision:'renamed'},{...initial,resumeId:74}]){
    let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});let rendered:Buffer|null=null;let current:typeof initial|null=initial;const order:string[]=[];
    const pending=guardResumeDocumentProjection(initial,async()=>{order.push('render-start');const bytes=await renderResumeDocx(projectResumeDocument(input));await barrier;rendered=bytes;order.push('render-end');return bytes;},async()=>{order.push('reauthorize');return current;});
    current=change;release();const result=await pending;
    assert.deepEqual(order,['render-start','render-end','reauthorize']);assert.ok(rendered);assert.equal(result.output,null);assert.equal(result.status,change===null?'unavailable':'changed');
  }
  const unchanged=await guardResumeDocumentProjection(initial,()=>renderResumePdf(projectResumeDocument(input)),async()=>({...initial}));assert.equal(unchanged.status,'allowed');assert.equal(unchanged.output?.subarray(0,5).toString(),'%PDF-');
});
