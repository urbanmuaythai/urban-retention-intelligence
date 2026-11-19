import test from "node:test";
import assert from "node:assert/strict";
import {
  disposition,
  projectRows,
  validateImport,
  validateAction,
  addDays,
} from "../src/domain.js";
const week = "2026-10-26",
  member = "m-1";
const events = [
  {
    member_id: member,
    week,
    sequence: 1,
    status: "completed",
    suppress_through: "2026-11-02",
    body: "Agreed return plan.",
  },
];
test("handled case is excluded next run and automatically returns after its exemption", () => {
  assert.equal(disposition(member, week, events).suppressed, true);
  assert.equal(disposition(member, "2026-11-02", events).suppressed, true);
  assert.equal(disposition(member, "2026-11-09", events).status, "open");
  assert.equal(disposition(member, "2026-11-09", events).reopened, true);
});
test("notes alone preserve an exemption; explicit reopen cancels it", () => {
  const note = {
    member_id: member,
    week,
    sequence: 2,
    status: null,
    body: "Additional context",
  };
  assert.equal(disposition(member, week, [...events, note]).suppressed, true);
  assert.equal(
    disposition(member, week, [
      ...events,
      note,
      { ...note, sequence: 3, status: "open" },
    ]).suppressed,
    false,
  );
});
test("later report actions do not change an earlier report; events use insertion sequence not client clocks", () => {
  const future = {
    member_id: member,
    week: "2026-11-02",
    sequence: 10,
    status: "open",
  };
  assert.equal(disposition(member, week, [...events, future]).suppressed, true);
  assert.equal(
    disposition(member, "2026-11-02", [...events, future]).suppressed,
    false,
  );
});
test("exclusions apply to one member; raw risk counts remain available", () => {
  const risks = [
    { member_id: member, week, priority: "Red" },
    { member_id: "m-2", week, priority: "Red" },
  ];
  const rows = projectRows(risks, events, week);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => !r.suppressed).length, 1);
});
test("action queue defaults to Red first rather than source row order", () => {
  const risks = [
    { member_id: "a", week, priority: "Watch", s7: 1 },
    { member_id: "b", week, priority: "Yellow", s7: 0 },
    { member_id: "c", week, priority: "Red", s7: 0 },
  ];
  assert.deepEqual(
    projectRows(risks, [], week).map((r) => r.priority),
    ["Red", "Yellow", "Watch"],
  );
});
test("action validation requires context and a bounded exemption", () => {
  assert.throws(() =>
    validateAction({ body: "  ", status: "contacted" }, week),
  );
  assert.throws(() =>
    validateAction({ body: "Done", status: "completed" }, week),
  );
  assert.throws(() =>
    validateAction(
      { body: "Away", status: "snoozed", suppress_through: "2026-11-02" },
      week,
    ),
  );
  assert.throws(() =>
    validateAction(
      { body: "Hi", status: "open", suppress_through: week },
      week,
    ),
  );
  assert.doesNotThrow(() =>
    validateAction(
      { body: "Done", status: "completed", suppress_through: "2026-11-02" },
      week,
    ),
  );
});
test("weekly imports reject duplicate identities, missing counts and invalid dates", () => {
  const m = {
    member_id: member,
    name: "Sample Person",
    priority: "Red",
    signal: "Zero weeks",
    s7: 0,
    s30: 3,
    sequence: [1, null, 0],
  };
  const p = { version: 1, week, members: [m] };
  assert.doesNotThrow(() => validateImport(p));
  assert.throws(() => validateImport({ ...p, members: [m, m] }));
  assert.throws(() => validateImport({ ...p, members: [{ ...m, s7: null }] }));
  assert.throws(() => validateImport({ ...p, week: "2026-10-27" }));
  assert.throws(() => validateImport({ ...p, week: "2026-02-30" }));
  assert.equal(addDays(week, 7), "2026-11-02");
});
