// Cancellation categories — the same rules as the Cancellation Analysis sheet
// (Apps Script "Urban MT Cancellations" v2.5, which mirrors the Daily Numbers script).
// Autopay = counted in churn (Adults / Teens / Kids). Everything else ends but is not churn:
// Kickstarters and trials are rollover outcomes, Short Term and upfronts are not autopay.

const EXCLUDED_MEMBERSHIPS = [
  "casual session",
  "ks program upfront",
  "ks program up-front",
  "ks program weekly",
  "kickstarter program upfront",
  "kickstarter program up-front",
  "kickstarter program weekly",
  "short term unlimited",
  "short-term unlimited",
  "short term membership unlimited",
  "short-term membership unlimited",
  "sponsored",
  "kids 1 week trial",
  "teens 1 week trial",
  "1 week trial",
  "15 - 18 years kickstarter program",
  "kickstarter deposit",
  "part payment",
];
const TEENS_KEYWORDS = ["teen", "teens", "15-18", "15 - 18"];
const KIDS_KEYWORDS = ["kid", "kids", "junior", "7-10", "7 - 10"];

const normalise = (v) =>
  String(v || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

function isExcluded(lower) {
  if (EXCLUDED_MEMBERSHIPS.some((x) => lower.includes(x))) return true;
  const isKS =
    lower.includes("ks program") || lower.includes("kickstarter program");
  if (isKS && /upfront|up-front|weekly/.test(lower)) return true;
  if (
    (lower.includes("short term") || lower.includes("short-term")) &&
    lower.includes("unlimited")
  )
    return true;
  return /upfront|up front|up-front|trial|deposit|part payment|class pass/.test(
    lower,
  );
}

/** Why a non-autopay ending isn't counted, for the "Not counted" label. */
function excludedType(lower) {
  if (/kickstarter|ks program/.test(lower)) return "Kickstarter";
  if (lower.includes("trial")) return "Trial";
  if (/short term|short-term/.test(lower)) return "Short Term";
  if (lower.includes("sponsored")) return "Sponsored";
  if (/casual|class pass/.test(lower)) return "Casual / class pass";
  if (/deposit|part payment/.test(lower)) return "Deposit / part payment";
  return "Upfront";
}

/**
 * { counted, group, type } for one cancelled membership.
 * counted: true for autopay memberships (the weekly cancellation KPI).
 * group: "Adults" | "Teens" | "Kids" when counted, else "Not counted".
 * type: the group, or the reason it isn't counted (Kickstarter, Trial, Short Term, …).
 */
export function categoriseCancellation(membership) {
  const lower = normalise(membership);
  if (isExcluded(lower))
    return { counted: false, group: "Not counted", type: excludedType(lower) };
  const group = TEENS_KEYWORDS.some((k) => lower.includes(k))
    ? "Teens"
    : KIDS_KEYWORDS.some((k) => lower.includes(k))
      ? "Kids"
      : "Adults";
  return { counted: true, group, type: group };
}
