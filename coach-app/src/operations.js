import { addDays, norm, projectRows } from "./domain.js";

export function fridayPeriod(asOf) {
  const day = new Date(asOf + "T12:00:00Z").getUTCDay();
  const start = addDays(asOf, -((day + 2) % 7));
  return { start, end: addDays(start, 6) };
}

export function buildOperations(
  reports,
  week,
  asOf,
  policy = null,
  history = [],
) {
  const current = fridayPeriod(asOf);
  const periods = new Map();
  // One Monday record can contain both sides of a Friday rollover. Preserve both.
  for (const report of history.filter((w) => w.week === week))
    if (report.import_summary?.operations?.version === 2)
      for (const period of report.import_summary.operations.periods)
        if (period.sourceAsOf <= asOf) periods.set(period.start, period);
  for (const start of [addDays(current.start, -7), current.start]) {
    const end = addDays(start, 6),
      cutoff = asOf < end ? asOf : end;
    const inWindow = (date) => date && date >= start && date <= cutoff;
    const cancellations = reports.cancellations.rows
      .filter(
        (r) =>
          /^true$/i.test(r["Cancellation Present?"]) &&
          (inWindow(r["Membership Expiry Date"]) ||
            inWindow(r["Cancellation Date"])),
      )
      .map((r) => ({
        member_id: "clubworx:" + r["Contact ID"],
        name: r["Full Name"],
        membership_id: r["Membership ID"],
        membership: r["Membership Name"] || "",
        start: r["Membership Start Date"],
        end: r["Membership Expiry Date"] || null,
        recorded: r["Cancellation Date"] || null,
        reason: r["Cancellation Reason"] || "",
      }));
    const suspensionRows = reports.suspensions.rows.filter(
      (r) =>
        r["Suspension Starts"] <= cutoff &&
        (!r["Suspension Ends"] || r["Suspension Ends"] >= start),
    );
    const suspensions = [
      ...new Map(
        suspensionRows.map((r) => [
          JSON.stringify([
            r["Contact ID"],
            r["Suspension Starts"],
            r["Suspension Ends"],
          ]),
          r,
        ]),
      ).values(),
    ].map((r) => ({
      member_id: "clubworx:" + r["Contact ID"],
      name: r["Full Name"],
      start: r["Suspension Starts"],
      end: r["Suspension Ends"] || null,
    }));
    periods.set(start, {
      start,
      end,
      asOf: cutoff,
      sourceAsOf: asOf,
      cancellations,
      suspensions,
      policyApplied: policy?.version === 1,
    });
  }
  return {
    version: 2,
    week,
    asOf,
    calendar: "friday-thursday",
    periods: [...periods.values()].sort((a, b) =>
      b.start.localeCompare(a.start),
    ),
  };
}

export function operationWeek(report, periodStart = null) {
  const summary = report?.import_summary,
    data = summary?.operations;
  if (
    !data ||
    data.version !== 2 ||
    data.calendar !== "friday-thursday" ||
    data.week !== report.week ||
    data.asOf !== summary.asOf
  )
    return null;
  const key = periodStart || fridayPeriod(data.asOf).start;
  const period = data.periods.find((p) => p.start === key);
  if (
    !period ||
    fridayPeriod(period.start).start !== period.start ||
    period.end !== addDays(period.start, 6) ||
    period.asOf < period.start ||
    period.asOf > period.end ||
    period.asOf > period.sourceAsOf ||
    period.sourceAsOf > data.asOf
  )
    return null;
  const inWeek = (date) => date && date >= period.start && date <= period.asOf;
  const excluded = new Set(
    summary.retentionPolicy?.excludedMembershipIds || [],
  );
  const included = (r) =>
    norm(r.reason) !== "roll over" &&
    !excluded.has(r.membership_id) &&
    !/^thailand tour (deposit|final payment)$/.test(norm(r.membership));
  const suspensions = period.suspensions.filter(
    (r) => r.start <= period.asOf && (!r.end || r.end >= period.start),
  );
  return {
    ...period,
    cancellations: period.cancellations.filter(
      (r) => included(r) && inWeek(r.end),
    ),
    recorded: period.cancellations.filter(
      (r) => included(r) && inWeek(r.recorded),
    ),
    excludedInWeek: period.cancellations.filter(
      (r) => !included(r) && inWeek(r.end),
    ),
    suspensions,
    currentSuspensions: suspensions.filter(
      (r) => !r.end || r.end >= period.asOf,
    ),
    policyApplied:
      period.policyApplied && summary.retentionPolicy?.version === 1,
  };
}

