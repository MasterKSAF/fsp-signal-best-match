import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pool } from '../lib/db/src/index';
import { pdfFixture } from '../tests/fixtures/pdf-import';
const target=new URL(process.env.DATABASE_URL??'');assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='55480'&&target.pathname==='/signal');
process.env.DEMO_MODE='true';
const {default:app}=await import('../artifacts/api-server/src/app');const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const apiBase=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
const checks:string[]=[];const pass=(s:string)=>{checks.push(s);console.log('PASS',s);};
async function user(){const u=(await pool.query(`INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,'unusable-qa','candidate','PDF QA',true,true) RETURNING id`,[`pdf-${randomUUID()}@example.test`])).rows[0];await pool.query(`INSERT INTO signal_candidate_profiles(user_id,professional_alias) VALUES($1,$2)`,[u.id,`PDF-${randomUUID()}`]);const token=randomBytes(32).toString('base64url');await pool.query(`INSERT INTO signal_sessions(token_hash,user_id,demo_mode,expires_at) VALUES($1,$2,true,now()+interval '1 hour')`,[createHash('sha256').update(token).digest('hex'),u.id]);return {id:u.id,cookie:`fsp_signal_session=${token}`};}
async function cv(owner:number,title:string){return (await pool.query(`INSERT INTO signal_candidate_resumes(user_id,title,summary,skills,verified_skills,verified_grade) VALUES($1,$2,'Original summary',ARRAY['SQL'],ARRAY['Python'],'Middle') RETURNING *`,[owner,title])).rows[0];}
async function read(id:number){return (await pool.query('SELECT * FROM signal_candidate_resumes WHERE id=$1',[id])).rows[0];}
async function api(path:string,cookie:string,method='GET',body?:unknown,status=200){const r=await fetch(`${apiBase}/me/pdf-import${path}`,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
try{
 const a=await user(),b=await user(),first=await cv(a.id,'CV A'),second=await cv(a.id,'CV B'),initial=await read(first.id),data=(await pdfFixture()).toString('base64');
 const create=()=>api('',a.cookie,'POST',{resumeId:first.id,revision:first.revision,data},201);
 const uploaded=await create();assert.deepEqual(await read(first.id),initial);assert.equal(uploaded.requiresReview,true);
 await api(`/${uploaded.id}/apply`,a.cookie,'POST',{revision:1,reviewToken:'x'.repeat(43),fields:['skills']},409);
 await api(`/${uploaded.id}`,b.cookie,'GET',undefined,404);await api(`/${uploaded.id}/apply`,b.cookie,'POST',{revision:1,reviewToken:'x'.repeat(43),fields:['skills']},404);
 const beforeReview=await api(`/${uploaded.id}`,a.cookie);assert.ok(beforeReview.reviewToken);assert.ok(!beforeReview.fields.skills.includes('React'));assert.ok(!('verifiedGrade' in beforeReview.fields));
 await api(`/${uploaded.id}`,a.cookie,'DELETE');assert.deepEqual(await read(first.id),initial);pass('upload/review-required/foreign-draft/cancel do not mutate CV');
 const upload2=await create();let review=await api(`/${upload2.id}`,a.cookie);
 await pool.query(`UPDATE signal_candidate_resumes SET summary='Concurrent edit',revision=revision+1 WHERE id=$1`,[first.id]);
 await api(`/${upload2.id}/apply`,a.cookie,'POST',{revision:review.revision,reviewToken:review.reviewToken,fields:['summary']},409);
 assert.equal((await read(first.id)).summary,'Concurrent edit');
 await api(`/${upload2.id}/refresh`,a.cookie,'POST',{revision:review.revision});
 review=await api(`/${upload2.id}`,a.cookie);assert.equal(review.conflict,false);assert.equal(review.diff[0].before,'Concurrent edit');
 const apply={revision:review.revision,reviewToken:review.reviewToken,fields:['skills']};const saved=await api(`/${upload2.id}/apply`,a.cookie,'POST',apply);const repeated=await api(`/${upload2.id}/apply`,a.cookie,'POST',apply);assert.equal(saved.revision,repeated.revision);
 const actual=await read(first.id);assert.equal(actual.summary,'Concurrent edit');assert.ok(actual.skills.includes('Redis'));assert.equal(actual.verified_grade,'Middle');assert.deepEqual(actual.verified_skills,['Python']);assert.deepEqual(await read(second.id),second);
 pass('concurrent CV conflict/new review/exact-field apply/idempotency/other CV and proofs preserved');
 const bad=await api('',a.cookie,'POST',{resumeId:first.id,revision:actual.revision,data:Buffer.from('%PDF-broken').toString('base64')},422);assert.ok(bad.code);assert.deepEqual(await read(first.id),actual);
 const scan=await api('',a.cookie,'POST',{resumeId:first.id,revision:actual.revision,data:(await pdfFixture('scan')).toString('base64')},201);const scanReview=await api(`/${scan.id}`,a.cookie);assert.ok(scanReview.warnings.includes('NO_VISIBLE_TEXT'));assert.equal(scanReview.fragments.length,0);await api(`/${scan.id}/apply`,a.cookie,'POST',{revision:scanReview.revision,reviewToken:scanReview.reviewToken,fields:['skills']},422);await api(`/${scan.id}`,a.cookie,'DELETE');
 pass('damaged PDF and scan have controlled outcomes without active mutations');
 const limited=await user(),limitedCv=await cv(limited.id,'Rate test');await pool.query('insert into signal_pdf_import_receipts(id,user_id) select gen_random_uuid(),$1 from generate_series(1,9)',[limited.id]);
 const responses=await Promise.all(Array.from({length:2},()=>fetch(`${apiBase}/me/pdf-import`,{method:'POST',headers:{Cookie:limited.cookie,'Content-Type':'application/json'},body:JSON.stringify({resumeId:limitedCv.id,revision:limitedCv.revision,data:Buffer.from('%PDF-broken').toString('base64')})})));assert.deepEqual(responses.map(r=>r.status).sort(),[422,429]);assert.equal((await pool.query('select count(*)::int n from signal_pdf_import_receipts where user_id=$1',[limited.id])).rows[0].n,10);pass('concurrent uploads reserve last hourly processing unit before extraction, including invalid document attempts');
 writeFileSync(new URL('../../pdf-import-integration.json',import.meta.url),JSON.stringify({status:'passed',checks,at:new Date().toISOString()},null,2));
}finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
