# Urban Muaythai Coach Desk

Staff outreach companion to the existing Retention Intelligence report. Vite + Supabase Auth, Postgres and Realtime. Deployable to Vercel or Netlify using the repository-root configuration files. The original public `index.html` is preserved and remains the separate report; coach notes are never embedded in that file.

## Workflow

1. An administrator imports a weekly risk JSON generated from the existing report builder.
2. Coaches select the report week, work the Red / Yellow / Watch queue, and open a member.
3. A check-in records a required note, the actual signed-in staff identity, timestamp, outcome, optional assignee and follow-up date.
4. `Handled` and `Exempt / paused` require a finite **exclude through report dated** value. Default: the next report week. Paused cases also require a follow-up date.
5. On a subsequent import, the same member identity retains all notes. The case is hidden from the action queue through the selected report date, but remains in **Handled & exempt** and **All risk members**. Once the exemption expires, the member returns if still at risk. **Reopen** ends the exemption immediately for that report week and later ones.

Example: Adrian is handled in the 26 October report, excluded through 2 November, and still appears in the 2 November raw risk snapshot. He stays outside the coach action queue on 2 November. If still at risk on 9 November, he reappears for review. Recording another note alone does not cancel his exemption. No members or risk evidence are deleted.

Actions are effective from their selected report week. A later report's actions do not rewrite an earlier report. A correction entered against an earlier selected week deliberately applies from that week; the event's real save timestamp remains visible. `Contacted` and `Session booked` do not remove a member automatically. Risk signals are triage; `Handled` does not claim that a member has been retained. Follow-ups are due according to Brisbane's current date. Dates in the report selector are weekly snapshots, not live attendance feeds.

## Local development

Use Node 22 or later:

```sh
cd coach-app
npm ci
npm test
npm run dev
```

Without Supabase configuration the UI displays a clearly labelled, fictional sample workspace. Its notes save only to this browser. Sample data never substitutes for failed production queries. Reset preview removes only sample notes. This is sufficient to review the workflow, not a hosted shared database.

Copy `.env.example` to `.env.local` and supply the project's public URL and publishable key (legacy `anon` keys also work). Never put a service-role key, database password, or management token in a `VITE_` variable. Vite variables are public in the built app. Database access is protected by Supabase Auth and RLS, not by hiding the public key.

## Supabase setup

1. Choose a Supabase project for Urban Muaythai. Apply `supabase/migrations/202610260001_coach_desk.sql` once through the SQL editor or your normal migration workflow. The migration creates only the Coach Desk's tables and functions; review names for conflicts in a shared project.
2. In Supabase Auth, disable public sign-ups and create/invite the required staff users. Configure the deployed site's Auth URL. The app uses email/password sign-in; an admin can set a password for the first test account using the Auth dashboard. Invitation/password-reset UI is not implemented in this first version.
3. Bootstrap the first administrator from the SQL editor, replacing the placeholders with an existing Auth user's UUID and name:

```sql
insert into public.staff(id, display_name, role)
values ('EXISTING-AUTH-USER-UUID', 'Staff name', 'admin');
```

Add other existing Auth users with role `coach`. Staff cannot self-approve or promote themselves. Approval and deactivation are admin SQL operations in this version. Set `active=false` to revoke access without deleting history.

4. The migration adds `outreach_events` and `weekly_reports` to `supabase_realtime` if that publication exists. Confirm Realtime is enabled for them in the project. The UI reports the subscription state accurately and also refreshes every 30 seconds and when the tab becomes visible. Open forms preserve their draft until closed. Conflicting saves are rejected with the newer member revision; the coach's draft stays visible.
5. All five tables have RLS. Unapproved users and anonymous visitors cannot read member records or notes. Coaches can read approved staff records but all writes go through validated functions. Imports are administrator-only. Notes are append-only. Server-side staff attribution prevents impersonation. Idempotent request IDs prevent retry duplicates. Imports are transactional and preserve member history on reimport.

