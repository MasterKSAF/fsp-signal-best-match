import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Info } from 'lucide-react';
import { editableCandidateProfile } from '@/lib/candidate-profile-draft';
import { resumeRequest, useResumeSelection, useSelectedCandidateProfile, type SelectedProfile } from './multi-resume';

export function InlineHelp({ text }: { text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <span className="workspace-inline-help" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}><button type="button" aria-label="Подробнее" aria-describedby={open ? id : undefined} aria-expanded={open} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}><Info size={14} aria-hidden="true"/></button>{open && <span role="tooltip" id={id}>{text}</span>}</span>;
}
export function PassportAlias() {
  const selection = useResumeSelection();
  const query = useSelectedCandidateProfile();
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (query.data && !dirty) setValue(query.data.professionalAlias); }, [query.data, dirty]);
  const save = useMutation({ mutationFn: () => {
    if (!query.data) throw new Error('Дождитесь загрузки профиля.');
    return resumeRequest<SelectedProfile>('/me/candidate-profile', { method: 'PUT', body: JSON.stringify({ ...editableCandidateProfile(query.data), professionalAlias: value.trim(), resumeId: selection.resumeId, revision: query.data.revision, identityRevision: query.data.identityRevision }) });
  }, onSuccess: data => { setDirty(false); qc.setQueryData(['selected-candidate-profile', selection.userId, selection.resumeId], data); qc.invalidateQueries({ queryKey: ['candidate-resumes'] }); } });
  return <form className="passport-alias" onSubmit={event => { event.preventDefault(); if (dirty && !save.isPending) save.mutate(); }}><div className="passport-alias-row"><label><span>Псевдоним</span><input className="input" required minLength={2} maxLength={120} value={value} disabled={query.isPending || save.isPending} onChange={event => { setValue(event.target.value); setDirty(true); save.reset(); }} /></label><InlineHelp text="Используется вместо полного имени в анонимном поиске. Настройка видимости находится в вашем резюме."/><button type="submit" className="button ghost" aria-label="Сохранить псевдоним" title="Сохранить псевдоним" disabled={!dirty || save.isPending}><Check size={16} aria-hidden="true"/></button></div>{save.isError && <p role="alert">{save.error.message} <button className="button text-button" type="button" onClick={() => { void query.refetch(); save.reset(); }}>Обновить данные</button></p>}</form>;
}
