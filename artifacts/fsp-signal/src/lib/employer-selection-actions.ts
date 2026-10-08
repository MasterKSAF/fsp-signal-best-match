export const selectionContextReadOnly = (context: { type: string; status?: string; readOnly?: boolean } | null | undefined) =>
  context?.readOnly === true || context?.type === 'job' && context.status === 'closed';

export const pendingInvitationConflictId = (status: number, code: unknown, invitationId: unknown) =>
  status === 409 && code === 'PENDING_INVITATION_CONFLICT' && typeof invitationId === 'number' && Number.isSafeInteger(invitationId) && invitationId > 0
    ? invitationId : null;
