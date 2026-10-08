import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { buildSkillAttempt, scoreSkillAttempt, skillModuleRegistry, skillModuleTemplates, skillContentFamilyId, SkillBankUnavailableError, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { historicalSeniorV4RequirementProbe, historicalSeniorV5RequirementProbe, seniorRequirementProbe } from '../artifacts/api-server/src/lib/skill-senior-outcomes';
import { seniorV5ChangedFamilies } from '../artifacts/api-server/src/lib/skill-senior-corrections-v5';
import { selectAccountSkillEvidence, type SkillModuleEvidence } from '../artifacts/api-server/src/lib/skill-module-qualification';

const cases = [
  { skill: 'sql', c: 3, s: 0, competency: 'transactions' },
  { skill: 'sql', c: 5, s: 2, competency: 'constraints' },
  { skill: 'typescript', c: 2, s: 0, competency: 'generics' },
  { skill: 'react', c: 1, s: 0, competency: 'closures' },
  { skill: 'react', c: 4, s: 0, competency: 'forms' },
] as const;
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Independent reference: transaction writes publish only at COMMIT; delivery dedupe belongs to recipient. */
function outboxTrace(firstRollback: boolean, outboxAtomic: boolean, recipientDedupe: boolean, markBeforeSend = false) {
  let orders = 0, outbox = 0, effects = 0;
  const transaction = (commit: boolean) => { if (commit) { orders++; if (outboxAtomic) outbox++; } };
  transaction(!firstRollback); if (firstRollback) transaction(true);
  // Crash immediately after COMMIT; an ordinary post-commit callback has not run.
  if (!outbox) return { orders, outbox, effects, pending: false };
  if (markBeforeSend) return { orders, outbox, effects, pending: false }; // crash before network send loses the event
  const provider = new Set<string>();
  for (const _ of ['receive-before-lost-ack', 'receive-after-lease-expiry']) {
    if (!recipientDedupe || !provider.has('K')) effects++;
    provider.add('K');
  }
  return { orders, outbox, effects, pending: false };
}
test('C04 SQL transactions adds COMMIT/send and receive/ACK failures that Middle guard/retry does not cover', () => {
  for (const flag of [false, true]) {
    const primary = seniorRequirementProbe('sql', 3, 0, 5, flag).parts[0];
    const actual = outboxTrace(flag, true, false);
    assert.equal(primary.expected, `${actual.orders}|${actual.outbox}|${actual.effects}`);
    assert.equal(outboxTrace(flag, true, true).effects, 1);
    assert.equal(outboxTrace(flag, false, true).effects, 0); // serializable + callback misses post-COMMIT crash
    assert.equal(outboxTrace(flag, true, true, true).effects, 0); // mark-before-send loses committed intent
    assert.equal(actual.effects, 2); // SQL uniqueness alone does not deduplicate recipient effects
  }
});

/** Real isolated SQLite execution for the explicitly described partial unique/FK semantics; not a PostgreSQL deployment claim. */
test('C04 SQL constraints independently executes partial uniqueness versus active-parent referential integrity', () => {
  const script = String.raw`
import sqlite3,json
results=[]
for active in [False,True]:
  db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
  db.executescript('CREATE TABLE users(tenant TEXT,id INTEGER,email TEXT,deleted_at INTEGER,UNIQUE(tenant,id));CREATE UNIQUE INDEX active_email ON users(tenant,lower(email)) WHERE deleted_at IS NULL;CREATE TABLE orders(tenant TEXT,user_id INTEGER,FOREIGN KEY(tenant,user_id) REFERENCES users(tenant,id));')
  db.executemany('INSERT INTO users VALUES(?,?,?,?)',[('A',5,'x',None if active else 1),('A',6,'x',1),('B',5,'x',None)])
  db.execute('INSERT INTO orders VALUES(?,?)',('A',6));accepted=1
  try: db.execute('UPDATE users SET deleted_at=NULL WHERE tenant=? AND id=?',('A',6));restored=1
  except sqlite3.IntegrityError: restored=0
  results.append({'active':active,'primary':f'{accepted}|{restored}'})
  db.executescript('CREATE TABLE active_membership(tenant TEXT,user_id INTEGER,PRIMARY KEY(tenant,user_id),FOREIGN KEY(tenant,user_id) REFERENCES users(tenant,id));CREATE TABLE live_orders(tenant TEXT,user_id INTEGER,FOREIGN KEY(tenant,user_id) REFERENCES active_membership(tenant,user_id));')
  rejected=False
  try: db.execute('INSERT INTO live_orders VALUES(?,?)',('A',6))
  except sqlite3.IntegrityError: rejected=True
  assert rejected
  db.execute('INSERT INTO active_membership VALUES(?,?)',('A',5));db.execute('INSERT INTO live_orders VALUES(?,?)',('A',5))
  rejected=False
  try: db.execute('DELETE FROM active_membership WHERE tenant=? AND user_id=?',('A',5))
  except sqlite3.IntegrityError: rejected=True
  assert rejected
print(json.dumps(results))`;
  const rows = JSON.parse(execFileSync('python', ['-c', script], { encoding: 'utf8' })) as { active: boolean; primary: string }[];
  for (const row of rows) assert.equal(row.primary, seniorRequirementProbe('sql', 5, 2, 5, row.active).parts[0].expected);
  // Ordinary FK did accept inactive user; active membership refused missing and referenced deletion.
  assert.deepEqual(rows.map(r => r.primary), ['1|1', '1|0']);
});

const compilerOptions: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, skipLibCheck: true, types: [] };
function diagnostics(source: string) {
  const file = 'senior-correction01-virtual.ts';
  const host = ts.createCompilerHost(compilerOptions);
  const base = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, onError, shouldCreate) => name === file ? ts.createSourceFile(file, source, lang, true) : base(name, lang, onError, shouldCreate);
  return ts.getPreEmitDiagnostics(ts.createProgram([file], compilerOptions, host)).filter(d => d.category === ts.DiagnosticCategory.Error);
}
test('C04 TypeScript compiler accepts explicit generic union hole and rejects both invalid discriminated tuples', () => {
  const common = `type Fields={name:string;age:number};const target:Fields={name:'N',age:5};function set<K extends keyof Fields>(target:Fields,key:K,value:Fields[K]){target[key]=value};type Command={[K in keyof Fields]:[key:K,value:Fields[K]]}[keyof Fields];declare function safeSet(...command:Command):void;`;
  for (const flag of [false, true]) {
    const pair = flag ? `'age','Ada'` : `'name',5`;
    assert.equal(diagnostics(`${common}set<keyof Fields>(target,${pair});`).length, 0);
    assert.ok(diagnostics(`${common}safeSet(${pair});`).length > 0);
    const runtime: Record<string, string | number> = { name: 'N', age: 5 };
    runtime[flag ? 'age' : 'name'] = flag ? 'Ada' : 5;
    assert.equal(seniorRequirementProbe('typescript', 2, 0, 5, flag).parts[0].expected, `yes|no|${typeof runtime[flag ? 'age' : 'name']}`);
  }
  assert.equal(diagnostics(`${common}safeSet('name','Ada');safeSet('age',5);`).length, 0);
  assert.equal(diagnostics(`type Fields={name:string;age:number};type Command={[K in keyof Fields]:[key:K,value:Fields[K]]}[keyof Fields];function apply(target:Fields,...[key,value]:Command){if(key==='name')target.name=value;else target.age=value;}`).length, 0);
});

