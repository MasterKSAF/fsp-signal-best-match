# UI audit corrections A02/A03/A06/A07/A08/A09

Scope: the isolated `signal-ui-refinement-workspace-20261008` checkout. Original checkouts, historical evidence, databases, archived attempts and document export styling were not edited. UI source frozen for root browser QA on 2026-10-08.

## Implemented contracts

| Audit | Result |
|---|---|
| A02 | Work preferences save reads the latest selected résumé with `cache: no-store`, updates the résumé cache, compares the editable baseline and keeps the existing CAS revision guard. A 409 preserves the local draft. Recovery requires explicit confirmation, fetches again and replaces only preferences/baseline/revision after a valid successful response. Loading and failure states do not erase the draft. Both section save and the existing three-section sticky save use this flow. |
| A03 | URL skill filters validate JSON shape, item types, strict keys, skill lengths (1–60), at most 20 entries, the 3000-character URL bound and optional Junior/Middle/Senior levels. Invalid entries are removed with a visible status. Normalized query parameters feed search and both CSV/XLSX links, retaining personal filters. Valid heterogeneous levels round-trip unchanged and are visible in the applied filter chip. Duplicate skill names retain the strongest requested level. |
| A06 | Shared pure guidance content uses current résumé, matrix, passport, private request and public vacancy routes. Candidate start opens résumés. Auth questions produce auth help. Modules, category grades, employer practice and historical exams are explained separately. Actions stay within the current role. |
| A07 | Optional recurring résumé, questionnaire, tag-input, practice, company and contact-visibility explanations are available through keyboard/touch/hover `InlineInfo`. Actual counts, statuses, errors, consents, deadlines and destructive-action consequences remain visible. No blanket paragraph hiding was introduced. |
| A08 | The consultant launcher is compact. Desktop workspace reserves a right gutter; the launcher hides during external input focus, visible modal dialogs, timed historical or module attempts, and action collisions. Editing a résumé moves focus/scroll to its editor with an offset below the existing sticky toolbar. Tooltip placement measures its actual content and remains within the viewport; Escape/outside click/focus behavior is preserved. |
| A09 | Four complete semantic palettes are used by workspace, public pages, cards, chrome, fields, selected navigation, overlays, shadows, semantic statuses, skill chips, levels and focus. Light/dark/system legacy preferences migrate without a startup flash. System mode reacts to the OS; manual choices remain manual. Demo is yellow in every palette. |

## Theme storage and QA selectors

`localStorage['fsp-theme']` stores exactly `pearl`, `cashmere`, `graphite`, `midnight` or `system`.

- Жемчуг / `pearl`: neutral light palette.
- Кашемир / `cashmere`: warm greige light palette.
- Графит / `graphite`: neutral dark palette.
- Полночь / `midnight`: blue-gray dark palette.
- Как в системе / `system`: resolves to pearl for light OS and graphite for dark OS.

Legacy `light` migrates to `pearl`; `dark` migrates to `graphite`; missing or unrecognized storage resolves to `system`. The first inline script in `index.html` and the React preference hook share these semantics. The hook listens to OS media changes and cross-tab storage events.

`html[data-theme]` contains the resolved palette. `html[data-theme-preference]` contains the stored choice. Graphite/midnight also set `html.dark` and `color-scheme: dark`; pearl/cashmere set `color-scheme: light`. Picker buttons expose `data-testid="theme-pearl"`, `theme-cashmere`, `theme-graphite`, `theme-midnight`, `theme-system`, and `data-palette` on the choice.

Declared skill chips are gray, verified green, recommended purple. Every chip includes its explicit status and optional Junior/Middle/Senior text. Palette CSS overrides legacy light/dark chip colors centrally. `--demo-lamp: 43 90% 58%` remains the same yellow for all palettes.

## Verification

