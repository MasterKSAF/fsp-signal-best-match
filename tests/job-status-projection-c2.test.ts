import test from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig } from '../lib/db/node_modules/drizzle-orm/pg-core/index.js';
import { REQUIREMENTS_VERSION } from '../artifacts/api-server/src/lib/recruiting-requirements';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/never_connect';

test('C2 actual status handler preserves saved mixed policies, legacy interpretation and version semantics across every transition',async()=>{
  const {db}=await import('../lib/db/src/index');
  const {default:router}=await import('../artifacts/api-server/src/routes/signal-jobs');
  const layer=router.stack.find((item:any)=>item.route?.path==='/employer/jobs/:id/status'&&item.route.methods.post);
  assert.ok(layer);
  const at=new Date('2026-10-09T12:00:00Z');
  const company={id:12,ownerUserId:72,name:'C2 synthetic'};
  const original={id:91,companyId:12,title:'C2 job',description:'Synthetic status projection regression fixture',specialization:'Backend / Python',grade:'Middle',gradeMode:'declared_or_verified',skills:['Python','PostgreSQL'],
    workFormat:'Удалённо',salaryMin:150000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross',status:'draft',version:4,publishedAt:null,updatedAt:at,deletedAt:null};
  let job:any,details:any,updates=0,detailsReads=0;
  let insideTransaction=false;
  const saved={select:db.select,update:db.update,delete:db.delete,transaction:db.transaction};
  const priorWorkspace=process.env.SIGNAL_WORKSPACE_ENABLED;process.env.SIGNAL_WORKSPACE_ENABLED='true';
  const read=(table:string)=>{
    switch(table){
      case 'signal_sessions':return [{user:{id:72,role:'employer',emailVerified:true,demoMode:false,reviewScopeId:null},demoMode:false,reviewScopeId:null,expiresAt:new Date(Date.now()+60000)}];
      case 'signal_companies':return [company];
      case 'signal_jobs':return [job];
      case 'signal_job_requirements':assert.equal(insideTransaction,true,'metadata belongs to the same locked job state');detailsReads++;return details?[details]:[];
      case 'signal_micro_templates':return [{total:0}];
      case 'signal_employer_restrictions':return [];
      default:throw new Error(`Unexpected read ${table}`);
    }
  };
  (db as any).select=()=>{
    let table='';
    const chain:any={from(value:any){table=getTableConfig(value).name;return chain;},innerJoin(){return chain;},where(){return chain;},limit(){return chain;},for(){return chain;},then(resolve:any,reject:any){return Promise.resolve(read(table)).then(resolve,reject);}};return chain;
  };
  (db as any).update=(table:any)=>{
    assert.equal(getTableConfig(table).name,'signal_jobs');let patch:any;
    const chain:any={set(value:any){patch=value;return chain;},where(){return chain;},returning(){updates++;job={...job,...patch};return Promise.resolve([job]);}};return chain;
  };
  (db as any).delete=(table:any)=>{assert.equal(getTableConfig(table).name,'signal_shortlist');return {where(){return Promise.resolve([]);}};};
  (db as any).transaction=async(callback:any)=>{assert.equal(insideTransaction,false);insideTransaction=true;try{return await callback(db);}finally{insideTransaction=false;}};
  async function status(next:string,version=job.version){
    let statusCode=200,payload:any;
    const response:any={status(code:number){statusCode=code;return response;},json(value:any){payload=value;return response;}};
    await layer.route.stack[0].handle({params:{id:'91'},cookies:{fsp_signal_session:'a'.repeat(43)},body:{status:next,version}},response);
    return {statusCode,payload};
  }
  const transitions=[['draft','published'],['draft','archived'],['published','closed'],['closed','published'],['closed','archived'],['published','published'],['closed','closed'],['archived','archived']];
  try{
    for(const [from,to] of transitions){
      job={...original,status:from};details={jobId:job.id,location:'Казань',skillRequirements:[{skill:'Python',mode:'verified',level:'Middle'},{skill:'PostgreSQL',mode:'declared_or_verified'}]};
      const savedDetails=structuredClone(details),previousUpdates=updates,previousReads=detailsReads;
      const result=await status(to);assert.equal(result.statusCode,200,`${from}->${to}`);
      assert.deepEqual(result.payload.skillRequirements,savedDetails.skillRequirements,`${from}->${to} retains exact skill mode and level`);
      assert.equal(result.payload.gradeMode,'declared_or_verified');assert.equal(result.payload.requirementsVersion,REQUIREMENTS_VERSION);assert.equal(result.payload.location,'Казань');
      assert.equal(result.payload.status,to);assert.equal(result.payload.version,original.version+(from===to?0:1));
      assert.equal(updates-previousUpdates,from===to?0:1);assert.equal(detailsReads-previousReads,1);assert.deepEqual(details,savedDetails,'status does not write requirements');
      const version=job.version;const repeat=await status(to);assert.equal(repeat.statusCode,200);assert.equal(repeat.payload.version,version);assert.deepEqual(repeat.payload.skillRequirements,savedDetails.skillRequirements);
    }
    job={...original,status:'draft',gradeMode:'verified'};details={jobId:job.id,location:'',skillRequirements:[{skill:'Python',level:'Middle'}]};
    assert.deepEqual((await status('published')).payload.skillRequirements,[{skill:'Python',mode:'verified',level:'Middle'},{skill:'PostgreSQL',mode:'verified'}],'legacy missing modes remain verified and explicit old level survives');
    assert.deepEqual(details.skillRequirements,[{skill:'Python',level:'Middle'}],'legacy stored data is not rewritten');
    job={...original,status:'draft',gradeMode:'verified'};details=null;
    const legacy=await status('published');assert.deepEqual(legacy.payload.skillRequirements,[{skill:'Python',mode:'verified'},{skill:'PostgreSQL',mode:'verified'}]);assert.equal(legacy.payload.gradeMode,'verified');
    const readsBefore=detailsReads,writesBefore=updates,current=structuredClone(job);
    assert.equal((await status('closed',job.version-1)).statusCode,409);assert.deepEqual(job,current);assert.equal(detailsReads,readsBefore);assert.equal(updates,writesBefore);
    job={...original,status:'archived'};assert.equal((await status('published')).statusCode,409);assert.equal(detailsReads,readsBefore);assert.equal(updates,writesBefore);
    process.env.SIGNAL_WORKSPACE_ENABLED='false';job={...original,status:'draft',gradeMode:'verified'};
    const disabled=await status('published');assert.equal(disabled.statusCode,200);assert.equal(detailsReads,readsBefore);assert.deepEqual(disabled.payload.skillRequirements,[{skill:'Python',mode:'verified'},{skill:'PostgreSQL',mode:'verified'}]);
  }finally{Object.assign(db,saved);if(priorWorkspace===undefined)delete process.env.SIGNAL_WORKSPACE_ENABLED;else process.env.SIGNAL_WORKSPACE_ENABLED=priorWorkspace;}
});
