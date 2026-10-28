import type {CandidateOfferPreferences,EmployerOfferConditions} from '@workspace/db';
export const MUTUAL_COMPATIBILITY_VERSION='explicit-offer-conditions-v1';
export const acceptancePredictionEnabled=()=>false;
export type CompatibilityState='match'|'mismatch'|'unknown';
const norm=(s:string)=>s.normalize('NFKC').trim().toLocaleLowerCase('ru-RU');
const compare=(wanted:readonly string[],offered:readonly string[]):CompatibilityState=>!wanted.length||!offered.length?'unknown':wanted.some(w=>offered.some(o=>norm(w)===norm(o)))?'match':'mismatch';
export function compareMutualConditions(candidate:CandidateOfferPreferences|null,offer:EmployerOfferConditions&{workFormat:string;specialization:string},specialization:string){
 const formats=offer.workFormat.split(/[,;/]/).map(s=>s.trim()).filter(Boolean);
 return {version:MUTUAL_COMPATIBILITY_VERSION,prediction:{available:false as const,reason:'no_independent_outcome_validation'},factors:[
  {id:'format',label:'Формат работы',state:compare(candidate?.formats??[],formats)},
  {id:'location',label:'Локация',state:compare(candidate?.locations??[],offer.location?[offer.location]:[])},
  {id:'time_zone',label:'Часовой пояс',state:compare(candidate?.timeZones??[],offer.timeZone?[offer.timeZone]:[])},
  {id:'employment',label:'Занятость',state:compare(candidate?.employment??[],offer.employment?[offer.employment]:[])},
  {id:'direction',label:'Направление',state:compare(specialization?[specialization]:[],offer.specialization?[offer.specialization]:[])},
  // Deliberately constant: arbitrary edits of the offer cannot query an individual's undisclosed salary threshold.
  {id:'salary',label:'Оплата',state:'unknown' as CompatibilityState},
 ]};
}
