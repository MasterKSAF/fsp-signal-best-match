# Multi-résumé load verification, 2026-10-06

Status at 2026-10-06 23:02 UTC: **both full acceptance phases passed on the portable normal delivery bundle `3ada3096…`**, with exact fixture cleanup and guarded API stop verified. This run measured the byte-identical normal delivery bundle on a separate local API/database, with the original 5,000-person, 32-session scenario and unchanged thresholds. The earlier source-specific `b778188f…` full PASS, initial full FAIL, failed clean-launch receipt and every diagnostic remain preserved; their results are not rewritten. The user-facing stage was not used for this load. This acceptance does not establish a new sealed archive's clean-launch result; that is a separate subsequent verification.

## Latest full acceptance: portable normal delivery

The full run took place on 2026-10-06 22:52:29–23:00:10 UTC. Each phase retained 30 seconds warmup and 180 seconds measurement, with actual measured durations of 181.125 seconds baseline and 181.284 seconds expanded including outstanding requests. It used native Windows Node 24.14.1, PID 8856, start time `2026-10-07T01:51:53.8256711+03:00`, API 4315, origin 4316 and only the dedicated database `signal_resume_load_check` on local PostgreSQL 55435. There was no inspector; `--max-old-space-size=512` and the 1 GiB native process-memory limit were unchanged.

| Route | Baseline requests/errors | Baseline p95/p99, ms | Expanded requests/errors | Expanded p95/p99, ms |
| --- | ---: | ---: | ---: | ---: |
| Catalogue | 1447/0 | 722.74 / 1034.93 | 1030/0 | 1126.36 / 1312.63 |
| Complete matching | 1443/0 | 797.57 / 1011.93 | 1025/0 | 1097.55 / 1311.52 |
| Exact-résumé explanation | 1436/0 | 899.88 / 1202.51 | 1020/0 | 1241.09 / 1448.85 |
| Owner profile | 2800/0 | 682.31 / 881.84 | 2248/0 | 855.17 / 978.62 |
| Real PDF | 1399/0 | 1220.19 / 1680.07 | 1123/0 | 1501.87 / 1680.22 |

Baseline completed 8,525 requests and expanded 6,446. All were HTTP 200, with zero errors/timeouts. Peak native working set was 404,893,696 bytes baseline and 677,511,168 bytes expanded, below the unchanged 1,073,741,824-byte limit. Both phases recorded 38 valid same-PID/start-time telemetry samples. Process CPU increased by 208.828125 and 214.671875 seconds, respectively 115.31% and 118.43% of one logical CPU, or 9.61% and 9.87% normalized across 12 logical CPUs. No CPU threshold was added. The separately reported small-fixture 1,000 ms JSON criterion was not met by expanded catalogue, matching or explanation; the original required 1,500/2,000/5,000 ms criteria all passed.

The executed normal API SHA256 was `3ada309626da44b40f545d1f090ada5aed1bd2287361ae16d536d2db6d20aeb3`; candidate attestation SHA256 was `f4bc063b47fa738d4bfc061805d31da26b30cc4e2ace6d963343d5afedb21ca0`. Snapshot `406f04d7e9ae` copied all 11 normal delivery assets, including workers/maps and the public quality report, without recompiling the delivered server. All 568 accepted source/build-configuration hashes and all assets matched before/after measurement and in the owner's post-run recheck.

The portability correction explicitly externalizes optional `supports-color` and replaces exactly one Pino-generated absolute output-directory literal with runtime `globalThis.__dirname` before esbuild parses the source. It retains entry points, workers and banner; unexpected generator shapes fail closed. Actual relocation tests moved the generated Pino worker files to another directory, removed the original directories and launched the worker from a different current directory. A separate controlled Windows/Linux build probe then matched all 568 source inputs and all 11 delivery assets byte-for-byte, including maps. That probe is build agreement, not a clean installation or Docker load measurement. The previous `c899…` clean-launch failure remains historical evidence: its stale Docker input context and differing API bytes were not accepted or normalized into equality.

