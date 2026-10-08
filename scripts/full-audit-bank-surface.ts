/** Stateless adversarial selectors see only visible options. Oracles are evaluation-only. */
import { createHash } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { buildSkillAttempt, scoreSkillAttempt, skillModuleRegistry, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
const dir = 'outputs/verification/full-audit-a01-a11-20261008/bank';
const hash = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);
const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-zа-яё][a-zа-яё0-9_-]{3,}/g) ?? []);
const strategies = ['longest', 'shortest', 'length_rank_2', 'length_rank_3', 'first', 'last', 'few_absolutes', 'few_boilerplate', 'term_overlap', 'few_clauses', 'random'] as const;
type Strategy = typeof strategies[number];
function pick(options: string[], context: string, strategy: Strategy, seed: string) {
  if (strategy === 'first') return 0; if (strategy === 'last') return options.length - 1;
  if (strategy === 'random') return hash(seed) % options.length;
  if(strategy==='length_rank_2'||strategy==='length_rank_3'){const ranked=options.map((text,i)=>({i,length:text.length,tie:hash(`${seed}|${i}`)})).sort((a,b)=>a.length-b.length||a.tie-b.tie);return ranked[strategy==='length_rank_2'?1:2]!.i;}
  const terms = tokens(context);
  const scores = options.map(text => strategy === 'longest' ? text.length : strategy === 'shortest' ? -text.length :
    strategy === 'few_absolutes' ? -(text.match(/автоматически|всегда|никогда|любой|гарантирует|без проверки|не нужен/gi)?.length ?? 0) :
    strategy === 'few_boilerplate' ? -(text.match(/Добавить compile|Зарегистрировать|Дополнительно|Задать bounded|Описать strict|Сохранить route|Проверить runtime|Отдельно измерять/gi)?.length ?? 0) :
    strategy === 'few_clauses' ? -(text.match(/[;:.]/g)?.length ?? 0) : [...tokens(text)].filter(t => terms.has(t)).length);
  const best = Math.max(...scores), tied = scores.map((score, i) => score === best ? i : -1).filter(i => i !== -1);
  return tied[hash(seed) % tied.length]!;
}
function answer(form: ReturnType<typeof buildSkillAttempt>, strategy: Strategy, seed: string) {
  let total = 0, correct = 0;
  const answers: Record<string, string> = {};
  for (const c of form.cases) {
    const oracle = form.oracles[c.id]!;
    if (c.options) {
      const selected = c.options[pick(c.options.map(o => o.text), c.prompt, strategy, `${seed}-${c.id}`)]!.id;
      answers[c.id] = selected; total++; correct += Number(selected === oracle.expected); continue;
    }
    if (!oracle.parts) { answers[c.id] = oracle.expected; continue; }
    const parts = c.prompt.split(/\n\n(?=Часть (?:B|[12]))/);
    const fragments = oracle.parts!.map((part, i) => {
      const visible = parts[i] ?? '';
      const choices = [...visible.matchAll(/^([1-4])\. (.+)$/gm)].map(match => match[2]!);
      if (!choices.length) return part.expected; // Known open parts are held correct to isolate choice-only shortcuts.
      const selected = String(pick(choices, visible.replace(/^[1-4]\. .+$/gm, ''), strategy, `${seed}-${c.id}-${i}`) + 1);
      total++; correct += Number(selected === part.expected); return selected;
    });
    answers[c.id] = fragments.join(';');
  }
  return { answers, total, correct };
}
const rows: any[] = [];
for (const module of skillModuleRegistry) for (const level of ['Junior', 'Middle', 'Senior'] as const) {
  const samples = module.id === 'backend-engineering' && level === 'Middle' ? 1000 : 300;
  const counts = Object.fromEntries(strategies.map(strategy => [strategy, { passed: 0, scoreTotal: 0, choices: 0, correctChoices: 0 }]));
  for (let i = 0; i < samples; i++) {
    const form = buildSkillAttempt(module.id, level, `full-audit-length-${i}`);
    for (const strategy of strategies) {
      const response = answer(form, strategy, `blind-${module.id}-${level}-${i}`);
      const decision = scoreSkillAttempt(form.cases, form.oracles, response.answers, form.policy);
      counts[strategy].passed += Number(decision.passed); counts[strategy].scoreTotal += decision.score;
      counts[strategy].choices += response.total; counts[strategy].correctChoices += response.correct;
    }
  }
  rows.push({ skill: module.id, level, samples, strategies: counts });
}
await mkdir(dir, { recursive: true });
const oldAudit = JSON.parse(await readFile(`${dir}/recorded-before-audit.json`, 'utf8'));
const sourceFiles=['artifacts/api-server/src/lib/skill-module-bank.ts','artifacts/api-server/src/lib/skill-middle-outcomes.ts','artifacts/api-server/src/lib/skill-senior-outcomes.ts','artifacts/api-server/src/lib/skill-middle-reviewed-choices-v6.ts','artifacts/api-server/src/lib/skill-junior-reviewed-choices-v6.ts','artifacts/api-server/src/lib/skill-senior-reviewed-choices-v6.ts','artifacts/api-server/src/lib/skill-senior-backend-reviewed-choices-v6.ts','artifacts/api-server/src/lib/skill-senior-react-frontend-reviewed-choices-v6.ts','artifacts/api-server/src/lib/skill-reviewed-contrasts-v6.ts','artifacts/api-server/src/lib/skill-junior-server-contrasts-v6.ts','artifacts/api-server/src/lib/skill-junior-ui-contrast-choices-v6.ts','artifacts/api-server/src/lib/skill-senior-frontend-contrasts-v6.ts','artifacts/api-server/src/lib/skill-junior-protocol-choices-v6.ts','artifacts/api-server/src/lib/skill-senior-frontend-protocol-choices-v6.ts'];
sourceFiles.push('artifacts/api-server/src/lib/skill-junior-sql-python-protocol-choices-v6.ts');
const sourceHashes=await Promise.all(sourceFiles.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
await writeFile(`${dir}/surface-controls-final-v6-run6.json`, JSON.stringify({ bankVersion: SKILL_BANK_VERSION, policy: 'All open parts intentionally held correct from private evaluation keys; selectors receive only options/context and seeded tie-break, never the choice key. Conditional shortcut experiment, not probability of human qualification.', source: 'scripts/full-audit-bank-surface.ts', sourceHashes, beforeRecordedAudit: { version: oldAudit.version, backendMiddleLongest: oldAudit.backendMiddleLongest, backendMiddleSamples: oldAudit.backendMiddleSamples, sourceSha256:oldAudit.sourceSha256 }, rows, measuredAt: new Date().toISOString(), limitations: ['Finite authored bank cannot prevent source memorization/AI assistance.', 'Text strategies are bounded specified probes, not an exhaustive adversary or human study.', 'Few choices can make conditional whole-form pass exceed25%; random is measured on the identical forms/held-correct open parts.'] }, null, 2));
for (const row of rows) console.log(JSON.stringify({ skill: row.skill, level: row.level, samples: row.samples, rates: Object.fromEntries(strategies.map(s => [s, { pass: row.strategies[s].passed, choiceCorrect: Math.round(100 * row.strategies[s].correctChoices / Math.max(1, row.strategies[s].choices)) }])) }));
