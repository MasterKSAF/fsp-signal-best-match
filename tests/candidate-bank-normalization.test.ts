import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { canonicalSkillKey, canonicalSkillLabels, normalizeSkillSearchToken, SKILL_SEARCH_WHITESPACE_PATTERN, skillSearchAliases } from '../artifacts/api-server/src/lib/skill-catalog';
import { normalizeStoredSkill, skillArrayMatches } from '../artifacts/api-server/src/lib/skill-catalog-sql';
import { evaluateMatch, type MatchCandidate, type MatchNeed } from '../artifacts/api-server/src/lib/signal-matching';

const requireApi=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {sql}=requireApi('drizzle-orm');
const {PgDialect}=requireApi('drizzle-orm/pg-core');

const equivalentTokens: Array<[string,string]> = [
  ['Ｐｙｔｈｏｎ','Python'], ['\u00a0ＰＹＴＨＯＮ\u00a0','Python'], ['𝑃𝑦𝑡ℎ𝑜𝑛','Python'],
  ['\ufeffＰｙｔｈｏｎ\ufeff','Python'], ['ＡＰＩ\u3000\u3000contracts','API contracts'],
  [' API\t\r\ncontracts\u2028','API contracts'], ['ＡＰＩ－контракты','API contracts'],
  ['ＰＯＳＴＧＲＥＳ','PostgreSQL'], [' ｐｙ ','Python'], ['Ａ１１Ｙ','Accessibility'],
];
test('catalogue identity, display and matching share independently specified Unicode equivalents',()=>{
  const need:MatchNeed={specialization:'Backend / Python',grade:'Middle',requiredSkills:['Python'],desirableSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:200000};
  const base:MatchCandidate={userId:1,alias:'Synthetic normalization regression',specialization:need.specialization,verifiedGrade:'Middle',verifiedScore:100,verifiedSkills:['Ｐｙｔｈｏｎ'],stack:[],statedSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,latestAssessmentAt:null,hasFspHistory:false,visibility:'pseudonymous',consentMatching:true,demoMode:false};
  assert.equal(evaluateMatch(need,base,false).eligible,true);
  for(const [raw,label] of equivalentTokens) {
    assert.equal(canonicalSkillKey(raw),canonicalSkillKey(label),raw);
    assert.deepEqual(canonicalSkillLabels([raw,label]),[label],raw);
    assert.ok(skillSearchAliases(label).includes(normalizeSkillSearchToken(raw)),raw);
  }
});
test('unknown skills retain exact normalized identity without guessing punctuation aliases',()=>{
  assert.equal(canonicalSkillKey(' Ｑ－Ｓｔｏｒｅ '),canonicalSkillKey('Q-Store'));
  assert.notEqual(canonicalSkillKey('Q-Store'),canonicalSkillKey('QStore'));
  assert.deepEqual(skillSearchAliases(' Ｑ－Ｓｔｏｒｅ '),['q-store']);
  assert.equal(normalizeSkillSearchToken(' e\u0301ngine\u2003\u2003X '),'éngine x');
});
test('SQL search binds aliases and exact JS whitespace set without interpolating hostile query text',()=>{
  const dialect=new PgDialect();
  const malicious="Q-Store'); select 'private'; --";
  const expression=skillArrayMatches(sql`stack || verified_skills`,malicious);
  const compiled=dialect.sqlToQuery(expression);
  assert.ok(!compiled.sql.includes(malicious));
  assert.ok(compiled.params.includes(normalizeSkillSearchToken(malicious)));
  assert.ok(compiled.params.includes(SKILL_SEARCH_WHITESPACE_PATTERN));
  assert.ok(compiled.sql.includes('normalize(item, NFKC)'));
  assert.ok(compiled.sql.startsWith('exists (select 1 from unnest(stack || verified_skills)'));
});
test('read normalization accepts an existing value without rewriting raw data',()=>{
  const raw='\u00a0Ｐｙｔｈｏｎ\u00a0';
  const compiled=new PgDialect().sqlToQuery(normalizeStoredSkill(sql`${raw}`));
  assert.equal(compiled.params[0],raw);
  assert.ok(compiled.sql.startsWith('lower(btrim(regexp_replace(normalize('));
  assert.ok(!/update|insert|delete/i.test(compiled.sql));
  assert.equal(normalizeSkillSearchToken(raw),'python');
});
