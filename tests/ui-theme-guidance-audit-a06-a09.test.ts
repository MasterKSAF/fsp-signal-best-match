import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {normalizeThemePreference,resolveTheme,themeScheme,type PaletteId} from '../artifacts/fsp-signal/src/lib/theme-preference';
import {paletteColors} from '../artifacts/fsp-signal/src/lib/theme-palettes';
import {getWorkspaceGuideContent} from '../artifacts/fsp-signal/src/lib/workspace-guidance';
import {consultantAttemptActive,replyTo,topicReply} from '../artifacts/fsp-signal/src/lib/signal-consultant-content';

const html=readFileSync(new URL('../artifacts/fsp-signal/index.html',import.meta.url),'utf8');
const firstPaint=html.match(/<script>([\s\S]*?)<\/script>/)![1];
test('actual first-paint script and runtime share four persisted palettes, system and legacy migrations',()=>{
  for(const stored of [null,'light','dark','system','pearl','cashmere','graphite','midnight','unknown'])for(const systemDark of [false,true]){
    const storage=new Map<string,string>(stored===null?[]:[['fsp-theme',stored]]);const classes=new Set<string>();
    const element={dataset:{} as Record<string,string>,style:{} as Record<string,string>,classList:{toggle:(name:string,on:boolean)=>on?classes.add(name):classes.delete(name)}};
    runInNewContext(firstPaint,{localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},document:{documentElement:element},matchMedia:()=>({matches:systemDark})});
    const preference=normalizeThemePreference(stored),palette=resolveTheme(preference,systemDark),scheme=themeScheme(palette);
    assert.equal(element.dataset.theme,palette);assert.equal(element.dataset.themePreference,preference);
    assert.equal(element.style.colorScheme,scheme);assert.equal(classes.has('dark'),scheme==='dark');
    assert.equal(storage.get('fsp-theme'),preference);
    assert.match(html,palette==='pearl'?/html \{ background:#ECEEF2/:new RegExp(`html\\[data-theme="${palette}"\\] \\{background:${paletteColors[palette].canvas}`));
  }
});
test('blocked storage still resolves first paint and manual choices remain unchanged after an OS switch',()=>{
  for(const systemDark of [false,true]){
    const element={dataset:{} as Record<string,string>,style:{} as Record<string,string>,classList:{toggle:()=>{}}};
    runInNewContext(firstPaint,{localStorage:{getItem:()=>{throw Error('blocked');}},document:{documentElement:element},matchMedia:()=>({matches:systemDark})});
    assert.equal(element.dataset.theme,systemDark?'graphite':'pearl');
  }
  for(const palette of Object.keys(paletteColors) as PaletteId[])assert.equal(resolveTheme(palette,false),resolveTheme(palette,true));
  assert.equal(resolveTheme('system',false),'pearl');assert.equal(resolveTheme('system',true),'graphite');
});

const css=readFileSync(new URL('../artifacts/fsp-signal/src/theme-palettes.css',import.meta.url),'utf8');
function cssTokens(id:string){const block=css.match(new RegExp(`html\\[data-theme="${id}"\\] \\{([\\s\\S]*?)\\n\\}`))![1];return new Map([...block.matchAll(/--([\w-]+):([^;]+);/g)].map(m=>[m[1],m[2].trim()]));}
function hslRgb(value:string){const[h,s0,l0]=value.split(/\s+/).map(parseFloat),s=s0/100,l=l0/100;const a=s*Math.min(l,1-l);return [0,8,4].map(n=>{const k=(n+h/30)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));});}
function luminance(rgb:number[]){const c=rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
function ratio(a:number[],b:number[]){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('actual palette CSS meets text, input and focus thresholds across all four surface systems',()=>{
  const receipts:Record<string,Record<string,number>>={};
  for(const id of Object.keys(paletteColors) as PaletteId[]){
    const tokens=cssTokens(id),rgb=(key:string)=>{assert.ok(tokens.has(key),`${id}: missing ${key}`);return hslRgb(tokens.get(key)!);};
    const checks:Record<string,number>={};
    const check=(fg:string,bg:string,min:number)=>{const contrast=ratio(rgb(fg),rgb(bg));checks[`${fg}/${bg}`]=Number(contrast.toFixed(3));assert.ok(contrast>=min,`${id} ${fg}/${bg}: ${contrast.toFixed(2)} < ${min}`);};
    for(const bg of ['background','workspace-surface','card','sidebar','field','popover']){check('foreground',bg,7);check('muted-foreground',bg,4.5);}
    check('primary-foreground','primary',4.5);check('primary','primary-soft',4.5);
    for(const bg of ['field','card','workspace-surface']){check('input',bg,3);check('ring',bg,3);}
    for(const status of ['success','warning','destructive','info'])check(status,`${status}-soft`,4.5);
    for(const status of ['declared','verified','recommended']){
      check(`chip-${status}`,`chip-${status}-soft`,4.5);
      for(const level of ['junior','middle','senior'])check(`level-${level}`,`chip-${status}-soft`,4.5);
    }
    assert.equal(tokens.get('demo-lamp'),'43 90% 58%');
    for(const key of ['surface-shadow','overlay-shadow','shadow-md','elevate-1','elevate-2'])assert.ok(tokens.has(key));
    if(themeScheme(id)==='dark')assert.ok(luminance(rgb('workspace-surface'))<luminance(rgb('card')),'dark canvas is darker than cards');
    const actual=rgb('workspace-surface'),expected=paletteColors[id].workspace.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255);
    actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<.00001,'CSS must match declared palette'));
    receipts[id]=checks;
  }
  console.log('PALETTE_CONTRAST_RECEIPTS '+JSON.stringify(receipts));
});
test('all four palettes differ in canvas, cards, chrome, field, text and accent',()=>{
  for(const key of ['canvas','workspace','panel','chrome','field','text','muted','accent'] as const)assert.equal(new Set(Object.values(paletteColors).map(p=>p[key])).size,4,key);
  assert.match(css,/html\[data-theme\] \.signal-skill-chip--declared/);
  assert.match(css,/html\[data-theme\] \.signal-skill-chip--verified/);
  assert.match(css,/html\[data-theme\] \.signal-skill-chip--recommended/);
});

