import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, signalResumeEventsTable as events, signalResumeWorkPreferencesTable as preferences } from '@workspace/db';
export { resumeCompletion, selectedSkillProgress } from './resume-progress';

export const resumeEventWindow = (at = new Date()) => at.toISOString().slice(0, 10);
export const RESUME_ANALYTICS_POLICY = 'employer-account-resume-event-utc-day-v1';
export const emptyWorkPreferences = { location: '', schedule: '', employment: '', relocation: false, startAvailability: '' };

export async function recordResumeEvent(resumeId: number, actorUserId: number, kind: 'view'|'download', format?: 'pdf'|'docx') {
  return db.insert(events).values({ resumeId, actorUserId, kind, windowKey: resumeEventWindow(), format: format ?? null }).onConflictDoNothing().returning({ id: events.id });
}
export async function workspaceAnalytics(resumeIds: number[], now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86400000);
  const counts = resumeIds.length ? await db.select({ resumeId: events.resumeId, kind: events.kind, count: sql<number>`count(*)::int` }).from(events).where(and(inArray(events.resumeId, resumeIds), gte(events.occurredAt, since))).groupBy(events.resumeId, events.kind) : [];
  const result = new Map(resumeIds.map(id => [id, { views: 0, downloads: 0, periodDays: 30, since: since.toISOString(), policy: RESUME_ANALYTICS_POLICY }]));
  for (const row of counts) { const value = result.get(row.resumeId); if (value) value[row.kind === 'view' ? 'views' : 'downloads'] = row.count; }
  return result;
}
export async function readWorkPreferences(resumeIds: number[]) {
  const rows = resumeIds.length ? await db.select().from(preferences).where(inArray(preferences.resumeId, resumeIds)) : [];
  return new Map(rows.map(row => [row.resumeId, row]));
}
