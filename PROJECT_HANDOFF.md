# Urban Member Care — revision checkpoint

Updated 28 October 2026 (Australia/Brisbane). Read this before rediscovering the project. This is a saved starting point; verify live deployment or data only when needed for the requested change.

## Locations and delivery

- Source repository: this `public-site` folder; GitHub `urbanmuaythai/urban-retention-intelligence`.
- Source branch: `codex/coach-outreach`. Latest feature commit: `08ed3e7` (cloud trigger preparation and cancellation history). Earlier feature commits remain in Git history.
- Source app: `coach-app`, Vite + vanilla JavaScript. Use existing dependencies and lockfile.
- Live app: https://urbanmuaythai.github.io/urban-retention-intelligence/member-care/
- Deployment: sibling folder `../member-care-publish`, detached checkout of Pages `main`; latest verified published commit `12175bef4c07992dec5633fe2b74016c1ba1a739`.
- Root report `index.html` is separate from Member Care. App revisions normally change only source app paths and the published `member-care/` directory.
- Supabase project reference: `uzbcsgjocpxhidjaduct`; approved administrator: getfit@urbanmuaythai.com. There is no default password.
- Production client settings already exist in local `coach-app/.env.local`; do not print or commit them. Never put service-role keys in the frontend.

## Current behavior

Urban branding uses navy, red and gold. UI name is Urban Member Care, with team/staff wording. Internal legacy role `coach` and folder `coach-app` remain intentional.

Approved staff login protects member records. Notes are append-only and remain attached to stable `clubworx:<Contact ID>` identities across imports. Handled/exempt outcomes temporarily suppress outreach, then expire; notes remain. Reimporting does not reset staff history or exemptions.

Risk priorities remain Red / Yellow / Watch / Review. Attendance stages are separate: Early warning, At risk, Disengaged (3–4 zero observations), Long absence (5–6), Extended absence (7+), Monitoring and Needs context. An attendance-stage filter is available. Seven prior snapshots plus the current one supply eight observations; drop averages still use the latest five prior slots. Missing or suspension/ineligibility-masked slots interrupt zero streaks. Archived summaries are observations, not proof of exact daily absence. Each bar supports hover, keyboard focus and tap with original date/count and current risk explanation; viewing attendance preserves drafts.

Direct CSV import accepts Attendance, Active memberships, Suspensions and Cancellations together. It detects schemas by headers, checks IDs/counts/coverage/cutoffs, excludes suspended/ineligible plans and tour-payment products, and automatically prepares a preview. Changing dates/targets requires rechecking. One review/save step remains. Actual data-as-of date is separate from Monday report week. Full eligible snapshots include healthy members, enabling later comparisons. Individual attendance-event CSV import is not implemented.

Initial verified live checkpoint: report week 26 October, data as of 27 October; 269 risk/review cases, 267 unsuppressed, two notes/exemptions. Priorities: 88 Red, 81 Yellow, 44 Watch, 56 Review. Sixteen private archived baseline weeks are available. These are checkpoint values, not permanent expected counts.

## Automatic Drive pickup

The active desktop heartbeat is `sync-clubworx-exports-to-member-care`. Saved schedule verified 28 October: Monday and Friday at 09:00 Brisbane. Earlier 30-minute descriptions were incorrect; do not repeat them. It requires this computer, Codex and connected Drive/Supabase tools to remain available. It is not an independent cloud worker and does not click Clubworx Export.

Verified folder: https://drive.google.com/drive/folders/1e4X24ykUscsd67u4Uzp_qXx7dD8e3Li_

Follow `scripts/DRIVE_MEMBER_CARE.md`; use the tested `scripts/drive-member-care.mjs` runner and its exported context query. Configured report IDs: 246526 attendance, 246527 active, 246528 cancellations, 246529 suspensions. Require four fresh same-day source exports within 30 minutes; skip duplicates and hold incomplete batches. New plan targets require review. Routine unchanged checks read metadata only. Ready batches use the existing transactional admin RPC with history-version guards and note-hash preservation. The initial Drive import matched all 269 reviewed cases; a repeat preparation returned unchanged. Automation imports include private source hashes and file IDs in `import_summary.driveSync`.

## Code map

