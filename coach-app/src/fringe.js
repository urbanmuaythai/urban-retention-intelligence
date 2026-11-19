// Fringe reach-out: members who trained this week but stayed under their weekly
// membership target. Same rules as the Monday "Pipeline Party" sheet:
//   0 sessions            → Sleeper (At Risk handles these)
//   1+ but below target   → Fringe (this list)
//   at or above target    → Engaged
//   no recognised target  → Needs review
// Kickstarters, trials, sponsored, PT and Thailand Tour plans are already removed
// by the import; part payments and deposits are removed here as well.

export const FRINGE_METHODS = [
  "Phone call",
  "SMS",
  "Email",
  "In person",
  "Social message",
];

const notTrainingPlan = (name) => /part payment|deposit/i.test(name);
export const isU18 = (membership) =>
  /15\s*-\s*18|teen|kid|junior|little|youth|u18/i.test(membership);

/**
 * people: [{ member_id, name, phone, plans: [membership names], s7, s30, last }]
 * targets: { "Membership name": weekly target | null }
 * earlier: this week's saved Fringe list. The import runs every morning, so anyone
 * already listed this week stays on (fresh numbers + a "carried" note) and their
 * reach-out keeps counting, even after they reach target.
 */
export function buildFringe(people, targets, earlier = []) {
  const rows = new Map();
  const members = [],
    review = [];
  let sleepers = 0,
    engaged = 0,
    excluded = 0;
  // Sessions in the last 7 days, banded like the sheet: 0, 1, 2, 3, 4+.
  const blank = () => ({ bands: [0, 0, 0, 0, 0], sleepers: 0, fringe: 0, engaged: 0, review: 0 });
  const groups = { Adults: blank(), U18: blank() };
  for (const p of people) {
    const plans = [...new Set(p.plans)].filter((n) => !notTrainingPlan(n));
    if (!plans.length) {
      excluded++;
      continue;
    }
    const goals = plans
      .map((n) => targets[n] ?? null)
      .filter((x) => x !== null);
    const target = goals.length ? Math.max(...goals) : null;
    const membership = plans.join(" / ");
    const row = {
      member_id: p.member_id,
      name: p.name,
      phone: p.phone || null,
      membership,
      group: isU18(membership) ? "U18" : "Adults",
      target,
      s7: p.s7,
      s30: p.s30,
      last: p.last || null,
    };
    rows.set(row.member_id, row);
    const g = groups[row.group];
    g.bands[Math.min(p.s7, 4)]++;
    if (p.s7 === 0) {
      sleepers++;
      g.sleepers++;
    } else if (target === null) {
      review.push(row);
      g.review++;
    } else if (p.s7 >= target) {
      engaged++;
      g.engaged++;
    } else {
      members.push(row);
      g.fringe++;
    }
  }
  const lastName = (n) => n.split(" ").slice(1).join(" ") || n;
  const order = (a, b) =>
    a.s7 - b.s7 ||
    a.membership.localeCompare(b.membership) ||
    lastName(a.name).localeCompare(lastName(b.name));
  members.sort(order);
  review.sort(order);
  const listed = new Set(members.map((m) => m.member_id));
  const carried = [];
  for (const prev of earlier || []) {
    if (!prev?.member_id || listed.has(prev.member_id)) continue;
    listed.add(prev.member_id);
    const now = rows.get(prev.member_id);
    const { carried: _old, ...base } = prev;
    carried.push({
      ...(now || base),
      carried: !now
        ? "No longer tracked"
        : now.s7 === 0
          ? "Now 0 sessions"
          : now.target === null
            ? "Target needs review"
            : "Now on target",
    });
  }
  carried.sort(order);
  return { members: members.concat(carried), review, sleepers, engaged, excluded, groups };
}

/** Clubworx profile and New Message links (same as the NMS app); null for non-Clubworx IDs. */
export function clubworxLinks(memberId) {
  const id = /^clubworx:(\d+)$/.exec(memberId || "")?.[1];
  if (!id) return null;
  const profile = `https://app.clubworx.com/gyms/2519/members/${id}`;
  return { profile, message: profile + "#comms" };
}

export function clubworxButtons(memberId, icon, compact = false) {
  const links = clubworxLinks(memberId);
  if (!links) return "";
  return compact
    ? `<a class="row-open clubworx-mini" href="${links.message}" target="_blank" rel="noopener" aria-label="Message in Clubworx" title="Message in Clubworx">${icon("message-circle")}</a>`
    : `<div class="clubworx-actions"><a class="button primary" href="${links.message}" target="_blank" rel="noopener">${icon("message-circle")} Message in Clubworx</a><a class="button secondary" href="${links.profile}" target="_blank" rel="noopener">${icon("arrow-up-right")} Open Clubworx profile</a></div>`;
}

export function targetLabel(target) {
  if (target === null || target === undefined) return "No target";
  return target >= 4 ? "4+ / week" : `${target} / week`;
}

