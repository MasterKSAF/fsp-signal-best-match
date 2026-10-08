import type { FspAchievement } from "../../../../lib/db/src/schema/signal-fsp";
import { emptyFspSignal, trustedFspResults, validFspAchievements } from './fsp-results';

export const fspConsentVersion = "fsp-import-2026-10-05";
export const fspDemoFixtureId = "FSP-DEMO-2026";
export const fspFixtureVersion = "signal-fsp-example-v2";
const supportedFixtureVersions = new Set(['signal-fsp-example-v1', fspFixtureVersion]);

export type FspProviderContext = { accountIsDemo: boolean; demoEnabled: boolean };
export type FspProviderResult = {
  status: "pending" | "connected_demo" | "unavailable";
  provenance: "user_supplied" | "synthetic_fixture";
  providerVersion: string | null;
  verified: boolean;
  achievements: FspAchievement[];
  errorCode: string | null;
};

/** The production adapter must obtain the identifier from verified OIDC claims. */
export interface FspRegistryProvider {
  resolve(fspId: string, context: FspProviderContext): Promise<FspProviderResult>;
}

// The official identifier grammar was not supplied. Keep the value opaque,
// bounded and safe for display; no URL/email/profile lookup is performed.
export function normalizeFspId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(normalized) ? normalized : null;
}

export function canUseFspExample(context: FspProviderContext): boolean {
  return context.accountIsDemo && context.demoEnabled;
}

export function validFspLinkInput(input: unknown): { fspId: string; consentImport: true } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "fspId" && key !== "consentImport")) return null;
  const fspId = normalizeFspId(body.fspId);
  return fspId && body.consentImport === true ? { fspId, consentImport: true } : null;
}

/** Storing an opaque identifier is not import consent, registry verification, or an achievement. */
export function validFspSaveInput(input: unknown): { fspId: string } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== 'fspId')) return null;
  const fspId = normalizeFspId(body.fspId);
  return fspId ? { fspId } : null;
}

export function savedFspIdentityValues(fspId: string, now: Date) {
  return { fspId, status: 'pending' as const, consentVersion: null, consentedAt: null,
    requestedAt: now, revokedAt: null, verifiedAt: null, importedAt: null,
    provenance: 'user_supplied' as const, providerVersion: null, achievements: [],
    lastErrorCode: 'registry_not_configured', updatedAt: now };
}

export const fspRegistryProvider: FspRegistryProvider = {
  async resolve(fspId, context) {
    if (fspId === fspDemoFixtureId && canUseFspExample(context)) {
      return {
        status: "connected_demo", provenance: "synthetic_fixture",
        providerVersion: fspFixtureVersion, verified: true, errorCode: null,
        achievements: [
          { id: "example-participation-1", title: "Участник соревнования", event: "Пример: командный турнир по программированию", occurredAt: "2026-09-12", kind: "participation", result: 'participation' },
          { id: "example-prize-1", title: "Призовое место", event: "Пример: открытый чемпионат по алгоритмам", occurredAt: "2026-09-20", kind: "placement", result: 'prize' },
          { id: "example-win-1", title: "Победа", event: "Пример: командное соревнование", occurredAt: "2026-09-25", kind: "placement", result: 'win' },
        ],
      };
    }
    return {
      status: "pending", provenance: "user_supplied", providerVersion: null,
      verified: false, achievements: [], errorCode: "registry_not_configured",
    };
  },
};

/** A failed registry import never turns into a partial or trusted achievement. */
export async function resolveFspSafely(fspId: string, context: FspProviderContext, provider: FspRegistryProvider = fspRegistryProvider): Promise<FspProviderResult> {
  try {
    const result = await provider.resolve(fspId, context);
    if (!result || !["pending", "connected_demo", "unavailable"].includes(result.status) || typeof result.verified !== 'boolean'
      || !['user_supplied','synthetic_fixture'].includes(result.provenance)
      || !(result.providerVersion === null || typeof result.providerVersion === 'string' && result.providerVersion.length <= 120)
      || ![null,'registry_not_configured','registry_unavailable','registry_timeout'].includes(result.errorCode)
      || !validFspAchievements(result.achievements)) throw new Error("invalid_provider_result");
    if (result.status === "connected_demo" && (fspId !== fspDemoFixtureId || !hasTrustedFspHistory(result, context))) throw new Error("untrusted_provider_result");
    if (result.status !== "connected_demo" && (result.verified || result.achievements.length || result.provenance !== 'user_supplied' || result.providerVersion !== null)) throw new Error("untrusted_provider_result");
    return {status:result.status,provenance:result.provenance,providerVersion:result.providerVersion,verified:result.verified,errorCode:result.errorCode,
      achievements:result.achievements.map(({id,title,event,occurredAt,kind,result:outcome})=>({id,title,event,occurredAt,kind,...(outcome?{result:outcome}:{})}))};
  } catch {
    return { status: "unavailable", provenance: "user_supplied", providerVersion: null, verified: false, achievements: [], errorCode: "registry_unavailable" };
  }
}

/** Never infer achievements or a ranking bonus from an identifier alone. */
export function hasTrustedFspHistory(result: FspProviderResult, context: FspProviderContext): boolean {
  return canUseFspExample(context) && result.status === "connected_demo" && result.verified === true &&
    result.errorCode === null && result.provenance === "synthetic_fixture" && supportedFixtureVersions.has(result.providerVersion ?? '') && validFspAchievements(result.achievements) && result.achievements.length > 0;
}

/** Current consent/revocation and exact example identity are fresh SQL facts. */
export function fspSignalFromConnection(row: { fspId: string | null; status: string; consentVersion: string | null; consentedAt: unknown; verifiedAt: unknown; revokedAt: unknown; provenance: string | null; providerVersion: string | null; achievements: unknown; lastErrorCode?:string|null } | null | undefined, context: FspProviderContext) {
  if (!row || row.status === 'unlinked') return emptyFspSignal();
  const trusted = row.fspId === fspDemoFixtureId && row.consentVersion === fspConsentVersion && Boolean(row.consentedAt) && Boolean(row.verifiedAt) && !row.revokedAt
    && hasTrustedFspHistory({ ...row, verified: true, errorCode: row.lastErrorCode ?? null } as FspProviderResult, context);
  return trusted ? trustedFspResults(row.achievements as FspAchievement[]) : emptyFspSignal(true);
}

export function fspStatusMessage(status: "unlinked" | FspProviderResult["status"]): string {
  if (status === "connected_demo") return "Показан пример спортивной истории. Это вымышленные результаты.";
  if (status === "pending") return "ID сохранён. Подтверждение станет доступно после подключения реестра ФСП. Пока сведения не участвуют в подборе.";
  if (status === "unavailable") return "Сведения ФСП временно недоступны. Профиль, проверка навыков и приглашения работают как обычно.";
  return "Добавьте ФСП ID, если участвуете в спортивном программировании. Без него доступны все основные возможности Signal.";
}