- `coach-app/src/main.js`, `style.css`: UI and branding.
- `attendance-stage.js`: stage derivation; `attendance-ui.js`: tooltips and explanations.
- `csv-import.js`: CSV validation, classification and complete-cohort conversion.
- `history.js`: eight-observation window and verified archive/engagement fallback.
- `import-dialog.js`: upload, automatic preview, review and save.
- `store.js`: Supabase reads/RPC writes, shared refresh and authentication integration.
- `domain.js`: dispositions, suppression and validation.
- `supabase/migrations/`: existing schema/RPC/RLS definitions; inspect current schema before database changes. Most UI revisions need no migration or live data edits.
- `coach-app/CSV_IMPORT.md`: import rules and limitations.
- `scripts/prepare_attendance_baselines.py`: private historical matching helper.

## Focused verification and publishing

Last verified: 48 automated tests passed, production build passed, local and hosted mobile CSV browser workflow passed with mocked Supabase (no test member writes to live storage).

For code changes, run `npm test` in `coach-app`, then the production build as appropriate. For import/UI interactions use `npm run test:browser-csv` against a preview on port 5174. Supply `CSV_TEST_URL` for hosted verification. Documentation-only changes do not require rebuilding or rerunning app tests. Avoid repeated broad testing after the relevant checks pass.

Production build in PowerShell, from `coach-app`:

```powershell
$env:VITE_ENABLE_DEMO = 'false'
npm run build -- --base=/urban-retention-intelligence/member-care/
Remove-Item Env:VITE_ENABLE_DEMO
```

Preview with `npm run preview -- --port 5174 --base=/urban-retention-intelligence/member-care/`. Stop only the preview process created for your verification; do not stop a user-owned server.

When publication is requested/authorised, refresh the sibling publish checkout from origin/main; copy only dist/index.html and dist/assets into its member-care directory, retaining previous hashed assets; update member-care/DEPLOYMENT.md. Commit and push HEAD:main, confirm Pages status built, then verify the hosted change. A local source commit alone does not publish. Keep production demo access disabled. GitHub CLI's default getapis account has read-only access; authorised pushes have used the existing urbanmuaythai account's ephemeral token in GH_TOKEN, restoring the prior environment afterward. Never log the token.

## Existing unrelated working-tree changes

At this checkpoint, .gitignore, coach-app/README.md and root index.html had pre-existing uncommitted changes. Untracked legacy helpers/bootstrap files also existed: scripts/make_identity_map.py, scripts/test_identity_map.py, supabase/bootstrap_admin.sql and supabase/migrations/20261026075534_restrict_anonymous_rpc.sql. Preserve them; do not stage them as part of an unrelated revision. The last migration's anonymous-RPC restriction was already applied live earlier; do not blindly reapply it.

Private CSVs, matching audits, backups and generated imports are outside this Git checkout in the parent workspace. Never copy those into published assets or commits.


## Weekly Reporting tab (28 October 2026)

`coach-app/src/reporting.js` derives read-only weekly counts from already-authorised weekly_risks and outreach_events in the store; no database schema changes or data writes. Each member counts once per saved report week. Contacted means at least one Contacted or Session booked outcome assigned to that report week. Notes-only, Handled-only and Exempt-only do not count as contact. Previous-week contact does not carry forward; a later reopen does not erase contact evidence. All flagged cases, including exemptions, are in the denominator. Exemptions remain a separate potentially overlapping count. No cohort shows no percentage. Reports use the latest saved report per week; reimports may change cohorts, and attendance-only archives cannot supply historical contact totals.

The sidebar Reporting tab shows Red flagged/contacted/no-contact/coverage cards, all-priority breakdown and selectable week-by-week history. View Red outreach opens that week's full Red list. Tests cover deduplication, week isolation, exemptions, reopen and empty cohorts, plus mobile navigation, table counts and the report-week selector. Most recent check: 52 automated tests and the local/hosted browser workflow. Continue to stage only explicit revision files.


## Portal and weekly operations (28 October 2026)

