type AnswerOffer = {
  id: number; templateId: number; resumeId?: number | null; resumeAvailable?: boolean;
  resumeProvenance?: string; consentRevokedAt?: unknown; alias?: string; answer?: string | null;
  candidateIdentity?: { alias: string; displayName: string | null } | null;
  resumeContext?: { resumeId: number; title?: string } | null;
};
export function employerTaskAnswerView(offer: AnswerOffer) {
  const readable = offer.resumeAvailable === true && !offer.consentRevokedAt;
  const exactResume = readable && offer.resumeProvenance === 'captured' && typeof offer.resumeId === 'number' && offer.resumeId > 0 && offer.resumeContext?.resumeId === offer.resumeId;
  const alias = readable ? offer.candidateIdentity?.alias?.trim() || offer.alias?.trim() || 'Кандидат' : 'Доступ отозван';
  const name = readable ? offer.candidateIdentity?.displayName?.trim() || alias : alias;
  const answer = readable ? offer.answer?.trim().replace(/\s+/g, ' ') || '' : '';
  return {
    readable, name, alias, pseudonymous: name === alias,
    resumeLabel: exactResume ? `Резюме №${offer.resumeId}${offer.resumeContext?.title ? ` · ${offer.resumeContext.title}` : ''}` : 'Прежняя запись без сохранённого резюме',
    preview: answer.length > 140 ? `${answer.slice(0, 140)}…` : answer,
    profileHref: readable ? `/employer/microtasks?task=${offer.templateId}&tab=answers&offer=${offer.id}&profile=1` : null,
  };
}
