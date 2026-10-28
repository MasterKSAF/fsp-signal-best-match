import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {eq} from 'drizzle-orm';
import {db,pool,signalUsersTable as users} from '../lib/db/src/index';
import {assertOwnDatabase,qaUser,qaNeed} from './competitive-fixtures';
import {registerAtsEndpoint,disableAtsEndpoint,retryOutboxDelivery,claimOutboxDelivery,deliverClaimedOutbox,receiveWebhook} from '../artifacts/api-server/src/lib/ats-outbox';
import {validateWebhookEndpoint,sendWebhook,webhookSignature} from '../artifacts/api-server/src/lib/webhook-transport';
assertOwnDatabase();process.env.NODE_ENV='test';process.env.DEMO_MODE='true';process.env.SIGNAL_ATS_LOCAL_TEST='true';process.env.SIGNAL_ATS_ENCRYPTION_KEY=randomBytes(32).toString('base64');
let mode=500,calls=0,trapCalls=0;
const receiver=createServer((req,res)=>{if(req.url==='/trap')trapCalls++;else calls++;req.resume();res.writeHead(mode,mode===302?{Location:'/trap'}:{});res.end();});
receiver.listen(0,'127.0.0.1');await new Promise<void>(r=>receiver.once('listening',r));const port=(receiver.address() as {port:number}).port;process.env.SIGNAL_ATS_LOCAL_TEST_PORT=String(port);
const {default:app}=await import('../artifacts/api-server/src/app');const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS',s);};
async function api(path:string,cookie:string,body?:unknown,method=body===undefined?'GET':'POST'){const r=await fetch(base+path,{method,headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};}
try{
 const own=await qaUser('employer'),foreign=await qaUser('employer'),candidate=await qaUser(),need=await qaNeed(own.companyId!),[user]=await db.select().from(users).where(eq(users.id,own.id)),[other]=await db.select().from(users).where(eq(users.id,foreign.id));
 const endpoint=await registerAtsEndpoint(user,`http://127.0.0.1:${port}/events`);
 const visible=await api('/employer/ats',own.cookie);assert.equal(visible.status,200);assert.equal(visible.data.endpoint.id,endpoint.id);assert.ok(!JSON.stringify(visible.data).includes(endpoint.secret));assert.equal((await api('/employer/ats',foreign.cookie)).data.endpoint,null);assert.equal((await api('/employer/ats',candidate.cookie)).status,403);
 assert.equal((await api(`/employer/ats/${endpoint.id}/disable`,foreign.cookie,{revision:1})).status,409);
 const invitation=(await pool.query("insert into signal_invitations(need_id,company_id,candidate_user_id,resume_id,title,message,reason,salary_min,salary_max,salary_period,salary_type,work_format) values($1,$2,$3,$4,'QA','QA','QA',100000,200000,'month','gross','Удалённо') returning id",[need.id,own.companyId,candidate.id,candidate.resumeId])).rows[0];
 let deliveryId='';for(let i=0;i<5;i++){await pool.query('update signal_outbox_deliveries set next_at=now() where endpoint_id=$1 and state=\'queued\'',[endpoint.id]);const claim=await claimOutboxDelivery(endpoint.id);assert.ok(claim);deliveryId=claim.id;await deliverClaimedOutbox(claim);}
 let delivery=(await pool.query('select * from signal_outbox_deliveries where id=$1',[deliveryId])).rows[0];assert.equal(delivery.state,'dead');assert.equal(delivery.attempts,5);assert.equal(calls,5);await assert.rejects(()=>retryOutboxDelivery(other,deliveryId));
 assert.equal((await api(`/employer/ats/deliveries/${deliveryId}/retry`,own.cookie,{})).status,200);mode=200;const retried=await claimOutboxDelivery(endpoint.id);assert.ok(retried);await deliverClaimedOutbox(retried);assert.equal((await pool.query('select state from signal_outbox_deliveries where id=$1',[deliveryId])).rows[0].state,'delivered');pass('actual HTTP500 retries exhaust at five; owner manual retry delivers, foreign tenant and candidate denied, secret absent from read DTO');
 await pool.query("update signal_invitations set status='viewed' where id=$1",[invitation.id]);const revoked=await claimOutboxDelivery(endpoint.id);assert.ok(revoked);await disableAtsEndpoint(user,endpoint.id,1);const before=calls;await deliverClaimedOutbox(revoked);assert.equal(calls,before);assert.equal((await pool.query('select state from signal_outbox_deliveries where id=$1',[revoked.id])).rows[0].state,'suppressed');assert.equal((await api(`/employer/ats/deliveries/${revoked.id}/retry`,own.cookie,{})).status,404);pass('disable after claim prevents network send; disabled endpoint cannot be manually retried');
 mode=302;assert.equal(await sendWebhook(`http://127.0.0.1:${port}/events`,endpoint.secret,randomUUID(),Buffer.from('{}')),302);assert.equal(trapCalls,0);
 let resolutions=0;const resolver=async()=>{resolutions++;return [{address:resolutions===1?'8.8.8.8':'127.0.0.1',family:4}] as any;};await validateWebhookEndpoint('https://example.test/events',resolver);await assert.rejects(()=>validateWebhookEndpoint('https://example.test/events',resolver));assert.equal(resolutions,2);pass('actual redirect is returned without following target; per-delivery DNS revalidation rejects changed private answer (controlled resolver)');
 const wire={schema:'signal-ats-event-v1',id:randomUUID(),type:'invitation.status_changed',tenant:own.companyId,entity:{type:'invitation',id:invitation.id,version:'900000'},occurredAt:new Date().toISOString(),data:{status:'viewed',contextType:'need',contextId:need.id,resumeId:candidate.resumeId}},raw=Buffer.from(JSON.stringify(wire)),timestamp=String(Math.floor(Date.now()/1000)),headers={timestamp,eventId:wire.id,signature:webhookSignature(endpoint.secret,timestamp,wire.id,raw)};
 await assert.rejects(()=>receiveWebhook(raw,headers,endpoint.secret,foreign.companyId!));
 // An unavailable durable inbox must fail before acknowledgement, never use an in-memory fallback.
 await pool.query('alter table signal_webhook_inbox rename to signal_webhook_inbox_qa_unavailable');try{await assert.rejects(()=>receiveWebhook(raw,headers,endpoint.secret,own.companyId!));}finally{await pool.query('alter table signal_webhook_inbox_qa_unavailable rename to signal_webhook_inbox');}
 assert.equal((await receiveWebhook(raw,headers,endpoint.secret,own.companyId!)).applied,true);assert.equal((await receiveWebhook(raw,headers,endpoint.secret,own.companyId!)).duplicate,true);pass('wrong receiver tenant denied; actual missing inbox fails closed, storage restoration accepts once with durable dedup');
 writeFileSync('../outbox-edges.json',JSON.stringify({status:'passed',synthetic:true,checks,at:new Date().toISOString()},null,2));
}finally{await new Promise<void>(r=>server.close(()=>r()));await new Promise<void>(r=>receiver.close(()=>r()));await pool.end();}
