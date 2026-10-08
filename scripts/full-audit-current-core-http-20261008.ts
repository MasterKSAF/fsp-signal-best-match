/** Isolated synthetic regression: real module submissions, exact skill levels and matching-only document permissions. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { and, eq, inArray } from 'drizzle-orm';
import {
  db, pool, signalUsersTable as users, signalSessionsTable as sessions,
  signalCompaniesTable as companies, signalSkillAttemptsTable as attempts,
  signalNeedsTable as needs, signalContactGrantsTable as grants,
} from '../lib/db/src/index';
import { hashPassword } from '../artifacts/api-server/src/lib/signal-auth';
import { canonicalSkillKey } from '../artifacts/api-server/src/lib/skill-catalog';

const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '55435');
assert.equal(database.pathname, '/signal_full_audit_a10_20261008');
assert.equal(process.env.PORT, '4383');
assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED, 'true');
assert.equal(process.env.SIGNAL_WORKSPACE_ENABLED, 'true');

// Coordinator supplies the reviewed running bundle. Verify both its bytes and the process actually listening on 4383.
const [bundlePath, expectedSha, expectedPid, rerunTag] = process.argv.slice(2);
if (rerunTag !== undefined) assert.equal(rerunTag, 'after-performance-fix');
assert.ok(bundlePath && bundlePath.replaceAll('\\', '/').startsWith('C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008/outputs/verification/full-audit-a01-a11-20261008/clean-workspace/artifacts/api-server/dist/'));
assert.match(expectedSha ?? '', /^[a-f0-9]{64}$/);
assert.match(expectedPid ?? '', /^\d+$/);
const sha256 = createHash('sha256').update(await readFile(bundlePath)).digest('hex');
assert.equal(sha256, expectedSha, 'Coordinator-reviewed bundle bytes changed');
const ps = "$ProgressPreference = 'SilentlyContinue'; $taskListeners = @(Get-NetTCPConnection -LocalPort 4383 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique); if ($taskListeners.Count -ne 1) { throw 'Expected one listening API process' }; $taskApi = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $taskListeners[0]); @{pid=$taskApi.ProcessId; commandLine=$taskApi.CommandLine} | ConvertTo-Json -Compress";
const running = JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe', ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000 }));
assert.equal(running.pid, Number(expectedPid));
assert.ok(String(running.commandLine).replaceAll('\\', '/').toLowerCase().includes(bundlePath.replaceAll('\\', '/').toLowerCase()), 'Listening process is not the reviewed bundle');

const origin = 'http://localhost:4383';
const appOrigin = 'http://localhost:4384';
const prefix = 'skill-positive-' + randomUUID();
const owned: number[] = [];
const checks: { name: string; status: 'PASS'; assertions: number }[] = [];
const requestReceipts: { path: string; status: number; actorId: number }[] = [];
const directory = 'outputs/verification/full-audit-a01-a11-20261008/integration' + (rerunTag ? '/' + rerunTag : '');
const qaActors: any[] = [];
let passed = false, failure: string | undefined;
let remainingUsers: number | undefined;
let resumeId: number | undefined;
const actualAttempts: { skill: string; id: number; rubric: string }[] = [];
const exportArtifacts: {name:string;sha256:string;bytes:number}[] = [];
async function preserveExport(name:string,bytes:Buffer){await mkdir(directory+'/exports',{recursive:true});await writeFile(directory+'/exports/'+name,bytes,{flag:'wx'});exportArtifacts.push({name,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}

type Actor = { id: number; companyId?: number; cookie: string; email: string };
async function fixture(role: 'candidate' | 'employer', suffix: string): Promise<Actor> {
  const password = randomBytes(24).toString('base64url');
  const [user] = await db.insert(users).values({ email: `${prefix}-${suffix}@example.test`, passwordHash: await hashPassword(password), displayName: role === 'candidate' ? 'Андрей Петрович Светлов' : `Контрольная компания ${suffix}`, role, emailVerified: true, demoMode: false }).returning();
  assert.ok(user); owned.push(user.id);
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000), demoMode: false });
  let companyId: number | undefined;
  if (role === 'employer') {
    const [company] = await db.insert(companies).values({ ownerUserId: user.id, name: `Контрольная компания ${suffix}`, contactEmail: user.email }).returning();
    assert.ok(company); companyId = company.id;
  }
  const result = { id: user.id, companyId, cookie: 'fsp_signal_session=' + token, email: user.email };
  qaActors.push({ ...result, password, suffix, role }); return result;
}
async function request(actor: Actor, path: string, method = 'GET', body?: unknown) {
  const response = await fetch(origin + '/api' + path, { method, headers: { Cookie: actor.cookie, Origin: appOrigin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const json = response.headers.get('content-type')?.includes('json') ? JSON.parse(bytes.toString('utf8')) : undefined;
  requestReceipts.push({ path, status: response.status, actorId: actor.id });
  return { status: response.status, bytes, json, headers: response.headers };
}
async function ok(actor: Actor, path: string, method = 'GET', body?: unknown, status = 200) {
  const result = await request(actor, path, method, body);
  assert.equal(result.status, status, `${method} ${path}: ${result.json?.error ?? ''}`);
  return result.json;
}
function step(name: string, assertions: number) { checks.push({ name, status: 'PASS', assertions }); }
function matches(value: any) { assert.ok(Array.isArray(value)); return value; }
function docxXml(bytes: Buffer) {
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  let footer = bytes.length - 22;
  while (footer >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(footer) !== 0x06054b50) footer--;
  assert.ok(footer >= 0, 'ZIP central directory missing');
  let offset = bytes.readUInt32LE(footer + 16);
  const count = bytes.readUInt16LE(footer + 10);
  const xmlEntries: string[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const compression = bytes.readUInt16LE(offset + 10), length = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const local = bytes.readUInt32LE(offset + 42);
    if (name.endsWith('.xml')) {
      assert.equal(bytes.readUInt32LE(local), 0x04034b50);
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const compressed = bytes.subarray(start, start + length);
      assert.ok(compression === 0 || compression === 8);
      xmlEntries.push(name+'\n'+(compression === 8 ? inflateRawSync(compressed) : compressed).toString('utf8'));
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.ok(xmlEntries.some(entry=>entry.startsWith('word/document.xml\n')),'Word document XML missing');
  return xmlEntries.join('\n');
}
function pdfText(bytes: Buffer) {
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  return execFileSync('C:/Users/Misha/AppData/Local/Programs/Python/Python311/python.exe', ['-c', 'import sys, io, base64; from pypdf import PdfReader; r=PdfReader(io.BytesIO(base64.b64decode(sys.stdin.buffer.read()))); sys.stdout.buffer.write((str(r.metadata)+"\\n"+"\\n".join(p.extract_text() or "" for p in r.pages)).encode("utf-8"))'], { input: bytes.toString('base64'), encoding: 'utf8', timeout: 20000, maxBuffer: 2_000_000 });
}

try {
  const candidate = await fixture('candidate', 'candidate');
  const employerA = await fixture('employer', 'a-junior');
  const employerM = await fixture('employer', 'm-middle');
  const employerB = await fixture('employer', 'b-no-needs');
  const initialIdentity = await ok(candidate, '/me');
  assert.equal(initialIdentity.user.id, candidate.id, 'First read-only HTTP identity does not belong to this isolated fixture');
  assert.equal(initialIdentity.user.email, candidate.email);
  const resume = (await ok(candidate, '/me/resumes')).resumes[0]; resumeId = resume.id;
  const profile = await ok(candidate, `/me/candidate-profile?resumeId=${resumeId}`);
  const phone = '+79990007341', handle = 'skill_private_contact';
  await ok(candidate, '/me/candidate-profile', 'PUT', { ...profile, resumeId, revision: profile.revision, identityRevision: profile.identityRevision, professionalAlias: 'Разработчик проверяемых сервисов', specialization: 'Backend / Python', stack: ['Python', 'SQL'], skills: ['Python', 'SQL'], assumedGrade: 'Junior', visibility: 'pseudonymous', consentMatching: true, consentCatalog: false, readyForOffers: true, phone, contactEmail: candidate.email, salaryMin: 100000, salaryMax: 200000, workFormat: 'Удалённо' });
  const current = await ok(candidate, `/me/resumes/${resumeId}`);
  await ok(candidate, `/me/resumes/${resumeId}`, 'PUT', { revision: current.revision, summary: `Разрабатывал сервисы на Python. Андрей Петрович Светлов. Связь: ${candidate.email} ${phone} @${handle} https://t.me/${handle}`, softSkills: current.softSkills, experience: current.experience, projects: current.projects, education: current.education, portfolio: current.portfolio, questionnaire: current.questionnaire });
  const candidateState = await ok(candidate, `/me/candidate-profile?resumeId=${resumeId}`);
  assert.equal(candidateState.consentMatching, true); assert.equal(candidateState.consentCatalog, false); assert.equal(candidateState.visibility, 'pseudonymous');
  assert.equal(candidateState.verifiedGrade, null);
  step('Ordinary owned candidate has matching consent, closed catalogue and no fabricated grade', 4);

  for (const skillId of ['python', 'sql', 'backend-engineering']) {
    const attempt = (await ok(candidate, '/me/skill-attempts', 'POST', { resumeId, skillId, level: 'Junior' }, 201)).attempt;
    const [stored] = await db.select().from(attempts).where(and(eq(attempts.id, attempt.id), eq(attempts.userId, candidate.id)));
    assert.ok(stored && owned.includes(stored.userId));
    const answers = Object.fromEntries(stored.cases.map(c => [c.id, stored.oracles[c.id]!.expected]));
    const result = (await ok(candidate, `/me/skill-attempts/${attempt.id}/submit`, 'POST', { revision: attempt.revision, answers })).attempt;
    assert.equal(result.decision.passed, true); assert.equal(result.decision.criticalComplete, true);
    actualAttempts.push({ skill: skillId, id: result.id, rubric: result.decision.rubricVersion });
  }
  const matrix = await ok(candidate, `/me/skill-matrix?resumeId=${resumeId}`);
  assert.equal(matrix.qualification.verifiedGrade, 'Junior'); assert.equal(matrix.qualification.verifiedScore, null);
  assert.equal(matrix.qualification.category.requirements.length, 3);
  assert.equal(matrix.accountEvidence.find((e: any) => e.skillId === 'python').level, 'Junior');
  step('Three actual HTTP module submissions close Junior matrix with Python Junior and no averaged score', 13);

  const needBody = { title: 'Разработка проверяемых Backend сервисов', specialization: 'Backend / Python', grade: 'Junior', requiredSkills: ['Python'], desirableSkills: [], description: 'Самостоятельные задачи разработки API и обработки данных. Требуется подтверждённый уровень навыка.', workFormat: 'Удалённо', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month', salaryType: 'gross' };
  const needJ = await ok(employerA, '/employer/needs', 'POST', { ...needBody, requiredSkillLevels: { Python: 'Junior' } }, 201);
  const needM = await ok(employerM, '/employer/needs', 'POST', { ...needBody, requiredSkillLevels: { Python: 'Middle' } }, 201);
  const pythonKey = canonicalSkillKey('Python');
  assert.deepEqual(needJ.requiredSkillLevels, { [pythonKey]: 'Junior' });
  assert.deepEqual(needM.requiredSkillLevels, { [pythonKey]: 'Middle' });
  assert.deepEqual((await ok(employerA, '/employer/needs')).find((n: any) => n.id === needJ.id).requiredSkillLevels, { [pythonKey]: 'Junior' });
  assert.deepEqual((await ok(employerM, '/employer/needs')).find((n: any) => n.id === needM.id).requiredSkillLevels, { [pythonKey]: 'Middle' });
  const definitions = await db.select().from(needs).where(inArray(needs.companyId, [employerA.companyId!, employerM.companyId!, employerB.companyId!]));
  assert.deepEqual(definitions.filter(n => n.companyId === employerA.companyId).map(n => n.id), [needJ.id]);
  assert.deepEqual(definitions.filter(n => n.companyId === employerM.companyId).map(n => n.id), [needM.id]);
  assert.equal(definitions.filter(n => n.companyId === employerB.companyId).length, 0);
  const grantRows = await db.select().from(grants).where(eq(grants.candidateUserId, candidate.id)); assert.equal(grantRows.length, 0);
  step('Persisted explicit levels, isolated need sets and no existing addressed grants', 8);

  const selected = matches(await ok(employerA, `/matches?needId=${needJ.id}&resumeId=${resumeId}`)).find((entry: any) => entry.candidateId === candidate.id && entry.resumeId === resumeId);
  assert.ok(selected); assert.equal(selected.verifiedGrade, 'Junior'); assert.equal(selected.ranking.qualityScore, null); assert.equal(selected.ranking.provenancePriority, 0);
  assert.ok(selected.categoryEvidence?.requirements.length === 3);
  const explanation = await ok(employerA, `/matches/explanation?needId=${needJ.id}&candidateId=${candidate.id}&resumeId=${resumeId}`);
  assert.equal(explanation.candidateId, candidate.id); assert.equal(explanation.resumeId, resumeId); assert.equal(explanation.ranking.qualityScore, null);
  assert.equal(explanation.ranking.provenancePriority, 0); assert.ok(JSON.stringify(explanation.evidence).includes('signal_skill_module'));
  const catalogue = await ok(employerA, '/employer/candidates');
  const catalogueRows = Array.isArray(catalogue) ? catalogue : catalogue.candidates ?? catalogue.items ?? [];
  assert.ok(Array.isArray(catalogueRows));
  assert.ok(!catalogueRows.some((entry: any) => entry.candidateId === candidate.id || entry.userId === candidate.id));
  step('Explicit Python Junior produces selected match and explanation while the candidate remains outside catalogue', 12);

  const forbidden = [candidate.email, phone, handle, 'Светлов'];
  const assertMasked = (text: string) => { for (const value of forbidden) assert.ok(!text.includes(value), `Restricted document contains ${value === candidate.email ? 'owned fixture email' : value}`); assert.ok(text.includes('Python')); };
  const preview = await ok(employerA, `/resumes/${resumeId}/document-preview`);
  assert.equal(preview.audience, 'employer'); assert.equal(preview.contactsAllowed, false); assertMasked(JSON.stringify(preview));
  assert.ok(!preview.sections.some((section: any) => section.title === 'Контакты'));
  const downloadEvents = async () => Number((await pool.query("SELECT count(*) AS n FROM signal_resume_events WHERE resume_id=$1 AND actor_user_id=$2 AND kind='download'",[resumeId,employerA.id])).rows[0].n);
  assert.equal(await downloadEvents(),0);
  for(const path of ['document.pdf','document.docx']) {
    const head=await request(employerA,`/resumes/${resumeId}/${path}`,'HEAD');
    assert.equal(head.status,200);assert.equal(head.bytes.length,0);assert.match(head.headers.get('cache-control')??'',/no-store/);
    assert.ok(!head.headers.get('content-disposition')?.includes(candidate.email));
  }
  const inlineBefore=await request(employerA,`/resumes/${resumeId}/preview.pdf`);
  assert.equal(inlineBefore.status,200);assert.equal(await downloadEvents(),0);
  step('HEAD and JSON/inline previews produce no download events or private filename metadata',10);
  const pdf = await request(employerA, `/resumes/${resumeId}/document.pdf`); assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type') ?? '', /^application\/pdf/); assertMasked(pdfText(pdf.bytes));
  const docx = await request(employerA, `/resumes/${resumeId}/document.docx`); assert.equal(docx.status, 200); assert.match(docx.headers.get('content-type') ?? '', /wordprocessingml/); assertMasked(docxXml(docx.bytes));
  const inline = await request(employerA, `/resumes/${resumeId}/preview.pdf`); assert.equal(inline.status, 200); assertMasked(pdfText(inline.bytes));
  await preserveExport('before-consent.pdf',pdf.bytes);await preserveExport('before-consent.docx',docx.bytes);await preserveExport('inline-before-consent.pdf',inline.bytes);
  for (const result of [pdf, docx, inline]) assert.match(result.headers.get('cache-control') ?? '', /no-store/);
  for(let read=0;read<10 && (await downloadEvents())===0;read++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(await downloadEvents(),1,'Completed employer downloads deduplicate per actor/resume/day');
  step('Matching-only document JSON, PDF, DOCX and inline PDF are accessible and mask contacts in actual text', 31);

  const inviteBody = (needId: number, suffix: string) => ({ idempotencyKey: `${prefix}-${suffix}`, needId, candidateId: candidate.id, resumeId, title: 'Обсудим Backend задачи', message: 'Предлагаем обсудить задачи команды и условия работы над API.', reason: 'Покрытие требований подтверждено самостоятельными модулями.', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month', salaryType: 'gross', workFormat: 'Удалённо' });
  const invitation = await ok(employerA, '/employer/invitations', 'POST', inviteBody(needJ.id, 'junior'), 201);
  assert.equal(invitation.resumeId, resumeId);
  assert.notEqual((await request(employerA, `/employer/invitations/${invitation.id}/contacts`)).status, 200);
  step('Explicit Python Junior permits real invitation; pending invitation does not disclose contacts', 3);

  const middleMatches = matches(await ok(employerM, `/matches?needId=${needM.id}`));
  assert.ok(!middleMatches.some((entry: any) => entry.candidateId === candidate.id));
  assert.equal((await request(employerM, `/matches?needId=${needM.id}&resumeId=${resumeId}`)).status, 404);
  assert.equal((await request(employerM, `/matches/explanation?needId=${needM.id}&candidateId=${candidate.id}&resumeId=${resumeId}`)).status, 404);
  assert.equal((await request(employerM, '/employer/invitations', 'POST', inviteBody(needM.id, 'middle'))).status, 404);
  for (const actor of [employerM, employerB]) for (const path of ['document-preview', 'document.pdf', 'document.docx', 'preview.pdf']) assert.equal((await request(actor, `/resumes/${resumeId}/${path}`)).status, 404);
  assert.equal((await db.select().from(grants).where(eq(grants.candidateUserId, candidate.id))).length, 0);
  step('Python Middle requirement cannot invite, match or unlock documents; company without needs is also denied', 13);

  await ok(candidate, `/me/invitations/${invitation.id}/decision`, 'POST', { decision: 'accept' });
  const contacts = await ok(employerA, `/employer/invitations/${invitation.id}/contacts`);
  assert.ok(JSON.stringify(contacts).includes(candidate.email)); assert.ok(JSON.stringify(contacts).includes(phone));
  const addressedPreview = await ok(employerA, `/resumes/${resumeId}/document-preview`);
  assert.equal(addressedPreview.contactsAllowed, true); assert.ok(JSON.stringify(addressedPreview).includes(candidate.email));
  const addressedPdf=await request(employerA,`/resumes/${resumeId}/document.pdf`);assert.equal(addressedPdf.status,200);assert.ok(pdfText(addressedPdf.bytes).includes(candidate.email));
  const addressedWord=await request(employerA,`/resumes/${resumeId}/document.docx`);assert.equal(addressedWord.status,200);assert.ok(docxXml(addressedWord.bytes).includes(candidate.email));
  await preserveExport('addressed-consent.pdf',addressedPdf.bytes);await preserveExport('addressed-consent.docx',addressedWord.bytes);
  assert.equal((await request(employerB, `/employer/invitations/${invitation.id}/contacts`)).status, 403);
  assert.equal((await request(employerM, `/employer/invitations/${invitation.id}/contacts`)).status, 403);
  for (const actor of [employerM, employerB]) for (const path of ['document-preview', 'document.pdf', 'document.docx']) assert.equal((await request(actor, `/resumes/${resumeId}/${path}`)).status, 404);
  const addressedRows = await db.select().from(grants).where(eq(grants.candidateUserId, candidate.id));
  assert.equal(addressedRows.length, 1); assert.equal(addressedRows[0]!.companyId, employerA.companyId);
  step('Accepted invitation grants contacts and document identity only to A; M and B remain closed', 14);

  await ok(candidate, '/me/fsp-connection/import', 'POST', {consentImport:true}, 409);
  await ok(candidate, '/me/fsp-connection', 'PUT', {fspId:'ID-22',consentImport:true}, 400);
  for (const fspId of ['OWN-ID-22','FSP-DEMO-2026']) {
    const saved=await ok(candidate,'/me/fsp-connection','PUT',{fspId});
    assert.equal(saved.status,'pending'); assert.equal(saved.verifiedAt,null); assert.equal(saved.consentedAt,null);
    assert.equal(saved.importAvailable,false); assert.equal(saved.demoAvailable,false); assert.equal(saved.hasHistory,false);
    assert.equal(saved.fspSignal.bonus,0); assert.deepEqual(saved.achievements,[]);
    const failed=await ok(candidate,'/me/fsp-connection/import','POST',{consentImport:true},503);
    assert.equal(failed.code,'registry_not_configured');
    const reloaded=await ok(candidate,'/me/fsp-connection'); assert.equal(reloaded.fspId,fspId); assert.equal(reloaded.verifiedAt,null);
  }
  await ok(candidate,'/me/fsp-connection','DELETE');
  const afterFsp=await ok(candidate,`/me/skill-matrix?resumeId=${resumeId}`);
  assert.deepEqual(afterFsp.accountEvidence,matrix.accountEvidence);
  step('Current FSP save/import contract never fabricates consent, proof or achievements and preserves skill evidence',23);
  await ok(candidate, `/me/invitations/${invitation.id}/revoke-contact`, 'POST');
  const afterRevoke=await ok(employerA,`/resumes/${resumeId}/document-preview`);
  assert.equal(afterRevoke.contactsAllowed,false);assertMasked(JSON.stringify(afterRevoke));
  const revokedPdf=await request(employerA,`/resumes/${resumeId}/document.pdf`);assert.equal(revokedPdf.status,200);assertMasked(pdfText(revokedPdf.bytes));
  const revokedWord=await request(employerA,`/resumes/${resumeId}/document.docx`);assert.equal(revokedWord.status,200);assertMasked(docxXml(revokedWord.bytes));
  await preserveExport('after-revocation.pdf',revokedPdf.bytes);await preserveExport('after-revocation.docx',revokedWord.bytes);
  assert.notEqual((await request(employerA,`/employer/invitations/${invitation.id}/contacts`)).status,200);
  step('Revocation masks identity and contacts again in JSON, PDF and Word and blocks prior addressed contact endpoint',9);
  for(let i=0;i<4;i++) await ok(candidate,'/me/resumes','POST',{title:`QA дополнительное резюме ${i+1}`,specialization:i%2?'Backend / Python':'Frontend / TypeScript'},201);
  await ok(candidate,'/me/resumes','POST',{title:'Шестое резюме',specialization:'Backend / Python'},409);
  const ownList=await ok(candidate,'/me/resumes');assert.equal(ownList.resumes.length,5);
  const selectedAfter=matches(await ok(employerA,`/matches?needId=${needJ.id}&resumeId=${resumeId}`)).find((e:any)=>e.candidateId===candidate.id);
  assert.ok(selectedAfter);assert.equal(selectedAfter.resumeId,resumeId);
  step('Five-CV account limit and exact selected qualified resume survive creation of unrelated drafts',8);

  passed = true;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  // The whole database is owned by this clean audit. Retain proofs and append-only audit history for independent recheck.
  remainingUsers = owned.length;
  await writeFile('C:/Users/Misha/.codex/private/signal-full-audit-a10-fixtures-20261008' + (rerunTag ? '-' + rerunTag : '') + '.json', JSON.stringify({apiOrigin:origin,uiOrigin:'http://signal-full-audit.localhost:4384',actors:qaActors},null,2), {flag:'wx'});
  await pool.end();
  await mkdir(directory, { recursive: true });
  const report = { passed, checks, failure, synthetic: true, oracleAssistedMechanicalTest: true, runtime: { origin, pid: running.pid, bundlePath: bundlePath.replaceAll('\\', '/'), sha256 }, actualAttempts, requestReceipts, exportArtifacts, fixtureLedger: { database: database.pathname.slice(1), ownedFixturePrefix: prefix, createdUsers: owned.length, retainedUsers: remainingUsers, reason: 'Dedicated new audit database; preserve evidence and append-only history for independent recheck', ownFixturesOnly: true }, measuredAt: new Date().toISOString() };
  await writeFile(directory + '/current-core-http.json', JSON.stringify(report, null, 2), {flag:'wx'});
  console.log(JSON.stringify({ passed, checks: checks.length, failure, retainedAuditActors: remainingUsers, apiSha256: sha256 }));
}
if (!passed) process.exitCode = 1;
