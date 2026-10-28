import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCSV,
  readReports,
  membershipTargets,
  convertReports,
} from "../src/csv-import.js";
import { fixture, filesFor, week } from "./csv-fixtures.mjs";
const convert = (rows, history = []) => {
  const reports = readReports(filesFor(rows));
  return convertReports(
    reports,
    week,
    Object.fromEntries(
      membershipTargets(reports).map((p) => [p.name, p.target]),
    ),
    history,
  );
};

test("CSV parser preserves quoted commas, quotes, newlines, BOM and CRLF", () => {
  assert.deepEqual(
    parseCSV('\uFEFFName,Note\r\n"A, B","Said ""hello""\nThen left"\r\n').rows,
    [{ Name: "A, B", Note: 'Said "hello"\nThen left' }],
  );
  for (const bad of [
    "A,A\n1,2",
    "A,B\n1",
    'A\n"never closed',
    'A\n"text"unexpected',
  ])
    assert.throws(() => parseCSV(bad));
});
test("four reports are detected by columns, not file selection order", () => {
  const reports = readReports(filesFor(fixture()).reverse());
  assert.equal(reports.attendance.rows.length, 1);
  assert.throws(
    () => readReports(filesFor(fixture()).slice(0, 3)),
    /four CSV files/,
  );
  const files = filesFor(fixture());
  files[0].name = "attendance_2026-10-19.csv";
  assert.throws(() => readReports(files), /different report dates/);
});
test("multiple memberships do not multiply attendance and IDs are stable", () => {
  const result = convert(fixture({ s7: 1, s30: 4, duplicate: true }));
  assert.equal(result.payload.attendance_snapshot.length, 1);
  assert.equal(result.payload.members[0].member_id, "clubworx:123");
  assert.equal(result.payload.members[0].s7, 1);
  assert.equal(result.payload.members[0].priority, "Review");
  const rows = fixture({ duplicate: true });
  rows.attendance[1]["Attendances (Last 7 days)"] = 1;
  assert.throws(
    () => convert(rows),
    /greater than 30-day|conflicting attendance/,
  );
});
test("no sessions found in the last 7 weeks is Red; missing weeks are never fabricated as zero", () => {
  const result = convert(fixture());
  assert.equal(result.payload.members[0].priority, "Red");
  assert.match(result.payload.members[0].signal, /No sessions found/);
  assert.deepEqual(result.payload.members[0].sequence, [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    0,
  ]);
  assert.equal(
    convert(fixture({ s30: 3 })).payload.members[0].priority,
    "Yellow",
  );
});
test("complete snapshots include healthy members and enable later sharp stops and ghosting", () => {
  const healthy = convert(fixture({ s7: 4, s30: 16 }));
  assert.equal(healthy.payload.members.length, 0);
  assert.equal(healthy.payload.attendance_snapshot[0].s7, 4);
  const prior = [
    {
      week: "2026-10-19",
      attendance_snapshot: healthy.payload.attendance_snapshot,
    },
  ];
  assert.equal(
    convert(fixture({ s7: 0, s30: 4 }), prior).payload.members[0].priority,
    "Red",
  );
  prior[0].attendance_snapshot[0].s7 = 0;
  assert.match(convert(fixture(), prior).payload.members[0].signal, /Ghosting/);
  prior[0].week = "2026-10-12";
  assert.match(convert(fixture(), prior).payload.members[0].signal, /No sessions found/);
});
test("known Fringe labels retain Watch and cooling rules remain ordered", () => {
  assert.equal(
    convert(fixture({ s7: 1, s30: 3, engagement: "Fringe" })).payload.members[0]
      .priority,
    "Watch",
  );
  const history = [
    {
      week: "2026-10-19",
      attendance_snapshot: [{ member_id: "clubworx:123", s7: 4, s30: 10 }],
    },
  ];
  assert.match(
    convert(fixture({ s7: 1, s30: 3, engagement: "Fringe" }), history).payload
      .members[0].signal,
    /Cooling/,
  );
});
test("package totals do not become weekly targets; unlimited teens default to four", () => {
  const reports = readReports(
    filesFor(
      fixture({ plan: "10 Class Pass", limit: "10 classes", s7: 1, s30: 1 }),
    ),
  );
  assert.equal(membershipTargets(reports)[0].target, null);
  assert.equal(
    convertReports(reports, week, { "10 Class Pass": null }).payload.members
      .length,
    0,
  );
  assert.equal(
    membershipTargets(
      readReports(
        filesFor(
          fixture({
            plan: "Teens Class (unlimited)",
            limit: "6 classes every 1 weeks",
          }),
        ),
      ),
    )[0].target,
    4,
  );
});
test("suspension dates override stale flags and membership status is also held", () => {
  const rows = fixture({ duplicate: true });
  // Keep a second eligible fictional contact so the import is not entirely empty.
  rows.attendance[1] = {
    ...rows.attendance[1],
    "Contact ID": "124",
    "First Name": "Second",
  };
  rows.active[1] = {
    ...rows.active[1],
    "Contact ID": "124",
    "Full Name": "Second Member",
  };
  rows.suspensions = [
    {
      "Contact ID": "123",
      "Full Name": "Fictional Member",
      "Suspension Starts": "2026-10-20",
      "Suspension Ends": "2026-11-01",
      "Suspension Current?": "false",
    },
  ];
  const result = convert(rows);
  assert.equal(result.summary.currentSuspensions, 1);
  assert.deepEqual(
    result.payload.members.map((m) => m.member_id),
    ["clubworx:124"],
  );
  rows.suspensions[0]["Suspension Ends"] = "2026-10-25";
  rows.active[0].Status = "Suspended";
  assert.equal(convert(rows).summary.suspensionStatusHeld, 1);
});
test("mismatched identities, missing zero coverage, duplicate IDs and invalid counts are blocked", () => {
  const bad = fixture();
  bad.active[0]["Full Name"] = "Someone Else";
  assert.throws(() => convert(bad), /conflicting names/);
  const missing = fixture({ duplicate: true });
  missing.attendance.pop();
  assert.throws(() => convert(missing), /does not match Attendance/);
  const negative = fixture();
  negative.attendance[0]["Attendances (Last 7 days)"] = "-1";
  assert.throws(() => convert(negative), /non-negative/);
  const dup = fixture();
  dup.active.push({ ...dup.active[0] });
  assert.throws(() => convert(dup), /repeats Membership ID/);
  const future = fixture();
  future.attendance[0]["Attendance Last Marked"] = "2026-10-27";
  assert.throws(() => convert(future), /after the selected/);
});
test("tour payments and future-start plans are excluded without dropping another active plan", () => {
  const rows = fixture({ duplicate: true });
  rows.attendance[1]["Membership Name"] = rows.active[1]["Membership Name"] =
    "Thailand Tour Deposit";
  const result = convert(rows);
  assert.equal(result.summary.excludedProductRows, 1);
  assert.equal(result.summary.eligible, 1);
  rows.active[1]["Membership Name"] = rows.attendance[1]["Membership Name"] =
    "Future training";
  rows.active[1]["Membership Start Date"] = "2026-10-27";
  assert.equal(convert(rows).summary.futureStartRows, 1);
});
test("cancellation flags and expiry dates do not count every raw record as a cancellation KPI", () => {
  const rows = fixture();
  rows.cancellations.push({
    ...rows.cancellations[0],
    "Membership ID": "cancel2",
    "Cancellation Present?": "false",
  });
  rows.cancellations.push({
    ...rows.cancellations[0],
    "Membership ID": "cancel3",
    "Membership Expiry Date": "2026-12-01",
  });
  const s = convert(rows).summary;
  assert.equal(s.cancellationRows, 3);
  assert.equal(s.flaggedCancellations, 2);
  assert.equal(s.effectiveCancellations, 1);
});

