export const week = "2026-10-26";
export function csv(rows) {
  const keys = Object.keys(rows[0]);
  const field = (value) =>
    '"' + String(value ?? "").replaceAll('"', '""') + '"';
  return [
    keys.map(field).join(","),
    ...rows.map((row) => keys.map((k) => field(row[k])).join(",")),
  ].join("\r\n");
}
export function fixture({
  s7 = 0,
  s30 = 0,
  plan = "Unlimited",
  limit = "Unlimited classes",
  engagement,
  duplicate = false,
} = {}) {
  const attendance = {
    "Contact ID": "123",
    "First Name": "Fictional",
    "Last Name": "Member",
    "Attendances (Last 7 days)": s7,
    "Attendances (Last 30 days)": s30,
    "Attendance Last Marked": "",
    "Membership ID": "m1",
    "Membership Name": plan,
    "Membership Attendance Limit (Description)": limit,
  };
  if (engagement !== undefined) attendance.Engagement = engagement;
  const active = {
    "Contact ID": "123",
    "Full Name": "Fictional Member",
    "Membership ID": "m1",
    "Membership Name": plan,
    "Membership Start Date": "2026-01-01",
    "Membership Expiry Date": "",
    "Membership Active?": "true",
    Status: "Active",
  };
  const suspensions = {
    "Contact ID": "999",
    "Full Name": "Fictional Other",
    "Suspension Starts": "2026-01-01",
    "Suspension Ends": "2026-02-01",
    "Suspension Current?": "false",
  };
  const cancellations = {
    "Contact ID": "999",
    "Full Name": "Fictional Other",
    "Membership ID": "cancel1",
    "Membership Start Date": "2026-01-01",
    "Membership Expiry Date": "2026-03-01",
    "Cancellation Date": "2026-02-01",
    "Cancellation Present?": "true",
    "Cancellation Reason": "Moved",
  };
  return {
    attendance: duplicate
      ? [attendance, { ...attendance, "Membership ID": "m2" }]
      : [attendance],
    active: duplicate
      ? [active, { ...active, "Membership ID": "m2" }]
      : [active],
    suspensions: [suspensions],
    cancellations: [cancellations],
  };
}
export const filesFor = (rows, date = week) =>
  Object.entries(rows).map(([kind, rows]) => ({
    name: `${kind}_${date}.csv`,
    text: csv(rows),
  }));
