import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { CatalogResume } from '../artifacts/api-server/src/lib/signal-resume-catalog';
import type { SkillModuleEvidence } from '../artifacts/api-server/src/lib/skill-module-qualification';
import type { ResumeQualificationAttempt } from '../artifacts/api-server/src/lib/signal-resume-qualification';
const root = resolve(import.meta.dirname, '..');
const inputDir = resolve(root, 'docs/validation/correction-01-matching-supplement-20261008');
const sha = (value: string|Uint8Array) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => sha(JSON.stringify(value));
const load = async (name: string) => JSON.parse(await readFile(resolve(inputDir,`${name}.json`),'utf8'));

export async function evaluateSupplement(output?: string) {
  const freeze = await load('freeze');
  for (const [name,hash] of Object.entries(freeze.files)) assert.equal(sha(await readFile(resolve(inputDir,`${name}.json`))),hash,`Frozen ${name} changed`);
  for (const [path,hash] of Object.entries(freeze.preservation)) assert.equal(sha(await readFile(resolve(root,path))),hash,`Historical evidence changed: ${path}`);
  const dataset = await load('dataset'), labels = await load('labels'), rubric = await load('rubric');
  const startedAt = new Date().toISOString();
  assert.ok(Date.parse(freeze.frozenAt) < Date.parse(startedAt),'Labels must precede evaluator use');
  // Importing production DB-bound helpers needs a sentinel URL. The injected reader
  // has no SQL transport and no mutations; this URL cannot reach a real database.
  process.env.DATABASE_URL = 'postgresql://stateless_fixture:unused@127.0.0.1:1/correction01_never_connect';
  process.env.SIGNAL_SKILL_MODULES_ENABLED = 'true';
  const sourceHashes: Record<string,string> = {};
  const sourceStarts = ['signal-matching.ts','signal-resume-catalog.ts','fsp-provider.ts','fsp-results.ts','skill-module-bank.ts',
    'skill-module-qualification.ts','skill-module-service.ts','signal-skill-matching.ts','signal-resume-qualification.ts',
    'signal-resume-matching.ts','signal-resume.ts','assessment-managed.ts','assessment-bank.ts','assessment-ranking-evidence.ts'];
  const capture = async (path: string) => {
    const key = relative(root,path).replaceAll('\\','/'); if (sourceHashes[key]) return;
    const bytes = await readFile(path); sourceHashes[key] = sha(bytes);
    if(output) { const target=resolve(output,'sources',key); await mkdir(dirname(target),{recursive:true}); await writeFile(target,bytes,{flag:'wx'}); }
    for(const match of bytes.toString('utf8').matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const base=resolve(dirname(path),match[1]);
      for(const candidate of /\.(ts|mjs|json)$/.test(base)?[base]:[`${base}.ts`,`${base}.json`,resolve(base,'index.ts')]) {
        try { await readFile(candidate); await capture(candidate); break; } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
      }
    }
  };
  if(output) await mkdir(output,{recursive:true});
  await capture(resolve(root,'scripts/evaluate-correction01-matching-supplement.ts'));
  await capture(resolve(root,'scripts/freeze-correction01-matching-supplement.mjs'));
  for(const name of sourceStarts)await capture(resolve(root,'artifacts/api-server/src/lib',name));
  if(output)await writeFile(resolve(output,'first-use.json'),JSON.stringify({startedAt,frozenAt:freeze.frozenAt,labelsSha256:freeze.files.labels,
    frozenInputHashes:freeze.files,sourceHashes,stateless:true,noManualFinalGrade:true,noWeightOrThresholdTuning:true},null,2)+'\n',{flag:'wx'});
  const bank = await import('../artifacts/api-server/src/lib/skill-module-bank');
  const { assembleManagedAttempt } = await import('../artifacts/api-server/src/lib/assessment-managed');
  const { scoreAttempt, requiredScore } = await import('../artifacts/api-server/src/lib/assessment-bank');
  const { getResumeQualification } = await import('../artifacts/api-server/src/lib/signal-resume-qualification');
  const { getSkillQualification } = await import('../artifacts/api-server/src/lib/skill-module-qualification');
  const { withResumeSkillEvidence } = await import('../artifacts/api-server/src/lib/signal-resume-matching');
  const { withAssessmentRankingEvidence } = await import('../artifacts/api-server/src/lib/assessment-ranking-evidence');
  const { fspSignalFromConnection, savedFspIdentityValues, fspConsentVersion, fspFixtureVersion, fspDemoFixtureId } = await import('../artifacts/api-server/src/lib/fsp-provider');
  const { compactFspSignal, emptyFspSignal } = await import('../artifacts/api-server/src/lib/fsp-results');
  const { evaluateMatch, rankMatches, MATCH_ALGORITHM_VERSION } = await import('../artifacts/api-server/src/lib/signal-matching');
  const { selectMatchingResumes, catalogVisible, matchesCatalogFilters, deduplicateResumes, orderCatalog } = await import('../artifacts/api-server/src/lib/signal-resume-catalog');
  const { canonicalSkillKey } = await import('../artifacts/api-server/src/lib/skill-catalog');
  const { getTableName } = createRequire(resolve(root,'artifacts/api-server/package.json'))('drizzle-orm');
  const now = new Date(dataset.now);
  const moduleEvidence: SkillModuleEvidence[] = dataset.moduleProofs.map((spec: any) => {
    const form = bank.buildSkillAttempt(spec.skillId,spec.level,spec.seed);
    const answers = Object.fromEntries(form.cases.map(c=>[c.id,form.oracles[c.id]!.parts?.map(p=>p.expected).join(';') ?? form.oracles[c.id]!.expected]));
    const decision = bank.scoreSkillAttempt(form.cases,form.oracles,answers,form.policy);
    assert.ok(decision.passed,`Synthetic positive module did not pass: ${spec.userId}/${spec.skillId}/${spec.level}`);
    return {id:spec.id,userId:spec.userId,attemptId:spec.attemptId,skillId:spec.skillId,level:spec.level,programVersion:form.programVersion,
      decision,competencyIds:decision.competencies.filter(c=>c.passed).map(c=>c.id),verifiedAt:new Date(spec.verifiedAt)};
  });
  const attempts: ResumeQualificationAttempt[] = dataset.assessmentProofs.map((spec: any) => {
    const form = assembleManagedAttempt(spec.programId,spec.grade,spec.seed,{programVersion:spec.programVersion});
    const answers = form.cases.map(c=>({caseId:c.id,answer:form.oracles[c.id]!.answer}));
    if(spec.errorFamily) {
      const index=form.cases.findIndex(c=>form.oracles[c.id]!.blueprint.family===spec.errorFamily);
      assert.ok(index>=0); assert.equal(form.oracles[form.cases[index]!.id]!.blueprint.critical,false);
      answers[index]!.answer='synthetic-deliberate-noncritical-error';
    }
    const scored=scoreAttempt(form.cases,form.oracles,answers),verified=scored.criticalComplete&&scored.score>=requiredScore(spec.grade);
    assert.ok(verified,'Synthetic saved full qualification must be actually verified');
    return {id:spec.id,userId:spec.userId,resumeId:spec.resumeId,resumeRevision:spec.resumeRevision,grade:spec.grade,
      programId:spec.programId,programVersion:spec.programVersion,resumeSpecialization:'Backend / Python',
      purpose:'signal_qualification',purposeOrigin:'candidate_confirmed',gradeConfirmedAt:new Date(spec.submittedAt),
      status:'submitted',...form,answers,score:scored.score,verified,gradeChanged:true,
      startedAt:new Date('2026-10-08T11:20:00.000Z'),dueAt:new Date('2026-10-08T12:00:00.000Z'),submittedAt:new Date(spec.submittedAt)};
  });
  const corrected = new Set<number>(dataset.correctedAssessmentAttemptIds), revoked = new Set<number>(dataset.revokedModuleEvidenceIds);
  const captures: {table:string;fields:string[]}[]=[];
  // Production projection reads exact immutable attempts/decisions and corrections.
  // This small adapter replaces only transport. It cannot update, insert or connect.
  const reader = {
    select(fields?: Record<string,unknown>) {
      return {from(table: any) { return {where(_condition: unknown) {
        const name=getTableName(table); captures.push({table:name,fields:Object.keys(fields??{}).sort()});
        if(name==='signal_assessment_attempts') {
          if(fields&&'oracles' in fields)return Promise.resolve(attempts.map(a=>({id:a.id,oracles:Object.fromEntries(Object.entries(a.oracles as any).map(([key,value]:any)=>[key,{blueprint:value.blueprint}]))})));
          if(fields&&'data' in fields)return Promise.resolve(attempts.filter(a=>a.verified).map(a=>({data:{id:a.id,userId:a.userId,programId:a.programId,programVersion:a.programVersion,purpose:a.purpose,grade:a.grade,score:a.score,submittedAt:a.submittedAt?.toISOString()??null}})));
          return Promise.resolve(attempts);
        }
        if(name==='signal_assessment_corrections')return Promise.resolve([...corrected].map(attemptId=>({attemptId})));
        if(name==='signal_skill_evidence')return Promise.resolve(moduleEvidence);
        if(name==='signal_skill_corrections')return Promise.resolve([...revoked].map(evidenceId=>({evidenceId})));
        throw new Error(`Unexpected fixture table read: ${name}`);
      } };} };
    },
  } as unknown as NonNullable<Parameters<typeof withResumeSkillEvidence>[1]>;
  const fspConnection=(kind:string) => kind==='none'?null:kind==='id-only'?savedFspIdentityValues(fspDemoFixtureId,now):{
    fspId:fspDemoFixtureId,status:'connected_demo',consentVersion:fspConsentVersion,consentedAt:now,verifiedAt:now,
    revokedAt:kind==='revoked-demo-win'?now:null,provenance:'synthetic_fixture',providerVersion:fspFixtureVersion,lastErrorCode:null,
    achievements:[{id:'c03-explicit-synthetic-win',title:'Synthetic Demo win',event:'Synthetic fixture, not registry',occurredAt:'2026-10-01',kind:'placement',result:'win'}],
  };
  const raw: CatalogResume[]=dataset.resumes.map((spec:any)=>{
    const {fsp,...row}=spec;
    const signal=fspSignalFromConnection(fspConnection(fsp),{accountIsDemo:row.demoMode,demoEnabled:true});
    return {...row,verifiedGrade:null,verifiedScore:null,verifiedSkills:[],latestAssessmentAt:null,assessmentEvidence:null,
      avatarDataUrl:null,publicName:null,deletedAt:row.deletedAt?new Date(row.deletedAt):null,fspSignal:compactFspSignal(signal),hasFspHistory:signal.historyStatus==='trusted_results'};
  });
  const immutableBefore=digest({raw,moduleEvidence,attempts,corrected:[...corrected],revoked:[...revoked]});
  const projected=await withResumeSkillEvidence(raw,reader);
  const pool=await withAssessmentRankingEvidence(projected,reader,null);
  assert.equal(digest({raw,moduleEvidence,attempts,corrected:[...corrected],revoked:[...revoked]}),immutableBefore,'Fixture or source CV mutation');
  const byOwner=(id:number)=>pool.find(row=>row.userId===id)!;
  const projection=pool.map(row=>{
    const historical=getResumeQualification(row,attempts,corrected);
    const modular=getSkillQualification({userId:row.userId,specialization:row.specialization,assumedGrade:row.assumedGrade!,stack:row.stack,skills:row.statedSkills},{evidence:moduleEvidence,revokedIds:revoked});
    const levels={Junior:1,Middle:2,Senior:3};
    const chosen=Boolean(modular.verifiedGrade&&(!historical.verifiedGrade||levels[modular.verifiedGrade]>=levels[historical.verifiedGrade]));
    return {userId:row.userId,resumeId:row.resumeId,verifiedGrade:row.verifiedGrade,expectedGrade:labels.expectedGrades[row.resumeId],
      gradeMatches:row.verifiedGrade===labels.expectedGrades[row.resumeId],historicalSource:historical.source,historicalGrade:historical.verifiedGrade,
      derivationConsistent:row.verifiedGrade===(chosen?modular.verifiedGrade:historical.verifiedGrade),
      historicalApplicability:historical.applicability.map(a=>({attemptId:a.attemptId,applied:a.applied,reasonCode:a.reasonCode})),
      modularGrade:modular.verifiedGrade,coverage:modular.coverage,categoryEvidence:row.categoryEvidence??null,
      evidenceOwnerMatches:(row.skillEvidence??[]).every(e=>e.candidateId===row.userId),skillEvidence:row.skillEvidence,
      assessmentEvidence:row.assessmentEvidence,fspSignal:row.fspSignal};
  });
  const difference=(a:number[],b:number[])=>a.filter(id=>!b.includes(id));
  const metrics=(ids:number[],points:any[],k:number)=>{
    const map=new Map(points.map(p=>[p.userId,p.relevance]));const actual=ids.slice(0,k).map(id=>Number(map.get(id)??0));
    const ideal=points.map(p=>p.relevance).sort((a,b)=>b-a).slice(0,k);
    const dcg=(values:number[])=>values.reduce((sum,value,i)=>sum+(2**value-1)/Math.log2(i+2),0),idcg=dcg(ideal);
    return {k,nDCG:idcg?dcg(actual)/idcg:null,precision:actual.filter(v=>v>=2).length/k,missingPlaces:Math.max(0,k-ids.length)};
  };
  const cases=dataset.needs.map((rawNeed:any)=>{
    const need={...rawNeed,requiredSkillLevels:Object.fromEntries(Object.entries(rawNeed.requiredSkillLevels).map(([key,level])=>[canonicalSkillKey(key),level]))};
    const points=labels.needLabels.find((l:any)=>l.needId===need.needId).pointwise;
    const run=(rows:CatalogResume[],withFsp:boolean)=>{
      const entries=rows.map(row=>({candidate:withFsp?row:{...row,hasFspHistory:false,fspSignal:compactFspSignal(emptyFspSignal())},evaluation:null as any}));
      for(const entry of entries)entry.evaluation=evaluateMatch(need,entry.candidate,need.poolDemoMode,now);
      // The real SQL loader excludes deleted CVs before evaluation. This adapter
      // declares that transport boundary explicitly and retains its rejection log.
      return {all:entries,ranked:rankMatches(selectMatchingResumes(entries.filter(e=>!e.candidate.deletedAt&&e.evaluation.eligible)))};
    };
    const actual=run(pool,true),without=run(pool,false),reverse=run([...pool].reverse(),true);
    const ids=actual.ranked.map(e=>e.candidate.userId),expected=points.filter((p:any)=>p.eligible).map((p:any)=>p.userId);
    const order=(entries:typeof actual.ranked)=>entries.map(e=>({userId:e.candidate.userId,resumeId:e.candidate.resumeId,
      category:e.evaluation.ranking.categoryId,categoryPosition:e.evaluation.ranking.categoryPosition,group:e.evaluation.ranking.groupId,
      qualityStatus:e.evaluation.ranking.qualityStatus,qualityScore:e.evaluation.ranking.qualityScore,fit:e.evaluation.ranking.businessFitScore,
      fspBonus:e.evaluation.fspBonus,alternatives:e.alternatives.map(a=>a.resumeId)}));
    const relation=(entries:typeof actual.ranked,before:number,after:number)=>entries.findIndex(e=>e.candidate.userId===before)>=0&&entries.findIndex(e=>e.candidate.userId===after)>entries.findIndex(e=>e.candidate.userId===before);
    const pairs=labels.ordering.filter((p:any)=>p.needId===need.needId).map((pair:any)=>({...pair,passed:relation(actual.ranked,pair.before,pair.after)}));
    const ablations=labels.ablation.filter((a:any)=>a.needId===need.needId).map((spec:any)=>{
      const first=actual.ranked.find(e=>e.candidate.userId===spec.withFspBefore)!,second=actual.ranked.find(e=>e.candidate.userId===spec.withFspAfter)!;
      const sameCategory=first.evaluation.ranking.categoryId===second.evaluation.ranking.categoryId;
      return {...spec,sameCategoryObserved:sameCategory,passed:sameCategory&&relation(actual.ranked,spec.withFspBefore,spec.withFspAfter)&&relation(without.ranked,spec.withoutFspBefore,spec.withoutFspAfter)};
    });
    const selectedErrors=actual.ranked.filter(e=>!points.find((p:any)=>p.userId===e.candidate.userId)?.allowedSelectedResumeIds.includes(e.candidate.resumeId)).map(e=>({userId:e.candidate.userId,resumeId:e.candidate.resumeId}));
    return {needId:need.needId,normalizedRequiredSkillLevels:need.requiredSkillLevels,admission:{expected,returned:ids,falseAdmissions:difference(ids,expected),missingAdmissions:difference(expected,ids),selectedErrors,duplicates:ids.length-new Set(ids).size},
      order:order(actual.ranked),fspAblation:{order:order(without.ranked),changed:JSON.stringify(ids)!==JSON.stringify(without.ranked.map(e=>e.candidate.userId)),pairs:ablations},
      orderingPairs:pairs,permutationStable:JSON.stringify(order(actual.ranked))===JSON.stringify(order(reverse.ranked)),metrics:{at3:metrics(ids,points,3),at5:metrics(ids,points,5)},
      rejected:actual.all.filter(e=>e.candidate.deletedAt||!e.evaluation.eligible).map(e=>({userId:e.candidate.userId,resumeId:e.candidate.resumeId,reasons:e.candidate.deletedAt?['deleted_cv_loader_boundary']:e.evaluation.ineligibilityReasons}))};
  });
  const catalogs=labels.catalogLabels.map((spec:any)=>{
    const result=orderCatalog(deduplicateResumes(pool.filter(row=>catalogVisible(row,spec.demoMode)&&matchesCatalogFilters(row,spec.filters,now))));
    const ids=result.people.map(p=>p.selected.userId);
    const selectedErrors=result.people.filter(p=>spec.selectedResume[p.selected.userId]&&p.selected.resumeId!==spec.selectedResume[p.selected.userId]).map(p=>({userId:p.selected.userId,resumeId:p.selected.resumeId}));
    return {id:spec.id,filters:spec.filters,demoMode:spec.demoMode,expected:spec.expectedPeople,returned:ids,
      falseAdmissions:difference(ids,spec.expectedPeople),missingAdmissions:difference(spec.expectedPeople,ids),selectedErrors,
      people:result.people.map(p=>({userId:p.selected.userId,resumeId:p.selected.resumeId,availableResumeIds:p.alternatives.map(r=>r.resumeId)}))};
  });
  const [strong,weak,other]=[1020,1021,1022].map(byOwner);
  const strength={comparable:{people:[1020,1021],sameProgram:strong.assessmentEvidence?.programId===weak.assessmentEvidence?.programId,
    sameVersion:strong.assessmentEvidence?.programVersion===weak.assessmentEvidence?.programVersion,sameRubric:strong.assessmentEvidence?.rubricKey===weak.assessmentEvidence?.rubricKey,
    scores:[strong.assessmentEvidence?.score,weak.assessmentEvidence?.score]},incomparable:{people:[1020,1022],versions:[strong.assessmentEvidence?.programVersion,other.assessmentEvidence?.programVersion],
    rubricKeys:[strong.assessmentEvidence?.rubricKey,other.assessmentEvidence?.rubricKey]},moduleOverallScores:labels.comparison.modularUnknownOverall.map((id:number)=>({userId:id,score:byOwner(id).assessmentEvidence?.score??null})),
    legacyOverallScores:labels.comparison.legacyUnknownOverall.map((id:number)=>({userId:id,score:byOwner(id).assessmentEvidence?.score??null}))};
  const bonusChecks=Object.entries(labels.expectedBonus).map(([id,expected])=>({userId:Number(id),expected,actual:byOwner(Number(id)).fspSignal?.bonus??0,passed:(byOwner(Number(id)).fspSignal?.bonus??0)===expected}));
  const categoryCase=cases.find(c=>c.needId===labels.categoryIsolation.needId)!;
  const senior=categoryCase.order.find(r=>r.userId===labels.categoryIsolation.userId)!,seniorWithout=categoryCase.fspAblation.order.find(r=>r.userId===labels.categoryIsolation.userId)!;
  const categoryIsolation={userId:senior.userId,category:senior.category,withFspBlock:senior.categoryPosition,withoutFspBlock:seniorWithout.categoryPosition,passed:senior.categoryPosition===seniorWithout.categoryPosition};
  const failures:any[]=[];
  for(const row of projection)if(!row.gradeMatches||!row.evidenceOwnerMatches||!row.derivationConsistent)failures.push({type:'projection',resumeId:row.resumeId,expected:row.expectedGrade,actual:row.verifiedGrade,derivationConsistent:row.derivationConsistent});
  for(const row of cases){for(const key of ['falseAdmissions','missingAdmissions','selectedErrors'] as const)if(row.admission[key].length)failures.push({type:key,needId:row.needId,detail:row.admission[key]});
    if(row.admission.duplicates||!row.permutationStable)failures.push({type:'duplicates/permutation',needId:row.needId});
    for(const pair of [...row.orderingPairs,...row.fspAblation.pairs])if(!pair.passed)failures.push({type:'ordering/ablation',detail:pair});}
  for(const row of catalogs)for(const key of ['falseAdmissions','missingAdmissions','selectedErrors'] as const)if(row[key].length)failures.push({type:`catalog-${key}`,id:row.id,detail:row[key]});
  for(const row of bonusChecks)if(!row.passed)failures.push({type:'bonus',detail:row});
  if(!strength.comparable.sameProgram||!strength.comparable.sameVersion||!strength.comparable.sameRubric||!(strength.comparable.scores[0]!>strength.comparable.scores[1]!))failures.push({type:'comparable-strength',detail:strength});
  if(strength.incomparable.versions[0]===strength.incomparable.versions[1]||strength.moduleOverallScores.some(r=>r.score!==null)||strength.legacyOverallScores.some(r=>r.score!==null))failures.push({type:'proof-boundary',detail:strength});
  if(!categoryIsolation.passed)failures.push({type:'category-isolation',detail:categoryIsolation});
  for(const [path,hash] of Object.entries(freeze.preservation))assert.equal(sha(await readFile(resolve(root,path))),hash,`Historical evidence changed during evaluation: ${path}`);
  const report={status:failures.length?'FAIL':'PASS',startedAt,finishedAt:new Date().toISOString(),algorithm:MATCH_ALGORITHM_VERSION,
    skillBankVersion:bank.SKILL_BANK_VERSION,freeze,sourceHashes,stateless:true,synthetic:true,humanCalibration:false,productionWeightsAdjusted:false,
    projection,cases,catalogs,strength,bonusChecks,categoryIsolation,failures,limitations:rubric.limits,preservation:{checkedFiles:Object.keys(freeze.preservation).length,unchanged:true},
    proofConstruction:{moduleDecisions:moduleEvidence.map(e=>({id:e.id,userId:e.userId,skillId:e.skillId,level:e.level,programVersion:e.programVersion,decision:e.decision,verifiedAt:e.verifiedAt,revoked:revoked.has(e.id)})),
      savedExams:attempts.map(a=>({id:a.id,userId:a.userId,programVersion:a.programVersion,score:a.score,verified:a.verified,submittedAt:a.submittedAt,corrected:corrected.has(a.id),immutableFormHash:digest({cases:a.cases,oracles:a.oracles,answers:a.answers})}))},fixtureReader:{transport:'in-memory only',captures}};
  if(output)await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return report;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const output=resolve(root,process.argv[2]??'outputs/verification/correction-01-20261008/matching/run01');
  const report=await evaluateSupplement(output);
  console.log(JSON.stringify({status:report.status,counts:report.freeze.counts,labelsSha256:report.freeze.files.labels,failures:report.failures,report:resolve(output,'report.json')}));
  if(report.failures.length)process.exitCode=1;
}
