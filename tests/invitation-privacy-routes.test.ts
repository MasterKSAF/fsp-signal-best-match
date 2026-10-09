import test from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig } from '../lib/db/node_modules/drizzle-orm/pg-core/index.js';
import { snapshotForNeed } from '../artifacts/api-server/src/lib/assessment-context';

// Execute the actual Express handlers against a bounded in-memory reader. No
// server, runtime or database is started or modified by this regression test.
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/never_connect';

test('all candidate invitation responses and historical assessment contexts use the safe projection; employer history retains its snapshot',async()=>{
  const {db}=await import('../lib/db/src/index');
  const [{default:invitations},{default:assessments}]=await Promise.all([
    import('../artifacts/api-server/src/routes/signal-invitations'),
    import('../artifacts/api-server/src/routes/signal-assessment-context'),
  ]);
  const privateTitle='INTERNAL-TITLE-route-fixture';
  const privateDescription='INTERNAL-DESCRIPTION-route-fixture';
  const at=new Date('2026-10-09T00:00:00Z');
  const need={id:41,companyId:32,revision:2,title:privateTitle,description:privateDescription,specialization:'Backend / Python',
    grade:'Middle' as const,requiredSkills:['Python',privateDescription],desirableSkills:[],workFormat:'Удалённо',
    salaryMin:150000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross',status:'active',updatedAt:at,deletedAt:null};
  const company={id:32,ownerUserId:303,name:'Вектор',description:'Продукты для бизнеса',industry:'ИТ',
    contactEmail:'hr@example.test',contactPhone:null,contactMethod:'Электронная почта',inn:'PRIVATE-INN'};
  const snapshot={...need,type:'need',version:2,shortlist:[{name:privateDescription}]};
  let row={id:16,companyId:32,candidateUserId:301,needId:41,jobId:null,contextVersion:2,contextSnapshot:snapshot,
    resumeId:287,resumeSnapshot:null,title:'Приглашение в команду',message:'Давайте обсудим работу',reason:'Ваш опыт подходит',
    salaryMin:150000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо',status:'sent',createdAt:at,updatedAt:at};
  const assessmentSnapshot={...snapshotForNeed(need),needId:41,companyId:32};
  const immutableHistory=JSON.stringify({snapshot,assessmentSnapshot});
  let role:'candidate'|'employer'='candidate';
  let repeats=false;
  const saved={select:db.select,update:db.update,transaction:db.transaction};
  const read=(table:string,fields?:Record<string,unknown>)=>{
    switch(table){
      case 'signal_sessions':return [{user:{id:role==='candidate'?301:303,role,emailVerified:true,demoMode:false,reviewScopeId:null},
        demoMode:false,reviewScopeId:null,expiresAt:new Date(Date.now()+60000)}];
      case 'signal_companies':return [company];
      case 'signal_candidate_profiles':return [{alias:'Кандидат'}];
      case 'signal_invitations':return fields?.total ? [{total:1}] : fields?.invitation ? [{invitation:row}]
        : fields?.need ? [{id:row.id,need}] : [row];
      case 'signal_needs':return [need];
      case 'signal_assessment_attempts':return [{id:19,snapshot:assessmentSnapshot}];
      case 'signal_contact_grants':case 'signal_company_blocks':case 'signal_employer_restrictions':case 'signal_need_skill_levels':return [];
      default:throw new Error(`Unexpected database read: ${table}`);
    }
  };
  (db as any).select=(fields?:Record<string,unknown>)=>{
    let table='';
    const chain:any={from(value:any){table=getTableConfig(value).name;return chain;},
      innerJoin(){return chain;},leftJoin(){return chain;},where(){return chain;},limit(){return chain;},
      offset(){return chain;},orderBy(){return chain;},for(){return chain;},
      then(resolve:any,reject:any){return Promise.resolve(read(table,fields)).then(resolve,reject);}};
    return chain;
  };
  (db as any).update=()=>{
    let patch:Partial<typeof row>={};
    const chain:any={set(value:Partial<typeof row>){patch=value;return chain;},where(){return chain;},
      returning(){if(repeats)return Promise.resolve([]);row={...row,...patch};return Promise.resolve([row]);}};
    return chain;
  };
  (db as any).transaction=async(callback:(reader:typeof db)=>Promise<unknown>)=>callback(db);
  async function request(router:any,path:string,method:'get'|'post',body:Record<string,unknown>={},query:Record<string,unknown>={}){
    const layer=router.stack.find((item:any)=>item.route?.path===path&&item.route.methods[method]);
    assert.ok(layer,`${method} ${path}`);
    let status=200,result:unknown;
    const response:any={status(value:number){status=value;return response;},setHeader(){},json(value:unknown){result=value;return response;}};
    const req:any={params:{id:'16'},query,body,cookies:{fsp_signal_session:'a'.repeat(43)}};
    await layer.route.stack[0].handle(req,response);
    assert.equal(status,200,`${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  }
  try{
    for(const [path,method,body] of [
      ['/me/invitations','get',{}],['/me/invitations/search','get',{}],['/me/invitations/:id','get',{}],
      ['/me/invitations/:id/view','post',{}],['/me/invitations/:id/decision','post',{decision:'decline'}],
    ] as const){
      const payload=await request(invitations,path,method,body);
      const serialized=JSON.stringify(payload);
      for(const marker of [privateTitle,privateDescription,'PRIVATE-INN','ownerUserId'])assert.equal(serialized.includes(marker),false,path);
      assert.equal(serialized.includes('Продукты для бизнеса'),true,'public company is available before accepting');
    }
    repeats=true;
    for(const [path,body] of [['/me/invitations/:id/view',{}],['/me/invitations/:id/decision',{decision:'decline'}]] as const){
      assert.equal(JSON.stringify(await request(invitations,path,'post',body)).includes(privateTitle),false,'idempotent response');
    }
    for(const path of ['/assessments/contexts','/assessments/attempts/:id/context']){
      const text=JSON.stringify(await request(assessments,path,'get',{}, {programId:'backend-python'}));
      for(const marker of [privateTitle,privateDescription])assert.equal(text.includes(marker),false,path);
    }
    role='employer';
    const owner=JSON.stringify(await request(invitations,'/employer/invitations','get'));
    assert.equal(owner.includes(privateTitle),true);assert.equal(owner.includes(privateDescription),true);
    assert.equal(JSON.stringify({snapshot,assessmentSnapshot}),immutableHistory);
  }finally{Object.assign(db,saved);}
});
