import test from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig } from '../lib/db/node_modules/drizzle-orm/pg-core/index.js';
import { resumeReadDerivedFields } from '../artifacts/api-server/src/lib/resume-read-projection';
import { getResumeQualification } from '../artifacts/api-server/src/lib/signal-resume-qualification';
import { getSkillQualification, type SkillQualification } from '../artifacts/api-server/src/lib/skill-module-qualification';
import { emptyResume } from '../artifacts/api-server/src/lib/signal-resume-contract';

const at = new Date('2026-09-18T09:00:00Z');
const legacy = { specialization: 'Backend / Python', grade: 'Middle' as const, score: 92, skills: ['Python', 'FastAPI'], assessedAt: at.toISOString(), gradeChangedAt: at.toISOString(), attemptId: null, limitation: 'Saved aggregate' };
const target = { userId: 9, specialization: legacy.specialization, assumedGrade: 'Middle' as const, stack: ['Python'], skills: [], legacyQualification: legacy };
const historical = getResumeQualification(target, []);
const modular = getSkillQualification(target, { evidence: [], revokedIds: new Set() });

test('readonly derived fields preserve legacy grade/date but never copy untraced legacy skill names', () => {
  const before = structuredClone({ historical, modular, target });
  const projected = resumeReadDerivedFields(historical, modular, true);
  assert.deepEqual(projected, { verifiedGrade: 'Middle', verifiedScore: 92, verifiedSkills: [], latestAssessmentAt: at, qualificationAttemptId: null });
  assert.deepEqual({ historical, modular, target }, before);
});

test('readonly projection preserves grade precedence, individual proof presence, revocation and module flag', () => {
  const individual: SkillQualification = { ...modular, verifiedSkills: ['Python'], verifiedGrade: null };
  assert.deepEqual(resumeReadDerivedFields(historical, individual, true).verifiedSkills, ['Python']);
  assert.equal(resumeReadDerivedFields(historical, individual, true).verifiedGrade, 'Middle');
  assert.deepEqual(resumeReadDerivedFields(historical, individual, false).verifiedSkills, []);
  const nextAt = new Date('2026-10-09T09:00:00Z');
  const newer: SkillQualification = { ...individual, verifiedGrade: 'Middle', latestAssessmentAt: nextAt };
  assert.deepEqual(resumeReadDerivedFields(historical, newer, true), { verifiedGrade: 'Middle', verifiedScore: null, verifiedSkills: ['Python'], latestAssessmentAt: nextAt, qualificationAttemptId: null });
  assert.equal(resumeReadDerivedFields(historical, { ...newer, verifiedGrade: 'Junior' }, true).latestAssessmentAt, historical.latestAssessmentAt);
  const revoked = getResumeQualification({ ...target, legacyQualification: null }, []);
  assert.deepEqual(resumeReadDerivedFields(revoked, modular, true), { verifiedGrade: null, verifiedScore: null, verifiedSkills: [], latestAssessmentAt: null, qualificationAttemptId: null });
});

