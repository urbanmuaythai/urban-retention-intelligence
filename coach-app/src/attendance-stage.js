// Stages describe the saved evidence; priority and outreach status remain independent.
export const ATTENDANCE_STAGES = [
  "Early warning",
  "At risk",
  "Disengaged",
  "Long absence",
  "Extended absence",
  "Monitoring",
  "Needs context",
];

export function attendanceStage(risk) {
  const sequence = risk.sequence || [];
  let zeros = 0;
  if (risk.s7 === 0) {
    for (const n of [...sequence].reverse()) {
      if (n !== 0) break;
      zeros++;
    }
  }
  // A missing/suspended/ineligible slot is null and ends the observed run.
  const detail = zeros
    ? `${zeros} consecutive zero-attendance snapshot${zeros === 1 ? "" : "s"}`
    : "";
  if (zeros >= 7) return { label: "Extended absence", detail };
  if (zeros >= 5) return { label: "Long absence", detail };
  if (zeros >= 3) return { label: "Disengaged", detail };
  if (zeros >= 2 || risk.priority === "Red")
    return { label: "At risk", detail: detail || "Sharp attendance drop" };
  if (risk.s7 === 0 && (sequence.at(-2) > 0 || risk.s30 > 0))
    return {
      label: "Early warning",
      detail: "First observed zero after recent attendance",
    };
  if (risk.priority === "Yellow")
    return { label: "At risk", detail: "Attendance is declining" };
  if (risk.priority === "Watch")
    return {
      label: "Monitoring",
      detail: "Still attending; below membership target",
    };
  return {
    label: "Needs context",
    detail: "Check missing history or engagement before deciding",
  };
}
