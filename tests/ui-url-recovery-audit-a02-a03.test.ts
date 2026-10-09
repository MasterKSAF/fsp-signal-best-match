import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeJobFilterParams,normalizeJobSkillFilters} from '../artifacts/fsp-signal/src/lib/job-skill-filters';
import {workPreferencesSnapshot,type WorkPreferences} from '../artifacts/fsp-signal/src/lib/work-preferences-recovery';
import {jobDetailsInput,jobSearchInput,parseSkillFilters} from '../artifacts/api-server/src/lib/job-discovery';

test('malformed skill URLs never expose invalid records to the UI or server parser',()=>{
  for(const raw of ['[null]','[true]','[1]','["SQL"]','null','{}','true','"SQL"','[{}]','[{"level":"Senior"}]','[{"skill":1}]','[{"skill":" "}]','[{"skill":"SQL","level":"Expert"}]','[{"skill":"SQL","level":null}]','[{"skill":"SQL","extra":true}]','not-json']){
    const normalized=normalizeJobFilterParams(new URLSearchParams({skills:raw,hideApplied:'true',hideBlocked:'true',resumeId:'611'}));
    assert.equal(normalized.invalid,true,raw);assert.deepEqual(normalized.skills,[],raw);
    assert.equal(normalized.params.has('skills'),false,raw);
    assert.equal(jobSearchInput.safeParse(Object.fromEntries(normalized.params)).success,true,raw);
    assert.equal(normalized.params.get('hideApplied'),'true');assert.equal(normalized.params.get('hideBlocked'),'true');
  }
});
test('mixed valid skill records retain exact requirements and report only the discarded items',()=>{
  const raw=JSON.stringify([null,{skill:' React ',level:'Middle'},{skill:'SQL'},{skill:'Backend',level:'Senior'},{skill:'Python',level:'Expert'}]);
  const normalized=normalizeJobFilterParams(new URLSearchParams({skills:raw,q:'API',page:'3',sort:'salary_desc',hideApplied:'true',hideBlocked:'true',resumeId:'611'}));
  const expected=[{skill:'React',level:'Middle'},{skill:'SQL'},{skill:'Backend',level:'Senior'}];
  assert.equal(normalized.invalid,true);assert.deepEqual(normalized.skills,expected);
  const search=jobSearchInput.parse(Object.fromEntries(normalized.params));
  for(const format of ['csv','xlsx']){
    const exportParams=new URLSearchParams(normalized.params);exportParams.set('format',format);
    const exported=jobSearchInput.parse(Object.fromEntries(exportParams));
    assert.deepEqual(parseSkillFilters(exported.skills),expected);
    for(const key of ['q','page','sort','hideApplied','hideBlocked','resumeId'] as const)assert.equal(exported[key],search[key]);
  }
});
test('valid heterogeneous levels survive URL serialization, reload and back/forward normalization',()=>{
  const expected=[{skill:'React',level:'Middle'},{skill:'SQL'},{skill:'Python',level:'Senior'}];
  const initial=new URLSearchParams({skills:JSON.stringify(expected),hideBlocked:'true'});
  for(const params of [initial,new URLSearchParams(initial.toString()),normalizeJobFilterParams(initial).params]){
    const normalized=normalizeJobFilterParams(params);
    assert.equal(normalized.invalid,false);assert.deepEqual(normalized.skills,expected);
    assert.deepEqual(parseSkillFilters(jobSearchInput.parse(Object.fromEntries(normalized.params)).skills),expected);
  }
});
test('search retains historical PostgreSQL levels without allowing a new unsupported employer proof requirement',()=>{
  const filters=[{skill:'PostgreSQL',level:'Middle'}];
  const normalized=normalizeJobFilterParams(new URLSearchParams({skills:JSON.stringify(filters)}));
  assert.equal(normalized.invalid,false);
  assert.deepEqual(parseSkillFilters(jobSearchInput.parse(Object.fromEntries(normalized.params)).skills),filters);
  assert.equal(jobDetailsInput.safeParse({skillRequirements:[{...filters[0],mode:'verified'}]}).success,false);
  assert.equal(jobDetailsInput.safeParse({skillRequirements:[{skill:'PostgreSQL',mode:'declared_or_verified'}]}).success,true);
});
test('skill bounds and duplicate requirements cannot silently weaken an applied level',()=>{
  const maximum=Array.from({length:20},(_,i)=>({skill:`${i}`.padEnd(60,'x'),level:'Senior'}));
  assert.equal(normalizeJobSkillFilters(JSON.stringify(maximum)).invalid,false);
  assert.equal(normalizeJobSkillFilters(JSON.stringify([...maximum,{skill:'Extra'}])).invalid,true);
  assert.equal(normalizeJobSkillFilters(JSON.stringify([{skill:'x'.repeat(61)}])).invalid,true);
  assert.equal(normalizeJobSkillFilters(' '.repeat(3001)).invalid,true);
  assert.deepEqual(normalizeJobSkillFilters('[{"skill":"sql"},{"skill":"SQL","level":"Senior"},{"skill":"Sql","level":"Junior"}]').skills,[{skill:'sql',level:'Senior'}]);
  assert.deepEqual(normalizeJobSkillFilters(null),{skills:[],invalid:false});
  assert.deepEqual(normalizeJobSkillFilters('[]'),{skills:[],invalid:false});
});

const prefs=(location:string):WorkPreferences=>({location,schedule:'Гибкий',employment:'Полный день',relocation:false,startAvailability:'Через неделю'});
test('recovery selects the fresh owned resume, clones its preferences and rebases the fresh revision',()=>{
  const serverRows=[{id:611,revision:9,workPreferences:prefs('Москва')},{id:612,revision:12,workPreferences:prefs('Казань')}];
  const stale={id:611,revision:3,workPreferences:prefs('Старая локация')};const localDraft=prefs('Моя несохранённая локация');
  const recovered=workPreferencesSnapshot(serverRows,stale.id);
  assert.equal(recovered.revision,9);assert.equal(recovered.preferences.location,'Москва');
  assert.equal(localDraft.location,'Моя несохранённая локация');assert.equal(stale.workPreferences.location,'Старая локация');
  recovered.preferences.location='Следующая правка';assert.equal(serverRows[0].workPreferences.location,'Москва');
});
test('failed/missing recovery snapshots never offer an empty or another resume baseline',()=>{
  const invalid=[[],[{id:612,revision:9,workPreferences:prefs('Чужое резюме')}],[{id:611,revision:0,workPreferences:prefs('Москва')}],[{id:611,revision:2,workPreferences:{...prefs('Москва'),relocation:'false'}}],[{id:611,revision:2,workPreferences:{...prefs('Москва'),location:null}}]];
  for(const rows of invalid)assert.throws(()=>workPreferencesSnapshot(rows as Parameters<typeof workPreferencesSnapshot>[0],611),/Ваши правки остались в форме/);
});
