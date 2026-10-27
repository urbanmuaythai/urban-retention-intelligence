# Weekly Clubworx CSV import

Administrators can select the four Clubworx CSV exports directly in **Import week**. Conversion to the existing version 1 JSON payload happens inside the browser; there is no separate conversion task for staff. Prepared JSON remains under Advanced for legacy workflows.

1. Export Attendance, Active Memberships, Suspensions and Cancellations together, for the same Monday cutoff. Attendance must include zero-attendance members. Keep the validated UMC column names.
2. Select all four files together. Types are detected by their headers, independently of selection order. Known date suffixes must agree with the selected cutoff.
3. Review weekly targets. Unlimited memberships default to four sessions; fixed recurring weekly limits supply initial defaults. Package class credits do not supply a weekly target. A person with multiple eligible memberships uses the highest configured goal, rather than summing plan allowances. Saved targets prefill the next import.
4. Choose **Check files & preview**. Check the date, eligible cohort, held suspensions, excluded products and future starts. Review the first 20 members, ordered by priority.
5. Tick the review acknowledgement, then choose **Import reviewed week**. Only the final confirmation writes the reviewed snapshot to Supabase.

## Source checks

Four files are required. Each file is limited to 10 MB and 50,000 rows; the saved eligible snapshot and risk list are each limited to 5,000 people. The parser handles quoted commas/newlines, escaped quotes, UTF-8 BOM and Windows line endings. Cells are treated as text, never formulas or instructions.

Contact IDs must be populated. Membership IDs must be unique within each membership-based export. The attendance and active exports must match on people, membership IDs and membership names. Repeated person rows must have identical seven-day and thirty-day totals, which are counted once. Conflicting names for a Contact ID, missing coverage, invalid dates/counts and incompatible schemas stop the import before any write.

Training eligibility checks membership activity, start/expiry and status. Thailand Tour Deposit and Thailand Tour Final Payment are excluded products, while an independent eligible training membership for the same contact is retained. Current suspensions are determined from the selected cutoff and start/end dates; contacts whose eligible memberships are all marked Suspended are held even if no current date interval appears.

The cancellation file is validated and source counts are included in the private import summary. Raw cancellation rows are not saved. The preview's effective cancellation count is before the full Retention Intelligence report's date window and administrative bad-debt exclusions. This feature does not replace that report or publish a cancellation KPI.

## Risk evidence and history

Existing Red / Yellow / Watch rules keep their first-match ordering. CSV imports use complete eligible attendance snapshots from preceding weeks, keyed by `clubworx:<Contact ID>`, with up to five preceding weekly slots. Missing weeks stay null, and a missing intervening week interrupts a consecutive-zero streak. Reimports ignore the existing same-week snapshot and future snapshots during classification.

The four sample exports omit the source sheet's Engagement label. The converter does not infer Fringe. An optional `Engagement` column, if supplied, permits the existing Fringe slide and Watch rules. Below-target attendance without that label is **Review**, rather than Watch. Zero-attendance members without enough weekly evidence for Red/Yellow are also **Review**. Review is an operational request for missing context, not an additional inferred retention severity.

The first CSV cohort can be wider than the older tracked attendance cohort. Counts therefore need not match the published historical report. Earlier weekly attendance cannot be recovered from a single seven-day/thirty-day pair. Each confirmed CSV import saves all eligible attendance counts, including people with no risk signal, so next week's trends can include previously healthy members.

## Storage and access

The reviewed risk payload, complete eligible attendance snapshot, weekly targets and count summary are saved through the administrator-only transactional RPC. Existing report RLS, approved-staff access, append-only notes and temporary exemptions are preserved. Importing a week does not delete member identities or notes. A week with no risk/review members can still save a complete nonempty attendance snapshot.

Complete attendance snapshots live in `weekly_reports.attendance_snapshot`; import summaries and target settings live in `weekly_reports.import_summary`. Those fields are available only to approved staff. Raw CSV files and private source rows must never be committed or placed in the static hosting directory. The JSON path cannot replace an existing complete CSV snapshot without supplying the attendance snapshot as well. Provisional `name-v1:` identities must be reconciled before CSV imports are allowed.

Changing the files, cutoff or targets invalidates the accepted preview. The importer requires a fresh review before saving. Earlier report replacements do not recalculate already-saved later reports; reimport affected later weeks explicitly if a historical correction changes their evidence.

## Verification

`npm test` covers CSV parsing, identity/coverage errors, dates, counts, eligibility, suspension holds, targets, missing-history handling, trend rules, complete snapshots, zero-risk imports, transactional rollback, authorization and note preservation. `npm run test:browser-csv` checks the production picker, review acknowledgement, stale-preview invalidation, mobile layout, RPC payload and Review filter against mocked Supabase HTTP responses. It does not send the supplied member samples to the live database.
