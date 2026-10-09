import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import { captureAuthQuerySession, isAuthQuerySessionCurrent, type AuthQuerySession } from './auth-query-cache';

export type CompanyProfile = {
  id: number; name: string; description: string; industry: string; inn: string;
  contactEmail: string; contactPhone: string | null;
  contactMethod: 'Электронная почта' | 'Телефон' | 'Мессенджер';
};
export type CompanyResponse = { company: CompanyProfile };
export type CompanyDraft = Omit<CompanyProfile, 'id'>;
export const companyQueryKey = (userId: number) => ['employer-company', userId] as const;

/** Shared envelope/key keeps the form and header in sync. A late response from
 * a previous login must neither repopulate cache nor invalidate the new login. */
export function companySaveMutationOptions(client: QueryClient, authKey: readonly string[], userId: number,
  send: (draft: CompanyDraft) => Promise<CompanyResponse>, onSaved: (company: CompanyProfile) => void,
): MutationOptions<CompanyResponse, Error, CompanyDraft, AuthQuerySession> {
  return {
    onMutate: () => {
      const session = captureAuthQuerySession(client, authKey, userId, 'employer');
      if (!session) throw new Error('Сессия изменилась. Откройте профиль своей компании заново.');
      return session;
    },
    mutationFn: draft => {
      if (!captureAuthQuerySession(client, authKey, userId, 'employer')) throw new Error('Сессия изменилась. Откройте профиль своей компании заново.');
      return send(draft);
    },
    onSuccess: (data, _draft, session) => {
      if (!isAuthQuerySessionCurrent(client, authKey, session)) return;
      const queryKey = companyQueryKey(userId);
      client.setQueryData(queryKey, data);
      void client.invalidateQueries({ queryKey, exact: true });
      onSaved(data.company);
    },
  };
}
