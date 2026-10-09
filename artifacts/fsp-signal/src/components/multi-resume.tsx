import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import type { CandidateProfile } from '@workspace/api-client-react';
import { professionLabel } from '../lib/employer-workspace-navigation';
import { FormField } from './form-field';
import './multi-resume.css';

export type ResumeSummary = { id: number; resumeId?: number; title: string; isPrimary: boolean; revision: number; specialization: string; verifiedGrade: string | null; visibility: string; consentMatching?: boolean; consentCatalog: boolean; readyForOffers: boolean; assumedGrade?: string; stack?: string[]; skills?: string[]; verifiedSkills?: string[]; summary?: string; updatedAt?: string };
export type SelectedProfile = CandidateProfile & { resumeId: number; title: string; revision: number; consentCatalog: boolean; readyForOffers: boolean; avatarDataUrl: string | null };
export class ResumeRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = 'ResumeRequestError'; }
}
export async function resumeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) {
    const retry = data.retryAt && Number.isFinite(Date.parse(data.retryAt)) ? ` Повторить можно после ${new Date(data.retryAt).toLocaleString('ru-RU')}.` : '';
    throw new ResumeRequestError((data.error || 'Не удалось сохранить изменения.') + retry, response.status, typeof data.code === 'string' ? data.code : undefined);
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
  useEffect(() => {
    try { const stored = userId ? Number(localStorage.getItem(`signal-resume-context:${userId}`)) : null; setSelected(stored && Number.isSafeInteger(stored) ? stored : null); }
    catch { setSelected(null); }
  }, [userId]);
  const requested = new URLSearchParams(search).get('resumeId');
  const explicit = requested !== null ? (/^[1-9]\d{0,9}$/.test(requested) && Number(requested) <= 2147483647 ? Number(requested) : Number.NaN) : null;
  const resumes = list.data?.resumes ?? [];
  const valid = (id: number | null) => id !== null && resumes.some(row => row.id === id);
  const resumeId = valid(explicit) ? explicit : valid(selected) ? selected : resumes[0]?.id ?? null;
  useEffect(() => {
    if (list.isPending || list.isError || !userId) return;
    setSelected(resumeId);
    try { if (resumeId !== null) localStorage.setItem(`signal-resume-context:${userId}`, String(resumeId)); else localStorage.removeItem(`signal-resume-context:${userId}`); } catch { /* selection still works in memory */ }
    if (explicit !== null && explicit !== resumeId) {
      const params = new URLSearchParams(search); params.delete('attempt'); params.delete('moduleAttempt');
      if (resumeId !== null) params.set('resumeId', String(resumeId)); else params.delete('resumeId');
      navigate(`${location}${params.size ? `?${params}` : ''}`, { replace: true });
    }
  }, [userId, resumeId, explicit, list.isPending, list.isError, location, search, navigate]);
  const select = (id: number | null) => {
    setSelected(id);
    const params = new URLSearchParams(search);
    // Selecting a different résumé leaves the captured attempt in history; the
    // new selection must never become that attempt's target through its URL.
    params.delete('attempt'); params.delete('moduleAttempt');
    if (id !== null) params.set('resumeId', String(id)); else params.delete('resumeId');
    navigate(`${location}${params.size ? `?${params}` : ''}`, { replace: true });
  };
  return <ResumeContext.Provider value={{ resumeId, select, resumes, loading: list.isPending && !!userId, error: list.isError, userId }}>{children}</ResumeContext.Provider>;
}
export const useResumeSelection = () => useContext(ResumeContext);
export function useSelectedCandidateProfile(resumeIdOverride?: number) {
  const selection = useResumeSelection();
  const resumeId = resumeIdOverride ?? selection.resumeId;
  return useQuery({ queryKey: ['selected-candidate-profile', selection.userId, resumeId], queryFn: () => resumeRequest<SelectedProfile>(`/me/candidate-profile?resumeId=${resumeId}`), enabled: resumeId !== null });
}
export function resumeHref(path: string, id: number | null) {
  if (id === null) return path;
  const [base, hash] = path.split('#');
  return `${base}${base.includes('?') ? '&' : '?'}resumeId=${id}${hash ? `#${hash}` : ''}`;
}
export function CompactResumeContext() {
  const { resumeId, select, resumes, loading, error } = useResumeSelection();
  if (loading) return <span role="status">Загружаем резюме…</span>;
  if (error) return <span role="alert">Не удалось загрузить резюме.</span>;
  if (!resumes.length) return null;
  return <label className="compact-resume-context"><span>Резюме</span><select className="input" value={resumeId ?? ''} onChange={event => select(Number(event.target.value))} aria-label="Выбранное резюме" data-testid="select-active-resume">{resumes.map(row => <option key={row.id} value={row.id}>{professionLabel(row.title)}{row.visibility === 'private' ? ' · скрытое' : ''}</option>)}</select></label>;
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
  return <div className="candidate-avatar-editor">{profile.avatarDataUrl && <img src={profile.avatarDataUrl} alt="Ваше фото"/>}<div><FormField label="Фото профиля" layout="vertical" hint="PNG, JPEG или WebP до 2 МБ. Фото общее для аккаунта и видно работодателю только у резюме с открытым именем." error={fileError || (action.isError ? action.error.message : undefined)}><input type="file" className="input" accept="image/png,image/jpeg,image/webp" disabled={action.isPending} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></FormField>{profile.avatarDataUrl && <button type="button" className="button ghost" disabled={action.isPending} onClick={() => action.mutate(null)}>Удалить фото</button>}</div></div>;
}