- `tests/ui-url-recovery-audit-a02-a03.test.ts`: malformed/mixed/bounded skill URLs, valid heterogeneous round trips, personal filter and server/export parity, duplicate strength, fresh résumé recovery snapshot selection/cloning and invalid recovery responses.
- `tests/ui-theme-guidance-audit-a06-a09.test.ts`: actual first-paint script against runtime preferences; migration, storage failure, system/manual modes; contrast calculated from actual CSS tokens; all four distinct surface systems; current role routes, auth/start content, modular/historical separation and both attempt parameter types.
- Focused tests: **13/13 PASS**, exit 0. Frontend typecheck: **PASS**, exit 0. No load tests, backend writes or global test suite were run by this UI task.
- Evidence: `outputs/verification/full-audit-a01-a11-20261008/ui/focused-tests.log`, `focused-tests-attempt01.log`, `frontend-typecheck.log`, `palette-contrast-receipts.json`, `ui-source-manifest.json`.

An initial test run found a consultant regex matching the word «вопрос» as «опрос»; the question classification was corrected. The initial log remains separate. The final test run passes.

Measured token contrast across the four themes: main text minimum **11.01:1**, secondary text **6.31:1**, input borders **3.27:1**, focus **6.24:1**, semantic statuses **5.35:1**, skill status text **5.54:1**, level text **5.08:1**. These are targeted token checks, not an assertion of complete WCAG certification. Thresholds follow the [W3C text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html); tooltip behavior follows the [WAI-ARIA tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/).

Root owns browser verification of both roles, all four themes plus system, resolutions, actual 409 save/recovery, keyboard/touch tooltip behavior, sticky toolbar and consultant collision behavior. These live checks were pending when this source freeze was recorded. Final integrated build is also owned by root.

## Source ownership

UI components: `App.tsx` (theme hook/picker, résumé contact hint, legacy résumé links and About current-module/FSP text only); `components/my-resumes.tsx`, `candidate-jobs-workspace.tsx`, `signal-consultant.tsx`, `workspace-guide.tsx`, `candidate-resume.tsx`, `dictionary-input.tsx`, `microtasks.tsx`, `product-enhancements.tsx` (company fields only), `inline-info.tsx`, `skill-chip.tsx`.

Styling/bootstrap: `index.html`, `src/main.tsx`, `src/theme-palettes.css`, `components/my-resumes.css`, `signal-consultant.css`, `inline-info.css`, `skill-chip.css`. Existing sticky save/create behavior, card layout, brand fonts, title alignment and personal vacancy filters were preserved.

Pure helpers: `lib/job-skill-filters.ts`, `work-preferences-recovery.ts`, `theme-preference.ts`, `theme-palettes.ts`, `workspace-guidance.ts`, `signal-consultant-content.ts`.

Root simultaneously owns targeted matching empty-state content in `App.tsx`, public auth intent binding, API/FSP work and integration QA. Other agents own authentication and the skill bank. This report does not claim their tasks complete.

## Final UI summary: measured values and reviewed screens

This section updates the browser-QA status recorded at the earlier source freeze above. It does not close the pending core HTTP, resource or final bundle acceptance in the [organizer requirements matrix](organizer-requirements-current.md).

The following ratios are calculated from the **actual semantic CSS tokens**, using sRGB relative luminance. Text is the minimum across the measured workspace/background/card/sidebar/field/popover pairs; input and focus are the minimum across field/card/workspace pairs. Status values pair each foreground with its corresponding soft surface. They measure these token pairs, not every rendered pixel, transparent layer, animation state or third-party document.

| Palette | Main text | Secondary text | Input border | Focus | Success | Warning | Error | Info |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Жемчуг / pearl | 12.525:1 | 6.497:1 | 3.279:1 | 6.500:1 | 5.820:1 | 5.977:1 | 5.507:1 | 5.784:1 |
| Кашемир / cashmere | 11.014:1 | 6.316:1 | 3.328:1 | 6.247:1 | 5.683:1 | 5.665:1 | 5.357:1 | 5.916:1 |
| Графит / graphite | 12.566:1 | 8.002:1 | 4.684:1 | 7.714:1 | 7.102:1 | 6.525:1 | 6.280:1 | 6.866:1 |
| Полночь / midnight | 12.007:1 | 8.217:1 | 4.831:1 | 7.832:1 | 7.476:1 | 6.315:1 | 6.412:1 | 6.666:1 |

