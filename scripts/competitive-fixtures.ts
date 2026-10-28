import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {pool} from '../lib/db/src/index';
export function assertOwnDatabase(){const u=new URL(process.env.DATABASE_URL??'');assert.ok(['localhost','127.0.0.1'].includes(u.hostname)&&u.port==='55480'&&u.pathname==='/signal','Own QA database required');}
export async function qaUser(role:'candidate'|'employer'='candidate'){
 const id=(await pool.query(`INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,'unusable-qa',$2,'Competitive QA',true,true) RETURNING id`,[`competitive-${randomUUID()}@example.test`,role])).rows[0].id;
 const token=randomBytes(32).toString('base64url');await pool.query(`INSERT INTO signal_sessions(token_hash,user_id,demo_mode,expires_at) VALUES($1,$2,true,now()+interval '1 hour')`,[createHash('sha256').update(token).digest('hex'),id]);
 let companyId:number|undefined,resumeId:number|undefined;
 if(role==='candidate'){
  await pool.query(`INSERT INTO signal_candidate_profiles(user_id,professional_alias) VALUES($1,$2)`,[id,`QA-${randomUUID()}`]);
  resumeId=(await pool.query(`INSERT INTO signal_candidate_resumes(user_id,title,is_primary,visibility,consent_matching,consent_catalog,skills) VALUES($1,'Python QA',true,'pseudonymous',true,true,ARRAY['Python']) RETURNING id`,[id])).rows[0].id;
 }else companyId=(await pool.query(`INSERT INTO signal_companies(owner_user_id,name,contact_email) VALUES($1,'Own QA company','company@example.test') RETURNING id`,[id])).rows[0].id;
 return {id,cookie:`fsp_signal_session=${token}`,companyId,resumeId};
}
export async function qaNeed(companyId:number,title='PRIVATE-TITLE-QA'){
 return (await pool.query(`INSERT INTO signal_needs(company_id,title,specialization,grade,grade_mode,required_skills,description,work_format,salary_min,salary_max) VALUES($1,$2,'Backend / Python','Junior','declared_or_verified','{}','PRIVATE-DESCRIPTION-QA','Удалённо',100000,200000) RETURNING id,revision`,[companyId,title])).rows[0];
}
export async function qaApi(path:string,cookie?:string,body?:unknown,method=body===undefined?'GET':'POST'){
 const r=await fetch(`http://127.0.0.1:4480/api${path}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};
}
