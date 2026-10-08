/** Bounded QA guards and synthetic fixture helpers; never reset existing data. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalSessionsTable as sessions } from '../lib/db/src/index';
import { hashPassword } from '../artifacts/api-server/src/lib/signal-auth';

export const proofDirectory = 'outputs/verification/candidate-workspace-skill-matrix-20261008';
export function qaEnvironment() {
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55435');
  assert.equal(database.pathname, '/signal_independent_fixes_20261007');
  assert.equal(process.env.PORT, '4367');
  assert.equal(process.env.SIGNAL_WORKSPACE_ENABLED, 'true');
  assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED, 'true');
}
export function powershell(script: string) {
  return execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe', ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from("$ProgressPreference = 'SilentlyContinue'; " + script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000 }).trim();
}
export async function guardRuntime(bundlePath: string, expectedSha: string, expectedPid: number, port = 4367) {
  assert.ok(bundlePath.replaceAll('\\', '/').startsWith('C:/Users/Misha/Documents/ChatGPT/LCT/fsp-signal/outputs/local-backup/'));
  assert.match(expectedSha, /^[a-f0-9]{64}$/); assert.ok(Number.isSafeInteger(expectedPid) && expectedPid > 0);
  const sha256 = createHash('sha256').update(await readFile(bundlePath)).digest('hex'); assert.equal(sha256, expectedSha);
  assert.ok(port === 4367 || port === 4389);
  const state = JSON.parse(powershell(`$taskListeners = @(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if ($taskListeners.Count -ne 1) { throw 'Expected exactly one QA API process' }; $taskApi = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $taskListeners[0]); @{pid=$taskApi.ProcessId; commandLine=$taskApi.CommandLine} | ConvertTo-Json -Compress`));
  assert.equal(state.pid, expectedPid);
  assert.ok(String(state.commandLine).replaceAll('\\', '/').toLowerCase().includes(bundlePath.replaceAll('\\', '/').toLowerCase()));
  return { pid: expectedPid, port, bundlePath: bundlePath.replaceAll('\\', '/'), sha256 };
}
export type OwnedActor = { id: number; email: string; password: string; token: string };
export async function createOwnedActor(prefix: string, role: 'candidate' | 'employer', name: string): Promise<OwnedActor> {
  const email = prefix + '-' + randomUUID() + '@example.test';
  const password = 'Qa9!' + randomBytes(20).toString('base64url');
  const token = randomBytes(32).toString('base64url');
  return db.transaction(async tx => {
    const [user] = await tx.insert(users).values({ email, passwordHash: await hashPassword(password), displayName: name, role, emailVerified: true, demoMode: false }).returning();
    assert.ok(user);
    await tx.insert(sessions).values({ userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 7200000), demoMode: false });
    return { id: user.id, email, password, token };
  });
}
export async function deleteOwnedActor(actor: OwnedActor) {
  const [owned] = await db.select({ email: users.email }).from(users).where(eq(users.id, actor.id));
  assert.equal(owned?.email, actor.email); assert.ok(actor.email.endsWith('@example.test'));
  await db.delete(users).where(and(eq(users.id, actor.id), eq(users.email, actor.email)));
  assert.equal((await db.select({ id: users.id }).from(users).where(eq(users.id, actor.id))).length, 0);
}
export async function request(actor: OwnedActor, path: string, method = 'GET', body?: unknown, port = 4367) {
  assert.ok(port === 4367 || port === 4389);
  const response = await fetch(`http://localhost:${port}/api` + path, { method, headers: { Cookie: 'fsp_signal_session=' + actor.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json(); return { status: response.status, data };
}
export async function ok(actor: OwnedActor, path: string, method = 'GET', body?: unknown, status = 200, port = 4367) {
  const result = await request(actor, path, method, body, port);
  assert.equal(result.status, status, result.data.error ?? path); return result.data;
}
export async function protectedState(legacyIds?: number[]) {
  const legacyRows = (await pool.query(`select json_build_object('count',count(*),'sha',md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text)) as baseline, coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text as content, array_agg(id order by id) as ids from signal_assessment_attempts t${legacyIds ? ' where id=any($1::int[])' : ''}`, legacyIds ? [legacyIds] : [])).rows[0];
  const legacy = { count: legacyRows.baseline.count, md5: legacyRows.baseline.sha, sha256: createHash('sha256').update(legacyRows.content).digest('hex'), ids: legacyRows.ids };
  const actor = (await pool.query(`select jsonb_build_object(
    'user',(select to_jsonb(u) from signal_users u where id=997),
    'profile',(select to_jsonb(p) from signal_candidate_profiles p where user_id=997),
    'resumes',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from signal_candidate_resumes r where user_id=997),
    'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from signal_skill_attempts a where user_id=997),
    'exposures',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from signal_skill_exposures e where user_id=997),
    'evidence',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from signal_skill_evidence e where user_id=997),
    'corrections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from signal_skill_corrections c join signal_skill_evidence e on e.id=c.evidence_id where e.user_id=997),
    'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from signal_skill_categories c where user_id=997))::text as content`)).rows[0].content;
  return { legacy, actor997Sha256: createHash('sha256').update(actor).digest('hex') };
}
