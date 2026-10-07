import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import { Copy, FileText, Plus, Star, Trash2 } from 'lucide-react';
import type { CandidateProfile } from '@workspace/api-client-react';
import { Dialog } from './product-enhancements';
import { FormField } from './form-field';
import { DictionaryCombobox } from './dictionary-input';
import { ROLE_OPTIONS } from '@/lib/professional-dictionaries';
import './multi-resume.css';

export type ResumeSummary = { id: number; resumeId?: number; title: string; isPrimary: boolean; revision: number; specialization: string; verifiedGrade: string | null; visibility: string; consentCatalog: boolean; readyForOffers: boolean };
export type SelectedProfile = CandidateProfile & { resumeId: number; title: string; revision: number; consentCatalog: boolean; readyForOffers: boolean; avatarDataUrl: string | null };
export async function resumeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) {
    const retry = data.retryAt && Number.isFinite(Date.parse(data.retryAt)) ? ` Повторить можно после ${new Date(data.retryAt).toLocaleString('ru-RU')}.` : '';
    throw new Error((data.error || 'Не удалось сохранить изменения.') + retry);
  }
  return data;
}
type Selection = { resumeId: number | null; select: (id: number | null) => void; resumes: ResumeSummary[]; loading: boolean; error: boolean; userId: number | null };
const ResumeContext = createContext<Selection>({ resumeId: null, select: () => {}, resumes: [], loading: false, error: false, userId: null });
export function ResumeSelectionProvider({ userId, children }: { userId: number | null; children: ReactNode }) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [selected, setSelected] = useState<number | null>(null);
  const list = useQuery({ queryKey: ['candidate-resumes', userId], queryFn: () => resumeRequest<{ resumes: ResumeSummary[] }>('/me/resumes'), enabled: !!userId });
  useEffect(() => { setSelected(null); }, [userId]);
  const requested = new URLSearchParams(search).get('resumeId');
  const explicit = requested !== null ? (/^[1-9]\d{0,9}$/.test(requested) && Number(requested) <= 2147483647 ? Number(requested) : Number.NaN) : null;
  const resumeId = explicit ?? selected ?? list.data?.resumes.find(row => row.isPrimary)?.id ?? null;
  const select = (id: number | null) => {
    setSelected(id);
    const params = new URLSearchParams(search);
    // Selecting a different résumé leaves the captured attempt in history; the
    // new selection must never become that attempt's target through its URL.
    params.delete('attempt');
    if (id !== null) params.set('resumeId', String(id)); else params.delete('resumeId');
    navigate(`${location}${params.size ? `?${params}` : ''}`, { replace: true });
  };
  return <ResumeContext.Provider value={{ resumeId, select, resumes: list.data?.resumes ?? [], loading: list.isPending && !!userId, error: list.isError, userId }}>{children}</ResumeContext.Provider>;
}
export const useResumeSelection = () => useContext(ResumeContext);
export function useSelectedCandidateProfile() {
  const selection = useResumeSelection();
  return useQuery({ queryKey: ['selected-candidate-profile', selection.userId, selection.resumeId], queryFn: () => resumeRequest<SelectedProfile>(`/me/candidate-profile?resumeId=${selection.resumeId}`), enabled: selection.resumeId !== null });
}
export function resumeHref(path: string, id: number | null) {
  if (id === null) return path;
  const [base, hash] = path.split('#');
  return `${base}${base.includes('?') ? '&' : '?'}resumeId=${id}${hash ? `#${hash}` : ''}`;
}
export function ResumeSwitcher() {
  const { resumeId, select, resumes, loading, error } = useResumeSelection();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [deleteResume, setDeleteResume] = useState<{ id: number; title: string } | null>(null);
  const [title, setTitle] = useState('');
  const [specialization, setSpecialization] = useState('Backend / Python');
  const action = useMutation({ mutationFn: (input: { path: string; method: string; body?: unknown }) => resumeRequest<any>(input.path, { method: input.method, body: input.body === undefined ? undefined : JSON.stringify(input.body) }), onSuccess: async (data, input) => {
    await qc.invalidateQueries({ queryKey: ['candidate-resumes'] });
    await qc.invalidateQueries({ queryKey: ['selected-candidate-profile'] });
    await qc.invalidateQueries({ queryKey: ['candidate-resume'] });
    await qc.invalidateQueries({ queryKey: ['candidate-evidence-registry'] });
    if (input.method === 'POST' && (data.id || data.resumeId || data.resume?.id)) select(data.id ?? data.resumeId ?? data.resume.id);
    if (input.method === 'DELETE') { select(null); setDeleteResume(null); }
    setTitle('');
  } });
  const current = resumes.find(row => row.id === resumeId);
  if (loading) return <p role="status">Загружаем ваши резюме…</p>;
  if (error) return <p role="alert">Не удалось загрузить резюме. <button className="button text-button" onClick={() => qc.invalidateQueries({ queryKey: ['candidate-resumes'] })}>Повторить</button></p>;
  return <section className="panel multi-resume-toolbar" aria-label="Ваши резюме">
    <div className="multi-resume-heading"><FileText size={19}/><b>Мои резюме</b><span>{resumes.length} из 5</span></div>
    {resumes.length > 0 && <FormField label="Работаем с резюме" hint="Проверка и настройки относятся к выбранному документу."><select className="input" value={resumeId ?? ''} onChange={event => select(Number(event.target.value))} data-testid="select-active-resume"><option value="" disabled>Выберите резюме</option>{resumes.map(row => <option key={row.id} value={row.id}>{row.title} · {row.verifiedGrade || 'Грейд не подтверждён'}{row.isPrimary ? ' · основное' : ''}</option>)}</select></FormField>}
    {!current && resumes.length > 0 && <p role="status">Выбранное резюме удалено или недоступно. Выберите другое.</p>}
    <div className="multi-resume-actions">{current && <>
      <button className="button secondary" disabled={action.isPending || resumes.length >= 5} onClick={() => action.mutate({ path: `/me/resumes/${current.id}/copy`, method: 'POST' })}><Copy size={15}/> Копировать</button>
      <button className="button ghost" disabled={action.isPending || current.isPrimary} onClick={() => action.mutate({ path: `/me/resumes/${current.id}/primary`, method: 'POST' })}><Star size={15}/> Сделать основным</button>
      <button className="button ghost" disabled={action.isPending} onClick={() => current.visibility === 'private' ? navigate(resumeHref('/candidate/passport', current.id)) : action.mutate({ path: `/me/resumes/${current.id}`, method: 'PATCH', body: { visibility: 'private', revision: current.revision } })}>{current.visibility === 'private' ? 'Настроить видимость' : 'Скрыть'}</button>
      <button className="button ghost" disabled={action.isPending} onClick={() => setDeleteResume({ id: current.id, title: current.title })}><Trash2 size={15}/> Удалить</button>
    </>}</div>
    <details><summary><Plus size={15}/> Создать резюме</summary>{resumes.length >= 5 ? <p>Можно хранить до пяти резюме. Удалите одно, чтобы добавить новое; скрытые тоже учитываются.</p> : <form className="multi-resume-create" onSubmit={event => { event.preventDefault(); action.mutate({ path: '/me/resumes', method: 'POST', body: { title: title.trim(), specialization } }); }}><FormField label="Название резюме" layout="vertical" hint="Выберите должность или дайте документу своё название."><DictionaryCombobox required minLength={2} maxLength={120} value={title} onChange={setTitle} options={ROLE_OPTIONS} placeholder="Например, Python-разработчик" /></FormField><FormField label="IT-направление" layout="vertical" hint="Выберите поддерживаемую программу проверки навыков."><select className="input" value={specialization} onChange={event => setSpecialization(event.target.value)}><option>Backend / Python</option><option>Frontend / TypeScript</option></select></FormField><button className="button primary" disabled={action.isPending}>Создать закрытое резюме</button></form>}</details>
    {action.isError && <p role="alert">{action.error.message}</p>}
    {deleteResume && <Dialog title={`Удалить «${deleteResume.title}»?`} onClose={() => { if (!action.isPending) setDeleteResume(null); }}><p>История проверок и другие резюме сохранятся. Удалённое резюме перестанет участвовать в подборе.</p><div className="multi-resume-actions"><button className="button secondary" disabled={action.isPending} onClick={() => setDeleteResume(null)}>Отмена</button><button className="button primary" disabled={action.isPending} onClick={() => action.mutate({ path: `/me/resumes/${deleteResume.id}`, method: 'DELETE' })}>Удалить резюме</button></div>{action.isError && <p role="alert">{action.error.message}</p>}</Dialog>}
  </section>;
}
export function CandidateAvatar({ profile, onSaved }: { profile: SelectedProfile; onSaved: () => void }) {
  const action = useMutation({ mutationFn: (dataUrl: string | null) => resumeRequest('/me/avatar', { method: dataUrl ? 'POST' : 'DELETE', body: dataUrl ? JSON.stringify({ dataUrl }) : undefined }), onSuccess: onSaved });
  const [fileError, setFileError] = useState('');
  const upload = async (file?: File) => {
    if (!file) return;
    setFileError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { setFileError('Выберите PNG, JPEG или WebP размером до 2 МБ.'); return; }
    try { const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); action.mutate(dataUrl); } catch { setFileError('Не удалось прочитать изображение.'); }
  };
  return <div className="candidate-avatar-editor">{profile.avatarDataUrl && <img src={profile.avatarDataUrl} alt="Ваше фото"/>}<div><FormField label="Фото профиля" layout="vertical" hint="PNG, JPEG или WebP до 2 МБ. Фото общее для аккаунта и видно работодателю только у резюме с открытым именем." error={fileError || (action.isError ? action.error.message : undefined)}><input type="file" className="input" accept="image/png,image/jpeg,image/webp" disabled={action.isPending} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></FormField>{profile.avatarDataUrl && <button className="button ghost" disabled={action.isPending} onClick={() => action.mutate(null)}>Удалить фото</button>}</div></div>;
}