The same receipt measures skill-status text and all Junior/Middle/Senior level tokens; their respective minima are **5.548:1** and **5.086:1**. Labels also state the status/level in text, so the meaning does not rely only on color. The yellow Demo lamp is a state indicator, not a contrast-certified text label.

Source for these numbers: [palette-contrast-receipts.json](../../outputs/verification/full-audit-a01-a11-20261008/ui/palette-contrast-receipts.json). These targeted values exceed the tested 4.5:1 text and 3:1 non-text thresholds; they do **not** certify the entire application against WCAG. Automated contrast checks do not establish keyboard operation or screen-reader announcements.

Root's current browser receipts cover **72 route/theme cases**: nine candidate pages and nine employer pages × four palettes at 1280×720. The measured DOM checks report no horizontal overflow or collected runtime alerts/errors in those cases. Workspace/chrome colors and recorded heading sizes are in [candidate-four-themes-1280.json](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/candidate-four-themes-1280.json) and [employer-four-themes-1280.json](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/employer-four-themes-1280.json). The initial employer receipt retains the discovered 38px vacancies heading; the narrow correction is separately measured as 25px in all four palettes in [employer-heading-after.json](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/employer-heading-after.json). The before receipt was not overwritten.

At 390×844, the recorded candidate/editor and employer subsets have no horizontal overflow; the résumé save/create actions have measured visible bounds and recorded mobile titles are 21px. See [candidate-390.json](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/candidate-390.json) and [employer-390.json](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/employer-390.json). Four pages per role were also checked with a **640×360 CSS viewport and DPR2**, equivalent to the reflow of 1280×720 at 200%; this was **not native browser zoom testing**. Both subsets report no horizontal overflow: [candidate equivalence](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/candidate-200pct-equivalent.json), [employer equivalence](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/employer-200pct-equivalent.json).

[System/manual reload receipt](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/system-and-manual-reload.json) records system light→pearl, system dark→graphite and manual cashmere retained under a dark OS preference. Storage migration and first-paint agreement are covered separately by the focused helper tests.

Screenshots in the [browser evidence directory](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/) support root's qualitative review of cards, chip/level legibility, dark main versus panels, heading alignment, action placement and tooltip/editor layout. Screenshot review is distinct from token calculations and DOM bounds. It does not establish all keyboard/touch behavior, screen-reader output, multiple browser engines or every responsive route. Root will append the final live cases against the accepted runtime for save/conflict recovery, filters, consultant visibility, tooltip focus/Escape and the sticky action toolbar; those integrated receipts remain pending here.

## Final live auth and work-preferences corrections

The following dated receipts supersede the pending status **for these specific scenarios**. They do not close resource acceptance, the final clean build or unrelated UI scenarios. The 72 route/theme cases and responsive/system measurements above still describe the same palette and layout CSS; the later corrections changed session-query policy and work-preferences synchronization, not those styles.

### Anonymous protected-route session loop

An anonymous direct visit to `/candidate/resumes` on the clean UI4384 remained on «Проверяем сессию» while `/api/me` returned 401. The error/loading route trees remounted `PublicHeader`, creating a new session observer. `retry: false` prevented retries inside one fetch, but the default `retryOnMount: true` immediately fetched the failed session again. The [before receipt](../../outputs/verification/full-audit-a01-a11-20261008/ui/anonymous-session-loop-before.json) preserves the explanation and a bounded, network-free reproduction: eight observer mounts caused eight rejected checks. Root's original [failure screenshot](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/clean-anonymous-protected-route-loader-before-fix.png) remains separate.

`lib/query-client.ts` now sets `retry: false` and `retryOnMount: false` **only for the `/api/me` query key**. The stable HMR client, other query policies, explicit refetch/invalidation and login/logout cache updates are retained. The [local after receipt](../../outputs/verification/full-audit-a01-a11-20261008/ui/anonymous-session-loop-after-local-tests.json) records six passing focused cases and frontend typecheck. Twenty anonymous observer mounts make one rejected check and settle at error/idle rather than loading; recovery, role changes and explicit invalidation remain effective.

