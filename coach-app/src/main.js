import urbanGymPhoto from "./assets/urban-gym-community.jpg";
import { workspaceView, portalView } from "./operations.js";
import {
  createIcons,
  Inbox,
  CalendarClock,
  CircleCheck,
  Users,
  HeartHandshake,
  LogOut,
  RefreshCw,
  FlaskConical,
  CalendarDays,
  Upload,
  Flag,
  ShieldCheck,
  Search,
  CircleDashed,
  MessageCircle,
  ArrowUpRight,
  CheckCheck,
  Info,
  X,
  Phone,
  Check,
  UploadCloud,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
} from "lucide";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/bebas-neue/latin-400.css";
import urbanLogo from "./assets/urban-muaythai-logo.png";
import "./style.css";
import {
  attendanceLabel,
  riskExplanation,
  installAttendanceTooltips,
} from "./attendance-ui.js";
import { attendanceStage, ATTENDANCE_STAGES } from "./attendance-stage.js";
const hideAttendanceTooltip = installAttendanceTooltips();
import { reportingView } from "./reporting.js";
import { showImport } from "./import-dialog.js";
import {
  Workspace,
  client,
  configured,
  allowDemo,
  StaffAccessError,
} from "./store.js";
import { STATUS, addDays, brisbaneToday, projectRows } from "./domain.js";

const $ = (s) => document.querySelector(s);
const icons = {
  Inbox,
  CalendarClock,
  CircleCheck,
  Users,
  HeartHandshake,
  LogOut,
  RefreshCw,
  FlaskConical,
  CalendarDays,
  Upload,
  Flag,
  ShieldCheck,
  Search,
  CircleDashed,
  MessageCircle,
  ArrowUpRight,
  CheckCheck,
  Info,
  X,
  Phone,
  Check,
  UploadCloud,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name, extra = "") => `<i data-lucide="${name}" ${extra}></i>`;
const fmt = (iso) =>
  new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Brisbane",
  }).format(new Date(iso + "T12:00:00Z"));
const stamp = (iso) =>
  new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Brisbane",
  }).format(new Date(iso));
let store,
  week,
  view = "home",
  operationPeriod = null,
  priority = "All",
  stage = "All",
  search = "",
  selected = null,
  busy = false,
  pendingRefresh = false,
  refreshing = false,
  lastSync = null;
let toastTimer;
let authEpoch = 0;
let recoveryActive =
  new URLSearchParams(location.search).get("flow") === "recovery";
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = error ? "show error" : "show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 6500);
}
function decorate() {
  createIcons({ icons, attrs: { "stroke-width": 1.7 } });
  // Phone layout stacks table rows as cards; each cell keeps its column name.
  for (const table of document.querySelectorAll(".queue-panel table")) {
    const labels = [...table.querySelectorAll("thead th")].map((th) =>
      th.textContent.trim(),
    );
    for (const row of table.querySelectorAll("tbody tr"))
      [...row.children].forEach((cell, i) => {
        if (labels[i] && !cell.hasAttribute("colspan"))
          cell.dataset.label = labels[i];
      });
  }
}
function rows() {
  return projectRows(store.data.risks, store.data.events, week);
}
function filtered() {
  return rows().filter((r) => {
    const due = r.history[0]?.follow_up_on;
    const visible =
      view === "handled"
        ? r.suppressed
        : view === "all"
          ? true
          : view === "due"
            ? !r.suppressed && due && due <= brisbaneToday()
            : !r.suppressed;
    return (
      visible &&
      (priority === "All" || r.priority === priority) &&
      (stage === "All" || attendanceStage(r).label === stage) &&
      (!search ||
        (
          r.member.full_name +
          " " +
          r.member.membership +
          " " +
          r.signal +
          " " +
          attendanceStage(r).label
        )
          .toLowerCase()
          .includes(search.toLowerCase()))
    );
  });
}
function stageBadge(risk) {
  const item = attendanceStage(risk);
  return `<span class="attendance-stage">${esc(item.label)}</span><small class="stage-detail">${esc(item.detail)}</small>`;
}
function spark(risk) {
  const values = risk.sequence?.slice(-8) || [];
  const max = Math.max(4, ...values.filter((v) => v !== null));
  const dates =
    store?.data?.weeks
      .find((w) => w.week === week)
      ?.import_summary?.sequenceDates?.slice(-8) || [];
  const reason = riskExplanation(risk, dates);
  return `<div class="spark" role="group" aria-label="Weekly attendance snapshots">${values
    .map((value, i) => {
      const label = dates[i]
        ? "Snapshot as of " + fmt(dates[i])
        : "Weekly snapshot " + (i + 1);
      return `<button type="button" class="attendance-point" data-date="${esc(dates[i] || "")}" data-snapshot-label="${esc(label)}" data-attendance-label="${esc(attendanceLabel(value))}" data-reason="${esc(reason)}" aria-label="${esc(label + ": " + attendanceLabel(value))}"><span class="attendance-bar ${i === values.length - 1 ? "last" : ""} ${value === null ? "missing" : ""}" style="height:${value === null ? 4 : Math.max(5, (28 * value) / max)}px" aria-hidden="true"></span></button>`;
    })
    .join("")}</div>`;
}