Both phases retained 5,000 catalogue people, 3,250 admitted matching people, 2,500 advanced whole-résumé AND-filter results and 72 unique people across the first three pages. Full matching order digest `c116935c6feade77ebe76cbcecb2643c5a85d46ca156f7b0de1cbb965b000699` and page digest `880b5a1f3a9192ab9d8e3c944a4690267a29908f9eca5fcaa47f35b45b87f6a0` were identical between the phases of this run. Baseline contained 5,000 résumés and expansion 25,000; both kept the same original 5,000 immutable attempts, dates and primary IDs. These run-specific ID/order hashes are not required to equal an earlier independently created fixture's hashes. Dataset/source hashes were stable during both measurements; no hidden answer keys or duplicate people appeared in employer results.

Exact owner cleanup removed all 5,016 created accounts. An additional post-run SQL query found zero `multi-load-%@example.test` accounts in the dedicated database. Guarded stop checked PID 8856 and the recorded start time and stopped only that owned process at `2026-10-06T23:02:13.939Z`. The process was absent and port 4315 had no listener afterwards. The user-facing 4313/4314 stage and unrelated processes were not modified by this run.

| Latest evidence file | SHA256 |
| --- | --- |
| `outputs/verification/multi-resume/load-comparison-cf5f76e84655.json` | `67086397c7e12f602d5dfe4a2d13879cde3ff4a31310fe463731e01517a16bc0` |
| `outputs/verification/multi-resume/load-cf5f76e84655-baseline-one-resume.json` | `73bfde6693cb0905f645bf585e3af60fa405346af1c5a750f544e0a971d45b7c` |
| `outputs/verification/multi-resume/load-cf5f76e84655-expanded-five-resumes.json` | `1872f49ab4502087e0e4dcbb32084e32c3186400ea220fc635dfbe9209ee2a82` |
| `outputs/verification/multi-resume/load-final-acceptance-cf5f76e84655.json` | `fec35ad248048991114ae3efecca75d2d23a829b159cf3b0edf0e7f19cfe94f8` |
| `outputs/verification/multi-resume/sql-acceptance-2ff072bdc3a2.json` | `80077f8a9d09fa6c662fd1477fdcfc5ca67583976d165ddcdd56a12b28ff8264` |
| `outputs/verification/multi-resume/cache-http-899eadc5e263.json` | `4dc1afc383deda65375290acf7e78efcb5466f81b26ddcd733ef4a6d9207f23a` |
| `outputs/verification/multi-resume/build-portability-3ada3096.json` | `00b11db4d6d7787d5515f34426c07be2ce23a4cd105e99651fda760feff9aaf7` |
| `outputs/release-0.5.0/build-portability-diagnostic.json` | `4e5bdcbd5aab34d9b6e6371b7df54e7f4556ac2b2ec18fdecfaf1641025f0aff` |

The SQL receipt records 34 actual groups and the HTTP receipt 17 groups on this exact normal API before measurement, each with its three synthetic accounts removed. The owner portability receipt contains seven passing portability/delivery-guard tests. The final-acceptance receipt rechecks original durations, thresholds, complete source/asset association, telemetry, live post-run database cleanup and stopped listener. It is an owner attestation, not an independent evaluator's measurement. Native working set is not Docker RAM, and this controlled synthetic run does not establish production capacity, real-person assessment accuracy, a sealed archive's clean launch or an official competition score.

## Preserved first full acceptance: source-specific b778188f

The full run took place on 2026-10-06 22:16:15–22:24:00 UTC. Each phase used 30 seconds warmup and 180 seconds measurement; actual measured durations were 181.278 seconds baseline and 181.215 seconds expanded because outstanding requests were awaited. The API was native Windows Node 24.14.1, PID 29468, start time `2026-10-07T01:15:42.4142745+03:00`, on loopback 4315 with database `signal_resume_load_check` at local PostgreSQL 55435. The origin was 4316. There was no inspector. Node heap argument remained `--max-old-space-size=512`; the process-memory limit remained 1 GiB.

| Route | Baseline requests/errors | Baseline p95/p99, ms | Expanded requests/errors | Expanded p95/p99, ms |
| --- | ---: | ---: | ---: | ---: |
| Catalogue | 1386/0 | 794.48 / 1002.54 | 938/0 | 1230.60 / 1469.75 |
| Complete matching | 1380/0 | 904.22 / 1126.86 | 930/0 | 1300.46 / 1630.57 |
| Exact-résumé explanation | 1378/0 | 990.20 / 1294.34 | 926/0 | 1412.71 / 1581.00 |
| Owner profile | 2664/0 | 726.26 / 965.06 | 1962/0 | 1034.95 / 1346.75 |
| Real PDF | 1334/0 | 1375.80 / 1625.06 | 984/0 | 1829.00 / 2098.20 |

