import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { buildFringe, fringeVisible, fringeContacts, isU18 } from "../src/fringe.js";
import { readReports, membershipTargets, convertReports } from "../src/csv-import.js";
import { fringeToContact } from "../src/operations.js";
import { fixture, filesFor, week } from "./csv-fixtures.mjs";

const person = (id, plans, s7, s30 = s7 * 4) => ({
  member_id: id,
  name: "Fictional " + id,
  phone: null,
  plans,
  s7,
  s30,
  last: null,
});
const targets = {
  "Accelerate WEEKLY 6 month membership": 4,
  "Fun & Fitness (3 classes per week) Weekly T6": 3,
  "Teens Class (2x classes)": 2,
  "Teens Upfront Membership": null,
  "Part Payment for membership": null,
};

test("Fringe = 1+ sessions under target; sleepers, engaged and review are split out like the Monday sheet", () => {
  const f = buildFringe(
    [
      person("a", ["Accelerate WEEKLY 6 month membership"], 0),
      person("b", ["Accelerate WEEKLY 6 month membership"], 3),
      person("c", ["Accelerate WEEKLY 6 month membership"], 4),
      person("d", ["Fun & Fitness (3 classes per week) Weekly T6"], 1),
      person("e", ["Fun & Fitness (3 classes per week) Weekly T6"], 3),
      person("f", ["Teens Class (2x classes)"], 1),
      person("g", ["Teens Class (2x classes)"], 2),
      person("h", ["Teens Upfront Membership"], 1),
      person("i", ["Part Payment for membership"], 1),
    ],
    targets,
  );
  assert.deepEqual(
    f.members.map((m) => [m.member_id, m.target, m.group]),
    [
      ["d", 3, "Adults"],
      ["f", 2, "U18"],
      ["b", 4, "Adults"],
    ],
  );
  assert.equal(f.sleepers, 1);
  assert.equal(f.engaged, 3);
  assert.deepEqual(f.review.map((m) => m.member_id), ["h"]);
  assert.equal(f.excluded, 1);
});

test("part payments are ignored next to a real plan, and the highest target wins", () => {
  const f = buildFringe(
    [
      person("a", ["Part Payment for membership", "Fun & Fitness (3 classes per week) Weekly T6"], 2),
      person("b", ["Teens Class (2x classes)", "Accelerate WEEKLY 6 month membership"], 2),
    ],
    targets,
  );
  assert.deepEqual(
    f.members.map((m) => [m.member_id, m.membership, m.target]),
    [
      ["a", "Fun & Fitness (3 classes per week) Weekly T6", 3],
      ["b", "Teens Class (2x classes) / Accelerate WEEKLY 6 month membership", 4],
    ],
  );
});

test("U18 covers 15-18, Teens and Kids memberships", () => {
  for (const m of ["15-18 years (3x per week) 2023", "Teens 11-15 years (unlimited)", "Kids Class (2x)"])
    assert.equal(isU18(m), true, m);
  assert.equal(isU18("Accelerate WEEKLY 6 month membership"), false);
});

test("the import stores the Fringe list with name, phone and last attended", () => {
  const rows = fixture({ plan: "Accelerate WEEKLY 6 month membership", limit: "Unlimited classes", s7: 2, s30: 9 });
  rows.attendance[0]["Phone Number"] = "0400 000 000";
  rows.attendance[0]["Attendance Last Marked"] = "2026-10-25 18:10:00";
  const reports = readReports(filesFor(rows));
  const t = Object.fromEntries(membershipTargets(reports).map((p) => [p.name, p.target]));
  const { summary } = convertReports(reports, week, t);
  assert.deepEqual(summary.fringe.members, [
    {
      member_id: "clubworx:123",
      name: "Fictional Member",
      phone: "0400 000 000",
      membership: "Accelerate WEEKLY 6 month membership",
      group: "Adults",
      target: 4,
      s7: 2,
      s30: 9,
      last: "2026-10-25",
    },
  ]);
  for (const s7 of [0, 4]) {
    const r = readReports(filesFor(fixture({ plan: "Accelerate WEEKLY 6 month membership", s7, s30: 8 })));
    assert.equal(convertReports(r, week, t).summary.fringe.members.length, 0);
  }
});

