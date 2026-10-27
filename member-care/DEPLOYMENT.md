# Urban Member Care hosting

Production entry: https://urbanmuaythai.github.io/urban-retention-intelligence/member-care/

Published from the existing app source on branch `codex/coach-outreach`, commit `a060e4f292a060baa9bf22e964fd800f03bfafcb`.

Build from `coach-app` using Node 22 or later and the locked dependencies:

```powershell
npm ci
npm test
$env:VITE_ENABLE_DEMO = 'false'
npm run build -- --base=/urban-retention-intelligence/member-care/
Remove-Item Env:VITE_ENABLE_DEMO
```

The build requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These are public client configuration, with private access enforced by Supabase Auth, approved staff records and row-level security. Never provide a secret/service-role key to Vite.

Copy only the resulting `dist` contents into this `member-care` folder on the Pages `main` branch. Keep this deployment note. Commit and push to publish. The root report `index.html` is independent and must remain unchanged. Do not copy raw CSVs, private JSON imports, notes, local environment files or source maps into the published folder.

The hosted release supports four-CSV import with an explicit review before saving, stable Contact IDs, complete weekly attendance snapshots and a separate Review category for missing historical/engagement context. Prepared JSON remains under Advanced. Migration `20261027010958_csv_weekly_import.sql` is applied to the connected Supabase project. The database had no member/report records at this release; no supplied member data was auto-imported. Staff sign in using their existing Supabase credentials. See `coach-app/CSV_IMPORT.md` on the source branch for rules, limitations and verification.

Supabase Auth password-reset redirects must allow the exact hosted app URL with `?flow=recovery`. Hosted reset-email delivery and an authenticated cross-device note save require verification with an authorised staff session.

Cutoff correction: a Monday report-week key is distinct from the actual export date. Data as of 27 October 2026 can belong to the week beginning 26 October. Eligibility and rolling attendance use the actual cutoff, history comparisons use cutoffs seven days apart, and validation failures are focused at the top of the import dialog. Migration `20261027012401_csv_export_cutoff.sql` is applied.

Historical summaries: the staff app reads identity-reviewed attendance_baselines from protected Supabase storage and reuses them during later CSV imports. Original weekly dates are visible; archived cutoffs within one day are a labelled fallback. Recent verified engagement context expires after 14 days and must match the membership family. Migration `20261027020548_attendance_baselines.sql` is applied. Private source archives, matching audits, backups and generated member payloads are excluded from this build.

Attendance inspection: bars support hover, keyboard focus and tap with a top-layer tooltip showing the original snapshot date, session count and current risk explanation. The member card also shows a plain-language reason. Missing observations stay unknown, and inspecting a bar does not save or alter notes. Verified with unit tests and mobile browser interaction, including preserving a typed draft.


Attendance stages: eight dated weekly observations now support Early warning, At risk, Disengaged, Long absence and Extended absence, with Monitoring and Needs context for other cases. A separate stage filter complements risk priority. Null history breaks zero runs; archived snapshots are labelled observations. Current report history was expanded in a guarded transaction for 269 cases with unchanged priorities/current counts and both existing outreach events verified unchanged. Unit/integration tests: 44 passed. Mobile browser tests cover Extended absence, filtering, tooltip interactions and preserving draft notes.
