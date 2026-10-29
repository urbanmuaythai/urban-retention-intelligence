import { buildOperations } from "./operations.js";
import { addDays, norm, validateImport } from "./domain.js";
import { resolveHistory, archivedEngagement } from "./history.js";

const schemas = {
  attendance: [
    "Contact ID",
    "First Name",
    "Last Name",
    "Attendances (Last 7 days)",
    "Attendances (Last 30 days)",
    "Attendance Last Marked",
    "Membership ID",
    "Membership Name",
    "Membership Attendance Limit (Description)",
  ],
  active: [
    "Contact ID",
    "Full Name",
    "Membership ID",
    "Membership Name",
    "Membership Start Date",
    "Membership Expiry Date",
    "Membership Active?",
    "Status",
  ],
  suspensions: [
    "Contact ID",
    "Full Name",
    "Suspension Starts",
    "Suspension Ends",
    "Suspension Current?",
  ],
  cancellations: [
    "Contact ID",
    "Full Name",
    "Membership ID",
    "Membership Start Date",
    "Membership Expiry Date",
    "Cancellation Date",
    "Cancellation Present?",
    "Cancellation Reason",
  ],
  history: [
    "Contact ID",
    "First Name",
    "Last Name",
    "Event Date",
    "Event Starts",
    "Event Name",
    "Attended?",
  ],
};
export const reportLabels = {
  attendance: "Member attendance",
  active: "Active memberships",
  suspensions: "Suspensions",
  cancellations: "Cancellations",
  history: "Attendance history",
};
const requiredReports = ["attendance", "active", "suspensions", "cancellations"];
// Plans that never need retention outreach: trials, Kickstarter, class packs,
// sponsored members and personal training.
const excludedPlan = (name) =>
  /kickstarter|sponsored|personal trainer|class pass|\btrials?\b/.test(norm(name));
const nonTraining = (name) =>
  /^thailand tour (deposit|final payment)$/.test(norm(name));
const date = (value, label, optional = false) => {
  if (!value && optional) return null;
  const d = new Date(value + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(+d) ||
    d.toISOString().slice(0, 10) !== value
  )
    throw Error(`${label}: expected a date in YYYY-MM-DD format.`);
  return value;
};
const count = (value, label) => {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw Error(`${label}: attendance must be a non-negative whole number.`);
  return Number(value);
};
const flag = (value, label) => {
  if (!/^(true|false)$/i.test(value))
    throw Error(`${label}: expected true or false.`);
  return value.toLowerCase() === "true";
};

// RFC-style comma-separated fields: BOM, CRLF, escaped quotes and quoted newlines.
// No field is evaluated as a formula or executable text.
export function parseCSV(input) {
  const text = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(field.trim());
    field = "";
    closed = false;
  };
  const line = () => {
    cell();
    if (row.some(Boolean)) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === ",") cell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      line();
    } else if (c === '"') {
      if (field || closed) throw Error("CSV contains an unexpected quote.");
      quoted = true;
    } else {
      if (closed && !/\s/.test(c))
        throw Error("CSV contains text after a quoted field.");
      if (!closed) field += c;
    }
  }
  if (quoted) throw Error("CSV has an unclosed quoted field.");
  if (field || row.length || closed) line();
  if (!rows.length) throw Error("CSV is empty or has no header.");
  const header = rows.shift();
  if (new Set(header).size !== header.length || header.some((x) => !x))
    throw Error("CSV has duplicate or blank column names.");
  if (rows.length > 50000) throw Error("CSV exceeds 50,000 rows.");
  return {
    header,
    rows: rows.map((values, i) => {
      if (values.length !== header.length)
        throw Error(
          `CSV row ${i + 2} has ${values.length} fields; expected ${header.length}.`,
        );
      return Object.fromEntries(header.map((key, n) => [key, values[n]]));
    }),
  };
}

