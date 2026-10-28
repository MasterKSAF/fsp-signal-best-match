/** Dedicated loopback QA server. Local transport exception remains impossible outside NODE_ENV=test. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createDecipheriv} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pool} from '../lib/db/src/index';
import {assertOwnDatabase} from './competitive-fixtures';
import {receiveWebhook} from '../artifacts/api-server/src/lib/ats-outbox';
assertOwnDatabase();assert.equal(process.env.NODE_ENV,'test');
process.env.SIGNAL_ATS_LOCAL_TEST='true';process.env.SIGNAL_ATS_LOCAL_TEST_PORT='4490';
const state=JSON.parse(readFileSync(new URL('../../browser-employer-b1-fixtures.json',import.meta.url),'utf8'));
const records:{eventId:string;status:number;deduplicated:boolean}[]=[];
const receiver=createServer(async(req,res)=>{
 try{
  const chunks:Buffer[]=[];for await(const chunk of req){chunks.push(Buffer.from(chunk));if(chunks.reduce((n,b)=>n+b.length,0)>16000)throw new Error('limit');}const raw=Buffer.concat(chunks);
  const mode=JSON.parse(readFileSync(new URL('../../browser-employer-b1-receiver-mode.json',import.meta.url),'utf8')).status;
  let duplicate=false;
  if(mode===200){const endpoint=(await pool.query('SELECT secret_cipher FROM signal_ats_endpoints WHERE company_id=$1',[state.employer.companyId])).rows[0];const bytes=Buffer.from(endpoint.secret_cipher,'base64'),decipher=createDecipheriv('aes-256-gcm',Buffer.from(process.env.SIGNAL_ATS_ENCRYPTION_KEY!,'base64'),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));const secret=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
   const result=await receiveWebhook(raw,{timestamp:String(req.headers['x-signal-timestamp']),eventId:String(req.headers['x-signal-id']),signature:String(req.headers['x-signal-signature'])},secret,state.employer.companyId);duplicate=result.duplicate;
  }
  records.push({eventId:String(req.headers['x-signal-id']),status:mode,deduplicated:duplicate});writeFileSync(new URL('../../browser-employer-b1-receiver.json',import.meta.url),JSON.stringify({records},null,2));res.writeHead(mode);res.end();
 }catch{res.writeHead(400);res.end();}
});
writeFileSync(new URL('../../browser-employer-b1-receiver-mode.json',import.meta.url),JSON.stringify({status:500}));
await new Promise<void>(r=>receiver.listen(4490,'127.0.0.1',r));
const {default:app}=await import('../artifacts/api-server/src/app');app.listen(4480,'127.0.0.1',()=>console.log('B1 QA HTTP4480 / local signed receiver4490; automatic external workers disabled'));
