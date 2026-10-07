/** Read-only behavior examples, not a new ranking formula or relevance benchmark. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { evaluateMatch, rankMatches, compareRankedMatches, MATCH_ALGORITHM_VERSION, type MatchNeed, type MatchCandidate } from "../artifacts/api-server/src/lib/signal-matching.ts";
const sourcePath="artifacts/api-server/src/lib/signal-matching.ts", sha=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
const original=await readFile(sourcePath),at=new Date("2026-10-06T12:00:00.000Z");
const need:MatchNeed={specialization:"Backend / Python",grade:"Junior",requiredSkills:["Python"],desirableSkills:["PostgreSQL"],workFormat:"Удалённо",salaryMin:100000,salaryMax:200000,salaryPeriod:"month",salaryType:"gross"};
function candidate(id:number,alias:string,score:number,grade:"Junior"|"Middle"|"Senior"="Middle",version="signal-backend-python-v6",fsp=false,fields:Partial<MatchCandidate>={}):MatchCandidate {
  const c:MatchCandidate={userId:id,alias,specialization:"Backend / Python",verifiedGrade:grade,verifiedScore:score,verifiedSkills:["Python","PostgreSQL"],stack:[],statedSkills:[],workFormat:"Удалённо",salaryMin:120000,salaryMax:180000,salaryPeriod:"month",salaryType:"gross",latestAssessmentAt:at,hasFspHistory:fsp,visibility:"pseudonymous",consentMatching:true,demoMode:false,...fields};
  c.assessmentEvidence={attemptId:10000+id,candidateId:id,programId:"backend-python",programVersion:version,grade,score,submittedAt:at.toISOString(),state:"verified",comparisonPolicy:"same-program-version-rubric-v1",rubricKey:"synthetic-observation-rubric"};
  return c;
}
const examples=[
  {id:"same-category-same-cohort",question:"Same category and comparable cohort, equal raw quality; FSP resolves a tie.",people:[candidate(1,"A no FSP",83),candidate(2,"Z FSP",83,"Middle",undefined,true)],expected:[2,1],expectedWithoutFsp:[1,2]},
  {id:"different-grades-same-fit",question:"Different categories (Middle/Senior), equal fit; FSP currently selects the Middle queue head before Senior.",people:[candidate(3,"A Senior",100,"Senior"),candidate(4,"Z Middle FSP",83,"Middle",undefined,true)],expected:[4,3],expectedWithoutFsp:[3,4]},
  {id:"same-category-different-versions",question:"One category, different comparable cohorts; FSP currently affects the merge, without comparing 83 to 100 across versions.",people:[candidate(5,"A current no FSP",100),candidate(6,"Z older FSP",83,"Middle","signal-backend-python-v5",true)],expected:[6,5],expectedWithoutFsp:[5,6]},
  {id:"quality-margin-inside-cohort",question:"The bounded local +3 cannot make comparable 83 beat comparable 100.",people:[candidate(7,"Z no FSP 100",100),candidate(8,"A FSP 83",83,"Middle",undefined,true)],expected:[7,8],expectedWithoutFsp:[7,8]},
  {id:"stronger-fit-no-fsp",question:"FSP never overtakes stronger common need-fit.",people:[candidate(9,"Z full fit no FSP",83),candidate(10,"A lower fit FSP",100,"Senior",undefined,true,{workFormat:"Офис"})],expected:[9,10],expectedWithoutFsp:[9,10]},
  {id:"no-fsp-admission",question:"A candidate without FSP remains admitted and can rank first by comparable quality.",people:[candidate(11,"Z no FSP",100),candidate(12,"A no FSP",83)],expected:[11,12],expectedWithoutFsp:[11,12]},
  {id:"fsp-cannot-supply-grade",question:"FSP does not supply a missing confirmed grade or required skill.",people:[candidate(13,"A unconfirmed FSP",100,"Middle",undefined,true,{verifiedGrade:null}),candidate(14,"Z confirmed no FSP",83)],expected:[14],expectedWithoutFsp:[14]},
];
function rank(people:MatchCandidate[]){return rankMatches(people.map(c=>({candidate:c,evaluation:evaluateMatch(need,c,false,at)})).filter(e=>e.evaluation.eligible));}
function facts(people:MatchCandidate[]){return people.map(c=>{const e=evaluateMatch(need,c,false,at);return {id:c.userId,alias:c.alias,category:[c.specialization,c.verifiedGrade],cohort:e.ranking.groupId,fsp:c.hasFspHistory,eligible:e.eligible,ineligibilityReasons:e.ineligibilityReasons,businessFit:e.ranking.businessFitScore,rawQuality:e.ranking.qualityScore,fspBonus:e.fspBonus,rankingScore:e.rankingScore,qualityStatus:e.ranking.qualityStatus};});}
const results=examples.map(example=> {
  const actual=rank(example.people),without=rank(example.people.map(c=>({...c,hasFspHistory:false})));
  const ids=actual.map(x=>x.candidate.userId),neutral=without.map(x=>x.candidate.userId);
  assert.deepEqual(ids,example.expected,example.id);assert.deepEqual(neutral,example.expectedWithoutFsp,example.id+" FSP ablation");
  const position=new Map(ids.map((id,index)=>[id,index+1])),neutralPosition=new Map(neutral.map((id,index)=>[id,index+1]));
  return {id:example.id,question:example.question,status:"OBSERVED_AS_EXPECTED",candidates:facts(example.people),currentOrder:ids,withoutFspOrder:neutral,changed:ids.some((id,index)=>id!==neutral[index]),positions:ids.map(id=>({id,current:position.get(id),withoutFsp:neutralPosition.get(id)}))};
});
const mixed=[candidate(21,"A",83),candidate(22,"B FSP",83,"Middle",undefined,true),candidate(23,"C Senior",100,"Senior"),candidate(24,"D v5 FSP",83,"Middle","signal-backend-python-v5",true),candidate(25,"E",100),candidate(26,"F Junior",100,"Junior"),{...candidate(27,"G unknown",83),assessmentEvidence:null}];
const ordered=rank(mixed),ids=ordered.map(e=>e.candidate.userId);
for(let offset=0;offset<mixed.length;offset++)assert.deepEqual(rank([...mixed.slice(offset),...mixed.slice(0,offset)].reverse()).map(e=>e.candidate.userId),ids);
let triples=0;for(const a of ordered)for(const b of ordered)for(const c of ordered)if(compareRankedMatches(a,b)<=0&&compareRankedMatches(b,c)<=0){assert.ok(compareRankedMatches(a,c)<=0);triples++;}
assert.equal(ordered.find(e=>e.candidate.userId===27)!.evaluation.ranking.qualityScore,null);
assert.equal(sha(await readFile(sourcePath)),sha(original),"Matcher source changed during read-only analysis");
const input={synthetic:true,at:at.toISOString(),need,examples:examples.map(({id,people,expected,expectedWithoutFsp})=>({id,people,expected,expectedWithoutFsp})),mixed};
const report={schemaVersion:1,status:"READ_ONLY_ANALYSIS_COMPLETE",measuredAt:new Date().toISOString(),algorithmVersion:MATCH_ALGORITHM_VERSION,algorithmSha256:sha(original),evaluatorSha256:sha(await readFile("scripts/analyze-fsp-category-policy.ts")),syntheticInputSha256:sha(JSON.stringify(input)),formulaChanged:false,officialDefinition:{source:"../reference/fsp-2026-10-05/ФСП/ФСП спец. трек ТЗ.pdf",page:2,sha256:sha(await readFile("../reference/fsp-2026-10-05/ФСП/ФСП спец. трек ТЗ.pdf")),category:"specialization + confirmed grade",cohort:"specialization + confirmed grade + program + version + rubric",note:"Category is broader than a comparable exam cohort. This is implementation behavior analysis, not a new legal/product acceptance conclusion."},results,poolProof:{size:mixed.length,order:ids,permutations:7,transitiveTriplesChecked:triples,unknownQualityRetainedNull:true},finding:"At equal common need-fit and proof completeness, current FSP participates both in comparable-queue quality+3 and in the merge of available heads. It can therefore change positions between different grades/categories, as well as between versions inside one category.",limitations:["All candidates and proofs are synthetic constructed examples, not imported achievements or human exam results.","These are deterministic behavior examples, not independent relevance labels, ranking quality metrics, FSP registry validation or human grade validation.","No current core, report aggregate, existing datasets, criteria, privacy gates or FSP grade rules were edited.","Removing FSP is a counterfactual observation; it is not a deployed alternative policy.","A business decision and new frozen controls are required before changing category ordering."]};
const directory="outputs/verification/fsp-category-policy",path=`${directory}/current-behavior.json`;
await mkdir(directory,{recursive:true});
for(const target of [path,`${directory}/synthetic-input.json`])try{const prior=await readFile(target);await mkdir(`${directory}/history`,{recursive:true});await writeFile(`${directory}/history/${target.endsWith("synthetic-input.json")?"input":"report"}-${sha(prior).slice(0,12)}.json`,prior,{flag:"wx"});}catch(error:any){if(!["ENOENT","EEXIST"].includes(error.code))throw error;}
await writeFile(`${directory}/synthetic-input.json`,JSON.stringify(input,null,2)+"\n");await writeFile(path,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({status:report.status,examples:results.length,crossCategoryChange:results.find(r=>r.id==="different-grades-same-fit")!.changed,formulaChanged:false,proof:path,algorithmSha256:report.algorithmSha256}));
