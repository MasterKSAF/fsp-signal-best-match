# Resume-aware matching, specialist catalogue and invitations

Version: `resume-catalog-v2-confirmed-first`, 2026-10-07, Signal 0.6.0. This document describes the current source implementation. Sealed 0.5.0 and earlier packages retain their original bytes, timestamps and verification scope. Current normal compiled HTTP and full native load have separate actual proofs. The sealed ZIP's clean launch, privacy and media are accepted only by their exact companion receipts.

## Ownership and explicit selection

The [17 written FSP answers, 2026-10-07](official-written-qa-20261007.md) clarify requirements without changing this API: a category can be specialization plus verified grade (B12), multiple categories are optional (B6), and experience or a self-declared grade does not certify qualification (B5/B13). B8 permits real names and employment history; it does not require publishing private résumés or removing candidate visibility choices. Account contact fields still require the existing addressed consent. B1 keeps FSP influence within a confirmed category, with equal standing for sporting disciplines; the team's ranking weights and current source trust checks are not prescribed by that answer.

Candidate account identity and contacts remain account-level. Professional fields come from exactly one undeleted `signal_candidate_resumes.id`; `resumeRevision` identifies its content revision. All employer reads require an employer session and the exact server-owned demo/ordinary and reviewer scope. Common demo accounts have a null reviewer scope and cannot see individual reviewer cohorts; a reviewer sees only their paired cohort. Ordinary accounts keep the ordinary null scope. No request parameter or header can select another scope. Integer IDs have PostgreSQL signed 32-bit bounds. Catalogue publication uses the new `consentCatalog`, initially false; legacy `consentMatching` continues to admit the first migrated résumé to need-based matching. Neither consent exposes contacts.

- `GET /api/me/evidence?resumeId=ID`: candidate owner only, safe applicable evidence for that résumé, 400 without an explicit ID, 404 for a foreign/deleted ID.
- `GET /api/matches?needId=ID[&resumeId=ID]`: company-owned need, full admitted pool, one card/person. Optional `resumeId` chooses an available admitted résumé for its owner while retaining the complete pool. Alternatively `resumeIds=ID,ID` retains up to 100 explicit selections for different people; supplying both parameters or two selections for the same person is invalid. An unavailable selected résumé is 404. Cards carry `resumeId`, `resumeRevision`, `title` and `availableResumes` summaries.
- `GET /api/matches/explanation?needId=ID&candidateId=ID&resumeId=ID`: exact eligible résumé, the same complete-pool ordering with that selection. No substitution based on another browser tab or primary résumé.
- `POST /api/employer/invitations`: existing invitation body plus mandatory `resumeId` and `Idempotency-Key` header (or body `idempotencyKey`). Need and exact résumé eligibility are checked on the server. Responses carry `companyId`, `resumeId` and a permitted historical `resumeSnapshot`.
- `POST /api/jobs/:id/applications`: existing `companyId`, `jobVersion`, `message`, explicit disclosure consent plus mandatory owner `resumeId`. One application/person/job remains the unique boundary. Requesting another résumé after applying returns `ALREADY_APPLIED_WITH_RESUME`, not a silent replacement.

Qualification is materialized transactionally after assessment or correction for all affected résumés. Pool reads use these fields and the existing ranking evidence whitelist. Only selected/page résumés load a batch of immutable attempts to derive safe evidence. Full attempts/answers/oracles are never returned. Shared evidence retains its original date and ID. Legacy aggregates are labelled with their provenance limitation and do not create newly measured badge evidence.

Whole-pool reads select `hasAccessiblePhoto` from the actual nonempty image and public résumé visibility; they select no image bytes. Safe evidence/card enrichment reads actual image data only for the selected/page IDs and rechecks undeleted public visibility. Filtering can therefore count a real accessible image without copying its bytes across every résumé. The same boolean never turns a pseudonymous image into a public photograph.

A whole qualification requires a verified submitted complete program with immutable `purpose=signal_qualification` and the original specialization/program/version/grade context. An independently successful criterion can retain skill evidence even when the whole program did not pass: its criterion level is not a verified whole grade. Strict matching still requires an actual applicable grade. A company task or unknown-purpose source cannot become a Signal qualification through ranking enrichment. Current status, corrections and result/date linkage are checked; copying documents does not copy attempts or refresh verification dates. The server-only `poolContentDigest` never belongs to any résumé DTO.

