import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmMatch,
  liveAttendanceHandler,
  nameCandidates,
  normPhone,
  trainedLabel,
  trainedSince,
} from "../src/live-attendance.js";

const ms = (key, first, last) => ({ contact_key: key, contact_first_name: first, contact_last_name: last });
const att = (key, at, event = "All Levels", state = "attended") => ({ contact_key: key, event_start_at: at, event_name: event, state });

test("names match only when unique on both sides", () => {
  const members = [
    { id: "clubworx:1", full_name: "Louis Spatt" },
    { id: "clubworx:2", full_name: "Sam Lee" },
    { id: "clubworx:3", full_name: "Sam Lee" }, // two Member Care members share the name
    { id: "clubworx:4", full_name: "Ava Jones" },
    { id: "clubworx:5", full_name: "José  Núñez" },
  ];
  const memberships = [
    ms("k1", "Louis", "Spatt."), ms("k1", "Louis", "Spatt."), // two memberships, one person
    ms("k2", "Sam", "Lee"),
    ms("k4", "Ava", "Jones"), ms("k9", "Ava", "Jones"), // two Clubworx people share the name
    ms("k5", "Jose", "Nunez"),
  ];
  assert.deepEqual(nameCandidates(members, memberships), [
    { memberId: "clubworx:1", contactKey: "k1" },
    { memberId: "clubworx:5", contactKey: "k5" },
  ]);
  assert.deepEqual(nameCandidates(members, memberships, new Set(["k1"])), [{ memberId: "clubworx:5", contactKey: "k5" }]);
});

test("phone confirms or rules out a name match", () => {
  assert.equal(normPhone("0412 345 678"), normPhone("+61 412 345 678"));
  assert.equal(confirmMatch("0412 345 678", "+61412345678"), "phone");
  assert.equal(confirmMatch("0412 345 678", "0499 999 999"), null);
  assert.equal(confirmMatch("", "0412345678"), "name");
  assert.equal(confirmMatch(null, null), "name");
});

test("counts attended classes on or after the report date", () => {
  const since = "2026-11-03";
  const out = trainedSince([
    att("k1", "2026-11-04T18:00:00.000+10:00", "Kickstarter"),
    att("k1", "2026-11-03T06:00:00.000+10:00"),
    att("k1", "2026-11-02T06:00:00.000+10:00"), // before the report
    att("k2", "2026-11-04T06:00:00.000+10:00", "All Levels", "absent"),
    att("k3", "2026-11-03T17:15:00.000+10:00"),
  ], since);
  assert.deepEqual(Object.fromEntries(out), {
    k1: { last: "2026-11-04T18:00:00.000+10:00", event: "Kickstarter", count: 2 },
    k3: { last: "2026-11-03T17:15:00.000+10:00", event: "All Levels", count: 1 },
  });
  assert.equal(trainedLabel("2026-11-04T18:00:00.000+10:00"), "Wed 4 Nov, 6:00pm");
  assert.equal(trainedLabel("2026-11-03T06:00:00.000+10:00"), "Tue 3 Nov, 6:00am");
});

function fakeDeps(overrides = {}) {
  const saved = [];
  const pages = [];
  const deps = {
    origins: ["https://urbanmuaythai.github.io"],
    staffFor: async (req) => (req.headers.get("authorization") === "Bearer staff" ? "staff-1" : null),
    db: {
      keys: async () => [{ member_id: "clubworx:1", contact_key: "k1" }],
      members: async () => [
        { id: "clubworx:2", full_name: "Sam Lee", phone: "0412345678" },
        { id: "clubworx:3", full_name: "Ava Jones", phone: "0400000000" },
      ],
      saveKeys: async (rows) => saved.push(...rows),
    },
    cw: {
      memberships: async () => [ms("k2", "Sam", "Lee"), ms("k3", "Ava", "Jones")],
      member: async (k) => ({ contact_key: k, phone: k === "k2" ? "+61 412 345 678" : "0499999999" }),
      attendedPage: async (p) => {
        pages.push(p);
        return p === 1
          ? [att("k1", "2026-11-04T06:00:00.000+10:00"), att("k2", "2026-11-03T18:00:00.000+10:00"), att("k3", "2026-11-03T18:00:00.000+10:00"), att("k9", "2026-11-01T06:00:00.000+10:00")]
          : [];
      },
    },
    ...overrides,
  };
  return { deps, saved, pages };
}
const post = (body, auth = "Bearer staff") =>
  new Request("https://x.supabase.co/functions/v1/clubworx-live-attendance", {
    method: "POST",
    headers: { authorization: auth, origin: "https://urbanmuaythai.github.io", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("handler: staff only, links new members once, returns member IDs only", async () => {
  const { deps, saved, pages } = fakeDeps();
  const handle = liveAttendanceHandler(deps);
  assert.equal((await handle(post({ since: "2026-11-03", memberIds: ["clubworx:1"] }, "Bearer nope"))).status, 401);
  assert.equal((await handle(post({ since: "3 Nov", memberIds: [] }))).status, 400);

  const res = await handle(post({ since: "2026-11-03", memberIds: ["clubworx:1", "clubworx:2", "clubworx:3"] }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://urbanmuaythai.github.io");
  const body = await res.json();
  // Sam matched by phone; Ava's phone differs so she stays unlinked.
  assert.deepEqual(saved, [{ member_id: "clubworx:2", contact_key: "k2", matched_by: "phone" }]);
  assert.deepEqual(Object.keys(body.results).sort(), ["clubworx:1", "clubworx:2"]);
  assert.equal(body.matched, 2);
  assert.equal(body.unmatched, 1);
  assert.equal(body.matchedNow, 1);
  assert.deepEqual(pages, [1]);
  assert.ok(!JSON.stringify(body).includes("Sam"), "no names in the response");
});

test("handler: a Clubworx failure is reported without details", async () => {
  const { deps } = fakeDeps({ cw: { memberships: async () => [], member: async () => null, attendedPage: async () => { throw Error("boom https://app.clubworx.com/?account_key=secret"); } } });
  const res = await liveAttendanceHandler(deps)(post({ since: "2026-11-03", memberIds: ["clubworx:1"] }));
  assert.equal(res.status, 502);
  assert.ok(!(await res.text()).includes("secret"));
});
