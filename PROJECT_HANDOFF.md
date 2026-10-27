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

The active desktop heartbeat is `sync-clubworx-exports-to-member-care`, every 30 minutes. It requires this computer, Codex and connected Drive/Supabase tools to remain available. It is not an independent cloud worker and does not click Clubworx Export.

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
