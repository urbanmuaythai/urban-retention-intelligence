import {
  prepareDriveImport,
  selectDriveBatch,
  DRIVE_FOLDER,
} from "./drive-import.js";

export const digest = async (value) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const sameHash = (a, b) => {
  if (a.length !== 64 || b.length !== 64) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// All database access stays on the server. No member rows or source CSVs in responses/logs.
export function cloudDriveHandler(api, now = () => Date.now()) {
  return async (request) => {
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    try {
      const config = (
        await api(
          "member_care_integrations?select=token_hash,enabled,folder_id&id=eq.clubworx-drive",
        )
      )[0];
      const token =
        request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
      if (
        !config?.enabled ||
        token.length < 32 ||
        !sameHash(await digest(token), config.token_hash)
      )
        return json({ error: "Unauthorized" }, 401);
      if (Number(request.headers.get("content-length") || 0) > 5 * 1024 * 1024)
        return json({ error: "Batch exceeds 5 MB" }, 413);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 5 * 1024 * 1024)
        return json({ error: "Batch exceeds 5 MB" }, 413);
      let manifest;
      try {
        manifest = JSON.parse(raw);
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      if (
        manifest.folderId !== config.folder_id ||
        manifest.folderId !== DRIVE_FOLDER ||
        !Array.isArray(manifest.files) ||
        (manifest.files.length !== 4 && manifest.files.length !== 5)
      )
        return json(
          {
            error:
              "Expected the four configured Drive exports, plus optional attendance history",
          },
          400,
        );
      const context = await api("rpc/clubworx_drive_context", {});
      const latest = [...context.weeks]
        .sort((a, b) => a.week.localeCompare(b.week))
        .at(-1);
      const batch = selectDriveBatch(
        manifest.files,
        latest?.import_summary?.driveSync,
        now(),
      );
      if (batch.status !== "ready") return json(batch);
      const hashes = new Map();
      for (const file of batch.files) {
        if (typeof file.text !== "string")
          return json({ error: "Missing CSV contents" }, 400);
        hashes.set(file.text, await digest(file.text));
      }
      const fingerprintInput = JSON.stringify({
        asOf: batch.asOf,
        files: batch.files.map((f) => [f.reportId, hashes.get(f.text)]),
      });
      hashes.set(fingerprintInput, await digest(fingerprintInput));
      const result = prepareDriveImport(manifest, context, now(), (value) => {
        if (!hashes.has(value)) throw Error("Digest not prepared");
        return hashes.get(value);
      });
      if (result.status !== "ready") return json(result);
      result.payload.import_summary.driveSync.mode = "google-apps-script";
      if (manifest.dryRun === true)
        return json({
          status: "validated",
          asOf: result.asOf,
          members: result.members,
          fingerprint: result.fingerprint,
        });
      await api("rpc/import_clubworx_drive_batch", {
        p_payload: result.payload,
        p_versions: context.weeks.map((w) => [w.week, w.imported_at]),
      });
      return json({
        status: "imported",
        asOf: result.asOf,
        members: result.members,
        fingerprint: result.fingerprint,
      });
    } catch (error) {
      // Do not echo parser errors: they may contain private source cells.
      const message = String(error?.message || "");
      const known = [
        "New membership plan: review weekly targets through the app first.",
        "Reconcile provisional member identities before automated import.",
        "An approved administrator is required.",
        "Reports changed; reload context and retry later",
      ];
      const safe = known.find((s) => message.includes(s));
      return json(
        {
          error:
            safe ||
            "Import was not confirmed. Check Member Care and retry this batch; duplicate imports are skipped. Review the four exports if validation still fails.",
        },
        safe?.startsWith("Reports changed") ? 409 : 422,
      );
    }
  };
}
