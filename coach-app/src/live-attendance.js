// Live "trained since the report" check (Clubworx Member API v2).
// Pure helpers shared by the Supabase Edge Function `clubworx-live-attendance` and the tests.
// The API names people by a text contact_key, while Member Care uses `clubworx:<Contact ID>`, so each
// member is matched once by exact name among current memberships, confirmed by phone when both have one.
// A name shared by two people on either side is never matched.

export const normName = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Last 9 digits, so 0412 345 678 and +61 412 345 678 match. */
export const normPhone = (s) => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-9) : "";
};

export const apiName = (m) =>
  [m.contact_first_name ?? m.first_name, m.contact_last_name ?? m.last_name]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" ");

/**
 * Name candidates: members (id, full_name) without a saved key, against current API memberships.
 * Returns [{ memberId, contactKey }] where the name is unique on both sides.
 */
export function nameCandidates(members, memberships, takenKeys = new Set()) {
  const keysByName = new Map();
  for (const m of memberships) {
    const n = normName(apiName(m));
    if (!n || !m.contact_key) continue;
    if (!keysByName.has(n)) keysByName.set(n, new Set());
    keysByName.get(n).add(m.contact_key);
  }
  const membersByName = new Map();
  for (const m of members) {
    const n = normName(m.full_name);
    if (!n) continue;
    membersByName.set(n, (membersByName.get(n) ?? 0) + 1);
  }
  const out = [];
  for (const m of members) {
    const n = normName(m.full_name);
    const keys = keysByName.get(n);
    if (!keys || keys.size !== 1 || membersByName.get(n) !== 1) continue;
    const [contactKey] = keys;
    if (takenKeys.has(contactKey)) continue;
    out.push({ memberId: m.id, contactKey });
  }
  return out;
}

/** Confirms a name match with the phone: "phone" when both match, "name" when either is blank, null when they differ. */
export function confirmMatch(memberPhone, apiPhone) {
  const a = normPhone(memberPhone),
    b = normPhone(apiPhone);
  if (a && b) return a === b ? "phone" : null;
  return "name";
}

/** "2026-11-04T06:00:00.000+10:00" → gym-local date "2026-11-04" */
export const bookingDate = (b) => String(b.event_start_at ?? "").slice(0, 10);

/**
 * Attended bookings (newest first, as the API returns them) on or after `since`,
 * grouped by contact key: { last, event, count }.
 */
export function trainedSince(bookings, since) {
  const out = new Map();
  for (const b of bookings) {
    if (b.state !== "attended" || !b.contact_key || bookingDate(b) < since) continue;
    const cur = out.get(b.contact_key);
    if (!cur) out.set(b.contact_key, { last: b.event_start_at, event: b.event_name ?? null, count: 1 });
    else {
      cur.count++;
      if (b.event_start_at > cur.last) Object.assign(cur, { last: b.event_start_at, event: b.event_name ?? null });
    }
  }
  return out;
}

/** True once a page of newest-first bookings has gone past `since`. */
export const pastSince = (page, since) =>
  !page.length || bookingDate(page[page.length - 1]) < since;

/** "Tue 4 Nov, 6:00am" from an API timestamp (already gym-local) */
export function trainedLabel(iso) {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1];
  const h = +m[4];
  return `${day} ${+m[3]} ${mon}, ${h % 12 || 12}:${m[5]}${h < 12 ? "am" : "pm"}`;
}

/* ------------------------------------------------------------------ server */

const MAX_MEMBERS = 3000;
const MAX_BOOKING_PAGES = 60; // 50 per page: weeks of attended classes
const MAX_NEW_MATCHES = 50; // phone lookups per call (Clubworx rate-limits); the rest are linked on later checks
const LOOKUPS_AT_ONCE = 3;

/**
 * Request handler for the Edge Function. Dependencies are passed in so tests can run without network:
 *  staffFor(request) → staff id or null (signed-in, active staff only)
 *  db.keys(memberIds) → [{ member_id, contact_key }]
 *  db.members(memberIds) → [{ id, full_name, phone }]
 *  db.saveKeys(rows) → void (rows: { member_id, contact_key, matched_by })
 *  cw.memberships() → current API memberships; cw.member(key) → API member; cw.attendedPage(n) → newest-first attended bookings
 */
export function liveAttendanceHandler({ staffFor, db, cw, origins = [] }) {
  const cors = (req) => {
    const o = req.headers.get("origin");
    return {
      "Access-Control-Allow-Origin": o && origins.includes(o) ? o : origins[0] ?? "*",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    };
  };
  const json = (req, status, body) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });

  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== "POST") return json(req, 405, { error: "Use POST." });
    if (!(await staffFor(req).catch(() => null))) return json(req, 401, { error: "Staff sign-in required." });

    let since, memberIds;
    try {
      ({ since, memberIds } = await req.json());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Array.isArray(memberIds) || memberIds.length > MAX_MEMBERS || memberIds.some((x) => typeof x !== "string")) throw 0;
    } catch {
      return json(req, 400, { error: "Expected { since: YYYY-MM-DD, memberIds: [...] }." });
    }
    memberIds = [...new Set(memberIds)];

    try {
      const known = await db.keys(memberIds);
      const keyOf = new Map(known.map((r) => [r.member_id, r.contact_key]));
      let unmatched = memberIds.filter((id) => !keyOf.has(id));
      let matchedNow = 0;
      if (unmatched.length) {
        const [members, memberships] = await Promise.all([db.members(unmatched), cw.memberships()]);
        const candidates = nameCandidates(members, memberships, new Set(keyOf.values())).slice(0, MAX_NEW_MATCHES);
        const phone = new Map(members.map((m) => [m.id, m.phone]));
        const rows = [];
        for (let i = 0; i < candidates.length; i += LOOKUPS_AT_ONCE) {
          const batch = await Promise.all(candidates.slice(i, i + LOOKUPS_AT_ONCE).map(async (c) => {
            const api = await cw.member(c.contactKey).catch(() => null);
            const how = api ? confirmMatch(phone.get(c.memberId), api.phone) : null;
            return how ? { member_id: c.memberId, contact_key: c.contactKey, matched_by: how } : null;
          }));
          rows.push(...batch.filter(Boolean));
        }
        if (rows.length) await db.saveKeys(rows);
        for (const r of rows) keyOf.set(r.member_id, r.contact_key);
        matchedNow = rows.length;
        unmatched = memberIds.filter((id) => !keyOf.has(id));
      }

      const bookings = [];
      for (let page = 1; page <= MAX_BOOKING_PAGES; page++) {
        const rows = await cw.attendedPage(page);
        bookings.push(...rows);
        if (rows.length < 50 || pastSince(rows, since)) break;
      }
      const byKey = trainedSince(bookings, since);
      const results = {};
      for (const id of memberIds) {
        const hit = byKey.get(keyOf.get(id));
        if (hit) results[id] = hit;
      }
      // Counts and member IDs only: names and phones never leave the server.
      return json(req, 200, { checkedAt: new Date().toISOString(), since, results, matched: memberIds.length - unmatched.length, matchedNow, unmatched: unmatched.length });
    } catch (e) {
      return json(req, 502, { error: e?.message?.includes("Clubworx") ? e.message : "Live check unavailable right now." });
    }
  };
}
