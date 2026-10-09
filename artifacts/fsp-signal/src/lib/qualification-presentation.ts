/** The server chooses the current qualification; presentation never merges or promotes proofs. */
export function evidenceNoteForDisplay(note: string | null | undefined): string | null {
  if (!note || note.trim() === 'Исторический итог без полной связи с критериями. Новые подтверждения и даты не приписываются.') return null;
  return note;
}

export function qualificationSourceLabel(qualification: { verifiedGrade: string | null; source?: string; category?: unknown }): string | null {
  if (!qualification.verifiedGrade) return null;
  if (qualification.source === 'skill_matrix' || (!qualification.source && qualification.category)) return 'По матрице навыков';
  if (qualification.source === 'assessment') return 'По комплексному экзамену';
  if (qualification.source === 'legacy') return 'Исторический общий грейд';
  return 'Подтверждённая квалификация';
}

export function qualificationGradeLabel(qualification: {verifiedGrade:string|null;assumedGrade?:string|null;source?:string;category?:unknown}): string {
  if (qualification.verifiedGrade) return `Подтверждённый грейд: ${qualification.verifiedGrade}`;
  return qualification.assumedGrade ? `Заявленный грейд: ${qualification.assumedGrade}` : 'Грейд не указан';
}