export function operationPeriods(weeks) {
  const periods = new Map();
  for (const report of weeks)
    for (const candidate of report.import_summary?.operations?.version === 2
      ? report.import_summary.operations.periods
      : []) {
      const period = operationWeek(report, candidate.start);
      if (!period) continue;
      const old = periods.get(period.start);
      if (
        !old ||
        period.sourceAsOf > old.sourceAsOf ||
        (period.sourceAsOf === old.sourceAsOf &&
          (report.imported_at || "") > old.savedAt)
      )
        periods.set(period.start, {
          ...period,
          savedAt: report.imported_at || "",
        });
    }
  return [...periods.values()].sort((a, b) => b.start.localeCompare(a.start));
}

export function workspaceView(
  data,
  week,
  view,
  { esc, fmt, icon, operationPeriod },
) {
  const report = data.weeks.find((w) => w.week === week),
    summary = report?.import_summary || {},
    periods = operationPeriods(data.weeks),
    defaultPeriod = fridayPeriod(week),
    ops =
      periods.find(
        (p) => p.start === (operationPeriod || defaultPeriod.start),
      ) || null;
  const weeks = [...data.weeks].sort((a, b) => b.week.localeCompare(a.week));
  const names = {
    home: "Member care portal",
    cancellations: "Cancellations",
    suspensions: "Suspensions",
  };
  const operational = view !== "home";
  const picker = operational
    ? `<label class="week-control">${icon("calendar-days")}<span><small>FRI–THU PERIOD</small><select id="operation-period" aria-label="Friday to Thursday period">${periods.length ? periods.map((p) => `<option value="${esc(p.start)}" ${p.start === (ops?.start || defaultPeriod.start) ? "selected" : ""}>${fmt(p.start)} – ${fmt(p.end)}</option>`).join("") : `<option value="${defaultPeriod.start}">${fmt(defaultPeriod.start)} – ${fmt(defaultPeriod.end)}</option>`}</select></span></label>`
    : `<label class="week-control">${icon("calendar-days")}<span><small>AT RISK REPORT WEEK</small><select id="week" aria-label="Report week">${weeks.map((w) => `<option value="${esc(w.week)}" ${w.week === week ? "selected" : ""}>${fmt(w.week)}</option>`).join("")}</select></span></label>`;
  const header = `<div class="page-heading"><div><div class="eyebrow">URBAN MUAYTHAI · MEMBER CARE</div><h1>${names[view]}<span class="heading-dot">.</span></h1><p>${operational ? "Friday through Thursday · Australia/Brisbane" : "Choose where you would like to start."}</p></div><div class="heading-actions">${picker}${operational ? '<button class="button secondary" data-view="home">Back to portal</button>' : ""}</div></div>`;
  const range = ops || defaultPeriod;
  const rangeLabel = `Fri ${fmt(range.start)} – Thu ${fmt(range.end)}`;
  const period = operational
    ? `<p class="report-period"><strong>${rangeLabel}</strong>${ops ? ` · records through ${fmt(ops.asOf)} · source export ${fmt(ops.sourceAsOf)} · ${ops.asOf === ops.end ? "Complete period" : "Partial period"}` : " · details need reimporting"}</p>`
    : `<p class="report-period">At Risk Members: week beginning <strong>${fmt(week)}</strong>${report ? ` · data as of ${fmt(summary.asOf || week)}` : " · no import yet"}<br>Cancellations &amp; Suspensions: <strong>${rangeLabel}</strong>${ops && ops.asOf !== ops.end ? " · partial period" : ""}</p>`;
  const metric = (title, value, detail) =>
    `<article class="metric"><div class="metric-top"><span>${title}</span></div><strong>${value ?? "—"}</strong><small>${detail}</small></article>`;
  const unavailable =
    '<section class="queue-panel reporting-empty"><h2>Import details for this week</h2><p>This saved report does not include the detailed exports yet. An administrator can reimport the four CSVs; staff notes and exemptions are preserved.</p></section>';
  if (view === "home")
    return (
      header +
      period +
      `<section class="workspace-choices" aria-label="Choose a workspace section">${[
        [
          "queue",
          "At Risk Members",
          "Weekly outreach, follow-ups, handled cases and reporting in one workspace.",
          projectRows(data.risks, data.events, week).filter(
            (r) => !r.suppressed,
          ).length,
          "users",
        ],
        [
          "cancellations",
          "Cancellations",
          `Memberships ending ${rangeLabel}.`,
          ops?.policyApplied ? ops.cancellations.length : null,
          "flag",
        ],
        [
          "suspensions",
          "Suspensions",
          `Suspensions overlapping ${rangeLabel}.`,
          ops ? new Set(ops.suspensions.map((r) => r.member_id)).size : null,
          "calendar-clock",
        ],
      ]
        .map(
          ([id, title, detail, count, ic]) =>
            `<button class="workspace-choice" data-view="${id}"><span class="choice-icon">${icon(ic)}</span><span class="choice-heading">${title}</span><span class="choice-count">${count ?? "—"}</span><span class="choice-detail">${detail}</span><span class="choice-link">Open ${title} ${icon("arrow-right")}</span></button>`,
        )
        .join("")}</section>`
    );
  if (!ops) return header + period + unavailable;
  if (view === "cancellations" && !ops.policyApplied)
    return (
      header +
      period +
      '<section class="queue-panel reporting-empty"><h2>Retention exclusions need review</h2><p>The weekly cancellation KPI is held until the established administrative exclusions have been attached to this report. Raw cumulative export totals are not used as weekly cancellations.</p></section>'
    );
  let rows, columns, metrics, description;
  if (view === "cancellations") {
    rows = ops.cancellations.map((r) => [
      r.name,
      r.membership || "Not supplied",
      fmt(r.end),
      r.recorded ? fmt(r.recorded) : "Not supplied",
      r.reason || "Not supplied",
    ]);
    columns = [
      "MEMBER",
      "MEMBERSHIP",
      "EFFECTIVE END",
      "CANCELLATION RECORDED",
      "REASON",
    ];
    metrics =
      metric(
        "Memberships ended",
        ops.cancellations.length,
        "Effective end date within this week, through the cutoff",
      ) +
      metric(
        "Members affected",
        new Set(ops.cancellations.map((r) => r.member_id)).size,
        "Unique people; multiple memberships count once here",
      ) +
      metric(
        "Cancellation notices recorded",
        ops.recorded.length,
        "Recorded this week; effective end may be later",
      ) +
      metric(
        "Excluded records",
        ops.excludedInWeek.length,
        "Rollovers, configured admin cleanup and tour products",
      );
    description =
      "Weekly cancellations use the membership end date, not the date the cancellation was entered. Rollovers and configured administrative debt-cleanup records are excluded. People with another active plan may still have a membership ending here.";
  } else {
    rows = ops.suspensions.map((r) => [
      r.name,
      fmt(r.start),
      r.end ? fmt(r.end) : "Open-ended",
      r.end && r.end < ops.asOf ? "Ended this week" : "Current at cutoff",
    ]);
    columns = ["MEMBER", "SUSPENSION START", "SUSPENSION END", "STATUS"];
    metrics =
      metric(
        "Members suspended this week",
        new Set(ops.suspensions.map((r) => r.member_id)).size,
        "Any suspension overlapping Friday through the cutoff",
      ) +
      metric(
        "Current at cutoff",
        new Set(ops.currentSuspensions.map((r) => r.member_id)).size,
        "Unique members with an active suspension",
      ) +
      metric(
        "Suspension periods",
        ops.suspensions.length,
        "Multiple periods for one member can appear",
      ) +
      metric(
        "Periods started this week",
        ops.suspensions.filter(
          (r) => r.start >= ops.start && r.start <= ops.asOf,
        ).length,
        "Suspension start dates within this Friday–Thursday period",
      );
    description =
      "This list shows source suspension periods overlapping the selected week through its cutoff. The risk queue holds only eligible training members, so its held count can differ from the full suspension list.";
  }
  return (
    header +
    period +
    `<section class="metric-grid">${metrics}</section><p class="scope-note">${icon("info")} ${description}</p><section class="queue-panel reporting-panel"><div class="panel-heading"><div><h2>${view === "cancellations" ? "Memberships ending this week" : "Suspensions during this week"}</h2><p>${rows.length} records · ${rangeLabel} · through ${fmt(ops.asOf)}</p></div></div><p class="report-scroll-hint">Scroll sideways to see all details &rarr;</p><div class="table-scroll"><table><thead><tr>${columns.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}"><div class="empty"><h3>No records for this week</h3><p>This is an imported result for the selected period, not a missing-file placeholder.</p></div></td></tr>`}</tbody></table></div></section>`
  );
}

export function portalView(data, week, helpers) {
  const { esc, icon, logo, photo, user, demo } = helpers;
  return `<div class="member-portal" style="--portal-photo:url('${photo}')"><header class="portal-header"><div class="portal-brand"><img src="${logo}" alt="Urban Muaythai" width="72" height="72"><div><strong>URBAN MUAYTHAI</strong><span>STAFF PORTAL</span></div></div><div class="portal-account"><span>${esc(user.display_name)}</span><button class="icon-button" id="refresh" aria-label="Refresh workspace">${icon("refresh-cw")}</button><button class="button secondary" id="${demo ? "go-login" : "signout"}">${icon("log-out")} Sign out</button></div></header>${demo ? '<p class="portal-preview">Sample workspace · fictional members</p>' : ""}<main class="portal-main">${workspaceView(data, week, "home", helpers)}</main><footer class="portal-footer">REAL MUAYTHAI. REAL FITNESS. REAL COMMUNITY.<span>Approved staff access · Urban Member Care</span></footer></div><dialog id="member-dialog" class="member-dialog" aria-labelledby="member-title"></dialog><dialog id="import-dialog" class="import-dialog" aria-labelledby="import-title"></dialog>`;
}
