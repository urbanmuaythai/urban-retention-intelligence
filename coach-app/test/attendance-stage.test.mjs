import test from "node:test";
import assert from "node:assert/strict";
import { attendanceStage } from "../src/attendance-stage.js";

test("absence stages change at the agreed boundaries", () => {
  for (const [weeks, label] of [
    [2, "At risk"],
    [3, "Disengaged"],
    [4, "Disengaged"],
    [5, "Long absence"],
    [6, "Long absence"],
    [7, "Extended absence"],
    [8, "Extended absence"],
  ]) {
    const stage = attendanceStage({
      s7: 0,
      priority: "Red",
      sequence: [2, ...Array(weeks).fill(0)],
    });
    assert.equal(stage.label, label);
    assert.match(stage.detail, new RegExp(`^${weeks} consecutive`));
  }
});
test("unknown and suspended history interrupts the run instead of manufacturing seven weeks", () => {
  assert.equal(
    attendanceStage({
      s7: 0,
      priority: "Red",
      sequence: [0, 0, 0, 0, null, 0, 0, 0],
    }).label,
    "Disengaged",
  );
  assert.equal(
    attendanceStage({ s7: 0, priority: "Review", sequence: [null, 0] }).label,
    "Needs context",
  );
});
test("first zero and sharp stop remain distinct while positive declines are at risk", () => {
  assert.equal(
    attendanceStage({ s7: 0, s30: 3, priority: "Yellow", sequence: [1, 0] })
      .label,
    "Early warning",
  );
  assert.equal(
    attendanceStage({ s7: 0, s30: 8, priority: "Red", sequence: [4, 0] }).label,
    "At risk",
  );
  assert.equal(
    attendanceStage({ s7: 1, priority: "Yellow", sequence: [4, 1] }).label,
    "At risk",
  );
  assert.equal(
    attendanceStage({ s7: 1, priority: "Watch", sequence: [1, 1] }).label,
    "Monitoring",
  );
});
