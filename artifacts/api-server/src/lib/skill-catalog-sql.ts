import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { SKILL_SEARCH_WHITESPACE_PATTERN, skillSearchAliases } from './skill-catalog';

/** A read expression for existing UTF8 PostgreSQL values; stored user text stays intact. */
export function normalizeStoredSkill(value: SQLWrapper): SQL {
  return sql`lower(btrim(regexp_replace(normalize(${value}, NFKC), ${SKILL_SEARCH_WHITESPACE_PATTERN}, ' ', 'g')))`;
}

/** Filter before COUNT/LIMIT, including old records without a canonical backfill.
 * Values and query aliases are bound parameters; no user text becomes SQL code. */
export function skillArrayMatches(skillValues: SQLWrapper, query: string): SQL {
  const aliases = skillSearchAliases(query);
  return sql`exists (select 1 from unnest(${skillValues}) as item where ${normalizeStoredSkill(sql`item`)} in (${sql.join(aliases.map(alias => sql`${alias}`), sql`, `)}))`;
}