test('actual owner list/detail GET handlers derive fresh fields without persisting revision, history or microtask changes', async () => {
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/never_connect';
  const { db } = await import('../lib/db/src/index');
  const { default: router } = await import('../artifacts/api-server/src/routes/signal-resume');
  const row = { ...emptyResume(target.specialization), ...target, id: 7, title: 'Saved CV', isPrimary: true, revision: 41, verifiedGrade: 'Middle', verifiedScore: 92, verifiedSkills: ['Python', 'FastAPI'], latestAssessmentAt: at, verifiedGradeChangedAt: at, qualificationAttemptId: null, updatedAt: at, createdAt: at, deletedAt: null, questionnaireHistory: [], visibility: 'private', consentMatching: false, consentCatalog: false, readyForOffers: false, yearsExperience: 2, workFormat: 'Удалённо', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month', salaryType: 'gross' };
  const before = structuredClone(row);
  const saved = { select: db.select, insert: db.insert, update: db.update, delete: db.delete, execute: db.execute, transaction: db.transaction };
  const env = { workspace: process.env.SIGNAL_WORKSPACE_ENABLED, modules: process.env.SIGNAL_SKILL_MODULES_ENABLED };
  let actorRole = 'candidate';
  const reads = new Set<string>();
  const read = (name: string) => {
    reads.add(name);
    switch (name) {
      case 'signal_sessions': return [{ user: { id: 9, role: actorRole, email: 'fixture@example.test', emailVerified: true, displayName: 'Fixture', demoMode: false, reviewScopeId: null }, demoMode: false, reviewScopeId: null, expiresAt: new Date(Date.now() + 60_000) }];
      case 'signal_candidate_resumes': return [row];
      case 'signal_skill_evidence': case 'signal_assessment_attempts': case 'signal_resume_events': case 'signal_resume_work_preferences': return [];
      default: throw new Error(`Unexpected read ${name}`);
    }
  };
  (db as any).select = () => {
    let name = '';
    const chain: any = { from(table: any) { name = getTableConfig(table).name; return chain; }, innerJoin() { return chain; }, where() { return chain; }, limit() { return chain; }, orderBy() { return chain; }, groupBy() { return chain; }, then(resolve: any, reject: any) { return Promise.resolve(read(name)).then(resolve, reject); } };
    return chain;
  };
  (db as any).insert = (table: any) => {
    assert.equal(getTableConfig(table).name, 'signal_candidate_profiles', 'only idempotent account bootstrap is allowed; existing history is never written');
    return { values() { return { onConflictDoNothing() { return Promise.resolve([]); } }; } };
  };
  (db as any).update = () => { throw new Error('GET must not update a CV, profile or microtask'); };
  (db as any).delete = () => { throw new Error('GET must not delete history'); };
  (db as any).execute = async () => [];
  (db as any).transaction = (callback: any) => callback({select:db.select,insert:db.insert,update:db.update,delete:db.delete,execute:db.execute});
  async function get(path: string) {
    const layer = router.stack.find((item: any) => item.route?.path === path && item.route.methods.get);
    assert.ok(layer, path);
    let statusCode = 200, payload: any;
    const response: any = { setHeader() {}, status(value: number) { statusCode = value; return response; }, json(value: any) { payload = value; return response; } };
    await layer.route.stack[0].handle({ params: path.includes(':id') ? { id: '7' } : {}, query: {}, cookies: { fsp_signal_session: 'a'.repeat(43) } }, response);
    return { statusCode, payload };
  }
  try {
    process.env.SIGNAL_SKILL_MODULES_ENABLED = 'true';
    for (const workspace of ['false', 'true']) {
      process.env.SIGNAL_WORKSPACE_ENABLED = workspace;
      for (const path of ['/me/resumes', '/me/resume', '/me/resumes/:id']) {
        const { statusCode, payload } = await get(path);
        assert.equal(statusCode, 200);
        const dto = path === '/me/resumes' ? payload.resumes[0] : payload;
        assert.equal(dto.verifiedGrade, 'Middle'); assert.equal(dto.verifiedScore, 92); assert.deepEqual(dto.verifiedSkills, []);
        assert.equal(dto.qualification.verifiedGrade, 'Middle'); assert.deepEqual(dto.qualification.verifiedSkills, []);
        assert.equal(dto.revision, 41); assert.equal(dto.updatedAt, at.toISOString()); assert.deepEqual(dto.legacyQualification, legacy);
        assert.deepEqual(row, before, 'read does not mutate the saved object, qualification history or cache');
      }
    }
    actorRole = 'employer'; assert.equal((await get('/me/resumes')).statusCode, 403);
    assert.ok(!reads.has('signal_micro_templates') && !reads.has('signal_micro_subscriptions'), 'no microtask reconciliation during a read');
  } finally {
    Object.assign(db, saved);
    for (const [key, value] of [['SIGNAL_WORKSPACE_ENABLED', env.workspace], ['SIGNAL_SKILL_MODULES_ENABLED', env.modules]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
