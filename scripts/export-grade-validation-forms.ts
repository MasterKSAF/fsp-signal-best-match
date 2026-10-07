/** Only public task text is exported. No answer/oracle fields are read here. */
import { mkdir, writeFile } from 'node:fs/promises';
import { assembleManagedAttempt, assessmentPrograms } from '../artifacts/api-server/src/lib/assessment-managed';

const forms = assessmentPrograms.flatMap(program => (['Junior', 'Middle', 'Senior'] as const).flatMap(grade =>
  (['independent-v1', 'independent-holdout-v1', 'grade-validation-20261006-fresh-control'] as const).flatMap((seed, batch) => ([0, 1] as const).map(variant => ({
    id: `${program.id}:${grade}:${['development', 'diagnostic-holdout', 'fresh-control'][batch]}:${variant === 0 ? 'A' : 'B'}`,
    programId: program.id, programVersion: program.version, grade, seed, batch: ['development', 'diagnostic-holdout', 'fresh-control'][batch],
    form: variant === 0 ? 'A' : 'B', variant,
    cases: assembleManagedAttempt(program.id, grade, seed, { forcedVariant: variant }).cases,
  })))));
await mkdir('docs/validation', { recursive: true });
await writeFile('docs/validation/visible-forms-v1.json', JSON.stringify({ version: 'signal-grade-visible-v1', provenance: 'Synthetic generated public prompts; no oracle answers exported.', forms }, null, 2));
console.log(`Exported ${forms.length} public forms; inspect and freeze independent answers separately.`);