## Account evidence registry

`GET /api/me/evidence/registry` is additive; the existing résumé passport endpoint remains unchanged. The registry accepts no query selectors. It requires the current candidate-owner session and returns `Cache-Control: no-store, private` from a read-only repeatable-read snapshot.

The result contains `matrixVersion`, live owned `resumes`, deduplicated original `evidence`, and limited `historicalQualifications`. Each original criterion has stable attempt/criterion/canonical-skill identity, original date/program/version, criterion level, result, status and per-document `applications` with applied/selected/reason/nextStep. These applications come from the shared qualifier's `qualification.applicability`, not a second frontend resolver.

`signal-evidence-compatibility-v1` currently has 90 explicit identity-only rules for five known program versions and three criterion levels. Backend and Frontend share no approved cross-program criterion equivalence; SQL does not become Frontend proof, and Python is not TypeScript. Unknown versions/criteria deny transfer with a reason. A rule cannot transfer a whole grade. Older supported snapshots retain their original rubric/date and are not called current-version certification.

Deleting the original document preserves the account source without resurrecting the document. Correction retains original result/history but deactivates every application. Repeated use in five résumés is one source, not five observations. Legacy aggregates lacking a full version/criterion remain explicitly limited and never create fabricated individual evidence. No answers, oracles, correction operator, contacts, photograph or pool signature appear in the registry.

## Catalogue API

`GET /api/employer/candidates` extends the existing candidate bank; there is no second separate catalogue. Parameters:

| Parameter | Meaning |
| --- | --- |
| q, specialization | Professional alias substring; exact specialization |
| grade | Junior/Middle/Senior or `unconfirmed` (null, not zero/Junior) |
| skill, skills | Verified canonical skill; comma-separated `skills` means all selected skills |
| experienceMin, experienceMax | Candidate-stated years, 0..80 |
| workFormat | Exact résumé work format |
| salaryMin, salaryMax | Overlapping salary range; supplying either requires `salaryPeriod` and `salaryType` |
| salaryPeriod, salaryType | month/year and gross/net; annual/monthly can align, gross/net cannot |
| hasPhoto | yes/no, counts only a real image accessible in public visibility |
| readyForOffers | yes/no, explicit candidate setting, unrelated to login/activity |
| checkedWithinDays | Current qualification date in preceding 1..3650 days; unknown/future dates do not pass |
| fsp | yes/no current normalized FSP history; an unresolved claim is not a trusted achievement or bonus |
| needId | Optional company-owned need; applies the existing admission/formula within the filtered catalogue |
| page | 1..10000, page size 24 |

Every predicate matches the same résumé. People are deduplicated before sorting, counts and pagination. `availableTotal` counts catalogue-consenting visible people; `total` counts deduplicated people after filters. Alternative résumé summaries include only visible, catalogue-consenting rows that satisfy every current filter. `GET /api/employer/candidates/:resumeId` returns safe details only for a presently published résumé; hidden/deleted/non-consenting/cross-pool records give the same 404.

Without a need, confirmed documents precede unconfirmed documents. Deduplication selects an actual confirmed résumé among the person's complete currently filtered alternatives when one exists; it never combines fields from different documents. One exact comparable specialization/grade/program/version/rubric cohort can sort by its own score. Mixed confirmed categories use neutral alias/ID order with an explanation; there is no universal Senior/raw-score advantage. Unconfirmed documents remain clearly labelled with a Signal next step, not converted to Junior. Stable IDs resolve remaining document ties; primary status and completeness do not invent points.

Need-based selection compares whole résumé fit first, provenance second, then quality only within a shared exact group. `fsp-signal-match-v6` uses `need-fit-proof-category-queues-v3`: within equal need-fit and proof tiers, specialization+verified-grade categories are whole blocks ordered by a minimum NFC alias/ID anchor computed from all members before local sorting. Within each category, comparable rubric/program/version queues retain local quality and trusted FSP ordering. FSP cannot move one category block ahead of another or overcome better fit. Photo, document count, readiness, badges and payment do not add qualification points.

