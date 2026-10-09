import { z } from 'zod';
import { canonicalSkillKey, canonicalSkillLabels } from './skill-catalog';
import { retainedSkillLevelRequirements, validateSkillLevelRequirements } from './skill-level-requirements';
import type { MatchCandidate, SignalGrade } from './signal-matching';

export const REQUIREMENTS_VERSION = 'signal-requirements-v1' as const;
export const RequirementModeSchema = z.enum(['verified','declared_or_verified']);
export type RequirementMode = z.infer<typeof RequirementModeSchema>;
export type SkillRequirement = {skill:string;mode?:RequirementMode;level?:SignalGrade};
const ranks = {Junior:1,Middle:2,Senior:3};
const levelledSkills = new Set(['Python','SQL','TypeScript','React','Backend engineering','Frontend engineering'].map(canonicalSkillKey));
export const RecruitingSkillRequirementSchema = z.object({skill:z.string().trim().min(1).max(100),mode:RequirementModeSchema.optional(),level:z.enum(['Junior','Middle','Senior']).optional()}).strict().superRefine((item,ctx)=>{
  if(item.level && item.mode==='declared_or_verified')ctx.addIssue({code:'custom',path:['level'],message:'Уровень навыка доступен только для подтверждённого требования.'});
  if(item.level && !levelledSkills.has(canonicalSkillKey(item.skill)))ctx.addIssue({code:'custom',path:['level'],message:'Для этого навыка нет отдельной проверки уровня.'});
});
export const RecruitingSkillRequirementsSchema = z.array(RecruitingSkillRequirementSchema).max(40);

/** Legacy omissions mean verified without an invented minimum. This interpreter
 * does not rewrite any stored context or historical invitation snapshot. */
export function interpretSkillRequirements(skills:readonly string[], explicit:readonly SkillRequirement[] = [], levels:Readonly<Record<string,SignalGrade>> = {}) {
  const byKey=new Map(explicit.map(item=>[canonicalSkillKey(item.skill),item]));
  return canonicalSkillLabels(skills).map(skill=>{
    const key=canonicalSkillKey(skill), item=byKey.get(key), mode=item?.mode??'verified';
    const level=item?.level??levels[key]??levels[skill];
    return {skill,mode,...(mode==='verified'&&level?{level}:{})};
  });
}
/** A supplied new list is authoritative and complete; legacy levels may only
 * accompany it if they agree. Omitted lists preserve retained prior modes. */
