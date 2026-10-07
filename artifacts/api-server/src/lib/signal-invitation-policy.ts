import { createHash } from "node:crypto";

export const INVITATION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INVITATION_CLOSED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** Rolling 24 hours, measured as UTC instants; verified email does not increase this. */
export function invitationQuotaLimit(): number {
  const configured = process.env.SIGNAL_INVITATIONS_PER_24H;
  if (!configured) return 20;
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 1 || value > 1000)
    throw new Error(
      "SIGNAL_INVITATIONS_PER_24H must be an integer from 1 to 1000",
    );
  return value;
}
export function invitationBodyHash(input: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.entries(input).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}
export function quotaRetryAt(
  createdAt: readonly Date[],
  now: Date,
  limit: number,
): string | null {
  const inWindow = createdAt
    .map((date) => date.getTime())
    .filter(
      (at) => at > now.getTime() - INVITATION_WINDOW_MS && at <= now.getTime(),
    )
    .sort((a, b) => a - b);
  if (inWindow.length < limit) return null;
  return new Date(
    inWindow[inWindow.length - limit]! + INVITATION_WINDOW_MS,
  ).toISOString();
}
export function closedInvitationRetryAt(
  updatedAt: Date,
  now: Date,
): string | null {
  const at = updatedAt.getTime() + INVITATION_CLOSED_COOLDOWN_MS;
  return at > now.getTime() ? new Date(at).toISOString() : null;
}
