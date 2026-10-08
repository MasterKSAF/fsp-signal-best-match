export const invitationWorkFormats = ['Удалённо', 'Офис', 'Гибрид'] as const;
export type InvitationWorkFormat = typeof invitationWorkFormats[number];

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();
const aliases: Record<InvitationWorkFormat, readonly string[]> = {
  'Удалённо': ['удаленно', 'удаленка', 'удаленная работа', 'удаленный формат', 'удаленный режим', 'работа удаленно', 'работа из дома', 'дистанционно', 'дистанционная работа', 'remote'],
  'Офис': ['офис', 'в офисе', 'работа в офисе', 'офисная работа', 'офисный формат', 'офисный режим', 'очно', 'очный формат', 'on-site', 'onsite'],
  'Гибрид': ['гибрид', 'гибридно', 'гибридная работа', 'гибридный формат', 'гибридный режим', 'hybrid'],
};
const negativeAliases: Record<InvitationWorkFormat, readonly string[]> = {
  'Удалённо': ['удаленки', 'удаленной работы', 'удаленного формата', 'удаленного режима', 'дистанционной работы'],
  'Офис': ['офиса', 'офисной работы', 'офисного формата', 'офисного режима'],
  'Гибрид': ['гибрида', 'гибридной работы', 'гибридного формата', 'гибридного режима'],
};
function exactFormat(value: string, negative: boolean) {
  return invitationWorkFormats.find(format => aliases[format].includes(value) || negative && negativeAliases[format].includes(value));
}

/** Conservative classification of explicit alternatives, never a substring
 * inference. Unknown clauses leave the description unclassified; the original
 * wording is retained by the invitation DTO and storage. Explicit exclusions
 * override a contradictory positive clause. */
export function classifyInvitationWorkFormat(description: string): InvitationWorkFormat[] {
  const text = normalize(description).replace(/^(?:формат(?: работы)?|режим(?: работы)?|работа)\s*:\s*/u, '').replace(/[.!]+$/u, '').trim();
  if (!text) return [];
  const clauses = text.split(/(?:\s+(?:и\s*\/\s*или|или|либо|и|но)\s+|[,;/+&])/u).map(part => part.trim()).filter(Boolean);
  const allowed = new Set<InvitationWorkFormat>();
  const excluded = new Set<InvitationWorkFormat>();
  for (const clause of clauses) {
    const prefix = /^(?:без|не|нет|никакой)\s+(.+)$/u.exec(clause);
    const suffix = /^(.+?)\s+(?:не (?:предусмотрен(?:а|о)?|допускается|рассматривается)|исключен(?:а|о)?|нет)$/u.exec(clause);
    const negative = !!(prefix || suffix);
    const value = (prefix?.[1] ?? suffix?.[1] ?? clause).replace(/^(?:только|доступ(?:на|ен|ны|но)|возмож(?:на|ен|ны|но))\s+/u, '').trim();
    const format = exactFormat(value, negative);
    if (!format) return [];
    (negative ? excluded : allowed).add(format);
  }
  return invitationWorkFormats.filter(format => allowed.has(format) && !excluded.has(format));
}

export function invitationAllowsWorkFormat(description: string, requested: InvitationWorkFormat) {
  return classifyInvitationWorkFormat(description).includes(requested);
}
