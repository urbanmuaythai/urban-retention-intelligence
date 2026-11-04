import { disposition, STATUS } from "./domain.js";
import { attendanceStage, ATTENDANCE_STAGES } from "./attendance-stage.js";

const PRIORITIES = ["Red", "Yellow", "Watch", "Review"];

function cohortFor(data, week) {
  return new Map(
    data.risks.filter((r) => r.week === week).map((r) => [r.member_id, r]),
  );
}

function contactedIn(data, week, cohort) {
  return new Set(
    data.events
      .filter(
        (e) =>
          e.week === week &&
          ["contacted", "booked"].includes(e.status) &&
          cohort.has(e.member_id),
      )
      .map((e) => e.member_id),
  );
}

export function weeklyOutreachReport(data, week) {
  const cohort = cohortFor(data, week);
  const contacted = contactedIn(data, week, cohort);
  const summarize = (priority) => {
    const members = [...cohort.values()].filter(
      (r) => !priority || r.priority === priority,
    );
    const contacts = members.filter((r) => contacted.has(r.member_id)).length;
    const held = members.filter(
      (r) => disposition(r.member_id, week, data.events).suppressed,
    );
    return {
      priority: priority || "All priorities",
      flagged: members.length,
      contacted: contacts,
      noContact: members.length - contacts,
      coverage: members.length
        ? Math.round((contacts / members.length) * 100)
        : null,
      held: held.length,
      // Still waiting: no contact recorded and not handled/exempt this week.
      outstanding: members.filter(
        (r) => !contacted.has(r.member_id) && !held.includes(r),
      ).length,
    };
  };
  return {
    week,
    priorities: PRIORITIES.map(summarize),
    total: summarize(null),
  };
}

// Attendance stage of every flagged member, with how many had contact.
export function stageBreakdown(data, week) {
  const cohort = cohortFor(data, week);
  const contacted = contactedIn(data, week, cohort);
  const counts = new Map(
    ATTENDANCE_STAGES.map((s) => [s, { stage: s, flagged: 0, contacted: 0 }]),
  );
  for (const r of cohort.values()) {
    const row = counts.get(attendanceStage(r).label);
    if (!row) continue;
    row.flagged++;
    if (contacted.has(r.member_id)) row.contacted++;
  }
  return [...counts.values()].filter((r) => r.flagged);
}

// Outcomes and notes saved against the report week, overall and per team member.
export function weekActivity(data, week) {
  const events = data.events.filter((e) => e.week === week);
  const outcomes = Object.fromEntries(Object.keys(STATUS).map((k) => [k, 0]));
  let notes = 0;
  const team = new Map();
  for (const e of events) {
    if (e.status && e.status in outcomes) outcomes[e.status]++;
    if (String(e.body ?? "").trim()) notes++;
    const name = e.author || "Urban Team";
    const t = team.get(name) || { name, updates: 0, members: new Set() };
    t.updates++;
    t.members.add(e.member_id);
    team.set(name, t);
  }
  return {
    updates: events.length,
    outcomes,
    notes,
    team: [...team.values()]
      .map((t) => ({ name: t.name, updates: t.updates, members: t.members.size }))
      .sort((a, b) => b.updates - a.updates || a.name.localeCompare(b.name)),
  };
}

