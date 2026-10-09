import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { ResumeInput } from './signal-resume-contract';
import { canonicalSkillKey, resolveSkill } from './skill-catalog';
import { getSkillQualification } from './skill-module-qualification';
import { resumeAffiliatedSkillKeys, resumeAffiliationKey, resumeSkillModule } from './resume-skill-affiliation';

export type ResumeDocumentSection = { title: string; paragraphs: { text: string; link?: string }[] };
export type ResumeDocument = {
  resumeId: number; revision: number; projectionVersion: string; title: string; name: string; specialization: string;
  contactsAllowed: boolean; contactsPermitted: boolean; audience: 'owner'|'employer'; sections: ResumeDocumentSection[];
  composition: ResumeDocumentField[];
  skillChips?: { label: string; status: 'verified'|'declared'; level?: string }[];
};
/** Optional file sections. Profile/grade remain a truthful, source-labelled header. */
export const resumeDocumentFields = ['contacts','salary','conditions','summary','skills','experience','projects','education','portfolio','softSkills'] as const;
export type ResumeDocumentField = typeof resumeDocumentFields[number];
export function parseResumeDocumentFields(raw: unknown): ResumeDocumentField[] {
  if (raw === undefined) return [...resumeDocumentFields];
  if (typeof raw !== 'string') throw new Error('Некорректный состав файла.');
  const requested = raw === '' ? [] : raw.split(',');
  if (requested.some(value => !resumeDocumentFields.includes(value as ResumeDocumentField))) throw new Error('Неизвестный раздел файла.');
  return resumeDocumentFields.filter(field => requested.includes(field));
}

export type ResumeDocumentAccessSnapshot = {resumeId:number;revision:number;contactsPermitted:boolean;publicIdentity:boolean;identityRevision:string;projectionVersion:string};
/** Discard a completed projection if rights or source changed during asynchronous rendering. */
export async function guardResumeDocumentProjection<T>(initial:ResumeDocumentAccessSnapshot,render:()=>Promise<T>,reauthorize:()=>Promise<ResumeDocumentAccessSnapshot|null>) {
  const output=await render();
  const current=await reauthorize();
  if(!current)return {status:'unavailable' as const,output:null};
  if((Object.keys(initial) as (keyof ResumeDocumentAccessSnapshot)[]).some(key=>initial[key]!==current[key]))return {status:'changed' as const,output:null};
  return {status:'allowed' as const,output};
}
export type DocumentProfile = {
  displayName: string; professionalAlias: string; contactEmail: string|null; phone: string|null;
  title: string; specialization: string; assumedGrade: string; verifiedGrade: string|null;
  verifiedSkills: string[]; stack: string[]; skills: string[]; yearsExperience: number; workFormat: string;
  salaryMin: number|null; salaryMax: number|null; salaryPeriod: string; salaryType: string;
};
export type DocumentQualification = { verifiedGrade: string|null; skills: { label: string; level: string; programVersion: string; verifiedAt: string|Date; evidenceId?:number; attemptId?:number }[]; coverage?: {skillId:string|null}[]; category: { matrixVersion: string;requirements?:{id:string;skillId:string;level:string;evidenceId:number;attemptId:number;programVersion:string;verifiedAt:string}[] }|null; source: string; limitation?: string|null; historical?:{date:string|null;programVersion:string|null;attemptId?:number|null} };
export type DocumentPreferences = { location: string; schedule: string; employment: string; relocation: boolean; startAvailability: string };
const professionLabel = (value:string) => value==='Backend / Python'?'Backend-разработчик':value==='Frontend / TypeScript'?'Frontend-разработчик':value;
const skillLabel = (value:string) => resumeSkillModule(value)?.title ?? resolveSkill(value).label;
/** Filter before prose, chips and source fingerprint, using exactly the CV's
 * affiliation. A proof earned with another CV is still reusable when related. */
