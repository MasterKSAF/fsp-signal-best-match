# Independent acceptance: competitive improvements S01–S16

Acceptance date: 29 October 2026 (Europe/Moscow). Base revision: `1d336d4ed4df92de62059f7f2d9bdadbd094324a`. Branch: `codex/competitive-improvements-20261028`.

The controller independently checked a separate source copy, fresh PostgreSQL databases, actual HTTP requests, the built application in a browser, migrations and isolated workers. The implementation author's report and test count were not used as substitutes for these checks. Ordinary functionality is accepted within the scope below; experimental boundaries remain explicit.

## Scope and observations

- S01–S03: bank attestation rejects a changed oracle while preserving old attempts; strict admission precedes ranking; exact CV identity and explanations survive pagination; stale computations and old lease owners cannot publish.
- S04–S06: requirement preview/cancel/apply, explicit revisions, local exclusions/undo, watch baseline, revocation before delivery and fencing were checked through HTTP/database state and browser controls.
- S07–S09: an actual PDF worker excluded hidden text before review/apply; private-need invitations preserve ownership and XOR; concurrent requests for the final invitation allowance produced one success and one rejection; concurrent expert decisions produced one projection effect without changing original answers.
- S10–S11: adaptive limits, saved answers, expiry, insufficient data and no qualification grant were checked. An actual Docker code runner produced separate passed, wrong-answer and infrastructure-error outcomes. Resource, process, filesystem and network restrictions were exercised.
- S12–S15: guest disclosure followed exact-CV opt-in and revoke; signed passports rejected tampering and revoked evidence; transactional outbox delivery survived a lost acknowledgement with one durable receiver effect; offer compatibility preserved private preferences and rejected salary probing inputs.
- S16: 36 sequential requests compared two contexts and three pages, with three pairs per page/context. Full DTO, admission, exact CV, score, order, explanations and ACL results matched. The original production selection path is retained.

I01–I14 and Q01–Q22 were traced to these checks. Additional negative HTTP cases covered 24 foreign operations and confirmed unchanged data across 23 tables. Matching/catalog opt-out, guest permission and addressed company consent were tested separately. Explicit company revocation closed four document/export endpoints. Account-level skill evidence survived removal of a CV. Existing photos were not changed; their authorization projection was checked in source and regressions.

## Build, persistence and the discovered defect

The independent baseline passed frozen dependency installation, the full build and 705 regression tests with concurrency 2 and no skips. Two tests used the actual isolated runner. A fresh schema applied migrations 0000–0035. Upgrading an older schema preserved 46 original-column projections. Restarting the independent database/application preserved hashes of 23 complete tables and those 46 projections.

The controller found E1-01: disabling the adaptive experiment also prevented reading existing history. The repair separates read-only history access from issuance/scoring. A new real authentication/HTTP/PostgreSQL integration test exercises ON→OFF. The focused integration and adaptive tests passed (3 tests, no skips), followed by a new complete typecheck and production container build.

On that newly built container, the controller verified finished, expired-active and pending-analysis sessions through HTTP and the browser with the flag OFF: owner reads succeeded, foreign/unauthenticated/employer access remained denied, write commands returned 503, original saved answers remained visible, and all seven adaptive-related tables retained identical hashes after both HTTP and UI checks. The browser issued no adaptive POST and reported no page errors. The full 705-test baseline was not rerun after this focused four-file repair.

## Limits and configuration

S10 and the predictive part of S15 remain engineering experiments, disabled for production. There are no independent human calibration data or claims of empirical grading/prediction quality. Qualification checks used synthetic fixtures and known test oracles.

S11 establishes observed boundaries of the dedicated QA runner, not a formal proof against container escape or approval to expose arbitrary code execution publicly. Optional runner and ATS deployment still require their documented operator configuration.

S16 measured mean request durations of 69.4263 ms (eager) and 60.5473 ms (deferred), with the same average 7.5 SQL statements and SQL data volume. This small synthetic, paired sample on a shared host does not establish a speedup or SLA. No production algorithm switch was made. Historical latency FAIL and earlier failed/partial harness runs remain part of the local evidence history.

Ordinary workspace/skills, recovery and watch scheduling have documented enabled defaults. Adaptive/code execution and ATS are disabled unless explicitly configured; prediction remains disabled. The final adaptive read-only check temporarily disabled background workers to make database immutability observable.

The detailed local controller report maps every requirement to its scenario and result files. Raw QA artifacts, database contents, private configuration, credentials, generated reports and media are intentionally excluded from this source-only commit. Reproduction entry points include the repository's `tests/`, `scripts/competitive-*.ts`, worker documentation and `artifacts/api-server/tests/adaptive-history.integration.test.ts`; integration checks require isolated disposable databases and the documented feature configuration.
