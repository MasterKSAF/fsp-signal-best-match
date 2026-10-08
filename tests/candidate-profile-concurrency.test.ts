import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateIdentityRevision, candidateProfileRevisionGate, applyCandidateProfileRevisionGuard, type CandidateIdentitySnapshot } from '../artifacts/api-server/src/lib/signal-candidate-identity.ts';
import { GetCandidateProfileResponse, SaveCandidateProfileBody } from '../lib/api-zod/src/generated/api.ts';

const identity: CandidateIdentitySnapshot = { userId: 41, displayName: 'Synthetic original name', professionalAlias: 'Synthetic alias', phone: null, contactEmail: 'synthetic@example.invalid' };
const body = {
  displayName: identity.displayName, professionalAlias: identity.professionalAlias,
  phone: identity.phone, contactEmail: identity.contactEmail,
  identityRevision: candidateIdentityRevision(identity), revision: 1, resumeId: 71,
  specialization: 'Backend / Python', assumedGrade: 'Junior', stack: ['Python'], skills: ['Python'],
  yearsExperience: 1, workFormat: 'Удалённо', salaryPeriod: 'month', salaryType: 'gross', visibility: 'private', consentMatching: false,
};

test('shared revision is stable across CV/program/proof metadata and bound to all four exact identity values plus account', () => {
  const token = candidateIdentityRevision(identity);
  assert.match(token, /^[a-f0-9]{64}$/);
  const withCvData = { ...identity, resumeId: 71, revision: 10, specialization: 'Frontend / TypeScript', verifiedGrade: 'Senior', latestAssessmentAt: '2026-01-01', updatedAt: 'later', avatarDataUrl: 'unrelated' };
  assert.equal(candidateIdentityRevision(withCvData), token);
  assert.equal(candidateIdentityRevision({ ...identity }), token);
  for (const patch of [
    { userId: 42 }, { displayName: 'Another synthetic name' }, { professionalAlias: 'Another alias' },
    { phone: '+70000000000' }, { contactEmail: 'another@example.invalid' }, { contactEmail: null },
    { displayName: identity.displayName + ' ' }, { professionalAlias: identity.professionalAlias.toUpperCase() },
  ]) assert.notEqual(candidateIdentityRevision({ ...identity, ...patch }), token);
  // No ambiguous string concatenation: moving a delimiter between two fields differs.
  assert.notEqual(candidateIdentityRevision({ ...identity, displayName: 'a,b', professionalAlias: 'c' }), candidateIdentityRevision({ ...identity, displayName: 'a', professionalAlias: 'b,c' }));
  assert.notEqual(candidateIdentityRevision({ ...identity, phone: '' }), candidateIdentityRevision({ ...identity, phone: null }));
});

