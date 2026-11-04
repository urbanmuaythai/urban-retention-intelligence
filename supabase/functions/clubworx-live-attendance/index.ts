// Live "trained since the report" check for Urban Member Care. Called by signed-in staff from the app.
// Secrets: CLUBWORX_API_KEY (Clubworx Member API v2, sent as account_key). Uses the server key for the
// server-only clubworx_contact_keys table; nothing here writes to Clubworx or to risk rows / notes.
import { liveAttendanceHandler } from "./shared/live-attendance.js";

const url = Deno.env.get("SUPABASE_URL");
const key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const publishable = Deno.env.get("SUPABASE_ANON_KEY") || key;
const cwKey = Deno.env.get("CLUBWORX_API_KEY")?.trim();
if (!url || !key) throw Error("Server configuration unavailable");

const serverHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) h.Authorization = "Bearer " + key;
  return h;
};
const rest = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...serverHeaders(), ...(init.headers as Record<string, string> ?? {}) } });
  if (!r.ok) throw Error("Database request failed");
  return r.status === 204 || r.headers.get("content-length") === "0" ? null : r.json();
};
const inList = (ids: string[]) => `(${ids.map((id) => `"${id.replace(/["\\]/g, "")}"`).join(",")})`;
const chunks = <T,>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

const cw = async (path: string) => {
  if (!cwKey) throw Error("Clubworx API key is not set on the server.");
  // Clubworx rate-limits (429): wait and try again, up to three times.
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://app.clubworx.com/api/v2/${path}${path.includes("?") ? "&" : "?"}account_key=${encodeURIComponent(cwKey)}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000),
    });
    if (r.status === 429 && attempt < 3) {
      const wait = Math.min(8, Number(r.headers.get("retry-after")) || 2 ** attempt);
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      continue;
    }
    // Never include the URL: it carries the key.
    if (!r.ok) throw Error(`Clubworx API ${path.split("?")[0]} returned ${r.status}.`);
    return r.json();
  }
};

Deno.serve(liveAttendanceHandler({
  origins: ["https://urbanmuaythai.github.io", "http://127.0.0.1:5173", "http://127.0.0.1:5174"],
  async staffFor(req: Request) {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) return null;
    const u = await fetch(`${url}/auth/v1/user`, { headers: { apikey: publishable, Authorization: auth } });
    if (!u.ok) return null;
    const { id } = await u.json();
    if (!id) return null;
    const staff = await rest(`staff?select=id&active=is.true&id=eq.${encodeURIComponent(id)}`);
    return staff?.length ? id : null;
  },
  db: {
    async keys(ids: string[]) {
      const out = [];
      for (const c of chunks(ids)) out.push(...await rest(`clubworx_contact_keys?select=member_id,contact_key&member_id=in.${encodeURIComponent(inList(c))}`));
      return out;
    },
    async members(ids: string[]) {
      const out = [];
      for (const c of chunks(ids)) out.push(...await rest(`members?select=id,full_name,phone&id=in.${encodeURIComponent(inList(c))}`));
      return out;
    },
    async saveKeys(rows: unknown[]) {
      await rest("clubworx_contact_keys?on_conflict=member_id", {
        method: "POST", body: JSON.stringify(rows), headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      });
    },
  },
  cw: {
    async memberships() {
      const out = [];
      for (let p = 1; p <= 40; p++) {
        const rows = await cw(`memberships?page=${p}`);
        out.push(...rows);
        if (rows.length < 50) return out;
      }
      throw Error("Clubworx API memberships has too many pages.");
    },
    member: (k: string) => cw(`members/${encodeURIComponent(k)}`),
    attendedPage: (p: number) => cw(`bookings?state=attended&page=${p}`),
  },
}));
