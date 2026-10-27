import test from "node:test";
import assert from "node:assert/strict";
import { attendanceLabel, riskExplanation } from "../src/attendance-ui.js";

test("attendance labels distinguish a missing observation from a real zero", () => {
  assert.equal(
    attendanceLabel(0),
    "0 attended sessions in this 7-day snapshot",
  );
  assert.equal(attendanceLabel(1), "1 attended session in this 7-day snapshot");
  assert.match(attendanceLabel(null), /No attendance snapshot/);
});
test("sharp-stop explanation cites the actual prior and current snapshot dates", () => {
  const text = riskExplanation(
    {
      priority: "Red",
      signal: "Sharp stop · 2 → 0",
      s7: 0,
      s30: 8,
      sequence: [null, 3, 2, 0],
    },
    ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-27"],
  );
  assert.match(text, /2 sessions in the 19 Oct 2026 snapshot/);
  assert.match(text, /0 in the latest 27 Oct 2026 snapshot/);
});
test("repeated-zero reasons describe weekly observations and never extend through missing weeks", () => {
  const text = riskExplanation({
    priority: "Red",
    s7: 0,
    sequence: [0, null, 0, 0],
  });
  assert.match(text, /latest 2 consecutive weekly snapshots/);
  assert.doesNotMatch(text, /14 days|4 consecutive/);
});
test("average-based sharp stops do not invent a previous week's count", () => {
  const text = riskExplanation({
    priority: "Red",
    s7: 0,
    sequence: [4, 2, null, 0],
  });
  assert.match(text, /average of 3 across 2 earlier weekly snapshots/);
  assert.doesNotMatch(text, /previous snapshot/);
});
test("incomplete evidence stays Review and current Yellow uses actual attendance totals", () => {
  assert.match(
    riskExplanation({ priority: "Review", sequence: [null, 0] }),
    /incomplete/,
  );
  assert.match(
    riskExplanation({ priority: "Yellow", s7: 0, s30: 8 }),
    /8 visits/,
  );
});
