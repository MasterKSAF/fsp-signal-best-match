/** Operator-only aggregates: never expose this CLI through user-facing routes. */
import {pool} from '../lib/db/src/index';
const days=Number(process.argv[2]??28);if(![7,28,90].includes(days))throw new Error('Usage: observe-assessment-bank.ts [7|28|90]');
try{
 const cohorts=await pool.query(`SELECT skill_id,level,program_version,coalesce(bank_release_hash,'legacy-unattested') release,
 count(*)::int issued,count(*) FILTER(WHERE status='submitted')::int submitted,
 CASE WHEN count(*) FILTER(WHERE status='submitted')>=5 THEN count(*) FILTER(WHERE status='submitted' AND decision->>'passed'='true')::numeric/nullif(count(*) FILTER(WHERE status='submitted'),0) END original_pass_fraction,
 CASE WHEN count(*) FILTER(WHERE submitted_at IS NOT NULL)>=5 THEN percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM submitted_at-started_at)) FILTER(WHERE submitted_at IS NOT NULL) END median_seconds
 FROM signal_skill_attempts WHERE started_at>now()-$1::int*interval '1 day' GROUP BY skill_id,level,program_version,bank_release_hash ORDER BY 1,2,3,4`,[days]);
 const exposures=await pool.query(`SELECT a.skill_id,a.level,coalesce(a.bank_release_hash,'legacy-unattested') release,e.template_id,count(*)::int exposures,count(DISTINCT e.user_id)::int people FROM signal_skill_exposures e JOIN signal_skill_attempts a ON a.id=e.attempt_id WHERE e.issued_at>now()-$1::int*interval '1 day' GROUP BY 1,2,3,4 ORDER BY exposures DESC,4`,[days]);
 const anomalies=await pool.query(`SELECT count(*)::int repeated_user_family_groups FROM(SELECT e.user_id,regexp_replace(e.template_id,'/variant/.*$','') family,count(*) FROM signal_skill_exposures e WHERE issued_at>now()-$1::int*interval '1 day' GROUP BY 1,2 HAVING count(*)>1) x`,[days]);
 const appeals=await pool.query(`SELECT kind,status,count(*)::int cases FROM signal_assessment_appeals WHERE created_at>now()-$1::int*interval '1 day' GROUP BY kind,status ORDER BY 1,2`,[days]);
 const reviews=await pool.query(`SELECT action,count(*)::int decisions FROM signal_assessment_review_decisions WHERE created_at>now()-$1::int*interval '1 day' GROUP BY action ORDER BY action`,[days]);
 console.log(JSON.stringify({schema:'signal-bank-observations-v1',days,minRateCohort:5,cohorts:cohorts.rows,exposure:exposures.rows,anomalies:anomalies.rows[0],appeals:appeals.rows,reviews:reviews.rows,limitations:'Descriptive engineering monitoring. Repeated family exposure is an investigation signal, not cheating proof. Original pass rate is not reviewed validity, difficulty calibration or human form equivalence. Small rates/timings are suppressed; no person, answer, seed, key or case content is output.',at:new Date().toISOString()},null,2));
}finally{await pool.end();}