Login now opens a separate full-screen staff portal, with exactly three choices: At Risk Members, Cancellations and Suspensions. Daily Numbers was explicitly removed by the user. The portal uses the supplied Downloads photo `clinch workshop followed by sparring.jpg`, copied unchanged into `coach-app/src/assets/urban-gym-community.jpg`, with a CSS overlay. Inside At Risk Members, weekly outreach, follow-ups, Handled & exempt, All risk members and Reporting stay together. Cancellation/suspension areas have their own module navigation and Back to portal controls. The sample portal remains explicitly fictional.

`coach-app/src/operations.js` builds minimal private week-scoped details and renders the portal/operations screens. Four-CSV imports now retain only cancellation rows whose effective end or recorded cancellation date falls Monday through the export cutoff, and suspension periods overlapping that window. Duplicate identical suspension intervals collapse. The membership-ending KPI excludes rollovers, tour products and previously approved private administrative debt-cleanup membership IDs. Recorded notices and effective ends are distinct; people and membership records have separately labelled counts. Missing detailed imports or missing approved policy show unavailable/review states, never invented zero totals. Current suspension source coverage can differ from eligible training holds.

Private `import_summary.retentionPolicy` carries the existing nine-ID cancellation_adjustments.json policy forward through later CSV imports. These real IDs are never in source assets. `import_summary.operations` is protected by the existing weekly_reports approved-staff RLS. The live week of 26 October, as of 27 October, was enriched from the hash-matched existing four-file Drive batch; risk rows and notes were not modified. No schema migration was needed. The current source had one week-relevant cancellation source row and 44 suspension periods; these are dated checkpoint values, not fixed expected totals. Browser checks cover portal separation, three choices/no Daily Numbers, grouped navigation, private-policy gating, positive cancellation rendering, report navigation and mobile/desktop screenshots. Unit/integration count: 56.


## Friday–Thursday operations calendar (28 October 2026)

Cancellations and Suspensions now use inclusive Friday–Thursday periods in Australia/Brisbane, independent of At Risk Members' Monday week key. Version 2 import_summary.operations stores a dated period catalog, rebuilding the current source period plus the previous completed period from the full CSVs. Same-Monday imports preserve prior Friday-period snapshots so a Friday rollover does not erase Thursday's report. Display deduplicates identical period keys across Monday reports using the latest source date/version. Source export date, records-through cutoff, complete/partial status and explicit Fri–Thu range are shown. The separate period selector does not change the risk report week. The default period contains the selected Monday risk week (Friday before Monday through Thursday), so a Friday export defaults to the just-completed Thursday period while the new Friday period remains selectable.

Version 1 Monday-only operations data is rejected as unavailable rather than relabelled. The saved 26 October / as-of-27 October record was rebuilt from the hash-matched full Drive batch into Fri 23–Thu 29 October (partial through 27 October) plus Fri 16–Thu 22 October. Risk rows and staff notes remain untouched. Current-source Friday coverage includes 49 suspension periods instead of the earlier Monday-window 44; these are source-period records, not unique-person or active-at-cutoff counts. Tests cover Friday/Sunday/Thursday boundaries, future cutoffs, rollover preservation, deduplication, Friday default selection and legacy refusal. Most recent automated count: 59.

Weekly operating recommendation: export all four configured Clubworx reports together after the last Thursday class, including zero-attendance members and historical cancellation/suspension rows needed for date filtering. All four should be generated within 30 minutes; this is a source-batch matching limit, NOT the automation cadence. The desktop fallback checks Monday and Friday at 09:00 Brisbane, with the existing desktop availability requirement. The Friday check picks up a Thursday-night batch. Staff still need to click Export or configure Clubworx recurring delivery separately; the Codex sync does not itself export Clubworx reports.


## Cloud trigger and cancellation archive (28 October 2026)

The user requested replacing Codex scheduling with a trigger. Supabase endpoint `clubworx-drive-import` is deployed and authenticated, but **Google Apps Script is not installed/authorised yet**. Keep the existing Codex fallback active at Monday/Friday 09:00 Brisbane until the user authorises the Google script and confirms its two triggers. The connected browser automation could not initialise (kernel assets path error); connected Drive tools cannot install Apps Script projects. Do not claim the Google schedule is active or disable the fallback prematurely.

