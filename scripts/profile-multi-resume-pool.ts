/** Serial read-only SQL/cost diagnostic on the allowlisted synthetic load DB. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, pool, signalCandidateResumesTable as resumes, signalCandidateProfilesTable as profiles, signalUsersTable as users } from '../lib/db/src/index';
import { resumeMatchColumns, resumePoolFingerprintExpression, loadResumeCandidates, rankedResumePool } from '../artifacts/api-server/src/lib/signal-resume-matching';
import { withAssessmentRankingEvidence } from '../artifacts/api-server/src/lib/assessment-ranking-evidence';
import { signalPoolPredicate } from '../artifacts/api-server/src/lib/signal-pool-scope';
import { validatedLoadTarget } from './multi-resume-load-target';

export async function profileOwnedResumePool(label: string, runId: string) {
  assert.equal(validatedLoadTarget(process.env).key, 'dedicated-v1');
  const columns=resumeMatchColumns(), record=sql`row(${sql.join(Object.values(columns).map(value=>sql`${value}`),sql`, `)})::text`;
  const json=sql`jsonb_build_object(${sql.join(Object.entries(columns).flatMap(([key,value])=>[sql`${key}::text`,sql`${value}`]),sql`, `)})`;
  const result: Record<string,unknown>={mode:'read-only-diagnostic-not-acceptance',label,runId};
  for (const purpose of ['catalog','matching'] as const) {
    const predicate=and(eq(users.role,'candidate'),signalPoolPredicate(users,false),isNull(resumes.deletedAt),ne(resumes.visibility,'private'),purpose==='catalog'?eq(resumes.consentCatalog,true):eq(resumes.consentMatching,true),purpose==='matching'?eq(resumes.specialization,'Backend / Python'):undefined);
    const projections={
      fullTextSort:sql`encode(sha256(convert_to(coalesce(string_agg(${record}, '' order by ${sql`${resumes.id}`}), ''),'UTF8')),'hex')`,
      rowShaSort:sql`encode(sha256(coalesce(string_agg(sha256(convert_to(${record},'UTF8')),decode('','hex') order by ${sql`${resumes.id}`}),decode('','hex'))),'hex')`,
      storedComplete:resumePoolFingerprintExpression(),
      coldJson:sql`coalesce(jsonb_agg(${json} order by ${sql`${resumes.id}`}), '[]'::jsonb)`,
    };
    for (const [name,projection] of Object.entries(projections)) {
      const query=db.select({value:projection}).from(sql`${resumes} inner join ${users} on ${users.id}=${resumes.userId} inner join ${profiles} on ${profiles.userId}=${resumes.userId}`).where(predicate).toSQL();
      const repetitions=[];
      for(let n=0;n<3;n++) {
        const at=performance.now(), answer=await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+query.sql,query.params), plan=answer.rows[0]['QUERY PLAN'][0];
        repetitions.push({wallMs:performance.now()-at,executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],plan:plan.Plan});
      }
      result[`${purpose}/${name}`]={querySha256:createHash('sha256').update(query.sql).digest('hex'),repetitions};
    }
  }
  for(const purpose of ['catalog','matching'] as const) {
    const repetitions=[];
    for(let n=0;n<3;n++) {
      const at=performance.now(),rows=await loadResumeCandidates(false,{purpose,...(purpose==='matching'?{specialization:'Backend / Python'}:{})}),rawMs=performance.now()-at,evidenceAt=performance.now();
      await withAssessmentRankingEvidence(rows,db,undefined,{mutateLocalProjection:true});
      repetitions.push({rows:rows.length,rawMs,evidenceMs:performance.now()-evidenceAt});
    }
    result[`${purpose}/loader`]=repetitions;
  }
  const need={specialization:'Backend / Python',grade:'Middle' as const,requiredSkills:['Python','SQL'],desirableSkills:['API contracts'],workFormat:'Удалённо',salaryMin:150000,salaryMax:250000,salaryPeriod:'month' as const,salaryType:'gross' as const};
  const ranking=[];
  for(let n=0;n<3;n++) {const at=performance.now(),rows=await rankedResumePool(need,false);ranking.push({people:rows.length,totalMs:performance.now()-at});}
  result.ranking=ranking;
  await writeFile(`outputs/verification/multi-resume/pool-${runId}-${label}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({poolDiagnostic:label,catalog:result['catalog/loader'],matching:result['matching/loader'],ranking}));
}
