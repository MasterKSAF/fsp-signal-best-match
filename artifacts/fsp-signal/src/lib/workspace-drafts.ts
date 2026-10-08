// Drafts live only in this tab's memory and never cross authenticated accounts.
const drafts = new Map<string, unknown>();
export const workspaceDraftKey = (userId: number | null, resumeId: number | null, section: string) => `${userId ?? 'none'}:${resumeId ?? 'none'}:${section}`;
export function readWorkspaceDraft<T>(key: string): T | undefined { return drafts.get(key) as T | undefined; }
export function writeWorkspaceDraft<T>(key: string, draft: T) { drafts.set(key, draft); }
export function clearWorkspaceDrafts() { drafts.clear(); }
