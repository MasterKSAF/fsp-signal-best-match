/** Real SQL equivalence and warm-rubric freshness, exact owned load DB only. */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { and, eq, isNull, inArray, ne, sql, getTableColumns } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalCandidateProfilesTable as profiles, signalCandidateResumesTable as resumes, signalAssessmentAttemptsTable as attempts, signalAssessmentCorrectionsTable as corrections,signalFspConnectionsTable as connections } from '../lib/db/src/index';
import { loadResumeCandidates, resumeMatchColumns, withResumeSkillEvidence, rankedResumePool } from '../artifacts/api-server/src/lib/signal-resume-matching';
import { RankingRubricCache, withAssessmentRankingEvidence } from '../artifacts/api-server/src/lib/assessment-ranking-evidence';
import { signalPoolPredicate, type SignalPoolScope } from '../artifacts/api-server/src/lib/signal-pool-scope';
import { assembleManagedAttempt, verifiedSkillsForAttempt } from '../artifacts/api-server/src/lib/assessment-managed';
import { assessmentBankVersion, scoreAttempt } from '../artifacts/api-server/src/lib/assessment-bank';
import { emptyResume } from '../artifacts/api-server/src/lib/signal-resume-contract';
import { validatedLoadTarget } from './multi-resume-load-target-v060';
import { FreshJsonPoolCache } from '../artifacts/api-server/src/lib/signal-fresh-pool-cache';
const target = validatedLoadTarget(process.env, false); assert.equal(target.key, 'dedicated-v060');
const id = randomBytes(6).toString('hex'), ownedIds: number[] = [], checks: string[] = [];
const at = new Date('2026-10-05T10:11:12.123Z'); let failure: string | null = null;
try {
  const created = await db.insert(users).values([
    { email: `v060-multi-load-sql-${id}-ordinary@example.test`, displayName: 'Public ＮＡＭＥ', role: 'candidate' as const, passwordHash: 'unusable-synthetic', demoMode: false },
    { email: `v060-multi-load-sql-${id}-overview@example.test`, displayName: 'Demo', role: 'candidate' as const, passwordHash: 'unusable-synthetic', demoMode: true },
    { email: `v060-multi-load-sql-${id}-reviewer@example.test`, displayName: 'Reviewer', role: 'candidate' as const, passwordHash: 'unusable-synthetic', demoMode: true, reviewScopeId: '60dba17d-14f9-4e11-9a53-2a33b71a38c1' },
  ]).returning(); ownedIds.push(...created.map(row => row.id));
  await db.insert(profiles).values(created.map(row => ({ userId: row.id, professionalAlias: `ALIAS ${row.id}`, avatarDataUrl: 'data:image/png;base64,AQ==' })));
  const form = assembleManagedAttempt('backend-python','Middle',`sql-${id}`), answers = form.cases.map(row => ({ caseId: row.id, answer: form.oracles[row.id]!.answer })), result = scoreAttempt(form.cases,form.oracles,answers);
  const createdResumes = await db.insert(resumes).values(created.flatMap(user => ['public','pseudonymous','private'].map((visibility,index) => ({ ...emptyResume('Backend / Python'), userId:user.id, title:`SQL ${visibility}`, visibility: visibility as 'public'|'pseudonymous'|'private', consentCatalog:index!==1, consentMatching:index!==2, verifiedGrade:'Middle' as const, verifiedScore:100, verifiedSkills: verifiedSkillsForAttempt(form.cases,form.oracles,result.evidence), latestAssessmentAt:at, createdAt:at, updatedAt:at, stack:['Python',' SQL ','ＨＴＭＬ',''], skills: ['TS','Доступность'], salaryMin:0, salaryMax:123456, salaryPeriod:'year' as const, salaryType:'net' as const, yearsExperience:0, readyForOffers:index===0, legacyQualification:{ specialization:'Backend / Python', grade:'Middle' as const, score:85, skills:['Python'], assessedAt:at.toISOString(), attemptId:null, limitation:'Legacy original' } })))).returning();
  for (const scope of [{demoMode:false,reviewScopeId:null},{demoMode:true,reviewScopeId:null},{demoMode:true,reviewScopeId:created[2]!.reviewScopeId}] satisfies SignalPoolScope[]) {
    for (const purpose of ['owned','matching','catalog'] as const) {
      const rawOld = await db.select(resumeMatchColumns()).from(resumes).innerJoin(users,eq(users.id,resumes.userId)).innerJoin(profiles,eq(profiles.userId,resumes.userId)).leftJoin(connections,eq(connections.userId,users.id)).where(and(inArray(users.id,ownedIds),eq(users.role,'candidate'),signalPoolPredicate(users,scope),isNull(resumes.deletedAt),purpose==='owned'?undefined:ne(resumes.visibility,'private'),purpose==='catalog'?eq(resumes.consentCatalog,true):purpose==='matching'?eq(resumes.consentMatching,true):undefined));
      const old=rawOld.map(({fspConnection,...professional})=>{assert.equal(fspConnection,null,'Owned no-ledger SQL oracle');return {...professional,hasFspHistory:false};});
      const compact = (await loadResumeCandidates(scope,{purpose})).filter(row => ownedIds.includes(row.userId));
      assert.deepEqual(compact.sort((a,b)=>a.resumeId-b.resumeId),old.sort((a,b)=>a.resumeId-b.resumeId));
      checks.push(`SQL projection exact ${scope.demoMode}/${scope.reviewScopeId??'common'}/${purpose}`);
    }
  }
  const resume = createdResumes.find(row=>row.userId===created[0]!.id&&row.visibility==='public')!;
  {
    const mutations:Record<string,unknown>={
      id: Number((await pool.query("SELECT nextval(pg_get_serial_sequence('signal_candidate_resumes','id')) AS id")).rows[0].id),
      userId:created[1]!.id,title:'Digest direct SQL title',isPrimary:true,revision:42,
      specialization:'Frontend / TypeScript',assumedGrade:'Senior',verifiedGrade:'Senior',verifiedGradeChangedAt:new Date(at.getTime()+1000),verifiedScore:31,verifiedSkills:['Different skill'],stack:['Different stack'],skills:['Different stated'],yearsExperience:7,workFormat:'Гибрид',salaryMin:1,salaryMax:654321,salaryPeriod:'month',salaryType:'gross',visibility:'pseudonymous',consentMatching:false,consentCatalog:false,readyForOffers:false,
      latestAssessmentAt:sql`'2026-10-05T10:11:12.123001Z'::timestamptz`,qualificationAttemptId:998877,
      legacyQualification:{...resume.legacyQualification!,limitation:'Digest changed legacy JSON'},createdAt:new Date(resume.createdAt.getTime()+1000),deletedAt:new Date(at.getTime()+1000),summary:'Changed private summary',softSkills:['Changed soft skill'],experience:[{company:'Synthetic',role:'Engineer',start:'2025-01',end:null,description:'Changed nested experience'}],projects:[{title:'Synthetic project',role:'Owner',description:'Changed nested project',url:null}],education:[{institution:'Synthetic',qualification:'Course',start:'2025-01',end:null}],portfolio:[{title:'Synthetic link',url:'https://example.test/synthetic'}],questionnaire:{...resume.questionnaire,industry:'Digest changed self-report'},questionnaireHistory:[{completedAt:at.toISOString(),recommendedGrade:'Middle',questionnaire:resume.questionnaire}],updatedAt:new Date(resume.updatedAt.getTime()+1000),
    };
    assert.deepEqual(Object.keys(mutations).sort(),Object.keys(getTableColumns(resumes)).filter(key=>key!=='poolContentDigest').sort(),'Every full-row field is independently mutated');
    const originalDigest=resume.poolContentDigest.toString('hex');
    for(const [key,value] of Object.entries(mutations)) {
      const [changed]=await db.update(resumes).set({[key]:value} as typeof resumes.$inferInsert).where(eq(resumes.id,resume.id)).returning();
      assert.notEqual(changed!.poolContentDigest.toString('hex'),originalDigest,`Direct SQL ${key} change must invalidate content`);
      assert.equal(changed!.poolContentDigest.length,32);
      await db.update(resumes).set({[key]:(resume as unknown as Record<string,unknown>)[key]} as typeof resumes.$inferInsert).where(eq(resumes.id,changed!.id));
      const [restored]=await db.select().from(resumes).where(eq(resumes.id,resume.id));assert.equal(restored!.poolContentDigest.toString('hex'),originalDigest,`Restored exact ${key} returns exact full content signature`);
    }
    checks.push(`Unconditional direct SQL mutation of ALL ${Object.keys(mutations).length} résumé columns invalidates complete digest without a revision shortcut`);
    const [forged]=await db.update(resumes).set({poolContentDigest:Buffer.alloc(32,7)}).where(eq(resumes.id,resume.id)).returning();assert.equal(forged!.poolContentDigest.toString('hex'),originalDigest);checks.push('Direct SQL digest forgery is overwritten by the unconditional trigger');
    const canonical=await db.transaction(async tx=>{
      await tx.execute(sql`set local timezone to 'Pacific/Honolulu'`);await tx.execute(sql`set local datestyle to 'SQL, DMY'`);
      const answer=await tx.execute<{value:string}>(sql`select encode(signal_resume_pool_content_digest(${resumes}),'hex') as value from ${resumes} where ${resumes.id}=${resume.id}`);return answer.rows[0]!.value;
    });assert.equal(canonical,originalDigest);checks.push('Full content signature retains timestamp microseconds and is independent of timezone/DateStyle');
    const all=await pool.query("SELECT count(*)::int AS bad FROM signal_candidate_resumes r WHERE octet_length(pool_content_digest)<>32 OR pool_content_digest IS DISTINCT FROM signal_resume_pool_content_digest(r)");assert.equal(all.rows[0].bad,0);checks.push('Migration backfill covers every pre-existing/soft-deleted row with exact server-computed digest');
  }
  {
    const cache=new FreshJsonPoolCache<Awaited<ReturnType<typeof loadResumeCandidates>>[number]>();
    const snapshot=async()=>{const data=await loadResumeCandidates(false,{purpose:'matching',resumeId:resume.id});return {data,fingerprint:createHash('sha256').update(JSON.stringify(data)).digest('hex')};};
    await db.update(resumes).set({visibility:'private'}).where(eq(resumes.id,resume.id));
    const hidden=await snapshot();assert.equal(hidden.data.length,0);
    await db.update(resumes).set({visibility:'public'}).where(eq(resumes.id,resume.id));
    let release!:()=>void,captured!:()=>void;const ready=new Promise<void>(resolve=>captured=resolve);
    const first=cache.read('sql-hide-latch',hidden.fingerprint,async()=>{const visible=await snapshot();assert.equal(visible.data.length,1);captured();await new Promise<void>(resolve=>release=resolve);return visible;});
    await ready;
    await db.update(resumes).set({visibility:'private'}).where(eq(resumes.id,resume.id));
    const freshHidden=await snapshot();assert.equal(freshHidden.fingerprint,hidden.fingerprint);
    let ownFreshReads=0;
    const joined=cache.read('sql-hide-latch',freshHidden.fingerprint,snapshot,async()=>{ownFreshReads++;return(await snapshot()).fingerprint;});release();
    assert.equal((await first).length,1);assert.equal((await joined).length,0);
    assert.equal(ownFreshReads,1);assert.equal(cache.diagnostics().peakSnapshotBuilders,1);
    await db.update(resumes).set({visibility:'public'}).where(eq(resumes.id,resume.id));
    checks.push('Real SQL ABA hide latch: late coalesced caller reloads its own visible snapshot and never receives hidden résumé');
  }
  const reviewerScope={demoMode:true,reviewScopeId:created[2]!.reviewScopeId!};
  {
    const cache=new FreshJsonPoolCache<Awaited<ReturnType<typeof loadResumeCandidates>>[number]>();
    const snapshot=async()=>{const data=await loadResumeCandidates(reviewerScope,{purpose:'matching',userId:created[2]!.id});return{data,fingerprint:createHash('sha256').update(JSON.stringify(data)).digest('hex')};};
    const visible=await snapshot();assert.ok(visible.data.length);
    let release!:()=>void;
    const blocker=cache.read('other-owner-context','blocker',async()=>{await new Promise<void>(resolve=>release=resolve);return{fingerprint:'blocker',data:[]};});
    let freshReads=0;
    const queued=cache.read(JSON.stringify(reviewerScope),visible.fingerprint,snapshot,async()=>{freshReads++;return(await snapshot()).fingerprint;});
    await db.update(users).set({reviewScopeId:'7586739d-655d-466c-af3d-582f1c66c52f'}).where(eq(users.id,created[2]!.id));
    assert.equal(freshReads,0);release();await blocker;assert.deepEqual(await queued,[]);assert.equal(freshReads,1);assert.equal(cache.diagnostics().peakSnapshotBuilders,1);
    await db.update(users).set({reviewScopeId:reviewerScope.reviewScopeId}).where(eq(users.id,created[2]!.id));
    checks.push('Actual queued SQL caller reads its own current complete pool after reviewer movement, never stale preflight content or another owner context');
  }
  await loadResumeCandidates(reviewerScope,{purpose:'matching'});await loadResumeCandidates(reviewerScope,{purpose:'matching'});
  await db.update(users).set({reviewScopeId:'7586739d-655d-466c-af3d-582f1c66c52f'}).where(eq(users.id,created[2]!.id));
  assert.ok(!(await loadResumeCandidates(reviewerScope,{purpose:'matching'})).some(row=>row.userId===created[2]!.id));
  assert.ok((await loadResumeCandidates({demoMode:true,reviewScopeId:'7586739d-655d-466c-af3d-582f1c66c52f'},{purpose:'matching'})).some(row=>row.userId===created[2]!.id));checks.push('Warm reviewer scope change immediately leaves old pool and joins exact new pool');
  const readFreshPool = async () => (await loadResumeCandidates(false,{purpose:'matching'})).filter(row=>row.userId===resume.userId);
  const assertFreshPool = async () => {
    const raw=await db.select(resumeMatchColumns()).from(resumes).innerJoin(users,eq(users.id,resumes.userId)).innerJoin(profiles,eq(profiles.userId,resumes.userId)).leftJoin(connections,eq(connections.userId,users.id)).where(and(eq(users.id,resume.userId),eq(users.role,'candidate'),signalPoolPredicate(users,false),isNull(resumes.deletedAt),ne(resumes.visibility,'private'),eq(resumes.consentMatching,true)));
    const old=raw.map(({fspConnection,...professional})=>{assert.equal(fspConnection,null,'Owned no-ledger fresh SQL oracle');return {...professional,hasFspHistory:false};});
    assert.deepEqual((await readFreshPool()).sort((a,b)=>a.resumeId-b.resumeId),old.sort((a,b)=>a.resumeId-b.resumeId));
  };
  await assertFreshPool();await assertFreshPool();
  for(const patch of [{visibility:'private' as const},{visibility:'public' as const,consentMatching:false},{consentMatching:true,title:'Changed title',specialization:'Frontend / TypeScript'},{specialization:'Backend / Python',verifiedGrade:'Senior' as const,verifiedScore:42,verifiedSkills:['SQL'],latestAssessmentAt:new Date(at.getTime()+1234)},{deletedAt:new Date()},{deletedAt:null,verifiedGrade:'Middle' as const,verifiedScore:100,verifiedSkills:verifiedSkillsForAttempt(form.cases,form.oracles,result.evidence),latestAssessmentAt:at}]) {await db.update(resumes).set(patch).where(eq(resumes.id,resume.id));await assertFreshPool();}
  checks.push('Warm full pool immediately reflects hide/consent/title/specialization/grade/score/skills/date/delete');
  await db.update(users).set({role:'employer'}).where(eq(users.id,resume.userId));await assertFreshPool();await db.update(users).set({role:'candidate',displayName:'Changed public identity'}).where(eq(users.id,resume.userId));await assertFreshPool();
  await db.update(users).set({demoMode:true}).where(eq(users.id,resume.userId));await assertFreshPool();await db.update(users).set({demoMode:false}).where(eq(users.id,resume.userId));await assertFreshPool();
  checks.push('Warm full pool immediately reflects role/pool/public identity');
  await db.update(profiles).set({hasFspHistory:true,avatarDataUrl:null,professionalAlias:'Changed alias'}).where(eq(profiles.userId,resume.userId));await assertFreshPool();await db.update(profiles).set({avatarDataUrl:'data:image/png;base64,Ag=='}).where(eq(profiles.userId,resume.userId));await assertFreshPool();checks.push('Warm full pool immediately reflects FSP/alias/accessibility of actual photo');
  const [photoRow]=(await readFreshPool()).filter(row=>row.resumeId===resume.id);assert.equal((await withResumeSkillEvidence([photoRow!]))[0]?.avatarDataUrl,'data:image/png;base64,Ag==');
  await db.update(profiles).set({avatarDataUrl:'data:image/png;base64,Aw=='}).where(eq(profiles.userId,resume.userId));
  assert.equal((await withResumeSkillEvidence([(await readFreshPool()).find(row=>row.resumeId===resume.id)!]))[0]?.avatarDataUrl,'data:image/png;base64,Aw==');
  const pseudonymous=(await readFreshPool()).find(row=>row.visibility==='pseudonymous')!;assert.equal((await withResumeSkillEvidence([pseudonymous]))[0]?.avatarDataUrl,null);checks.push('Warm actual selected photograph bytes stay fresh and pseudonymous photograph stays closed');
  const [attempt] = await db.insert(attempts).values({userId:resume.userId,resumeId:resume.id,resumeSpecialization:resume.specialization,programId:'backend-python',programVersion:assessmentBankVersion(form.cases,form.oracles),grade:'Middle',status:'submitted',verified:true,score:100,cases:form.cases,oracles:form.oracles,answers,startedAt:at,dueAt:new Date(at.getTime()+60000),submittedAt:at,purpose:'signal_qualification'}).returning();
  const [candidate] = await loadResumeCandidates(false,{purpose:'owned',resumeId:resume.id});
  {
    const readonlyRows=await loadResumeCandidates(false,{purpose:'matching',immutableProjection:true}),own=readonlyRows.find(row=>row.resumeId===resume.id)!;
    assert.ok(Object.isFrozen(readonlyRows)&&Object.isFrozen(own));const date=own.latestAssessmentAt!;Date.prototype.setTime.call(date,0);assert.equal(own.latestAssessmentAt!.getTime(),at.getTime());assert.equal(Reflect.set(own,'title','Forged'),false);assert.throws(()=>own.stack.push('Forged'),TypeError);
    const enrichment=await withAssessmentRankingEvidence(readonlyRows,db,undefined,{mutateLocalProjection:true}),again=await withAssessmentRankingEvidence(readonlyRows,db,undefined,{mutateLocalProjection:true});assert.equal(again,enrichment);assert.ok(Object.isFrozen(enrichment)&&Object.isFrozen(enrichment[0]));
    const oracle=await withAssessmentRankingEvidence(readonlyRows,db,new RankingRubricCache());assert.deepEqual(enrichment,oracle);const selected=enrichment.find(row=>row.resumeId===resume.id)!;Date.prototype.setTime.call(selected.latestAssessmentAt!,0);assert.equal(selected.latestAssessmentAt!.getTime(),at.getTime());
    const defaultRow=(await loadResumeCandidates(false,{purpose:'matching',resumeId:resume.id}))[0]!;assert.equal(Object.isFrozen(defaultRow),false);defaultRow.title='Local change';assert.notEqual((await loadResumeCandidates(false,{purpose:'matching',resumeId:resume.id}))[0]!.title,'Local change');
    checks.push('Actual opt-in immutable pool/enrichment equals original values, reuses only exact snapshot, isolates Date setters and preserves default fresh mutable top-level contract');
  }
  const cache = new RankingRubricCache(10), load = () => withAssessmentRankingEvidence([candidate!],db,cache);
  const exactMetadataLoad=()=>withAssessmentRankingEvidence([candidate!],db);
  assert.deepEqual(await exactMetadataLoad(),await load());assert.deepEqual(await exactMetadataLoad(),await load());checks.push('Default complete metadata SHA cold/warm output equals uncached injected-reader/rubric contract');
  const need={specialization:'Backend / Python',grade:'Middle' as const,requiredSkills:['Python'],desirableSkills:[],workFormat:'Удалённо',salaryMin:0,salaryMax:200000,salaryPeriod:'year' as const,salaryType:'net' as const};
  const rank=()=>rankedResumePool(need,false);
  const coldRank=await rank(),warmRank=await rank();assert.deepEqual(warmRank,coldRank);checks.push('Actual fresh-input warm full ranking exact equality');
  await db.update(resumes).set({visibility:'private'}).where(eq(resumes.id,resume.id));assert.ok(!(await rank()).some(row=>row.candidate.resumeId===resume.id));await db.update(resumes).set({visibility:'public'}).where(eq(resumes.id,resume.id));checks.push('Actual warm full ranking immediately drops hidden résumé');
  const cold = await load(), warm = await load(); assert.deepEqual(warm,cold); assert.equal(warm[0]?.assessmentEvidence?.score,100); checks.push('Real cold/warm complete evidence equality');
  await db.update(attempts).set({score:67}).where(eq(attempts.id,attempt.id)); assert.equal((await load())[0]?.assessmentEvidence?.score,67); checks.push('Warm cached rubric reads fresh mutable score');
  assert.equal((await exactMetadataLoad())[0]?.assessmentEvidence?.score,67);checks.push('Warm complete metadata SHA immediately invalidates on mutable score');
  await db.update(attempts).set({submittedAt:new Date(at.getTime()+1)}).where(eq(attempts.id,attempt.id));assert.equal((await exactMetadataLoad())[0]?.assessmentEvidence,null);await db.update(attempts).set({submittedAt:at}).where(eq(attempts.id,attempt.id));assert.equal((await exactMetadataLoad())[0]?.assessmentEvidence?.score,67);checks.push('Warm complete metadata SHA immediately invalidates exact date linkage and restoration');
  assert.equal((await rank()).find(row=>row.candidate.resumeId===resume.id)?.evaluation.ranking.qualityScore,67);checks.push('Actual warm ranking reads fresh saved score without pool-field changes');
  await db.update(attempts).set({verified:false}).where(eq(attempts.id,attempt.id)); assert.equal((await load())[0]?.assessmentEvidence,null); checks.push('Warm cache cannot resurrect unverified attempt');
  assert.equal((await exactMetadataLoad())[0]?.assessmentEvidence,null);checks.push('Warm complete metadata SHA fresh predicates immediately remove unverified evidence');
  await db.update(attempts).set({verified:true}).where(eq(attempts.id,attempt.id));
  await db.insert(corrections).values({attemptId:attempt.id,reason:'Synthetic cache revocation SQL check',operator:'load-sql-acceptance',originalDecision:{score:67,verified:true,status:'submitted'}}); assert.equal((await load())[0]?.assessmentEvidence?.state,'revoked'); checks.push('Warm cached rubric respects fresh correction');
  assert.equal((await exactMetadataLoad())[0]?.assessmentEvidence?.state,'revoked');checks.push('Warm complete metadata SHA immediately invalidates on fresh correction EXISTS');
  assert.ok(!(await rank()).some(row=>row.candidate.userId===resume.userId));checks.push('Actual warm full ranking rejects fresh correction without stale admitted result');
} catch(error) { failure=((error as {cause?:Error}).cause?.message??(error as Error).message).slice(0,500); process.exitCode=1; }
finally {
  if(ownedIds.length) await db.delete(users).where(inArray(users.id,ownedIds));
  const remaining=ownedIds.length?(await db.select({id:users.id}).from(users).where(inArray(users.id,ownedIds))).length:0;
  const report={status:!failure&&remaining===0?'PASS':'FAIL',target,checks,failure,cleanup:{createdUsers:ownedIds.length,remainingUsers:remaining,ownerOnly:true},runtimeManifest:process.env.SIGNAL_LOAD_RUNTIME_MANIFEST};
  await writeFile(`outputs/verification/0.6.0/multi-resume/sql-acceptance-${id}.json`,JSON.stringify(report,null,2)); console.log(JSON.stringify(report)); await pool.end();
}
