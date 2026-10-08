/** C04: a bounded, read-only phase profile. This is not a concurrency/load test. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {and,eq,inArray,isNull} from 'drizzle-orm';
import {db,pool,signalCandidateResumesTable as resumes,signalCandidateProfilesTable as profiles,signalNeedsTable as needs} from '../lib/db/src/index';
import {loadResumeCandidates,withResumeSkillEvidence,withResumePhotos} from '../artifacts/api-server/src/lib/signal-resume-matching';
import {projectLegacyResumeSkillEvidence} from '../artifacts/api-server/src/lib/signal-resume-skill-projection';
import {withAssessmentRankingEvidence} from '../artifacts/api-server/src/lib/assessment-ranking-evidence';
import {loadCandidateQualificationInputs,getResumeQualification} from '../artifacts/api-server/src/lib/signal-resume';
import {loadSkillQualificationInputs} from '../artifacts/api-server/src/lib/skill-module-service';
import {projectCurrentSkillModuleEvidence} from '../artifacts/api-server/src/lib/signal-skill-matching';
import {canonicalSkillKey} from '../artifacts/api-server/src/lib/skill-catalog';
import {catalogueComputation} from '../artifacts/api-server/src/lib/signal-catalog-computation';
import {evaluateResumeCandidates} from '../artifacts/api-server/src/lib/signal-resume-evaluation';
import {rankMatches,type SafeSkillEvidence} from '../artifacts/api-server/src/lib/signal-matching';
import {selectMatchingResumes,safeCatalogResume,availableResumeSummary,type CatalogResume} from '../artifacts/api-server/src/lib/signal-resume-catalog';
import {loadNeedSkillLevels} from '../artifacts/api-server/src/lib/need-skill-levels';

const [stage,pidArg,bundlePath,bundleSha]=process.argv.slice(2);
assert.ok(stage==='before'||stage==='after'||stage==='after-final');
const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55435');assert.equal(url.pathname,'/signal_full_audit_a10_20261008');
assert.equal(process.env.PGOPTIONS,'-c default_transaction_read_only=on');assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED,'true');
assert.match(bundleSha??'',/^[a-f0-9]{64}$/);assert.equal(createHash('sha256').update(await readFile(bundlePath)).digest('hex'),bundleSha);
const nativeGuard="$ids=@(Get-NetTCPConnection -LocalPort 4383 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique);if($ids.Count -ne 1){throw 'Expected own clean API'};$p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$ids[0]);@{pid=$p.ProcessId;commandLine=$p.CommandLine}|ConvertTo-Json -Compress";
const native=JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(nativeGuard,'utf16le').toString('base64')],{encoding:'utf8',timeout:30000,windowsHide:true}));
assert.equal(native.pid,Number(pidArg));assert.ok(native.commandLine.replaceAll('\\','/').toLowerCase().includes(bundlePath.replaceAll('\\','/').toLowerCase()));
const identity=(await pool.query('select current_database() as database,inet_server_port() as port,current_setting(\'default_transaction_read_only\') as readonly')).rows[0];assert.equal(identity.database,'signal_full_audit_a10_20261008');assert.equal(identity.port,5432);assert.equal(identity.readonly,'on');
const ledger=JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-full-audit-resource-after-fix-3e8d0330-1e72-4039-b4a5-a0646559be2e.json','utf8'));
const ownWorker=ledger.workers[0];assert.equal(ledger.prefix,'a10-volume-da36684b-e596-40de-8199-93557ff63e9d');
const [need]=await db.select().from(needs).where(eq(needs.id,ownWorker.needId));assert.ok(need);
const definition={...need,requiredSkillLevels:(await loadNeedSkillLevels([need.id])).get(need.id)??{}};
let activePhase='setup';const sqlTimings:{phase:string;ms:number;rows:number}[]=[];
const queryOriginal=pool.query.bind(pool);
(pool as any).query=(...args:any[])=>{const started=performance.now(),phase=activePhase;const result=(queryOriginal as any)(...args);assert.ok(result&&typeof result.then==='function','Profile only supports Promise SQL');return result.then((value:any)=>{sqlTimings.push({phase,ms:performance.now()-started,rows:value.rows?.length??0});return value;});};
type Phase={name:string;ms:number;sqlCalls:number;sqlMs:number;sqlRows:number};
async function timed<T>(name:string,fn:()=>Promise<T>|T,phases:Phase[]):Promise<T>{activePhase=name;const n=sqlTimings.length,start=performance.now();const result=await fn();const q=sqlTimings.slice(n);phases.push({name,ms:performance.now()-start,sqlCalls:q.length,sqlMs:q.reduce((s,x)=>s+x.ms,0),sqlRows:q.reduce((s,x)=>s+x.rows,0)});return result;}

function legacyProjection(rows:CatalogResume[],inputs:Awaited<ReturnType<typeof loadCandidateQualificationInputs>>,photos:Map<number,string|null>){
  const byOwner=new Map<number,typeof inputs.attempts>();for(const attempt of inputs.attempts){const group=byOwner.get(attempt.userId);if(group)group.push(attempt);else byOwner.set(attempt.userId,[attempt]);}
  return rows.map(row=>{
    const q=getResumeQualification(row,byOwner.get(row.userId)??[],inputs.correctedIds);
    const proven=new Set(q.evidence.map(p=>canonicalSkillKey(p.skill)));
    const legacy:SafeSkillEvidence[]=q.verifiedSkills.filter(skill=>!proven.has(canonicalSkillKey(skill))).map(skill=>({skill,candidateId:row.userId,attemptId:null,programId:null,programVersion:null,templateId:null,templateVersion:null,criterionId:null,criterion:null,result:null,date:q.latestAssessmentAt?.toISOString()??null,sourceType:row.demoMode?'demo_example':'legacy_record',limitation:q.limitation??'Историческое подтверждение без подробного протокола.'}));
    return {...row,avatarDataUrl:row.visibility==='public'?(photos.get(row.resumeId)??null):null,verifiedGrade:q.verifiedGrade,verifiedScore:q.verifiedScore,verifiedSkills:q.verifiedSkills,latestAssessmentAt:q.latestAssessmentAt,skillEvidence:[...q.evidence,...legacy]};
  });
}
async function photoRead(rows:CatalogResume[]){const ids=rows.filter(row=>row.visibility==='public'&&row.hasAccessiblePhoto).map(row=>row.resumeId);const found=ids.length?await db.select({resumeId:resumes.id,data:profiles.avatarDataUrl}).from(resumes).innerJoin(profiles,eq(profiles.userId,resumes.userId)).where(and(inArray(resumes.id,ids),isNull(resumes.deletedAt),eq(resumes.visibility,'public'))):[];return new Map(found.map(photo=>[photo.resumeId,photo.data]));}
const scope={demoMode:false,reviewScopeId:null};const runs:any[]=[];
for(const kind of ['catalog','matching','explanation'] as const){
  for(let repetition=0;repetition<3;repetition++){
    const phases:Phase[]=[],start=performance.now(),now=new Date();
    const raw=await timed('pool_sql_and_decode',()=>loadResumeCandidates(scope,{purpose:kind==='catalog'?'catalog':'matching',...(kind==='catalog'?{}:{specialization:need.specialization}),immutableProjection:true}),phases);
    const ranked=await timed('legacy_ranking_metadata',()=>withAssessmentRankingEvidence(raw,db,undefined,{mutateLocalProjection:true}),phases);
    const owners=[...new Set(ranked.map(row=>row.userId))];
    const inputs=await timed('legacy_inputs_sql',()=>loadCandidateQualificationInputs(owners),phases);
    const photos=await timed('whole_pool_photos_sql',()=>stage==='before'?photoRead(ranked):new Map<number,string|null>(),phases);
    const legacyWork={qualificationCalls:0,derivedSkillArrays:0};
    const projected=await timed('legacy_extraction_and_cv_projection',()=>stage==='before'?legacyProjection(ranked,inputs,photos):projectLegacyResumeSkillEvidence(ranked,inputs,photos,legacyWork),phases);
    const modules=await timed('module_inputs_sql',()=>loadSkillQualificationInputs(owners),phases);
    const moduleWork={qualificationCalls:0,moduleEvidenceGenerations:0,derivedSkillArrays:0,wholeRowCopies:0};
    const enriched=await timed('module_qualification_and_cv_projection',()=>projectCurrentSkillModuleEvidence(projected,modules,{mutateLocalProjection:stage!=='before',work:moduleWork}),phases);
    const distinctLegacyTargets=new Set(ranked.map(row=>JSON.stringify([row.userId,row.specialization,row.legacyQualification]))).size;
    const distinctModuleTargets=new Set(projected.map(row=>JSON.stringify([row.userId,row.specialization,row.assumedGrade??row.verifiedGrade??'Junior',row.stack,row.statedSkills]))).size;
    let presented:any;
    if(kind==='catalog'){
      const computation=await timed('rank_dedupe_filters_and_totals',()=>catalogueComputation(enriched,{specialization:'Backend / Python'},scope,now,true,false),phases);
      const people=computation.people.slice(0,24);
      const pageRows=await timed('page_repeat_hydration_and_photos',()=>stage==='before'?withResumeSkillEvidence(people.map(person=>person.selected)):withResumePhotos(people.map(person=>person.selected)),phases);
      presented={candidates:pageRows.map((row,i)=>({...safeCatalogResume(row),candidateId:row.userId,alias:row.alias,avatarDataUrl:row.avatarDataUrl,skillEvidence:row.skillEvidence,categoryEvidence:row.categoryEvidence,availableResumes:people[i]!.alternatives.map(availableResumeSummary)})),total:computation.people.length,availableTotal:computation.availableTotal};
    }else{
      const rows=await timed('rank_dedupe_and_ordinal',()=>rankMatches(selectMatchingResumes(evaluateResumeCandidates(definition,enriched,false,now).filter(row=>row.evaluation.eligible))),phases);
      // Explanation retains the same whole-pool ranking; only presentation is addressed.
      presented=kind==='explanation'?rows[0]:rows.map(({candidate,evaluation,alternatives})=>({candidateId:candidate.userId,resumeId:candidate.resumeId,verifiedGrade:candidate.verifiedGrade,score:evaluation.baseScore,ranking:evaluation.ranking,skillProofs:candidate.skillEvidence?.filter(p=>p.sourceType==='signal_skill_module').map(({skill,sourceType,level,programVersion})=>({skill,sourceType,level,programVersion})),availableResumes:alternatives.map(availableResumeSummary)}));
    }
    const encoded=await timed('serialization',()=>JSON.stringify(presented),phases);
    runs.push({kind,repetition,ms:performance.now()-start,poolRows:raw.length,distinctOwners:owners.length,distinctLegacyTargets,distinctModuleTargets,legacyWork,moduleWork,legacyAttempts:inputs.attempts.length,moduleEvidence:modules.evidence.length,wholePoolPhotos:photos.size,wholePoolPhotoCharacters:[...photos.values()].reduce((s,x)=>s+(x?.length??0),0),serializationBytes:Buffer.byteLength(encoded),serializationSha256:createHash('sha256').update(encoded).digest('hex'),phases});
    if(repetition===0){activePhase='baseline_equivalence_read';const actual=await withResumeSkillEvidence(ranked,db,{includePhotos:stage==='before'});assert.deepEqual(enriched,actual,'Phase replica must match production hydration exactly');if(stage!=='before'){const previous=projectCurrentSkillModuleEvidence(legacyProjection(ranked,inputs,photos),modules);assert.deepEqual(enriched,previous,'Request-local reuse must preserve old derivation semantics');}}
  }
}
const files=['artifacts/api-server/src/lib/signal-resume-matching.ts','artifacts/api-server/src/lib/signal-skill-matching.ts','artifacts/api-server/src/routes/signal-candidate-bank.ts'];
const sources=await Promise.all(files.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report={stage,at:new Date().toISOString(),mode:'sequential read-only phase replica of production paths, exact hydration equality once per route; not live HTTP or a p95/workload retest',runtimeGuard:{pid:Number(pidArg),bundlePath,bundleSha,port:4383},database:{name:identity.database,host:url.hostname,externalPort:Number(url.port),internalPort:identity.port,readOnly:true},samplesPerKind:3,newRows:0,secretsOrContactsOrAnswersInTrace:false,sources,runs};
const dir='outputs/verification/correction-01-20261008/performance';await mkdir(dir,{recursive:true});await writeFile(`${dir}/profile-${stage}.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});await pool.end();
console.log(JSON.stringify({stage,runs:runs.map(({kind,repetition,ms,poolRows,distinctOwners,distinctLegacyTargets,distinctModuleTargets,phases,...rest})=>({kind,repetition,ms,poolRows,distinctOwners,distinctLegacyTargets,distinctModuleTargets,...rest,phases}))}));
