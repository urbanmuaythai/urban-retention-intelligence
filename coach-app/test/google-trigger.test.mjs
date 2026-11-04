import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
const source = fs.readFileSync(
  new URL("../../scripts/member-care-trigger.gs", import.meta.url),
  "utf8",
);
test("Google trigger installs only after a successful sync, replaces its own triggers and retains unrelated ones", () => {
  let files = ["246526", "246527", "246528", "246529"].map((id) => ({
    getName: () => `report_export_${id}_1792972800.csv`,
    getId: () => id,
    getBlob: () => ({ getDataAsString: () => "fictional CSV" }),
  }));
  const values = new Map([
    ["MEMBER_CARE_TOKEN", "fictional-token-at-least-32-characters-long"],
  ]);
  const triggers = [
    { id: "other", handler: "otherTask" },
    { id: "old", handler: "syncMemberCare" },
  ];
  let counter = 0,
    posts = 0;
  const wrap = (t) => ({
    ...t,
    getUniqueId: () => t.id,
    getHandlerFunction: () => t.handler,
  });
  const context = vm.createContext({
    console: { log() {} },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => values.get(key),
        setProperty: (key, value) => values.set(key, value),
        deleteProperty: (key) => values.delete(key),
      }),
    },
    DriveApp: {
      getFolderById: () => ({
        getFiles: () => {
          let i = 0;
          return { hasNext: () => i < files.length, next: () => files[i++] };
        },
      }),
    },
    Utilities: {
      formatDate: (date) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Australia/Brisbane",
        }).format(date),
      newBlob: (s) => ({ getBytes: () => Buffer.from(s) }),
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        posts++;
        assert.equal(JSON.parse(options.payload).files.length, 4);
        return {
          getResponseCode: () => 200,
          getContentText: () => '{"status":"unchanged"}',
        };
      },
    },
    ScriptApp: {
      WeekDay: { MONDAY: "MO", FRIDAY: "FR" },
      getProjectTriggers: () => triggers.map(wrap),
      deleteTrigger: (t) =>
        triggers.splice(
          triggers.findIndex((x) => x.id === t.getUniqueId()),
          1,
        ),
      newTrigger: (handler) => {
        const record = { handler };
        const builder = {};
        for (const method of [
          "timeBased",
          "everyMinutes",
        ])
          builder[method] = (value) => {
            record[method] = value;
            return builder;
          };
        builder.create = () => {
          record.id = "new" + counter++;
          triggers.push(record);
          return wrap(record);
        };
        return builder;
      },
    },
  });
  vm.runInContext(source, context);
  context.installMemberCareTriggers();
  assert.equal(posts, 1);
  assert.equal(triggers.length, 2);
  assert.ok(triggers.some((t) => t.id === "other"));
  assert.ok(!triggers.some((t) => t.id === "old"));
  const scheduled = triggers.filter((t) => t.handler === "syncMemberCare");
  assert.deepEqual(
    scheduled.map((t) => t.everyMinutes),
    [30],
  );
  context.installMemberCareTriggers();
  assert.equal(posts, 1, "An already-sent batch is not uploaded again");
  assert.equal(triggers.length, 2, "Reinstall must not duplicate schedules");
  files = files.slice(0, 3);
  assert.throws(
    () => context.installMemberCareTriggers(),
    /no triggers were installed/,
  );
  assert.equal(triggers.length, 2);
});
