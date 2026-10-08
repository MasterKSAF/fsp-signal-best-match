import assert from 'node:assert/strict';
import test from 'node:test';
import { projectResumeDocument, type DocumentQualification } from '../artifacts/api-server/src/lib/resume-document';
import { emptyResume } from '../artifacts/api-server/src/lib/signal-resume-contract';

const profile = { displayName:'Закрытое Имя',professionalAlias:'Allowed Alias',contactEmail:'private@example.test',phone:'+7 (999) 123-45-67',title:'Backend-разработчик',specialization:'Backend / Python',assumedGrade:'Middle',verifiedGrade:'Middle',verifiedSkills:['Python','SQL'],stack:['Python','SQL'],skills:['React'],yearsExperience:4,workFormat:'Удалённо',salaryMin:100000,salaryMax:160000,salaryPeriod:'month',salaryType:'gross' };
const preferences = {location:'Москва',schedule:'Полный день',employment:'Работа',relocation:false,startAvailability:''};
const proof = (label:string,level:string) => ({label,level,programVersion:'synthetic-program-v1',verifiedAt:'2026-10-08T12:00:00Z'});
const project = (qualification:DocumentQualification, options:Partial<Parameters<typeof projectResumeDocument>[0]>={}) => projectResumeDocument({resumeId:49,revision:2,profile,content:emptyResume(),audience:'employer',contactsAllowed:false,publicIdentity:false,qualification,preferences,...options});

test('document skill chips require individual current levels, never an aggregate legacy grade',()=>{
  const document=project({verifiedGrade:'Middle',skills:[],category:null,source:'legacy'});
  assert.deepEqual(document.skillChips,[{label:'Python',status:'declared'},{label:'SQL',status:'declared'},{label:'React',status:'declared'}]);
});
test('document chips deduplicate aliases, select actual strongest level and preserve declared technologies',()=>{
  const document=project({verifiedGrade:null,skills:[proof('py','Junior'),proof('Python','Middle')],category:null,source:'skill_matrix'});
  assert.deepEqual(document.skillChips,[{label:'Python',status:'verified',level:'Middle'},{label:'SQL',status:'declared'},{label:'React',status:'declared'}]);
  assert.equal(document.resumeId,49);
  assert.equal(document.revision,2);
});
test('invalid levels and ordinary object property names never become confirmation',()=>{
  for(const level of ['SuperSenior','constructor','__proto__']){
    const document=project({verifiedGrade:null,skills:[proof('Python',level)],category:null,source:'skill_matrix'});
    assert.equal(document.skillChips?.find(item=>item.label==='Python')?.status,'declared');
    assert.equal(document.skillChips?.find(item=>item.label==='Python')?.level,undefined);
  }
});
test('document chip labels use the same identity and contact redaction as document paragraphs',()=>{
  const document=project({verifiedGrade:null,skills:[],category:null,source:'legacy'},{profile:{...profile,stack:['private@example.test','Закрытое Имя','+7 (999) 123-45-67'],skills:[]}});
  const encoded=JSON.stringify(document.skillChips);
  for(const secret of ['private@example.test','Закрытое','Имя','999'])assert.equal(encoded.includes(secret),false,secret);
});
test('skill chip projection hash is stable and excluded skills neither leak nor change a narrowed document',()=>{
  const junior={verifiedGrade:null,skills:[proof('Python','Junior')],category:null,source:'skill_matrix'};
  const middle={...junior,skills:[proof('Python','Middle')]};
  assert.equal(project(junior).projectionVersion,project(junior).projectionVersion);
  assert.notEqual(project(junior).projectionVersion,project(middle).projectionVersion);
  const first=project(junior,{fields:['summary']}),second=project(middle,{fields:['summary']});
  assert.equal(first.skillChips,undefined);
  assert.equal(second.skillChips,undefined);
  assert.equal(first.projectionVersion,second.projectionVersion);
});