export function documentSkillProofs(profile:Pick<DocumentProfile,'specialization'|'assumedGrade'|'stack'|'skills'>, qualification:DocumentQualification):DocumentQualification['skills'] {
  const assumedGrade=profile.assumedGrade==='Middle'||profile.assumedGrade==='Senior'?profile.assumedGrade:'Junior';
  const coverage=qualification.coverage??getSkillQualification({...profile,userId:0,assumedGrade},{evidence:[],revokedIds:new Set()}).coverage;
  const related=new Set(resumeAffiliatedSkillKeys(profile,coverage));
  const levels:Record<string,number>={Junior:1,Middle:2,Senior:3};
  const proofs=new Map<string,DocumentQualification['skills'][number]>();
  const date=(proof:DocumentQualification['skills'][number])=>new Date(proof.verifiedAt).valueOf()||0;
  for(const proof of qualification.skills){
    const key=resumeAffiliationKey(proof.label);
    if(!related.has(key)||!['Junior','Middle','Senior'].includes(proof.level))continue;
    const previous=proofs.get(key);
    if(!previous||levels[proof.level]>levels[previous.level]||levels[proof.level]===levels[previous.level]&&
      (date(proof)>date(previous)||date(proof)===date(previous)&&((proof.evidenceId??0)>(previous.evidenceId??0)||proof.evidenceId===previous.evidenceId&&(proof.attemptId??0)>(previous.attemptId??0)))){
      proofs.set(key,{...proof,label:skillLabel(proof.label)});
    }
  }
  return [...proofs.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,proof])=>proof);
}
const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\t/g, '  ');
const normalized = (value: string) => clean(value.normalize('NFKC')).replace(/[\u200b-\u200d\u2060\ufeff]/g,'');
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function safeDocumentLink(value: string): string | undefined {
  try { const url = new URL(clean(value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}

/** Employer documents never reuse the owner bytes. Remove contacts from every string and hyperlink, including free prose. */
export function restrictedDocumentText(value: string, profile: Pick<DocumentProfile,'displayName'|'contactEmail'|'phone'>, anonymous: boolean) {
  let text = normalized(value);
  for (const item of [profile.contactEmail, profile.phone, anonymous ? profile.displayName : null].filter((item): item is string => Boolean(item)).map(normalized)) text = text.replace(new RegExp(escapeRegex(item), 'giu'), '[скрыто]');
  if (anonymous) for (const namePart of normalized(profile.displayName).split(/\s+/).filter(s => s.length >= 3)) text = text.replace(new RegExp(`(?<![\\p{L}])${escapeRegex(namePart)}(?![\\p{L}])`, 'giu'), '[скрыто]');
  // Dates are structured résumé content, not phone numbers. Mask them while applying the telephone recognizer.
  const dates:string[]=[];text=text.replace(/\b(?:(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])|(?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.(?:19|20|21)\d{2})\b/g,date=>{dates.push(date);return `DATEPLACEHOLDER${String.fromCharCode(0xE000+dates.length-1)}`;});
  text=text.replace(/(?:https?:\/\/|www\.)\S+/giu, '[ссылка скрыта]').replace(/[\p{L}\p{N}._%+\-]+\s*(?:@|\[at\]|\(at\))\s*[\p{L}\p{N}.\-]+\.[\p{L}]{2,}/giu, '[email скрыт]').replace(/(?:\+?\d[\s().\-]*){7,}/gu, '[телефон скрыт]').replace(/@[\p{L}\p{N}_]{3,}/gu, '[контакт скрыт]').replace(/(?:t\.me|telegram\.me|wa\.me|vk\.com)\/\S+/giu, '[контакт скрыт]');
  return text.replace(/DATEPLACEHOLDER([\uE000-\uF8FF])/g,(_,letter:string)=>dates[letter.charCodeAt(0)-0xE000]??'');
}
export function projectResumeDocument(input: {
  resumeId: number; revision: number; profile: DocumentProfile; content: ResumeInput;
  audience: 'owner'|'employer'; contactsAllowed: boolean; publicIdentity: boolean;
  qualification: DocumentQualification; preferences: DocumentPreferences;
  fields?: readonly ResumeDocumentField[];
}): ResumeDocument {
  const { profile: p, content: r, preferences: w } = input;
  const q={...input.qualification,skills:documentSkillProofs(p,input.qualification)};
  // The caller may narrow access; a selected field never grants access.
  const maySeeContacts = input.audience === 'owner' || input.contactsAllowed;
  const selected = parseResumeDocumentFields(input.fields?.join(','));
  const composition = selected.filter(field => (field !== 'contacts' && field !== 'portfolio') || (maySeeContacts && selected.includes('contacts')));
  const includes = (field: ResumeDocumentField) => composition.includes(field);
  const unrestricted = maySeeContacts && includes('contacts');
  const identityAllowed = input.audience === 'owner' || input.contactsAllowed || input.publicIdentity;
  const text = (value: string) => unrestricted ? clean(value) : restrictedDocumentText(value, p, !identityAllowed);
  const sections: ResumeDocumentSection[] = [];
  // Only these internal builders may bypass the free-text phone recognizer.
  // They accept validated typed data, never caller-supplied paragraph flags.
  const structured = new Set<object>();
  const safeDateRange=/^(?:19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2]))? - (?:(?:19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2]))?|по настоящее время|обучаюсь)$/;
  const dateRange = (start:string,end:string|null,ongoing:string) => {const paragraph={text:`${start} - ${end ?? ongoing}`};if(safeDateRange.test(paragraph.text))structured.add(paragraph);return paragraph;};
  const validAmount=(amount:number|null)=>amount===null||(Number.isSafeInteger(amount)&&amount>=0);
  const salary = validAmount(p.salaryMin)&&validAmount(p.salaryMax)&&['month','year'].includes(p.salaryPeriod)&&['gross','net'].includes(p.salaryType)&&(p.salaryMin!==null||p.salaryMax!==null) ? {text:`Ожидания: ${p.salaryMin===null?'':`от ${p.salaryMin}`} ${p.salaryMax===null?'':`до ${p.salaryMax}`} ₽ / ${p.salaryPeriod==='year'?'год':'месяц'}, ${p.salaryType==='net'?'на руки':'до вычета налогов'}`} : null;
  if(salary)structured.add(salary);
  const add = (title: string, paragraphs: (string|{text:string;link?:string})[]) => {
    const values = paragraphs.map(value => {if(typeof value==='string')return{text:text(value)};const link=unrestricted&&value.link?safeDocumentLink(value.link):undefined;return{text:structured.has(value)?clean(value.text):text(value.text),...(link?{link}:{})};}).filter(value => value.text.trim());
    if (values.length) sections.push({title,paragraphs:values});
  };
  const source = q.source === 'skill_matrix' || q.category ? 'по матрице навыков' : q.source==='assessment' ? 'по комплексному экзамену' : 'исторический общий грейд';
  add('Профессиональный профиль', [`Профессия: ${professionLabel(p.specialization)}`, q.verifiedGrade ? `Подтверждённый грейд: ${q.verifiedGrade} · ${source}` : p.assumedGrade ? `Заявленный грейд: ${p.assumedGrade}` : 'Грейд не указан', ...(q.category ? [`Матрица: ${q.category.matrixVersion}`] : []), ...(q.verifiedGrade&&q.source!=='skill_matrix'&&q.historical?.date ? [`Дата проверки: ${new Date(q.historical.date).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})}`] : []), ...(q.verifiedGrade&&q.source!=='skill_matrix'&&q.historical?.programVersion ? [`Программа: ${q.historical.programVersion}`] : [])]);
  let skillChips: ResumeDocument['skillChips'];
  if (includes('skills')) {
    // Canonical aliases only; a SQL result never proves PostgreSQL.
    const proofs = new Map(q.skills.map(skill => [resumeAffiliationKey(skill.label), skill]));
    const labels = new Map([...p.stack, ...p.skills, ...q.skills.map(skill=>skill.label)].map(label => [resumeAffiliationKey(label),skillLabel(label)]));
    add('Навыки', [...labels.entries()].map(([key,label]) => {const skill=proofs.get(key);return skill ? `${skill.label} - ${skill.level}. Проверка ${skill.programVersion}, ${new Date(skill.verifiedAt).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'})}` : `${label} · заявлен`; }));
    // Only the caller's current individual module proofs provide a skill level.
    // An aggregate or historical grade never promotes stated technologies.
    const levels:Record<string,number>={Junior:1,Middle:2,Senior:3};
    const currentProofs=new Map<string,DocumentQualification['skills'][number]>();
    for(const proof of q.skills)if(['Junior','Middle','Senior'].includes(proof.level)){
      const key=resumeAffiliationKey(proof.label),previous=currentProofs.get(key);
      if(!previous||levels[proof.level]>levels[previous.level])currentProofs.set(key,proof);
    }
    skillChips=[...labels.entries()].map(([key,label])=>{
      const proof=currentProofs.get(key);
      return {label:text(label),status:proof?'verified' as const:'declared' as const,...(proof?{level:proof.level}:{})};
    });
  }
  if (unrestricted) add('Контакты', [p.contactEmail ?? '', p.phone ?? '']);
  if (includes('summary')) add('О себе', [r.summary]);
  const workParagraphs:(string|{text:string})[]=[...(Number.isSafeInteger(p.yearsExperience)&&p.yearsExperience>=0&&p.yearsExperience<=60?[`Опыт: ${p.yearsExperience} лет`]:[]), `Формат: ${p.workFormat}`, w.location && `Локация: ${w.location}`, w.schedule && `График: ${w.schedule}`, w.employment && `Занятость: ${w.employment}`, `Релокация: ${w.relocation ? 'готовность обсуждать' : 'не рассматривается'}`, w.startAvailability && `Выход на работу: ${w.startAvailability}`].filter((v):v is string=>Boolean(v));
  if(includes('conditions')) add('Условия работы',workParagraphs);
  if(includes('salary')&&salary) add('Зарплатные ожидания',[salary]);
  if(includes('experience')) for (const job of r.experience) add('Опыт работы', [`${job.role} - ${job.company}`, dateRange(job.start,job.end,'по настоящее время'), job.description]);
  if(includes('projects')) for (const project of r.projects) add('Проект', [project.title, project.role, project.description, ...(project.url && unrestricted ? [{text:project.url,link:project.url}] : [])]);
  if(includes('education')) for (const education of r.education) add('Образование', [education.institution, education.qualification, dateRange(education.start,education.end,'обучаюсь')]);
  if (unrestricted&&includes('portfolio')) add('Портфолио', r.portfolio.map(link => ({text:`${link.title}: ${link.url}`,link:link.url})));
  if(includes('softSkills')) add('Личные навыки', r.softSkills.length ? [r.softSkills.join(', ')] : []);
  const projection={resumeId:input.resumeId, revision:input.revision, title:text(p.title), name:identityAllowed ? text(p.displayName) : text(p.professionalAlias) || 'Профессиональный профиль', specialization:text(professionLabel(p.specialization)), contactsAllowed:unrestricted, contactsPermitted:maySeeContacts, audience:input.audience, composition, sections,...(skillChips?{skillChips}:{})};
  // Hash the effective permitted document, not the private input or a wall clock. Exact
  // source provenance also matters: same-day proof replacement/correction may leave
  // the displayed aggregate grade and CV revision unchanged. Only selected, exposed
  // evidence participates; excluded contacts/sections cannot act as a change oracle.
  const exactDate=(date:string|Date)=>{const value=new Date(date);return Number.isNaN(value.valueOf())?text(String(date)):value.toISOString();};
  const evidence=includes('skills')?[...new Map(q.skills.map(skill=>[canonicalSkillKey(skill.label),skill])).values()].map(skill=>({
    label:text(skill.label),level:text(skill.level),programVersion:text(skill.programVersion),verifiedAt:exactDate(skill.verifiedAt),
    evidenceId:Number.isSafeInteger(skill.evidenceId)?skill.evidenceId:null,attemptId:Number.isSafeInteger(skill.attemptId)?skill.attemptId:null,
  })).sort((a,b)=>a.label.localeCompare(b.label)||a.level.localeCompare(b.level)):[];
  const qualification=q.verifiedGrade?{source,grade:text(q.verifiedGrade),matrixVersion:q.category?text(q.category.matrixVersion):null,
    categoryRequirements:q.category?.requirements?.map(r=>({id:text(r.id),skillId:text(r.skillId),level:text(r.level),evidenceId:r.evidenceId,attemptId:r.attemptId,programVersion:text(r.programVersion),verifiedAt:exactDate(r.verifiedAt)})).sort((a,b)=>a.id.localeCompare(b.id))??null,
    historicalDate:q.source!=='skill_matrix'&&q.historical?.date?exactDate(q.historical.date):null,
    historicalProgram:q.source!=='skill_matrix'&&q.historical?.programVersion?text(q.historical.programVersion):null,
    historicalAttempt:q.source!=='skill_matrix'&&Number.isSafeInteger(q.historical?.attemptId)?q.historical!.attemptId:null,
  }:null;
  // The saved CV revision can advance when an unrelated account proof arrives.
  // Keep it in the DTO and render guard, but hash only effective document content.
  const {revision:_revision,...contentProjection}=projection;
  const projectionVersion=`signal-document-v1:${createHash('sha256').update(JSON.stringify({projection:contentProjection,qualification,evidence})).digest('hex')}`;
  return {...projection,projectionVersion};
}
export async function renderResumeDocx(model: ResumeDocument): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({text:model.name,heading:HeadingLevel.TITLE}),new Paragraph({text:model.title,spacing:{after:200}})];
  for (const section of model.sections) {
    children.push(new Paragraph({text:section.title,heading:HeadingLevel.HEADING_1,keepNext:true,spacing:{before:230,after:100}}));
    for (const item of section.paragraphs) children.push(new Paragraph({children:item.link ? [new ExternalHyperlink({link:item.link,children:[new TextRun({text:item.text,style:'Hyperlink'})]})] : [new TextRun(item.text)],spacing:{after:110,line:280}}));
  }
  return Packer.toBuffer(new Document({creator:'Signal',lastModifiedBy:'Signal',title:'Резюме',description:'Профессиональный профиль',styles:{default:{document:{run:{font:'Arial',size:21,color:'302B28'}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',next:'Normal',run:{font:'Arial',size:42,bold:true,color:'302B28'}},{id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',run:{font:'Arial',size:25,bold:true,color:'405F78'}}]},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:850,right:900,bottom:850,left:900}}},children}]}));
}
function font(weight='Regular') {
  const options=[path.resolve(process.cwd(),`artifacts/api-server/assets/fonts/Manrope-${weight}.ttf`),path.resolve(process.cwd(),`assets/fonts/Manrope-${weight}.ttf`),fileURLToPath(new URL(`../../assets/fonts/Manrope-${weight}.ttf`,import.meta.url))];
  const found=options.find(existsSync);if(!found)throw new Error('Resume font missing');return found;
}
export function renderResumePdf(model: ResumeDocument): Promise<Buffer> {
  return new Promise((resolve,reject)=>{try{
    const regular=font(),bold=font('SemiBold'); const doc=new PDFDocument({size:'A4',margins:{top:45,left:48,right:48,bottom:48},font:regular,bufferPages:true,info:{Title:'Резюме',Author:'Signal',Subject:'Профессиональный профиль'}});
    const chunks:Buffer[]=[];doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
    const width=doc.page.width-96;
    doc.font(bold).fontSize(23).fillColor('#302B28').text(model.name,{width,lineGap:3});
    doc.font(regular).fontSize(11).fillColor('#62574F').text(model.title,{width,lineGap:3});
    for(const section of model.sections){
      if(doc.y+72>doc.page.height-48)doc.addPage();doc.moveDown(.65);doc.font(bold).fontSize(12).fillColor('#405F78').text(section.title,{width,lineGap:3});doc.moveDown(.25);
      for(const item of section.paragraphs){doc.font(regular).fontSize(10).fillColor('#302B28').text(item.text,{width,lineGap:3,...(item.link?{link:item.link}: {})});doc.moveDown(.35);}
    }
    const pages=doc.bufferedPageRange();for(let i=pages.start;i<pages.start+pages.count;i++){doc.switchToPage(i);doc.page.margins.bottom=0;doc.font(regular).fontSize(8).fillColor('#62574F').text(`Signal  ${i+1} / ${pages.count}`,48,doc.page.height-29,{width,align:'right',lineBreak:false});}doc.end();
  }catch(error){reject(error);}});
}
