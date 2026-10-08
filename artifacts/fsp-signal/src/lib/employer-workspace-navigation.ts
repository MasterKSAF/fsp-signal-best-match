export function professionLabel(value?: string | null) {
  if (value === 'Backend / Python') return 'Backend-разработчик';
  if (value === 'Frontend / TypeScript') return 'Frontend-разработчик';
  return value || 'Должность не указана';
}

export function selectionHref(type: 'job' | 'need', id: number, shortlisted = false) {
  const params = new URLSearchParams({ contextType: type, contextId: String(id), applied: '1' });
  if (shortlisted) params.set('view', 'shortlisted');
  return `/employer/selection?${params}`;
}

export function employerSectionPath(path: string) {
  if (['/employer/matches', '/employer/candidates', '/employer/selection'].includes(path)) return '/employer/selection';
  if (['/employer', '/employer/needs', '/employer/jobs'].includes(path)) return '/employer/jobs';
  return path;
}

export function employerSectionTitle(path: string) {
  const titles: Record<string, string> = {
    '/employer/jobs': 'Мои вакансии', '/employer/selection': 'Подбор специалистов',
    '/employer/applications': 'Отклики', '/employer/microtasks': 'Задания кандидатам',
    '/employer/invitations': 'Приглашения', '/employer/company': 'Компания',
    '/employer/trust': 'Обращения и ограничения',
  };
  return titles[employerSectionPath(path)];
}
