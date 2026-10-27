import test from "node:test";
import assert from "node:assert/strict";
import {
  selectDriveBatch,
  prepareDriveImport,
  DRIVE_FOLDER,
  REPORT_IDS,
} from "../../scripts/drive-member-care.mjs";
import { fixture, filesFor } from "./csv-fixtures.mjs";
const start = Date.parse("2026-10-26T00:00:00Z");
const now = start + 3600_000;
const files = () =>
  REPORT_IDS.map((id, i) => ({
    id: "fictional-" + id,
    name: `report_export_${id}_${start / 1000 + i}.csv`,
  }));
test("Drive sync waits for complete fresh same-cutoff batches and ignores unrelated reports", () => {
  assert.equal(
    selectDriveBatch(files().slice(0, 3), null, now).status,
    "waiting",
  );
  const batch = selectDriveBatch(
    [...files(), { id: "other", name: "report_export_999_1792972800.csv" }],
    null,
    now,
  );
  assert.equal(batch.status, "ready");
  assert.equal(batch.asOf, "2026-10-26");
  assert.equal(selectDriveBatch(files(), batch, now).status, "unchanged");
  const mixed = files();
  mixed[0].name = `report_export_246526_${start / 1000 + 2000}.csv`;
  assert.equal(selectDriveBatch(mixed, null, now).status, "waiting");
  assert.equal(
    selectDriveBatch(mixed, batch, now + 3600_000).status,
    "waiting",
  );
});
test("the source timestamp uses Brisbane day boundaries rather than Drive copy time", () => {
  const edge = Date.parse("2026-10-26T14:00:00Z");
  const items = REPORT_IDS.map((id) => ({
    id,
    name: `report_export_${id}_${edge / 1000}.csv`,
  }));
  assert.equal(selectDriveBatch(items, null, edge + 1000).asOf, "2026-10-27");
  assert.equal(selectDriveBatch(items, null, edge - 1000).status, "waiting");
});
test("automatic conversion reuses validation and makes guarded idempotent SQL without exposing note bodies", () => {
  const input = filesFor(fixture());
  const ordered = [input[0], input[1], input[3], input[2]];
  // Match schema by headers, independent of the known report ID filename order.
  const manifest = {
    folderId: DRIVE_FOLDER,
    files: files().map((f, i) => ({ ...f, text: ordered[i].text })),
  };
  const context = {
    weeks: [
      {
        week: "2026-10-19",
        imported_at: "2026-10-19 00:00:00+00",
        attendance_snapshot: [],
        import_summary: { targets: { Unlimited: 4 } },
      },
    ],
    baselines: [],
    members: [],
    events: [],
    admin: {
      id: "00000000-0000-4000-8000-000000000001",
      active: true,
      role: "admin",
    },
  };
  const result = prepareDriveImport(manifest, context, now);
  assert.equal(result.status, "ready");
  assert.equal(result.payload.members[0].priority, "Review");
  assert.match(result.sql, /pg_advisory_xact_lock/);
  assert.match(result.sql, /Reports changed/);
  assert.match(result.sql, /import_retention_week/);
  assert.equal(result.payload.import_summary.driveSync.files.length, 4);
  context.weeks.push({
    week: result.payload.week,
    imported_at: "2026-10-26 00:00:00+00",
    import_summary: result.payload.import_summary,
  });
  assert.equal(prepareDriveImport(manifest, context, now).status, "unchanged");
  context.weeks.pop();
  context.weeks[0].import_summary.targets = {};
  assert.throws(
    () => prepareDriveImport(manifest, context, now),
    /New membership plan/,
  );
});

test("automatic pickup cannot replace a later same-day manual import with older exports", () => {
  const manifest = {folderId:DRIVE_FOLDER,files:files().map(f=>({...f,text:"not read when an older batch is held"}))};
  const context = {weeks:[{week:"2026-10-26",imported_at:new Date(now).toISOString(),import_summary:{asOf:"2026-10-26"}}],members:[],baselines:[]};
  assert.equal(prepareDriveImport(manifest,context,now).status,"waiting");
});