/** Explicit scheduling trace, independent of production key; no claim this models every React scheduler interleaving. */
test('C04 React closure rejects publication from an abandoned render, independent of late-response fencing', () => {
  for (const publishesInRender of [false, true]) {
    const committed = 'A'; let latest = committed;
    const speculative = 'B'; if (publishesInRender) latest = speculative;
    // B suspends/abandons: no commit lifecycle. A button still calls its stable handler.
    const commandTarget = latest;
    assert.equal(seniorRequirementProbe('react', 1, 0, 5, publishesInRender).parts[0].expected, `${commandTarget}|${committed}`);
    assert.equal(commandTarget === committed, !publishesInRender);
  }
  // A new B commit may publish B. A response still belongs to A; this distinct old Middle rule remains necessary.
  assert.equal(historicalSeniorV4RequirementProbe('react', 1, 0, 5, true).parts[0].expected, 'no');
});

type Rows = Record<string, string>;
function mergeRows(base: Rows, local: Rows, remote: Rows) {
  const merged: Rows = {}, conflicts: string[] = [];
  for (const id of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[id], l = local[id], r = remote[id];
    if (l === r) { if (l !== undefined) merged[id] = l; }
    else if (l === b) { if (r !== undefined) merged[id] = r; }
    else if (r === b) { if (l !== undefined) merged[id] = l; }
    else { merged[id] = 'conflict'; conflicts.push(id); }
  }
  return { merged, conflicts };
}
test('C04 React form three-way merge detects edit/delete and preserves independent remote intent; blind retry fails', () => {
  const base = { a: 'Kazan', b: 'Perm' }, local = { a: 'Moscow', b: 'Perm' };
  for (const deletion of [false, true]) {
    const remote: Rows = deletion ? { b: 'Ufa' } : { b: 'Ufa', a: 'Moscow' }; // deliberate reorder
    const result = mergeRows(base, local, remote);
    assert.equal(seniorRequirementProbe('react', 4, 0, 5, deletion).parts[0].expected, `${result.merged.a}|${result.merged.b}|${result.conflicts.length}`);
    assert.equal(result.merged.b, 'Ufa');
    const blindRetry = { ...local };
    assert.notEqual(blindRetry.b, result.merged.b); // clobbers remote independent change
    if (deletion) { assert.equal(blindRetry.a, 'Moscow'); assert.equal(result.merged.a, 'conflict'); }
  }
  assert.deepEqual(mergeRows(base, { b: 'Perm' }, { a: 'Ufa', b: 'Perm' }).conflicts, ['a']); // local delete/remote edit
  assert.deepEqual(mergeRows(base, { a: 'Kazan', b: 'Perm' }, { b: 'Perm' }), { merged: { b: 'Perm' }, conflicts: [] }); // untouched local accepts delete
});

