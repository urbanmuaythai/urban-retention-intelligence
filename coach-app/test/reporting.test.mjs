import test from "node:test";
import assert from "node:assert/strict";
import { weeklyOutreachReport } from "../src/reporting.js";
const week = "2026-10-26";
const risk = (member_id, priority = "Red", date = week) => ({
  member_id,
  priority,
  week: date,
});
const event = (member_id, status, date = week, extra = {}) => ({
  member_id,
  status,
  week: date,
  ...extra,
});

test("weekly reporting deduplicates members and contacts; excludes notes, handled-only and outside-cohort activity", () => {
  const data = {
    risks: [risk("a"), risk("a"), risk("b"), risk("c"), risk("d", "Yellow")],
    events: [
      event("a", "contacted"),
      event("a", "booked"),
      event("b", null),
      event("c", "completed"),
      event("d", "contacted"),
      event("outside", "contacted"),
    ],
  };
  const r = weeklyOutreachReport(data, week);
  assert.equal(r.priorities[0].flagged, 3);
  assert.equal(r.priorities[0].contacted, 1);
  assert.equal(r.priorities[0].noContact, 2);
  assert.equal(r.priorities[0].coverage, 33);
  assert.equal(r.total.flagged, 4);
  assert.equal(r.total.contacted, 2);
});
test("prior-week contacts do not roll into this week and historical reports do not use later-week activity", () => {
  const older = "2026-10-19";
  const data = {
    risks: [risk("a"), risk("a", "Red", older)],
    events: [event("a", "contacted", older)],
  };
  assert.equal(weeklyOutreachReport(data, week).priorities[0].contacted, 0);
  assert.equal(weeklyOutreachReport(data, older).priorities[0].contacted, 1);
});
test("reopen preserves evidence of contact; valid earlier exemptions are separate and do not count as contact", () => {
  const data = {
    risks: [risk("a"), risk("b")],
    events: [
      event("a", "contacted", week, { sequence: 1 }),
      event("a", "open", week, { sequence: 2 }),
      event("b", "snoozed", "2026-10-19", {
        sequence: 3,
        suppress_through: week,
      }),
    ],
  };
  const red = weeklyOutreachReport(data, week).priorities[0];
  assert.equal(red.contacted, 1);
  assert.equal(red.held, 1);
  assert.equal(red.flagged, 2);
});
test("empty cohorts have no invented percentage", () => {
  const r = weeklyOutreachReport({ risks: [], events: [] }, week);
  assert.equal(r.total.coverage, null);
  assert.equal(r.total.flagged, 0);
});
