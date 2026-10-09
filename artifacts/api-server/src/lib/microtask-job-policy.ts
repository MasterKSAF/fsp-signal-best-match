export type MicroJob = {id:number;companyId:number;title:string;version:number;specialization:string;status:string;deletedAt:Date|null};
export type MicroJobTarget = {jobId:number|null;companyId:number;specialization:string|null};
export const MICRO_JOB_UNAVAILABLE = 'Для новых заданий выберите свою доступную вакансию. Назначения доступны после её публикации.';
export const MICRO_JOB_LEGACY = 'Прежнее задание сохранено в истории. Для новых назначений создайте задание с вакансией.';
/** A job is an owned context, not a substitute for candidate consent or CV access. */
export function microJobAvailable(job:MicroJob|undefined|null,target:MicroJobTarget,action:'prepare'|'assign'='assign') {
  return !!job && target.jobId===job.id && target.companyId===job.companyId && target.specialization===job.specialization &&
    !job.deletedAt && (action==='prepare'?['draft','published'].includes(job.status):job.status==='published');
}
export function capturedMicroJob(job:MicroJob) {
  return {id:job.id,title:job.title,version:job.version,specialization:job.specialization};
}
export function microJobProjection(job:MicroJob|undefined|null,target:MicroJobTarget) {
  if(!job||target.jobId!==job.id||target.companyId!==job.companyId)return null;
  return {id:job.id,title:job.title,version:job.version,status:job.status,available:microJobAvailable(job,target)};
}