test('C04 only five content families change; all 103 untouched Senior scenarios retain exact full probes for all 10 variants', () => {
  let changed = 0, unchanged = 0;
  for (const module of skillModuleRegistry) for (let c = 0; c < 6; c++) for (let s = 0; s < 3; s++) {
    const key = `${module.id}:${module.competencies[c]}:s${s + 1}`;
    for (let n = 5; n <= 9; n++) for (const flag of [false, true]) {
      const old = historicalSeniorV4RequirementProbe(module.id, c, s, n, flag), current = historicalSeniorV5RequirementProbe(module.id, c, s, n, flag);
      if (seniorV5ChangedFamilies.has(key)) { assert.notDeepEqual(current.parts, old.parts); changed++; }
      else { assert.deepEqual(current, old); unchanged++; }
    }
    const currentId = `signal-skills-2026-10-v5:${module.id}:Senior:${module.competencies[c]}:s${s + 1}`;
    const oldId = currentId.replace('-v5:', '-v4:');
    assert.equal(skillContentFamilyId(oldId), `skill-senior-content-v1:${key}`);
    assert.equal(skillContentFamilyId(currentId), `skill-senior-content-v${seniorV5ChangedFamilies.has(key) ? 2 : 1}:${key}`);
    assert.equal(skillContentFamilyId(currentId).includes('content-v2:'),seniorV5ChangedFamilies.has(key));
  }
  assert.equal(changed, 50); assert.equal(unchanged, 1030);
  // Independent audit captured old overlap source before correction, not generated from the changed builder.
  const audit = JSON.parse(readFileSync(new URL('./fixtures/skill-senior-cycle01-overlaps-20261008.json', import.meta.url), 'utf8'));
  for (const item of cases) {
    const row = audit.overlaps.find((r: any) => r.seniorFamily === `skill-senior-content-v1:${item.skill}:${item.competency}:s${item.s + 1}`);
    assert.ok(row); assert.deepEqual(historicalSeniorV4RequirementProbe(item.skill, item.c, item.s, 5, true), row.senior);
  }
});