export function validateRecruitingRequirements(skills:readonly string[], value:unknown, levelValue:unknown, previous:readonly SkillRequirement[] = [], previousLevels:Readonly<Record<string,SignalGrade>> = {}) {
  const retained=previous.filter(item=>skills.some(skill=>canonicalSkillKey(skill)===canonicalSkillKey(item.skill)));
  const parsed=value===undefined?{success:true as const,data:retained}:RecruitingSkillRequirementsSchema.safeParse(value);
  const invalid=(message:string)=>({success:false as const,fieldErrors:{skillRequirements:message}});
  if(!parsed.success)return invalid(parsed.error.issues[0]?.message??'Проверьте требования навыков.');
  const keys=parsed.data.map(item=>canonicalSkillKey(item.skill)), selected=new Set(skills.map(canonicalSkillKey));
  if(new Set(keys).size!==keys.length||keys.some(key=>!selected.has(key)))return invalid('Требования должны соответствовать обязательным навыкам без повторов.');
  if(value!==undefined&&keys.length!==selected.size)return invalid('Укажите режим для каждого обязательного навыка.');
  const retainedLevels=retainedSkillLevelRequirements(previousLevels,skills);
  const levels=validateSkillLevelRequirements(levelValue??(value===undefined?retainedLevels:{}),skills);
  if(!levels.success)return invalid('Укажите допустимые уровни только для обязательных навыков.');
  if(value!==undefined&&Object.entries(levels.data).some(([key,level])=>{const item=parsed.data.find(item=>canonicalSkillKey(item.skill)===key);return !item||item.mode==='declared_or_verified'||item.level!==level;}))return invalid('Режимы и уровни конфликтуют с прежними требованиями.');
  const items=value===undefined&&levelValue!==undefined?parsed.data.map(item=>({...item,level:levels.data[canonicalSkillKey(item.skill)]})):parsed.data;
  if(items.some(item=>item.mode==='declared_or_verified'&&levels.data[canonicalSkillKey(item.skill)]))return invalid('Заявленный навык не может требовать подтверждённый уровень.');
  const data=interpretSkillRequirements(skills,items,levels.data);
  return {success:true as const,data,levels:Object.fromEntries(data.filter(item=>item.mode==='verified'&&item.level).map(item=>[canonicalSkillKey(item.skill),item.level!]))};
}
type RequirementCandidate=Pick<MatchCandidate,'userId'|'verifiedSkills'|'stack'|'statedSkills'|'skillEvidence'|'verifiedGrade'|'assumedGrade'|'assessmentEvidence'> & Partial<Pick<MatchCandidate,'specialization'|'latestAssessmentAt'>>;
type GradeCandidate=Pick<RequirementCandidate,'verifiedGrade'|'assumedGrade'|'assessmentEvidence'> & Partial<Pick<RequirementCandidate,'userId'|'specialization'|'latestAssessmentAt'>>;
/** A foreign, incomplete or unlinked revoked row cannot revoke this CV. */
function currentAssessmentRevoked(candidate:GradeCandidate) {
  const proof=candidate.assessmentEvidence;
  const expected=candidate.specialization==='Backend / Python'?'backend-python':candidate.specialization==='Frontend / TypeScript'?'frontend-typescript':null;
  return !!(proof&&proof.state==='revoked'&&proof.candidateId===candidate.userId&&proof.grade===candidate.verifiedGrade&&proof.programId===expected&&
    proof.comparisonPolicy==='same-program-version-rubric-v1'&&candidate.latestAssessmentAt&&new Date(proof.submittedAt).getTime()===candidate.latestAssessmentAt.getTime()&&
    Number.isInteger(proof.attemptId)&&proof.attemptId>0&&Number.isFinite(proof.score)&&proof.score>=0&&proof.score<=100&&
    /^signal-(backend-python|frontend-typescript)-v\d+$/.test(proof.programVersion)&&proof.rubricKey.length>0);
}
export function evaluateSkillRequirement(requirement:SkillRequirement,candidate:RequirementCandidate,options:{preliminary?:boolean}={}) {
  const key=canonicalSkillKey(requirement.skill),mode=requirement.mode??'verified';
  const stated=[...candidate.stack,...candidate.statedSkills].some(skill=>canonicalSkillKey(skill)===key);
  const revoked=currentAssessmentRevoked(candidate);
  const proofs=(candidate.skillEvidence??[]).filter(item=>item.candidateId===candidate.userId&&(!revoked||item.sourceType==='signal_skill_module')&&canonicalSkillKey(item.skill)===key);
  const moduleProof=proofs.filter(item=>item.sourceType==='signal_skill_module'&&item.level).reduce<typeof proofs[number]|undefined>((best,item)=>!best||ranks[item.level!]>ranks[best.level!]?item:best,undefined);
  const proof=moduleProof??proofs[0];
  const verifiedLevel=moduleProof?.level??null;
  const listed=!revoked&&candidate.verifiedSkills.some(skill=>canonicalSkillKey(skill)===key);
  // A current Junior proof stays a proof even when a Middle requirement is not
  // met. Matching credit is a separate fact from existence/source of evidence.
  const verified=Boolean(proof||listed);
  const verifiedSufficient=verified&&(!requirement.level||!!verifiedLevel&&ranks[verifiedLevel]>=ranks[requirement.level]||!!options.preliminary&&candidate.skillEvidence===undefined&&listed);
  const covered=verifiedSufficient||(mode==='declared_or_verified'&&stated);
  const source=verified?'verified' as const:stated?'declared' as const:'missing' as const;
  const reason=covered?null:verified&&requirement.level?verifiedLevel?`Подтверждён ${verifiedLevel}; требуется ${requirement.level} или выше.`:`Навык подтверждён без отдельного уровня; требуется подтверждение ${requirement.level} или выше.`:mode==='declared_or_verified'?'Обязательный навык не заявлен и не подтверждён.':requirement.level?`Нужно подтверждение ${requirement.level} или выше.`:'Нужно подтверждение навыка.';
  return {...requirement,mode,covered,verified,verifiedLevel,verifiedSufficient,source,reason,provenance:verified?proof??null:null};
}
export function evaluateGradeRequirement(required:SignalGrade,mode:RequirementMode|undefined,candidate:GradeCandidate) {
  const acceptedMode=mode??'verified',verified=currentAssessmentRevoked(candidate)?null:candidate.verifiedGrade,declared=candidate.assumedGrade??null;
  const verifiedFits=!!verified&&ranks[verified]>=ranks[required];
  const declaredFits=acceptedMode==='declared_or_verified'&&!!declared&&ranks[declared]>=ranks[required];
  return {required,mode:acceptedMode,verified,declared,satisfied:verifiedFits||declaredFits,source:verifiedFits?'verified' as const:declaredFits?'declared' as const:'missing' as const};
}
