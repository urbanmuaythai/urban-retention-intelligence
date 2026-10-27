import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  readReports,
  membershipTargets,
  convertReports,
} from "../coach-app/src/csv-import.js";
import { addDays } from "../coach-app/src/domain.js";

export const DRIVE_FOLDER = "1e4X24ykUscsd67u4Uzp_qXx7dD8e3Li_";
export const CONTEXT_SQL = `select jsonb_build_object(
'weeks',(select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('imported_at',w.imported_at::text) order by week),'[]'::jsonb) from public.weekly_reports w),
'baselines',(select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from public.attendance_baselines b),
'members',(select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]'::jsonb) from public.members),
'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'hash',md5(row(e.*)::text))),'[]'::jsonb) from public.outreach_events e),
'admin',(select jsonb_build_object('id',s.id,'active',s.active,'role',s.role) from public.staff s join auth.users u on u.id=s.id where lower(u.email)='getfit@urbanmuaythai.com' and s.active and s.role='admin' limit 1)) as context;`;
export const REPORT_IDS = ["246526", "246527", "246528", "246529"];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const dateInBrisbane = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
const sqlJson = (value) =>
  "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";

// Folder upload timestamps can reflect a delayed email copy. Use the source export timestamp.
export function selectDriveBatch(entries, previous = null, now = Date.now()) {
  const newest = new Map();
  for (const item of entries) {
    const name = item.name || item.title || item.file_name || "";
    const match = /^report_export_(\d+)_(\d{10})\.csv$/.exec(name);
    if (!match || !REPORT_IDS.includes(match[1])) continue;
    const exported = Number(match[2]) * 1000;
    if (exported > now || !item.id) continue;
    const file = { ...item, name, reportId: match[1], exported };
    if (!newest.has(match[1]) || newest.get(match[1]).exported < exported)
      newest.set(match[1], file);
  }
  if (newest.size !== 4)
    return {
      status: "waiting",
      reason: "Waiting for all four configured reports.",
    };
  const files = REPORT_IDS.map((id) => newest.get(id));
  const times = files.map((f) => f.exported);
  if (
    new Set(times.map(dateInBrisbane)).size !== 1 ||
    Math.max(...times) - Math.min(...times) > 30 * 60 * 1000
  )
    return {
      status: "waiting",
      reason:
        "The newest four reports are not one same-day batch within 30 minutes.",
    };
  if (
    previous &&
    files.every(
      (f) =>
        f.exported ===
        previous.files?.find((p) => p.reportId === f.reportId)?.exported,
    )
  )
    return {
      status: "unchanged",
      reason: "This source batch has already been processed.",
    };
  if (
    previous &&
    files.some(
      (f) => f.exported <= Math.max(...previous.files.map((p) => p.exported)),
    )
  )
    return {
      status: "waiting",
      reason:
        "All four reports must be freshly exported before replacing the saved batch.",
    };
  return { status: "ready", asOf: dateInBrisbane(times[0]), files };
}

