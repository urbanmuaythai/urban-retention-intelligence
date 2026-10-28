import { addDays, norm, projectRows } from "./domain.js";

export function buildOperations(reports, week, asOf, policy = null) {
  const inWindow = (date) => date && date >= week && date <= asOf;
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
      r["Suspension Starts"] <= asOf &&
      (!r["Suspension Ends"] || r["Suspension Ends"] >= week),
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
  return {
    version: 1,
    week,
    asOf,
    cancellations,
    suspensions,
    policyApplied: policy?.version === 1,
  };
}

export function operationWeek(report) {
  const summary = report?.import_summary,
    data = summary?.operations;
  if (
    !data ||
    data.version !== 1 ||
    data.week !== report.week ||
    data.asOf !== summary.asOf
  )
    return null;
  const end =
    summary.asOf < addDays(report.week, 6)
      ? summary.asOf
      : addDays(report.week, 6);
  const inWeek = (date) => date && date >= report.week && date <= end;
  const excluded = new Set(
    summary.retentionPolicy?.excludedMembershipIds || [],
  );
  const included = (r) =>
    norm(r.reason) !== "roll over" &&
    !excluded.has(r.membership_id) &&
    !/^thailand tour (deposit|final payment)$/.test(norm(r.membership));
  const cancellations = data.cancellations.filter(
    (r) => included(r) && inWeek(r.end),
  );
  const recorded = data.cancellations.filter(
    (r) => included(r) && inWeek(r.recorded),
  );
  const excludedInWeek = data.cancellations.filter(
    (r) => !included(r) && inWeek(r.end),
  );
  const suspensions = data.suspensions.filter(
    (r) => r.start <= end && (!r.end || r.end >= report.week),
  );
  return {
    cancellations,
    recorded,
    excludedInWeek,
    suspensions,
    currentSuspensions: suspensions.filter(
      (r) => r.start <= end && (!r.end || r.end >= end),
    ),
    asOf: end,
    policyApplied: data.policyApplied && summary.retentionPolicy?.version === 1,
  };
}

export function workspaceView(data, week, view, { esc, fmt, icon }) {
  const report = data.weeks.find((w) => w.week === week),
    summary = report?.import_summary || {},
    ops = operationWeek(report);
  const weeks = [...data.weeks].sort((a, b) => b.week.localeCompare(a.week));
  const names = {
    home: "Member care portal",
    cancellations: "Cancellations",
    suspensions: "Suspensions",
  };
  const header = `<div class="page-heading"><div><div class="eyebrow">URBAN MUAYTHAI · MEMBER CARE</div><h1>${names[view]}<span class="heading-dot">.</span></h1><p>${view === "home" ? "Choose where you would like to start." : "Results belong to the selected report week and its saved export cutoff."}</p></div><div class="heading-actions"><label class="week-control">${icon("calendar-days")}<span><small>REPORT WEEK</small><select id="week" aria-label="Report week">${weeks.map((w) => `<option value="${esc(w.week)}" ${w.week === week ? "selected" : ""}>${fmt(w.week)}</option>`).join("")}</select></span></label>${view === "home" ? "" : '<button class="button secondary" data-view="home">Back to portal</button>'}</div></div>`;
  const period = report
    ? `<p class="report-period">Week beginning <strong>${fmt(week)}</strong> · data as of <strong>${fmt(summary.asOf || week)}</strong>${summary.asOf < addDays(week, 6) ? " · partial week" : ""}</p>`
    : '<p class="report-period">No report imported yet.</p>';
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
          "Memberships ending in the selected report week.",
          ops?.policyApplied ? ops.cancellations.length : null,
          "flag",
        ],
        [
          "suspensions",
          "Suspensions",
          "Members on a suspension during the selected report week.",
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
        "Any suspension overlapping Monday through the cutoff",
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
        "Held from risk outreach",
        summary.currentSuspensions === undefined
          ? null
          : summary.currentSuspensions + (summary.suspensionStatusHeld || 0),
        "Eligible training members held by dates or status",
      );
    description =
      "This list shows source suspension periods overlapping the selected week through its cutoff. The risk queue holds only eligible training members, so its held count can differ from the full suspension list.";
  }
  return (
    header +
    period +
    `<section class="metric-grid">${metrics}</section><p class="scope-note">${icon("info")} ${description}</p><section class="queue-panel reporting-panel"><div class="panel-heading"><div><h2>${view === "cancellations" ? "Memberships ending this week" : "Suspensions during this week"}</h2><p>${rows.length} records · week beginning ${fmt(week)} through ${fmt(ops.asOf)}</p></div></div><p class="report-scroll-hint">Scroll sideways to see all details &rarr;</p><div class="table-scroll"><table><thead><tr>${columns.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}"><div class="empty"><h3>No records for this week</h3><p>This is an imported result for the selected period, not a missing-file placeholder.</p></div></td></tr>`}</tbody></table></div></section>`
  );
}

export function portalView(data, week, helpers) {
  const { esc, icon, logo, photo, user, demo } = helpers;
  return `<div class="member-portal" style="--portal-photo:url('${photo}')"><header class="portal-header"><div class="portal-brand"><img src="${logo}" alt="Urban Muaythai" width="72" height="72"><div><strong>URBAN MUAYTHAI</strong><span>STAFF PORTAL</span></div></div><div class="portal-account"><span>${esc(user.display_name)}</span><button class="icon-button" id="refresh" aria-label="Refresh workspace">${icon("refresh-cw")}</button><button class="button secondary" id="${demo ? "go-login" : "signout"}">${icon("log-out")} Sign out</button></div></header>${demo ? '<p class="portal-preview">Sample workspace · fictional members</p>' : ""}<main class="portal-main">${workspaceView(data, week, "home", helpers)}</main><footer class="portal-footer">REAL MUAYTHAI. REAL FITNESS. REAL COMMUNITY.<span>Approved staff access · Urban Member Care</span></footer></div><dialog id="member-dialog" class="member-dialog" aria-labelledby="member-title"></dialog><dialog id="import-dialog" class="import-dialog" aria-labelledby="import-title"></dialog>`;
}
