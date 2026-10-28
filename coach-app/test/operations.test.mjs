import test from "node:test";
import assert from "node:assert/strict";
import { buildOperations, operationWeek } from "../src/operations.js";
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
    operations.cancellations.length,
    4,
    "Only week-relevant records are saved",
  );
  const result = operationWeek({
    week,
    import_summary: { asOf, operations, retentionPolicy: policy },
  });
  assert.deepEqual(
    result.cancellations.map((r) => r.membership_id),
    ["ended"],
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