This is one Urban Muaythai workspace, not a multi-gym SaaS. Do not give other organisations staff access to the same project.

## Weekly handoff from the existing report

Run this from the repository root, adjusting the report-builder and output paths to the actual local weekly files:

```sh
python scripts/export_outreach.py --builder ../build_retention_report_2026-10-26.py --output ../outreach_2026-10-26.private.json
```

The exporter reruns the existing builder and uses its exact `risks` output, including suspension exclusions. It does not invent a second risk model. It writes a private JSON **outside the public app build**. Optional `--include-phone` includes contact numbers for authenticated coaches. Never commit the private file, raw CSVs or member notes.

**Stable member identity matters.** Current active and attendance exports do not contain a person-level Clubworx contact ID. The export can use provisional normalized names (`name-v1:`); admin import requires an explicit identity review for these files. Before routine live use, obtain Clubworx contact IDs and pass `--identity-map path/to/map.private.json`, a JSON object mapping the existing normalized name to its stable contact ID. Every imported risk member must be covered. Membership IDs identify memberships, not people, and are not interchangeable. Do not switch identity schemes after notes have been recorded without a reviewed database migration that remaps member IDs and preserves notes. Name changes and people sharing a name require administrator reconciliation.

An administrator signs in, chooses **Import week**, selects the private export, checks the week and risk-member count, then imports. Reimporting a week replaces its risk rows atomically, without deleting notes, dispositions, or member records. The import does not send messages to members. Source extraction is still a weekly operator task; an unattended Clubworx integration or schedule has not been configured.

## Deploy

**Vercel (default):** import `urbanmuaythai/urban-retention-intelligence`, use this repository's root directory and the `codex/coach-outreach` branch for the initial preview. The root `vercel.json` installs/builds `coach-app` and serves its `dist` folder. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the appropriate deployment environment, then redeploy. Use your normal reviewed merge before production deployment.

**Netlify alternative:** import the same repository with its root as the base directory. `netlify.toml` specifies the build and publish paths. Add the same two environment variables before building.

The coach app has no client-side path router, so it does not need broad rewrite rules. Existing GitHub Pages continues to use the original root `index.html`. A Vercel or Netlify deployment of this branch serves Coach Desk as its main page. Point staff at the new URL; keep the report's existing GitHub Pages URL separate. Avoid uploading attendance or member files to hosting public folders.

## Verification

`npm test` runs decision-rule tests and executes the actual migration against PGlite PostgreSQL with Auth role stubs. Coverage includes expiry on the next run, preserving historical reports, note-only updates, explicit reopening, approved/anonymous/deactivated access, immutable staff attribution, idempotent saves, stale revision conflicts, atomic rollback and history-preserving imports. This is real SQL execution, not a hosted Supabase integration test. Confirm Auth and Realtime against the chosen live Supabase project before staff launch.

`npm run build` produces the deployable app. Browser QA covers mobile and desktop, filters, member history, saving notes, next-week exclusion, expiration/reappearance and reopening. Hosting and cross-device sync cannot be verified until the external projects are connected.

## GitHub research

Inspected on 26 October 2026:

- [Noah-zipit/gym-retention-demo](https://github.com/Noah-zipit/gym-retention-demo): RetainFit has a Red List for members absent 10+ days and contact/reminder flows. Its README explicitly describes a Flutter pitch demo with seeded data; it does not establish a production backend or weekly exemption semantics.
- [Vandan-726/GymPro](https://github.com/Vandan-726/GymPro): React/Vite/Supabase gym management, Auth, RLS and attendance/admin features. A broader gym platform rather than this specific weekly outreach workflow.
- [tharungit17/gym](https://github.com/tharungit17/gym): Supabase gym management with attendance and authenticated roles, also broader than this workflow.

These were design references only. No external repository code or assets were copied. Coach Desk extends this repository and your report's existing rules.

Primary implementation references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).
