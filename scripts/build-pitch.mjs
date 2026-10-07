import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const RUNTIME=process.env.ARTIFACT_NODE_MODULES || 'C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const runtimeRequire=createRequire(path.join(RUNTIME,'signal-pitch.cjs'));
const {FileBlob, PresentationFile}=await import(pathToFileURL(runtimeRequire.resolve('@oai/artifact-tool')).href);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const CONFIG=JSON.parse(await fs.readFile(path.join(ROOT,'docs/presentation-content.json'),'utf8'));
if(CONFIG.draft)throw new Error('Final media blocked until current-build acceptance facts and screenshots are supplied.');
if(process.argv.includes('--publish'))throw new Error('Review the generated final slides, then promote those exact reviewed files explicitly. Rebuilding with --publish is not visual acceptance.');
if(CONFIG.packageVersion!=='0.4.1' || CONFIG.matchingVersion!=='fsp-signal-match-v5' || CONFIG.transferModelVersion!=='signal-source-mechanism-transfer-v4')throw new Error('Expected accepted 0.4.1 matching v5 / transfer v4 facts.');
for(const [file,expected] of Object.entries(CONFIG.sourceHashes??{})){
 const actual=createHash('sha256').update(await fs.readFile(path.resolve(ROOT,file))).digest('hex');
 if(actual!==expected)throw new Error('Presentation source fact changed: '+file);
}
async function readRecordedProof(record){
 if(!record?.proofPath || !/^[a-f0-9]{64}$/.test(record.proofSHA??''))throw new Error('Missing bounded media proof');
 const file=path.resolve(ROOT,record.proofPath),relative=path.relative(ROOT,file);
 if(relative.startsWith('..') || path.isAbsolute(relative))throw new Error('Media proof must be inside this project');
 const bytes=await fs.readFile(file);
 if(createHash('sha256').update(bytes).digest('hex')!==record.proofSHA)throw new Error('Bounded media proof changed: '+record.proofPath);
 return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
}
let boundedMedia=null;
if(CONFIG.screenshotVerification?.boundedRuntimeEquivalence){
 const eq=await readRecordedProof(CONFIG.screenshotVerification.boundedRuntimeEquivalence);
 const expectedPaths=['artifacts/api-server/src/lib/assessment-ranking-evidence.ts','artifacts/api-server/src/lib/matching-pool-admission.ts','artifacts/api-server/src/lib/skill-catalog.ts','artifacts/api-server/src/routes/signal-employer-matching.ts'].sort();
 if(eq.schemaVersion!=='signal-bounded-media-equivalence-v1' || eq.passed!==true || eq.acceptedImageId!==CONFIG.acceptanceSnapshot?.imageId || eq.sourceUIUnchanged!==true || eq.backendEquivalenceVerified!==true || eq.captureFrontendManifestSHA!==eq.acceptedFrontendManifestSHA)throw new Error('Bounded media equivalence was not accepted');
 if(JSON.stringify(eq.changedBackendPaths?.map(row=>row.path).sort())!==JSON.stringify(expectedPaths))throw new Error('Only the four reviewed backend performance paths may differ');
 for(const row of eq.changedBackendPaths){
  if(createHash('sha256').update(await fs.readFile(path.resolve(ROOT,row.path))).digest('hex')!==row.sourceSHA)throw new Error('Reviewed backend source changed: '+row.path);
 }
 if(eq.matchingCoreSHA!==CONFIG.sourceHashes['artifacts/api-server/src/lib/signal-matching.ts'] || eq.transferModelSHA!==CONFIG.sourceHashes['scripts/lib/grade-transfer-model.ts'])throw new Error('Matching core or transfer model differs from capture');
 const audit=await readRecordedProof(eq.targetedMatchingAcceptance),load=await readRecordedProof(eq.loadAcceptance),quality=await readRecordedProof(eq.qualityEquivalence),functional=await readRecordedProof(eq.currentFunctional);
 if(audit.passed!==true || audit.targetedBuiltRuntimeGroups!==20 || audit.imageId!==eq.acceptedImageId || audit.apiBundleSha256!==CONFIG.acceptanceSnapshot?.bundleSHA || audit.matcherSha256!==eq.matchingCoreSHA || audit.frontendManifestSha256!==eq.acceptedFrontendManifestSHA || JSON.stringify([...audit.changedApplicationPaths].sort())!==JSON.stringify(expectedPaths))throw new Error('Actual targeted 20-group current-runtime acceptance is missing');
 const compat=audit.mediaCompatibility;
 if(compat?.passed!==true || compat.captureImageId!==eq.captureImageId || compat.acceptedRuntimeImageId!==eq.acceptedImageId || compat.sameFrontendBytes!==true || compat.unchangedMatcherAndTransferModel!==true)throw new Error('Actual source/UI media compatibility is missing');
 if(load.passed!==true || load.imageId!==eq.acceptedImageId || load.bundleSha256!==audit.apiBundleSha256 || eq.targetedMatchingAcceptance.groups!==20 || eq.targetedMatchingAcceptance.imageId!==eq.acceptedImageId || eq.loadAcceptance.imageId!==eq.acceptedImageId)throw new Error('Actual current-load PASS on the same accepted runtime is missing');
 for(const row of eq.changedBackendPaths)if(audit.sourceHashes[row.path]!==row.sourceSHA)throw new Error('Independent audit used different backend bytes');
 if(quality.schemaVersion!=='signal-performance-quality-equivalence-v1' || quality.passed!==true || quality.originalReportsUnchanged!==true || quality.publicAggregateSha256!==CONFIG.sourceHashes['artifacts/api-server/src/lib/quality-public-report.json'] || quality.controls?.length!==3 || quality.controls.some(row=>row.passed!==true || row.algorithmSha256!==eq.matchingCoreSHA))throw new Error('Actual unchanged offline control outcomes are missing');
 for(const row of eq.changedBackendPaths)if(quality.sourceHashes[row.path]!==row.sourceSHA)throw new Error('Offline control rerun used different backend bytes');
 if(functional.passed!==true || functional.imageId!==eq.acceptedImageId || functional.apiBundleSha256!==eq.acceptedBundleSHA || functional.unit?.failed!==0 || functional.typecheck?.passed!==true || functional.targetedHttpGroups!==6 || functional.unit.passed!==eq.currentFunctional.unitTests)throw new Error('Actual current functional facts are missing');
 for(const row of eq.changedBackendPaths)if(functional.sourceHashes[row.path]!==row.sourceSHA)throw new Error('Current functional checks used different backend bytes');
 boundedMedia=eq;
}
for(const key of ['entry','matching','assessment']){
 const origin=CONFIG.screenshotProvenance?.[key];
 const accepted=origin?.captureImage===CONFIG.acceptanceSnapshot?.imageId;
 const bounded=boundedMedia && origin?.captureImage===boundedMedia.captureImageId;
 if(!origin?.isFinalImageCapture || (!accepted && !bounded))throw new Error('Screenshot is neither current nor within verified bounded equivalence: '+key);
}
const BUILD=process.env.PITCH_BUILD_ID || new Date().toISOString().replace(/[:.]/g,'-');
const DIR=path.join(ROOT,'outputs/internal/pitch-completion',BUILD);
await fs.mkdir(DIR,{recursive:true});
const skillRoot='C:/Users/Misha/.codex/plugins/cache/openai-primary-runtime/presentations';
const skillVersions=process.env.PRESENTATIONS_SKILL_DIR ? [] : (await fs.readdir(skillRoot)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
const SKILL=process.env.PRESENTATIONS_SKILL_DIR || path.join(skillRoot,skillVersions[0],'skills/presentations');
const SOURCE=process.env.PITCH_TEMPLATE || path.resolve(ROOT,'../reference/fsp-2026-10-05/ФСП/ЛЦТ_2026_Шаблон презентации ФСП.pptx');
const PYTHON=process.env.ARTIFACT_PYTHON || 'C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const require=runtimeRequire, ar=createRequire(require.resolve('@oai/artifact-tool'));
const {FontLibrary}=ar('skia-canvas');
FontLibrary.use('Montserrat',[path.join(ROOT,'outputs/submission/fonts/Montserrat.ttf')]);
try{const {GlobalFonts}=require('@napi-rs/canvas');GlobalFonts.registerFromPath(path.join(ROOT,'outputs/submission/fonts/Montserrat.ttf'),'Montserrat');}catch{}
const p=await PresentationFile.importPptx(await FileBlob.load(SOURCE));
p.view.hideGuides();p.view.hideGridlines();
const selected=[6,7,8,9,10,12,13,17];
await fs.writeFile(path.join(DIR,'template-inspection.ndjson'),(await p.inspect({kind:'slide,shape,textbox,image,layout',maxChars:400000})).ndjson);
// Delete unselected original slides backwards; this API is shared by bundled runtimes.
for(let index=p.slides.items.length-1;index>=0;index--)if(!selected.includes(index))p.slides.items[index].delete();
// Read verified inspection anchors from the source deck before targeted editing.
const S=id=>p.resolve(id);
function edit(id,text,{color='#1C1D22',size,bold,position}={}){
 const s=S(id);s.text=text.split('\n').map(line=>({runs:[line],bulletCharacter:'',marginLeft:0,indent:0}));s.text.style={typeface:'Montserrat',color,autoFit:'none',...(size?{fontSize:size}:{}),...(bold===undefined?{}:{bold})};if(position)s.position=position;return s;
}
function add(slide,text,left,top,width,height,size=24,color='#1C1D22',bold=false){const s=slide.shapes.add({geometry:'textbox',position:{left,top,width,height},fill:'none',line:{fill:'none',width:0}});s.text=text;s.text.style={typeface:'Montserrat',fontSize:size,color,bold,autoFit:'none'};return s;}
function remove(...ids){for(const id of ids)S(id).delete();}
async function screenshot(slide,key,left,top,width,height){const name=CONFIG.screenshots[key];if(!name)throw new Error('Missing screenshot: '+key);const origin=CONFIG.screenshotProvenance?.[key];if(!origin)throw new Error('Missing screenshot provenance: '+key);const bytes=await fs.readFile(path.resolve(ROOT,name));if(createHash('sha256').update(bytes).digest('hex')!==origin.sha256)throw new Error('Screenshot changed after provenance was fixed: '+key);slide.images.add({blob:bytes,contentType:name.endsWith('.png')?'image/png':'image/jpeg',fit:'contain',position:{left,top,width,height},alt:'Настоящий экран локального Signal. '+origin.description});}
const slides=p.slides.items;
// 1. Original task title and FSP mark remain on the source cover.
edit('sh/dcbud0ra','Signal\nBest Match',{color:'#FFFFFF',size:48,position:{left:36.33,top:290,width:710,height:170}});
add(slides[0],'Подбор ИТ-специалистов\nпо подтверждённым навыкам',40,470,740,88,26,'#FFFFFF');
edit('sh/zedcfa9g','Цифровая платформа-агрегатор ИТ-вакансий\nс верифицированным профилем достижений участника ФСП',{color:'#FFFFFF',size:21.33,position:{left:36.33,top:590,width:945,height:82}});
// 2. Template solution/uniqueness blocks, and an actual consent screen.
edit('sh/kfixwbe1','SIGNAL',{color:'#520978',size:32});
edit('sh/6h0fypgb','Работодатель выбирает по проверенным навыкам. Кандидат получает приглашения с указанной зарплатой.',{size:22,position:{left:716,top:289,width:519,height:156}});
edit('sh/je9g3ahk','Для каждого требования видны покрытие и происхождение подтверждения. Кандидат сам открывает контакты выбранной компании.',{size:22,position:{left:716,top:526,width:519,height:136}});
edit('sh/1k7edwv2','Best Match',{color:'#520978',size:26.67});
edit('sh/0jydkreh','Подбор начинается с задачи компании и проверенных навыков.\n\nКандидат видит условия до решения. Работодатель видит причины соответствия.',{size:23,position:{left:35.17,top:414,width:591,height:238}});
remove('im/8rah0by9');await screenshot(slides[1],'entry',28,37,615,306);
// Confirmed two-person roster, preserved from the current deck.
edit('sh/ofq5svm5','КОМАНДА BEST MATCH',{color:'#FFFFFF',size:26.63});
remove('sh/65c32ds7','sh/5432t8rm','sh/jyd0vu14','sh/wvm10f2t','sh/r654vi9c','sh/43ul03a1','sh/l0v2x4ja','sh/kzm14z2p','sh/yx4j2pkj','sh/xwvitkje','sh/but0ra18','sh/atkjypkn','im/gn614nex','im/hof2xsvi','im/2poj6xw3','im/3qxkz2do','im/4r6187e9');
S('sh/bml0buxs').position={left:36.33,top:159.79,width:1198,height:507.54};
edit('sh/do3id4fy','Best Match · Казань',{color:'#520978',size:32,position:{left:70,top:204,width:1095,height:70}});
edit('sh/ah8nu54b','Сергей Калеев\nКапитан, разработчик\n@sergeikaleev\n\nОксана Калеева\nМаркетолог\nkaleevaoksana7@gmail.com',{size:26,position:{left:70,top:290,width:1095,height:330}});
// 4. Mandatory history, choice, and challenges. Only observed project history.
edit('sh/kzu5c32t','РАЗРАБОТКА РЕШЕНИЯ',{color:'#FFFFFF',size:26.63});
edit('sh/u187adsv','История проекта',{color:'#520978',size:23,bold:true,position:{left:56,top:134,width:900,height:40}});
edit('sh/103qxcbq','Мы сравнили прототипы Replit и Google AI Studio. Развили основу Replit: серверная проверка навыков, объяснимый подбор и согласие на контакт.',{size:23,position:{left:56,top:183,width:1050,height:90}});
edit('sh/jq9gvuh4','Задача, которую решаем',{color:'#520978',size:23,bold:true,position:{left:56,top:305,width:900,height:40}});
edit('sh/wnyx0fit','Работодателю нужны основания для отбора. Кандидату нужны прозрачные условия и контроль передачи контактов.',{size:23,position:{left:56,top:358,width:1050,height:90}});
edit('sh/algfy50n','Главный вызов',{color:'#520978',size:23,bold:true,position:{left:56,top:480,width:900,height:40}});
edit('sh/bmpgrah8','Мы закрыли обходы оценки и потери из-за синонимов. Теперь проверяем допуск отдельно от ранжирования и сохраняем источник каждого подтверждения.',{size:23,position:{left:56,top:539,width:1050,height:100}});
for(const id of ['sh/m1cnetkj','sh/d87uxg3m','sh/q5gb21kb'])S(id).text.color='#520978';
// 5. Mandatory technical and development block.
edit('sh/0b6tc3yx','ВОЗМОЖНОСТИ И РАЗВИТИЕ',{color:'#FFFFFF',size:26.63});S('sh/ofqtgnyt').position={left:36.33,top:34.07,width:550,height:65.19};
edit('sh/1cfa58zi','Работающий продукт',{color:'#520978',size:26.67});
edit('sh/zaxs3yhc','Проверка перед внедрением',{color:'#520978',size:26.67});
edit('sh/wbih4b6d','React, TypeScript, PostgreSQL\nOpenAPI и Docker Compose\n\nРезюме с PDF и опросом\nКаталог и объяснение подбора\nВакансии и самостоятельный отклик\nЗадания компаний с расписанием\n\nТемы и адаптивные экраны',{size:24});
edit('sh/o7ih0r6h',CONFIG.validationBody,{size:22});
// Source 13 (now 6) is the broad demo panel for comparison.
edit('sh/q50nydsj','ПОДБОР С ОБЪЯСНЕНИЕМ',{color:'#FFFFFF',size:26.63});
remove('sh/bq9orito');await screenshot(slides[5],'matching',62,157,815,459);
add(slides[5],CONFIG.matchingHeading,902,173,310,90,24,'#520978',true);
add(slides[5],CONFIG.matchingBody,902,287,310,320,21);
add(slides[5],CONFIG.matchingFooter,70,622,1110,30,16,'#520978');
// Source 14 (now 7) keeps its left explanation / right screenshot composition.
edit('sh/wbydknq1','ПРОВЕРКА НАВЫКОВ',{color:'#520978',size:29});
edit('sh/kfidonqx',CONFIG.assessmentText,{size:23,position:{left:62.51,top:120.07,width:504.76,height:535}});
remove('im/i5wjyxwn');await screenshot(slides[6],'assessment',655,102,600,430);
add(slides[6],CONFIG.assessmentCaption,674,562,550,85,23,'#FFFFFF');
// 8. Template six-position summary: control, limits, and consent.
edit('sh/7mpknmp0','ПРОВЕРКИ И ГРАНИЦЫ',{color:'#FFFFFF',size:26.63});S('sh/90v6t4ri').position={left:36.33,top:34.07,width:510,height:65.19};
const groupAnchors=[
 ['sh/6lg3e18f','sh/wrelszu9','sh/hsn2l4bu'],['sh/to72pw76','sh/itw3upcf','sh/je5knut0'],
 ['sh/snylgrql','sh/4felwzu5','sh/5gnmp4bq'],['sh/bi94zqp4','sh/6hw3y9sb','sh/rip4retw'],
 ['sh/qh03ql8j','sh/fapkr6pw','sh/upg3i18r'],['sh/md4nipsr','sh/1cr2tg72','sh/gbylkbqh'],
];
if(CONFIG.verificationTiles?.length!==6)throw new Error('Expected six source-grounded verification tiles');
const groups=groupAnchors.map(([num,h,b],i)=>[num,CONFIG.verificationTiles[i].value,h,CONFIG.verificationTiles[i].title,b,CONFIG.verificationTiles[i].body]);
for(const [num,val,h,title,b,body] of groups){edit(num,val,{color:'#FF0053',size:32,position:{...S(num).position,width:110}});edit(h,title,{color:'#520978',size:23,bold:true});edit(b,body,{size:20,position:{...S(b).position,height:91}});}
for(const id of ['sh/0jydkreh','sh/ah8nu54b','sh/wbih4b6d','sh/o7ih0r6h','sh/kfidonqx'])S(id).text.bold=false;
// Stable page numbers and speaker notes.
const footerIds=['sh/o7ydoret','sh/0ru1ozyp','sh/ozitcv29','sh/87ehgv6d','sh/xozyhkbi','sh/xc7eds76','sh/nedoru9c'];
footerIds.forEach((id,i)=>{S(id).text=String(i+2);});
const notes=CONFIG.notes;
if(notes.length!==8)throw new Error('Expected 8 speaker notes');
slides.forEach((s,i)=>s.speakerNotes.textFrame.setText(notes[i]));
process.env.RUNTIME_NODE_MODULES=RUNTIME;
const candidate=path.join(DIR,'Signal-Pitch-candidate.pptx');
await(await PresentationFile.exportPptx(p)).save(candidate);
console.log('Exported candidate');
for(let i=0;i<slides.length;i++){const b=await slides[i].export({format:'png',scale:1});await fs.writeFile(path.join(DIR,`slide-${i+1}.png`),new Uint8Array(await b.arrayBuffer()));}
await fs.writeFile(path.join(DIR,'final-inspection.ndjson'),(await p.inspect({kind:'slide,textbox,shape,image',maxChars:150000})).ndjson);
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL,'container_tools/artifact_tool_utils.mjs')).href);
await fs.mkdir(path.join(DIR,'validated'),{recursive:true});
const finalPath=path.join(DIR,'validated/Signal-Pitch.pptx');
const result=await finalizePresentation({workspaceDir:ROOT,candidatePath:candidate,finalPath,pythonExecutable:PYTHON,integrityValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],explicitTotalSlideCount:8,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'reference',families:['Montserrat'],referencePath:SOURCE,referenceSha256:createHash('sha256').update(await fs.readFile(SOURCE)).digest('hex')},verifyArtifactToolImport:true,receiptPath:path.join(DIR,'validation.json')});
console.log(JSON.stringify(result));
const exact=await PresentationFile.importPptx(await FileBlob.load(finalPath));
exact.view.hideGuides();exact.view.hideGridlines();
for(let i=0;i<exact.slides.items.length;i++){const b=await exact.slides.items[i].export({format:'png',scale:1.5});await fs.writeFile(path.join(DIR,`final-slide-${i+1}.png`),new Uint8Array(await b.arrayBuffer()));}
execFileSync(PYTHON,[path.join(ROOT,'scripts/build-pitch-pdf.py'),DIR],{stdio:'inherit'});
const provenance={generatedAt:new Date().toISOString(),buildDir:DIR,template:SOURCE,templateSourceSlides:selected.map(x=>x+1),templateSha256:createHash('sha256').update(await fs.readFile(SOURCE)).digest('hex'),config:CONFIG,exactSavedPptxImportedAndRendered:true,editable:true,pdf:'Visual fallback from exact final PPTX renders; editable text is in PPTX',powerPointNativeCheck:false,finalizer:path.join(DIR,'validation.json')};
provenance.pptxSha256=createHash('sha256').update(await fs.readFile(finalPath)).digest('hex');
provenance.pdfSha256=createHash('sha256').update(await fs.readFile(path.join(DIR,'Signal-Pitch.pdf'))).digest('hex');
for(const key of Object.keys(CONFIG.screenshots)){const file=path.resolve(ROOT,CONFIG.screenshots[key]);provenance[key+'ScreenshotSha256']=createHash('sha256').update(await fs.readFile(file)).digest('hex');}
await fs.writeFile(path.join(DIR,'provenance.json'),JSON.stringify(provenance,null,2));
// Review every exact final render before explicitly copying these unchanged files to submission.
console.log('Pitch build:',DIR);

