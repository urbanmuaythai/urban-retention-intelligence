import { disposition } from "./domain.js";

export function weeklyOutreachReport(data, week) {
  const cohort = new Map(
    data.risks.filter((r) => r.week === week).map((r) => [r.member_id, r]),
  );
  const contacted = new Set(
    data.events
      .filter(
        (e) =>
          e.week === week &&
          ["contacted", "booked"].includes(e.status) &&
          cohort.has(e.member_id),
      )
      .map((e) => e.member_id),
  );
  const summarize = (priority) => {
    const members = [...cohort.values()].filter(
      (r) => !priority || r.priority === priority,
    );
    const contacts = members.filter((r) => contacted.has(r.member_id)).length;
    return {
      priority: priority || "All priorities",
      flagged: members.length,
      contacted: contacts,
      noContact: members.length - contacts,
      coverage: members.length
        ? Math.round((contacts / members.length) * 100)
        : null,
      held: members.filter(
        (r) => disposition(r.member_id, week, data.events).suppressed,
      ).length,
    };
  };
  return {
    week,
    priorities: ["Red", "Yellow", "Watch", "Review"].map(summarize),
    total: summarize(null),
  };
}

export function reportingView(data, week, { esc, fmt, icon }) {
  const weeks = [...data.weeks].sort((a, b) => b.week.localeCompare(a.week));
  const report = weeklyOutreachReport(data, week);
  const red = report.priorities[0];
  const selected = weeks.find((w) => w.week === week);
  const percentage = (value) => (value === null ? "—" : value + "%");
  const row = (p, total = false) =>
    `<tr${total ? ' class="report-total"' : ""}><th scope="row">${total ? esc(p.priority) : `<span class="priority-pill ${p.priority.toLowerCase()}">${esc(p.priority)}</span>`}</th><td>${p.flagged}</td><td>${p.contacted}</td><td>${p.noContact}</td><td>${percentage(p.coverage)}</td><td>${p.held}</td></tr>`;
  return `<div class="page-heading"><div><div class="eyebrow">EVERY CHECK-IN COUNTS</div><h1>Weekly reporting<span class="heading-dot">.</span></h1><p>See who was flagged and how many members had contact recorded for each report week.</p></div><label class="week-control">${icon("calendar-days")}<span><small>REPORT WEEK</small><select id="week" aria-label="Report week">${weeks.map((w) => `<option value="${esc(w.week)}" ${w.week === week ? "selected" : ""}>${fmt(w.week)}</option>`).join("")}</select></span></label></div>
  ${
    !weeks.length
      ? '<section class="queue-panel reporting-empty"><h2>No weekly reports yet</h2><p>Import your first weekly reports from Weekly outreach to start reporting.</p></section>'
      : `
  <p class="report-period">Week beginning <strong>${fmt(week)}</strong> · attendance data as of ${fmt(selected?.import_summary?.asOf || week)} · latest saved report</p><p class="report-period">Contacted = Contacted or Session booked recorded for this report week.</p>
  <section class="metric-grid reporting-metrics" aria-label="Red outreach results">
    ${[
      [
        "Red members",
        red.flagged,
        "All Red cases in this weekly report",
        "red",
      ],
      [
        "Red contacted",
        red.contacted,
        "Unique Red members with contact recorded",
        "",
      ],
      [
        "No contact recorded",
        red.noContact,
        "Red cases without a contact outcome this week",
        "amber",
      ],
      [
        "Red contact coverage",
        percentage(red.coverage),
        red.flagged
          ? `${red.contacted} of ${red.flagged} Red members`
          : "No Red members in this report",
        "",
      ],
    ]
      .map(
        ([title, value, detail, tone]) =>
          `<article class="metric ${tone}"><div class="metric-top"><span>${title}</span></div><strong>${value}</strong><small>${detail}</small></article>`,
      )
      .join("")}
  </section>
  <section class="queue-panel reporting-panel"><div class="panel-heading"><div><h2>Reach-out by risk priority</h2><p>Unique members, counted once within this report week.</p></div><button class="button secondary" id="report-open-red">View Red outreach</button></div><p class="report-scroll-hint">Scroll sideways to see all results &rarr;</p><div class="table-scroll"><table class="report-table"><caption class="sr-only">Contact outcomes by risk priority for the selected report week</caption><thead><tr><th scope="col">PRIORITY</th><th scope="col">FLAGGED</th><th scope="col">CONTACTED</th><th scope="col">NO CONTACT RECORDED</th><th scope="col">COVERAGE</th><th scope="col">HANDLED / EXEMPT</th></tr></thead><tbody>${report.priorities.map((p) => row(p)).join("")}${row(report.total, true)}</tbody></table></div></section>
  <section class="queue-panel reporting-panel"><div class="panel-heading"><div><h2>Week-by-week history</h2><p>Choose a week to see its full priority breakdown.</p></div></div><p class="report-scroll-hint">Scroll sideways to see all results &rarr;</p><div class="table-scroll"><table class="report-table"><caption class="sr-only">Red contact coverage and all-priority contact totals by report week</caption><thead><tr><th scope="col">WEEK BEGINNING</th><th scope="col">RED FLAGGED</th><th scope="col">RED CONTACTED</th><th scope="col">NO RED CONTACT RECORDED</th><th scope="col">RED COVERAGE</th><th scope="col">ALL CONTACTED</th></tr></thead><tbody>${weeks
    .map((w) => {
      const r = weeklyOutreachReport(data, w.week),
        red = r.priorities[0];
      return `<tr${w.week === week ? ' class="report-selected"' : ""}><th scope="row"><button class="report-week-button" data-report-week="${esc(w.week)}" ${w.week === week ? 'aria-current="true"' : ""}>${fmt(w.week)}</button></th><td>${red.flagged}</td><td>${red.contacted}</td><td>${red.noContact}</td><td>${percentage(red.coverage)}</td><td>${r.total.contacted}</td></tr>`;
    })
    .join("")}</tbody></table></div></section>`
  }
  <details class="risk-guide report-definitions"><summary>${icon("info")} How reporting is counted</summary><p class="risk-guide-note"><strong>Contacted:</strong> a Contacted or Session booked outcome saved against that report week. Repeated contacts count once per member; a later note or reopen does not erase that contact. Notes only, Handled and Exempt / paused alone do not prove contact. Contact from an earlier report week does not count again.</p><p class="risk-guide-note"><strong>Flagged:</strong> all members in the saved risk report, including handled/exempt cases. No contact recorded is not automatically a task to reopen. Handled / exempt uses the exemption valid for that week and can overlap Contacted. Coverage is contacted ÷ flagged; — means there is no cohort.</p><p class="risk-guide-note"><strong>History:</strong> totals use the latest saved attendance/risk report for each week and notes assigned to that report week, rather than the calendar date the note was entered. Reimporting a week can change its flagged cohort. Attendance-only archives do not provide historical contact totals.</p></details>`;
}
