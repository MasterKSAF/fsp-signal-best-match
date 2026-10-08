export type SelectionAccessIdentity = {
  resumeId: number; revision: number; visibility: string; alias: string;
  publicName: string | null; avatarDataUrl: string | null;
};
type IdentityRow = {
  candidateId: number; resumeId: number; resumeRevision?: number; alias: string;
  publicName: string | null; avatarDataUrl: string | null;
};
type ReconcileOptions<T> = {
  failed?: boolean; detail?: T; detailCheckedAt?: number; accessCheckedAt?: number; sourceCheckedAt?: number;
};

export const selectionAccessBlocked = (check: { isError: boolean; errorUpdatedAt: number; dataUpdatedAt: number }) =>
  check.isError || check.errorUpdatedAt > 0 && check.dataUpdatedAt <= check.errorUpdatedAt;

/** A fresh page may render before its first check; a failed check never retains its identities. */
export function reconcileSelectionAccess<T extends IdentityRow>(
  rows: readonly T[], identities: readonly SelectionAccessIdentity[] | undefined, options: ReconcileOptions<T> = {},
) {
  if (options.failed) return { items: [] as T[], hiddenResumeIds: rows.map(row => row.resumeId), changedResumeIds: [] as number[] };
  const access = new Map(identities?.map(item => [item.resumeId, item]));
  const items: T[] = [], hiddenResumeIds: number[] = [], changedResumeIds: number[] = [];
  const detailNewer = !!options.detail && (options.detailCheckedAt ?? 0) > Math.max(options.accessCheckedAt ?? 0, options.sourceCheckedAt ?? 0);
  for (const row of rows) {
    const identity = access.get(row.resumeId);
    if (identities && (!identity || identity.visibility === 'private' || identity.revision !== row.resumeRevision)) {
      hiddenResumeIds.push(row.resumeId);
      changedResumeIds.push(row.resumeId);
      continue;
    }
    let item = identity ? {
      ...row, alias: identity.alias,
      publicName: identity.visibility === 'public' ? identity.publicName : null,
      avatarDataUrl: identity.visibility === 'public' && identity.publicName?.trim() ? identity.avatarDataUrl : null,
    } : row;
    const detail = options.detail;
    if (detailNewer && detail?.candidateId === row.candidateId) {
      if (detail.resumeId === row.resumeId) {
        if (detail.resumeRevision !== row.resumeRevision) {
          hiddenResumeIds.push(row.resumeId);
          changedResumeIds.push(row.resumeId);
          continue;
        }
        item = { ...item, alias: detail.alias, publicName: detail.publicName, avatarDataUrl: detail.publicName?.trim() ? detail.avatarDataUrl : null };
      } else if (!detail.publicName?.trim()) {
        // Another CV can reveal a revocation; it cannot grant this CV permission to show a name or photo.
        item = { ...item, publicName: null, avatarDataUrl: null };
      }
    }
    if (item.alias !== row.alias || item.publicName !== row.publicName || item.avatarDataUrl !== row.avatarDataUrl) changedResumeIds.push(row.resumeId);
    items.push(item);
  }
  return { items, hiddenResumeIds, changedResumeIds };
}
