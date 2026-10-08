import { createHash } from "node:crypto";

export type CandidateIdentitySnapshot = {
  userId: number;
  displayName: string;
  professionalAlias: string;
  phone: string | null;
  contactEmail: string | null;
};

/** A content revision, never an authorization credential or a qualification. */
export function candidateIdentityRevision(identity: CandidateIdentitySnapshot): string {
  // Fixed JSON framing preserves every visible value, including whitespace/case.
  // Account ID prevents accidentally treating another account's snapshot as ours.
  return createHash("sha256").update(JSON.stringify([
    "signal-candidate-identity-v1", identity.userId, identity.displayName,
    identity.professionalAlias, identity.phone ?? null, identity.contactEmail ?? null,
  ])).digest("hex");
}

export type CandidateProfileRevisionInput = { revision?: unknown; identityRevision?: unknown };
export type CandidateProfileCurrentRevision = { revision: number; identityRevision: string };
export type CandidateProfileConflictCode = "RESUME_REVISION_CONFLICT" | "CANDIDATE_IDENTITY_REVISION_CONFLICT";
type ProfileRevisionGate = { kind: "invalid" } | { kind: "conflict"; code: CandidateProfileConflictCode } | { kind: "ready" };

export function candidateProfileRevisionGate(input: CandidateProfileRevisionInput, current: CandidateProfileCurrentRevision): ProfileRevisionGate {
  if (typeof input.revision !== "number" || !Number.isInteger(input.revision) || input.revision < 1 || input.revision > 2147483647
    || typeof input.identityRevision !== "string" || input.identityRevision.length !== 64 || !/^[a-f0-9]{64}$/.test(input.identityRevision)) return { kind: "invalid" };
  if (input.revision !== current.revision) return { kind: "conflict", code: "RESUME_REVISION_CONFLICT" };
  if (input.identityRevision !== current.identityRevision) return { kind: "conflict", code: "CANDIDATE_IDENTITY_REVISION_CONFLICT" };
  return { kind: "ready" };
}

/** The caller must read `current` and invoke this inside its existing owner-lock transaction. */
export async function applyCandidateProfileRevisionGuard<T>(
  input: CandidateProfileRevisionInput,
  current: CandidateProfileCurrentRevision,
  write: () => Promise<T>,
): Promise<Exclude<ProfileRevisionGate, { kind: "ready" }> | { kind: "saved"; value: T }> {
  const gate = candidateProfileRevisionGate(input, current);
  if (gate.kind !== "ready") return gate;
  return { kind: "saved", value: await write() };
}
