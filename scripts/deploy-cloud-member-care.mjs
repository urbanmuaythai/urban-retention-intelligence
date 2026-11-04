import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = new URL("../", import.meta.url);
export function edgeBundle() {
  const entry = "supabase/functions/clubworx-drive-import/index.ts";
  const modules = [
    "cloud-drive",
    "drive-import",
    "csv-import",
    "domain",
    "history",
    "operations",
  ];
  return [
    {
      name: "index.ts",
      content: fs.readFileSync(new URL(entry, root), "utf8"),
    },
    ...modules.map((name) => ({
      name: `shared/${name}.js`,
      content: fs.readFileSync(
        new URL(`coach-app/src/${name}.js`, root),
        "utf8",
      ),
    })),
  ];
}

/** clubworx-live-attendance: the entrypoint plus its one shared module. */
export function liveAttendanceBundle() {
  return [
    {
      name: "index.ts",
      content: fs.readFileSync(new URL("supabase/functions/clubworx-live-attendance/index.ts", root), "utf8"),
    },
    {
      name: "shared/live-attendance.js",
      content: fs.readFileSync(new URL("coach-app/src/live-attendance.js", root), "utf8"),
    },
  ];
}

/**
 * `node scripts/deploy-cloud-member-care.mjs stage <dir> live-attendance|drive-import`
 * writes a function's bundle into <dir>/supabase/functions/<name>/ for `supabase functions deploy`.
 */
if (process.argv[2] === "stage") {
  const [, , , dir, which = "live-attendance"] = process.argv;
  const [name, files] = which === "drive-import"
    ? ["clubworx-drive-import", edgeBundle()]
    : ["clubworx-live-attendance", liveAttendanceBundle()];
  const base = pathToFileURL(path.resolve(dir, "supabase/functions", name) + path.sep);
  for (const f of files) {
    const target = new URL(f.name, base);
    fs.mkdirSync(new URL("./", target), { recursive: true });
    fs.writeFileSync(target, f.content);
  }
  console.log(`Staged ${name} (${files.length} files)`);
}
