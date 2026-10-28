import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SKILL_BANK_VERSION, skillModulePolicy, seniorSkillModulePolicy, skillModuleRegistry, skillModuleTemplates } from './skill-module-bank';

/** Canonical JSON is independent of object insertion order, timestamps and host paths. */
export function canonicalBankJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBankJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => `${JSON.stringify(k)}:${canonicalBankJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const bankContentHash = (value: unknown) => createHash('sha256').update(canonicalBankJson(value)).digest('hex');
const fileHash = (value: string) => createHash('sha256').update(value).digest('hex');
const bankEntry = 'artifacts/api-server/src/lib/skill-module-bank.ts';
const qualificationEntry = 'artifacts/api-server/src/lib/skill-module-qualification.ts';
export const bankCheckerFiles = [
  'artifacts/api-server/src/lib/skill-bank-checker.ts', 'scripts/attest-skill-bank.ts',
  'tests/skill-senior-v4.test.ts', 'tests/skill-senior-correction01.test.ts',
  'tests/skill-senior-react-frontend-editorial-v6.test.ts', 'tests/skill-middle-v2.test.ts',
  'tests/skill-junior-editorial-v6.test.ts', 'tests/skill-junior-ui-contrasts-v6.test.ts',
  'tests/skill-junior-sql-python-protocol-v6.test.ts', 'tests/skill-full-audit-bank.test.ts',
];
export type BankCheck = { id: string; passed: boolean; checked: number; limitations?: string };
export type BankAttestation = { schema: 1; manifestHash: string; checkerVersion: string; checkerHash: string; checks: BankCheck[]; passed: boolean };
export type BankManifest = { schema: 1; programVersion: string; languages: string[]; modules: typeof skillModuleRegistry; templates: typeof skillModuleTemplates; policies: { ordinary: typeof skillModulePolicy; senior: typeof seniorSkillModulePolicy }; files: { path: string; hash: string }[] };
export type BankBundle = { manifest: BankManifest; manifestHash: string; releaseId: string; sources: Record<string, string>; checkerHash: string; attestation: BankAttestation | null };
declare const __SIGNAL_SKILL_BANK_BUNDLE__: BankBundle | undefined;

export function findBankRepository(start = process.cwd()): string {
  let current = path.resolve(start);
  while (!existsSync(path.join(current, bankEntry))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Skill bank sources are unavailable; use an attested production build.');
    current = parent;
  }
  return current;
}

/** Archive the complete local dependency closure, including indirectly imported helpers. */
export function bankSourceClosure(root: string, entries = [bankEntry, qualificationEntry]): Record<string, string> {
  const sources: Record<string, string> = {};
  function visit(relative: string) {
    const normalized = relative.replaceAll('\\', '/');
    if (normalized.startsWith('../') || path.isAbsolute(normalized)) throw new Error('Bank dependency escaped repository');
    if (normalized in sources) return;
    const source = readFileSync(path.join(root, normalized), 'utf8');
    sources[normalized] = source;
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(normalized), match[1]));
      const candidates = [dependency, `${dependency}.ts`, `${dependency}/index.ts`];
      const resolved = candidates.find(candidate => existsSync(path.join(root, candidate)));
      if (!resolved) throw new Error(`Unresolved bank dependency: ${dependency}`);
      visit(resolved);
    }
  }
  entries.forEach(visit);
  return Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

export function buildBankBundle(root = findBankRepository()): BankBundle {
  const sources = bankSourceClosure(root);
  const manifest: BankManifest = { schema: 1, programVersion: SKILL_BANK_VERSION, languages: ['Python 3', 'TypeScript strict', 'SQL (standard)', 'React'], modules: skillModuleRegistry, templates: skillModuleTemplates, policies: { ordinary: skillModulePolicy, senior: seniorSkillModulePolicy }, files: Object.entries(sources).map(([p, content]) => ({ path: p, hash: fileHash(content) })) };
  const manifestHash = bankContentHash(manifest);
  const checkerHash = bankContentHash(bankCheckerFiles.map(p => ({ path: p, hash: fileHash(readFileSync(path.join(root, p), 'utf8')) })));
  const attestationPath = path.join(root, 'artifacts/api-server/src/data/skill-bank-attestation.json');
  const attestation = existsSync(attestationPath) ? JSON.parse(readFileSync(attestationPath, 'utf8')) as BankAttestation : null;
  return { manifest, manifestHash, releaseId: `${SKILL_BANK_VERSION}:${manifestHash}`, sources, checkerHash, attestation };
}
export class SkillBankNotAttestedError extends Error { constructor() { super('Новая проверка временно недоступна: выпуск банка ожидает проверки. Сохранённые попытки доступны.'); } }
export function assertBankAttested(bundle: BankBundle): asserts bundle is BankBundle & { attestation: BankAttestation } {
  const a = bundle.attestation;
  if (bankContentHash(bundle.manifest) !== bundle.manifestHash || !a || a.schema !== 1 || a.manifestHash !== bundle.manifestHash || a.checkerHash !== bundle.checkerHash || a.checkerVersion !== 'signal-bank-checker-v1' || !a.passed || !a.checks.length || a.checks.some(c => !c.passed || c.checked < 1)) throw new SkillBankNotAttestedError();
  const required:Record<string,number>={'all-family-input-domain-and-unique-options':3240,'python-reference-runtime':320,'typescript-reference-runtime':260,'positive-negative-critical-rubric':72,'handwritten-outcomes-and-historical-bank-regressions':8};
  if(new Set(a.checks.map(c=>c.id)).size!==a.checks.length||Object.entries(required).some(([id,min])=>!a.checks.some(c=>c.id===id&&c.passed&&c.checked>=min)))throw new SkillBankNotAttestedError();
  for (const file of bundle.manifest.files) if (!(file.path in bundle.sources) || fileHash(bundle.sources[file.path]) !== file.hash) throw new SkillBankNotAttestedError();
}
const loadedDevelopmentManifestHash = typeof __SIGNAL_SKILL_BANK_BUNDLE__ === 'undefined' ? buildBankBundle().manifestHash : null;
export function currentBankBundle(): BankBundle & { attestation: BankAttestation } {
  // Development reads on every issuance: a warm process cannot mask an edited helper.
  const bundle = typeof __SIGNAL_SKILL_BANK_BUNDLE__ === 'undefined' ? buildBankBundle() : __SIGNAL_SKILL_BANK_BUNDLE__;
  if (loadedDevelopmentManifestHash && loadedDevelopmentManifestHash !== bundle.manifestHash) throw new SkillBankNotAttestedError();
  assertBankAttested(bundle);
  return bundle;
}
