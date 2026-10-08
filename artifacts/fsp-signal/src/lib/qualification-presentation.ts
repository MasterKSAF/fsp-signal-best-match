/** The server chooses the current qualification; presentation never merges or promotes proofs. */
export function evidenceNoteForDisplay(note: string | null | undefined): string | null {
  if (!note || note.trim() === 'Исторический итог без полной связи с критериями. Новые подтверждения и даты не приписываются.') return null;
  return note;
}

export function qualificationSourceLabel(qualification: { verifiedGrade: string | null; source?: string; category?: unknown }): string | null {
  if (!qualification.verifiedGrade) return null;
  if (qualification.source === 'skill_matrix' || (!qualification.source && qualification.category)) return 'По матрице навыков';
  if (qualification.source === 'assessment') return 'По экзамену';
  if (qualification.source === 'legacy') return 'По сохранённому результату';
  return 'Подтверждённая квалификация';
}

export function qualificationGradeLabel(qualification: {verifiedGrade:string|null;source?:string;category?:unknown}): string {
  if (!qualification.verifiedGrade) return 'Грейд не подтверждён';
  const source=qualificationSourceLabel(qualification);
  return `Грейд: ${qualification.verifiedGrade}${source?` · ${source.toLocaleLowerCase('ru-RU')}`:''}`;
}
