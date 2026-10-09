import test from 'node:test';
import assert from 'node:assert/strict';
import {PgDialect} from '../lib/db/node_modules/drizzle-orm/pg-core/index.js';
process.env.DATABASE_URL??='postgresql://unused:unused@127.0.0.1:1/never_connect';
test('N19 scheduler advances past every ineligible row with microsecond timestamps and ties across pages',async()=>{
 const {db}=await import('../lib/db/src/index');const {runMicrotaskScheduler}=await import('../artifacts/api-server/src/lib/microtask-scheduler');
 const dialect=new PgDialect();let pages=0;const processed:number[]=[];
 const rows=Array.from({length:205},(_,index)=>({id:index+1,userId:index+1000,nextDueAt:new Date('2026-10-09T20:25:04.826Z'),cursorTime:`2026-10-09 20:25:04.${String(826001+Math.floor(index/4)).padStart(6,'0')}+00`}));
 const original={select:db.select,update:db.update,transaction:db.transaction};
 (db as any).update=()=>({set(){return {where(){return Promise.resolve([]);}};}});
 const normalize=(value:string)=>value.replace('T',' ').replace('Z','+00').replace(/\.(\d+)(?=\+)/,(_,fraction)=>'.'+fraction.padEnd(6,'0'));
 (db as any).select=(fields:any)=>{
  let condition:any;
  const chain:any={from(){return chain;},where(value:any){condition=value;return chain;},orderBy(){return chain;},limit(size:number){
   assert.ok(++pages<=5,'bounded pages: cursor must not repeat the last ineligible row');
   assert.ok(fields.cursorTime,'select preserves exact PostgreSQL timestamp');
   const {params}=dialect.sqlToQuery(condition);const timestamps=params.filter(value=>typeof value==='string'&&/^2026-10-09[ T]20:25:04\./.test(value)) as string[];
   let candidates=rows;
   if(pages>1){assert.equal(timestamps.length,2);assert.match(timestamps[0],/\.\d{6}\+00$/,'cursor must preserve all six fractional digits');const cursor=normalize(timestamps[0]);const id=params.find(value=>typeof value==='number') as number;
    candidates=rows.filter(row=>row.cursorTime>cursor||(row.cursorTime===cursor&&row.id>id));}
   const page=candidates.slice(0,size);processed.push(...page.map(row=>row.id));return Promise.resolve(page);
  }};return chain;
 };
 // Every subscription is intentionally ineligible; no row mutation advances the
 // cursor for the algorithm. This is the legacy/closed-job scheduler path.
 (db as any).transaction=async()=>0;
 try{const result=await runMicrotaskScheduler(new Date('2026-10-09T21:00:00Z'));assert.equal(result.created,0);assert.equal(result.checked,205);assert.equal(pages,4);assert.deepEqual(processed,rows.map(row=>row.id));}
 finally{Object.assign(db,original);}
});
