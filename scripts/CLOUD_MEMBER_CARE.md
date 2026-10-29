# Google trigger for Member Care

Activation confirmed by the user on 28 October 2026: the installer succeeded and the two Google triggers are listed. The Codex fallback `sync-clubworx-exports-to-member-care` is now **PAUSED**, verified through the app automation tool and saved configuration. The setup steps below are retained for maintenance or reinstalling; do not create duplicate projects or schedules.

The installed Google Apps Script runs independently of this computer. It checks the verified Clubworx Exports folder every 30 minutes (since 28 October 2026; previously Monday and Friday around 09:00 Brisbane). A batch already sent stops before uploading (`MEMBER_CARE_LAST_BATCH`). This is a scheduled folder check, not an instant Drive file-created event. It does not generate Clubworx exports: all four reports must already arrive through the existing export workflow before the check.

## One-time activation (getfit@urbanmuaythai.com)

1. Open the [existing Urban Member Care Apps Script project](https://script.google.com/d/1usjYskQJNjak8XrnYTnWe2EML_fuo9yrbtY4aiezSdueBIhnJPF85VtY/edit) in the gym Google account. The user has already created this project; do not create a duplicate.
2. Replace `Code.gs` with the complete contents of `scripts/member-care-trigger.gs` and save.
3. In Project Settings, turn on **Show appsscript.json manifest file in editor**. Open that file and replace it with `scripts/member-care-appsscript.json`. This limits Drive permission to reading; the other two permissions allow the Member Care request and your two triggers.
4. Open Project Settings > Script properties. Add `MEMBER_CARE_TOKEN` using only the `token` value from `../member-care-trigger-activation.private.json` outside this repository. This is an integration token, not a Supabase service key. Keep the project restricted to authorised administrators; project editors can read script properties.
5. Select **installMemberCareTriggers** and click **Run**. Review and approve Google's requested access. It reads the export folder, calls Member Care, and creates two triggers. The installer tests the sync first; it will refuse installation if the four reports are incomplete or validation fails.
6. In **Executions**, confirm an `unchanged` or `imported` receipt, and in **Triggers** confirm exactly one `syncMemberCare` trigger (every 30 minutes). Then disable the Codex heartbeat `sync-clubworx-exports-to-member-care`. Until these checks succeed, retain the existing fallback.

No web app deployment or public Google sharing is needed. Google's trigger failure notifications identify required attention; no member messages are sent. `MEMBER_CARE_LAST_CHECK` stores a status/count-only receipt. Missing batches wait; a batch incomplete for more than four days fails visibly. Errors do not advance any import checkpoint.

## Server implementation and safeguards

Supabase Edge Function `clubworx-drive-import` authenticates a high-entropy bearer token against a server-only SHA-256 hash before parsing source data. No service key is stored in Apps Script or the browser. Five MB total request limit. Shared `coach-app/src/drive-import.js` and CSV converter enforce stable IDs, schemas, source cutoffs, four configured report IDs, freshness, new-plan target review, historical attendance, approved retention exclusions and content idempotency. Supabase retains staff notes and exemptions. RPC `import_clubworx_drive_batch` is service-role-only and atomically checks report versions, locks imports, delegates to the existing approved administrator and verifies old outreach records were unchanged.

Only hash/configuration are stored in `member_care_integrations`; approved browser staff and anonymous callers cannot access it. To disable the endpoint set `enabled=false`. To rotate the integration token, generate a new random token, replace its SHA-256 hash server-side and update the private Script property. Never commit tokens, CSVs or private activation files.

Function source: `supabase/functions/clubworx-drive-import/index.ts`. Deployment includes the shared JS modules under `shared/`; `scripts/deploy-cloud-member-care.mjs` prepares that bundle. Gateway JWT verification is disabled for this custom-authenticated webhook; the integration token remains mandatory.

## Cancellation reporting

Cancellation reports use Friday–Thursday membership **effective end dates**, excluding approved administrative debt cleanup, rollovers and tour-payment plans. Each import backfills up to 12 dated cancellation periods and preserves saved older periods across report weeks. The selected week and prior week are separate; change is shown only for two complete periods. Upcoming scheduled ends are labelled separately using the newest export, including dates later in the current partial period. They are not added to completed cancellations. Historical figures reflect the latest available dated records and may change after source corrections; they are not immutable audit snapshots. Periods earlier than the earliest dated cancellation record are not presented as zero; the first source period is labelled with its available source date. Suspension history remains limited to periods actually retained, not invented from the cancellation archive.

Official timing reference: https://developers.google.com/apps-script/reference/script/clock-trigger-builder#nearMinute(Integer)
