// Business scenario authoring only: no imports of matcher, scorer or catalog ordering.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = 'docs/validation/modular-matching-a10-20261008';
await mkdir(dir,{recursive:true});
const specs=[{id:100,name:'Backend / Python',core:['Python','SQL','Backend Engineering'],ids:['python','sql','backend-engineering']},{id:200,name:'Frontend / TypeScript',core:['TypeScript','React','Frontend Engineering'],ids:['typescript','react','frontend-engineering']}];
const resumes=[], needs=[], labels=[];
for (const spec of specs) {
  for (let i=1;i<=12;i++) {
    const id=spec.id+i;
    const grade=i===2?'Junior':i===3?'Senior':i===5?null:'Middle';
    const row={personId:id,resumeId:id*10,specialization:spec.name,title:spec.name,
      grade,proof:i===4?'legacy':i===5?'partial-modular':'modular',core:[...spec.core],coreIds:[...spec.ids],
      levels:Object.fromEntries(spec.ids.map(s=>[s,i===5?'Senior':grade])),format:i===6?'Офис':'Удалённо',
      salaryMin:i===7?400000:120000,salaryMax:i===7?500000:180000,period:'month',tax:i===8?'net':'gross',
      visibility:i===9?'private':'pseudonymous',matching:i!==10,catalog:true,demo:i===11,
      fsp:i===3?'trusted-synthetic-win':i===7?'unverified-id':i===8?'legacy-boolean':'none',
      claimedSkills:i===5?spec.core:['Docker'],yearsExperience:i===5?10:3};
    if(i===5){row.core=[spec.core[0]];row.coreIds=[spec.ids[0]];row.levels={[spec.ids[0]]:'Senior'};}
    resumes.push(row);
    if (i===1 || i===2) resumes.push({...row,resumeId:id*10+1,specialization:spec.id===100?specs[1].name:specs[0].name,title:'Другой профиль того же человека',grade:null,proof:'partial-modular',core:[],coreIds:[],levels:{}});
    if(i===12) {
      row.proof='legacy'; row.core=[spec.core[0]];row.coreIds=[spec.ids[0]];row.levels={};
      resumes.push({...row,resumeId:id*10+1,proof:'legacy',core:[spec.core[1]],coreIds:[spec.ids[1]]});
      resumes.push({...row,resumeId:id*10+2,proof:'modular',core:[...spec.core],coreIds:[...spec.ids],levels:Object.fromEntries(spec.ids.map(s=>[s,'Middle']))});
    }
  }
  const cases=[
    {suffix:'junior-one',grade:'Junior',required:[spec.core[0]],levels:{},desired:[],eligible:[1,2,3,4,6,7,8,12],top:[1,2,3,4,12],secondary:[6,8]},
    {suffix:'middle-core',grade:'Middle',required:spec.core,levels:{},desired:[],eligible:[1,3,4,6,7,8,12],top:[1,3,4,12],secondary:[6,8]},
    {suffix:'middle-per-skill',grade:'Middle',required:[spec.core[0]],levels:{[spec.ids[0]]:'Middle'},desired:[],eligible:[1,3,6,7,8,12],top:[1,3,12],secondary:[6,8]},
    {suffix:'senior-core',grade:'Senior',required:spec.core,levels:{},desired:[],eligible:[3],top:[3],secondary:[]},
    {suffix:'tax-unknown-optional',grade:'Middle',required:[spec.core[0]],levels:{},desired:[spec.core[1],'Docker'],eligible:[1,3,4,6,7,8,12],top:[8],secondary:[1,3,4,12],tax:'net',period:'year',salaryMin:1440000,salaryMax:2160000},
    {suffix:'senior-skill-gate',grade:'Middle',required:[spec.core[1]],levels:{[spec.ids[1]]:'Senior'},desired:[],eligible:[3],top:[3],secondary:[]},
  ];
  for(const c of cases) {
    const needId=`${spec.id}-${c.suffix}`;
    needs.push({needId,specialization:spec.name,grade:c.grade,requiredSkills:c.required,requiredSkillLevels:c.levels,desirableSkills:c.desired,
      workFormat:'Удалённо',salaryMin:c.salaryMin??100000,salaryMax:c.salaryMax??200000,salaryPeriod:c.period??'month',salaryType:c.tax??'gross',poolDemoMode:false,
      businessTask:'Ищем специалиста подтверждённой категории с нужными навыками и совместимыми условиями. Самозаявление не заменяет проверку; разные резюме не объединяются.'});
    labels.push({needId,pointwise:Array.from({length:12},(_,ix)=>{
      const i=ix+1,personId=spec.id+i;
      return {personId,eligible:c.eligible.includes(i),relevance:c.top.includes(i)?3:c.secondary.includes(i)?2:c.eligible.includes(i)?1:0,
        allowedSelectedResumeIds:c.eligible.includes(i)?[personId*10+(i===12?2:0)]:[],
        rationale:!c.eligible.includes(i)?({5:'Есть отдельный навык, нет категории',9:'Приватное резюме',10:'Нет согласия на подбор',11:'Другой Demo-пул'}[i]??'Недостаточная категория или нет отдельного подтверждения минимального уровня'):
          c.top.includes(i)?'Подтверждённая категория, нужные навыки и согласуемые условия':c.secondary.includes(i)?'Навыки подходят, формат или налоговая база требуют согласования':'Существенное несовпадение условий при формальной допустимости'};
    })});
  }
}
const rubric={version:'business-modular-a10-v1',synthetic:true,authoredAt:new Date().toISOString(),
  exposure:'Author has read previous business audit and four modular ranking tests. This is preregistered synthetic scenario validation, not a blind human holdout or a calibrated hiring study.',
  eligibility:'Own demo pool; visible, matching consent, exact specialization, confirmed category at least requested grade, all verified requirements. Explicit per-skill minimum requires modular proof. All gates refer to one whole CV.',
  relevance:{0:'inadmissible',1:'admissible with substantial format/salary conflict',2:'admissible with unresolved tax basis or format compromise',3:'strong fit with compatible conditions'},
  limits:['No CV text/job semantic embedding is measured.','No human outcomes; small mirrored two-specialization corpus.','FSP is a category-local tie signal, never replaces missing skills/category.','Historical grade-only proof may be admitted, with less complete evidence.','Allowed selected IDs judge business context, not every formally eligible alternative.'],
  metrics:{k:[3,5],positiveThreshold:2,gain:'2^relevance-1',discount:'1/log2(rank+1)',precision:'positives in top k divided by k including missing places',nDCG:'DCG / ideal DCG over all labeled people; null if ideal=0',coverage:'all false/missing admissions and selected CV errors, no excluded failed cases'},
  variants:['source-before-a01-a11','source-after-a01-a11'],tuningAllowed:false,
  permutations:['original','reverse'],fspAblation:true};
const files={};
for(const [name,value] of Object.entries({rubric,dataset:{specs,resumes,needs,now:'2026-10-08T12:00:00Z'},labels})){
  const text=JSON.stringify(value,null,2)+'\n'; await writeFile(`${dir}/${name}.json`,text,{flag:'wx'});files[name]=createHash('sha256').update(text).digest('hex');
}
const sourceDir=`${dir}/before-sources`; await mkdir(sourceDir,{recursive:true}); const sources={};
for(const name of ['signal-matching.ts','signal-resume-catalog.ts','fsp-results.ts','skill-catalog.ts','employer-required-skills.ts']) {
  const bytes=await readFile(`artifacts/api-server/src/lib/${name}`); await writeFile(`${sourceDir}/${name}`,bytes,{flag:'wx'});sources[name]=createHash('sha256').update(bytes).digest('hex');
}
const freeze={frozenAt:new Date().toISOString(),beforeFirstRankInvocation:true,files,sources,people:24,resumes:resumes.length,needs:needs.length,labels:labels.length*12};
await writeFile(`${dir}/freeze.json`,JSON.stringify(freeze,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(freeze));
