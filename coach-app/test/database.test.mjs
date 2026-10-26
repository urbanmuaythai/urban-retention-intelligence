import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("database access, atomic imports, notes, concurrency and history", async (t) => {
  const db = new PGlite();
  const admin = "00000000-0000-4000-8000-000000000001",
    coach = "00000000-0000-4000-8000-000000000002",
    outsider = "00000000-0000-4000-8000-000000000003";
  await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;
 insert into auth.users values('${admin}'),('${coach}'),('${outsider}');`);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/202610260001_coach_desk.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    `insert into staff values('${admin}','Admin','admin',true),('${coach}','Coach','coach',true);`,
  );
  const login = async (id) => {
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated;");
  };
  const member = {
    member_id: "stable-123",
    name: "Fictional Member",
    membership: "Accelerate",
    priority: "Red",
    signal: "Two zero weeks",
    s7: 0,
    s30: 2,
    sequence: [2, 0, 0],
  };
  const payload = { version: 1, week: "2026-10-26", members: [member] };
  const importWeek = async (p) =>
    db.query("select import_retention_week($1::jsonb)", [JSON.stringify(p)]);
  await t.test(
    "unapproved signed-in users see no private records and cannot import",
    async () => {
      await login(outsider);
      assert.equal((await db.query("select * from members")).rows.length, 0);
      await assert.rejects(
        importWeek(payload),
        /Administrator access required/,
      );
    },
  );
  await t.test(
    "admin imports and coaches can read but cannot directly alter records",
    async () => {
      await login(admin);
      await importWeek(payload);
      await login(coach);
      assert.equal(
        (await db.query("select * from weekly_risks")).rows.length,
        1,
      );
      await assert.rejects(
        db.query("update members set full_name='changed'"),
        /permission denied/,
      );
      await assert.rejects(
        importWeek(payload),
        /Administrator access required/,
      );
    },
  );
  const action = async (
    revision,
    status = "completed",
    request = "10000000-0000-4000-8000-000000000001",
  ) =>
    db.query(`select record_outreach($1,$2,$3,$4,$5,$6,$7,$8,$9) as id`, [
      "stable-123",
      "2026-10-26",
      "Spoke and agreed a return plan.",
      status,
      status === "completed" ? "2026-11-02" : null,
      null,
      coach,
      revision,
      request,
    ]);
  await t.test(
    "notes record actual staff identity and duplicate save requests are idempotent",
    async () => {
      const first = await action(0);
      const retry = await action(0);
      assert.equal(first.rows[0].id, retry.rows[0].id);
      const e = (await db.query("select * from outreach_events")).rows;
      assert.equal(e.length, 1);
      assert.equal(e[0].created_by, coach);
      assert.equal(
        e[0].suppress_through.toISOString().slice(0, 10),
        "2026-11-02",
      );
    },
  );
  await t.test(
    "stale coach revisions cannot overwrite newer decisions",
    async () => {
      await assert.rejects(
        action(0, "open", "10000000-0000-4000-8000-000000000002"),
        /Another coach updated/,
      );
      assert.equal(
        (await db.query("select * from outreach_events")).rows.length,
        1,
      );
    },
  );
  await t.test(
    "reimports preserve decisions and invalid imports roll back",
    async () => {
      await login(admin);
      await importWeek({ ...payload, members: [{ ...member, s7: 1 }] });
      assert.equal(
        (await db.query("select * from outreach_events")).rows.length,
        1,
      );
      await assert.rejects(
        importWeek({
          ...payload,
          members: [
            { ...member, s7: 3 },
            { ...member, member_id: "stable-456", priority: "INVALID" },
          ],
        }),
      );
      assert.equal(
        (await db.query("select s7 from weekly_risks")).rows[0].s7,
        1,
      );
      assert.equal(
        (await db.query("select count(*)::int n from members")).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "next week imports do not destroy member notes or exemptions",
    async () => {
      await importWeek({ ...payload, week: "2026-11-02" });
      assert.equal(
        (await db.query("select count(*)::int n from weekly_reports")).rows[0]
          .n,
        2,
      );
      assert.equal(
        (await db.query("select count(*)::int n from outreach_events")).rows[0]
          .n,
        1,
      );
    },
  );
  await t.test(
    "anonymous access is denied and deactivated staff lose access",
    async () => {
      await db.exec("reset role;");
      await db.query("update staff set active=false where id=$1", [coach]);
      await login(coach);
      assert.equal(
        (await db.query("select * from outreach_events")).rows.length,
        0,
      );
      await assert.rejects(
        action(1, "open", "10000000-0000-4000-8000-000000000003"),
        /Staff access required/,
      );
      await db.exec("reset role; set role anon;");
      await assert.rejects(
        db.query("select * from members"),
        /permission denied/,
      );
    },
  );
  await db.close();
});
