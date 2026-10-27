# Weekly Clubworx CSV import

Administrators can select the four Clubworx CSV exports directly in **Import week**. Conversion to the existing version 1 JSON payload happens inside the browser; there is no separate conversion task for staff. Prepared JSON remains under Advanced for legacy workflows.

1. Export Attendance, Active Memberships, Suspensions and Cancellations together, for the same actual export date. The report is grouped under the Monday of that week; a Tuesday export keeps Tuesday as its data-as-of date. Attendance must include zero-attendance members. Keep the validated UMC column names.
2. Select all four files together. Types are detected by their headers, independently of selection order. Known date suffixes must agree with the selected cutoff.
3. Review weekly targets. Unlimited memberships default to four sessions; fixed recurring weekly limits supply initial defaults. Package class credits do not supply a weekly target. A person with multiple eligible memberships uses the highest configured goal, rather than summing plan allowances. Saved targets prefill the next import.
4. Choose **Check files & preview**. Check both the Monday report week and the actual data-as-of date, eligible cohort, held suspensions, excluded products and future starts. Review the first 20 members, ordered by priority.
5. Tick the review acknowledgement, then choose **Import reviewed week**. Only the final confirmation writes the reviewed snapshot to Supabase.

## Source checks

Four files are required. Each file is limited to 10 MB and 50,000 rows; the saved eligible snapshot and risk list are each limited to 5,000 people. The parser handles quoted commas/newlines, escaped quotes, UTF-8 BOM and Windows line endings. Cells are treated as text, never formulas or instructions.

Contact IDs must be populated. Membership IDs must be unique within each membership-based export. The attendance and active exports must match on people, membership IDs and membership names. Repeated person rows must have identical seven-day and thirty-day totals, which are counted once. Conflicting names for a Contact ID, missing coverage, invalid dates/counts and incompatible schemas stop the import before any write.

Training eligibility checks membership activity, start/expiry and status. Thailand Tour Deposit and Thailand Tour Final Payment are excluded products, while an independent eligible training membership for the same contact is retained. Current suspensions are determined from the selected cutoff and start/end dates; contacts whose eligible memberships are all marked Suspended are held even if no current date interval appears.

The cancellation file is validated and source counts are included in the private import summary. Raw cancellation rows are not saved. The preview's effective cancellation count is before the full Retention Intelligence report's date window and administrative bad-debt exclusions. This feature does not replace that report or publish a cancellation KPI.

## Risk evidence and history

Existing Red / Yellow / Watch rules keep their first-match ordering. CSV imports use complete eligible attendance snapshots from preceding weeks, keyed by `clubworx:<Contact ID>`, with up to five preceding weekly slots. Exact cutoffs seven days apart are preferred. Identity-reviewed archived Monday summaries can provide a separately labelled fallback when their cutoff differs by at most one day. Their original dates stay visible on the history bars; repeated-zero signals refer to weekly observations rather than claiming uninterrupted daily absence. Larger date mismatches remain unknown. Legacy operational snapshots without an explicit cutoff use their report date. Missing weeks stay null, and a missing intervening week interrupts a consecutive-zero streak. Reimports ignore the existing same-week snapshot and future snapshots during classification.

The four sample exports omit the source sheet's Engagement label. The converter does not infer Fringe. It can recover a verified archived engagement label from the previous 14 days when the member ID and membership family match; stale or mismatched labels are not reused. An optional `Engagement` column, if supplied, permits the existing Fringe slide and Watch rules. Below-target attendance without that label is **Review**, rather than Watch. Zero-attendance members without enough weekly evidence for Red/Yellow are also **Review**. Review is an operational request for missing context, not an additional inferred retention severity.

The first CSV cohort can be wider than the older tracked attendance cohort. Counts therefore need not match the published historical report. Earlier weekly attendance cannot be recovered from a single seven-day/thirty-day pair. Each confirmed CSV import saves all eligible attendance counts, including people with no risk signal, so next week's trends can include previously healthy members.

## Storage and access