Ready-to-install source: `scripts/member-care-trigger.gs`; step-by-step activation: `scripts/CLOUD_MEMBER_CARE.md`. Account getfit@urbanmuaythai.com. The private integration token is outside Git in `../member-care-trigger-activation.private.json`; put only its token value in the Google project's `MEMBER_CARE_TOKEN` Script property. Never print, publish or commit this token. No service key is given to Google or the browser. Google triggers check the folder Monday/Friday around 09:00 Brisbane (nearMinute timing +/-15 minutes). Export all four before the check; this does not generate Clubworx exports or watch Drive instantaneously. Installation tests a successful unchanged/imported receipt before creating triggers, replaces only its own triggers and retains unrelated ones. Repeated incomplete checks eventually fail visibly. Google authorisation is the remaining activation step.

Backend: migration `20261028041756_cloud_drive_ingestion.sql` applied; server-only hash/config table `member_care_integrations` with RLS and no anon/staff grants; service-only SECURITY INVOKER context/import RPCs. `coach-app/src/drive-import.js` shares the existing validator with Node's `scripts/drive-member-care.mjs`. `cloud-drive.js` authenticates and prepares imports. `scripts/deploy-cloud-member-care.mjs` collects the Edge entrypoint and shared dependencies for deployment; `verify_jwt=false` uses mandatory custom bearer authentication. The guarded RPC checks report versions under table/advisory locks and verifies existing outreach records after the existing transactional import. History, approved targets and exclusions carry forward; new plan targets require manual review. Five MB cloud batch limit. Modern server secret-key env preferred, legacy runtime key fallback; none in client code.

Verified live: bad token 401; current saved batch 200 unchanged; copied source with synthetic fresh timestamps converts then skips identical content/cutoff; stale-version server RPC rejects and rolls back. Anonymous/staff cannot execute cloud RPCs or read integration configuration. Risks269 and notes2 unchanged. Security advisor added only expected informational RLS-with-no-policy on the server-only config; existing four intentional staff SECURITY DEFINER warnings and leaked-password setting remain. Google execution is still unverified until user activation.

Cancellations now show selected Fri–Thu period, previous period, complete-period change, weekly history and future scheduled ends from the latest export separately. Each import backfills up to12 dated periods, deduplicates by latest source per period and preserves older saved reports. Earlier dates without source records are not invented zeros; the first available period is labelled with its source start. Future entries can be later in the current partial week and are never counted as completed ends before cutoff. Historical totals reflect latest available source corrections, not immutable original snapshots. Upcoming list uses latest source only and never falls back to stale future entries. Suspension history is not expanded from the cancellation archive.

The current 27 October source was SHA-256 matched against all four saved Drive files; only `weekly_reports.import_summary.operations` was backfilled using an imported_at guard (no risk/member/note edits). Ten available cancellation periods start21August (first source end24August), latest23–29October partialthrough27October count1; prior16–22October count17; scheduledfuture9. Existing risks269/notes2 preserved.

Verification:65 automated tests plus production build and mobile CSV/portal/history/future/navigation browser workflow with mocked Supabase, no live test member writes. Google installer tested with mocked Google services for successful preflight, MO/FR timezone, repeat-safe installation, incomplete-batch refusal and retaining other triggers.


Release verification follow-up: Pages commit12175bef4c07992dec5633fe2b74016c1ba1a739 is built and the hosted production browser workflow passed. Source feature commit08ed3e7 is saved locally. A cloud dry-run with copied exports, explicitly synthetic newer timestamps and harmless trailing newlines, returned validated269 without database writes; the actual saved batch still returns unchanged. Use `scripts/member-care-appsscript.json` during Google setup for explicit read-only Drive, external-request and trigger-management scopes. Installation and actual Google execution remain pending.

The user has created Apps Script project `1usjYskQJNjak8XrnYTnWe2EML_fuo9yrbtY4aiezSdueBIhnJPF85VtY`; its editor link is in the cloud setup guide. Browser control still fails to initialise, so exact code and manifest were supplied in chat for the user to paste. Do not infer successful trigger installation solely from acknowledgement of the code. Confirm the install success message and two Google triggers before disabling the existing Codex fallback. On the request to commit live, Pages was rechecked built at12175be and the authenticated cloud endpoint returned200 unchanged for the actual saved batch.
