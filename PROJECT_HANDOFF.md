# Urban Member Care — revision checkpoint

Updated 27 October 2026 (Australia/Brisbane). Read this before rediscovering the project. This is a saved starting point; verify live deployment or data only when needed for the requested change.

## Locations and delivery

- Source repository: this `public-site` folder; GitHub `urbanmuaythai/urban-retention-intelligence`.
- Source branch: `codex/coach-outreach`. Latest feature commits: `a060e4f` (attendance stages), `e8ed838` (Drive sync and automatic CSV preview), `2afcb60` (metadata-only routine checks).
- Source app: `coach-app`, Vite + vanilla JavaScript. Use existing dependencies and lockfile.
- Live app: https://urbanmuaythai.github.io/urban-retention-intelligence/member-care/
- Deployment: sibling folder `../member-care-publish`, detached checkout of Pages `main`; latest verified published commit `efbe5b819c4413794cf67306ede7ee8fe0d6cc2b`.
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

The active desktop heartbeat is `sync-clubworx-exports-to-member-care`. Saved schedule verified 28 October: daily at 09:00 Brisbane (all seven days). Earlier 30-minute descriptions were incorrect; do not repeat them. It requires this computer, Codex and connected Drive/Supabase tools to remain available. It is not an independent cloud worker and does not click Clubworx Export.

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

Weekly operating recommendation: export all four configured Clubworx reports together after the last Thursday class, including zero-attendance members and historical cancellation/suspension rows needed for date filtering. All four should be generated within 30 minutes; this is a source-batch matching limit, NOT the automation cadence. Actual pickup is daily at 09:00 Brisbane, with the existing desktop availability requirement. The Friday check picks up a Thursday-night batch. Staff still need to click Export or configure Clubworx recurring delivery separately; the Codex sync does not itself export Clubworx reports.
