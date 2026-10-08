# A04/A05: bank content and immutable-history policy

The current modular release is `signal-skills-2026-10-v6`. Six separate modules (Python, SQL, TypeScript, React, Backend engineering, Frontend engineering) each expose Junior, Middle and Senior. A form samples one authored scenario family for each of six competencies. There are three scenarios per competency and five numeric values/two flags. Parameter and option-order variants are **not independent new questions**.

Junior evaluates a basic executable result or concrete decision. Middle requires that result **and** a separate applied requirement. Senior requires a separately designed operational result **and** a Senior engineering invariant. Both parts must pass for the competency. Passing requires at least five of six competencies and every critical competency. Module points do not become an invented numerical professional Grade. A role category is awarded only by the documented competency matrix, with its mandatory engineering module and declared stack.

Current rubric identifiers remain `six-competencies-critical-5of6-middle-outcomes-v4` and `six-competencies-critical-5of6-senior-outcomes-v1`. Historical version/rubric validation remains explicit. The category matrix remains v2. Saved cases, expected answers, rubrics, scoring decisions and old evidence are never regenerated from the current bank.

## Content changes

The five accepted v5 Senior corrections remain distinct from v4: SQL transaction outbox crash/ACK handling; SQL active uniqueness versus referential integrity; TypeScript correlated generic arguments; React abandoned-render ref publication; React three-way draft edit/delete conflict. Their v5 evidence is retained separately and is not relabeled v6.

Two additional v6 Senior React identity families are material revisions: optimistic client/server identity needs operation receipts and durable UI identity; replacement plugin component types need a durable migrated draft and schema/generation fencing. Merely choosing a stable key or hoisting a component type does not satisfy these contracts. These get new content lineage; the other 106 Senior families retain their v5 lineage.

Nine lower-level scenario families have substantive clarifications, with explicit v2 content lineage (Junior and Middle-A share that lineage):

| Family | Reason |
| --- | --- |
| SQL transactions s3 | Specify actual UPDATE rowcount before choosing its outcome |
| SQL constraints s2 | Specify whether customer_id is mandatory or nullable |
| SQL constraints s3 | Specify whether amount is mandatory or nullable |
| TypeScript generics s2 | Preserve concrete T and its remaining fields |
| TypeScript async s3 | Overall success only after all fulfill; rejection is failure, no claimed drain |
| TypeScript immutability s3 | Uncontrolled JS receives original nested plain-object/array reference; protect all its levels |
| React state s3 | Preserve name and the previous immutable profile snapshot |
| React effects s2 | Listener reads changing id and must track it during mount |
| Frontend async-ui s1 | Distinguish request envelopes from payload-only view values |

These revisions are reviewed replacements for ambiguous old wording, not version-renaming resets. Old saved snapshots retain their old wording and key. The other 99 lower-level content families retain their old lineage and personal exposure history.

Current choice editing removes absurd distractors and unrelated telemetry/cache suffixes. Wrong plans describe the actual mistake: stale scope, incorrect order, missing commit boundary, wrong identity/epoch, invalid runtime assumption or unsupported access. All options in the final SQL and Frontend protocol edits use the same scenario-specific decision fields. Some other authored variants use a fixed public-parameter schedule of concise and detailed real counterplans; that is a finite presentation variant, not a new family. No arbitrary filler is appended to achieve a word-count target.

## Operator disabled-family policy

Registry GET and actual start share one eligibility predicate. A disabled immutable family applies to its old release IDs, current release IDs, Junior/Middle aliases where content is shared, and canonical family ID. Any disabled alias wins over an active alias. Stable family exposure is aggregated across release IDs; upgrading from v4/v5 to v6 cannot make previously seen unchanged content unseen.

The operator CLI resolves a historical ID only when the same immutable current family exists. Disabling any supported alias targets the entire family. Enabling requires an explicit named operator and substantive reason, changes **every existing alias** in the family, and appends an audit receipt under `new_attempts_only_stable_content_family`. An active current alias alone does not clear a disabled historical alias. A retired material revision cannot silently enable its replacement; releasing replacement content needs a reviewed change basis.

Already-issued active attempts restore before the current issuance eligibility/version gates. Their frozen content, oracles and policy remain unchanged through save and submit. Disabling a family prevents new issuance; it does not rewrite history or annul evidence. Evidence annulment remains a separate explicit operator action with its own immutable correction receipt.

## Retired qualification forms

Legacy Backend/Python and Frontend/TypeScript qualification issuance is `read_complete_only` in **both** modular-flag modes. Public metadata says `available:false` for new issuance. Existing frozen attempts remain readable and finishable. Turning the modular flag off does not reactivate the defective legacy bank.

The same retirement policy applies to research study creation, new enrollment and a fresh research form. Existing enrollments remain idempotently accessible, and an already-open frozen research attempt remains readable, savable and submittable. Historical research outcomes do not award a working professional category. Runtime proof is performed only against disposable isolated fixtures; real old attempts are never fabricated or modified.

## Reproduction and evidence boundaries

Stateless source tests are in `tests/skill-full-audit-bank.test.ts`; historical v4/v5 preservation tests remain in their original separate suites. Public-only fixtures and append-only semantic reference worksheets are under `outputs/verification/full-audit-a01-a11-20261008/bank`.

`scripts/full-audit-bank-live.ts` requires the exact isolated database `signal_full_audit_a10_20261008`, local immutable bundle SHA/PID and port4383 (flag on) or4385 (flag off). It creates disposable actors only. Reserved synthetic research operator900008301 must be explicitly enabled in that isolated runtime. The supplied runtime origin `http://signal-full-audit.localhost:4384` is pinned in the guard alongside local4384 origins. `scripts/run-full-audit-bank-live.ps1` clears only inherited keys listed in the private env file, invokes Node without PowerShell stderr decoding, and creates/stops only its own off-mode API child. No secret env values are copied to the project.

Actual dated proof completed on API bundle SHA256 `c64bf89bfe4047a37e8fec68331a8792bcf6aa8b6c287aa142c188ae6f8479b5`: on4383/PID45980 six groups PASS, off4385/PID38460 three groups PASS. Both modes deny new ordinary legacy and research issuance while preserving existing frozen read/save/submit. On mode additionally proves stable-family CLI/registry/start ban and explicit audited enable, old-v4 exhaustion and active frozen-v4 completion. All owned actors, sessions and module/ordinary/research attempts were removed; the owned off API stopped and4385 was free. Its operator availability audit remains append-only. `bank-live-final-summary.json` contains exact receipt hashes and retained harness/launcher failures; those failures did not change product source.
