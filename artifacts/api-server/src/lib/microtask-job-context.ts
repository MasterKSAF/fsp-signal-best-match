import {and,eq} from 'drizzle-orm';
import {db,signalJobsTable as jobs} from '@workspace/db';
import {microJobAvailable,type MicroJobTarget} from './microtask-job-policy';
type Reader=Pick<typeof db,'select'>;
export async function loadMicroJob(target:MicroJobTarget,reader:Reader=db,lock=false) {
  if(!target.jobId)return undefined;
  const query=reader.select().from(jobs).where(and(eq(jobs.id,target.jobId),eq(jobs.companyId,target.companyId))).limit(1);
  const [job]=await (lock?query.for('share'):query);
  return job;
}
export async function offerMicroJob(offer:{companyId:number;snapshot:{job?:{id:number;title:string;version:number;specialization:string}}},reader:Reader=db,lock=false) {
  const saved=offer.snapshot.job;
  if(!saved)return null;
  const target={jobId:saved.id,companyId:offer.companyId,specialization:saved.specialization};
  const job=await loadMicroJob(target,reader,lock);
  return {...saved,available:microJobAvailable(job,target)};
}
