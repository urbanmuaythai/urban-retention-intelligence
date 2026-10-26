export const STATUS = {
  open: "To reach out",
  contacted: "Contacted",
  booked: "Session booked",
  completed: "Handled",
  snoozed: "Exempt / paused",
};
export const norm = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function brisbaneToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function disposition(memberId, week, events) {
  const history = events
    .filter((e) => e.member_id === memberId && e.week <= week)
    .sort((a, b) => b.sequence - a.sequence);
  const last = history.find((e) => e.status);
  if (!last) return { status: "open", suppressed: false, history, last: null };
  const paused = ["completed", "snoozed"].includes(last.status);
  const suppressed =
    paused && !!last.suppress_through && last.suppress_through >= week;
  return {
    status: paused && !suppressed ? "open" : last.status,
    suppressed,
    history,
    last,
    reopened: paused && !suppressed,
  };
}
export function projectRows(risks, events, week) {
  const rank = { Red: 0, Yellow: 1, Watch: 2 };
  return risks
    .filter((r) => r.week === week)
    .map((r) => ({ ...r, ...disposition(r.member_id, week, events) }))
    .sort(
      (a, b) =>
        rank[a.priority] - rank[b.priority] ||
        a.s7 - b.s7 ||
        (a.member?.full_name || a.member_id).localeCompare(
          b.member?.full_name || b.member_id,
        ),
    );
}
export function validateAction(action, week) {
  if (!action.body?.trim())
    throw Error("Add a note so the next team member has context.");
  if (action.body.length > 4000)
    throw Error("Notes must be 4,000 characters or fewer.");
  if (action.status && !(action.status in STATUS))
    throw Error("Choose a valid outcome.");
  if (
    ["completed", "snoozed"].includes(action.status) &&
    (!action.suppress_through || action.suppress_through < week)
  )
    throw Error("Choose an exemption ending on or after this report week.");
  if (
    action.suppress_through &&
    !["completed", "snoozed"].includes(action.status)
  )
    throw Error("An exemption needs a Handled or Exempt outcome.");
  if (action.status === "snoozed" && !action.follow_up_on)
    throw Error("Set a follow-up date for paused cases.");
}
export function validateImport(payload) {
  if (payload.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(payload.week ?? ""))
    throw Error("Expected a version 1 weekly outreach export.");
  const date = new Date(payload.week + "T12:00:00Z");
  if (
    Number.isNaN(+date) ||
    date.toISOString().slice(0, 10) !== payload.week ||
    date.getUTCDay() !== 1
  )
    throw Error("Report week must be a valid Monday.");
  if (
    !Array.isArray(payload.members) ||
    payload.members.length === 0 ||
    payload.members.length > 5000
  )
    throw Error("Import must contain 1–5,000 risk members.");
  const keys = new Set();
  for (const m of payload.members) {
    if (
      !m.member_id ||
      !m.name?.trim() ||
      !["Red", "Yellow", "Watch"].includes(m.priority) ||
      !m.signal
    )
      throw Error("Every member needs an ID, name, priority and risk signal.");
    if (keys.has(m.member_id))
      throw Error("Duplicate member ID: " + m.member_id);
    keys.add(m.member_id);
    for (const k of ["s7", "s30"])
      if (!Number.isInteger(m[k]) || m[k] < 0)
        throw Error("Attendance counts must be non-negative integers.");
    if (
      m.sequence &&
      (!Array.isArray(m.sequence) ||
        m.sequence.some((x) => x !== null && (!Number.isInteger(x) || x < 0)))
    )
      throw Error("Invalid attendance history.");
  }
  return payload;
}