export function readReports(files) {
  if (files.length !== 4 && files.length !== 5)
    throw Error(
      "Choose the four CSV files (attendance, active memberships, suspensions and cancellations), plus attendance history if exported.",
    );
  const reports = {},
    dates = new Set();
  for (const file of files) {
    const parsed = parseCSV(file.text);
    const matches = Object.entries(schemas).filter(([, required]) =>
      required.every((key) => parsed.header.includes(key)),
    );
    if (matches.length !== 1)
      throw Error(
        `${file.name}: columns do not match a required Clubworx report. Check the export setup.`,
      );
    const kind = matches[0][0];
    if (reports[kind])
      throw Error(
        `Two ${reportLabels[kind]} files selected. Choose one of each report.`,
      );
    for (const [i, row] of parsed.rows.entries()) {
      if (
        !row["Contact ID"] ||
        ("Membership ID" in row && !row["Membership ID"])
      )
        throw Error(
          `${file.name}, row ${i + 2}: Contact ID and Membership ID must be populated.`,
        );
    }
    reports[kind] = { ...parsed, name: file.name };
    const found = file.name.match(/(\d{4}-\d{2}-\d{2})(?=\.csv$)/i);
    if (found) dates.add(found[1]);
  }
  if (dates.size > 1)
    throw Error(
      "The filenames have different report dates. Export all four reports for the same cutoff.",
    );
  const missing = requiredReports.filter((kind) => !reports[kind]);
  if (missing.length)
    throw Error(
      `Missing ${missing.map((kind) => reportLabels[kind]).join(", ")}. Attendance history is the only optional report.`,
    );
  reports.suggestedWeek = [...dates][0] || null;
  if (!reports.attendance.rows.length || !reports.active.rows.length)
    throw Error(
      "Attendance and Active Memberships must contain members, including zero-attendance members.",
    );
  return reports;
}

// One row per booking or check-in. Clubworx has no booking ID, so Contact ID +
// Event Starts + Event Name is the key. Coverage starts at the earliest event date.
function sessionHistory(report, asOf) {
  if (!report) return null;
  const seen = new Set(),
    sessions = new Map();
  let from = null;
  for (const row of report.rows) {
    const day = date(row["Event Date"].slice(0, 10), "Attendance history date");
    if (!from || day < from) from = day;
    if (!flag(row["Attended?"], "Attended?")) continue;
    if (day > asOf)
      throw Error(
        `Attendance history has a session after the selected report cutoff (${asOf}): ${day} for Contact ID ${row["Contact ID"]}. Export it on the same day as the other reports.`,
      );
    const key = [row["Contact ID"], row["Event Starts"], row["Event Name"]].join(
      "|",
    );
    if (seen.has(key)) continue;
    seen.add(key);
    if (!sessions.has(row["Contact ID"])) sessions.set(row["Contact ID"], []);
    sessions.get(row["Contact ID"]).push(day);
  }
  return from ? { from, sessions } : null;
}

export function membershipTargets(reports) {
  const grouped = new Map();
  for (const row of reports.attendance.rows) {
    const name = row["Membership Name"],
      limit = row["Membership Attendance Limit (Description)"];
    if (nonTraining(name) || excludedPlan(name)) continue;
    if (!grouped.has(name)) grouped.set(name, new Set());
    grouped.get(name).add(limit);
  }
  return [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, values]) => {
      const limits = [...values];
      let target = null;
      if (/unlimited/i.test(name) || limits.every((x) => /unlimited/i.test(x)))
        target = 4;
      else if (
        limits.length === 1 &&
        /^\d+ classes every 1 weeks?$/i.test(limits[0])
      )
        target = Number(limits[0].match(/^\d+/)[0]);
      return {
        name,
        description: limits.join(" / ") || "No weekly limit supplied",
        target,
      };
    });
}

function classify(
  s7,
  s30,
  sequence,
  target,
  engagement,
  archived = false,
  settled = true,
) {
  const prior = sequence.slice(-6, -1),
    known = prior.filter((x) => x !== null);
  const prev = prior.at(-1),
    prev2 = prior.at(-2),
    average = known.length
      ? known.reduce((a, b) => a + b, 0) / known.length
      : 0;
  let streak = 0;
  for (const n of [...sequence].reverse()) {
    if (n !== 0) break;
    streak++;
  }
  if (s7 === 0 && streak >= 2)
    return [
      "Red",
      archived
        ? `Repeated zero · ${streak} weekly snapshots`
        : `Ghosting · ${streak} straight zero weeks`,
    ];
  // Consistent recent weeks, then nothing: on target first, then any attendance.
  const recent = sequence.slice(-4, -1);
  if (s7 === 0 && recent.length === 3 && recent.every((n) => n > 0)) {
    if (target !== null && recent.every((n) => n >= target))
      return ["Red", `Was on target · 3 weeks at ${target}+ → 0`];
    return ["Red", "Routine broken · 3 weeks attending → 0"];
  }
  if (s7 === 0 && ((prev ?? 0) >= 2 || average >= 2))
    return ["Red", `Sharp stop · ${prev ?? average.toFixed(1)} → 0`];
  // Missing weeks count as no session found; members in their first week stay in Review.
  if (settled && s7 === 0 && !s30 && !sequence.slice(-7).some((n) => n > 0))
    return ["Red", "No sessions found · last 7 weeks"];
  if (s7 === 0 && s30 > 0) return ["Yellow", `New zero · ${s30} visits in 30d`];
  if (s7 > 0 && ((prev ?? s7) >= s7 + 2 || average - s7 >= 1.5))
    return ["Yellow", `Cooling · ${prev ?? average.toFixed(1)} → ${s7}`];
  if (
    s7 > 0 &&
    norm(engagement) === "fringe" &&
    ((prev2 ?? s7) > s7 || (prev ?? s7) > s7)
  )
    return ["Yellow", "Fringe slide · declining weekly attendance"];
  if (s7 > 0 && norm(engagement) === "fringe" && target !== null && s7 < target)
    return ["Watch", `Below target · ${s7} of ${target} sessions`];
  if (s7 === 0)
    return ["Review", "No attendance · weekly history needs review"];
  if (!engagement && target !== null && s7 < target)
    return [
      "Review",
      `Below target · ${s7} of ${target}; engagement not supplied`,
    ];
  return null;
}

