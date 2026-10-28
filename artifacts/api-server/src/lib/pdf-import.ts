import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { SKILL_CATALOG } from './skill-catalog';
import type { PdfImportFields, PdfImportFragment } from '@workspace/db';

export class PdfImportError extends Error {
 constructor(public status:number, public code:string, message:string) {super(message);}
}
export const PDF_IMPORT_LIMIT = 5_242_880;
const workerErrors:Record<string,string>={
 PDF_TYPE_OR_SIZE:'Загрузите PDF размером до 5 МБ.', PDF_ENCRYPTED:'Снимите пароль с PDF перед импортом.',
 PDF_LIMIT:'В PDF должно быть не более 12 страниц.', PDF_PAGE_LIMIT:'Размер страницы PDF слишком большой.',
 PDF_EXPANSION_LIMIT:'Распакованное содержимое PDF превышает ограничение.', PDF_TEXT_LIMIT:'В PDF слишком много текста.',
 PDF_PARSE_FAILED:'Не удалось разобрать PDF. Попробуйте сохранить документ заново.',
};
let active = 0;
export async function extractVisiblePdf(data:Buffer):Promise<{fragments:PdfImportFragment[];pages:number;warnings:string[];engine:string}> {
 if(data.length>PDF_IMPORT_LIMIT || data.subarray(0,5).toString('ascii')!=='%PDF-') throw new PdfImportError(400,'PDF_TYPE_OR_SIZE',workerErrors.PDF_TYPE_OR_SIZE);
 if(active>=2) throw new PdfImportError(429,'PDF_BUSY','Импорт занят. Повторите через минуту.');
 const name=`signal-pdf-${randomUUID()}`;
 const docker=process.env.SIGNAL_DOCKER_BIN || 'docker';
 const image=process.env.SIGNAL_PDF_IMAGE || 'signal-pdf-import:1';
 active++;
 try{return await new Promise((resolve,reject)=>{
  const child=spawn(docker,['run','--rm','--pull=never','--name',name,'--network=none','--read-only','--memory=256m','--memory-swap=256m','--cpus=1','--pids-limit=32','--cap-drop=ALL','--security-opt=no-new-privileges','--user=65532:65532','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m','-i',image],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,USERPROFILE:process.env.USERPROFILE,DOCKER_HOST:process.env.DOCKER_HOST}});
  let output='',settled=false;
  const stop=()=>{child.kill();const cleanup=spawn(docker,['rm','--force',name],{stdio:'ignore',windowsHide:true});cleanup.on('error',()=>{});};
  const finish=(error?:Error,value?:any)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{stop();finish(new PdfImportError(422,'PDF_TIMEOUT','Обработка заняла слишком долго. Упростите PDF и повторите.'));},15_000);
  child.on('error',()=>finish(new PdfImportError(503,'PDF_WORKER_UNAVAILABLE','Импорт PDF временно недоступен. Резюме можно заполнить вручную.')));
  child.stdin.on('error',()=>{});
  child.stdout.setEncoding('utf8');
  child.stderr.on('data',()=>{}); // Never log document contents or parser diagnostics.
  child.stdout.on('data',part=>{output+=part.toString('utf8');if(Buffer.byteLength(output)>1_500_000){stop();finish(new PdfImportError(422,'PDF_OUTPUT_LIMIT','В документе слишком много данных.'));}});
  child.on('close',code=>{
   if(settled)return;
   if(code!==0)return finish(new PdfImportError(code===125?503:422,'PDF_WORKER_FAILED',code===125?'Импорт PDF временно недоступен.':'Документ превысил ограничения обработки или повреждён.'));
   try {const value=JSON.parse(output);if(value.error)return finish(new PdfImportError(422,value.error,workerErrors[value.error]??workerErrors.PDF_PARSE_FAILED));
    if(!Array.isArray(value.fragments)||!Array.isArray(value.warnings)||typeof value.engine!=='string')throw new Error();
    finish(undefined,value);
   }catch{finish(new PdfImportError(422,'PDF_PARSE_FAILED',workerErrors.PDF_PARSE_FAILED));}
  });
  child.stdin.end(JSON.stringify({data:data.toString('base64')}));
 });}finally{active--;}
}
export function pdfImportFields(fragments:PdfImportFragment[]):{fields:PdfImportFields;provenance:Record<keyof PdfImportFields,number[]>} {
 const skillFragments=new Map<string,number[]>();
 for(const skill of SKILL_CATALOG){
  const aliases=[skill.id,skill.label,...skill.aliases].filter(a=>a.length>2);
  const ids=fragments.filter(f=>aliases.some(a=>new RegExp(`(?<![\\p{L}\\p{N}_])${a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}_])`,'iu').test(f.text))).map(f=>f.id);
  if(ids.length)skillFragments.set(skill.label,ids);
 }
 const summaryFragments:PdfImportFragment[]=[];let length=0;
 for(const fragment of fragments){if(length+fragment.text.length+1>5000)break;summaryFragments.push(fragment);length+=fragment.text.length+1;}
 return {fields:{summary:summaryFragments.map(f=>f.text).join('\n'),skills:[...skillFragments.keys()].slice(0,40)},
  provenance:{summary:summaryFragments.map(f=>f.id),skills:[...new Set([...skillFragments.values()].flat())]}};
}
