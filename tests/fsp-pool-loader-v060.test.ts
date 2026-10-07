import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fspConsentVersion,fspDemoFixtureId,fspRegistryProvider} from '../artifacts/api-server/src/lib/fsp-provider';
const requireApi=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {PgDialect}=requireApi('drizzle-orm/pg-core'),dialect=new PgDialect();
let modulePromise:Promise<typeof import('../artifacts/api-server/src/lib/signal-resume-matching')>|undefined;
async function loader(){process.env.DATABASE_URL='postgresql://unit_only:unused@127.0.0.1:1/unit_mock_never_connect';return modulePromise??=import('../artifacts/api-server/src/lib/signal-resume-matching');}
function reader(data:unknown){const captures:{projection:string;from:string;predicate:string}[]=[];return {captures,select(fields:any){const projection=dialect.sqlToQuery(fields.data).sql;return {from(from:any){return {async where(where:any){captures.push({projection,from:dialect.sqlToQuery(from).sql,predicate:dialect.sqlToQuery(where).sql});return [{data}];}};}};}};}
test('actual loader projection joins complete current FSP facts but strips identity/raw ledger before any professional view',async()=>{
  const prior=process.env.DEMO_MODE;process.env.DEMO_MODE='true';
  try {
    const provider=await fspRegistryProvider.resolve(fspDemoFixtureId,{accountIsDemo:true,demoEnabled:true});
    const connection={fsp_id:fspDemoFixtureId,status:provider.status,consent_version:fspConsentVersion,consented_at:'2026-10-07T12:00:00Z',verified_at:'2026-10-07T12:00:00Z',revoked_at:null,provenance:provider.provenance,provider_version:provider.providerVersion,achievements:provider.achievements};
    const base={userId:1,resumeId:11,resumeRevision:1,title:'Synthetic',alias:'A',specialization:'Backend / Python',verifiedGrade:'Middle',verifiedScore:100,verifiedSkills:['Python'],stack:[],statedSkills:[],workFormat:'Удалённо',salaryMin:null,salaryMax:null,salaryPeriod:'month',salaryType:'gross',latestAssessmentAt:null,hasFspHistory:true,visibility:'pseudonymous',consentMatching:true,consentCatalog:true,readyForOffers:false,demoMode:true,reviewScopeId:null,deletedAt:null,legacyQualification:null,yearsExperience:0,hasAccessiblePhoto:false,avatarDataUrl:null,publicName:null,fspConnection:connection};
    const api=await loader(),query=reader(base),[loaded]=await api.loadResumeCandidates({demoMode:true,reviewScopeId:null},{purpose:'catalog'},query as any);
    assert.equal(loaded!.fspSignal!.bonus,3);assert.equal(loaded!.hasFspHistory,true);assert.equal('note' in loaded!.fspSignal!,false);assert.equal('fspConnection' in loaded!,false);assert.equal(JSON.stringify(loaded).includes(fspDemoFixtureId),false);
    assert.match(query.captures[0]!.from,/left join "signal_fsp_connections"/);assert.match(query.captures[0]!.projection,/to_jsonb\("signal_fsp_connections"\)/);
    const fingerprint=dialect.sqlToQuery(api.resumePoolFingerprintExpression()).sql;assert.match(fingerprint,/to_jsonb\("signal_fsp_connections"\)/,'Fresh full ledger contents are a hash input, not a revision/TTL shortcut');
    for(const patch of [{revoked_at:'2026-10-07T12:01:00Z'},{consented_at:null},{provider_version:'forged'},{achievements:[]},{status:'pending'},{provenance:'user_supplied'}]){const [changed]=await api.loadResumeCandidates(true,{purpose:'matching'},reader({...base,fspConnection:{...connection,...patch}}) as any);assert.equal(changed!.fspSignal!.bonus,0);assert.equal(changed!.hasFspHistory,false);}
    for(const patch of [{demoMode:false},{fspConnection:null}]){const [changed]=await api.loadResumeCandidates(false,{purpose:'matching'},reader({...base,...patch}) as any);assert.equal(changed!.fspSignal?.bonus??0,0);}
    process.env.DEMO_MODE='false';const [disabled]=await api.loadResumeCandidates(true,{purpose:'matching'},reader(base) as any);assert.equal(disabled!.fspSignal!.bonus,0);
  }finally{if(prior===undefined)delete process.env.DEMO_MODE;else process.env.DEMO_MODE=prior;}
});
