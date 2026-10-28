import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOperations,
  operationWeek,
  fridayPeriod,
  operationPeriods,
  workspaceView,
} from "../src/operations.js";
import { fixture, filesFor } from "./csv-fixtures.mjs";
import { readReports, convertReports } from "../src/csv-import.js";
const week = "2026-10-26",
  asOf = "2026-10-27";
const policy = { version: 1, excludedMembershipIds: ["admin"] };

test("weekly operations keep effective cancellations separate from notices and exclude rollovers/admin cleanup", () => {
  const f = fixture();
  const original = f.cancellations[0];
  f.cancellations = [
    { ...original, "Membership ID": "ended", "Membership Expiry Date": asOf },
    {
      ...original,
      "Membership ID": "old",
      "Membership Expiry Date": "2026-10-25",
    },
    {
      ...original,
      "Membership ID": "future",
      "Membership Expiry Date": "2026-10-29",
    },
    {
      ...original,
      "Membership ID": "notice",
      "Membership Expiry Date": "2026-11-30",
      "Cancellation Date": asOf,
    },
    {
      ...original,
      "Membership ID": "roll",
      "Membership Expiry Date": asOf,
      "Cancellation Reason": "Roll Over",
    },
    {
      ...original,
      "Membership ID": "admin",
      "Membership Expiry Date": asOf,
      "Cancellation Reason": "Bad debt",
    },
  ];
  const reports = readReports(filesFor(f));
  const operations = buildOperations(reports, week, asOf, policy);
  assert.equal(
    operations.periods.find((p) => p.start === "2026-10-23").cancellations
      .length,
    5,
    "Only week-relevant records are saved",
  );
  const result = operationWeek({
    week,
    import_summary: { asOf, operations, retentionPolicy: policy },
  });
  assert.deepEqual(
    result.cancellations.map((r) => r.membership_id),
    ["ended", "old"],
  );
  assert.deepEqual(
    result.recorded.map((r) => r.membership_id),
    ["notice"],
  );
  assert.equal(result.excludedInWeek.length, 2);
  assert.equal(result.policyApplied, true);
});
test("suspensions use overlap with this partial week and deduplicate matching source periods", () => {
  const f = fixture(),
    row = f.suspensions[0];
  f.suspensions = [
    {
      ...row,
      "Suspension Starts": "2026-10-20",
      "Suspension Ends": "2026-10-26",
    },
    {
      ...row,
      "Suspension Starts": "2026-10-20",
      "Suspension Ends": "2026-10-26",
    },
    {
      ...row,
      "Contact ID": "998",
      "Suspension Starts": "2026-10-27",
      "Suspension Ends": "",
    },
    {
      ...row,
      "Contact ID": "997",
      "Suspension Starts": "2026-10-28",
      "Suspension Ends": "",
    },
  ];
  const reports = readReports(filesFor(f));
  const operations = buildOperations(reports, week, asOf, policy);
  const result = operationWeek({
    week,
    import_summary: { asOf, operations, retentionPolicy: policy },
  });
  assert.equal(result.suspensions.length, 2);
  assert.equal(result.currentSuspensions.length, 1);
});
test("missing details and mismatched report cutoffs remain unavailable, not zero", () => {
  assert.equal(operationWeek({ week, import_summary: {} }), null);
  assert.equal(
    operationWeek({
      week,
      import_summary: {
        asOf,
        operations: { version: 1, week, asOf: "2026-10-26" },
      },
    }),
    null,
  );
});
test("CSV conversions retain private weekly details and previously approved exclusion policy", () => {
  const history = [
    { week: "2026-10-19", import_summary: { retentionPolicy: policy } },
  ];
  const { payload } = convertReports(
    readReports(filesFor(fixture(), asOf)),
    week,
    { Unlimited: 4 },
    history,
    asOf,
  );
  assert.equal(payload.import_summary.operations.week, week);
  assert.deepEqual(payload.import_summary.retentionPolicy, policy);
});

test("Friday-Thursday date boundaries include Friday/Sunday and exclude the preceding Thursday", () => {
  assert.deepEqual(fridayPeriod("2026-10-29"), {
    start: "2026-10-23",
    end: "2026-10-29",
  });
  assert.deepEqual(fridayPeriod("2026-10-30"), {
    start: "2026-10-30",
    end: "2026-11-05",
  });
  assert.deepEqual(fridayPeriod("2027-01-01"), {
    start: "2027-01-01",
    end: "2027-01-07",
  });
  const rows = fixture(),
    r = rows.cancellations[0];
  rows.cancellations = [
    "2026-10-22",
    "2026-10-23",
    "2026-10-25",
    "2026-10-29",
    "2026-10-30",
  ].map((d, i) => ({
    ...r,
    "Membership ID": "m" + i,
    "Membership Expiry Date": d,
  }));
  const reports = readReports(filesFor(rows));
  const make = (asOf) => ({
    week,
    import_summary: {
      asOf,
      retentionPolicy: policy,
      operations: buildOperations(reports, week, asOf, policy),
    },
  });
  assert.deepEqual(
    operationWeek(make("2026-10-27")).cancellations.map((r) => r.end),
    ["2026-10-23", "2026-10-25"],
  );
  assert.deepEqual(
    operationWeek(make("2026-10-29")).cancellations.map((r) => r.end),
    ["2026-10-23", "2026-10-25", "2026-10-29"],
  );
  const legacy = {
    week,
    import_summary: {
      asOf,
      operations: {
        version: 1,
        week,
        asOf,
        cancellations: [],
        suspensions: [],
      },
    },
  };
  assert.equal(
    operationWeek(legacy),
    null,
    "Monday-only details must not be relabelled as Friday coverage",
  );
});

test("Friday rollover retains the completed period across Monday report keys without double counting", () => {
  const reports = readReports(filesFor(fixture()));
  const make = (key, cutoff, history = []) => ({
    week: key,
    import_summary: {
      asOf: cutoff,
      retentionPolicy: policy,
      operations: buildOperations(reports, key, cutoff, policy, history),
    },
  });
  const thursday = make(week, "2026-10-29");
  const friday = make(week, "2026-10-30", [thursday]);
  assert.equal(operationWeek(friday).start, "2026-10-30");
  assert.equal(operationWeek(friday, "2026-10-23").asOf, "2026-10-29");
  const monday = make("2026-11-02", "2026-11-02", [friday]);
  const periods = operationPeriods([friday, monday]);
  assert.equal(periods.filter((p) => p.start === "2026-10-23").length, 1);
  assert.equal(
    periods.find((p) => p.start === "2026-10-23").sourceAsOf,
    "2026-11-02",
  );
  const older = make(week, "2026-10-27", [friday]);
  assert.equal(
    older.import_summary.operations.periods.some(
      (p) => p.sourceAsOf > "2026-10-27",
    ),
    false,
  );
});

test("a Friday export defaults to the completed Thursday period for the selected Monday report week", () => {
  const reports = readReports(filesFor(fixture()));
  const record = {
    week,
    import_summary: {
      asOf: "2026-10-30",
      retentionPolicy: policy,
      operations: buildOperations(reports, week, "2026-10-30", policy),
    },
  };
  const html = workspaceView(
    { weeks: [record], risks: [], events: [] },
    week,
    "cancellations",
    { esc: String, fmt: String, icon: () => "" },
  );
  assert.match(html, /<option value="2026-10-23" selected>/);
  assert.match(html, /Fri 2026-10-23 – Thu 2026-10-29/);
  assert.match(html, /Complete period/);
});
