import { sql, type SQL } from 'drizzle-orm';
import { signalApplicationsTable as applications, signalJobsTable as jobs } from '../../../../lib/db/src/schema/signal-opportunities';
import { signalCompanyBlocksTable as blocks } from '../../../../lib/db/src/schema/signal-trust';

type PersonalJobFilters = { hideApplied: boolean; hideBlocked: boolean };
type JobFilterActor = { id: number; role: string };

/** Account-wide filters: sending an application is unique per candidate and job. */
export function personalJobFilterConditions(filters: PersonalJobFilters, actor?: JobFilterActor | null): SQL[] {
  if (actor?.role !== 'candidate') return [];
  const conditions: SQL[] = [];
  if (filters.hideApplied) conditions.push(sql`not exists (
    select 1 from ${applications}
    where ${applications.jobId} = ${jobs.id} and ${applications.candidateUserId} = ${actor.id}
  )`);
  if (filters.hideBlocked) conditions.push(sql`not exists (
    select 1 from ${blocks}
    where ${blocks.companyId} = ${jobs.companyId}
      and ${blocks.candidateUserId} = ${actor.id} and ${blocks.active} = true
  )`);
  return conditions;
}