Baseline issued 8,142 requests and expanded issued 5,740; every response was HTTP 200, with zero timeouts/network errors. All five routes exceed the minimum 50 samples. Peak native working set was 440,213,504 bytes baseline and 704,311,296 bytes expanded, both below 1,073,741,824 bytes. Each phase has 38 valid telemetry samples with the same PID/start time. Process CPU increased by 207.375 seconds baseline and 203.5625 seconds expanded, respectively 114.40% and 112.33% of one logical CPU, or 9.53% and 9.36% across the host's 12 logical CPUs. CPU usage introduces no new acceptance limit. The separately reported stricter 1,000 ms small-fixture JSON diagnostic was met in baseline and was not met in expansion; the required 1,500/2,000/5,000 ms thresholds were unchanged and passed.

The normal delivery bundle SHA256 was `b778188f7e249fd65b75e42deb05d82c8d7d0ceee6d69aafdc236fd2a57ac54b`; the fixed final candidate attestation SHA256 was `ed894ab4880fcb2317f540673a59bb0efd1cb2196ba8345d31b949e66b32a481`. Snapshot `df96442776ee` copied all 11 normal dist files, including workers, source maps and the public quality aggregate. All 567 accepted source/configuration hashes and all copied assets matched before and after the run. The measured server was copied unchanged from normal `dist/index.mjs`, rather than recompiled using the historical custom diagnostic build options.

Catalogue counts stayed at 5,000 people, matching at 3,250 admitted fixture people, and the advanced whole-résumé AND-filter combination at 2,500. The first three pages retained 72 unique people. Complete matching order digest `be802bb4542f47f881f9599f66fbf2053ff5a01f3abe80f72cb4008a72e20992` and first-page digest `890edff562711aa36775d16e7d5e63b1775fee06d305a82254f3f02aabcf97ec` were identical across expansion. Baseline had 5,000 résumé rows and expansion 25,000; both retained exactly the same original 5,000 attempts, dates and primary identities. Dataset hashes were stable within each measurement and no hidden answer keys appeared in employer responses. Deduplication/counting/pagination operated on people and did not turn compatible résumé copies into extra qualifications.

Owner-only cleanup removed exactly 5,016 created accounts and left zero. A post-run database query also found zero `multi-load-%@example.test` accounts. Guarded stop verified PID 29468 and its original start time before terminating only that API at `2026-10-06T22:24:34.294Z`; port 4315 then had no listener. The stage on 4313/4314, its database and unrelated processes were not modified or stopped by this run.

| Final evidence file | SHA256 |
| --- | --- |
| `outputs/verification/multi-resume/load-comparison-3ec97baaf321.json` | `4c4d65c8da3e8ef6d25e4c8412c07f0c5a3dfca36965a8212781bd855801eba2` |
| `outputs/verification/multi-resume/load-3ec97baaf321-baseline-one-resume.json` | `464da4326f352a9383c8d87f45afe6d6ad50088922fb394215a4f3cf6b859ff2` |
| `outputs/verification/multi-resume/load-3ec97baaf321-expanded-five-resumes.json` | `6e10c28d7c9aaf3966d77abbafeeb83b86cfc542ab98980f986830aed2925128` |
| `outputs/verification/multi-resume/load-final-acceptance-3ec97baaf321.json` | `c21fa66fc5ab658397775c335d030a2384d8087e1eb9e19dc3c7c22b7ba6daf7` |

The last file rechecks the owner's recorded measurements against the original limits, accepted source/asset hashes, actual post-run database cleanup and stopped listener. It is a post-run owner attestation, not a claim of a third-party performance evaluation. Exact normal-bundle correctness controls also passed immediately before this full run: 34 SQL groups (`sql-acceptance-f5aea083f5e6.json`, SHA256 `39de9b58fd3881a596e1dcbe50d7aaa9d8da107e92e719ecd1835ca3ee204913`) and 17 HTTP groups (`cache-http-406894e50a75.json`, SHA256 `8e84fe0868cdc051ea6923f901a2f779ea734de7198160a186b9a8ffa41558f6`), each with its three synthetic accounts removed. These measurements establish this controlled native local acceptance, not Docker cgroup memory, production capacity, real-person assessment accuracy, a clean archive installation or an official competition score.

