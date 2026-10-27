# Urban Member Care hosting

Production entry: https://urbanmuaythai.github.io/urban-retention-intelligence/member-care/

Published from the existing app source on branch `codex/coach-outreach`, commit `93b9a31b505f47cdc4554c896758146a936b7d55`.

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
