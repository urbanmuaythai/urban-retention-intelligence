import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { prepareDriveImport as prepare } from "../coach-app/src/drive-import.js";
export {
  DRIVE_FOLDER,
  REPORT_IDS,
  CONTEXT_SQL,
  selectDriveBatch,
} from "../coach-app/src/drive-import.js";
const sha = (value) => createHash("sha256").update(value).digest("hex");
export const prepareDriveImport = (manifest, context, now = Date.now()) =>
  prepare(manifest, context, now, sha);

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
