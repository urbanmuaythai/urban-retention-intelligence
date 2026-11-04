import test from "node:test";
import assert from "node:assert/strict";
import { cloudDriveHandler, digest } from "../src/cloud-drive.js";
import { DRIVE_FOLDER, REPORT_IDS } from "../src/drive-import.js";
import { fixture, filesFor } from "./csv-fixtures.mjs";
const token = "fictional-test-token-with-at-least-32-characters";
const start = Date.parse("2026-10-26T00:00:00Z"),
  now = () => start + 3600000;
function manifest() {
  const f = filesFor(fixture());
  return {
    folderId: DRIVE_FOLDER,
    files: REPORT_IDS.map((id, i) => ({
      id: "f" + id,
      name: `report_export_${id}_${start / 1000 + i}.csv`,
      text: [f[0], f[1], f[3], f[2]][i].text,
    })),
  };
}
const context = () => ({
  weeks: [
    {
      week: "2026-10-19",
      imported_at: "2026-10-19T00:00:00Z",
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
});
const request = (body, auth = token) =>
  new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: "Bearer " + auth },
    body: JSON.stringify(body),
  });
test("cloud webhook denies unauthenticated callers before reading member context", async () => {
  let calls = 0;
  const handler = cloudDriveHandler(async (path) => {
    calls++;
    assert.match(path, /member_care_integrations/);
    return [
      {
        enabled: true,
        folder_id: DRIVE_FOLDER,
        token_hash: await digest(token),
      },
    ];
  }, now);
  assert.equal((await handler(request(manifest(), "wrong"))).status, 401);
  assert.equal(calls, 1);
});
test("cloud imports reuse CSV validation, enforce provenance, support dry-run and pass history versions atomically", async () => {
  const saved = context();
  let writes = 0;
  let payload;
  const handler = cloudDriveHandler(async (path, body) => {
    if (path.startsWith("member_care_integrations"))
      return [
        {
          enabled: true,
          folder_id: DRIVE_FOLDER,
          token_hash: await digest(token),
        },
      ];
    if (path === "rpc/clubworx_drive_context") return saved;
    assert.equal(path, "rpc/import_clubworx_drive_batch");
    writes++;
    payload = body.p_payload;
    assert.deepEqual(body.p_versions, [["2026-10-19", "2026-10-19T00:00:00Z"]]);
    return 1;
  }, now);
  assert.equal(
    (await handler(request({ ...manifest(), folderId: "other" }))).status,
    400,
  );
  let response = await handler(request({ ...manifest(), dryRun: true }));
  assert.equal((await response.json()).status, "validated");
  assert.equal(writes, 0);
  response = await handler(request(manifest()));
  assert.equal((await response.json()).status, "imported");
  assert.equal(writes, 1);
  assert.equal(payload.import_summary.driveSync.mode, "google-apps-script");
  assert.equal(payload.import_summary.driveSync.files.length, 4);
  saved.weeks.push({
    week: payload.week,
    imported_at: "2026-10-26T01:00:00Z",
    import_summary: payload.import_summary,
  });
  response = await handler(request(manifest()));
  assert.equal((await response.json()).status, "unchanged");
  assert.equal(writes, 1);
});
test("invalid source data and concurrent report changes never leak private cells or claim success", async () => {
  let concurrent = false,
    writes = 0;
  const saved = context();
  const handler = cloudDriveHandler(async (path) => {
    if (path.startsWith("member_care_integrations"))
      return [
        {
          enabled: true,
          folder_id: DRIVE_FOLDER,
          token_hash: await digest(token),
        },
      ];
    if (path === "rpc/clubworx_drive_context") return saved;
    writes++;
    if (concurrent)
      throw Error("Reports changed; reload context and retry later");
    return 1;
  }, now);
  const broken = manifest();
  broken.files[0].text = "private-person-cell";
  let response = await handler(request(broken));
  assert.equal(response.status, 422);
  assert.doesNotMatch(await response.text(), /private-person-cell/);
  assert.equal(writes, 0);
  concurrent = true;
  response = await handler(request(manifest()));
  assert.equal(response.status, 409);
});
