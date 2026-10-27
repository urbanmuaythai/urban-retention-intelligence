import { createClient } from "@supabase/supabase-js";
import { demoData } from "./demo.js";
import { validateAction, validateImport } from "./domain.js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key);
export const allowDemo =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === "true";
export const client = configured ? createClient(url, key) : null;
export class StaffAccessError extends Error {
  constructor(message) {
    super(message);
    this.name = "StaffAccessError";
  }
}
const storageKey = "urban-coach-preview-v1";
export class Workspace {
  constructor(demo = false) {
    this.demo = demo;
    this.channel = null;
    this.user = null;
    this.data = null;
    this.online = false;
  }
  async load() {
    if (this.demo) {
      try {
        this.data = JSON.parse(localStorage.getItem(storageKey)) || demoData();
      } catch {
        this.data = demoData();
      }
      // Preserve existing preview notes while updating the app's staff terminology.
      this.data.staff = this.data.staff.map((person) => ({
        ...person,
        display_name:
          person.id === "demo-coach"
            ? "Urban Team · Preview"
            : person.display_name.replace(/\bcoach\b/gi, "team"),
      }));
      this.data.events = this.data.events.map((event) => ({
        ...event,
        author: (event.author || "Urban Team").replace(/\bcoach\b/gi, "team"),
      }));
      this.user = this.data.staff[0];
      return this.data;
    }
    if (!client)
      throw new StaffAccessError("Staff sign-in is not connected yet.");
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError || !session)
      throw new StaffAccessError(
        "Your session has ended. Please sign in again.",
      );
    const { data: staff, error: staffError } = await client
      .from("staff")
      .select("*")
      .eq("id", session.user.id)
      .eq("active", true)
      .maybeSingle();
    if (staffError) {
      if (
        [401, 403].includes(staffError.status) ||
        staffError.code === "PGRST301"
      )
        throw new StaffAccessError(
          "Your session has ended. Please sign in again.",
        );
      throw staffError;
    }
    if (!staff)
      throw new StaffAccessError(
        "Your account needs staff approval. Ask your administrator to enable access.",
      );
    this.user = staff;
    const readAll = async (table, select, order) => {
      let rows = [];
      for (let from = 0; ; from += 500) {
        let q = client.from(table).select(select).order(order);
        if (table === "weekly_risks") q = q.order("week");
        const { data, error } = await q.range(from, from + 499);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 500) break;
      }
      return rows;
    };
    const [weeks, members, risks, events, team, baselines] = await Promise.all([
      readAll("weekly_reports", "*", "week"),
      readAll("members", "*", "id"),
      readAll("weekly_risks", "*", "member_id"),
      readAll("outreach_events", "*", "sequence"),
      readAll("staff", "id,display_name,role,active", "id"),
      readAll("attendance_baselines", "*", "as_of"),
    ]);
    const map = new Map(members.map((m) => [m.id, m]));
    const names = new Map(team.map((m) => [m.id, m.display_name]));
    this.data = {
      weeks,
      baselines,
      members,
      risks: risks.map((r) => ({ ...r, member: map.get(r.member_id) })),
      events: events.map((e) => ({
        ...e,
        author: names.get(e.created_by) || "Former staff",
      })),
      staff: team,
    };
    return this.data;
  }
  async save(member, week, action) {
    validateAction(action, week);
    if (this.demo) {
      const event = {
        ...action,
        id: crypto.randomUUID(),
        sequence: Math.max(0, ...this.data.events.map((e) => e.sequence)) + 1,
        member_id: member.id,
        week,
        author: this.user.display_name,
        created_at: new Date().toISOString(),
      };
      // Persist before acknowledging a successful save; report storage failures to staff.
      const next = structuredClone(this.data);
      next.events.push(event);
      const m = next.members.find((m) => m.id === member.id);
      if (m) m.revision++;
      for (const r of next.risks)
        if (r.member_id === member.id) r.member.revision = m.revision;
      localStorage.setItem(storageKey, JSON.stringify(next));
      this.data = next;
      return;
    }
    const { error } = await client.rpc("record_outreach", {
      p_member_id: member.id,
      p_week: week,
      p_body: action.body.trim(),
      p_status: action.status || null,
      p_suppress_through: action.suppress_through || null,
      p_follow_up_on: action.follow_up_on || null,
      p_assigned_to: action.assigned_to || null,
      p_expected_revision: member.revision,
      p_request_id: action.request_id || crypto.randomUUID(),
    });
    if (error) throw error;
    await this.load();
  }
  async import(payload) {
    validateImport(payload);
    if (this.demo)
      throw Error(
        "Weekly import is available in the connected staff workspace.",
      );
    const { error } = await client.rpc("import_retention_week", {
      p_payload: payload,
    });
    if (error) throw error;
    await this.load();
  }
  subscribe(callback, onStatus) {
    if (this.demo) return;
    this.channel = client
      .channel("coach-desk-" + crypto.randomUUID())
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "outreach_events" },
        callback,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "weekly_reports" },
        callback,
      )
      .subscribe((status) => {
        this.online = status === "SUBSCRIBED";
        onStatus?.(status);
      });
  }
  async dispose() {
    if (this.channel) await client.removeChannel(this.channel);
  }
  reset() {
    if (this.demo) {
      localStorage.removeItem(storageKey);
      this.data = demoData();
    }
  }
}
