import { addDays, norm } from "./domain.js";

function family(name) {
  const n = norm(name);
  if (n.includes("accelerate")) return "accelerate";
  if (/fun (and )?fitness/.test(n)) return "fun-fitness";
  if (/teen|15 18|u18/.test(n)) return "teens";
  if (/kids|junior/.test(n)) return "kids";
  if (n.includes("kickstarter")) return "kickstarter";
  if (n.includes("upfront")) return "upfront";
  return n;
}

export function resolveHistory(week, asOf, history = [], baselines = []) {
  return Array.from({ length: 5 }, (_, i) => {
    const reportWeek = addDays(week, (i - 5) * 7);
    const expectedCutoff = addDays(asOf, (i - 5) * 7);
    const exact = history.find(
      (w) =>
        w.week === reportWeek &&
        (w.import_summary?.asOf || w.week) === expectedCutoff &&
        w.attendance_snapshot?.length,
    );
    if (exact)
      return {
        date: expectedCutoff,
        archived: false,
        rows: new Map(exact.attendance_snapshot.map((r) => [r.member_id, r])),
      };
    const archive = baselines.find(
      (b) =>
        b.as_of === reportWeek &&
        b.metadata?.kind === "archived-weekly-summary" &&
        Math.abs(Date.parse(expectedCutoff) - Date.parse(b.as_of)) <= 86400000,
    );
    if (archive)
      return {
        date: archive.as_of,
        archived: true,
        rows: new Map(archive.snapshot.map((r) => [r.member_id, r])),
      };
    return { date: expectedCutoff, archived: false, rows: new Map() };
  });
}

export function archivedEngagement(memberId, asOf, plans, baselines = []) {
  const candidates = baselines
    .filter((b) => b.as_of <= asOf && b.as_of >= addDays(asOf, -14))
    .sort((a, b) => b.as_of.localeCompare(a.as_of));
  for (const baseline of candidates) {
    const row = baseline.snapshot.find(
      (r) => r.member_id === memberId && r.engagement,
    );
    if (
      row &&
      plans.some((p) => family(p["Membership Name"]) === family(row.membership))
    )
      return { value: row.engagement, asOf: baseline.as_of };
  }
  return null;
}
