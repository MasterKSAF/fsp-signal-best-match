import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const env=Object.fromEntries((await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008.env','utf8')).split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
const dbUrl=new URL(env.DATABASE_URL);assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'55435');assert.equal(dbUrl.pathname,'/signal_employer_e_20261008');
const files=['C:/Users/Misha/.codex/private/signal-employer-e-20261008-fixtures.json',
  'C:/Users/Misha/.codex/private/signal-employer-e-20261008-http-de9d2537-1ac6-45a1-bff1-082205deca20.json',
  'C:/Users/Misha/.codex/private/signal-employer-e-20261008-selection-d7fae22a-1654-481c-8df8-277f494d8aae.json'];
const pool=new pg.Pool({connectionString:env.DATABASE_URL}),checks=[];
try{
  for(const file of files){const ledger=JSON.parse(await readFile(file,'utf8'));
    for(const actor of ledger.actors){
      const [row]=(await pool.query('SELECT email FROM signal_users WHERE id=$1 AND demo_mode=false',[actor.id])).rows;
      assert.equal(row.email.toLowerCase(),actor.email.toLowerCase(),'Only exact owned ordinary fixture may be repaired');
      await pool.query('UPDATE signal_users SET email=$1 WHERE id=$2 AND email=$3',[actor.email.toLowerCase(),actor.id,row.email]);actor.email=actor.email.toLowerCase();
    }
    await writeFile(file,JSON.stringify(ledger,null,2));
    for(const actor of ledger.actors){
      const response=await fetch('http://localhost:4413/api/auth/login',{method:'POST',headers:{Origin:'http://signal-employer.localhost:4414','Content-Type':'application/json'},body:JSON.stringify({email:actor.email,password:actor.password}),signal:AbortSignal.timeout(20000)});
      assert.equal(response.status,200,`Own fixture ${actor.id} must log in normally`);const result=await response.json();assert.equal(result.user.id,actor.id);checks.push({actorId:actor.id,role:actor.role,status:200});
    }
  }
  await writeFile('outputs/verification/employer-workspace-E01-E16-20261008/backend/fixture-login-repair.json',JSON.stringify({passed:true,fixtureOnly:true,reason:'Owned SQL fixture omitted lowercase email normalization required by existing login',checkedActors:checks,productAuthUnchanged:true,measuredAt:new Date().toISOString()},null,2),{flag:'wx'});
  console.log(JSON.stringify({passed:true,checkedActors:checks.length,fixtureOnly:true}));
}finally{await pool.end();}