export function reportingView(data, week, { esc, fmt, icon }) {
  const weeks = [...data.weeks].sort((a, b) => b.week.localeCompare(a.week));
  const report = weeklyOutreachReport(data, week);
  const red = report.priorities[0];
  const all = report.total;
  const selected = weeks.find((w) => w.week === week);
  const percentage = (value) => (value === null ? "—" : value + "%");
  const share = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const heading = `<div class="page-heading"><div><div class="eyebrow">EVERY CHECK-IN COUNTS</div><h1>Weekly reporting<span class="heading-dot">.</span></h1><p>How many flagged members the team reached this week.</p></div><label class="week-control">${icon("calendar-days")}<span><small>REPORT WEEK</small><select id="week" aria-label="Report week">${weeks.map((w) => `<option value="${esc(w.week)}" ${w.week === week ? "selected" : ""}>${fmt(w.week)}</option>`).join("")}</select></span></label></div>`;
  if (!weeks.length)
    return `${heading}<section class="queue-panel reporting-empty"><h2>No weekly reports yet</h2><p>Import your first weekly reports from Weekly outreach to start reporting.</p></section>`;

  const ring = (value, tone) =>
    `<div class="report-ring ${tone}" style="--value:${value ?? 0}" role="img" aria-label="${percentage(value)} contacted"><span>${percentage(value)}</span></div>`;
  const hero = `<section class="report-hero" aria-label="This week at a glance">
    <article class="report-hero-card red">${ring(red.coverage, "red")}<div><small>RED CONTACT COVERAGE</small><strong>${red.contacted} of ${red.flagged}</strong><p>Red members contacted this week</p></div></article>
    <article class="report-hero-card">${ring(all.coverage, "gold")}<div><small>ALL PRIORITIES</small><strong>${all.contacted} of ${all.flagged}</strong><p>Flagged members contacted</p></div></article>
  </section>
  <section class="report-stats" aria-label="Weekly totals">
    ${[
      [all.flagged, "Flagged", "users", ""],
      [all.contacted, "Contacted", "check", "green"],
      [all.outstanding, "Still to reach", "inbox", "red"],
      [all.held, "Handled / exempt", "circle-check", ""],
    ]
      .map(
        ([n, label, ic, tone]) =>
          `<div class="report-stat ${tone}">${icon(ic)}<strong>${n}</strong><span>${label}</span></div>`,
      )
      .join("")}
  </section>`;

  const priorities = `<section class="queue-panel report-card reporting-panel"><div class="report-card-head"><h2>By priority</h2><button class="button secondary" id="report-open-red">View Red outreach</button></div><div class="priority-bars">${report.priorities
    .map(
      (p) =>
        `<button class="priority-bar" type="button" data-report-priority="${p.priority}" data-flagged="${p.flagged}" data-contacted="${p.contacted}" data-no-contact="${p.noContact}" data-coverage="${percentage(p.coverage)}" data-held="${p.held}" aria-label="${p.priority}: ${p.contacted} of ${p.flagged} contacted, open list"><span class="priority-bar-top"><span class="priority-pill ${p.priority.toLowerCase()}">${p.priority}</span><span class="priority-bar-figure"><strong>${p.contacted}</strong> / ${p.flagged} contacted · <b>${percentage(p.coverage)}</b></span></span><span class="report-track"><span class="report-fill ${p.priority.toLowerCase()}" style="width:${share(p.contacted, p.flagged)}%"></span></span><span class="priority-bar-foot">${p.outstanding} still to reach · ${p.held} handled / exempt ${icon("arrow-right")}</span></button>`,
    )
    .join("")}</div></section>`;

  const stages = stageBreakdown(data, week);
  const maxStage = Math.max(1, ...stages.map((s) => s.flagged));
  const stageCard = `<section class="queue-panel report-card"><div class="report-card-head"><h2>Attendance stage</h2><span class="report-card-note">Flagged · contacted</span></div><div class="stage-bars">${
    stages.length
      ? stages
          .map(
            (s) =>
              `<div class="stage-bar"><span class="stage-bar-label">${esc(s.stage)}</span><span class="report-track"><span class="report-fill muted" style="width:${share(s.flagged, maxStage)}%"><span class="report-fill gold" style="width:${share(s.contacted, s.flagged)}%"></span></span></span><span class="stage-bar-figure">${s.flagged} · ${s.contacted}</span></div>`,
          )
          .join("")
      : '<p class="report-empty-line">No flagged members this week.</p>'
  }</div></section>`;

  const activity = weekActivity(data, week);
  const activityCard = `<section class="queue-panel report-card"><div class="report-card-head"><h2>Team activity</h2><span class="report-card-note">${activity.updates} update${activity.updates === 1 ? "" : "s"} this week</span></div><div class="outcome-chips">${[
    ["contacted", "Contacted"],
    ["booked", "Session booked"],
    ["completed", "Handled"],
    ["snoozed", "Exempt / paused"],
  ]
    .map(
      ([k, label]) =>
        `<span class="outcome-chip"><strong>${activity.outcomes[k]}</strong>${label}</span>`,
    )
    .join(
      "",
    )}<span class="outcome-chip"><strong>${activity.notes}</strong>Notes</span></div>${
    activity.team.length
      ? `<ul class="team-list">${activity.team
          .map(
            (t) =>
              `<li><span class="avatar">${esc(
                t.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((x) => x[0])
                  .slice(0, 2)
                  .join(""),
              )}</span><span class="team-name">${esc(t.name)}</span><span class="team-figure"><strong>${t.updates}</strong> update${t.updates === 1 ? "" : "s"} · ${t.members} member${t.members === 1 ? "" : "s"}</span></li>`,
          )
          .join("")}</ul>`
      : '<p class="report-empty-line">No outcomes or notes saved for this week yet.</p>'
  }</section>`;

  const history = weeks.slice(0, 12).map((w) => {
    const r = weeklyOutreachReport(data, w.week);
    return { week: w.week, red: r.priorities[0], all: r.total };
  });
  const trend = `<section class="queue-panel report-card"><div class="report-card-head"><h2>Week by week</h2><span class="report-card-note">Red coverage · tap a week</span></div><div class="trend-chart" role="list">${[
    ...history,
  ]
    .reverse()
    .map(
      (h) =>
        `<button class="trend-bar ${h.week === week ? "current" : ""}" type="button" role="listitem" data-report-week="${esc(h.week)}" ${h.week === week ? 'aria-current="true"' : ""} aria-label="Week of ${fmt(h.week)}: Red coverage ${percentage(h.red.coverage)}"><span class="trend-value">${percentage(h.red.coverage)}</span><span class="trend-column"><span style="height:${h.red.coverage ?? 0}%"></span></span><span class="trend-label">${esc(fmt(h.week).replace(/ \d{4}$/, ""))}</span></button>`,
    )
    .join("")}</div><ul class="week-list">${history
    .map(
      (h) =>
        `<li class="${h.week === week ? "current" : ""}"><button type="button" class="week-row" data-report-week="${esc(h.week)}"><span class="week-row-date">${fmt(h.week)}</span><span class="week-row-figure"><span class="risk-dot red"></span>${h.red.contacted}/${h.red.flagged} Red</span><span class="week-row-figure">${h.all.contacted}/${h.all.flagged} all</span><b>${percentage(h.red.coverage)}</b></button></li>`,
    )
    .join("")}</ul></section>`;

  return `${heading}
  <p class="report-period">Week beginning <strong>${fmt(week)}</strong> · attendance data as of ${fmt(selected?.import_summary?.asOf || week)}</p>
  ${hero}
  <div class="report-grid">${priorities}${activityCard}${stageCard}${trend}</div>
  <details class="risk-guide report-definitions"><summary>${icon("info")} How reporting is counted</summary><p class="risk-guide-note"><strong>Contacted:</strong> a Contacted or Session booked outcome saved against that report week. Repeated contacts count once per member; a later note or reopen does not erase that contact. Notes only, Handled and Exempt / paused alone do not prove contact. Contact from an earlier report week does not count again.</p><p class="risk-guide-note"><strong>Flagged:</strong> all members in the saved risk report, including handled/exempt cases. Still to reach = no contact recorded and not handled/exempt. Handled / exempt can overlap Contacted. Coverage is contacted ÷ flagged; — means there is no cohort.</p><p class="risk-guide-note"><strong>History:</strong> totals use the latest saved report for each week and notes assigned to that report week, rather than the calendar date the note was entered. Reimporting a week can change its flagged cohort.</p></details>`;
}