/** The newest saved note for each member on this week's Fringe list. */
export function fringeContacts(rows = [], week) {
  const map = new Map();
  for (const r of rows) if (r.week === week) map.set(r.member_id, r);
  return map;
}

/** Still needs a reach-out: not contacted and still under target (not carried over). */
export const needsContact = (m, entry) => !entry?.contacted_on && !m.carried;
const contactedFilter = (status, m, entry) =>
  status === "All" ||
  (status === "Contacted" ? !!entry?.contacted_on : needsContact(m, entry));

/** Rows shown in the Fringe tab for the chosen filters. */
export function fringeVisible(fringe, contacts, { group, status, search }) {
  const q = (search || "").toLowerCase();
  return (fringe?.members || []).filter(
    (m) =>
      (group === "All" || m.group === group) &&
      contactedFilter(status, m, contacts.get(m.member_id)) &&
      (!q || (m.name + " " + m.membership).toLowerCase().includes(q)),
  );
}

export function fringeView(data, week, state, h) {
  const { esc, fmt, icon } = h;
  const report = data.weeks.find((w) => w.week === week);
  const fringe = report?.import_summary?.fringe;
  const weeks = [...data.weeks].sort((a, b) => b.week.localeCompare(a.week));
  const asOf = report?.import_summary?.asOf || week;
  const header = `<div class="page-heading"><div><div class="eyebrow">EVERY MEMBER MATTERS</div><h1>Fringe reach-out<span class="heading-dot">.</span></h1><p>${report ? "Attendance data as of " + fmt(asOf) + ". " : ""}Members who trained this week but are under their membership’s weekly target.</p></div><div class="heading-actions"><label class="week-control">${icon("calendar-days")}<span><small>REPORT WEEK</small><select id="week" aria-label="Report week">${weeks.map((w) => `<option value="${esc(w.week)}" ${w.week === week ? "selected" : ""}>${fmt(w.week)}</option>`).join("")}</select></span></label></div></div>`;
  if (!fringe)
    return (
      header +
      '<section class="queue-panel reporting-empty"><h2>Import this week again to see Fringe</h2><p>The Fringe list is worked out during the Monday import. This saved week was imported before the Fringe tab existed. An administrator can import the four Clubworx CSVs for this week again; staff notes and exemptions are kept.</p></section>'
    );
  const contacts = fringeContacts(data.fringeOutreach, week);
  const all = fringe.members;
  const contacted = all.filter((m) => contacts.get(m.member_id)?.contacted_on).length;
  const validated = all.filter((m) => contacts.get(m.member_id)?.validated).length;
  const adults = all.filter((m) => m.group === "Adults").length;
  const visible = fringeVisible(fringe, contacts, state);
  const toContact = all.filter((m) => needsContact(m, contacts.get(m.member_id))).length;
  const carried = all.filter((m) => m.carried).length;
  const progress = all.length ? Math.round((contacted / all.length) * 100) : 0;
  const metric = ([n, title, sub, ic, tone]) =>
    `<article class="metric ${tone}"><div class="metric-top"><span>${title}</span><span class="metric-icon">${icon(ic)}</span></div><strong>${n}</strong><small>${sub}</small></article>`;
  const day = (iso) => (iso ? fmt(iso.slice(0, 10)) : "—");
  const initials = (n) => n.split(" ").map((x) => x[0]).slice(0, 2).join("");
  const row = (m) => {
    const c = contacts.get(m.member_id);
    const done = !!c?.contacted_on;
    return `<tr><td><button class="member-button" data-fringe="${esc(m.member_id)}"><span class="avatar slate">${esc(initials(m.name))}</span><span><strong>${esc(m.name)}</strong><small>${esc(m.membership)}</small></span></button></td><td><span class="priority-pill watch">${esc(m.group)}</span><small class="signal">Target ${esc(targetLabel(m.target))}</small>${m.carried ? `<small class="signal carried-note">${esc(m.carried)}</small>` : ""}</td><td><strong>${m.s7} of ${m.target ?? "?"}</strong><small class="session-label">${m.s30} in 30 days</small></td><td>${day(m.last)}</td><td><span class="status-label ${done ? "done" : ""}" data-status="${done ? "done" : "open"}">${icon(done ? "message-circle" : "circle-dashed")}${done ? esc(c.method || "Contacted") : "To contact"}</span><small class="status-detail">${done ? fmt(c.contacted_on) + (c.validated ? " · Validated" : " · Validation pending") : c?.notes ? "Note saved · not contacted yet" : "No reach-out recorded"}</small></td><td><div class="row-actions">${clubworxButtons(m.member_id, icon, true)}<button class="row-open" data-fringe="${esc(m.member_id)}" aria-label="Open ${esc(m.name)}">${icon("arrow-up-right")}</button></div></td></tr>`;
  };
  const filters = `<div class="filters"><div class="priority-filters" role="group" aria-label="Filter by group">${["All", "Adults", "U18"].map((g) => `<button data-fringe-group="${g}" class="filter ${state.group === g ? "active" : ""}" aria-pressed="${state.group === g}">${g === "All" ? "Adults + U18" : g === "U18" ? "U18 · Kids & Teens" : g}</button>`).join("")}</div><label class="stage-filter">Reach-out<select id="fringe-status">${["To contact", "Contacted", "All"].map((s) => `<option ${state.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><label class="search">${icon("search")}<input id="fringe-search" placeholder="Search members or memberships…" aria-label="Search Fringe members" value="${esc(state.search)}"></label></div>`;
  const guide = `<details class="risk-guide"><summary>${icon("info")} How the Fringe list works</summary><p class="risk-guide-note"><strong>Same rules as the Monday Pipeline Party sheet.</strong> Each membership has a weekly target: unlimited plans (Accelerate, Short Term Unlimited, Upfront Adult, Teens and 15-18 unlimited) = 4; Fun &amp; Fitness 3x and 15-18 3x = 3; Teens 2x = 2. Targets come from the weekly target list in Import week.</p><p class="risk-guide-note"><strong>Sleepers</strong> (0 sessions in the last 7 days) are not on this list; they are on At Risk. <strong>Fringe</strong> = at least 1 session but under target. <strong>Engaged</strong> = at or over target. A membership with no target goes to Needs review.</p><p class="risk-guide-note"><strong>Updates automatically:</strong> Clubworx exports every morning and Member Care imports them within about 40 minutes, so the list refreshes daily. Anyone already listed this week stays on with fresh numbers (for example “Now on target”), so their reach-out still counts; they drop out of “To contact”. A new week starts each Monday.</p><p class="risk-guide-note">Left out: Kickstarters, trials, sponsored, personal training, class passes, part payments, deposits, Thailand Tour, and members with a current suspension. U18 = 15-18, Teens and Kids memberships.</p></details>`;
  const table = (list, empty) =>
    `<div class="table-scroll"><table class="fringe-table"><thead><tr><th>MEMBER</th><th>GROUP · TARGET</th><th>7-DAY</th><th>LAST ATTENDED</th><th>REACH-OUT</th><th><span class="sr-only">Open member</span></th></tr></thead><tbody>${list.map(row).join("") || `<tr><td colspan="6"><div class="empty">${icon("check-check")}<h3>${empty}</h3></div></td></tr>`}</tbody></table></div>`;
  const review = fringe.review.length
    ? `<section class="queue-panel"><div class="panel-heading"><div><h2>Needs review <span class="count-chip">${fringe.review.length}</span></h2><p>These memberships have no weekly target. An administrator can set one in Import week ▸ Review weekly attendance targets.</p></div></div><div class="table-scroll"><table><thead><tr><th>MEMBER</th><th>GROUP</th><th>7-DAY</th><th>LAST ATTENDED</th></tr></thead><tbody>${fringe.review.map((m) => `<tr><td><strong>${esc(m.name)}</strong><br><small>${esc(m.membership)}</small></td><td>${esc(m.group)}</td><td>${m.s7} · ${m.s30} in 30 days</td><td>${day(m.last)}</td></tr>`).join("")}</tbody></table></div></section>`
    : "";
  return (
    header +
    `<section class="metric-grid" aria-label="Fringe summary">${[
      [all.length, "Fringe members", `${adults} Adults · ${all.length - adults} U18`, "users", ""],
      [toContact, "To contact", carried ? `${carried} no longer under target` : "No reach-out recorded yet", "inbox", "amber"],
      [contacted, "Contacted", `${validated} validated by admin`, "circle-check", "green"],
      [fringe.review.length, "Needs review", "Membership target not recognised", "flag", "red"],
    ]
      .map(metric)
      .join("")}</section>` +
    `<section class="weekly-progress"><span class="progress-symbol">${icon("heart-handshake")}</span><div class="progress-copy"><strong>Keep them on track</strong><span>${contacted} of ${all.length} Fringe members contacted · ${fringe.engaged} engaged · ${fringe.sleepers} sleepers (on At Risk).</span></div><div class="progress-meter"><div><span>WEEKLY COVERAGE</span><b>${progress}%</b></div><progress value="${contacted}" max="${Math.max(1, all.length)}" aria-label="Fringe members contacted this week"></progress></div></section>` +
    (data.fringeTracking === false
      ? `<p class="scope-note">${icon("info")} The list is ready, but saving reach-outs isn’t switched on yet. An administrator needs to finish the setup.</p>`
      : "") +
    `<section class="queue-panel"><div class="panel-heading"><div><h2>The Fringe reach-out list <span class="count-chip">${visible.length}</span></h2><p>Fewest sessions first. Open a member to record the reach-out.</p></div><span class="subtle">${icon("shield-check")} Staff workspace</span></div>${filters}${guide}${table(visible, state.search ? "No members match your search" : state.status === "To contact" ? "Everyone in this view has been contacted or is back on target" : "No members in this view")}<footer class="table-footer"><span>${visible.length} members shown · week beginning ${fmt(week)} · data as of ${fmt(asOf)}</span><span>Weekly attendance snapshot</span></footer></section>` +
    review
  );
}