test('generated request schema requires both tokens and rejects malformed/partial attempts to bypass them', () => {
  assert.equal(SaveCandidateProfileBody.safeParse(body).success, true);
  for (const field of ['revision', 'identityRevision'] as const) {
    const partial: Record<string, unknown> = { ...body }; delete partial[field];
    assert.equal(SaveCandidateProfileBody.safeParse(partial).success, false, `missing ${field}`);
  }
  for (const revision of [null, '1', 0, -1, 1.5, 2147483648, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(SaveCandidateProfileBody.safeParse({ ...body, revision }).success, false, String(revision));
  for (const identityRevision of [null, 1, '', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'z'.repeat(64), ' ' + body.identityRevision, body.identityRevision + '\n'])
    assert.equal(SaveCandidateProfileBody.safeParse({ ...body, identityRevision }).success, false, JSON.stringify(identityRevision));
  assert.equal(SaveCandidateProfileBody.safeParse({ ...body, revision: 2147483647 }).success, true);
});

test('generated response schema exposes mandatory owner tokens consistently', () => {
  const response = { ...body, userId: identity.userId, verifiedSkills: [], updatedAt: '2026-10-07T12:00:00Z' };
  const parsed = GetCandidateProfileResponse.safeParse(response);
  assert.equal(parsed.success, true);
  for (const field of ['revision', 'identityRevision', 'resumeId'] as const) {
    const partial: Record<string, unknown> = { ...response }; delete partial[field];
    assert.equal(GetCandidateProfileResponse.safeParse(partial).success, false);
  }
});

test('generated body requires an explicit bounded CV ID instead of an implicit primary target', () => {
  const withoutId: Record<string, unknown> = { ...body }; delete withoutId.resumeId;
  assert.equal(SaveCandidateProfileBody.safeParse(withoutId).success, false);
  for (const resumeId of [null, '71', 0, -1, 1.5, 2147483648, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(SaveCandidateProfileBody.safeParse({ ...body, resumeId }).success, false, String(resumeId));
  assert.equal(SaveCandidateProfileBody.safeParse({ ...body, resumeId: 2147483647 }).success, true);
});

test('revision gate never accepts absent/malformed tokens, independently of parsed request input', () => {
  const current = { revision: 1, identityRevision: body.identityRevision };
  for (const input of [{}, { revision: 1 }, { identityRevision: body.identityRevision },
    { revision: '1', identityRevision: body.identityRevision }, { revision: 2147483648, identityRevision: body.identityRevision },
    { revision: 1, identityRevision: 'A'.repeat(64) }, { revision: 1, identityRevision: body.identityRevision + '\n' }])
    assert.deepEqual(candidateProfileRevisionGate(input, current), { kind: 'invalid' });
  assert.deepEqual(candidateProfileRevisionGate(body, current), { kind: 'ready' });
  assert.deepEqual(candidateProfileRevisionGate({ ...body, revision: 2 }, current), { kind: 'conflict', code: 'RESUME_REVISION_CONFLICT' });
  assert.deepEqual(candidateProfileRevisionGate({ ...body, identityRevision: 'b'.repeat(64) }, current), { kind: 'conflict', code: 'CANDIDATE_IDENTITY_REVISION_CONFLICT' });
});

type MemoryState = {
  identity: CandidateIdentitySnapshot;
  cvs: { id: number; revision: number; title: string; consentMatching: boolean; consentCatalog: boolean; verifiedGrade: string | null; proofDate: string | null }[];
  writes: number;
};
const initialState = (): MemoryState => ({ identity: structuredClone(identity), writes: 0, cvs: [
  { id: 1, revision: 2, title: 'A original', consentMatching: true, consentCatalog: true, verifiedGrade: 'Junior', proofDate: '2026-10-01T10:00:00Z' },
  { id: 2, revision: 1, title: 'B original', consentMatching: false, consentCatalog: false, verifiedGrade: null, proofDate: null },
] });
const draft = (state: MemoryState, id: number) => ({ revision: state.cvs.find(cv => cv.id === id)!.revision, identityRevision: candidateIdentityRevision(state.identity), identity: structuredClone(state.identity) });
async function write(state: MemoryState, id: number, submitted: ReturnType<typeof draft>, title: string, open: boolean) {
  const cv = state.cvs.find(row => row.id === id)!;
  return applyCandidateProfileRevisionGuard(submitted, { revision: cv.revision, identityRevision: candidateIdentityRevision(state.identity) }, async () => {
    // If the guard called this at all, every mutable surface would change.
    state.writes++; state.identity = structuredClone(submitted.identity);
    cv.title = title; cv.consentMatching = open; cv.consentCatalog = open; cv.revision++;
    return draft(state, id);
  });
}

for (const [firstId, staleId] of [[1, 2], [2, 1]] as const) test(`cross-CV stale shared form rejects atomically in order ${firstId} then ${staleId}`, async () => {
  const state = initialState(); const first = draft(state, firstId); const stale = draft(state, staleId);
  first.identity = { ...identity, displayName: 'Updated name', professionalAlias: 'Updated alias', phone: '+70000000001', contactEmail: 'updated@example.invalid' };
  assert.equal((await write(state, firstId, first, 'First saved', true)).kind, 'saved');
  assert.equal(state.cvs.find(cv => cv.id === staleId)!.revision, stale.revision, 'Another CV revision is unchanged: the original race remains meaningful');
  const beforeRejected = structuredClone(state);
  assert.deepEqual(await write(state, staleId, stale, 'Must not be written', true), { kind: 'conflict', code: 'CANDIDATE_IDENTITY_REVISION_CONFLICT' });
  assert.deepEqual(state, beforeRejected, 'No title, consents, user identity, CV or proof is partially changed');
  const refreshed = draft(state, staleId); refreshed.identity.contactEmail = 'intentional@example.invalid';
  const originalProofs = state.cvs.map(cv => [cv.verifiedGrade, cv.proofDate]);
  assert.equal((await write(state, staleId, refreshed, 'Deliberate fresh save', true)).kind, 'saved');
  assert.equal(state.identity.contactEmail, 'intentional@example.invalid');
  assert.deepEqual(state.cvs.map(cv => [cv.verifiedGrade, cv.proofDate]), originalProofs);
});

test('two drafts of the same CV retain the existing CV conflict before any callback', async () => {
  const state = initialState(); const first = draft(state, 1); const stale = draft(state, 1);
  assert.equal((await write(state, 1, first, 'Fresh title', true)).kind, 'saved');
  const frozen = structuredClone(state);
  assert.deepEqual(await write(state, 1, stale, 'Stale title', false), { kind: 'conflict', code: 'RESUME_REVISION_CONFLICT' });
  assert.deepEqual(state, frozen);
});

test('invalid revisions suppress all writes, while a title-only save keeps the shared content revision stable', async () => {
  const state = initialState(); const frozen = structuredClone(state);
  let called = false;
  assert.deepEqual(await applyCandidateProfileRevisionGuard({ revision: 2 }, { revision: 2, identityRevision: body.identityRevision }, async () => { called = true; }), { kind: 'invalid' });
  assert.equal(called, false); assert.deepEqual(state, frozen);
  const current = draft(state, 1);
  assert.equal((await write(state, 1, current, 'Only a title', true)).kind, 'saved');
  assert.equal(candidateIdentityRevision(state.identity), current.identityRevision);
  const other = draft(frozen, 2);
  assert.equal((await write(state, 2, other, 'Independent title', false)).kind, 'saved');
});

test('overlapping calls serialized by a simulated owner lock evaluate fresh state after the earlier commit', async () => {
  const state = initialState(); const a = draft(state, 1); const b = draft(state, 2);
  a.identity.displayName = 'First overlapping update'; b.identity.displayName = 'Second stale update';
  let queue = Promise.resolve();
  const locked = <T>(action: () => Promise<T>): Promise<T> => {
    const next = queue.then(action); queue = next.then(() => undefined, () => undefined); return next;
  };
  const [first, second] = await Promise.all([locked(() => write(state, 1, a, 'First', true)), locked(() => write(state, 2, b, 'Second must remain', true))]);
  assert.equal(first.kind, 'saved'); assert.deepEqual(second, { kind: 'conflict', code: 'CANDIDATE_IDENTITY_REVISION_CONFLICT' });
  assert.equal(state.writes, 1); assert.equal(state.identity.displayName, 'First overlapping update'); assert.equal(state.cvs[1]!.title, 'B original');
});
