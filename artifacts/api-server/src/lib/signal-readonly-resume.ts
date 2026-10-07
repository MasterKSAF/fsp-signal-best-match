/** Internal pool views never retain a mutable Date. Shared accessors read only
 * frozen primitive timestamps; each access creates a separate Date value. */
const assessmentMillis = Symbol('assessmentMillis');
const deletionMillis = Symbol('deletionMillis');
const ownedViews = new WeakSet<object>();
type TimestampView = { [assessmentMillis]?: number | null; [deletionMillis]?: number | null };
function assessmentDate(this: TimestampView) {
  const value = this[assessmentMillis];
  return value === null || value === undefined ? null : new Date(value);
}
function deletionDate(this: TimestampView) {
  const value = this[deletionMillis];
  return value === null || value === undefined ? null : new Date(value);
}
const dateFields = [
  ['latestAssessmentAt', assessmentMillis, assessmentDate],
  ['deletedAt', deletionMillis, deletionDate],
] as const;
function freezeNested(value: unknown): void {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeNested(child);
    Object.freeze(value);
  }
}
export function readonlyResumeProjection<T extends object>(row: T): T {
  // Copy values directly instead of a descriptor object for every row field.
  const output = { ...row };
  for (const [field, storage, getter] of dateFields) {
    if (!(field in output)) continue;
    const value = (output as Record<string, unknown>)[field];
    const millis = value === null || value === undefined ? null
      : value instanceof Date ? value.getTime() : new Date(value as string).getTime();
    Object.defineProperty(output, storage, { value: millis });
    Object.defineProperty(output, field, { enumerable: true, configurable: false, get: getter });
  }
  // No Date is retained, so accessing the date getters during freeze is wasteful.
  for (const field of Object.keys(output)) {
    if (field !== 'latestAssessmentAt' && field !== 'deletedAt')
      freezeNested((output as Record<string, unknown>)[field]);
  }
  ownedViews.add(output);return Object.freeze(output);
}
export function isReadonlyResumeProjection(row: object) {return ownedViews.has(row);}
/** Same Date semantics without allocating a Date for internal scalar checks. */
export function resumeAssessmentMillis(row: { latestAssessmentAt: Date | null }): number | null {
  return ownedViews.has(row)
    ? ((row as TimestampView)[assessmentMillis] ?? null)
    : row.latestAssessmentAt?.getTime() ?? null;
}