const app=readFileSync(new URL('../artifacts/fsp-signal/src/App.tsx',import.meta.url),'utf8');
const routes=new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map(m=>m[1]));routes.add('/auth');
test('guidance actions resolve to current routes in the correct role',()=>{
  const candidate=['/candidate','/candidate/resumes','/candidate/passport','/candidate/kalibr','/candidate/jobs','/candidate/invitations','/candidate/microtasks','/candidate/trust','/settings'];
  const employer=['/employer','/employer/matches','/employer/candidates','/employer/selection','/employer/applications','/employer/company','/employer/jobs','/employer/invitations','/employer/microtasks','/employer/trust','/settings'];
  for(const[role,paths]of[['candidate',candidate],['employer',employer]]as const)for(const path of paths){const guide=getWorkspaceGuideContent(role,path);assert.ok(routes.has(guide.href),guide.href);assert.ok(guide.href.startsWith(`/${role}`)||guide.href==='/settings',`${role}: ${guide.href}`);}
  assert.equal(topicReply('entry','candidate').action?.href,'/candidate/resumes');
  assert.equal(topicReply('entry','employer').action?.href,'/employer/jobs');
  assert.equal(getWorkspaceGuideContent('employer','/employer').title,'Мои вакансии');
  assert.match(getWorkspaceGuideContent('employer','/employer').tips.join(' '),/Приватный запрос.*не принимает публичные отклики/);
  for(const alias of ['/employer/selection','/employer/matches','/employer/candidates']) { const guide=getWorkspaceGuideContent('employer',alias);assert.equal(guide.title,'Подбор специалистов');assert.equal(guide.href,'/employer/selection'); }
  assert.equal(getWorkspaceGuideContent('employer','/employer/applications').title,'Отклики');
});
test('consultant separates auth/start questions and describes current modular qualifications',()=>{
  for(const question of ['Как войти?','Как зарегистрироваться?','Забыл пароль','Demo']){const reply=replyTo(question,'candidate','/candidate/passport');assert.equal(reply.action?.href,'/auth');assert.doesNotMatch(reply.text,/Python|матриц/);}
  assert.equal(replyTo('С чего начать?','candidate').action?.href,'/candidate/resumes');
  for(const skill of ['Python','SQL','Backend','TypeScript','React','Frontend','Senior']){const reply=replyTo(`Как подтвердить ${skill}?`,'candidate');assert.equal(reply.action?.href,'/candidate/kalibr');assert.match(reply.text,/Junior, Middle и Senior/);assert.match(reply.text,/составом категории/);assert.match(reply.text,/исторический общий экзамен/);}
  for(const role of ['candidate','employer']as const)for(const question of ['Как войти?','Резюме PDF','Подбор','Проверка навыков','Контакты','Вакансии','С чего начать?']){const action=replyTo(question,role).action;if(action?.href){assert.ok(routes.has(action.href));assert.ok(action.href=== '/auth'||action.href.startsWith(`/${role}`));}}
  assert.match(replyTo('неизвестный вопрос').text,/пока нет точного ответа/);
});
test('both modular and historical timed attempts hide the consultant',()=>{
  assert.equal(consultantAttemptActive('/candidate/kalibr','?attempt=1'),true);
  assert.equal(consultantAttemptActive('/candidate/kalibr','?moduleAttempt=481&resumeId=611'),true);
  for(const search of ['','?skill=React&level=Senior','?attempt=0','?moduleAttempt=-1','?moduleAttempt=word'])assert.equal(consultantAttemptActive('/candidate/kalibr',search),false);
  assert.equal(consultantAttemptActive('/candidate/resumes','?moduleAttempt=481'),false);
});