## Scenario and unchanged thresholds

`scripts/multi-resume-load-stage.ts` creates 5,000 controlled ordinary synthetic candidate accounts, 16 synthetic employers and 32 sessions. Each candidate has one immutable submitted attempt with oracle-produced synthetic answers; this is load construction, not independent assessment validation or a human pilot. Baseline has one résumé/person. Expansion adds four compatible alternatives/person while preserving the same original attempt/date, account and primary résumé ID.

The measured scenario rotates catalogue, complete matching, exact-résumé explanation, owner profile and real résumé PDF. Request payloads are fully consumed; timeouts and non-200 responses count as errors. The original acceptance timings remain 30 seconds warmup, 180 seconds measurement, 100 ms think time, 10-second request timeout. Functional samples check 5,000 deduplicated catalogue people, pages 1–3 with 24 unique people each, a nonempty matching pool of at least 1,000 fixture people, and a combined specialization/grade/verified-skill/work/salary/photo/readiness/freshness filter. Matching identity/order and first-page digests must remain unchanged after expansion. No new attempts are created by adding résumés.

The limits are copied without relaxation from `scripts/load-scale.ts`: JSON p95 ≤1,500 ms, PDF p95 ≤2,000 ms, all p99 ≤5,000 ms, zero errors, ≥50 samples/route, app memory ≤1 GiB and ≥12 valid telemetry samples. The stricter 1,000 ms JSON criterion from the small fixture is reported separately. The dedicated load stand is a native Windows Node process; telemetry is working set, process CPU seconds and start time. It is explicitly not the old Docker image/cgroup measurement.

## Preserved failed attempt

Evidence: `outputs/verification/multi-resume/load-baseline-one-resume-attempt01-failed.json` and `load-failed-attempt01.json`. During 184.20 elapsed measured seconds, all 576 requests failed at the 10-second timeout. Source hashes, process identity and dataset digest stayed stable.

| Route | Requests / errors | p95, ms | p99, ms |
| --- | ---: | ---: | ---: |
| Catalogue | 96 / 96 | 10,062.52 | 10,076.23 |
| Matching | 96 / 96 | 10,038.38 | 10,074.90 |
| Explanation | 96 / 96 | 10,098.13 | 10,125.55 |
| Profile | 192 / 192 | 10,023.90 | 10,093.31 |
| PDF | 96 / 96 | 10,048.66 | 10,050.26 |

Peak native working set was 1,727,311,872 bytes (1,647.29 MiB), above the unchanged 1 GiB limit. CPU increased by 162.125 seconds over 184.168 seconds of telemetry: 88.03% of one core, or 7.34% normalized across 12 logical CPUs. The expanded 25,000 résumé rows were inserted, but their functional request timed out and their measured phase never ran. These numbers cannot be used as a before/after success comparison.

The first cleanup deadlocked against still running API requests after client cancellation. The parent stopped only isolated API 4313; recovery then removed the exact owned 5,000 candidates, 16 employers, 25,000 résumé rows and 5,000 attempts. Remaining owned accounts: zero. Recovery verifies both captured IDs and the exact synthetic email prefix; it does not delete ordinary/browser accounts. The failed baseline is retained even if a later run passes. Its initial overall report was reconstructed from the saved phase after cleanup; no missing initial script hash is invented.

## Changes following diagnosis

The main allocation hotspot was repeated array reconstruction while grouping a large matching tier in `rankMatches`. The implementation now appends to the same local group arrays; ranking formula, admission, sorting and tie decisions remain unchanged. Independent golden tests checked exact 5,000-person same/mixed-group outputs against the saved original implementation. Catalogue helpers also use local append/get grouping and a résumé-ID override map. A catalogue request with no skill filter avoids constructing an unused canonical-skill set.

