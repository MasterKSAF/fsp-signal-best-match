export type PendingRegistrationProof = {
  userId: number; registrationId: string | null; tokenHash: string; expiresAt: Date; consumedAt: Date | null;
  pendingPasswordHash: string | null; pendingRole: 'candidate' | 'employer' | null;
  pendingDisplayName: string | null; pendingConsentVersion: string | null;
};

/** Credentials come solely from the consumed immutable challenge, never a later request or provisional account. */
export function registrationProofFields(user: { id: number; emailVerified: boolean; demoMode: boolean }, proof: PendingRegistrationProof | undefined, now: Date, registrationId: string) {
  if (user.emailVerified || user.demoMode || !proof || proof.userId !== user.id || proof.consumedAt !== null || proof.expiresAt <= now ||
    proof.registrationId !== registrationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proof.registrationId ?? '') ||
    !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/i.test(proof.pendingPasswordHash ?? '') ||
    !['candidate','employer'].includes(proof.pendingRole ?? '') || (proof.pendingDisplayName?.trim().length ?? 0) < 2 || !proof.pendingConsentVersion?.trim()) return null;
  return { passwordHash: proof.pendingPasswordHash!, role: proof.pendingRole!, displayName: proof.pendingDisplayName!, consentVersion: proof.pendingConsentVersion! };
}
