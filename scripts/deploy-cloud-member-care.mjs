import fs from "node:fs";
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
