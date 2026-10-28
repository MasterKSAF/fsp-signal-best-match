import { and, eq } from 'drizzle-orm';
import { db, signalContextExclusionsTable as exclusions } from '@workspace/db';
import type { SelectionContextDto } from './selection-context-contract';
export async function contextExcludedCandidates(companyId:number,context:Pick<SelectionContextDto,'type'|'id'|'version'>) {
  const rows=await db.select({id:exclusions.candidateId}).from(exclusions).where(and(eq(exclusions.companyId,companyId),eq(exclusions.contextType,context.type),eq(exclusions.contextId,context.id),eq(exclusions.contextRevision,context.version),eq(exclusions.active,true)));
  return new Set(rows.map(row=>row.id));
}