export function prepareDriveImport(manifest, context, now = Date.now()) {
  if (manifest.folderId !== DRIVE_FOLDER)
    throw Error("Unexpected source folder.");
  const weeks = [...context.weeks].sort((a, b) => a.week.localeCompare(b.week));
  const latest = weeks.at(-1);
  const batch = selectDriveBatch(
    manifest.files,
    latest?.import_summary?.driveSync,
    now,
  );
  if (batch.status !== "ready") return batch;
  if (latest && batch.asOf < (latest.import_summary?.asOf || latest.week))
    return {
      status: "unchanged",
      reason: "This batch is older than the current report cutoff.",
    };
  if (latest && !latest.import_summary?.driveSync && batch.asOf === (latest.import_summary?.asOf || latest.week) && Math.min(...batch.files.map(f => f.exported)) <= Date.parse(latest.imported_at))
    return {status: "waiting", reason: "A later manual import exists. Export all four reports again before automatic replacement."};
  if (context.members.some((m) => m.id.startsWith("name-v1:")))
    throw Error(
      "Reconcile provisional member identities before automated import.",
    );
  const inputs = batch.files.map((f) => {
    if (
      typeof f.text !== "string" ||
      Buffer.byteLength(f.text) > 10 * 1024 * 1024
    )
      throw Error("A source CSV is missing or exceeds 10 MB.");
    return { name: f.name, text: f.text };
  });
  const reports = readReports(inputs);
  const targets = Object.fromEntries(
    membershipTargets(reports).map((p) => [p.name, p.target]),
  );
  const saved = latest?.import_summary?.targets || {};
  // A new plan needs a staff target review before automatic writes.
  if (Object.keys(targets).some((name) => !Object.hasOwn(saved, name)))
    throw Error(
      "New membership plan: review weekly targets through the app first.",
    );
  Object.assign(targets, saved);
  const day = new Date(batch.asOf + "T12:00:00Z").getUTCDay();
  const week = addDays(batch.asOf, -((day + 6) % 7));
  const { payload } = convertReports(
    reports,
    week,
    targets,
    weeks,
    batch.asOf,
    context.baselines,
  );
  const files = batch.files.map((f) => ({
    id: f.id,
    name: f.name,
    reportId: f.reportId,
    exported: f.exported,
    sha256: sha(f.text),
  }));
  const fingerprint = sha(
    JSON.stringify({
      asOf: batch.asOf,
      files: files.map((f) => [f.reportId, f.sha256]),
    }),
  );
  const existing = weeks.find((w) => w.week === week);
  if (existing?.import_summary?.driveSync?.fingerprint === fingerprint)
    return {
      status: "unchanged",
      reason: "Identical source contents and cutoff are already saved.",
    };
  payload.source_label =
    "Clubworx Exports Drive folder · automatic four-CSV import";
  payload.import_summary.driveSync = {
    folderId: DRIVE_FOLDER,
    files,
    fingerprint,
    mode: "codex-desktop",
  };
  if (
    !context.admin?.active ||
    context.admin.role !== "admin" ||
    !/^[0-9a-f-]{36}$/i.test(context.admin.id)
  )
    throw Error("An approved administrator is required.");
  // Optimistic concurrency covers report history, targets and the current cohort.
  const version = context.weeks
    .map((w) => [w.week, w.imported_at])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const checks = context.events || [];
  const sql = `begin;
select pg_advisory_xact_lock(hashtext('urban-member-care-drive-sync'));
lock table public.weekly_reports in share row exclusive mode;
do $guard$ begin
 if (select coalesce(jsonb_agg(jsonb_build_array(week::text,imported_at::text) order by week),'[]'::jsonb) from public.weekly_reports) <> ${sqlJson(version)} then raise exception 'Reports changed; reload context and retry later'; end if;
end $guard$;
select set_config('request.jwt.claim.sub','${context.admin.id}',true);
set local role authenticated;
select public.import_retention_week(${sqlJson(payload)}) as imported_members;
reset role;
do $notes$ begin
 if exists(select 1 from jsonb_array_elements(${sqlJson(checks)}) j left join public.outreach_events e on e.id=(j->>'id')::uuid where e.id is null or md5(row(e.*)::text)<>j->>'hash') then raise exception 'Outreach history changed; rolling back'; end if;
end $notes$;
select week, jsonb_array_length(import_summary->'driveSync'->'files') as verified_source_files, import_summary->'driveSync'->>'fingerprint' as fingerprint from public.weekly_reports where week='${week}';
commit;`;
  return {
    status: "ready",
    asOf: batch.asOf,
    members: payload.members.length,
    fingerprint,
    payload,
    sql,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [manifestPath, contextPath, outputPrefix] = process.argv.slice(2);
  if (
    !manifestPath ||
    !contextPath ||
    !outputPrefix ||
    !outputPrefix.endsWith(".private")
  )
    throw Error(
      "Usage: node scripts/drive-member-care.mjs manifest.private.json context.private.json output.private",
    );
  const result = prepareDriveImport(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    JSON.parse(fs.readFileSync(contextPath, "utf8")),
  );
  if (result.status === "ready") {
    fs.writeFileSync(
      outputPrefix + ".json",
      JSON.stringify(result.payload, null, 2),
    );
    fs.writeFileSync(outputPrefix + ".sql", result.sql);
  }
  console.log(
    JSON.stringify({
      status: result.status,
      reason: result.reason,
      asOf: result.asOf,
      members: result.members,
      fingerprint: result.fingerprint,
    }),
  );
}
