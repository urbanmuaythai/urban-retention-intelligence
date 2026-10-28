// Urban Member Care: standalone Google Apps Script, owned by getfit@urbanmuaythai.com.
// Set MEMBER_CARE_TOKEN in Project Settings > Script properties. Never paste a Supabase key.
const MEMBER_CARE_FOLDER = "1e4X24ykUscsd67u4Uzp_qXx7dD8e3Li_";
const MEMBER_CARE_URL =
  "https://uzbcsgjocpxhidjaduct.supabase.co/functions/v1/clubworx-drive-import";
const MEMBER_CARE_REPORTS = ["246526", "246527", "246528", "246529"];

function syncMemberCare() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { status: "busy" };
  try {
    const properties = PropertiesService.getScriptProperties();
    const token = properties.getProperty("MEMBER_CARE_TOKEN");
    if (!token || token.length < 32)
      throw new Error(
        "Add the private MEMBER_CARE_TOKEN script property first.",
      );
    const iterator = DriveApp.getFolderById(MEMBER_CARE_FOLDER).getFiles();
    const newest = {};
    const now = Date.now();
    while (iterator.hasNext()) {
      const file = iterator.next(),
        name = file.getName(),
        match = /^report_export_(\d+)_(\d{10})\.csv$/.exec(name);
      if (!match || !MEMBER_CARE_REPORTS.includes(match[1])) continue;
      const exported = Number(match[2]) * 1000;
      if (exported > now) continue;
      if (!newest[match[1]] || newest[match[1]].exported < exported)
        newest[match[1]] = { file, exported, name };
    }
    const batch = MEMBER_CARE_REPORTS.map((id) => newest[id]);
    if (batch.some((file) => !file))
      return saveMemberCareReceipt_({
        status: "waiting",
        reason: "Waiting for all four reports.",
      });
    const dates = batch.map((x) =>
      Utilities.formatDate(
        new Date(x.exported),
        "Australia/Brisbane",
        "yyyy-MM-dd",
      ),
    );
    if (
      new Set(dates).size !== 1 ||
      Math.max(...batch.map((x) => x.exported)) -
        Math.min(...batch.map((x) => x.exported)) >
        1800000
    )
      return saveMemberCareReceipt_({
        status: "waiting",
        reason: "Waiting for one fresh same-day batch within 30 minutes.",
      });
    const files = batch.map((x) => ({
      id: x.file.getId(),
      name: x.name,
      text: x.file.getBlob().getDataAsString("UTF-8"),
    }));
    const payload = JSON.stringify({ folderId: MEMBER_CARE_FOLDER, files });
    if (Utilities.newBlob(payload).getBytes().length > 5 * 1024 * 1024)
      throw new Error(
        "Export batch exceeds the 5 MB cloud limit. Review before importing manually.",
      );
    const response = UrlFetchApp.fetch(MEMBER_CARE_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload,
      muteHttpExceptions: true,
    });
    let receipt;
    try {
      receipt = JSON.parse(response.getContentText());
    } catch {
      throw new Error("Member Care returned an unreadable response.");
    }
    if (response.getResponseCode() !== 200)
      throw new Error(
        receipt.error ||
          "Member Care import was not confirmed. Check the report before retrying.",
      );
    return saveMemberCareReceipt_(receipt);
  } finally {
    lock.releaseLock();
  }
}

function saveMemberCareReceipt_(receipt) {
  const properties = PropertiesService.getScriptProperties();
  const now = Date.now();
  properties.setProperty(
    "MEMBER_CARE_LAST_CHECK",
    JSON.stringify({ checkedAt: new Date(now).toISOString(), ...receipt }),
  );
  if (receipt.status === "waiting") {
    const since = Number(
      properties.getProperty("MEMBER_CARE_WAITING_SINCE") || now,
    );
    properties.setProperty("MEMBER_CARE_WAITING_SINCE", String(since));
    if (now - since > 4 * 86400000)
      throw new Error(
        "The Clubworx export batch remains incomplete. Export all four configured reports together.",
      );
  } else properties.deleteProperty("MEMBER_CARE_WAITING_SINCE");
  console.log(JSON.stringify(receipt)); // Counts and status only; no CSVs, tokens or member details.
  return receipt;
}

// Run this once and approve Google's authorisation prompts. Repeat safely to replace these two triggers.
function installMemberCareTriggers() {
  const receipt = syncMemberCare();
  if (!["unchanged", "imported"].includes(receipt.status))
    throw new Error(
      "First complete a successful sync; no triggers were installed.",
    );
  const created = [];
  try {
    [ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.FRIDAY].forEach((day) =>
      created.push(
        ScriptApp.newTrigger("syncMemberCare")
          .timeBased()
          .onWeekDay(day)
          .everyWeeks(1)
          .atHour(9)
          .nearMinute(0)
          .inTimezone("Australia/Brisbane")
          .create(),
      ),
    );
  } catch (error) {
    created.forEach((trigger) => ScriptApp.deleteTrigger(trigger));
    throw error;
  }
  const ids = new Set(created.map((trigger) => trigger.getUniqueId()));
  ScriptApp.getProjectTriggers()
    .filter(
      (trigger) =>
        trigger.getHandlerFunction() === "syncMemberCare" &&
        !ids.has(trigger.getUniqueId()),
    )
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  console.log(
    "Installed: Monday and Friday around 9 am Australia/Brisbane. Confirm these in Triggers before disabling the desktop fallback.",
  );
}