test("filters, contact log and the portal count use the selected week only", () => {
  const fringe = buildFringe(
    [
      person("a", ["Accelerate WEEKLY 6 month membership"], 1),
      person("b", ["Teens Class (2x classes)"], 1),
    ],
    targets,
  );
  const log = [
    { week, member_id: "a", contacted_on: week, method: "SMS" },
    { week: "2026-10-19", member_id: "b", contacted_on: "2026-10-19", method: "SMS" },
  ];
  const contacts = fringeContacts(log, week);
  const ids = (s) => fringeVisible(fringe, contacts, { group: "All", search: "", ...s }).map((m) => m.member_id);
  assert.deepEqual(ids({ status: "To contact" }), ["b"]);
  assert.deepEqual(ids({ status: "Contacted" }), ["a"]);
  assert.deepEqual(ids({ status: "All", group: "U18" }), ["b"]);
  const data = { weeks: [{ week, import_summary: { fringe } }], fringeOutreach: log };
  assert.equal(fringeToContact(data, week), 1);
  assert.equal(fringeToContact({ weeks: [{ week }], fringeOutreach: [] }, week), null);
});

test("database: staff save Fringe reach-outs; only admins validate; only listed members", async () => {
  const db = new PGlite();
  const admin = "00000000-0000-4000-8000-000000000001",
    coach = "00000000-0000-4000-8000-000000000002",
    outsider = "00000000-0000-4000-8000-000000000003";
  await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;
 insert into auth.users values('${admin}'),('${coach}'),('${outsider}');`);
  const migrate = async (name) =>
    db.exec(await readFile(new URL("../../supabase/migrations/" + name, import.meta.url), "utf8"));
  await migrate("202610260001_coach_desk.sql");
  await db.exec(`insert into staff values('${admin}','Admin','admin',true),('${coach}','Coach','coach',true);`);
  await migrate("20261027010958_csv_weekly_import.sql");
  await migrate("20261119090000_fringe_outreach.sql");
  await db.query(
    "insert into weekly_reports(week,source_label,source_count,imported_by,import_summary) values($1,'Fictional',0,$2,$3::jsonb)",
    [week, admin, JSON.stringify({ fringe: { members: [{ member_id: "clubworx:1" }], review: [] } })],
  );
  const login = async (id) => {
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated;");
  };
  const save = (member, validated, method = "SMS") =>
    db.query("select save_fringe_outreach($1,$2,$3,$4,$5,$6)", [week, member, method, week, "Fictional note", validated]);

  await login(coach);
  await save("clubworx:1", true);
  let row = (await db.query("select * from fringe_outreach")).rows[0];
  assert.equal(row.method, "SMS");
  assert.equal(row.validated, false, "a team member cannot validate");
  await assert.rejects(save("clubworx:2", false), /not on this week/);
  await assert.rejects(save("clubworx:1", false, "Carrier pigeon"), /check/);
  await assert.rejects(db.query("insert into fringe_outreach(week,member_id,updated_by) values($1,'x',$2)", [week, coach]), /permission/);

  await login(admin);
  await save("clubworx:1", true, "Phone call");
  row = (await db.query("select * from fringe_outreach")).rows[0];
  assert.equal(row.validated, true);
  assert.equal(row.validated_by, admin);

  await login(coach);
  await save("clubworx:1", false, "Email");
  row = (await db.query("select * from fringe_outreach")).rows[0];
  assert.equal(row.method, "Email");
  assert.equal(row.validated, true, "a team member's save keeps the admin validation");

  await login(outsider);
  assert.equal((await db.query("select * from fringe_outreach")).rows.length, 0);
  await assert.rejects(save("clubworx:1", false), /Staff access/);
});

test("Clubworx buttons link to the member profile and its New Message panel", async () => {
  const { clubworxLinks, clubworxButtons } = await import("../src/fringe.js");
  assert.deepEqual(clubworxLinks("clubworx:3186720"), {
    profile: "https://app.clubworx.com/gyms/2519/members/3186720",
    message: "https://app.clubworx.com/gyms/2519/members/3186720#comms",
  });
  assert.equal(clubworxLinks("demo-1"), null);
  assert.equal(clubworxButtons("demo-1", () => ""), "");
  assert.match(clubworxButtons("clubworx:1", () => ""), /Message in Clubworx/);
});

test("Fringe reporting: bands 0/1/2/3/4+, Adults/U18 split, contacted and the 7-day period", async () => {
  const { fringeWeekReport } = await import("../src/fringe-reporting.js");
  const fringe = buildFringe(
    [
      person("a", ["Accelerate WEEKLY 6 month membership"], 0),
      person("b", ["Accelerate WEEKLY 6 month membership"], 1),
      person("c", ["Accelerate WEEKLY 6 month membership"], 6),
      person("d", ["Teens Class (2x classes)"], 2),
      person("e", ["Teens Upfront Membership"], 3),
    ],
    targets,
  );
  const data = {
    weeks: [
      { week, import_summary: { asOf: "2026-10-27", fringe } },
      { week: "2026-10-19", attendance_snapshot: [{ s7: 0 }, { s7: 5 }], import_summary: {} },
    ],
    fringeOutreach: [{ week, member_id: "b", contacted_on: week, method: "SMS", validated: true }],
  };
  const r = fringeWeekReport(data, week);
  assert.deepEqual(r.bands, [1, 1, 1, 1, 1]);
  assert.deepEqual(r.groups.Adults.bands, [1, 1, 0, 0, 1]);
  assert.deepEqual(r.groups.U18.bands, [0, 0, 1, 1, 0]);
  assert.deepEqual(
    [r.groups.Combined.sleepers, r.groups.Combined.fringe, r.groups.Combined.engaged, r.groups.Combined.review],
    [1, 1, 2, 1],
  );
  assert.equal(r.contacted, 1);
  assert.equal(r.validated, 1);
  assert.equal(r.from, "2026-10-21");
  assert.equal(r.asOf, "2026-10-27");
  const old = fringeWeekReport(data, "2026-10-19");
  assert.equal(old.source, "snapshot");
  assert.deepEqual(old.bands, [1, 0, 0, 0, 1]);
  assert.equal(old.groups, null);
});

test("daily re-imports keep this week's earlier Fringe members, with fresh numbers", () => {
  const earlier = buildFringe(
    [
      person("a", ["Accelerate WEEKLY 6 month membership"], 1),
      person("b", ["Accelerate WEEKLY 6 month membership"], 2),
      person("c", ["Teens Class (2x classes)"], 1),
    ],
    targets,
  ).members;
  // Next morning: a is now on target, b is still Fringe, c has left the roster.
  const next = buildFringe(
    [
      person("a", ["Accelerate WEEKLY 6 month membership"], 4),
      person("b", ["Accelerate WEEKLY 6 month membership"], 3),
      person("d", ["Fun & Fitness (3 classes per week) Weekly T6"], 1),
    ],
    targets,
    earlier,
  );
  assert.deepEqual(
    next.members.map((m) => [m.member_id, m.s7, m.carried ?? null]),
    [
      ["d", 1, null],
      ["b", 3, null],
      ["c", 1, "No longer tracked"],
      ["a", 4, "Now on target"],
    ],
  );
  const contacts = fringeContacts([{ week, member_id: "a", contacted_on: week }], week);
  assert.deepEqual(
    fringeVisible(next, contacts, { group: "All", status: "To contact", search: "" }).map((m) => m.member_id),
    ["d", "b"],
  );
  assert.deepEqual(
    fringeVisible(next, contacts, { group: "All", status: "Contacted", search: "" }).map((m) => m.member_id),
    ["a"],
  );
});

test("the automatic Drive import builds the Fringe list and carries the same week's list forward", async () => {
  const { prepareDriveImport, DRIVE_FOLDER, REPORT_IDS } = await import("../../scripts/drive-member-care.mjs");
  const start = Date.parse("2026-10-26T00:00:00Z");
  const rows = fixture({ plan: "Accelerate WEEKLY 6 month membership", limit: "Unlimited classes", s7: 4, s30: 9 });
  const input = filesFor(rows);
  const manifest = {
    folderId: DRIVE_FOLDER,
    files: REPORT_IDS.map((id, i) => ({
      id: "fictional-" + id,
      name: `report_export_${id}_${start / 1000 + i}.csv`,
      text: [input[0], input[1], input[3], input[2]][i].text,
    })),
  };
  const saved = { fringe: { members: [{ member_id: "clubworx:123", name: "Fictional Member", membership: "Accelerate WEEKLY 6 month membership", group: "Adults", target: 4, s7: 1, s30: 5 }] } };
  const context = {
    weeks: [
      { week: "2026-10-19", imported_at: "2026-10-19 00:00:00+00", import_summary: { targets: { "Accelerate WEEKLY 6 month membership": 4 } } },
      { week: "2026-10-26", imported_at: "2026-10-25 22:00:00+00", import_summary: { targets: { "Accelerate WEEKLY 6 month membership": 4 }, ...saved } },
    ],
    baselines: [],
    members: [],
    events: [],
    admin: { id: "00000000-0000-4000-8000-000000000001", active: true, role: "admin" },
  };
  const result = prepareDriveImport(manifest, context, start + 3600_000);
  assert.equal(result.status, "ready");
  const fringe = result.payload.import_summary.fringe;
  assert.deepEqual(fringe.members.map((m) => [m.member_id, m.s7, m.carried]), [["clubworx:123", 4, "Now on target"]]);
  assert.deepEqual(fringe.groups.Adults.bands, [0, 0, 0, 0, 1]);
});

test("the cloud Edge bundle includes every shared module the import uses", async () => {
  const { edgeBundle } = await import("../../scripts/deploy-cloud-member-care.mjs");
  const names = edgeBundle().map((f) => f.name);
  for (const m of ["fringe", "csv-import", "operations", "cancellation-category", "drive-import", "domain", "history"])
    assert.ok(names.includes(`shared/${m}.js`), m);
});