test("Tuesday exports use their actual cutoff while retaining the Monday report week", () => {
  const rows = fixture({ s7: 1, s30: 4 });
  rows.attendance[0]["Attendance Last Marked"] = "2026-10-27 09:00:00";
  rows.active[0]["Membership Start Date"] = "2026-10-27";
  const reports = readReports(filesFor(rows, "2026-10-27"));
  const result = convertReports(
    reports,
    week,
    { Unlimited: 4 },
    [],
    "2026-10-27",
  );
  assert.equal(result.payload.week, "2026-10-26");
  assert.equal(result.summary.asOf, "2026-10-27");
  assert.equal(result.summary.futureStartRows, 0);
  assert.equal(result.summary.eligible, 1);
  assert.throws(
    () =>
      convertReports(reports, "2026-10-19", { Unlimited: 4 }, [], "2026-10-27"),
    /does not match the selected report week/,
  );
});

test("cutoff dates drive suspension holds and history must be seven days apart", () => {
  const rows = fixture({ s7: 0, s30: 0 });
  const reports = readReports(filesFor(rows, "2026-10-27"));
  const prior = {
    week: "2026-10-19",
    import_summary: { asOf: "2026-10-20" },
    attendance_snapshot: [{ member_id: "clubworx:123", s7: 0, s30: 0 }],
  };
  assert.equal(
    convertReports(reports, week, { Unlimited: 4 }, [prior], "2026-10-27")
      .payload.members[0].priority,
    "Red",
  );
  prior.import_summary.asOf = "2026-10-19";
  assert.equal(
    convertReports(reports, week, { Unlimited: 4 }, [prior], "2026-10-27")
      .payload.members[0].priority,
    "Red",
  );
  rows.suspensions = [
    {
      "Contact ID": "123",
      "Full Name": "Fictional Member",
      "Suspension Starts": "2026-10-27",
      "Suspension Ends": "2026-11-01",
      "Suspension Current?": "true",
    },
  ];
  assert.throws(
    () =>
      convertReports(
        readReports(filesFor(rows, "2026-10-27")),
        week,
        { Unlimited: 4 },
        [],
        "2026-10-27",
      ),
    /No eligible training members/,
  );
});
const session = (day, attended = "true", name = "All Levels") => ({
  "Contact ID": "123",
  "First Name": "Fictional",
  "Last Name": "Member",
  "Event Date": day,
  "Event Starts": day + " 17:15:00",
  "Event Name": name,
  "Attended?": attended,
});
test("attendance history is an optional fifth report detected by its columns", () => {
  const rows = { ...fixture(), history: [session("2026-08-31")] };
  const reports = readReports(filesFor(rows).reverse());
  assert.equal(reports.history.rows.length, 1);
  const missing = filesFor(rows).filter((f) => !f.name.startsWith("suspensions"));
  assert.throws(() => readReports(missing), /Missing Suspensions/);
});
test("attendance history counts real session dates into each earlier week", () => {
  const rows = fixture();
  rows.history = [
    session("2026-08-31", "false"),
    session("2026-09-10"),
    session("2026-09-10"),
    session("2026-09-12", "true", "Kickstarter"),
    session("2026-09-13", "false"),
  ];
  const { payload, summary } = convert(rows);
  const member = payload.members[0];
  assert.deepEqual(member.sequence, [0, 2, 0, 0, 0, 0, 0, 0]);
  assert.equal(member.priority, "Red");
  assert.match(member.signal, /Ghosting · 6 straight zero weeks/);
  assert.equal(summary.sequenceDates[0], "2026-09-07");
  assert.deepEqual(summary.attendanceHistory, {
    from: "2026-08-31",
    coveredWeeks: 7,
    sessions: 2,
  });
});
test("attendance history only replaces weeks it fully covers and rejects sessions after the cutoff", () => {
  const rows = fixture();
  rows.history = [session("2026-10-01"), session("2026-10-08")];
  const { payload, summary } = convert(rows);
  assert.deepEqual(payload.members[0].sequence, [
    null, null, null, null, null, 1, 0, 0,
  ]);
  assert.equal(summary.attendanceHistory.coveredWeeks, 2);
  rows.history = [session("2026-09-01"), session("2026-10-27")];
  assert.throws(() => convert(rows), /after the selected report cutoff/);
});
test("three attending weeks then zero is Red: on-target first, then broken routine", () => {
  const rows = fixture();
  rows.history = [
    session("2026-08-31", "false"),
    session("2026-09-30"),
    session("2026-10-07"),
    session("2026-10-14"),
  ];
  let member = convert(rows).payload.members[0];
  assert.deepEqual(member.sequence.slice(-4), [1, 1, 1, 0]);
  assert.equal(member.priority, "Red");
  assert.match(member.signal, /Routine broken · 3 weeks attending/);
  rows.history.push(
    ...["2026-10-01", "2026-10-02", "2026-10-03"].map((d) => session(d)),
    ...["2026-10-08", "2026-10-09", "2026-10-10"].map((d) => session(d)),
    ...["2026-10-15", "2026-10-16", "2026-10-17"].map((d) => session(d)),
  );
  member = convert(rows).payload.members[0];
  assert.equal(member.priority, "Red");
  assert.match(member.signal, /Was on target · 3 weeks at 4\+/);
  rows.history = [session("2026-08-31", "false"), session("2026-10-07"), session("2026-10-14")];
  assert.doesNotMatch(convert(rows).payload.members[0].signal, /Routine|on target/);
});