export function convertReports(
  reports,
  week,
  targets,
  history = [],
  asOf = week,
  baselines = [],
) {
  date(week, "Report date");
  if (new Date(week + "T12:00:00Z").getUTCDay() !== 1)
    throw Error("Choose a Monday for the report week.");

  date(asOf, "Data as of");

  if (asOf < week || asOf > addDays(week, 6))
    throw Error(
      `Data-as-of date ${asOf} does not match the selected report week ${week}. Select the Monday of that same week.`,
    );

  if (reports.suggestedWeek && reports.suggestedWeek !== asOf)
    throw Error(
      "Data-as-of date does not match the date in the CSV filenames. Select the actual export date; the report week remains its Monday.",
    );
  const attendance = new Map(),
    roster = new Map(),
    nameMap = new Map();
  for (const [kind, report] of Object.entries(reports)) {
    if (!report?.rows) continue;
    for (const row of report.rows) {
      const id = row["Contact ID"],
        name = row["Full Name"] || `${row["First Name"]} ${row["Last Name"]}`;
      if (nameMap.has(id) && nameMap.get(id) !== norm(name))
        throw Error(
          `Contact ID ${id} has conflicting names across the reports. Review this identity before importing.`,
        );
      nameMap.set(id, norm(name));
    }
  }
  const attendanceMemberships = new Map();
  for (const row of reports.attendance.rows) {
    const id = row["Contact ID"],
      mid = row["Membership ID"];
    if (attendanceMemberships.has(mid))
      throw Error(
        `Attendance repeats Membership ID ${mid}. Export one row per membership.`,
      );
    attendanceMemberships.set(mid, row);
    const s7 = count(row["Attendances (Last 7 days)"], "7-day attendance"),
      s30 = count(row["Attendances (Last 30 days)"], "30-day attendance");
    if (s7 > s30)
      throw Error(
        `Contact ID ${id}: 7-day attendance is greater than 30-day attendance.`,
      );
    const last = date(
      row["Attendance Last Marked"].slice(0, 10),
      "Last attendance",
      true,
    );

    if (last && last > asOf)
      throw Error(
        `Attendance contains a date after the selected report cutoff (${asOf}): ${last} for Contact ID ${id}. Set Data as of to the actual export date, or use exports for the chosen cutoff. Rolling 7-day and 30-day totals cannot be backdated.`,
      );
    const prev = attendance.get(id);
    if (prev && (prev.s7 !== s7 || prev.s30 !== s30))
      throw Error(
        `Contact ID ${id} has conflicting attendance totals across memberships. Do not sum these rows.`,
      );
    attendance.set(id, {
      s7,
      s30,
      name: `${row["First Name"]} ${row["Last Name"]}`.trim(),
      phone: row["Phone Number"] || null,
      engagement: row.Engagement || "",
    });
  }
  const membershipIds = new Set();
  let futureStarts = 0,
    excludedProducts = 0,
    excludedPlans = 0;
  for (const row of reports.active.rows) {
    const id = row["Contact ID"],
      mid = row["Membership ID"];
    if (membershipIds.has(mid))
      throw Error(`Active Memberships repeats Membership ID ${mid}.`);
    membershipIds.add(mid);
    const source = attendanceMemberships.get(mid);
    if (
      !source ||
      source["Contact ID"] !== id ||
      source["Membership Name"] !== row["Membership Name"]
    )
      throw Error(
        `Membership ID ${mid} does not match Attendance. Use exports from the same cutoff.`,
      );
    const start = date(row["Membership Start Date"], "Membership start"),
      end = date(row["Membership Expiry Date"], "Membership expiry", true);
    if (end && end < start)
      throw Error(`Membership ID ${mid} ends before it starts.`);
    const active = flag(row["Membership Active?"], "Membership Active?");
    if (!roster.has(id)) roster.set(id, []);
    if (excludedPlan(row["Membership Name"])) {
      excludedPlans++;
      continue;
    }
    if (nonTraining(row["Membership Name"])) {
      excludedProducts++;
      continue;
    }

    if (start > asOf) {
      futureStarts++;
      continue;
    }
    if (
      !active ||
      (end && end < asOf) ||
      /^(cancelled|not attending)$/i.test(row.Status)
    )
      continue;
    if (!/^(active|suspended)$/i.test(row.Status))
      throw Error(`Unrecognised membership status: ${row.Status}.`);
    roster.get(id).push(row);
  }
  if (
    attendance.size !== roster.size ||
    [...attendance.keys()].some((id) => !roster.has(id)) ||
    attendanceMemberships.size !== membershipIds.size
  )
    throw Error(
      "Attendance and Active Memberships do not cover the same people and memberships. Include zero-attendance members and export both reports together.",
    );
  const suspended = new Set(),
    suspensionIntervals = new Map();
  for (const row of reports.suspensions.rows) {
    const start = date(row["Suspension Starts"], "Suspension start"),
      end = date(row["Suspension Ends"], "Suspension end", true);
    if (end && end < start) throw Error("Suspension ends before it starts.");
    flag(row["Suspension Current?"], "Suspension Current?");
    if (!suspensionIntervals.has(row["Contact ID"]))
      suspensionIntervals.set(row["Contact ID"], []);
    suspensionIntervals.get(row["Contact ID"]).push({ start, end });

    if (start <= asOf && (!end || end >= asOf))
      suspended.add(row["Contact ID"]);
  }
  let flaggedCancellations = 0,
    effectiveCancellations = 0;
  const cancellationIds = new Set();
  for (const row of reports.cancellations.rows) {
    const mid = row["Membership ID"];
    if (cancellationIds.has(mid))
      throw Error(`Cancellations repeats Membership ID ${mid}.`);
    cancellationIds.add(mid);
    const start = date(
        row["Membership Start Date"],
        "Cancellation membership start",
      ),
      end = date(
        row["Membership Expiry Date"],
        "Cancellation membership expiry",
        true,
      );
    date(row["Cancellation Date"], "Cancellation date", true);
    if (end && end < start)
      throw Error("Cancelled membership ends before it starts.");
    if (flag(row["Cancellation Present?"], "Cancellation Present?")) {
      flaggedCancellations++;
      if (
        end &&
        end <= asOf &&
        norm(row["Cancellation Reason"]) !== "roll over"
      )
        effectiveCancellations++;
    }
  }
  const sessions = sessionHistory(reports.history, asOf);
  // Real session dates replace saved snapshots for every week the export fully covers.
  const covered = [];
  const historical = resolveHistory(week, asOf, history, baselines).map(
    (slot, i) => {
      const cutoff = addDays(asOf, (i - 7) * 7);
      covered[i] = !!sessions && addDays(cutoff, -6) >= sessions.from;
      return covered[i] ? { date: cutoff, archived: false, rows: null } : slot;
    },
  );
  const members = [],
    snapshot = [];
  let held = 0,
    statusHeld = 0,
    noMembership = 0,
    noHistory = 0,
    archivedMembers = 0,
    engagementRecovered = 0;
  for (const [id, plans] of roster) {
    if (!plans.length) {
      noMembership++;
      continue;
    }
    if (suspended.has(id)) {
      held++;
      continue;
    }
    if (plans.every((r) => r.Status.toLowerCase() === "suspended")) {
      statusHeld++;
      continue;
    }
    const currentPlans = plans.filter(
      (r) => r.Status.toLowerCase() === "active",
    );
    const weeklyTargets = currentPlans.map(
      (r) => targets[r["Membership Name"]] ?? null,
    );
    for (const value of weeklyTargets)
      if (
        value !== null &&
        (!Number.isInteger(value) || value < 1 || value > 30)
      )
        throw Error(
          "Weekly targets must be blank or a whole number from 1 to 30.",
        );
    const target = weeklyTargets.some((x) => x !== null)
      ? Math.max(...weeklyTargets.filter((x) => x !== null))
      : null;
    const a = attendance.get(id),
      member_id = "clubworx:" + id;
    const membershipStart = currentPlans
      .map((p) => p["Membership Start Date"])
      .sort()[0];
    const sequence = historical
      .map((slot, i) => {
        const count = covered[i]
          ? (sessions.sessions.get(id) || []).filter(
              (day) => day >= addDays(slot.date, -6) && day <= slot.date,
            ).length
          : (slot.rows.get(member_id)?.s7 ?? null);
        if (membershipStart > addDays(asOf, -6)) return null;
        if (count === 0 && membershipStart > addDays(slot.date, -6))
          return null;
        if (
          (suspensionIntervals.get(id) || []).some(
            (p) =>
              p.start <= slot.date &&
              (!p.end || p.end >= addDays(slot.date, -6)),
          )
        )
          return null;
        return count;
      })
      .concat(a.s7);
    const usesArchive = historical.some(
      (slot, i) => slot.archived && !covered[i] && sequence[i] !== null,
    );
    if (usesArchive) archivedMembers++;
    const engagement = a.engagement
      ? null
      : archivedEngagement(member_id, asOf, currentPlans, baselines);
    if (engagement) engagementRecovered++;
    if (sequence.slice(0, -1).every((x) => x === null)) noHistory++;
    snapshot.push({ member_id, s7: a.s7, s30: a.s30 });
    const classification = classify(
      a.s7,
      a.s30,
      sequence,
      target,
      a.engagement || engagement?.value || "",
      usesArchive,
      membershipStart <= addDays(asOf, -6),
    );
    if (classification)
      members.push({
        member_id,
        name: a.name,
        phone: a.phone,
        membership: [
          ...new Set(currentPlans.map((r) => r["Membership Name"])),
        ].join(" / "),
        priority: classification[0],
        signal: classification[1],
        s7: a.s7,
        s30: a.s30,
        sequence,
      });
  }
  if (!snapshot.length)
    throw Error(
      "No eligible training members remain after the date, membership and suspension checks. Review the exports before replacing a report.",
    );
  const rank = { Red: 0, Yellow: 1, Watch: 2, Review: 3 };
  members.sort(
    (a, b) =>
      rank[a.priority] - rank[b.priority] ||
      a.s7 - b.s7 ||
      a.name.localeCompare(b.name),
  );
  const retentionPolicy =
    [...history]
      .sort((a, b) => b.week.localeCompare(a.week))
      .find((w) => w.import_summary?.retentionPolicy)?.import_summary
      .retentionPolicy || null;
  const summary = {
    retentionPolicy,
    operations: buildOperations(reports, week, asOf, retentionPolicy, history),
    targets,

    asOf,

    rosterContacts: roster.size,
    membershipRows: reports.active.rows.length,
    eligible: snapshot.length,
    currentSuspensions: held,
    suspensionStatusHeld: statusHeld,
    excludedProductRows: excludedProducts,
    excludedPlanRows: excludedPlans,
    futureStartRows: futureStarts,
    noEligibleMembership: noMembership,
    noPriorWeeklyHistory: noHistory,
    historicalSync: {
      archivedMembers,
      engagementRecovered,
      baselineWeeks: baselines.length,
      sourceRange: baselines.length
        ? [
            baselines.map((b) => b.as_of).sort()[0],
            baselines
              .map((b) => b.as_of)
              .sort()
              .at(-1),
          ]
        : [],
      comparisonMode:
        "Exact rolling cutoffs preferred; archived Monday summaries may differ by one day and retain their original dates.",
    },
    sequenceDates: historical.map((slot) => slot.date).concat(asOf),
    attendanceHistory: sessions
      ? {
          from: sessions.from,
          coveredWeeks: covered.filter(Boolean).length,
          sessions: [...sessions.sessions.values()].reduce(
            (sum, days) => sum + days.length,
            0,
          ),
        }
      : null,
    review: members.filter((m) => m.priority === "Review").length,
    flaggedCancellations,
    effectiveCancellations,
    cancellationRows: reports.cancellations.rows.length,
  };
  const payload = {
    version: 1,
    week,
    identity_mode: "clubworx-contact-id",
    source_label: "Clubworx four-CSV import · full eligible training roster",
    members,
    attendance_snapshot: snapshot,
    import_summary: summary,
  };
  validateImport(payload);
  return { payload, summary };
}