Whole-pool reads carry a public-visibility-aware real-photo presence boolean rather than duplicating image bytes across all alternatives. Actual photos and full immutable proof are fetched only for selected/page records (24 catalogue cards, one explanation or two compared résumés). Alternative summaries contain IDs, revision, title, specialization, grade and evidence date; they have no duplicated identity, photo, content or invented score. Public-photo and pseudonymous protection passed the latest seven-group HTTP run. None of these changes increases a candidate's score or grants visibility/contacts.

## Reproduction commands and guarded environment

Do not launch these fixtures on the stage while the user is browsing it. The strict `dedicated-v1` profile requires database `signal_resume_load_check`, local PostgreSQL 55435, API 4315 and application origin 4316. The retained `stage-v1` profile is historical; it is not used for the dedicated diagnostics. Arbitrary database/port combinations are rejected.

The manifest-owned stand reads existing QA compose credentials into memory without printing or saving them. It builds a unique source snapshot under `artifacts/api-server/.load-runtime/<buildId>`, preserves all API input/source hashes and starts only its own loopback API. Stop/rebuild refuses an unrelated listener or PID/start-time mismatch; fixtures use an exact separate run manifest. Run from the repository:

```powershell
node scripts/multi-resume-load-stand.cjs rebuild
node scripts/run-multi-resume-load.cjs --sql-acceptance
node scripts/run-multi-resume-load.cjs --cache-http
node scripts/run-multi-resume-load.cjs --diagnostic
# Stop the owned diagnostic API; after final normal build and root attestation:
node scripts/multi-resume-load-stand.cjs stop
node scripts/multi-resume-load-stand.cjs rebuild-delivery
# Full acceptance runs the exact copied normal delivery bundle, same fixture/SLA:
node scripts/run-multi-resume-load.cjs
# After verified fixture cleanup:
node scripts/multi-resume-load-stand.cjs stop
```

Diagnostic mode retains the fixture hash and SLA values but records its distinct 5-second warmup/15-second measured timing and `diagnostic-not-acceptance` label; it never establishes scale acceptance. If every baseline route fails, it does not begin expansion. A normal run must finish both original 180-second measured phases. Reports preserve source/dataset hashes, current process identity, all statuses/latencies and exact cleanup state. The harness now writes measurements before cleanup, keeps per-run filenames and persists employer IDs in the owner manifest. `scripts/multi-resume-load-cleanup.ts` is the guarded recovery helper after an API drain.

Custom diagnostic bundles are labelled separately and cannot run full acceptance. Delivery mode reads only the fixed `outputs/verification/assessment-purpose/final-load-candidate.json` attestation with schema version 1/application version 0.5.0, rehashes every accepted source and verifies the complete normal `artifacts/api-server/dist` inventory. It copies the original `index.mjs`, all adjacent workers/maps and public quality aggregate byte-for-byte into a new manifest-owned `server` directory; it never recompiles the measured server or overwrites a prior snapshot. Canonical relative paths, unexpected directories/symlinks, changed/missing/extra assets, stale source/bundle and reassigned attestation are rejected. Source hashes are checked before and after copying/fixture compilation. Full-run reports identify `runtimeKind=normal-delivery`, exact API bundle SHA256, candidate manifest SHA256 and copied delivery asset hashes. The separate synthetic fixture harness is compiled from those current accepted inputs; this does not change the delivered server bytes.

The completed post-fix one-versus-five résumé acceptance is recorded above. Previously sealed submission artifacts and old load reports were not overwritten. Replaying this load requires its separately owned local database/API and current fixed candidate attestation; it must not target the user-facing stage.

## Preserved intermediate diagnostic checkpoint

`outputs/verification/multi-resume/load-comparison-3aa6ee725703.json` is explicitly **DIAGNOSTIC**, not acceptance: 5 seconds warmup and 15 measured seconds per phase. API build `3022c9775d4f`, SHA256 `09218550b8a88015c6c16486f60b6f96b18e799f0e7416536a4c61bebc36cce9`, native Windows PID 31544. Baseline issued 423 requests with zero errors, peak working set 404,103,168 bytes; expanded issued 80 requests with 16 catalogue timeouts, peak 830,570,496 bytes. Catalogue/matching/explanation/profile/PDF p95 values were 1094/1588/1891/1385/2511 ms in baseline and 10016/6016/no samples/7918/5898 ms in expansion. The original thresholds were not changed.