Root's [actual clean-UI receipt](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/anonymous-session-loop-after-live-ui.json) records a stable sign-in screen on the direct anonymous route, repeated observation without the loading loop, opening the login dialog and reaching the candidate workspace using an owned account. This observation used backend c64. **The live network request count was not measured**: the readonly DOM facade did not expose the performance API. The exact count belongs to the bounded observer regression, not to the screenshot or DOM observation.

### Work-preferences DTO and synchronization failures

The first actual two-tab scenario saved B's conditions, preserved A's conflicting local location and another About draft, then explicitly recovered B's fresh values. Editing and saving again returned 400 «Проверьте поля резюме». Raw persisted preferences included `resumeId` and `updatedAt`; spreading the recovered object sent those read-only keys to the strict request schema. The original [browser failure receipt](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/work-preferences-two-tabs-before-fix.json), [400 screenshot](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/work-preferences-recovered-resave-400-before-fix.png) and [local strict-schema reproduction](../../outputs/verification/full-audit-a01-a11-20261008/ui/work-preferences-metadata-before.json) were retained.

The DTO correction projects exactly `location`, `schedule`, `employment`, `relocation` and `startAvailability` for state, baseline, equality, fresh cache, recovery and PATCH; only the PATCH adds `revision`. Its [three passing DTO/schema cases](../../outputs/verification/full-audit-a01-a11-20261008/ui/work-preferences-metadata-after-local-tests.json) did **not** mount React and did not detect the next effect failure. The new projection allocated a baseline object every time an effect depending on that baseline ran. Actual input repeatedly reverted to the earlier B value before save. This failed iteration and the earlier tests' limited scope are preserved in the [reconciliation before receipt](../../outputs/verification/full-audit-a01-a11-20261008/ui/work-preferences-reconciliation-before.json).

The final synchronization uses functional setters that retain the previous object when all five editable fields are equal. Accepted saves update the own résumé's cache and revision before clean state; an accepted-revision guard rejects older props, and a delayed success cannot downgrade a newer cache row. A later local edit remains dirty. Explicit recovery uses the same guard. The existing no-store preflight, editable-baseline conflict comparison and latest CAS revision remain in place. The [five-case local receipt](../../outputs/verification/full-audit-a01-a11-20261008/ui/work-preferences-reconciliation-after-local-tests.json) covers stable references across twenty equal-data updates, the actual QueryClient/QueryObserver cache, stale/newer revision order and the strict request contract. These are helper/cache tests; actual React input behavior is established separately below.

Root's [final actual two-tab receipt](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/work-preferences-two-tabs-final.json) is PASS on UI4384 with backend c19, PID47020, using owned isolated actor 1 / résumé 1 after source freeze. A's «Казань · черновик A3» survives the conflict; conscious recovery displays «Казань · вкладка B3» and preserves the other About draft. A new location after recovery saves successfully, followed by «Гибкий график» through the top sticky save. The original About value was locally restored before that shared save. Collected errors are empty.

At `scrollY=4262`, both actions have measured `y=72` and height 36: «Сохранить изменения» at x813.156 and «Создать резюме» at x1007.469. Save is to the left; the consultant is absent during this editing action. Create was disabled in that measurement, so it proves placement/visibility rather than availability of creating another résumé. The conflict in this particular live scenario is detected by the **client's fresh GET preflight**; it does not prove that a server PATCH409 occurred. Server revision/CAS behavior belongs to the separate core tests. A temporary source hot refresh reset the owned QA preferences editor during development; the final scenario was repeated after freeze rather than treating that refresh as user-state preservation.

### Current owner document preview

The [owner-preview receipt](../../outputs/verification/full-audit-a01-a11-20261008/ui/browser/owner-document-preview-current.json) records résumé model load, an actual one-page PDF canvas, no consultant in the modal, contacts deselected in the composition control and portfolio disabled. It covers this owned document and these UI controls; it does not independently certify every export's redaction, every audience, or all PDF content. No document-export styling changed in these final corrections.
