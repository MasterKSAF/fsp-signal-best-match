/** N02/N20: isolated, resumable demonstration preparation.
 * Default is a plan. Run --apply <actual-runtime-path> <expected-sha256> only after
 * the controller's GO DB. SQL creates new scoped identities/consents only;
 * Company skeletons are the standard new-account bootstrap (explicit controller
 * authorization); all company fields, business data and proofs use HTTP APIs.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lct = resolve(project, '..');
const output = resolve(lct, 'outputs/signal-recording-release-20261009/implementation/demo');
const privatePath = 'C:/Users/Misha/.codex/private/signal-recording-n01-n20-20261009/demo.json';
const envPath = 'C:/Users/Misha/.codex/private/signal-employer-e-20261008.env';
const databaseName = 'signal_employer_e_20261008';
const origin = 'http://signal-recruiting.localhost:4424';
const base = 'http://127.0.0.1:4423/api';
const fingerprint = createHash('sha256').update('127.0.0.1:55435/' + databaseName).digest('hex');
const plan = {
  synthetic: true, oracleAssisted: true, independentQualification: false,
  database: databaseName, api: base, privatePath,
  demo: ['Алексей Волков', 'Мария Соколова', 'Линия — образовательные сервисы'],
  emptyQa: ['Новый кандидат', 'Новая компания'],
  scopes: 'A new demo scope and a separate empty-QA scope; both demoMode=true.',
  fixtures: '2 published jobs, 2 private needs, separate shortlists, 1 need invitation, 1 linked task with 2 recipients.',
  proofs: 'Six real API attempts with own server oracles: Alexey Python Junior / SQL Middle / Backend Middle, Maria three Junior modules.',
  availableRecordingExam: 'Alexey Python Middle remains unissued; completion can raise the program grade from Junior to Middle.',
  forbidden: 'No existing actors, old media, seed/reset, proof/grade SQL writes, or automatic cleanup.',
};
if (process.argv[2] !== '--apply') {
  assert.ok(process.argv.length === 2 || process.argv[2] === '--plan', 'Use --plan or --apply runtimePath sha256');
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
assert.equal(process.argv.length, 5, 'Use --apply actual-runtime-path expected-sha256 after GO DB');
const runtimePath = resolve(process.argv[3]);
const runtimeSha256 = process.argv[4];
assert.match(runtimeSha256, /^[a-f0-9]{64}$/);
const allowedRoots = [resolve(project, 'outputs/verification') + '/', resolve(lct, 'outputs/signal-recording-release-20261009/implementation') + '/'].map(p => p.replaceAll('\\', '/').toLowerCase());
assert.ok(allowedRoots.some(p => runtimePath.replaceAll('\\', '/').toLowerCase().startsWith(p)), 'Only the owned runtime snapshot is allowed');
assert.equal(createHash('sha256').update(await readFile(runtimePath)).digest('hex'), runtimeSha256, 'Runtime differs from controller-approved SHA');
const baseline = JSON.parse(await readFile(resolve(lct, 'outputs/signal-recording-release-20261009/implementation/baseline.json'), 'utf8'));
assert.equal(baseline.database, databaseName);
assert.ok(baseline.backup?.sha256, 'A protected baseline is required');
const env = Object.fromEntries((await readFile(envPath, 'utf8')).split(/\r?\n/).filter(v => v && !v.startsWith('#')).map(line => {
  const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')];
}));
const target = new URL(env.DATABASE_URL);
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55435'); assert.equal(target.pathname, '/' + databaseName);
await mkdir(dirname(privatePath), { recursive: true, mode: 0o700 });
await mkdir(output, { recursive: true });
const lockPath = privatePath + '.lock';
const lock = await open(lockPath, 'wx', 0o600);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
let journal, failure, passed = false;
const receipts = [], checks = [];
const runStartedAt = new Date().toISOString();
const check = (name, condition, details = {}) => { assert.ok(condition, name); checks.push({ name, passed: true, ...details }); };
async function save() {
  const temporary = privatePath + '.tmp';
  await writeFile(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  await rename(temporary, privatePath);
}
async function request(actor, path, method = 'GET', body, expected = 200) {
  const r = await fetch(base + path, { method, headers: { Origin: origin, ...(actor?.cookie ? { Cookie: actor.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const raw = await r.text(); let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  receipts.push({ actorId: actor?.id ?? null, method, path, status: r.status, at: new Date().toISOString() });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(r.status), `${method} ${path}: unexpected HTTP ${r.status} (${data?.code ?? 'no-code'})`);
  return { data, response: r };
}
const api = async (...args) => (await request(...args)).data;
async function once(key, create) {
  if (journal.stages[key]?.done) return journal.stages[key].value;
  journal.currentStage = key; await save();
  const value = await create();
  journal.stages[key] = { done: true, value, at: new Date().toISOString() }; await save(); return value;
}
async function login(actor) {
  const { data, response } = await request(null, '/auth/login', 'POST', { email: actor.email, password: actor.password });
  assert.equal(data.user.id, actor.id);
  const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie?.startsWith('fsp_signal_session='));
  actor.cookie = cookie; await save();
}
async function provisionIdentities() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const actor of journal.actors) {
      let row = (await client.query('SELECT id,email,role,display_name,demo_mode,review_scope_id FROM signal_users WHERE email=$1 FOR UPDATE', [actor.email])).rows[0];
      if (!row) {
        assert.equal(actor.id, undefined, 'A previously prepared identity is missing; never recreate it');
        const salt = randomBytes(16).toString('hex');
        row = (await client.query('INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode,review_scope_id) VALUES($1,$2,$3,$4,true,true,$5) RETURNING id,email,role,display_name,demo_mode,review_scope_id',
          [actor.email, `scrypt:${salt}:${scryptSync(actor.password, salt, 64).toString('hex')}`, actor.role, actor.name, actor.scope])).rows[0];
        await client.query("INSERT INTO signal_consents(user_id,consent_type,version) VALUES($1,'terms','2026-10-09-recording-synthetic'),($1,'privacy','2026-10-09-recording-synthetic')", [row.id]);
      }
      assert.equal(row.demo_mode, true); assert.equal(row.review_scope_id, actor.scope); assert.equal(row.role, actor.role);
      if (actor.id) assert.equal(row.id, actor.id); else actor.id = row.id;
      if (actor.role === 'employer') await client.query('INSERT INTO signal_companies(owner_user_id,name,contact_email,contact_method) VALUES($1,$2,$3,$4) ON CONFLICT(owner_user_id) DO NOTHING', [actor.id, actor.name, actor.email, 'Электронная почта']);
    }
    await save(); await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function profile(actor) {
  return once(`profile-${actor.key}`, async () => {
    const rows = (await api(actor, '/me/resumes')).resumes;
    assert.equal(rows.length, 1, 'Demo candidate has exactly one starting CV; do not overwrite additional user CVs');
    const resumeId = rows[0].id;
    const current = await api(actor, `/me/candidate-profile?resumeId=${resumeId}`);
    await api(actor, '/me/candidate-profile', 'PUT', { ...current, resumeId, revision: current.revision, identityRevision: current.identityRevision,
      displayName: actor.name, professionalAlias: actor.name, title: 'Backend-разработчик', specialization: 'Backend / Python', assumedGrade: 'Middle',
      stack: ['Python', 'SQL', 'FastAPI', 'Docker'], skills: ['Python', 'SQL', 'Backend engineering', 'FastAPI', 'Docker'],
      yearsExperience: actor.key === 'alexey' ? 3 : 4, workFormat: 'Удалённо', salaryMin: actor.key === 'alexey' ? 160000 : 150000,
      salaryMax: actor.key === 'alexey' ? 220000 : 210000, salaryPeriod: 'month', salaryType: 'gross', visibility: 'public',
      consentMatching: true, consentCatalog: true, readyForOffers: true, phone: null, contactEmail: actor.email });
    const cv = await api(actor, `/me/resumes/${resumeId}`);
    await api(actor, `/me/resumes/${resumeId}`, 'PUT', { revision: cv.revision,
      summary: actor.key === 'alexey' ? 'Разрабатываю API на Python и сервисы для работы с учебными материалами. Люблю понятные требования, проверяемые решения и небольшие итерации. Хочу развивать образовательные продукты в команде.' : 'Работаю с серверной логикой, SQL и интеграциями. Уделяю внимание надёжности и обработке ошибок. Интересны сервисы, которые помогают людям учиться.',
      softSkills: ['Командная работа', 'Обсуждение требований'], experience: [], projects: [], education: [], portfolio: [], questionnaire: cv.questionnaire });
    return { resumeId };
  });
}
async function proof(actor, skillId, level) {
  return once(`proof-${actor.key}-${skillId}-${level}`, async () => {
    let stored = (await pool.query('SELECT id,user_id,cases,oracles,status,revision,decision FROM signal_skill_attempts WHERE user_id=$1 AND skill_id=$2 AND level=$3 ORDER BY id DESC LIMIT 1', [actor.id, skillId, level])).rows[0];
    if (!stored) {
      const matrix = await api(actor, `/me/skill-matrix?resumeId=${actor.resumeId}`);
      const issued = await api(actor, '/me/skill-attempts', 'POST', { resumeId: actor.resumeId, skillId, level, programVersion: matrix.bankVersion }, 201);
      stored = (await pool.query('SELECT id,user_id,cases,oracles,status,revision,decision FROM signal_skill_attempts WHERE id=$1 AND user_id=$2', [issued.attempt.id, actor.id])).rows[0];
    }
    assert.equal(stored.user_id, actor.id);
    let decision = stored.decision;
    if (stored.status !== 'submitted') {
      assert.equal(stored.status, 'active', 'Never discard or reissue an existing attempt silently');
      const answers = Object.fromEntries(stored.cases.map(item => [item.id, stored.oracles[item.id].expected]));
      decision = (await api(actor, `/me/skill-attempts/${stored.id}/submit`, 'POST', { revision: stored.revision, answers })).attempt.decision;
    }
    assert.equal(decision.passed, true); assert.equal(decision.criticalComplete, true);
    return { candidateId: actor.id, resumeId: actor.resumeId, skillId, level, attemptId: stored.id, passed: true, oracleAssisted: true, independentHumanValidation: false };
  });
}
const conditions = { specialization: 'Backend / Python', grade: 'Junior', gradeMode: 'verified', workFormat: 'Удалённо', salaryMin: 160000, salaryMax: 220000, salaryPeriod: 'month', salaryType: 'gross' };
const jobDefinitions = [
  { key: 'platform', title: 'Backend-разработчик образовательной платформы', description: 'Развиваем платформу для онлайн-курсов и учебных групп. Предстоит создавать API на Python, работать с SQL, интеграциями и надёжной обработкой заявок.',
    skills: ['Python', 'SQL', 'Docker'], skillRequirements: [{ skill: 'Python', mode: 'verified', level: 'Junior' }, { skill: 'SQL', mode: 'declared_or_verified' }, { skill: 'Docker', mode: 'declared_or_verified' }] },
  { key: 'integrations', title: 'Backend-разработчик сервиса расписания', description: 'Создаём единое расписание занятий для учебных центров. Нужны API, синхронизация данных и прозрачная обработка ошибок интеграций. Команда помогает разбираться в предметной области.',
    grade: 'Middle', gradeMode: 'declared_or_verified', skills: ['Python', 'SQL', 'FastAPI'], skillRequirements: [{ skill: 'Python', mode: 'declared_or_verified' }, { skill: 'SQL', mode: 'verified', level: 'Junior' }, { skill: 'FastAPI', mode: 'declared_or_verified' }] },
];
const needDefinitions = [
  { key: 'core', title: 'Команда интеграций учебной платформы', description: 'Внутренний план усиления команды интеграций. Ищем специалиста с подтверждёнными основами Python и практикой создания API.', requiredSkills: ['Python', 'FastAPI'], skillRequirements: [{ skill: 'Python', mode: 'verified', level: 'Junior' }, { skill: 'FastAPI', mode: 'declared_or_verified' }] },
  { key: 'data', title: 'Развитие сервиса расписания', description: 'Приватный подбор для развития расписания и синхронизации данных. Нужны основы SQL и опыт работы с Python-сервисами.', requiredSkills: ['SQL', 'Python'], skillRequirements: [{ skill: 'SQL', mode: 'verified', level: 'Junior' }, { skill: 'Python', mode: 'declared_or_verified' }] },
];
async function context(owner, type, definition) {
  return once(`${type}-${definition.key}`, async () => {
    const path = type === 'job' ? '/employer/jobs' : '/employer/needs';
    const list = await api(owner, path); const rows = Array.isArray(list) ? list : list.items ?? list.needs ?? list.jobs;
    assert.ok(Array.isArray(rows));
    const matches = rows.filter(item => item.title === definition.title); assert.ok(matches.length <= 1, 'Ambiguous prepared context');
    let item = matches[0];
    if (!item) {
      const { key, ...fields } = definition;
      item = await api(owner, path, 'POST', { ...conditions, ...fields, ...(type === 'job' ? { location: 'Казань' } : { desirableSkills: [] }) }, 201);
    }
    if (type === 'job' && item.status === 'draft') item = await api(owner, `${path}/${item.id}/status`, 'POST', { status: 'published', version: item.version });
    assert.ok(type === 'need' || item.status === 'published');
    return { type, id: item.id, title: item.title, version: type === 'job' ? item.version : item.revision };
  });
}
async function shortlist(owner, ctx, candidate) {
  return once(`shortlist-${ctx.type}-${ctx.id}-${candidate.key}`, async () => {
    await api(owner, '/employer/shortlist', 'PUT', { context: { type: ctx.type, id: ctx.id }, contextVersion: ctx.version, candidateId: candidate.id, resumeId: candidate.resumeId });
    return { context: ctx, candidateId: candidate.id, resumeId: candidate.resumeId };
  });
}
async function preparePractice(owner, alexey, maria, job) {
  const task = await once('task', async () => {
    const rows = await api(owner, '/employer/microtasks');
    const title = 'Надёжная запись на занятие';
    const existing = rows.filter(item => item.title === title && item.jobId === job.id); assert.ok(existing.length <= 1);
    const row = existing[0] ?? await api(owner, '/employer/microtasks', 'POST', { jobId: job.id, title, competency: 'Надёжность API', specialization: 'Backend / Python',
      scenario: 'Учебный сервис записывает слушателей на вымышленное занятие. После сетевого сбоя клиент повторяет отправку одной заявки. Предложите идентификатор запроса, способ атомарно сохранить заявку и результат и два проверяемых теста. Используйте только вымышленные данные: доступ к системам компании и рабочий код не требуются.',
      expectedMinutes: 15, intervalDays: 7, deadlineDays: 7, educationalOnly: true,
      rubric: [{ id: 'repeat', label: 'Повтор не создаёт вторую заявку', maxPoints: 4 }, { id: 'atomic', label: 'Запись сохраняется атомарно', maxPoints: 3 }, { id: 'checks', label: 'Два проверяемых сценария', maxPoints: 3 }] }, 201);
    return { templateId: row.id, jobId: job.id, title };
  });
  for (const candidate of [alexey, maria]) {
    await once(`task-subscription-${candidate.key}`, async () => {
      await api(candidate, '/me/microtasks/preferences', 'PUT', { enabled: true });
      const sub = await api(owner, `/employer/microtasks/${task.templateId}/subscriptions`, 'POST', { candidateId: candidate.id, resumeId: candidate.resumeId });
      return { id: sub.id, candidateId: candidate.id, resumeId: candidate.resumeId };
    });
    await once(`task-offer-${candidate.key}`, async () => {
      const subscriptionId = journal.stages[`task-subscription-${candidate.key}`].value.id;
      const offer = (await api(candidate, '/me/microtasks')).offers.find(row => row.subscriptionId === subscriptionId && row.resumeId === candidate.resumeId && row.companyId === owner.companyId);
      assert.ok(offer); return { id: offer.id, candidateId: candidate.id, resumeId: candidate.resumeId };
    });
  }
  await once('task-evaluation-maria', async () => {
    const offerId = journal.stages['task-offer-maria'].value.id;
    const current = (await api(maria, '/me/microtasks')).offers.find(row => row.id === offerId); assert.ok(current);
    if (current.status === 'offered') await api(maria, `/me/microtasks/${offerId}/decision`, 'POST', { decision: 'accept', consentCompanyReview: true });
    if (['offered', 'accepted'].includes(current.status)) await api(maria, `/me/microtasks/${offerId}/submit`, 'POST', { answer: 'Использую UUID в Idempotency-Key. В одной транзакции сохраняю ключ, заявку и ответ. Повтор с тем же ключом возвращает прежний результат; другое тело даёт конфликт. Проверяю последовательный повтор и два одновременных запроса: в обоих случаях должна сохраниться одна заявка.' });
    if (current.status !== 'evaluated') await api(owner, `/employer/microtasks/offers/${offerId}/evaluate`, 'POST', {
      scores: [{ criterionId: 'repeat', points: 4, comment: 'Один ключ возвращает сохранённый результат, другое тело вызывает конфликт.' }, { criterionId: 'atomic', points: 3, comment: 'Ключ, заявка и ответ сохраняются в одной транзакции.' }, { criterionId: 'checks', points: 3, comment: 'Названы последовательный и конкурентный повтор с проверяемым результатом.' }],
      feedback: 'В учебном примере учтены повтор, атомарность и два проверяемых сценария. Оценка относится к этой задаче и не повышает общий грейд.' });
    return { offerId, status: 'evaluated', syntheticAnswer: true, qualificationEffect: 'none' };
  });
}

try {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, databaseName);
  try { journal = JSON.parse(await readFile(privatePath, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const runId = randomUUID(), demoScope = randomUUID(), qaScope = randomUUID();
    const definitions = [['employer', 'employer', 'Линия — образовательные сервисы', demoScope], ['alexey', 'candidate', 'Алексей Волков', demoScope], ['maria', 'candidate', 'Мария Соколова', demoScope], ['empty-candidate', 'candidate', 'Новый кандидат', qaScope], ['empty-employer', 'employer', 'Новая компания', qaScope]];
    journal = { schemaVersion: 1, synthetic: true, targetFingerprint: fingerprint, createdAt: new Date().toISOString(), runId, demoScope, qaScope, stages: {}, actors: definitions.map(([key, role, name, scope]) => ({ key, role, name, scope, email: `recording-${runId}-${key}@example.test`, password: randomBytes(24).toString('base64url') })) };
    await save();
  }
  assert.equal(journal.schemaVersion, 1); assert.equal(journal.synthetic, true); assert.equal(journal.targetFingerprint, fingerprint); assert.equal(journal.actors.length, 5);
  assert.notEqual(journal.demoScope, journal.qaScope);
  for (const actor of journal.actors) assert.ok(actor.email.startsWith(`recording-${journal.runId}-`) && [journal.demoScope, journal.qaScope].includes(actor.scope));
  await provisionIdentities();
  for (const actor of journal.actors) await login(actor);
  const [employer, alexey, maria, emptyCandidate, emptyEmployer] = journal.actors;
  const company = await once('company', async () => {
    const old = (await api(employer, '/employer/company')).company;
    await api(employer, '/employer/company', 'PUT', { name: employer.name, industry: 'Образовательные платформы',
      description: 'Создаём сервисы для учебных центров: онлайн-курсы, расписание занятий и интеграции. Наша команда развивает понятные и надёжные инструменты для преподавателей и слушателей.',
      inn: '', contactEmail: employer.email, contactPhone: null, contactMethod: 'Электронная почта' });
    return { id: old.id, name: employer.name };
  });
  employer.companyId = company.id;
  for (const candidate of [alexey, maria]) { candidate.resumeId = (await profile(candidate)).resumeId; await save(); }
  await proof(alexey, 'python', 'Junior'); await proof(alexey, 'sql', 'Middle'); await proof(alexey, 'backend-engineering', 'Middle');
  for (const skill of ['python', 'sql', 'backend-engineering']) await proof(maria, skill, 'Junior');
  for (const candidate of [alexey, maria]) check(`${candidate.key}-general-grade-derived`, (await api(candidate, `/me/skill-matrix?resumeId=${candidate.resumeId}`)).qualification.verifiedGrade === 'Junior');
  const jobs = []; for (const item of jobDefinitions) jobs.push(await context(employer, 'job', item));
  const needs = []; for (const item of needDefinitions) needs.push(await context(employer, 'need', item));
  await shortlist(employer, jobs[0], alexey); await shortlist(employer, jobs[0], maria); await shortlist(employer, needs[0], alexey); await shortlist(employer, needs[1], maria);
  await once('invitation', async () => {
    const key = `recording-${journal.runId}-need-alexey`;
    const existing = await pool.query('SELECT id FROM signal_invitations WHERE company_id=$1 AND candidate_user_id=$2 AND need_id=$3 AND resume_id=$4', [company.id, alexey.id, needs[0].id, alexey.resumeId]);
    assert.ok(existing.rows.length <= 1, 'Ambiguous prepared invitation');
    if (existing.rows[0]) return { id: existing.rows[0].id, context: needs[0], candidateId: alexey.id, resumeId: alexey.resumeId };
    const cv = await api(alexey, `/me/candidate-profile?resumeId=${alexey.resumeId}`);
    const row = await api(employer, '/employer/invitations', 'POST', { needId: needs[0].id, contextVersion: needs[0].version, candidateId: alexey.id, resumeId: alexey.resumeId, resumeRevision: cv.revision,
      title: 'Приглашение от компании «Линия»', message: 'Алексей, предлагаем познакомиться и обсудить разработку образовательных сервисов. Расскажем о команде и ответим на ваши вопросы.', reason: 'Подтверждённые навыки Python и SQL подходят для задач команды.',
      salaryMin: 160000, salaryMax: 220000, salaryPeriod: 'month', salaryType: 'gross', workFormat: 'Удалённо', idempotencyKey: key }, 201);
    return { id: row.id, context: needs[0], candidateId: alexey.id, resumeId: alexey.resumeId };
  });
  await preparePractice(employer, alexey, maria, jobs[0]);
  await once('empty-candidate', async () => {
    const rows = (await api(emptyCandidate, '/me/resumes')).resumes;
    for (const row of rows) await api(emptyCandidate, `/me/resumes/${row.id}`, 'DELETE', undefined, [200, 204]);
    return { removedOwnInitialResumeIds: rows.map(row => row.id) };
  });
  check('empty-candidate-stays-empty-after-reload', (await api(emptyCandidate, '/me/resumes')).resumes.length === 0);
  await once('empty-company', async () => ({ id: (await api(emptyEmployer, '/employer/company')).company.id }));
  check('empty-employer-has-zero-jobs', (await api(emptyEmployer, '/employer/jobs')).length === 0);
  for (const [ctx, ids] of [[jobs[0], [alexey.id, maria.id]], [needs[0], [alexey.id]], [needs[1], [maria.id]]]) {
    const selected = await api(employer, `/employer/selection?contextType=${ctx.type}&contextId=${ctx.id}&view=shortlisted`);
    check(`independent-${ctx.type}-${ctx.id}`, selected.items.length === ids.length && ids.every(id => selected.items.some(row => row.candidateId === id)), { context: ctx, count: ids.length });
  }
  const catalog = await api(alexey, '/public/jobs/search?hasTask=true');
  const catalogRows = Array.isArray(catalog) ? catalog : catalog.items ?? catalog.jobs;
  check('has-task-filter-linked-own-job', catalogRows.length === 1 && catalogRows[0].id === jobs[0].id && catalogRows[0].hasTask === true);
  const future = (await api(alexey, `/me/skill-matrix?resumeId=${alexey.resumeId}`));
  check('recording-python-middle-unissued', Number((await pool.query("SELECT count(*) FROM signal_skill_attempts WHERE user_id=$1 AND skill_id='python' AND level='Middle'", [alexey.id])).rows[0].count) === 0);
  journal.recording = { jobs, needs, availableExam: { skillId: 'python', level: 'Middle', bankVersion: future.bankVersion }, theme: 'pearl' };
  journal.currentStage = null; journal.completedAt ??= new Date().toISOString(); await save(); passed = true;
} catch (error) {
  // Database and auth errors can contain credentials; the public receipt contains
  // only the stage and generic error category, with full details kept private.
  failure = { stage: journal?.currentStage ?? 'startup', name: error.name, code: error.code ?? null };
  if (journal) { journal.lastPrivateFailure = { ...failure, message: error.message }; await save(); }
} finally {
  await pool.end(); await lock.close(); await unlink(lockPath);
  const publicActors = journal?.actors.map(({ key, id, role, name, resumeId, companyId }) => ({ key, id, role, name, resumeId, companyId }));
  const publicStages = Object.fromEntries(Object.entries(journal?.stages ?? {}).map(([key, value]) => [key, value]));
  const report = { passed, failure, synthetic: true, oracleAssistedPreparation: true, independentHumanValidation: false, existingRowsIntentionallyMutated: [],
    runtimePath, runtimeSha256, database: databaseName, port: 55435, api: base, origin, runId: journal?.runId, runStartedAt, finishedAt: new Date().toISOString(),
    actors: publicActors, stages: publicStages, recording: journal?.recording, checks, receipts };
  await writeFile(resolve(output, 'prepare-demo-latest.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve(output, `prepare-demo-${runStartedAt.replaceAll(/[:.]/g, '-')}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed, failure, report: resolve(output, 'prepare-demo-latest.json'), actors: publicActors, checks: checks.length, httpRequests: receipts.length, credentialsPrinted: false }));
}
if (!passed) process.exitCode = 1;