`fsp-category-results-v1` uses the maximum trusted participation=1, prize=2, win=3, never an accumulated sum. ID alone, legacy boolean and unknown placement give zero. These weights are team policy, not an official sporting classification. The current provider is `signal-fsp-example-v2` with explicit `synthetic_fixture` provenance; no real registry connection is claimed. Current connection and consent rows are included in fresh pool fingerprints, and ordinary accounts cannot import a synthetic fixture as real history.

Responses include safe résumé summary, `candidateId`, professional alias, public-only name/photo, actual skill evidence, compact badges, qualification basis, available summaries and sorting note. No contacts, identity in pseudonymous mode, private answers, hidden alternatives or legacy provenance object are returned. `Cache-Control: no-store` applies to catalogue, detail, evidence and comparison.

Each `availableResumes` entry is only `{id,resumeId,revision,resumeRevision,title,specialization,verifiedGrade,evidenceDate}`. It duplicates neither identity/photo nor professional body/evidence and makes no score claim. The selected main card retains complete safe detail; selecting an alternative evaluates that exact résumé in the current full pool before showing its fit, explanation or invitation draft.

## Badges and interaction

At most three facts: 10+ unique canonical actual applicable proof-backed skills; skills checked within 30 elapsed days; a successful practical scenario (`practicalPassed` from the evidence derivation, not arbitrary overall score). Preserved legacy records alone never satisfy these facts. A recent badge can name a subset of recent skills and shows each original date. Current supported programs do not manufacture ten skills to produce the first badge.

The existing catalogue cards use native `details/summary`: keyboard focus/Enter, mouse hover and click, and mobile tap expose safe skill/date/criterion/program data. Long lists scroll inside the detail, without exposing answers. Selecting a different résumé fetches its current detail and changes grade, skills, dates and badges together; loading and unavailable states never present the previous résumé as the new one.

## Pair explanation

`GET /api/employer/compare?needId=ID&leftResumeId=ID&rightResumeId=ID` requires access to both visible matching/catalogue-consenting résumés and the owned need. The response has `left` and `right` safe résumé summaries plus `candidateId`, alias and `evaluation`; `summary`; `differences[{kind,text}]`; `comparable`; `limitations[]`; and `orderContext{leftPosition,rightPosition,poolSize,note}`. Need ID/creation timestamp and matching algorithm version identify the immutable need context.

Templates state decisive admission, verified mandatory skills, salary compatibility, work format, freshness and comparable results. At equal fit, technical identity order is labelled as such. Raw scores of different banks/versions/grades are never compared. The pair is not re-ranked: positions come from the full pool, with explicit selected-résumé overrides. Queue merge position does not become an invented claim that one person is generally stronger. Two résumés of the same person cannot occupy two places.

A published catalogue-only or inadmitted résumé can still be explained factually; its absent full matching-pool position is null rather than a manufactured rank. Hidden/deleted/cross-pool/non-consenting targets are indistinguishable 404. Equal résumé IDs are 400. Pair comparison does not open contacts or grant an invitation permission.

## History and permission

Invitation/application snapshots identify the concrete résumé and revision at action time; primary changes cannot replace them. Stored summary prose is omitted from history responses to avoid embedded contact details. Current target visibility/deletion and trust permission gate employer historical professional data and contact routes; a snapshot is not a fallback access path. Revocation/block does not change a candidate grade or restore a grant on unblock. Contact grants still require an explicit accepted invitation/application action. A private résumé can be an explicit application target, but employer professional/contact reads remain closed until its visibility permits them; catalogue consent is not required for an application.

## Company practice binding

New templates declare a supported specialization. Eligible selections are whole current owner résumés with confirmed qualification, non-private visibility, matching consent and exact company/candidate scope. Subscriptions require explicit `candidateId` and `resumeId`; offers preserve `resumeId`, `resumeRevision` and a safe original context. Switching the primary or editing a title does not silently replace the target or snapshot.

Hide/delete/specialization change/consent withdrawal revoke associated future subscriptions/offers under the shared owner lock. Qualification correction reconciles current eligibility. Current trust and scope are checked again for decision, submission and employer reads; an addressed owned micro-offer is a valid narrow company-blocking basis. Restoring visibility or unblocking does not revive a previous permission automatically. Existing unbound history is labelled `legacy_unbound`, not attached retrospectively to the present primary résumé.

