import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { readReports, convertReports } from "../src/csv-import.js";
import { fixture, filesFor } from "./csv-fixtures.mjs";
test("cloud database grants, stale-context rollback and staff-note preservation", async () => {
  const db = new PGlite(),
    admin = "00000000-0000-4000-8000-000000000001";
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to anon,authenticated,service_role; insert into auth.users values('${admin}');`,
  );
  for (const name of [
    "202610260001_coach_desk.sql",
    "20261027010958_csv_weekly_import.sql",
    "20261027012401_csv_export_cutoff.sql",
    "20261027020548_attendance_baselines.sql",
    "20261028041756_cloud_drive_ingestion.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../../supabase/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    `grant select on staff,members,weekly_reports,attendance_baselines,outreach_events to service_role; insert into staff values('${admin}','Admin','admin',true); insert into member_care_integrations(id,token_hash,admin_id,folder_id,enabled) values('clubworx-drive',repeat('a',64),'${admin}','verified-folder',true);`,
  );
  const { payload } = convertReports(
    readReports(filesFor(fixture())),
    "2026-10-26",
    { Unlimited: 4 },
    [],
    "2026-10-26",
  );
  payload.import_summary.driveSync = {
    folderId: "verified-folder",
    mode: "google-apps-script",
    files: [{}, {}, {}, {}],
  };
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin,
  ]);
  await db.query("select import_retention_week($1::jsonb)", [
    JSON.stringify(payload),
  ]);
  await db.exec(
    `insert into outreach_events(request_id,member_id,week,body,status,suppress_through,created_by) values(gen_random_uuid(),'clubworx:123','2026-10-26','Keep this staff note','completed','2026-11-02','${admin}');`,
  );
  const before = (
    await db.query("select to_jsonb(e) value from outreach_events e")
  ).rows;
  for (const role of ["anon", "authenticated"]) {
    await db.exec("set role " + role);
    await assert.rejects(
      db.query("select * from member_care_integrations"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select clubworx_drive_context()"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select import_clubworx_drive_batch($1::jsonb,$2::jsonb)", [
        JSON.stringify(payload),
        "[]",
      ]),
      /permission denied/,
    );
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  const context = (await db.query("select clubworx_drive_context() value"))
    .rows[0].value;
  assert.equal(context.admin.active, true);
  assert.equal(context.weeks.length, 1);
  await assert.rejects(
    db.query("select import_clubworx_drive_batch($1::jsonb,$2::jsonb)", [
      JSON.stringify(payload),
      "[]",
    ]),
    /Reports changed/,
  );
  const versions = context.weeks.map((w) => [w.week, w.imported_at]);
  const bad = structuredClone(payload);
  bad.import_summary.driveSync.folderId = "wrong-folder";
  await assert.rejects(
    db.query("select import_clubworx_drive_batch($1::jsonb,$2::jsonb)", [
      JSON.stringify(bad),
      JSON.stringify(versions),
    ]),
    /Invalid Drive provenance/,
  );
  await db.query("select import_clubworx_drive_batch($1::jsonb,$2::jsonb)", [
    JSON.stringify(payload),
    JSON.stringify(versions),
  ]);
  assert.deepEqual(
    (await db.query("select to_jsonb(e) value from outreach_events e")).rows,
    before,
  );
  await db.exec(
    "reset role; update member_care_integrations set enabled=false; set role service_role",
  );
  await assert.rejects(
    db.query("select import_clubworx_drive_batch($1::jsonb,$2::jsonb)", [
      JSON.stringify(payload),
      JSON.stringify(versions),
    ]),
    /administrator is unavailable/,
  );
  await db.close();
});
