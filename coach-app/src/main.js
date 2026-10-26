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
} from "lucide";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/bebas-neue/latin-400.css";
import urbanLogo from "./assets/urban-muaythai-logo.png";
import "./style.css";
import { Workspace, client, configured } from "./store.js";
import {
  STATUS,
  addDays,
  brisbaneToday,
  projectRows,
  validateImport,
} from "./domain.js";

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
  view = "queue",
  priority = "All",
  search = "",
  selected = null,
  busy = false,
  pendingRefresh = false,
  refreshing = false,
  lastSync = null,
  importPayload = null;
let toastTimer;
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = error ? "show error" : "show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 6500);
}
function decorate() {
  createIcons({ icons, attrs: { "stroke-width": 1.7 } });
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
      (!search ||
        (r.member.full_name + " " + r.member.membership + " " + r.signal)
          .toLowerCase()
          .includes(search.toLowerCase()))
    );
  });
}
function spark(sequence) {
  const values = sequence?.slice(-8) || [];
  const max = Math.max(4, ...values.filter((v) => v !== null));
  return `<div class="spark" aria-label="Weekly sessions: ${esc(values.map((x) => (x === null ? "missing" : x)).join(", "))}">${values.map((v, i) => `<span style="height:${v === null ? 4 : Math.max(5, (28 * v) / max)}px" class="${i === values.length - 1 ? "last" : ""} ${v === null ? "missing" : ""}" title="${v === null ? "Missing snapshot" : v + " sessions"}"></span>`).join("")}</div>`;
}
function initials(name) {
  return name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
}
function render() {
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
  $("#app").innerHTML = `<div class="workspace">
 <aside class="sidebar"><a class="brand" href="/" aria-label="Urban Muaythai Coach Desk"><img class="brand-logo" src="${urbanLogo}" alt="Urban Muaythai logo" width="58" height="58"><span>URBAN<span class="brand-sub">MUAYTHAI</span></span></a>
 <div class="workspace-tag"><span class="tiny-dot"></span> RETENTION WORKSPACE</div>
 <div class="nav-label">COACH DESK</div><nav aria-label="Workspace">
 ${[
   ["queue", "inbox", "Weekly outreach", active.length],
   ["due", "calendar-clock", "Follow-ups due", due],
   ["handled", "circle-check", "Handled & exempt", handled],
   ["all", "users", "All risk members", all.length],
 ]
   .map(
     ([id, ic, label, n]) =>
       `<button class="nav-item ${view === id ? "selected" : ""}" data-view="${id}">${icon(ic)}<span>${label}</span><b>${n}</b></button>`,
   )
   .join("")}</nav>
 <div class="sidebar-note"><div class="note-icon">${icon("heart-handshake")}</div><strong>A small check-in.<br>A stronger community.</strong><p>Reach out, leave context, and give the next coach a clear next step.</p></div>
 <div class="profile"><span class="avatar gold">${esc(initials(store.user.display_name))}</span><span><strong>${esc(store.user.display_name)}</strong><small>${store.demo ? "Sample workspace" : esc(store.user.role === "admin" ? "Administrator" : "Coach")}</small></span>${!store.demo ? `<button class="icon-button" id="signout" aria-label="Sign out">${icon("log-out")}</button>` : ""}</div></aside>
 <div class="main-shell"><header class="topbar"><div><span class="crumb">Coach Desk</span><span class="slash">/</span> Weekly outreach</div><div class="top-actions"><span class="connection ${store.demo ? "preview" : store.online ? "connected" : ""}"><span class="tiny-dot"></span>${store.demo ? "Preview mode" : store.online ? "Live updates on" : "Connected · auto-refresh"}</span><button class="icon-button" id="refresh" aria-label="Refresh workspace" title="Refresh">${icon("refresh-cw")}</button></div></header>
 ${store.demo ? `<div class="demo-banner">${icon("flask-conical")}<span><strong>Sample workspace.</strong> Fictional members; notes save only in this browser.</span><button id="reset-demo">Reset preview</button>${configured ? '<button id="go-login">Staff sign in</button>' : ""}</div>` : ""}
 <main><div class="page-heading"><div><div class="eyebrow">EVERY MEMBER MATTERS</div><h1>${view === "handled" ? "Handled & exempt" : view === "due" ? "Follow-ups due" : view === "all" ? "All risk members" : "Weekly outreach"}<span class="heading-dot">.</span></h1><p>${view === "handled" ? "Completed and paused cases, with context for the next coach." : "A clear next step for every member who needs a check-in."}</p></div><div class="heading-actions"><label class="week-control">${icon("calendar-days")}<span><small>REPORT WEEK</small><select id="week" aria-label="Report week">${[
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
 <div class="filters"><div class="priority-filters" role="group" aria-label="Filter by risk">${["All", "Red", "Yellow", "Watch"].map((p) => `<button data-priority="${p}" class="filter ${priority === p ? "active" : ""}" aria-pressed="${priority === p}">${p === "All" ? "All priorities" : `<span class="risk-dot ${p.toLowerCase()}"></span>${p === "Red" ? "Red" : p === "Yellow" ? "Yellow" : "Watch"}`}</button>`).join("")}</div><label class="search">${icon("search")}<input id="search" placeholder="Search members or signals…" aria-label="Search members" value="${esc(search)}"></label></div>
 <div class="table-scroll"><table><thead><tr><th>MEMBER</th><th>RISK SIGNAL</th><th>RECENT WEEKS</th><th>OUTREACH STATUS</th><th><span class="sr-only">Open member</span></th></tr></thead><tbody>${
   visible
     .map((r) => {
       const event = r.history[0];
       const author = store.data.staff.find(
         (s) => s.id === event?.assigned_to,
       )?.display_name;
       return `<tr><td><button class="member-button" data-member="${esc(r.member_id)}"><span class="avatar ${r.priority === "Red" ? "rose" : r.priority === "Yellow" ? "sand" : "slate"}">${esc(initials(r.member.full_name))}</span><span><strong>${esc(r.member.full_name)}</strong><small>${esc(r.member.membership)}</small></span></button></td><td><span class="priority-pill ${r.priority.toLowerCase()}"><span class="risk-dot ${r.priority.toLowerCase()}"></span>${r.priority}</span><small class="signal">${esc(r.signal)}</small></td><td>${spark(r.sequence)}<small class="session-label">${r.s7} sessions this week</small></td><td><span class="status-label ${r.suppressed ? "done" : ""}">${icon(r.suppressed ? "circle-check" : r.status === "open" ? "circle-dashed" : "message-circle")}${STATUS[r.status]}</span><small class="status-detail">${r.suppressed ? "Through " + fmt(r.last.suppress_through) : r.reopened ? "Exemption expired · review again" : event?.follow_up_on ? "Follow up " + fmt(event.follow_up_on) : author ? esc(author) : r.history.length ? r.history.length + " note" + (r.history.length === 1 ? "" : "s") : "No outreach recorded"}</small></td><td><button class="row-open" data-member="${esc(r.member_id)}" aria-label="Open ${esc(r.member.full_name)}">${icon("arrow-up-right")}</button></td></tr>`;
     })
     .join("") ||
   `<tr><td colspan="5"><div class="empty">${icon("check-check")}<h3>${search ? "No members match your search" : "You’re clear here"}</h3><p>${search ? "Try another name or risk signal." : view === "queue" ? "Every case in this view has been handled." : "There are no cases in this view for the selected week."}</p></div></td></tr>`
 }</tbody></table></div>
 <footer class="table-footer"><span>${visible.length} members shown · report dated ${store.data.weeks.length ? fmt(week) : "—"}</span><span>${lastSync ? "Updated " + new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Brisbane" }).format(lastSync) : "Weekly attendance snapshot"}</span></footer></section>
 <p class="scope-note">${icon("info")} Staff notes change the outreach queue. Attendance and risk signals remain as recorded in the weekly report.</p>
 </main></div></div><dialog id="member-dialog" class="member-dialog" aria-labelledby="member-title"></dialog><dialog id="import-dialog" class="import-dialog" aria-labelledby="import-title"></dialog>`;
  bind();
  decorate();
  if (focus === "search") {
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
  $("#search").oninput = (e) => {
    search = e.target.value;
    render();
  };
  $("#week").onchange = (e) => {
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
      await store.dispose();
      await client.auth.signOut();
      showLogin();
    };
  if ($("#import-open")) $("#import-open").onclick = openImport;
}
function openMember(id) {
  const r = rows().find((r) => r.member_id === id);
  if (!r) return;
  selected = id;
  const dialog = $("#member-dialog");
  dialog.innerHTML = `<header class="drawer-top"><span>MEMBER CHECK-IN</span><button type="button" class="icon-button" id="close-member" aria-label="Close member">${icon("x")}</button></header><div class="drawer-body"><div class="member-intro"><span class="avatar large rose">${esc(initials(r.member.full_name))}</span><div><h2 id="member-title">${esc(r.member.full_name)}</h2><p>${esc(r.member.membership)}</p></div></div><div class="risk-callout"><span class="priority-pill ${r.priority.toLowerCase()}">${r.priority} risk</span><strong>${esc(r.signal)}</strong><span>${r.s7} sessions in 7 days · ${r.s30} in 30 days</span>${spark(r.sequence)}</div>
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
  const d = $("#import-dialog");
  importPayload = null;
  d.innerHTML = `<div class="modal-heading"><h2 id="import-title">Import a weekly report</h2><button id="close-import" class="icon-button" aria-label="Close import">${icon("x")}</button></div><p>Upload the JSON produced by the repository’s outreach exporter. Existing notes and exemptions carry forward; reimporting replaces only that week’s risk snapshot.</p>${store.demo ? '<div class="exemption-notice">Imports are enabled after Supabase is connected. This sample workspace contains fictional records.</div>' : `<label class="upload-zone">${icon("upload-cloud")}<strong>Choose weekly outreach JSON</strong><input type="file" id="import-file" accept=".json,application/json"></label><div id="import-summary"></div><p id="import-error" class="form-error" role="alert"></p><button class="button primary" id="confirm-import" disabled>Import reviewed week</button>`}`;
  d.showModal();
  decorate();
  $("#close-import").onclick = () => d.close();
  if (store.demo) return;
  $("#import-file").onchange = async (e) => {
    try {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) throw Error("Export must be under 10 MB.");
      importPayload = validateImport(JSON.parse(await f.text()));
      const review = importPayload.identity_mode !== "clubworx-contact-id";
      $("#import-summary").innerHTML =
        `<strong>${importPayload.members.length} risk members · ${fmt(importPayload.week)}</strong><p>${esc(importPayload.source_label || "Weekly export")}</p>${review ? '<div class="identity-warning">This export uses provisional name identities. A name change or two people sharing a name can attach history incorrectly. Prefer Clubworx contact IDs.</div><label class="checkbox-label"><input type="checkbox" id="confirm-identity"> I have reviewed the member identities for this import.</label>' : ""}`;
      $("#confirm-import").disabled = review;
      if (review)
        $("#confirm-identity").onchange = (e) =>
          ($("#confirm-import").disabled = !e.target.checked);
      $("#import-error").textContent = "";
    } catch (err) {
      importPayload = null;
      $("#confirm-import").disabled = true;
      $("#import-error").textContent = err.message;
    }
  };
  $("#confirm-import").onclick = async () => {
    if (!importPayload) return;
    const b = $("#confirm-import");
    b.disabled = true;
    b.textContent = "Importing…";
    try {
      await store.import(importPayload);
      week = importPayload.week;
      d.close();
      render();
      toast("Weekly report imported. Staff history preserved.");
    } catch (err) {
      $("#import-error").textContent = err.message;
      b.disabled = false;
      b.textContent = "Import reviewed week";
    }
  };
}
async function refresh(silent = false) {
  if (refreshing) return;
  if (selected || $("#import-dialog")?.open) {
    pendingRefresh = true;
    if (!silent)
      toast("Close the current form to refresh. Your draft is preserved.");
    return;
  }
  refreshing = true;
  try {
    await store.load();
    lastSync = new Date();
    render();
    if (!silent) toast("Workspace refreshed.");
  } catch (err) {
    toast("Refresh failed: " + err.message, true);
  } finally {
    refreshing = false;
  }
}
async function start(demo) {
  if (store) await store.dispose();
  store = new Workspace(demo);
  try {
    await store.load();
    week = demo
      ? "2026-10-26"
      : store.data.weeks.at(-1)?.week || brisbaneToday();
    view = "queue";
    search = "";
    priority = "All";
    lastSync = new Date();
    render();
    store.subscribe(
      () => refresh(true),
      () => {
        const el = $(".connection");
        if (el) {
          el.className = "connection " + (store.online ? "connected" : "");
          el.innerHTML =
            '<span class="tiny-dot"></span>' +
            (store.online ? "Live updates on" : "Connected · auto-refresh");
        }
      },
    );
  } catch (err) {
    showLogin(err.message);
  }
}
function showLogin(message = "") {
  selected = null;
  $("#app").innerHTML =
    `<main class="login-page"><div class="login-brand"><img src="${urbanLogo}" alt="Urban Muaythai logo" width="54" height="54"><div>URBAN MUAYTHAI <span>COACH DESK</span></div></div><section class="login-card"><div class="login-icon">${icon("heart-handshake")}</div><div class="eyebrow">EVERY MEMBER MATTERS</div><h1>Good coaching<br>starts with a check-in.</h1><p>Your team’s weekly outreach, conversations and follow-ups. All in one place.</p>${configured ? `<form id="login-form"><label>Staff email<input id="email" type="email" autocomplete="username" required></label><label>Password<input id="password" type="password" autocomplete="current-password" required></label><p id="login-error" class="form-error" role="alert">${esc(message)}</p><button class="button primary" type="submit">Sign in to Coach Desk ${icon("arrow-right")}</button></form>` : '<p class="setup-message">Supabase is not configured yet. Explore the working sample while the live workspace is connected.</p>'}<button class="button secondary demo-start" id="start-demo">Explore sample workspace ${icon("arrow-up-right")}</button><small class="login-foot">Staff access is approved by your administrator.</small></section></main>`;
  decorate();
  $("#start-demo").onclick = () => start(true);
  if ($("#login-form"))
    $("#login-form").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector("button");
      b.disabled = true;
      try {
        const { error } = await client.auth.signInWithPassword({
          email: $("#email").value,
          password: $("#password").value,
        });
        if (error) throw error;
        await start(false);
      } catch (err) {
        $("#login-error").textContent = err.message;
        b.disabled = false;
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
if (configured) {
  client.auth
    .getSession()
    .then(({ data }) => (data.session ? start(false) : showLogin()));
  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      store?.dispose();
      showLogin();
    }
  });
} else start(true);
