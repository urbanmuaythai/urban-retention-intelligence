import test from "node:test";
import assert from "node:assert/strict";
import { resolveHistory, archivedEngagement } from "../src/history.js";
import { readReports, convertReports } from "../src/csv-import.js";
import { fixture, filesFor } from "./csv-fixtures.mjs";
const baseline = (as_of, s7 = 0, extra = {}) => ({
  as_of,
  metadata: { kind: "archived-weekly-summary" },
  snapshot: [
    {
      member_id: "clubworx:123",
      s7,
      s30: 4,
      membership: "Unlimited",
      ...extra,
    },
  ],
});

test("archives preserve Monday dates for Tuesday refreshes; exact current snapshots win", () => {
  const b = baseline("2026-10-19");
  let slots = resolveHistory("2026-10-26", "2026-10-27", [], [b]);
  assert.equal(slots.at(-1).date, "2026-10-19");
  assert.equal(slots.at(-1).archived, true);
  slots = resolveHistory("2026-10-26", "2026-10-28", [], [b]);
  assert.equal(slots.at(-1).rows.size, 0);
  const live = {
    week: "2026-10-19",
    import_summary: { asOf: "2026-10-20" },
    attendance_snapshot: [{ member_id: "clubworx:123", s7: 3 }],
  };
  slots = resolveHistory("2026-10-26", "2026-10-27", [live], [b]);
  assert.equal(slots.at(-1).archived, false);
  assert.equal(slots.at(-1).rows.get("clubworx:123").s7, 3);
});
test("recovered engagement requires a matching membership family and expires", () => {
  const b = baseline("2026-10-26", 1, {
    engagement: "Fringe",
    membership: "Accelerate (Unlimited)",
  });
  const plans = [{ "Membership Name": "Accelerate WEEKLY 6 month membership" }];
  assert.equal(
    archivedEngagement("clubworx:123", "2026-10-27", plans, [b]).value,
    "Fringe",
  );
  assert.equal(
    archivedEngagement("clubworx:123", "2026-11-10", plans, [b]),
    null,
  );
  assert.equal(
    archivedEngagement(
      "clubworx:123",
      "2026-10-27",
      [{ "Membership Name": "Kids 2x" }],
      [b],
    ),
    null,
  );
});
test("archive-backed repeated-zero signals are labelled as observations, not invented daily events", () => {
  const reports = readReports(filesFor(fixture()));
  reports.suggestedWeek = null;
  const { payload, summary } = convertReports(
    reports,
    "2026-10-26",
    { Unlimited: 4 },
    [],
    "2026-10-27",
    [baseline("2026-10-19")],
  );
  assert.equal(payload.members[0].priority, "Red");
  assert.match(payload.members[0].signal, /weekly snapshots/);
  assert.equal(summary.sequenceDates.at(-2), "2026-10-19");
  assert.equal(summary.historicalSync.archivedMembers, 1);
});
test("suspension weeks count as no session found; a first-week membership stays Review", () => {
  const rows = fixture();
  rows.suspensions = [
    {
      "Contact ID": "123",
      "Full Name": "Fictional Member",
      "Suspension Starts": "2026-10-13",
      "Suspension Ends": "2026-10-18",
      "Suspension Current?": "false",
    },
  ];
  let reports = readReports(filesFor(rows));
  reports.suggestedWeek = null;
  assert.equal(
    convertReports(reports, "2026-10-26", { Unlimited: 4 }, [], "2026-10-27", [
      baseline("2026-10-19"),
    ]).payload.members[0].priority,
    "Red",
  );
  rows.active[0]["Membership Start Date"] = "2026-10-26";
  reports = readReports(filesFor(rows));
  reports.suggestedWeek = null;
  assert.equal(
    convertReports(reports, "2026-10-26", { Unlimited: 4 }, [], "2026-10-27", [
      baseline("2026-10-19", 4),
    ]).payload.members[0].priority,
    "Review",
  );
});
test("verified archived Fringe context enables Watch without changing current counts", () => {
  const reports = readReports(filesFor(fixture({ s7: 1, s30: 4 })));
  const { payload } = convertReports(
    reports,
    "2026-10-26",
    { Unlimited: 4 },
    [],
    "2026-10-26",
    [baseline("2026-10-26", 1, { engagement: "Fringe" })],
  );
  assert.equal(payload.members[0].priority, "Watch");
  assert.equal(payload.members[0].s7, 1);
});

test("eight observations support seven-week absence without changing the five-prior-week drop rule", () => {
  const baselines = [
    "2026-09-07",
    "2026-09-14",
    "2026-09-21",
    "2026-09-28",
    "2026-10-05",
    "2026-10-12",
    "2026-10-19",
  ].map((date) => baseline(date));
  const reports = readReports(filesFor(fixture()));
  const result = convertReports(
    reports,
    "2026-10-26",
    { Unlimited: 4 },
    [],
    "2026-10-26",
    baselines,
  );
  assert.equal(result.payload.members[0].sequence.length, 8);
  assert.equal(result.summary.sequenceDates.length, 8);
  assert.match(result.payload.members[0].signal, /8 weekly snapshots/);
  baselines[0].snapshot[0].s7 = 20;
  baselines[1].snapshot[0].s7 = 20;
  for (const b of baselines.slice(2)) b.snapshot[0].s7 = 1;
  const stable = convertReports(
    reports,
    "2026-10-26",
    { Unlimited: 4 },
    [],
    "2026-10-26",
    baselines,
  );
  assert.equal(stable.payload.members[0].priority, "Red");
  assert.match(stable.payload.members[0].signal, /Routine broken/);
});
