export type JobSkillFilter = {skill:string;level?:'Junior'|'Middle'|'Senior'};
const levels=['Junior','Middle','Senior'] as const;

export function normalizeJobSkillFilters(raw:string|null):{skills:JobSkillFilter[];invalid:boolean} {
  if(!raw)return {skills:[],invalid:false};
  if(raw.length>3000)return {skills:[],invalid:true};
  let value:unknown;try{value=JSON.parse(raw);}catch{return {skills:[],invalid:true};}
  if(!Array.isArray(value)||value.length>20)return {skills:[],invalid:true};
  const skills:JobSkillFilter[]=[];let invalid=false;
  for(const entry of value){
    if(!entry||typeof entry!=='object'||Array.isArray(entry)){invalid=true;continue;}
    const item=entry as Record<string,unknown>;
    if(Object.keys(item).some(key=>key!=='skill'&&key!=='level')||typeof item.skill!=='string'||!item.skill.trim()||item.skill.trim().length>60||item.level!==undefined&&!levels.includes(item.level as typeof levels[number])){invalid=true;continue;}
    const skill=item.skill.trim();const level=item.level as JobSkillFilter['level'];
    const previous=skills.find(candidate=>candidate.skill.toLocaleLowerCase('ru-RU')===skill.toLocaleLowerCase('ru-RU'));
    if(previous){if(level&&(levels.indexOf(level)>levels.indexOf(previous.level!)))previous.level=level;}
    else skills.push({skill,...(level?{level}:{})});
  }
  return {skills,invalid};
}

/** One normalized query is shared by the rendered filters, search and file links. */
export function normalizeJobFilterParams(source:URLSearchParams) {
  const params=new URLSearchParams(source);const result=normalizeJobSkillFilters(params.get('skills'));
  if(result.skills.length)params.set('skills',JSON.stringify(result.skills));else params.delete('skills');
  return {params,...result};
}
