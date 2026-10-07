/** Versioned presentation builder. Preparation/check-only does not load render runtime. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {validateFullLoadProof,validateCleanSourceProof} from './lib/presentation-facts-v050.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const CONTENT_PATH=path.join(ROOT,'docs/presentation-content-0.5.0.json');
const contentBytes=await fs.readFile(CONTENT_PATH),content=JSON.parse(contentBytes);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtimeNode='C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';
const runtimeModules=process.env.ARTIFACT_NODE_MODULES??'C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const runtimePython=process.env.ARTIFACT_PYTHON??'C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const skill=process.env.PRESENTATIONS_SKILL_DIR??'C:/Users/Misha/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const option=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1];};
assert.equal(content.applicationVersion,'0.5.0');assert.equal(content.slideCount,10);assert.equal(content.slides.length,10);
assert.equal(JSON.parse(await fs.readFile(path.join(ROOT,'package.json'),'utf8')).version,'0.5.0');
function inside(relative) {
  assert.equal(typeof relative,'string');assert.ok(!path.isAbsolute(relative)&&!relative.includes('\\'));
  const resolved=path.resolve(ROOT,relative),parts=relative.split('/');
  assert.ok(!parts.some(p=>['..','.','private','local-backup'].includes(p))&&!parts.slice(0,-1).some(p=>p.startsWith('clean-')));assert.ok(resolved.startsWith(ROOT+path.sep));return resolved;
}
async function recordedProof(record) {
  assert.match(record?.sha256??'',/^[a-f0-9]{64}$/);assert.ok(record.path?.startsWith('outputs/'));assert.ok(record.path?.endsWith('.json'));
  const bytes=await fs.readFile(inside(record.path));assert.equal(sha(bytes),record.sha256,'Referenced proof bytes changed');return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
}
const sourceScreens={};
for(const [key,record]of Object.entries(content.screenshots)) {
  const bytes=await fs.readFile(inside(record.path));assert.equal(sha(bytes),record.sha256,`Original screenshot changed: ${key}`);
  assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);assert.equal(bytes[2],0xff);assert.equal(bytes.at(-2),0xff);assert.equal(bytes.at(-1),0xd9);
  sourceScreens[key]={...record,contentType:'image/jpeg',bytes};
}
assert.equal(Object.keys(sourceScreens).length,8);
const uses=content.slides.filter(slide=>slide.screen).map(slide=>slide.screen);assert.equal(uses.length,8);assert.equal(new Set(uses).size,8);
const browserBytes=await fs.readFile(inside(content.browserSource));
let draft=true,finalFacts=null;
const factsPath=option('--facts');
if(factsPath) {
  const facts=JSON.parse(await fs.readFile(inside(factsPath),'utf8'));assert.equal(facts.schemaVersion,1);assert.equal(facts.applicationVersion,'0.5.0');
  const load=await recordedProof(facts.load),clean=await recordedProof(facts.clean),seal=await recordedProof(facts.sourceSeal),agreement=await recordedProof(facts.mediaAgreement);
  const fullLoad=validateFullLoadProof(load),cleanResult=validateCleanSourceProof(clean,seal);
  for(const phase of [load.baseline,load.expanded]){assert.ok(Object.keys(phase.sourceHashes??{}).length>0);for(const [relative,expected]of Object.entries(phase.sourceHashes))assert.equal(sha(await fs.readFile(inside(relative))),expected,'Current source differs from measured full load');}
  assert.equal(agreement.passed,true);assert.equal(agreement.sameVisibleUI,true);assert.equal(agreement.browserSourceSha256,sha(browserBytes));
  assert.ok(Object.keys(agreement.currentUIHashes??{}).length>0);
  for(const [relative,expected]of Object.entries(agreement.currentUIHashes)){assert.ok(relative.startsWith('artifacts/fsp-signal/src/'));assert.equal(sha(await fs.readFile(inside(relative))),expected);}
  for(const [key,record]of Object.entries(sourceScreens))assert.equal(agreement.originalMediaHashes?.[key],record.sha256);
  assert.ok(Object.keys(seal.metadata?.acceptedRuntime?.sourceHashes??{}).length>0);
  for(const [relative,expected]of Object.entries(seal.metadata.acceptedRuntime.sourceHashes))assert.equal(sha(await fs.readFile(inside(relative))),expected,'Final media source changed after accepted seal');
  draft=false;finalFacts={factsPath,factsSHA:sha(await fs.readFile(inside(factsPath))),fullLoad,cleanResult,records:facts};
  content.slides[8].body=['Два независимых набора. Реальные серверные попытки.',`${fullLoad.people.toLocaleString('ru-RU')} кандидатов, 1 и 5 резюме. 32 сессии, две полные фазы.`,cleanResult.unitTests?`Чистый ZIP: ${cleanResult.unitTests} теста, offline, API и PDF.`:'Чистый ZIP: тесты, offline, API и PDF.','Доступы без готовых ответов.'];
  content.slides[8].notes='Два контролируемых проверяющих работают в отдельных server-only scopes и проходят реальные серверные попытки. Это синтетическая техническая проверка агента, не независимая человеческая экспертиза. Ответы заранее не выдаются, автопрохождения и обхода cooldown нет. Источники: docs/reviewer-access.md и docs/browser-acceptance-0.5.0.md. Фактические протоколы: '+JSON.stringify(facts)+'. Нагрузка измеряет native Windows WorkingSet, не Docker cgroup. Чистый запуск ZIP является отдельной свежей Docker-проверкой, без повторения полной нагрузки.';
}
if(process.argv.includes('--check-only')) {
  console.log(JSON.stringify({checkOnly:true,artifactWritten:false,applicationVersion:'0.5.0',draft,screenshots:8,sourceFormats:['JPEG'],slides:10,contentSHA:sha(contentBytes),browserSourceSHA:sha(browserBytes),finalFactsAccepted:!!finalFacts}));process.exit(0);
}
assert.ok(process.argv.includes('--render-approved'),'Preparation only: require explicit --render-approved after the load window is released');
assert.ok(!process.argv.includes('--publish'),'Rendering is not visual acceptance or publishing');
const buildId=option('--build-id')??new Date().toISOString().replace(/[:.]/g,'-');assert.match(buildId,/^[a-zA-Z0-9_-]{1,80}$/);
const privateRoot=path.join(ROOT,'outputs/internal/pitch-0.5.0');await fs.mkdir(privateRoot,{recursive:true});
const directory=path.join(privateRoot,buildId);await fs.mkdir(directory,{recursive:false});
const runtimeRequire=createRequire(path.join(runtimeModules,'signal-pitch-v050.cjs'));
const {FileBlob,PresentationFile}=await import(pathToFileURL(runtimeRequire.resolve('@oai/artifact-tool')).href);
const artifactRequire=createRequire(runtimeRequire.resolve('@oai/artifact-tool'));
const fontPath=path.join(ROOT,'outputs/submission/fonts/Montserrat.ttf');
const{FontLibrary}=artifactRequire('skia-canvas');FontLibrary.use('Montserrat',[fontPath]);
try{const{GlobalFonts}=runtimeRequire('@napi-rs/canvas');GlobalFonts.registerFromPath(fontPath,'Montserrat');}catch{}
const templatePath=path.resolve(ROOT,content.template),templateBytes=await fs.readFile(templatePath);
const presentation=await PresentationFile.importPptx(await FileBlob.load(templatePath));presentation.view.hideGuides();presentation.view.hideGridlines();
await fs.writeFile(path.join(directory,'template-inspection.ndjson'),(await presentation.inspect({kind:'slide,shape,textbox,image,layout',maxChars:400000})).ndjson);
const originalCover=await presentation.slides.items[6].export({format:'png',scale:1});await fs.writeFile(path.join(directory,'source-cover.png'),new Uint8Array(await originalCover.arrayBuffer()));
for(let index=presentation.slides.items.length-1;index>=0;index--)if(index!==6)presentation.slides.items[index].delete();
function text(slide,value,left,top,width,height,fontSize=26,color='#1C1D22',bold=false) {
  const shape=slide.shapes.add({geometry:'textbox',position:{left,top,width,height},fill:'none',line:{fill:'none',width:0}});shape.text=value;shape.text.style={typeface:'Montserrat',fontSize,color,bold,autoFit:'none'};return shape;
}
function edit(id,value,position,fontSize,color='#FFFFFF') {const object=presentation.resolve(id);object.text=value;object.position=position;object.text.style={typeface:'Montserrat',fontSize,color,bold:false,autoFit:'none'};}
const cover=presentation.slides.items[0];
edit('sh/dcbud0ra','Signal',{left:40,top:286,width:920,height:104},68);
text(cover,content.slides[0].subtitle,42,414,900,110,34,'#FFFFFF');
edit('sh/zedcfa9g','Цифровая платформа-агрегатор ИТ-вакансий\nс верифицированным профилем достижений участника ФСП',{left:40,top:590,width:1080,height:82},24);
text(cover,`Best Match  ·  0.5.0${draft?'  ·  Черновик':''}`,42,542,1000,32,21,'#FFFFFF');
cover.speakerNotes.textFrame.setText(content.slides[0].notes);
for(let index=1;index<content.slides.length;index++) {
  const item=content.slides[index],slide=presentation.slides.add({layoutId:'/ppt/slideLayouts/slideLayout8.xml'});slide.background.fill='#FFFFFF';
  text(slide,item.title,56,36,1168,82,44,'#520978',true);
  if(item.screen) {
    const record=sourceScreens[item.screen];
    text(slide,item.body.join('\n\n'),56,157,355,475,26);
    slide.images.add({blob:record.bytes,contentType:record.contentType,fit:'contain',position:{left:447,top:152,width:777,height:488},alt:record.description+'; real synthetic stage screenshot, original JPEG bytes'});
    text(slide,'Локальный сценарий с синтетическими данными',448,654,730,27,18,'#520978');
  } else if(index===9) {
    text(slide,item.body[0],56,170,546,274,30);text(slide,item.body[1],663,170,561,274,30);
    text(slide,item.nextSteps,56,518,1168,111,27,'#520978');
  } else {
    const top=156,spacing=item.body.length===4?112:145;
    item.body.forEach((line,row)=>text(slide,line,56,top+row*spacing,1110,102,32));
  }
  text(slide,`${index+1}`,1180,674,45,28,18,'#520978');
  if(draft)text(slide,'Черновик 0.5.0',56,674,330,28,18,'#520978');
  slide.speakerNotes.textFrame.setText(item.notes);
}
const candidatePath=path.join(directory,'candidate.pptx');await(await PresentationFile.exportPptx(presentation)).save(candidatePath);
const{finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const finalDirectory=path.join(directory,'validated');await fs.mkdir(finalDirectory);const finalPath=path.join(finalDirectory,'Signal-Pitch.pptx');
process.env.RUNTIME_NODE_MODULES=runtimeModules;
await finalizePresentation({workspaceDir:ROOT,candidatePath,finalPath,pythonExecutable:runtimePython,integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],explicitTotalSlideCount:10,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'reference',families:['Montserrat'],referencePath:templatePath,referenceSha256:sha(templateBytes)},verifyArtifactToolImport:true,receiptPath:path.join(directory,'validation.json')});
const saved=await PresentationFile.importPptx(await FileBlob.load(finalPath));saved.view.hideGuides();saved.view.hideGridlines();assert.equal(saved.slides.items.length,10);
for(let index=0;index<10;index++){const blob=await saved.slides.items[index].export({format:'png',scale:1.5});await fs.writeFile(path.join(directory,`final-slide-${index+1}.png`),new Uint8Array(await blob.arrayBuffer()));}
await fs.writeFile(path.join(directory,'final-inspection.ndjson'),(await saved.inspect({kind:'slide,textbox,shape,image',maxChars:200000})).ndjson);
execFileSync(runtimePython,[path.join(ROOT,'scripts/build-pitch-pdf-v050.py'),directory,'10'],{stdio:'inherit'});
const provenance={schemaVersion:1,applicationVersion:'0.5.0',draft,generatedAt:new Date().toISOString(),slides:10,buildDirectory:directory,pptxSHA:sha(await fs.readFile(finalPath)),pdfSHA:sha(await fs.readFile(path.join(directory,'Signal-Pitch.pdf'))),contentSHA:sha(contentBytes),templateSHA:sha(templateBytes),templateUse:'Original cover, master/layout, typography and palette; flat new content slides',fontSHA:sha(await fs.readFile(fontPath)),browserSourceSHA:sha(browserBytes),mediaCapture:{...content.mediaCapture,finalRuntimeEquivalence:finalFacts?'verified-by-recorded-proof':'pending'},screenshots:Object.fromEntries(Object.entries(sourceScreens).map(([key,record])=>[key,{path:record.path,sha256:record.sha256,actualFormat:'JPEG',retouched:false,fit:'contain'}])),finalFacts,pdfVisualCompanion:true,exactSavedPptxImportedAndRendered:true,textEditable:true,nativePowerPointChecked:false,visualReview:'pending-all10slides',published:false};
await fs.writeFile(path.join(directory,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({buildDirectory:directory,slides:10,draft,visualReview:'pending-all10slides',pptxSHA:provenance.pptxSHA,pdfSHA:provenance.pdfSHA}));
