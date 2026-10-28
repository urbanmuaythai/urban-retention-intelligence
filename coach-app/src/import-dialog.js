import { addDays, brisbaneToday, validateImport } from "./domain.js";
import {
  readReports,
  reportLabels,
  membershipTargets,
  convertReports,
} from "./csv-import.js";

export function showImport({ store, onImported, decorate, esc, fmt, icon }) {
  const d = document.querySelector("#import-dialog"),
    $ = (s) => d.querySelector(s);
  let payload = null,
    reports = null,
    reading = 0,
    saving = false;
  const today = brisbaneToday(),
    weekday = new Date(today + "T12:00:00Z").getUTCDay();
  const monday = addDays(today, -((weekday + 6) % 7));
  d.innerHTML = `<div class="modal-heading"><h2 id="import-title">Import weekly Clubworx reports</h2><button id="close-import" class="icon-button" aria-label="Close import">${icon("x")}</button></div>
  <p>Select the four CSV exports together, plus Attendance history if you exported it. We match Contact IDs, automatically check the files and prepare the weekly update as soon as you select them. Existing notes and exemptions stay attached to each member.</p>

  <p id="import-progress" role="status">Choose your four reports (plus Attendance history if exported) to begin.</p><p id="import-error" class="form-error" role="alert" tabindex="-1" hidden></p>

  <label class="upload-zone">${icon("upload-cloud")}<strong>Choose the Clubworx CSV reports</strong><input type="file" id="import-csv" multiple accept=".csv,text/csv"></label>
  <p class="import-hint">Attendance · Active memberships · Suspensions · Cancellations, plus optional Attendance history (UMC 05). Export them all on the same day, including members with zero attendance.</p>

  <label class="import-date">Data as of (actual export date)<input type="date" id="import-as-of" value="${today}" max="${today}"></label>

  <p class="import-hint">Rolling attendance totals use the actual export date. The Monday date below groups the report into its week.</p>

  <label class="import-date">Report week beginning (Monday)<input type="date" id="import-week" value="${monday}" max="${today}"></label>

  <div id="csv-files" aria-live="polite"></div><div id="csv-targets"></div>
  <button class="button secondary" id="preview-csv" disabled>Recheck files & preview</button>
  <details class="advanced-import"><summary>Advanced: prepared JSON export</summary><label>Choose an existing outreach JSON<input type="file" id="import-file" accept=".json,application/json"></label></details>

  <div id="import-summary" aria-live="polite"></div>

  <button class="button primary" id="confirm-import" disabled>Import reviewed week</button>`;
  d.showModal();
  decorate();
  const invalidate = () => {
    payload = null;
    $("#confirm-import").disabled = true;

    $("#confirm-import").textContent = "Import reviewed week";

    $("#import-error").hidden = true;

    $("#import-progress").textContent =
      "Check files & preview before importing.";

    $("#import-summary").innerHTML = "";
    $("#import-error").textContent = "";
  };
  const fail = (err) => {
    invalidate();
    $("#import-error").textContent =
      err.message || "Could not read these reports.";

    $("#import-error").hidden = false;

    $("#import-progress").textContent =
      "Import paused — the files need attention.";

    $("#confirm-import").textContent = "Resolve the issue before importing";

    $("#import-error").focus();
  };
  const close = () => {
    if (!saving) {
      reading++;
      d.close();
    }
  };
  $("#close-import").onclick = close;
  d.oncancel = (e) => {
    if (saving) e.preventDefault();
    else reading++;
  };
  $("#import-week").onchange = invalidate;

  $("#import-as-of").onchange = () => {
    invalidate();

    const asOf = $("#import-as-of").value;

    if (asOf) {
      const day = new Date(asOf + "T12:00:00Z").getUTCDay();

      $("#import-week").value = addDays(asOf, -((day + 6) % 7));
    }
  };

  $("#import-csv").onchange = async (e) => {
    const ticket = ++reading;
    invalidate();
    reports = null;
    $("#preview-csv").disabled = true;
    $("#csv-files").textContent = "Reading files…";
    $("#csv-targets").innerHTML = "";
    $("#import-file").value = "";
    try {
      const files = [...e.target.files];
      if (files.length !== 4 && files.length !== 5)
        throw Error(
          "Select the four CSV reports together, plus Attendance history if exported.",
        );
      if (files.some((f) => f.size > 10 * 1024 * 1024))
        throw Error("Each CSV must be under 10 MB.");
      const texts = await Promise.all(
        files.map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      if (ticket !== reading || !d.open) return;
      reports = readReports(texts);

      const asOf = reports.suggestedWeek || today;

      $("#import-as-of").value = asOf;

      const day = new Date(asOf + "T12:00:00Z").getUTCDay();

      $("#import-week").value = addDays(asOf, -((day + 6) % 7));

      $("#import-progress").textContent =
        "Files read. Confirm Data as of, then check the preview.";

      $("#csv-files").innerHTML = `<ul>${Object.entries(reportLabels)
        .filter(([key]) => reports[key])
        .map(
          ([key, label]) =>
            `<li><strong>${label}</strong>: ${reports[key].rows.length} rows · ${esc(reports[key].name)}</li>`,
        )
        .join("")}</ul>`;
      $("#csv-targets").innerHTML =
        `<details><summary>Review weekly attendance targets</summary><p>Unlimited plans default to four sessions. Class-pass package sizes are not weekly goals: leave these blank unless a weekly goal is agreed. When members have multiple plans, we use the highest weekly goal.</p><div class="target-list">${membershipTargets(
          reports,
        )
          .map((plan) => {
            const saved = store.data.weeks
              .filter((w) => w.import_summary?.targets)
              .at(-1)?.import_summary.targets;
            return saved && Object.hasOwn(saved, plan.name)
              ? { ...plan, target: saved[plan.name] }
              : plan;
          })
          .map(
            (plan, i) =>
              `<label>${esc(plan.name)}<small>${esc(plan.description)}</small><input type="number" data-target="${i}" data-membership="${esc(plan.name)}" min="1" max="30" step="1" value="${plan.target ?? ""}" placeholder="No weekly goal" aria-label="Weekly target for ${esc(plan.name)}"></label>`,
          )
          .join("")}</div></details>`;
      $("#csv-targets")
        .querySelectorAll("input")
        .forEach((el) => (el.oninput = invalidate));
      $("#csv-files").dataset.ready = "true";
      $("#preview-csv").disabled = false;
      $("#preview-csv").click();
    } catch (err) {
      if (ticket === reading && d.open) {
        $("#csv-files").textContent = "";
        fail(err);
      }
    }
  };
  const confirmReview = (extra) => {
    $("#import-summary").insertAdjacentHTML(
      "beforeend",

      `${extra}<label class="checkbox-label"><input type="checkbox" id="confirm-identity"> I reviewed the report week, data-as-of date, exclusions and member identities. ${store.data.weeks.some((w) => w.week === payload.week) ? "This replaces the existing snapshot for this week." : "This creates a new weekly snapshot."}</label>`,
    );
    $("#confirm-identity").onchange = (e) => {
      $("#confirm-import").disabled = !e.target.checked || store.demo;
    };
  };
  $("#preview-csv").onclick = () => {
    invalidate();
    try {
      if (!reports) throw Error("Choose the four CSV reports first.");

      const week = $("#import-week").value,
        asOf = $("#import-as-of").value;

      if (week > today || asOf > today)
        throw Error("The report cutoff cannot be in the future.");
      if (store.data.members.some((m) => m.id.startsWith("name-v1:")))
        throw Error(
          "This workspace has provisional name identities. Reconcile those IDs to Clubworx Contact IDs before using CSV import, so existing notes stay attached correctly.",
        );
      const targets = Object.fromEntries(
        [...$("#csv-targets").querySelectorAll("input")].map((el) => [
          el.dataset.membership,
          el.value === "" ? null : Number(el.value),
        ]),
      );

      const result = convertReports(
        reports,
        week,
        targets,
        store.data.weeks,
        asOf,
        store.data.baselines || [],
      );

      payload = result.payload;

      $("#import-progress").textContent =
        "Preview ready. Review the results before confirming.";

      const s = result.summary,
        totals = ["Red", "Yellow", "Watch", "Review"]
          .map(
            (p) =>
              `${payload.members.filter((m) => m.priority === p).length} ${p}`,
          )
          .join(" · ");
      $("#import-summary").innerHTML =
        `<h3>Week beginning ${fmt(week)} · ${payload.members.length} members to assess</h3><p><strong>Data as of ${fmt(asOf)}</strong> · rolling attendance totals use the actual export date.</p><p>${s.historicalSync.archivedMembers} members linked to archived weekly summaries; ${s.historicalSync.engagementRecovered} engagement labels recovered. Older summary cutoffs may differ by one day; original dates remain visible.</p><p>${totals}</p><ul><li>${s.rosterContacts} people across ${s.membershipRows} membership rows; attendance counted once per person.</li><li>${s.eligible} eligible training members saved for weekly comparisons.</li><li>${s.currentSuspensions} currently suspended contacts held out; ${s.suspensionStatusHeld} additional contacts held by membership status.</li><li>${s.excludedProductRows} tour-payment memberships excluded; ${s.futureStartRows} future-start memberships excluded.</li><li>${s.noPriorWeeklyHistory} eligible people have no prior weekly snapshot here. Missing weeks stay unknown.</li>${s.attendanceHistory ? `<li>Attendance history: ${s.attendanceHistory.sessions} attended sessions from ${fmt(s.attendanceHistory.from)}; ${s.attendanceHistory.coveredWeeks} of 7 earlier weeks counted from actual session dates.</li>` : `<li>No Attendance history file: earlier weeks use saved snapshots.</li>`}</ul><div class="identity-warning"><strong>${s.review} members need review.</strong> CSVs may omit engagement labels and earlier weekly attendance. Review is separate from Red / Yellow / Watch; it flags missing context without assuming that missing attendance is zero.</div><p>Cancellations checked: ${s.flaggedCancellations} flagged records; ${s.effectiveCancellations} ended by the cutoff, excluding rollovers. These are source checks before the full retention report’s reporting window and administrative adjustments, and are not a published cancellation KPI.</p><p>Roster coverage may differ from the older tracked report. Preview the first 20 members below before importing. Raw CSV files stay in your browser; the reviewed snapshot and summary are saved to Supabase.</p><div class="import-preview"><table><thead><tr><th>Member</th><th>Priority</th><th>Signal</th></tr></thead><tbody>${
          payload.members
            .slice(0, 20)
            .map(
              (m) =>
                `<tr><td>${esc(m.name)}</td><td>${esc(m.priority)}</td><td>${esc(m.signal)}</td></tr>`,
            )
            .join("") ||
          '<tr><td colspan="3">No members meet a risk or review rule. The full attendance snapshot will still be saved.</td></tr>'
        }</tbody></table></div>`;
      confirmReview("");
    } catch (err) {
      fail(err);
    }
  };
  $("#import-file").onchange = async (e) => {
    const ticket = ++reading;
    invalidate();
    try {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) throw Error("Export must be under 10 MB.");
      const data = JSON.parse(await f.text());
      if (ticket !== reading || !d.open) return;
      payload = validateImport(data);
      if (
        !payload.attendance_snapshot &&
        store.data.weeks.some(
          (w) => w.week === payload.week && w.attendance_snapshot?.length,
        )
      )
        throw Error(
          "This week has a complete CSV attendance snapshot. Use the four CSV reports to replace it without losing attendance history.",
        );
      $("#import-csv").value = "";
      reports = null;
      $("#preview-csv").disabled = true;
      $("#csv-files").innerHTML = "";
      $("#csv-targets").innerHTML = "";
      $("#import-summary").innerHTML =
        `<h3>${payload.members.length} risk members · ${fmt(payload.week)}</h3><p>${esc(payload.source_label || "Weekly JSON export")}</p>`;
      confirmReview(
        payload.identity_mode !== "clubworx-contact-id"
          ? '<div class="identity-warning">Provisional name identities require manual review. Prefer Clubworx Contact IDs to preserve history reliably.</div>'
          : "",
      );
    } catch (err) {
      if (ticket === reading && d.open) fail(err);
    }
  };
  $("#confirm-import").onclick = async () => {
    if (!payload || saving || store.demo || !$("#confirm-identity")?.checked)
      return;
    saving = true;
    const current = payload;
    d.querySelectorAll("input,button").forEach((el) => (el.disabled = true));
    $("#confirm-import").textContent = "Importing…";
    $("#import-error").textContent = "";

    $("#import-error").hidden = true;

    $("#import-progress").textContent = "Saving the reviewed weekly update…";

    try {
      await store.import(current);
      saving = false;
      d.close();
      onImported(current.week);
    } catch (err) {
      saving = false;
      $("#import-error").textContent =
        err.message || "Import failed. Nothing was confirmed as saved.";

      $("#import-error").hidden = false;

      $("#import-progress").textContent =
        "Import could not be confirmed. Review the error and retry.";

      $("#import-error").focus();

      d.querySelectorAll("input,button").forEach((el) => (el.disabled = false));
      $("#preview-csv").disabled = !reports;
      $("#confirm-import").textContent = "Import reviewed week";
    }
  };
}
