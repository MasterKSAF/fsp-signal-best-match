import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// YAML is already pinned transitively by the contract generator in pnpm-lock.yaml.
const dependency=fs.readdirSync('node_modules/.pnpm').find(name=>/^yaml@2\./.test(name));
if(!dependency)throw new Error('Run pnpm install --frozen-lockfile first');
const {default:YAML}=await import(pathToFileURL(path.resolve(`node_modules/.pnpm/${dependency}/node_modules/yaml/dist/index.js`)).href);
const file='lib/api-spec/openapi.yaml',api=YAML.parse(fs.readFileSync(file,'utf8'));
for(const name of ['matching-v3-openapi.yaml','managed-assessment-openapi.json','opportunities-openapi.yaml','research-openapi.json']) {
 const fragment=YAML.parse(fs.readFileSync(`docs/contracts/${name}`,'utf8'));
 for(const [route,methods] of Object.entries(fragment.paths||{}))api.paths[route]={...api.paths[route],...methods};
 for(const [kind,items] of Object.entries(fragment.components||{}))api.components[kind]={...api.components[kind],...items};
}
const s=api.components.schemas;
api.components.responses.Error=api.components.responses.ApiError;
// Named inputs avoid Orval's inline XxxBody type/validator barrel collision.
for(const methods of Object.values(api.paths))for(const operation of Object.values(methods)) {
 const content=operation?.requestBody?.content?.['application/json'];
 if(!content?.schema || content.schema.$ref || !operation.operationId)continue;
 const name=operation.operationId[0].toUpperCase()+operation.operationId.slice(1)+'Input';
 s[name]=content.schema;content.schema={$ref:`#/components/schemas/${name}`};
}
Object.assign(s.MatchEvidence.properties,{skillId:{type:['string','null']},provenance:{anyOf:[{$ref:'#/components/schemas/SafeSkillProof'},{type:'null'}]}});
Object.assign(s.MatchExplanation.properties,{catalogVersion:{type:'string'},minimumGrade:{type:'string'},categoryNote:{type:'string'}});
// v4 ranks comparable attempt groups, preserving floating scores and unknown quality.
s.MatchRanking={type:'object',required:['groupId','qualityStatus','qualityScore','note'],properties:{
 groupId:{type:'string'},gradePriority:{type:'integer'},provenancePriority:{type:'integer'},
 qualityStatus:{type:'string',enum:['measured','not_measured','revoked']},qualityScore:{type:['number','null']},
 attemptId:{type:['integer','null']},programId:{type:['string','null']},programVersion:{type:['string','null']},
 comparisonPolicy:{type:['string','null']},rubricKey:{type:['string','null']},note:{type:'string'} }};
for(const name of ['MatchResult','MatchExplanation'])if(s[name]){
 s[name].properties.rankingScore={type:'number',minimum:0,maximum:105};
 s[name].properties.ranking={$ref:'#/components/schemas/MatchRanking'};
}
// The list item schema is named MatchCandidate in earlier contract revisions.
for(const schema of Object.values(s))if(schema.properties?.fspHistory && schema.properties?.fspBonus){
 schema.properties.rankingScore={type:'number',minimum:0,maximum:105}; schema.properties.ranking={$ref:'#/components/schemas/MatchRanking'};
}
s.MatchExplanation.properties.factors.items.properties.score={type:['number','null']};
s.MatchExplanation.properties.factors.items.properties.effectiveWeight={type:'number'};
Object.assign(s.CandidateBank.properties,{availableTotal:{type:'integer'},catalogVersion:{type:'string'}});
fs.writeFileSync(file,YAML.stringify(api,{lineWidth:120}));
console.log(`Merged ${Object.keys(api.paths).length} routes and ${Object.keys(s).length} schemas`);