function initials(name) {
  return name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
}
function render() {
  hideAttendanceTooltip();
  const focus = document.activeElement?.id;
  const cursor = focus === "search" ? $("#search").selectionStart : null;
  const all = rows(),
    active = all.filter((r) => !r.suppressed),
    handled = all.length - active.length,
    red = active.filter((r) => r.priority === "Red").length;
  const due = active.filter(
    (r) =>
      r.history[0]?.follow_up_on &&
      r.history[0].follow_up_on <= brisbaneToday(),
  ).length;
  const progress = all.length ? Math.round((handled / all.length) * 100) : 0;
  const visible = filtered();
  const asOf =
    store.data.weeks.find((w) => w.week === week)?.import_summary?.asOf || week;
  const report = store.data.weeks.find((w) => w.week === week);
  if (view === "home") {
    $("#app").innerHTML = portalView(store.data, week, {
      esc,
      fmt,
      icon,
      logo: urbanLogo,
      photo: urbanGymPhoto,
      user: store.user,
      demo: store.demo,
      operationPeriod,
    });
    bind();
    decorate();
    return;
  }
  const outreachArea = !["cancellations", "suspensions"].includes(view);
  $("#app").innerHTML = `<div class="workspace">
 <aside class="sidebar"><button class="brand brand-button" type="button" data-view="home" aria-label="Return to portal"><img class="brand-logo" src="${urbanLogo}" alt="Urban Muaythai logo" width="58" height="58"><span>URBAN<span class="brand-sub">MUAYTHAI</span></span></button>
 <div class="workspace-tag"><span class="tiny-dot"></span> RETENTION WORKSPACE</div>
 <button class="portal-return" data-view="home">${icon("arrow-up-right")} Back to portal</button><div class="nav-label">${outreachArea ? "AT RISK MEMBERS" : view.toUpperCase()}</div><nav aria-label="Workspace">
 ${(outreachArea
   ? [
       ["queue", "users", "At Risk Members", active.length],
       ["due", "calendar-clock", "Follow-ups due", due],
       ["handled", "circle-check", "Handled & exempt", handled],
       ["all", "users", "All risk members", all.length],
       ["reporting", "calendar-days", "Reporting", store.data.weeks.length],
     ]
   : [
       [
         view,
         view === "cancellations" ? "flag" : "calendar-clock",
         view === "cancellations" ? "Cancellations" : "Suspensions",
         "",
       ],
     ]
 )
   .map(
     ([id, ic, label, n]) =>
       `<button class="nav-item ${view === id ? "selected" : ""}" data-view="${id}">${icon(ic)}<span>${label}</span><b>${n}</b></button>`,
   )
   .join("")}</nav>
 <div class="sidebar-note"><div class="note-icon">${icon("heart-handshake")}</div><strong>A small check-in.<br>A stronger community.</strong><p>Reach out, leave context, and give the next team member a clear next step.</p></div>
 <div class="profile"><span class="avatar gold">${esc(initials(store.user.display_name))}</span><span><strong>${esc(store.user.display_name)}</strong><small>${store.demo ? "Sample workspace" : esc(store.user.role === "admin" ? "Administrator" : "Team member")}</small></span>${!store.demo ? `<button class="icon-button" id="signout" aria-label="Sign out">${icon("log-out")}</button>` : ""}</div></aside>
 <div class="main-shell"><header class="topbar"><div><span class="crumb">Urban Member Care</span><span class="slash">/</span> ${{ home: "Home", reporting: "Reporting", cancellations: "Cancellations", suspensions: "Suspensions" }[view] || "At Risk Members"}</div><div class="top-actions"><span class="connection ${store.demo ? "preview" : store.online ? "connected" : ""}"><span class="tiny-dot"></span>${store.demo ? "Preview mode" : store.online ? "Live updates on" : "Connected · auto-refresh"}</span><button class="icon-button" id="refresh" aria-label="Refresh workspace" title="Refresh">${icon("refresh-cw")}</button></div></header>
 ${store.demo ? `<div class="demo-banner">${icon("flask-conical")}<span><strong>Sample workspace.</strong> Fictional members; notes save only in this browser.</span><button id="reset-demo">Reset preview</button><button id="go-login">Back to sign in</button></div>` : ""}
 <main><div class="page-heading"><div><div class="eyebrow">EVERY MEMBER MATTERS</div><h1>${view === "handled" ? "Handled & exempt" : view === "due" ? "Follow-ups due" : view === "all" ? "All risk members" : "Weekly outreach"}<span class="heading-dot">.</span></h1><p>${store.data.weeks.length ? "Attendance data as of " + fmt(asOf) + ". " : ""}${view === "handled" ? "Completed and paused cases, with context for the next team member." : "A clear next step for every member who needs a check-in."}</p></div><div class="heading-actions"><label class="week-control">${icon("calendar-days")}<span><small>REPORT WEEK</small><select id="week" aria-label="Report week">${[
   ...store.data.weeks,
 ]
   .sort((a, b) => b.week.localeCompare(a.week))
   .map(
     (w) =>
       `<option value="${w.week}" ${w.week === week ? "selected" : ""}>${fmt(w.week)}</option>`,
   )
   .join(
     "",
   )}</select></span></label>${store.user.role === "admin" ? `<button class="button secondary" id="import-open">${icon("upload")} Import week</button>` : ""}</div></div>
 ${store.data.weeks.find((w) => w.week === week)?.import_summary?.historicalSync?.archivedMembers ? `<p class="history-notice">${icon("calendar-clock")}<span><strong>Historical weekly summaries linked.</strong> ${store.data.weeks.find((w) => w.week === week).import_summary.historicalSync.archivedMembers} eligible members have archived attendance context. Original snapshot dates are shown on the history bars. Archived Monday cutoffs may differ from this export by one day; these are weekly observations, not individual attendance dates.</span></p>` : ""}
 ${report?.import_summary?.driveSync ? `<p class="history-notice drive-source">${icon("refresh-cw")}<span><strong>Imported from Clubworx Exports.</strong> ${report.import_summary.driveSync.files?.length === 5 ? "Five matching CSV reports, including attendance history" : "Four matching CSV reports"} · saved ${esc(stamp(report.imported_at))}. Google checks the Clubworx Exports folder every 30 minutes.</span></p>` : ""}
 <section class="metric-grid" aria-label="Outreach summary">
 ${[
   [active.length, "To reach out", "Members in the action queue", "inbox", ""],
   [red, "Priority check-ins", "Red risk · start here", "flag", "red"],
   [due, "Follow-ups due", "Due today or overdue", "calendar-clock", "amber"],
   [
     handled,
     "Handled / exempt",
     "Held out for this report week",
     "circle-check",
     "green",
   ],
 ]
   .map(
     ([n, title, sub, ic, tone]) =>
       `<article class="metric ${tone}"><div class="metric-top"><span>${title}</span><span class="metric-icon">${icon(ic)}</span></div><strong>${n}</strong><small>${sub}</small></article>`,
   )
   .join("")}
 </section>
 <section class="weekly-progress"><span class="progress-symbol">${icon("heart-handshake")}</span><div class="progress-copy"><strong>Make every conversation count</strong><span>${handled} of ${all.length} risk members handled or exempt for this week.</span></div><div class="progress-meter"><div><span>WEEKLY COVERAGE</span><b>${progress}%</b></div><progress value="${handled}" max="${Math.max(1, all.length)}" aria-label="Members handled this week"></progress></div></section>
 <section class="queue-panel"><div class="panel-heading"><div><h2>${view === "handled" ? "Handled cases" : view === "due" ? "Your follow-up list" : view === "all" ? "Weekly member list" : "The reach-out list"} <span class="count-chip">${visible.length}</span></h2><p>${view === "handled" ? "Exemptions expire automatically. The member’s risk history stays intact." : "Start with Red members. Open a member to record your conversation."}</p></div><span class="subtle">${icon("shield-check")} Staff workspace</span></div>
 <div class="filters"><div class="priority-filters" role="group" aria-label="Filter by risk">${["All", "Red", "Yellow", "Watch", "Review"].map((p) => `<button data-priority="${p}" class="filter ${priority === p ? "active" : ""}" aria-pressed="${priority === p}">${p === "All" ? "All priorities" : `<span class="risk-dot ${p.toLowerCase()}"></span>${p}`}</button>`).join("")}</div><label class="stage-filter">Attendance stage<select id="attendance-stage"><option value="All">All stages</option>${ATTENDANCE_STAGES.map((s) => `<option ${stage === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><label class="search">${icon("search")}<input id="search" placeholder="Search members or signals…" aria-label="Search members" value="${esc(search)}"></label></div>
 <details class="risk-guide"><summary>${icon("info")} How risk priorities work</summary><div class="risk-guide-grid"><article><span class="priority-pill red">Red · priority check-in</span><p>No sessions in the latest snapshot plus two or more consecutive weekly zero snapshots, attendance in each of the previous three weeks (labelled “Was on target” when they met their weekly target each week, otherwise “Routine broken”), a stop from at least two sessions last week / a prior average of at least two, or no sessions found in any of the last seven weeks (missing weeks count as no session found).</p></article><article><span class="priority-pill yellow">Yellow · personal check-in</span><p>A new zero week with visits in the last 30 days, a drop of at least two sessions from last week or 1.5 below the prior average, or declining Fringe attendance.</p></article><article><span class="priority-pill watch">Watch · monitor</span><p>Still attending, marked Fringe and below their membership target, with no stronger Red or Yellow signal. Unlimited memberships use a target of four sessions.</p></article><article><span class="priority-pill review">Review · missing context</span><p>Zero attendance in a member’s first week, or below-target attendance without the engagement label needed for Watch. Review these cases before choosing an outreach outcome.</p></article></div><p class="risk-guide-note"><strong>Attendance stages:</strong> Early warning = first zero after recent attendance; At risk = two zero snapshots, a sharp stop or declining attendance; Disengaged = 3–4 zero snapshots; Long absence = 5–6; Extended absence = 7+. Monitoring and Needs context describe cases without a confirmed absence stage. Stages use up to eight saved weekly observations. Missing, suspended or ineligible historical slots break the run. Archived weekly summaries are observations, not a verified day-by-day absence record. Existing reports retain their saved history until reimported. Outreach notes and exemptions stay separate.</p><p class="risk-guide-note"><strong>Attendance bands are different:</strong> 0 = Critical; 1 = At Risk; 2 = Low; 3 = Okay; 4+ = Good. Outreach priority also considers history and membership target. The first matching rule wins: Red, then Yellow, then Watch. Missing snapshots stay unknown on the bars. Current suspensions are held out of outreach.</p><p class="risk-guide-note"><strong>Missing history:</strong> When the Attendance history export is included, earlier weeks are counted from actual session dates. Otherwise missing snapshots stay unknown on the bars, but a member with no sessions found in the last seven weeks is still Red. Fringe engagement labels are never invented.</p><p class="risk-guide-note">Imported reports supply these priorities; CSV imports calculate them from the selected cutoff and saved weekly attendance. Team notes change outreach status and temporary exemptions; they do not change the recorded risk category.</p></details>
 <div class="table-scroll"><table><thead><tr><th>MEMBER</th><th>RISK SIGNAL</th><th>RECENT WEEKS</th><th>OUTREACH STATUS</th><th><span class="sr-only">Open member</span></th></tr></thead><tbody>${
   visible
     .map((r) => {
       const event = r.history[0];
       const author = store.data.staff.find(
         (s) => s.id === event?.assigned_to,
       )?.display_name;
       return `<tr><td><button class="member-button" data-member="${esc(r.member_id)}"><span class="avatar ${r.priority === "Red" ? "rose" : r.priority === "Yellow" ? "sand" : "slate"}">${esc(initials(r.member.full_name))}</span><span><strong>${esc(r.member.full_name)}</strong><small>${esc(r.member.membership)}</small></span></button></td><td><span class="priority-pill ${r.priority.toLowerCase()}"><span class="risk-dot ${r.priority.toLowerCase()}"></span>${r.priority}</span>${stageBadge(r)}<small class="signal">${esc(r.signal)}</small></td><td>${spark(r)}<small class="session-label">${r.s7} sessions this week</small></td><td><span class="status-label ${r.suppressed ? "done" : ""}" data-status="${r.suppressed ? "done" : r.status}">${icon(r.suppressed ? "circle-check" : r.status === "open" ? "circle-dashed" : "message-circle")}${STATUS[r.status]}</span><small class="status-detail">${r.suppressed ? "Through " + fmt(r.last.suppress_through) : r.reopened ? "Exemption expired · review again" : event?.follow_up_on ? "Follow up " + fmt(event.follow_up_on) : author ? esc(author) : r.history.length ? r.history.length + " note" + (r.history.length === 1 ? "" : "s") : "No outreach recorded"}</small></td><td><button class="row-open" data-member="${esc(r.member_id)}" aria-label="Open ${esc(r.member.full_name)}">${icon("arrow-up-right")}</button></td></tr>`;
     })
     .join("") ||
   `<tr><td colspan="5"><div class="empty">${icon("check-check")}<h3>${search ? "No members match your search" : !store.data.weeks.length ? "Import your first weekly report" : "You’re clear here"}</h3><p>${search ? "Try another name or risk signal." : !store.data.weeks.length ? "An administrator can choose Import week and select the four Clubworx CSV reports." : view === "queue" ? "Every case in this view has been handled." : "There are no cases in this view for the selected week."}</p></div></td></tr>`
 }</tbody></table></div>
 <footer class="table-footer"><span>${visible.length} members shown · week beginning ${store.data.weeks.length ? fmt(week) : "—"}${store.data.weeks.length ? " · data as of " + fmt(asOf) : ""}</span><span>${lastSync ? "Updated " + new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Brisbane" }).format(lastSync) : "Weekly attendance snapshot"}</span></footer></section>
 <p class="scope-note">${icon("info")} Staff notes change the outreach queue. Attendance and risk signals remain as recorded in the weekly report.</p>
 </main></div></div><dialog id="member-dialog" class="member-dialog" aria-labelledby="member-title"></dialog><dialog id="import-dialog" class="import-dialog" aria-labelledby="import-title"></dialog>`;
  if (["cancellations", "suspensions"].includes(view))
    $("#app main").innerHTML = workspaceView(store.data, week, view, {
      operationPeriod,
      esc,
      fmt,
      icon,
    });
  if (view === "reporting")
    $("#app main").innerHTML = reportingView(store.data, week, {
      esc,
      fmt,
      icon,
    });
  bind();
  decorate();
  const nav = document.querySelector('nav[aria-label="Workspace"]');
  const activeNav = nav?.querySelector(".selected");
  if (nav && activeNav && nav.scrollWidth > nav.clientWidth)
    nav.scrollLeft +=
      activeNav.getBoundingClientRect().left -
      nav.getBoundingClientRect().left -
      8;
  if (focus === "search" && $("#search")) {
    $("#search").focus();
    $("#search").setSelectionRange(cursor, cursor);
  }
}
function bind() {
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        view = b.dataset.view;
        render();
      }),
  );
  document.querySelectorAll("[data-priority]").forEach(
    (b) =>
      (b.onclick = () => {
        priority = b.dataset.priority;
        render();
      }),
  );
  document
    .querySelectorAll("[data-member]")
    .forEach((b) => (b.onclick = () => openMember(b.dataset.member)));
  // Phone cards: a tap anywhere on the card opens the member.
  document.querySelectorAll(".queue-panel tbody tr").forEach((row) => {
    const open = row.querySelector(".row-open");
    if (open)
      row.onclick = (e) => {
        if (!e.target.closest("button, a, input, select") && matchMedia("(max-width: 760px)").matches)
          openMember(open.dataset.member);
      };
  });
  if ($("#attendance-stage"))
    $("#attendance-stage").onchange = (e) => {
      stage = e.target.value;
      render();
    };
  if ($("#search"))
    $("#search").oninput = (e) => {
      search = e.target.value;
      render();
    };
  document.querySelectorAll("[data-report-week]").forEach(
    (b) =>
      (b.onclick = () => {
        week = b.dataset.reportWeek;
        render();
      }),
  );
  if ($("#report-open-red"))
    $("#report-open-red").onclick = () => {
      view = "all";
      priority = "Red";
      stage = "All";
      search = "";
      render();
    };
  document.querySelectorAll("[data-operation-period]").forEach(button=>button.onclick=()=>{operationPeriod=button.dataset.operationPeriod;render();});
  if ($("#operation-period"))
    $("#operation-period").onchange = (e) => {
      operationPeriod = e.target.value;
      render();
    };
  if ($("#week"))
    $("#week").onchange = (e) => {
      operationPeriod = null;
      week = e.target.value;
      render();
    };
  $("#refresh").onclick = () => refresh();
  if ($("#reset-demo"))
    $("#reset-demo").onclick = () => {
      store.reset();
      render();
      toast("Sample notes reset.");
    };
  if ($("#go-login")) $("#go-login").onclick = () => showLogin();
  if ($("#signout"))
    $("#signout").onclick = async () => {
      const previous = store;
      showLogin();
      try {
        const { error } = await client.auth.signOut();
        if (error) throw error;
      } catch (error) {
        toast(
          "Could not end your server session. Please retry signing out before leaving this device.",
          true,
        );
      } finally {
        previous?.dispose();
      }
    };
  if ($("#import-open")) $("#import-open").onclick = openImport;
}
function openMember(id) {
  const r = rows().find((r) => r.member_id === id);
  if (!r) return;
  selected = id;
  const dialog = $("#member-dialog");
  dialog.innerHTML = `<header class="drawer-top"><span>MEMBER CHECK-IN</span><button type="button" class="icon-button" id="close-member" aria-label="Close member">${icon("x")}</button></header><div class="drawer-body"><div class="member-intro"><span class="avatar large rose">${esc(initials(r.member.full_name))}</span><div><h2 id="member-title">${esc(r.member.full_name)}</h2><p>${esc(r.member.membership)}</p></div></div><div class="risk-callout"><span class="priority-pill ${r.priority.toLowerCase()}">${r.priority} risk</span>${stageBadge(r)}<strong>${esc(r.signal)}</strong><span>${r.s7} sessions in 7 days · ${r.s30} in 30 days</span><p class="risk-explanation">${esc(riskExplanation(r, store.data.weeks.find((w) => w.week === week)?.import_summary?.sequenceDates || []))}</p><div class="attendance-chart"><small>WEEKLY SNAPSHOTS · HOVER OR TAP A BAR</small>${spark(r)}</div></div>
 ${r.suppressed ? `<div class="exemption-notice">${icon("circle-check")}<span>Excluded from the action queue through the report dated <strong>${fmt(r.last.suppress_through)}</strong>. Choose “Reopen” to bring this case back.</span></div>` : ""}
 ${r.member.phone ? `<a class="phone-link" href="tel:${esc(r.member.phone.replace(/[^+0-9]/g, ""))}">${icon("phone")} ${esc(r.member.phone)}</a>` : ""}
 <div class="drawer-section-heading"><h3>Record your reach-out</h3><span>Week of ${fmt(week)}</span></div><form id="note-form"><label>What happened?<textarea id="note" required maxlength="4000" rows="4" placeholder="How is training going? What’s the barrier? Agree one next step…"></textarea></label><div class="form-two"><label>Outcome<select id="outcome"><option value="">Add note only</option><option value="contacted">Contacted</option><option value="booked">Session booked</option><option value="completed">Handled · exclude temporarily</option><option value="snoozed">Exempt / pause outreach</option><option value="open">Reopen · needs outreach</option></select></label><label>Assign to<select id="assignee"><option value="">Unassigned</option>${store.data.staff
   .filter((s) => s.active !== false)
   .map(
     (s) =>
       `<option value="${s.id}" ${r.history[0]?.assigned_to === s.id ? "selected" : ""}>${esc(s.display_name)}</option>`,
   )
   .join(
     "",
   )}</select></label></div><div id="exemption-fields" hidden><label>Exclude through report dated<input type="date" id="suppress" min="${week}" max="${addDays(week, 84)}" value="${addDays(week, 7)}"></label><p class="field-help" id="exemption-help"></p></div><label>Follow-up date <span class="optional">(optional unless paused)</span><input type="date" id="follow-up" value="${esc(r.history[0]?.follow_up_on || "")}"></label><p id="save-error" class="form-error" role="alert"></p><button class="button primary save" type="submit">${icon("check")} Save check-in</button><p class="field-help">${store.demo ? "Preview: saved in this browser only." : "Saved with your staff identity and timestamp. Notes are kept in the member history."}</p></form>
 <div class="drawer-section-heading history-heading"><h3>Member history</h3><span>${r.history.length} note${r.history.length === 1 ? "" : "s"}</span></div><div class="history">${r.history.map((e) => `<article class="history-item"><span class="timeline-dot"></span><div class="history-meta"><strong>${esc(e.author)}</strong><span>${stamp(e.created_at)}</span></div><div class="history-tags"><span>Report ${fmt(e.week)}</span>${e.status ? `<span>${STATUS[e.status]}</span>` : ""}</div><p>${esc(e.body)}</p>${e.suppress_through ? `<small>Exempt through report ${fmt(e.suppress_through)}</small>` : ""}${e.follow_up_on ? `<small>Follow up ${fmt(e.follow_up_on)}</small>` : ""}</article>`).join("") || '<div class="no-history">No notes yet. Start the conversation.</div>'}</div></div>`;
  dialog.showModal();
  decorate();
  const close = () => {
    if (busy) return;
    dialog.close();
    selected = null;
    if (pendingRefresh) {
      pendingRefresh = false;
      refresh();
    }
  };
  $("#close-member").onclick = close;
  dialog.oncancel = (e) => {
    e.preventDefault();
    close();
  };
  dialog.onclick = (e) => {
    if (e.target === dialog) close();
  };
  const updateHelp = () => {
    $("#exemption-help").textContent =
      `Hidden for reports dated ${fmt(week)} through ${fmt($("#suppress").value || week)}. Automatically returns after that date if still at risk.`;
  };
  $("#outcome").onchange = () => {
    const pause = ["completed", "snoozed"].includes($("#outcome").value);
    $("#exemption-fields").hidden = !pause;
    $("#suppress").required = pause;
    $("#follow-up").required = $("#outcome").value === "snoozed";
    updateHelp();
  };
  $("#suppress").onchange = updateHelp;
  let requestId = crypto.randomUUID(),
    requestBody = null;
  $("#note-form").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const button = dialog.querySelector(".save");
    button.disabled = true;
    button.textContent = "Saving…";
    $("#save-error").textContent = "";
    const status = $("#outcome").value || null;
    const action = {
      body: $("#note").value,
      status,
      suppress_through: ["completed", "snoozed"].includes(status)
        ? $("#suppress").value
        : null,
      follow_up_on: $("#follow-up").value || null,
      assigned_to: $("#assignee").value || null,
    };
    const serialized = JSON.stringify(action);
    if (requestBody !== null && requestBody !== serialized)
      requestId = crypto.randomUUID();
    requestBody = serialized;
    dialog
      .querySelectorAll("input,select,textarea,button")
      .forEach((el) => (el.disabled = true));
    try {
      await store.save(r.member, week, { ...action, request_id: requestId });
      busy = false;
      dialog.close();
      selected = null;
      pendingRefresh = false;
      lastSync = new Date();
      render();
      toast(
        status === "completed" || status === "snoozed"
          ? "Saved. Member excluded through the selected report date."
          : "Check-in saved.",
      );
    } catch (err) {
      $("#save-error").textContent =
        err.message || "Could not save. Your note is still here; try again.";
      busy = false;
      dialog
        .querySelectorAll("input,select,textarea,button")
        .forEach((el) => (el.disabled = false));
      button.innerHTML = icon("check") + " Save check-in";
      decorate();
    }
  };
}
function openImport() {
  const workspace = store;
  showImport({
    store: workspace,
    decorate,
    esc,
    fmt,
    icon,
    onImported: (importedWeek) => {
      if (store !== workspace) return;
      week = importedWeek;
      lastSync = new Date();
      render();
      toast("Weekly report imported. Staff history preserved.");
    },
  });
}

async function refresh(silent = false) {
  if (refreshing || !store) return;
  if (selected || $("#import-dialog")?.open) {
    pendingRefresh = true;
    if (!silent)
      toast("Close the current form to refresh. Your draft is preserved.");
    return;
  }
  refreshing = true;
  const workspace = store,
    epoch = authEpoch;
  try {
    await workspace.load();
    if (epoch !== authEpoch || store !== workspace) return;
    lastSync = new Date();
    render();
    if (!silent) toast("Workspace refreshed.");
  } catch (err) {
    if (epoch !== authEpoch) return;
    if (err instanceof StaffAccessError) showLogin(err.message);
    else toast("Refresh failed: " + err.message, true);
  } finally {
    refreshing = false;
  }
}
async function start(demo) {
  if (demo && !allowDemo) return showLogin();
  const epoch = ++authEpoch,
    previous = store;
  store = null;
  await previous?.dispose();
  if (epoch !== authEpoch) return;
  const workspace = new Workspace(demo);
  store = workspace;
  try {
    await workspace.load();
    if (epoch !== authEpoch) {
      workspace.dispose();
      return;
    }
    week = demo
      ? "2026-10-26"
      : workspace.data.weeks.at(-1)?.week || brisbaneToday();
    view = "home";
    operationPeriod = null;
    search = "";
    priority = "All";
    stage = "All";
    lastSync = new Date();
    render();
    workspace.subscribe(
      () => {
        if (epoch === authEpoch) refresh(true);
      },
      () => {
        if (epoch !== authEpoch) return;
        const el = $(".connection");
        if (el) {
          el.className = "connection " + (workspace.online ? "connected" : "");
          el.innerHTML =
            '<span class="tiny-dot"></span>' +
            (workspace.online ? "Live updates on" : "Connected · auto-refresh");
        }
      },
    );
  } catch (err) {
    if (epoch === authEpoch) showLogin(err.message);
  }
}
function lockWorkspace() {
  hideAttendanceTooltip();
  authEpoch++;
  const previous = store;
  store = null;
  previous?.dispose();
  if (previous) previous.data = null;
  selected = null;
  pendingRefresh = false;
  busy = false;
}
function authFrame(title, description, content) {
  $("#app").innerHTML =
    `<main class="login-page"><div class="login-brand"><img src="${urbanLogo}" alt="Urban Muaythai logo" width="54" height="54"><div>URBAN MUAYTHAI <span>MEMBER CARE</span></div></div><section class="login-card"><div class="login-icon">${icon("lock-keyhole")}</div><div class="eyebrow">URBAN MUAYTHAI · STAFF ACCESS</div><h1>${title}</h1><p>${description}</p>${content}<div class="login-foot">${icon("shield-check")} Individual staff accounts · access approved by your administrator</div></section></main>`;
  decorate();
}
function bindPasswordToggle() {
  const button = $("#toggle-password");
  if (!button) return;
  button.onclick = () => {
    const field = $("#password"),
      shown = field.type === "password";
    field.type = shown ? "text" : "password";
    button.setAttribute(
      "aria-label",
      shown ? "Hide password" : "Show password",
    );
    button.setAttribute("aria-pressed", String(shown));
    button.innerHTML = icon(shown ? "eye-off" : "eye");
    decorate();
    field.focus();
  };
}
function showLogin(message = "", mode = "signin") {
  lockWorkspace();
  recoveryActive = false;
  const reset = mode === "reset";
  const setup = !configured
    ? '<p class="setup-message" id="auth-setup">Staff sign-in is waiting for the Supabase connection. Accounts are not active yet. The sample workspace below is available for design review.</p>'
    : "";
  authFrame(
    reset ? "Reset your password" : "Welcome back,<br>Urban team.",
    reset
      ? "Enter your staff email and we’ll send a password reset link."
      : "Sign in to manage member check-ins, share notes and keep your team’s follow-ups moving.",
    `${setup}<form id="login-form"><label for="email">Staff email</label><input id="email" name="email" type="email" placeholder="you@urbanmuaythai.com" autocomplete="username" required>
  ${reset ? "" : `<label for="password" class="password-label">Password</label><div class="password-input"><input id="password" name="password" type="password" autocomplete="current-password" required><button id="toggle-password" class="icon-button" type="button" aria-label="Show password" aria-pressed="false">${icon("eye")}</button></div>`}
  <p id="login-error" class="form-error" role="alert">${esc(message)}</p><p id="login-success" class="auth-success" role="status"></p><button id="login-submit" class="button primary" type="submit" ${configured ? "" : "disabled aria-describedby=auth-setup"}>${reset ? "Send reset link" : "Sign in to Urban Member Care"} ${icon("arrow-right")}</button></form>
  <button class="auth-link" id="auth-switch">${reset ? "Back to sign in" : "Forgot your password?"}</button>
  ${allowDemo && !reset ? `<div class="preview-divider"><span>DESIGN PREVIEW</span></div><button class="button secondary demo-start" id="start-demo">Explore sample workspace ${icon("arrow-up-right")}</button><p class="preview-disclosure">Fictional members only. Preview access does not sign you into the staff workspace.</p>` : ""}`,
  );
  bindPasswordToggle();
  if ($("#start-demo")) $("#start-demo").onclick = () => start(true);
  $("#auth-switch").onclick = () => showLogin("", reset ? "signin" : "reset");
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!configured) return;
    const epoch = authEpoch,
      button = $("#login-submit"),
      email = $("#email").value.trim();
    const password = reset ? null : $("#password").value;
    button.disabled = true;
    button.textContent = reset ? "Sending…" : "Signing in…";
    $("#login-error").textContent = "";
    try {
      if (reset) {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + location.pathname + "?flow=recovery",
        });
        if (error) throw error;
        if (epoch === authEpoch)
          $("#login-success").textContent =
            "If this email is eligible, a reset link will arrive shortly. Check your inbox.";
      } else {
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (epoch === authEpoch) await start(false);
      }
    } catch (error) {
      if (epoch === authEpoch)
        $("#login-error").textContent =
          error.status === 400 && !reset
            ? "Email or password wasn’t recognised. Try again or reset your password."
            : error.message;
    } finally {
      if (epoch === authEpoch && $("#login-submit")) {
        button.disabled = false;
        button.innerHTML =
          (reset ? "Send reset link" : "Sign in to Urban Member Care") +
          icon("arrow-right");
        decorate();
      }
    }
  };
}
function showPasswordUpdate() {
  lockWorkspace();
  recoveryActive = true;
  authFrame(
    "Set a new password",
    "Choose a new password for your staff account.",
    `<form id="password-update"><label for="password">New password</label><div class="password-input"><input id="password" type="password" autocomplete="new-password" minlength="12" required><button id="toggle-password" class="icon-button" type="button" aria-label="Show password" aria-pressed="false">${icon("eye")}</button></div><label for="confirm-password" class="password-label">Confirm password</label><input id="confirm-password" type="password" autocomplete="new-password" minlength="12" required><p class="field-help">Use at least 12 characters.</p><p id="login-error" class="form-error" role="alert"></p><button class="button primary" type="submit">Save new password</button></form>`,
  );
  bindPasswordToggle();
  $("#password-update").onsubmit = async (e) => {
    e.preventDefault();
    if (!client) return;
    if ($("#password").value !== $("#confirm-password").value) {
      $("#login-error").textContent = "The passwords don’t match.";
      return;
    }
    const epoch = authEpoch,
      button = e.target.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await client.auth.updateUser({
        password: $("#password").value,
      });
      if (error) throw error;
      if (epoch !== authEpoch) return;
      recoveryActive = false;
      history.replaceState(null, "", location.pathname);
      await client.auth.signOut();
      showLogin();
      toast("Password updated. Sign in with your new password.");
    } catch (error) {
      if (epoch === authEpoch) {
        $("#login-error").textContent = error.message;
        button.disabled = false;
      }
    }
  };
}
setInterval(() => {
  if (
    store &&
    !store.demo &&
    document.visibilityState === "visible" &&
    $("#week")
  )
    refresh(true);
}, 30000);
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    store &&
    !store.demo &&
    $("#week")
  )
    refresh(true);
});
window.addEventListener("offline", () =>
  toast(
    "You’re offline. Saving requires a connection; keep your draft open.",
    true,
  ),
);
showLogin();
if (configured) {
  const bootEpoch = authEpoch;
  const recoveryRequested =
    new URLSearchParams(location.search).get("flow") === "recovery";
  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") showLogin();
    if (event === "PASSWORD_RECOVERY") showPasswordUpdate();
  });
  client.auth
    .getSession()
    .then(({ data, error }) => {
      if (authEpoch !== bootEpoch) return;
      if (error) {
        showLogin("Your session could not be restored. Please sign in again.");
        return;
      }
      if (recoveryRequested) {
        if (data.session) showPasswordUpdate();
        else
          showLogin(
            "This password reset link has expired. Request a new one.",
            "reset",
          );
      } else if (data.session && !recoveryActive) start(false);
    })
    .catch(() => {
      if (authEpoch === bootEpoch)
        showLogin("Could not connect. Please try signing in again.");
    });
}