Company results use `purpose=company_task`, `qualificationEffect=none` and retain their company rubric. They never become a Signal grade or account qualification source. Shared company-result reads require the exact résumé ID and current permission, not merely the person's account ID.

## Invitation anti-spam

Config `SIGNAL_INVITATIONS_PER_24H`: integer 1..1000, default 20. Window is rolling 24 elapsed hours as UTC instants; verified email never increases it. All invitation statuses count their original creation within the window. Company row locking serializes quota/idempotency/check/insert; failures roll back without a receipt or quota consumption. Candidate-level active duplicate protection is company+need+person, across résumé IDs/keys. An active duplicate returns the existing invitation and a receipt without a new quota charge. A declined/withdrawn/expired company/person relationship imposes seven elapsed days before a new invitation across needs. This does not prevent retry of an existing identical intent or returning the existing active invitation.

Receipts are unique by company+key and store canonical body SHA-256 and invitation ID. Same key/body returns the original lifecycle; changed content returns 409 `IDEMPOTENCY_CONFLICT`. Keys are ASCII `[A-Za-z0-9._:-]`, 1..128. Missing key is 400 `IDEMPOTENCY_KEY_REQUIRED`. Quota and closed-contact cooldown return 429 `INVITATION_QUOTA` / `CANDIDATE_CONTACT_COOLDOWN` with ISO `retryAt`. Company block/moderator restriction returns 403 with its structured code and permitted reason. Invitation grant creation and application disclosure lock company before candidate to serialize with block/revocation; unblocking cannot revive a newly raced grant.

## Verification

New 0.6 source-router acceptance is separate from the sealed 0.5 binary. [Evidence HTTP: 11 groups](../outputs/verification/evidence-v060/v060-evidence-57e47103-a.json) covers one source/five documents, unsupported transfer, partial criterion versus whole grade, captured context after change/delete, correction after prior reads, owner ACL and private DTO boundaries. [Evidence/qualification/purpose unit: 22 passed](../outputs/verification/evidence-v060/unit-33a517c0929d.json) retains original rubric and unknown-legacy limits.

[Company-practice HTTP: 16 groups](../outputs/verification/release-0.6.0/microtask-resume-http-3ad2ad88.json) exercises explicit bindings and current permission with exact own-fixture cleanup. [FSP/category SQL/HTTP: 11 groups](../outputs/verification/0.6.0/fsp-category/actual-sql-http-28c560512adf.json) verifies category invariance, trusted source boundaries, warmed current connections and confirmed-first publication. These receipts are controlled source API checks, not compiled or clean-ZIP acceptance.

Current category-policy quality retains original labels and the measured competitive nDCG decrease; no label tuning hides it. See [matching-fsp-category-0.6.0.md](matching-fsp-category-0.6.0.md). Previous failed runs and historical sealed-v5 controls remain identifiable as history, not current-policy success.

The [current normal compiled core association](../outputs/verification/release-0.6.0/compiled-core-http-association-e72f.json) records 57 actual HTTP groups on PID11020/API4365, with eleven normal-bundle assets and exact fixture cleanup. The [new full-duration 5,000-person/one-then-five-resume profile](../outputs/verification/0.6.0/multi-resume/load-comparison-1320e58d7650.json) passed on API `e72fc99a…`: 32 sessions, 30 seconds warm-up plus 180 seconds measured per phase; 8,932/5,781 requests and zero errors. Native peak WorkingSet was 426,491,904/708,661,248 bytes. Expanded explanation p95 was 1,485.18 ms, only 14.82 ms below the local threshold. [Post-run acceptance](../outputs/verification/0.6.0/multi-resume/load-acceptance-1320e58d7650.json) preserves cleanup and source identities. This single controlled profile is not Docker capacity, a measured hardware minimum or a production SLA. The source ZIP's clean launch and reviewed montage are separately scoped companion checks. Historical 0.5 results are not relabelled 0.6. Human validity, real FSP connectivity, external deployment and competition scoring remain unestablished.
