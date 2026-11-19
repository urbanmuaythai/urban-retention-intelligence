import { addDays } from "./domain.js";
import { fringeContacts } from "./fringe.js";

// Same bands as the Monday Pipeline Party dashboard.
export const BANDS = [
  { label: "0 sessions", status: "Critical", tone: "band-0" },
  { label: "1 session", status: "At Risk", tone: "band-1" },
  { label: "2 sessions", status: "Low", tone: "band-2" },
  { label: "3 sessions", status: "Okay", tone: "band-3" },
  { label: "4+ sessions", status: "Good", tone: "band-4" },
];

const sum = (a, b) => a.map((n, i) => n + b[i]);

/**
 * One report week: attendance bands, engagement groups, reach-out coverage and
 * the 7-day attendance window. Weeks imported before Fringe fall back to the saved
 * attendance snapshot (bands only, no Adults/U18 split). Null when nothing is saved.
 */
export function fringeWeekReport(data, week) {
  const report = data.weeks.find((w) => w.week === week);
  if (!report) return null;
  const asOf = report.import_summary?.asOf || week;
  const period = { week, asOf, from: addDays(asOf, -6) };
  const fringe = report.import_summary?.fringe;
  if (fringe?.groups) {
    const { Adults, U18 } = fringe.groups;
    const contacts = fringeContacts(data.fringeOutreach, week);
    const contacted = fringe.members.filter((m) => contacts.get(m.member_id)?.contacted_on).length;
    const validated = fringe.members.filter((m) => contacts.get(m.member_id)?.validated).length;
    const combined = Object.fromEntries(
      ["sleepers", "fringe", "engaged", "review"].map((k) => [k, Adults[k] + U18[k]]),
    );
    combined.bands = sum(Adults.bands, U18.bands);
    return {
      ...period,
      source: "fringe",
      bands: combined.bands,
      groups: { Combined: combined, Adults, U18 },
      fringe: fringe.members.length,
      contacted,
      validated,
    };
  }
  const snapshot = Array.isArray(report.attendance_snapshot) ? report.attendance_snapshot : [];
  if (!snapshot.length) return { ...period, source: null };
  const bands = [0, 0, 0, 0, 0];
  for (const r of snapshot) bands[Math.min(r.s7, 4)]++;
  return { ...period, source: "snapshot", bands, groups: null, fringe: null, contacted: null, validated: null };
}

