# Editorial handoff: Junior and Senior React/Frontend

This agent owns only the two new editorial helpers below. Historical base scenarios and historical Senior v4/v5 helpers were not edited. Current-only integration, template metadata, family lineage, surface probes and B4 scoring belong to the bank agent.

- `artifacts/api-server/src/lib/skill-junior-reviewed-choices-v6.ts`: all **44 Junior MCQ families**, 440 issued n/flag variants. Existing correct semantic option positions are retained before normal assembly shuffle. Exact-result families return `null`. Alternatives describe actual incorrect plans rather than absurd placeholders or telemetry padding.
- `artifacts/api-server/src/lib/skill-senior-react-frontend-reviewed-choices-v6.ts`: **32 current Senior invariant families**, 14 React and 18 Frontend. Four substantive React v5/v6 corrections return `null` and retain their own plans. Correct plan remains position 0 before assembly shuffle. Each wrong plan misses an explicit ownership, identity, scope, lifecycle, authorization, timing or accessibility guarantee.

Focused verification: `tests/skill-junior-editorial-v6.test.ts` and `tests/skill-senior-react-frontend-editorial-v6.test.ts`, **3/3 PASS**. The tests check complete family/domain coverage, distinct options, immutable historical fixtures, excluded substantive corrections, and retention of all 320 Senior practical result/contract combinations. They do not substitute for independent semantic review. Log: `outputs/verification/full-audit-a01-a11-20261008/bank/editorial-helper-tests.log`.

Blind content review receives public prompts/options only: `junior-editorial-blind.json` (176 MCQ variants, n=5/9 and both flags) and `senior-react-frontend-editorial-blind.json` (128 variants). These capture the authored options when review started. The bank agent’s later final public dump remains authoritative for current-only stem corrections; old review files are preserved.

Independent reviewer findings routed to the bank agent for current-only stem clarification:

1. SQL Junior c3/s2: distinguish the actual UPDATE row count from generally truthful interpretations of both 0 and 1.
2. SQL Junior c5/s2: explicitly state mandatory/non-null amount where that branch requires it.
3. TypeScript Junior c2/s1: eliminate a redundant constraint distractor; current true-flag distractor weakens `id` to optional and uses it without checking.
4. TypeScript Junior c4/s2: distinguish fail-fast aggregate refusal from waiting for all rejected/fulfilled operations to drain.
5. TypeScript Junior c5/s2: distinguish technical runtime protection against an uncontrolled writer from ordinary immutable-update discipline.

During separate independent review of Senior Python/TypeScript public questions this agent found an unrelated flat-snapshot distractor invoking nonexistent nested nodes. The bank agent replaced it in current-only content with copying inside the microtask after mutation. Historical content remained unchanged.

The 36 Senior Python/TypeScript semantic selections are frozen in `bank/independent-review/senior-python-typescript-semantic-frozen.json`; exact visible selected text and reasoning are recorded. Pre-exposure to original bank source is explicitly disclosed. This is independent semantic review with prior familiarity, **not a fully blinded expert experiment**. `senior-python-typescript-semantic-supplement01.json` records the later public-only correction and verifies that all selected texts and practical contexts remained unchanged. Neither selections nor labels were derived from production scorer calls by this review.

No claims of market skill calibration, source-memorization resistance or guaranteed protection from AI assistance are made here. The bank agent’s final surface probes, independent gold/profile evaluation and integration checks are pending this handoff.
