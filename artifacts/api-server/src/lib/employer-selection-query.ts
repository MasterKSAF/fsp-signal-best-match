import { z } from 'zod';
import { canonicalSkillKey } from './skill-catalog';
import { matchesCatalogFilters, type CatalogResume } from './signal-resume-catalog';
import { gradeRank, type MatchEvaluation } from './signal-matching';
import { postgresIntIdInputSchema } from './postgres-id';

const grade = z.enum(['Junior','Middle','Senior']);
const text = (max:number) => z.string().trim().min(1).max(max).optional();
const numeric = (max:number) => z.coerce.number().finite().min(0).max(max).optional();
export const SelectionScopeQuery = z.object({
  contextType:z.enum(['job','need']).optional(),contextId:postgresIntIdInputSchema.optional(),
  mode:z.literal('catalog').optional(),
  view:z.enum(['all','shortlisted']).optional(),
});
export const SelectionQuery = SelectionScopeQuery.extend({
  q:text(120),specialization:text(160),grade:grade.or(z.literal('unconfirmed')).optional(),
  verifiedSkills:text(1600),verifiedSkillsMode:z.enum(['all','any']).default('all'),verifiedSkillLevel:grade.optional(),
  declaredSkills:text(1600),declaredSkillsMode:z.enum(['all','any']).default('all'),
  experienceMin:numeric(80),experienceMax:numeric(80),workFormat:text(80),location:text(160),
  salaryMin:numeric(1_000_000_000),salaryMax:numeric(1_000_000_000),
  salaryPeriod:z.enum(['month','year']).optional(),salaryType:z.enum(['gross','net']).optional(),
  fsp:z.enum(['yes','no']).optional(),hasPhoto:z.enum(['yes','no']).optional(),readyForOffers:z.enum(['yes','no']).optional(),checkedWithinDays:numeric(3650),
  page:z.coerce.number().int().min(1).max(1_000_000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20),
  sort:z.enum(['recommended','grade','experience','salary','updated','name']).default('recommended'),direction:z.enum(['asc','desc']).default('desc'),
  view:z.enum(['all','shortlisted']).default('all'),
}).strict().superRefine((input,ctx)=>{
  if (!!input.contextType !== !!input.contextId) ctx.addIssue({code:'custom',message:'Выберите контекст целиком.'});
  if (input.view==='shortlisted' && !input.contextId) ctx.addIssue({code:'custom',message:'Выберите вакансию или запрос.'});
  if ((input.salaryMin!==undefined||input.salaryMax!==undefined)&&(!input.salaryPeriod||!input.salaryType))ctx.addIssue({code:'custom',message:'Укажите период и способ расчёта зарплаты.'});
  if (input.salaryMin!==undefined&&input.salaryMax!==undefined&&input.salaryMax<input.salaryMin)ctx.addIssue({code:'custom',message:'Проверьте диапазон зарплаты.'});
  if (input.experienceMin!==undefined&&input.experienceMax!==undefined&&input.experienceMax<input.experienceMin)ctx.addIssue({code:'custom',message:'Проверьте диапазон опыта.'});
});
export type SelectionQueryInput=z.infer<typeof SelectionQuery>;
export type SelectionResume=CatalogResume & {location:string;updatedAt:Date};
export const skillKeys=(value?:string)=>[...new Set((value??'').split(',').map(item=>item.trim()).filter(Boolean).map(canonicalSkillKey))];
export function verifiedSkillLevels(row:CatalogResume) {
  const values=new Map<string,number>();
  for(const proof of row.skillEvidence??[]) if(proof.sourceType==='signal_skill_module'&&proof.level&&gradeRank[proof.level]) {
    const key=canonicalSkillKey(proof.skill);values.set(key,Math.max(values.get(key)??0,gradeRank[proof.level]));
  }
  return values;
}
/** Every predicate evaluates the same whole CV, before person deduplication or pagination. */
export function matchesSelectionFilters(row:SelectionResume,input:SelectionQueryInput,now=new Date()) {
  const {q,location,...catalog}=input;
  if(q && ![row.alias,...(row.visibility==='public'&&row.publicName?[row.publicName]:[])].some(value=>value.toLocaleLowerCase('ru-RU').includes(q.toLocaleLowerCase('ru-RU'))))return false;
  if(location&&row.location.toLocaleLowerCase('ru-RU')!==location.toLocaleLowerCase('ru-RU'))return false;
  if(!matchesCatalogFilters(row,catalog,now))return false;
  const verified=verifiedSkillLevels(row), requested=skillKeys(input.verifiedSkills);
  if(requested.length) {
    const accepts=(key:string)=>(verified.get(key)??0)>=(input.verifiedSkillLevel?gradeRank[input.verifiedSkillLevel]:1);
    if(!(input.verifiedSkillsMode==='any'?requested.some(accepts):requested.every(accepts)))return false;
  }
  const stated=new Set([...row.stack,...row.statedSkills].map(canonicalSkillKey));
  const declared=skillKeys(input.declaredSkills);
  if(declared.length&&!(input.declaredSkillsMode==='any'?declared.some(key=>stated.has(key)):declared.every(key=>stated.has(key))))return false;
  return true;
}
export type SelectionPerson={selected:SelectionResume;alternatives:SelectionResume[];evaluation?:MatchEvaluation};
const name=(row:CatalogResume)=>row.visibility==='public'&&row.publicName?row.publicName:row.alias;
/** Unknown values stay last; ties always use identity. Salary ordering never
 * mixes gross and net, and converts known yearly amounts to monthly amounts. */