test('C04 old v4 snapshots are scored as frozen originals and v4 Senior proofs stay valid, without regrading from v5 content', () => {
  for (const module of skillModuleRegistry) {
    const current = buildSkillAttempt(module.id, 'Senior', 'history-v4-correction01');
    const snapshot = structuredClone(current); snapshot.programVersion = 'signal-skills-2026-10-v4';
    for (const [c, item] of snapshot.cases.entries()) {
      const probe = historicalSeniorV4RequirementProbe(module.id, c, 0, 5, true);
      item.templateId = `signal-skills-2026-10-v4:${module.id}:Senior:${item.competencyId}:s1`;
      item.templateVersion = 1; item.contentFamilyId = skillContentFamilyId(item.templateId); item.prompt = probe.parts.map(p => p.prompt).join('\n');
      snapshot.oracles[item.id] = { ...snapshot.oracles[item.id]!, expected: probe.parts.map(p => p.expected).join(';'), parts: probe.parts.map(p => ({ expected: p.expected, responseType: p.responseType })) };
    }
    const before = sha(snapshot), answers = Object.fromEntries(Object.entries(snapshot.oracles).map(([id, o]) => [id, o.expected]));
    const decision = scoreSkillAttempt(snapshot.cases, snapshot.oracles, answers, snapshot.policy);
    assert.equal(decision.passed, true);
    const evidence: SkillModuleEvidence = { id: 1, attemptId: 1, userId: 77, skillId: module.id, level: 'Senior', programVersion: snapshot.programVersion, competencyIds: decision.competencies.filter(c => c.passed).map(c => c.id), decision, verifiedAt: new Date('2026-10-08T12:00:00Z') };
    const selected = selectAccountSkillEvidence({ userId: 77, specialization: 'Backend / Python', assumedGrade: 'Senior', stack: [], skills: [] }, { evidence: [evidence], revokedIds: new Set() });
    assert.equal(selected.length, 1); assert.equal(selected[0]!.programVersion, 'signal-skills-2026-10-v4');
    buildSkillAttempt(module.id, 'Senior', 'new-v5-does-not-touch-history');
    assert.equal(sha(snapshot), before); assert.equal(scoreSkillAttempt(snapshot.cases, snapshot.oracles, answers, snapshot.policy).passed, true);
  }
});

test('C04 changed critical SQL failures still fail at 5/6; new invariant part required; lineage rotation stays bounded', () => {
  for (const item of cases) {
    const disabled = new Set(skillModuleTemplates.filter(t => t.skillId === item.skill && t.level === 'Senior' && t.competencyIndex === item.c && t.scenarioIndex !== item.s).map(t => t.id));
    const form = buildSkillAttempt(item.skill, 'Senior', `force-${item.competency}`, { disabled });
    const selected = form.cases[item.c]!, oracle = form.oracles[selected.id]!;
    assert.equal(selected.templateVersion, 2); assert.ok(selected.contentFamilyId!.startsWith('skill-senior-content-v2:'));
    const correct = Object.fromEntries(Object.entries(form.oracles).map(([id, o]) => [id, o.expected]));
    assert.equal(scoreSkillAttempt(form.cases, form.oracles, correct, form.policy).passed, true);
    for (const badResponse of [`wrong;${oracle.parts![1]!.expected}`, `${oracle.parts![0]!.expected};wrong`, oracle.parts![0]!.expected]) {
      const score = scoreSkillAttempt(form.cases, form.oracles, { ...correct, [selected.id]: badResponse }, form.policy);
      assert.equal(score.competencies[item.c]!.passed, false); assert.equal(score.score, 83);
      if (item.skill === 'sql') { assert.equal(selected.critical, true); assert.equal(score.passed, false); }
    }
  }
  for (const module of skillModuleRegistry) {
    const seen = new Map<string, number>();
    for (let i = 0; i < 3; i++) for (const item of buildSkillAttempt(module.id, 'Senior', `new-rotation-${i}`, { personalExposures: seen }).cases) { assert.ok(!seen.has(item.contentFamilyId!)); seen.set(item.contentFamilyId!, 1); }
    assert.throws(() => buildSkillAttempt(module.id, 'Senior', 'exhausted', { personalExposures: seen }), SkillBankUnavailableError);
    const oldSeen = new Map(skillModuleTemplates.filter(t => t.skillId === module.id && t.level === 'Senior').map(t => [t.id.replace(/-v\d+:/, '-v4:'), 1]));
    assert.throws(() => buildSkillAttempt(module.id, 'Senior', 'old-v4-completely-seen', { personalExposures: oldSeen }), SkillBankUnavailableError);
  }
});
