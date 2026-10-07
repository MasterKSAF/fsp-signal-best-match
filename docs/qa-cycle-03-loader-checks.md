# Route-only loader optimization: regression scope

This plan concerns reads and data transfer only. The matcher, its policy, labels, frozen controls, grade model, session/consent boundaries and test thresholds remain unchanged. No working database or HTTP runtime is used by the new unit test.

## Unit regression: actual loader, injected queryDb

`tests/assessment-ranking-loader.test.ts` checks:

1. A finite 1152-case profile matrix proves the proposed SQL prefilter retains every profile admitted by the existing matcher. Both programs, minimum/verified grades, both pools, privacy/consent, exact specialization and missing legacy dates are covered. Senior remains admitted to a Junior need; a null date does not become an extra gate.
2. Six actual generated bank snapshots cover Backend/Frontend and Junior/Middle/Senior. Full saved oracles and independently projected blueprint metadata produce the same rubric key, linked evidence, exact saved score and complete matching outcome. Profile100 cannot replace a saved83.
3. Mixed-grade pools preserve the complete order and explanation, comparable100 above83+FSP, and null legacy quality.
4. Extra/missing root keys and malformed blueprint metadata stay unmeasured. Root keys and count cannot be reduced to make an invalid seven-criterion record appear valid.
5. Top-level non-object JSON is retained literally, including arrays with their existing structural interpretation. Scalar/null object entries may become `{blueprint:null}`: both original and projected metadata are invalid, so their evidence decision remains unchanged. Top-level JSON null is checked at the rubric boundary; this test does not claim a new loader recovery rule for malformed database records.
6. Ambiguous exact links remain unknown. Revoked links remain excluded. Wrong owner, exact millisecond, grade, program and missing score cannot provide a linked proof.
7. The actual query selects only ranking metadata, binds candidate/attempt IDs and saved status, applies corrections, and performs no query when no candidate has a link. The loader does not mutate candidate input.

The injected query fixture returns independently supplied rows. It does not execute SQL, explain a query plan, measure latency or establish physical JSON transfer reduction. The unit process forces an unreachable localhost database URL before importing the database-backed loader; only the injected query interface runs. It cannot access a real database even if an accidental fallback is introduced.

## Actual PostgreSQL checks: isolated acceptance

The separate SQL reviewer should execute the actual emitted projection against fixed JSON values: both program/grade snapshots, empty object, extra/missing keys, malformed blueprint, scalar/null entries, and top-level scalar/array/null. Compare literal top-level non-object values, object keys/count and evidence decisions; inspect transferred projection fields and bytes. The profile predicate must retain role/pool restrictions and apply exact specialization, consent=true, visibility!=private and nonnull grade. It must not introduce a date, FSP, numeric score, salary, skill-text or exact-minimum-grade restriction.

## HTTP and final runtime checks

Root owns six targeted matching HTTP groups; the independent matching reviewer owns twenty actual-runtime groups. Compare list/explanation positions, exact values, pool size, eligibility, own-need restrictions, private/nonconsenting profiles, legacy quality, corrections, aliases and both pools. These actual SQL/HTTP results are separate from the loader unit proof.

Run the unchanged load profile and fixed thresholds only after the runtime is frozen. Preserve the failed 55a5 load and its raw report. Final documentation uses the accepted runtime and its own load protocol; video origin is recorded separately when the UI assets are unchanged.

## Commands and safe proof

```powershell
node --import tsx --test tests/assessment-ranking-loader.test.ts
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --strict --types node --moduleResolution bundler --module esnext --target es2022 --customConditions workspace tests/assessment-ranking-loader.test.ts
```

After the permitted test window, write `outputs/verification/qa-cycle-03-loader-regression.json` with counts, command exit codes, source/test hashes and scope limits. Do not export oracle answers, prompts, fixture identities, request bodies or contact data. A unit PASS does not stand in for PostgreSQL execution, HTTP acceptance or load PASS.