export function sortSelection(people:SelectionPerson[],input:Pick<SelectionQueryInput,'sort'|'direction'>) {
  if(input.sort==='recommended')return input.direction==='asc'?[...people].reverse():people;
  const sign=input.direction==='asc'?1:-1;
  const value=(row:SelectionResume):number|string|null=>{
    switch(input.sort){
      case 'grade':return row.verifiedGrade?gradeRank[row.verifiedGrade]:null;
      case 'experience':return row.yearsExperience;
      case 'updated':return row.updatedAt.getTime();
      case 'name':return name(row).toLocaleLowerCase('ru-RU');
      case 'salary':return row.salaryMin!=null&&row.salaryPeriod&&row.salaryType?row.salaryMin/(row.salaryPeriod==='year'?12:1):null;
      default:return null;
    }
  };
  return [...people].sort((left,right)=>{
    const a=value(left.selected),b=value(right.selected);
    if(a===null&&b!==null)return 1;if(b===null&&a!==null)return -1;
    if(input.sort==='salary'&&a!==null&&b!==null&&left.selected.salaryType!==right.selected.salaryType)return left.selected.salaryType==='gross'?-1:1;
    const order=typeof a==='string'&&typeof b==='string'?a.localeCompare(b,'ru'):typeof a==='number'&&typeof b==='number'?a-b:0;
    return sign*order||left.selected.userId-right.selected.userId||left.selected.resumeId-right.selected.resumeId;
  });
}
export function selectionMatchSummary(evaluation:MatchEvaluation) {
  return {eligible:evaluation.eligible,score:evaluation.eligible?evaluation.ranking.businessFitScore:null,
    ineligibilityReasons:evaluation.ineligibilityReasons,gaps:evaluation.gaps,evidence:evaluation.evidence,
    summary:evaluation.eligible?'Соответствие выбранным требованиям к навыкам, грейду и условиям вакансии или запроса.':'Текущие требования не совпадают с выбранным резюме.',
    salaryNote:evaluation.salaryCompatibility==='unknown'?'Недостаточно сопоставимых данных о периоде или расчёте зарплаты.':null};
}
/** Public employer projection deliberately excludes exam answers, provenance
 * dumps, hidden identity, free-form contacts and private account metadata. */
export function selectionCandidate(row:SelectionResume,alternatives:SelectionResume[],evaluation?:MatchEvaluation,shortlisted=false,needsReview=false) {
  const bySkill=new Map<string,{label:string;status:'verified'|'declared';level?:string}>();
  for(const proof of row.skillEvidence??[])if(proof.sourceType==='signal_skill_module'&&proof.level&&gradeRank[proof.level]) {
    const key=canonicalSkillKey(proof.skill),prior=bySkill.get(key);
    if(!prior?.level||gradeRank[proof.level]>(gradeRank[prior.level as keyof typeof gradeRank]??0))bySkill.set(key,{label:proof.skill,status:'verified',level:proof.level});
  }
  for(const skill of [...row.stack,...row.statedSkills])if(!bySkill.has(canonicalSkillKey(skill)))bySkill.set(canonicalSkillKey(skill),{label:skill,status:'declared'});
  return {candidateId:row.userId,resumeId:row.resumeId,resumeRevision:row.resumeRevision,title:row.title,specialization:row.specialization,
    alias:row.alias,publicName:row.visibility==='public'?row.publicName:null,avatarDataUrl:row.visibility==='public'?row.avatarDataUrl:null,
    verifiedGrade:row.verifiedGrade,declaredGrade:row.assumedGrade,skillChips:[...bySkill.values()],stack:row.stack,yearsExperience:row.yearsExperience,
    workFormat:row.workFormat,location:row.location,salaryMin:row.salaryMin,salaryMax:row.salaryMax,salaryPeriod:row.salaryPeriod??null,salaryType:row.salaryType??null,
    fspHistory:row.hasFspHistory,shortlisted,needsReview,availableResumes:alternatives.map(item=>({id:item.resumeId,title:item.title,specialization:item.specialization,grade:item.verifiedGrade})),
    ...(evaluation?{match:selectionMatchSummary(evaluation)}:{})};
}