The reviewed risk payload, complete eligible attendance snapshot, weekly targets and count summary are saved through the administrator-only transactional RPC. Existing report RLS, approved-staff access, append-only notes and temporary exemptions are preserved. Importing a week does not delete member identities or notes. A fresh export during the same week replaces that week’s snapshot after review and records its new data-as-of date in the summary; the Monday grouping key stays the same. A week with no risk/review members can still save a complete nonempty attendance snapshot.

Complete attendance snapshots live in `weekly_reports.attendance_snapshot`; import summaries and target settings live in `weekly_reports.import_summary`. Those fields are available only to approved staff. Raw CSV files and private source rows must never be committed or placed in the static hosting directory. The JSON path cannot replace an existing complete CSV snapshot without supplying the attendance snapshot as well. Provisional `name-v1:` identities must be reconciled before CSV imports are allowed.

The data-as-of date must fall within the Monday report week and cannot be in the future. Attendance after that actual cutoff is still rejected, with the affected Contact ID and date shown. Validation errors appear at the top of the dialog and receive focus; the disabled save action explains that the issue must be resolved.

Changing the files, cutoff or targets invalidates the accepted preview. The importer requires a fresh review before saving. Earlier report replacements do not recalculate already-saved later reports; reimport affected later weeks explicitly if a historical correction changes their evidence.

## Verification

`npm test` covers CSV parsing, identity/coverage errors, dates, counts, eligibility, suspension holds, targets, missing-history handling, trend rules, complete snapshots, zero-risk imports, transactional rollback, authorization and note preservation. `npm run test:browser-csv` checks the production picker, review acknowledgement, stale-preview invalidation, mobile layout, RPC payload and Review filter against mocked Supabase HTTP responses. It does not send the supplied member samples to the live database.

## Archived weekly-summary sync

`attendance_baselines` holds identity-reviewed archived observations separately from operational report weeks. Approved staff can read this table; browser clients cannot write it. The table is protected by RLS and anonymous access is revoked. Its snapshot records contain stable member IDs, counts and source context; source hashes and original dates provide an audit trail. Current CSV imports load these shared baselines automatically, so a later upload does not discard the recovered history.

The preparation helper `scripts/prepare_attendance_baselines.py` joins historical names to the current Contact ID roster only when the normalized name identifies one contact. Where both sources provide phone numbers, they must agree after normalization; conflicts and ambiguous identities are withheld. Name-only matches are explicitly counted in the private audit. Historical duplicate membership rows use the maximum weekly count, matching the established builder, and are never summed.

Archive-backed comparisons also check available suspension intervals and current membership start dates. Overlapping paused windows and incomplete first membership weeks remain unknown rather than becoming false zero streaks. A recent same-week archived snapshot can supply verified engagement context, but does not replace today's attendance counts or masquerade as a preceding week.

These are weekly summary observations, not individual attendance events. The proposed attendance-event export is still needed for a full per-session timeline. Existing source CSVs, archives, matching audits, backups and generated payloads remain private and outside the static build. Staff notes, exemptions and member revisions are not reset by syncing attendance.

## Attendance details in the staff workspace

Each attendance bar supports hover, keyboard focus and tap. Its tooltip names the actual snapshot date, the session count for that reported seven-day snapshot, and the reason for the member's current report flag. Missing observations are labelled unavailable rather than zero. The member card also shows the reason as visible text.

Sharp-stop explanations distinguish a previous snapshot count from an average of earlier known snapshots. Repeated-zero reasons refer to weekly observations. Tooltips do not claim that the member had the same risk category in the historical week being inspected. Escape dismisses the tooltip first; tapping elsewhere dismisses a pinned tooltip. Attendance inspection does not write a note or change risk classification.


Attendance stages (27 October 2026): imports now resolve seven prior observations plus the current snapshot. Red/Yellow priority averages still use the latest five prior slots, preserving the existing drop rules. Stages are derived from the saved sequence: Early warning (first zero after recent attendance), At risk (two zeros, sharp stop or positive Yellow decline), Disengaged (3–4 trailing zeros), Long absence (5–6), Extended absence (7+). Watch cases remain Monitoring and unresolved cases Needs context. Null slots interrupt the run. These are weekly snapshot observations; archived one-day cutoff differences do not establish exact daily absence. The stage filter and labels do not change staff notes or suppression decisions.