export function fringeReportingView(data, week, { esc, fmt, icon }) {
  const weeks = [...data.weeks].sort((a, b) => b.week.localeCompare(a.week));
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const heading = `<div class="page-heading"><div><div class="eyebrow">KEEP THEM ON TRACK</div><h1>Fringe reporting<span class="heading-dot">.</span></h1><p>How many members trained 0, 1, 2, 3 or 4+ times this week, and how many Fringe members the team reached.</p></div><label class="week-control">${icon("calendar-days")}<span><small>REPORT WEEK</small><select id="week" aria-label="Report week">${weeks.map((w) => `<option value="${esc(w.week)}" ${w.week === week ? "selected" : ""}>${fmt(w.week)}</option>`).join("")}</select></span></label></div>`;
  const r = fringeWeekReport(data, week);
  if (!r || !r.source)
    return `${heading}<section class="queue-panel reporting-empty"><h2>No attendance saved for this week</h2><p>An administrator can import this week's four Clubworx CSVs to start Fringe reporting.</p></section>`;

  const total = r.bands.reduce((a, b) => a + b, 0);
  const period = `<p class="report-period">Reporting period: week beginning <strong>${fmt(r.week)}</strong> · attendance for the 7 days <strong>${fmt(r.from)} – ${fmt(r.asOf)}</strong> · Clubworx data as of ${fmt(r.asOf)}</p>`;

  const ring = (value, tone) =>
    `<div class="report-ring ${tone}" style="--value:${value ?? 0}" role="img" aria-label="${value === null ? "—" : value + "%"}"><span>${value === null ? "—" : Math.round(value) + "%"}</span></div>`;
  const hero =
    r.source === "fringe"
      ? `<section class="report-hero" aria-label="This week at a glance"><article class="report-hero-card">${ring(r.fringe ? Math.round((r.contacted / r.fringe) * 100) : null, "gold")}<div><small>FRINGE CONTACT COVERAGE</small><strong>${r.contacted} of ${r.fringe}</strong><p>Fringe members contacted · ${r.validated} validated</p></div></article><article class="report-hero-card red">${ring(pct(r.bands[0], total), "red")}<div><small>CRITICAL · 0 SESSIONS</small><strong>${r.bands[0]} of ${total}</strong><p>Tracked members with no sessions (on At Risk)</p></div></article></section>`
      : `<p class="scope-note">${icon("info")} This week was imported before the Fringe tab, so only the session bands are shown (no Adults / U18 split or reach-outs). Import the week again for the full report.</p>`;

  const bandRows = BANDS.map((b, i) => {
    const adults = r.groups?.Adults.bands[i],
      u18 = r.groups?.U18.bands[i];
    return `<tr><td><span class="band-dot ${b.tone}"></span>${b.label}</td><td><strong>${r.bands[i]}</strong></td><td>${pct(r.bands[i], total)}%</td><td><span class="band-pill ${b.tone}">${b.status}</span></td>${r.groups ? `<td>${adults}</td><td>${u18}</td>` : ""}<td class="band-bar-cell"><span class="report-track"><span class="report-fill ${b.tone}" style="width:${pct(r.bands[i], Math.max(...r.bands))}%"></span></span></td></tr>`;
  }).join("");
  const bandCard = `<section class="queue-panel report-card band-card"><div class="report-card-head"><h2>Sessions in the last 7 days</h2><span class="report-card-note">${total} active members tracked</span></div><div class="table-scroll"><table class="band-table"><thead><tr><th>SESSIONS / 7 DAYS</th><th># MEMBERS</th><th>% OF ACTIVE</th><th>STATUS</th>${r.groups ? "<th>ADULTS</th><th>U18</th>" : ""}<th><span class="sr-only">Share</span></th></tr></thead><tbody>${bandRows}</tbody></table></div></section>`;

  const groupCard = r.groups
    ? `<section class="queue-panel report-card"><div class="report-card-head"><h2>Weekly engagement</h2><span class="report-card-note">From each membership's weekly target</span></div><div class="table-scroll"><table class="band-table"><thead><tr><th>GROUP</th><th>SLEEPERS</th><th>FRINGE</th><th>ENGAGED</th><th>NEEDS REVIEW</th><th>TOTAL</th><th>FRINGE %</th></tr></thead><tbody>${Object.entries(r.groups)
        .map(([name, g]) => {
          const t = g.sleepers + g.fringe + g.engaged + g.review;
          return `<tr><td><strong>${name === "U18" ? "U18 · Kids & Teens" : name}</strong></td><td>${g.sleepers}</td><td><strong>${g.fringe}</strong></td><td>${g.engaged}</td><td>${g.review}</td><td>${t}</td><td>${pct(g.fringe, t)}%</td></tr>`;
        })
        .join("")}</tbody></table></div></section>`
    : "";

  const history = weeks.slice(0, 12).map((w) => fringeWeekReport(data, w.week)).filter((h) => h?.source);
  const trend = `<section class="queue-panel report-card"><div class="report-card-head"><h2>Week by week</h2><span class="report-card-note">Members per band · tap a week</span></div><div class="table-scroll"><table class="band-table"><thead><tr><th>WEEK</th>${BANDS.map((b) => `<th><span class="band-dot ${b.tone}"></span>${b.label.replace(" sessions", "").replace(" session", "")}</th>`).join("")}<th>TRACKED</th><th>FRINGE</th><th>CONTACTED</th></tr></thead><tbody>${history
    .map(
      (h) =>
        `<tr class="${h.week === week ? "current" : ""}"><td><button type="button" class="link-button" data-report-week="${esc(h.week)}">${fmt(h.week)}</button></td>${h.bands.map((n) => `<td>${n}</td>`).join("")}<td>${h.bands.reduce((a, b) => a + b, 0)}</td><td>${h.fringe ?? "—"}</td><td>${h.contacted ?? "—"}</td></tr>`,
    )
    .join("")}</tbody></table></div></section>`;

  return `${heading}${period}${hero}<div class="report-grid fringe-report-grid">${bandCard}${groupCard}${trend}</div><details class="risk-guide report-definitions"><summary>${icon("info")} How Fringe reporting is counted</summary><p class="risk-guide-note"><strong>Bands:</strong> sessions in Clubworx's last-7-days attendance at the export, the same as the Pipeline Party dashboard: 0 = Critical, 1 = At Risk, 2 = Low, 3 = Okay, 4+ = Good. Kickstarters, trials, sponsored, PT, class passes, part payments, deposits, Thailand Tour and members with a current suspension are not tracked.</p><p class="risk-guide-note"><strong>Engagement:</strong> Sleepers = 0 sessions; Fringe = 1+ but under the membership's weekly target; Engaged = at or over target; Needs review = membership has no target.</p><p class="risk-guide-note"><strong>Contacted:</strong> a Fringe member with a reach-out method and date saved against that report week.</p></details>`;
}
