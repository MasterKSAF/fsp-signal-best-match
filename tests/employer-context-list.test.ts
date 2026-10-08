import test from 'node:test';
import assert from 'node:assert/strict';
import { contextActions,contextListHref,contextListOptions,filterContextList } from '../artifacts/fsp-signal/src/lib/employer-context-list';
const items=[
  {id:11,title:'Аналитик',specialization:'Backend / Python',description:'Работа с данными',requiredSkills:['Python','SQL'],workFormat:'Удалённо',updatedAt:'2026-10-08T12:00:00Z',revision:4,shortlistCount:2,status:'active'},
  {id:12,title:'Разработчик 10',specialization:'Frontend / TypeScript',description:'Интерфейсы',skills:['React'],location:'Москва',updatedAt:'2026-10-09T12:00:00Z',version:2,applicationCount:3,status:'closed'},
  {id:13,title:'Разработчик 2',specialization:'Backend / Python',description:'Сервис',requiredSkills:['FastAPI'],desirableSkills:['Redis'],updatedAt:'2026-10-09T12:00:00Z',revision:5,shortlistCount:1,status:'archived'},
];
test('Both tabs search titles, roles, prose and their skill arrays without hiding historical statuses',()=>{
  assert.deepEqual(filterContextList(items,{q:'  PYTHON   удалённо ',sort:'updated_desc'}).map(item=>item.id),[11]);
  assert.deepEqual(filterContextList(items,{q:'frontend-разработчик',sort:'updated_desc'}).map(item=>item.id),[12]);
  assert.deepEqual(filterContextList(items,{q:'redis',sort:'updated_desc'}).map(item=>item.id),[13]);
  assert.deepEqual(filterContextList(items,{q:'работа данными',sort:'updated_desc'}).map(item=>item.id),[11]);
  assert.deepEqual(filterContextList(items,{q:'неизвестная роль',sort:'updated_desc'}),[]);
  assert.equal(filterContextList(items,{q:'',sort:'updated_desc'}).length,3);
});
test('Sorting is stable, respects timestamps and natural titles, and retains CAS fields/counters without modifying API data',()=>{
  const before=structuredClone(items);
  assert.deepEqual(filterContextList(items,{q:'',sort:'updated_desc'}).map(item=>item.id),[13,12,11]);
  assert.deepEqual(filterContextList(items,{q:'',sort:'title_asc'}).map(item=>item.id),[11,13,12]);
  assert.deepEqual(filterContextList(items,{q:'',sort:'title_desc'}).map(item=>item.id),[12,13,11]);
  assert.equal(filterContextList(items,{q:'react',sort:'title_asc'})[0],items[1]);
  assert.deepEqual(items,before);
  const undated=[{id:1,title:'Одна роль',specialization:'Custom',updatedAt:'invalid'},{id:2,title:'Одна роль',specialization:'Custom'}];
  assert.deepEqual(filterContextList(undated,{q:'',sort:'updated_desc'}).map(item=>item.id),[2,1]);
  assert.deepEqual(filterContextList(undated,{q:'',sort:'title_asc'}).map(item=>item.id),[1,2]);
});
test('Tab URL state restores independently and reset preserves the other tab and legacy deep-link identifiers',()=>{
  let href=contextListHref('?jobId=42&needId=31&jobsQ=Python&jobsSort=title_asc','needs',{q:'React',sort:'title_desc'});
  assert.deepEqual(contextListOptions(href.split('?')[1],'jobs'),{q:'Python',sort:'title_asc'});
  assert.deepEqual(contextListOptions(href.split('?')[1],'needs'),{q:'React',sort:'title_desc'});
  href=contextListHref(href.split('?')[1],'jobs');
  assert.deepEqual(contextListOptions(href.split('?')[1],'needs'),{q:'React',sort:'title_desc'});
  href=contextListHref(href.split('?')[1],'needs',{q:'',sort:'updated_desc'});
  const params=new URLSearchParams(href.split('?')[1]);
  assert.equal(params.get('jobId'),'42');assert.equal(params.get('needId'),'31');assert.equal(params.get('tab'),'needs');
  assert.deepEqual(contextListOptions(params.toString(),'jobs'),{q:'Python',sort:'title_asc'});
  assert.deepEqual(contextListOptions(params.toString(),'needs'),{q:'',sort:'updated_desc'});
  assert.deepEqual(contextListOptions('?jobsSort=unknown','jobs'),{q:'',sort:'updated_desc'});
});
test('Menu relocation preserves closed/archived restrictions and explicit publication/reopening',()=>{
  assert.deepEqual(contextActions('job','draft'),{select:true,edit:true,publish:true,close:false,archive:true,restore:false});
  assert.deepEqual(contextActions('job','published'),{select:true,edit:true,publish:false,close:true,archive:false,restore:false});
  assert.deepEqual(contextActions('job','closed'),{select:false,edit:true,publish:true,close:false,archive:true,restore:false});
  assert.deepEqual(contextActions('job','archived'),{select:false,edit:false,publish:false,close:false,archive:false,restore:false});
  assert.deepEqual(contextActions('need','active'),{select:true,edit:true,publish:false,close:false,archive:true,restore:false});
  assert.deepEqual(contextActions('need','archived'),{select:false,edit:false,publish:false,close:false,archive:false,restore:true});
});
