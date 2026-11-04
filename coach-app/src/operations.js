import { addDays, norm, projectRows } from "./domain.js";
import { categoriseCancellation } from "./cancellation-category.js";

/** Cancellation date = the first day the member is no longer active (expiry + 1), as in the Cancellation Analysis sheet. */
export const cancellationDate = (r) => (r.end ? addDays(r.end, 1) : null);

/** Category for a saved cancellation; a membership change is never counted. */
const categorise = (r) =>
  r.changedPlan || /upgrad|downgrad/i.test(r.reason || "")
    ? { counted: false, group: "Not counted", type: "Membership change" }
    : categoriseCancellation(r.membership);

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
  // A cancelled plan whose member still holds another active plan is a membership change
  // (upgrade / downgrade / switch), not someone leaving.
  const activePlans = new Map();
  for (const r of reports.active?.rows || [])
    if (/^true$/i.test(r["Membership Active?"] ?? "true")) {
      const id = r["Contact ID"];
      if (!activePlans.has(id)) activePlans.set(id, new Set());
      activePlans.get(id).add(r["Membership ID"]);
    }
  const toCancellation = (r) => ({
    member_id: "clubworx:" + r["Contact ID"],
    name: r["Full Name"],
    membership_id: r["Membership ID"],
    membership: r["Membership Name"] || "",
    start: r["Membership Start Date"],
    end: r["Membership Expiry Date"] || null,
    recorded: r["Cancellation Date"] || null,
    reason: r["Cancellation Reason"] || "",
    changedPlan: [...(activePlans.get(r["Contact ID"]) || [])].some(
      (id) => id !== r["Membership ID"],
    ),
  });
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
          (inWindow(
            r["Membership Expiry Date"] &&
              addDays(r["Membership Expiry Date"], 1),
          ) ||
            inWindow(r["Cancellation Date"])),
      )
      .map(toCancellation);
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
  const archive = new Map();
  for (const report of history.filter((r) => r.week === week))
    for (const old of report.import_summary?.operations?.cancellationHistory ||
      [])
      if (old.sourceAsOf <= asOf) archive.set(old.start, old);
  const allCancellations = reports.cancellations.rows
    .filter((r) => /^true$/i.test(r["Cancellation Present?"]))
    .map(toCancellation);
  // Do not manufacture older zero totals before any dated cancellation record.
  const sourceDates = allCancellations
    .map(cancellationDate)
    .filter((d) => d && d <= asOf)
    .sort();
  const earliest = sourceDates[0] || current.start;
  const oldestStart = fridayPeriod(earliest).start;
  for (let i = 0; i < 12; i++) {
    const start = addDays(current.start, -i * 7),
      end = addDays(start, 6),
      cutoff = asOf < end ? asOf : end;
    if (start < oldestStart && i > 1) continue;
    const within = (d) => d && d >= start && d <= cutoff;
    archive.set(start, {
      start,
      end,
      asOf: cutoff,
      sourceAsOf: asOf,
      sourceCoverageStart: earliest,
      cancellations: allCancellations.filter(
        (r) => within(cancellationDate(r)) || within(r.recorded),
      ),
      suspensions: [],
      policyApplied: policy?.version === 1,
    });
  }
  return {
    version: 2,
    week,
    asOf,
    calendar: "friday-thursday",
    cancellationArchiveVersion: 1,
    cancellationHistory: [...archive.values()].sort((a, b) =>
      b.start.localeCompare(a.start),
    ),
    scheduledCancellations: allCancellations.filter(
      (r) => r.end && cancellationDate(r) > asOf,
    ),
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
  // Saved periods were cut by expiry date; a cancellation date (expiry + 1) can sit in the
  // next period, so look across everything saved with this report.
  const pool = [
    ...new Map(
      [
        ...data.periods,
        ...(data.cancellationHistory || []),
        ...(data.scheduledCancellations
          ? [{ cancellations: data.scheduledCancellations }]
          : []),
      ]
        .flatMap((p) => p.cancellations || [])
        .map((r) => [r.membership_id, r]),
    ).values(),
  ].map((r) => ({
    ...r,
    cancelled: cancellationDate(r),
    ...categorise(r),
  }));
  const cancellations = pool.filter((r) => included(r) && inWeek(r.cancelled));
  return {
    ...period,
    cancellations,
    autopay: cancellations.filter((r) => r.counted),
    recorded: pool.filter((r) => included(r) && inWeek(r.recorded)),
    excludedInWeek: pool.filter((r) => !included(r) && inWeek(r.cancelled)),
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

export function cancellationPeriods(weeks) {
  return operationPeriods(
    weeks.map((report) => {
      const source = report.import_summary?.operations;
      if (!source?.cancellationHistory) return report;
      return {
        ...report,
        import_summary: {
          ...report.import_summary,
          operations: { ...source, periods: source.cancellationHistory },
        },
      };
    }),
  );
}

export function upcomingCancellations(weeks) {
  const report = [...weeks].sort(
    (a, b) =>
      (b.import_summary?.asOf || b.week).localeCompare(
        a.import_summary?.asOf || a.week,
      ) || (b.imported_at || "").localeCompare(a.imported_at || ""),
  )[0];
  const summary = report?.import_summary,
    source = summary?.operations;
  if (
    source?.cancellationArchiveVersion !== 1 ||
    !Array.isArray(source.scheduledCancellations) ||
    source.asOf !== summary.asOf
  )
    return null;
  const excluded = new Set(
    summary.retentionPolicy?.excludedMembershipIds || [],
  );
  return {
    asOf: source.asOf,
    policyApplied: summary.retentionPolicy?.version === 1,
    rows: source.scheduledCancellations
      .filter(
        (r) =>
          cancellationDate(r) > source.asOf &&
          !excluded.has(r.membership_id) &&
          norm(r.reason) !== "roll over" &&
          !/^thailand tour (deposit|final payment)$/.test(norm(r.membership)),
      )
      .map((r) => ({
        ...r,
        cancelled: cancellationDate(r),
        ...categorise(r),
      }))
      .sort(
        (a, b) => a.end.localeCompare(b.end) || a.name.localeCompare(b.name),
      ),
  };
}

const NOT_COUNTED_TYPES = [
  "Membership change",
  "Kickstarter",
  "Trial",
  "Short Term",
  "Upfront",
  "Casual / class pass",
  "Deposit / part payment",
  "Sponsored",
];
/** "Autopay · Adults" or "Not counted · Kickstarter" */
const categoryLabel = (r) =>
  r.counted ? `Autopay · ${r.group}` : `Not counted · ${r.type}`;
/** "2 Adults · 1 Kids" in the given order, skipping zeros */
const breakdown = (rows, order) =>
  order
    .map((t) => [t, rows.filter((r) => r.type === t).length])
    .filter(([, n]) => n)
    .map(([t, n]) => `${n} ${t}`)
    .join(" · ");

export function cancellationReporting(weeks, periods, selected, { esc, fmt }) {
  const upcoming = upcomingCancellations(weeks);
  const history = `<section class="queue-panel reporting-panel"><div class="panel-heading"><div><h2>Weekly cancellation history</h2><p>Friday–Thursday · cancellation dates (last day + 1) · autopay is the weekly KPI · choose a period to see its members.</p></div></div><div class="table-scroll"><table class="cancellation-history"><thead><tr><th>PERIOD</th><th>AUTOPAY</th><th>ALL</th><th>MEMBERS</th><th>STATUS</th></tr></thead><tbody>${periods.map((p) => `<tr${p.start === selected.start ? ' class="report-selected"' : ""}><th scope="row"><button class="report-week-button" data-operation-period="${p.start}">Fri ${fmt(p.start)} – Thu ${fmt(p.end)}</button></th><td>${p.policyApplied ? p.autopay.length : "—"}</td><td>${p.policyApplied ? p.cancellations.length : "—"}</td><td>${p.policyApplied ? new Set(p.cancellations.map((r) => r.member_id)).size : "—"}</td><td>${p.sourceCoverageStart > p.start ? "Source records from " + fmt(p.sourceCoverageStart) : p.asOf === p.end ? "Complete" : "Partial through " + fmt(p.asOf)}</td></tr>`).join("")}</tbody></table></div><p class="scope-note">History is calculated from dated export records, with up to 12 periods backfilled. Dates before the earliest supplied records are not shown as zero. It reflects the latest saved source for each period; late corrections can change past totals.</p></section>`;
  if (!upcoming?.policyApplied)
    return (
      history +
      '<section class="queue-panel reporting-empty"><h2>Upcoming cancellations</h2><p>Reimport the complete exports to load scheduled future ends and the approved retention exclusions.</p></section>'
    );
  const groups = new Map();
  for (const r of upcoming.rows) {
    const key = fridayPeriod(r.cancelled).start;
    const g = groups.get(key) || { autopay: 0, all: 0 };
    g.all++;
    if (r.counted) g.autopay++;
    groups.set(key, g);
  }
  return (
    history +
    `<section class="queue-panel reporting-panel"><div class="panel-heading"><div><h2>Upcoming cancellations</h2><p>${upcoming.rows.length} scheduled memberships · ${upcoming.rows.filter((r) => r.counted).length} autopay · latest export ${fmt(upcoming.asOf)}. These have not ended as of that export and may change.</p></div></div>${groups.size ? `<div class="table-scroll"><table><thead><tr><th>CANCELLATION WEEK · FRI–THU</th><th>AUTOPAY</th><th>ALL</th></tr></thead><tbody>${[...groups].map(([start, g]) => `<tr><td>${fmt(start)} – ${fmt(addDays(start, 6))}</td><td>${g.autopay}</td><td>${g.all}</td></tr>`).join("")}</tbody></table></div>` : ""}<div class="table-scroll"><table class="scheduled-cancellations"><thead><tr><th>MEMBER</th><th>MEMBERSHIP</th><th>CATEGORY</th><th>LAST DAY</th><th>REASON</th></tr></thead><tbody>${upcoming.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.membership || "Not supplied")}</td><td>${esc(categoryLabel(r))}</td><td>${fmt(r.end)}</td><td>${esc(r.reason || "Not supplied")}</td></tr>`).join("") || '<tr><td colspan="5">No scheduled future cancellations in the latest supplied export.</td></tr>'}</tbody></table></div></section>`
  );
}

export function workspaceView(
  data,
  week,
  view,
  { esc, fmt, icon, operationPeriod },
) {
  const report = data.weeks.find((w) => w.week === week),
    summary = report?.import_summary || {},
    periods =
      view === "cancellations"
        ? cancellationPeriods(data.weeks)
        : operationPeriods(data.weeks),
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
          `Autopay cancellations ${rangeLabel}.`,
          ops?.policyApplied ? ops.autopay.length : null,
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
    rows = [...ops.cancellations]
      .sort(
        (a, b) =>
          Number(b.counted) - Number(a.counted) || a.name.localeCompare(b.name),
      )
      .map((r) => [
        r.name,
        r.membership || "Not supplied",
        categoryLabel(r),
        fmt(r.end),
        fmt(r.cancelled),
        r.recorded ? fmt(r.recorded) : "Not supplied",
        r.reason || "Not supplied",
      ]);
    columns = [
      "MEMBER",
      "MEMBERSHIP",
      "CATEGORY",
      "LAST DAY",
      "CANCELLATION DATE",
      "CANCELLATION RECORDED",
      "REASON",
    ];
    const previous = periods.find((p) => p.start === addDays(ops.start, -7));
    const upcoming = upcomingCancellations(data.weeks);
    const comparable =
      ops.asOf === ops.end &&
      !(ops.sourceCoverageStart > ops.start) &&
      previous?.policyApplied &&
      previous.asOf === previous.end &&
      !(previous.sourceCoverageStart > previous.start);
    const change = comparable
      ? ops.autopay.length - previous.autopay.length
      : null;
    const notCounted = ops.cancellations.filter((r) => !r.counted);
    metrics =
      metric(
        "Autopay cancellations",
        ops.autopay.length,
        `${breakdown(ops.autopay, ["Adults", "Teens", "Kids"]) || "None"} · ${ops.asOf === ops.end ? "complete period" : "partial period"}`,
      ) +
      metric(
        "All cancellations",
        ops.cancellations.length,
        notCounted.length
          ? `Includes ${notCounted.length} not counted: ${breakdown(notCounted, NOT_COUNTED_TYPES)}`
          : "Every ending this week is autopay",
      ) +
      metric(
        "Previous week · autopay",
        previous?.policyApplied ? previous.autopay.length : null,
        previous
          ? `${fmt(previous.start)} – ${fmt(previous.end)} · all ${previous.cancellations.length}`
          : "No saved previous period",
      ) +
      metric(
        "Change vs previous",
        change === null ? null : (change > 0 ? "+" : "") + change,
        comparable
          ? "Autopay cancellations · complete periods"
          : "Available when both periods are complete",
      ) +
      metric(
        "Future scheduled",
        upcoming?.policyApplied
          ? upcoming.rows.filter((r) => r.counted).length
          : null,
        upcoming
          ? `Autopay · ${upcoming.rows.length} in all · not ended as of ${fmt(upcoming.asOf)}`
          : "Future cancellation export details unavailable",
      );
    description =
      "Autopay cancellations are the weekly KPI, counted the same way as the Cancellation Analysis sheet: autopay memberships only (Adults, Teens, Kids). Membership changes (upgrades, downgrades and switches to another plan), Kickstarters, trials, Short Term, upfronts, casuals, deposits and sponsored memberships are listed but not counted. The week follows the cancellation date, the first day the member is no longer active (last day + 1). Rollovers and configured administrative debt-cleanup records are excluded.";
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
    `<section class="metric-grid">${metrics}</section><p class="scope-note">${icon("info")} ${description}</p><section class="queue-panel reporting-panel"><div class="panel-heading"><div><h2>${view === "cancellations" ? "Memberships ending this week" : "Suspensions during this week"}</h2><p>${rows.length} records · ${rangeLabel} · through ${fmt(ops.asOf)}</p></div></div><p class="report-scroll-hint">Scroll sideways to see all details &rarr;</p><div class="table-scroll"><table><thead><tr>${columns.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}"><div class="empty"><h3>No records for this week</h3><p>This is an imported result for the selected period, not a missing-file placeholder.</p></div></td></tr>`}</tbody></table></div></section>` +
    (view === "cancellations"
      ? cancellationReporting(data.weeks, periods, ops, { esc, fmt })
      : "")
  );
}

export function portalView(data, week, helpers) {
  const { esc, icon, logo, photo, user, demo, install = "" } = helpers;
  return `<div class="member-portal" style="--portal-photo:url('${photo}')"><header class="portal-header"><div class="portal-brand"><img src="${logo}" alt="Urban Muaythai" width="72" height="72"><div><strong>URBAN MUAYTHAI</strong><span>STAFF PORTAL</span></div></div><div class="portal-account"><span>${esc(user.display_name)}</span>${install}<button class="icon-button" id="refresh" aria-label="Refresh workspace">${icon("refresh-cw")}</button><button class="button secondary" id="${demo ? "go-login" : "signout"}">${icon("log-out")} Sign out</button></div></header>${demo ? '<p class="portal-preview">Sample workspace · fictional members</p>' : ""}<main class="portal-main">${workspaceView(data, week, "home", helpers)}</main><footer class="portal-footer">REAL MUAYTHAI. REAL FITNESS. REAL COMMUNITY.<span>Approved staff access · Urban Member Care</span></footer></div><dialog id="member-dialog" class="member-dialog" aria-labelledby="member-title"></dialog><dialog id="import-dialog" class="import-dialog" aria-labelledby="import-title"></dialog>`;
}