Both phases retained stable dataset/source hashes. Catalogue had 5,000 persons, matching had 3,250 admitted fixture persons, advanced AND filters had 2,500 persons; matching order and first-page identity digests were unchanged across expansion. The 5,000 original attempts were preserved. Cleanup removed exactly 5,016 owned fixture accounts, with zero remaining; the API was subsequently stopped using its guarded manifest. This checkpoint does not establish latency, sampling or full-duration acceptance.

On that exact API snapshot, `cache-http-f8f3bbee8eab.json` records 12 actual HTTP groups passing cold/warm exact full response bytes, title/visibility/score/date/correction changes and fresh session/role/need/action authorization, with all three owned accounts removed. `sql-acceptance-736ce5b46357.json` records the corresponding fresh SQL/digest/ABA/readonly-view controls. These functional checks do not make the failing performance diagnostic a PASS.

## Final pre-acceptance diagnostic and fresh-access controls

`load-comparison-a6f8f6b5912a.json` and `cpu-fa4e46aa7dac.json` retain the 2026-10-06 21:58–21:59 UTC diagnostic of API build `fa4e46aa7dac`, SHA256 `04261fff10e93e8f635a1717352606ff578a6414e8af99ef88cd43a11ea5efa0`, native Windows PID 1968. It used the unchanged 5,000-person, 32-session fixture, one original immutable attempt/person and five whole résumés/person after expansion. Only the explicitly diagnostic duration was 5 seconds warmup plus 15 seconds measurement per phase; the required full duration remains 30 plus 180 seconds per phase.

| Route | Baseline requests/errors | Baseline p95, ms | Expanded requests/errors | Expanded p95, ms |
| --- | ---: | ---: | ---: | ---: |
| Catalogue | 112/0 | 723.30 | 64/0 | 3994.92 |
| Complete matching | 112/0 | 998.51 | 64/0 | 1869.49 |
| Exact-résumé explanation | 107/0 | 1082.73 | 48/0 | 1625.06 |
| Owner profile | 224/0 | 842.80 | 182/0 | 1362.61 |
| Real PDF | 111/0 | 1484.51 | 95/0 | 3153.58 |

Native peak working set was 433,274,880 bytes baseline and 685,084,672 bytes expanded. Dataset/source hashes, 5,000 catalogue people, 3,250 matching people, 2,500 advanced whole-résumé AND-filter results, 72 distinct people across the first three pages, full matching order and page identities stayed consistent. The original 5,000 attempts were retained. Exact owner-only cleanup removed 5,016 accounts and left zero; the manifest-owned API was stopped afterwards. This diagnostic cannot establish full-duration or minimum-telemetry acceptance. It does not preserve individual request timestamps, so a hypothesis that slow tails are limited to warmup cannot be presented as a measured rolling-window result.

The same frozen API passed 34 actual SQL groups and 17 actual HTTP groups before this diagnostic. They exercise every résumé field in the server-maintained complete digest, fresh identity/role/scope/visibility/consent, immutable Date views, live score/date/correction metadata, queued own-context reads and pending ABA isolation. HTTP checks compare exact cold/warm full JSON bytes and exercise default-winner selection, complete catalogue filters/counts, publication opt-out, live authorization and the existing fresh invitation guard. Both control fixtures removed all three created accounts. These are correctness controls, not a substitution for latency acceptance.

Fresh SQL predicates and complete content signatures are read on every request. Immutable snapshots use a FIFO builder queue per cache instance with a fresh caller-specific fingerprint after waiting; mutable privacy or correction state is never accepted from a TTL or revision shortcut. Retained-structure estimates are raw 128 MiB, metadata 14 MiB and combined compact ranking/professional JSON 48 MiB; these are not a process heap cap. Catalogue memoization has one context per owned immutable array, at most 2 MiB estimated derived references, with additional reserve charged inside the raw budget. Current-time filters and need-based catalogue requests bypass that memo. Exact default résumé overrides reuse ranking only when every requested owner/résumé pair equals the actual current default winner. Active SQL results and other derived structures still require memory and remain subject to the unchanged measured 1 GiB native limit.
