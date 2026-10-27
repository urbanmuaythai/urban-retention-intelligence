export function attendanceLabel(count) {
  return count === null
    ? "No attendance snapshot available"
    : `${count} attended session${count === 1 ? "" : "s"} in this 7-day snapshot`;
}

export function riskExplanation(risk, dates = []) {
  const sequence = risk.sequence || [];
  const prior = sequence.slice(0, -1);
  const known = prior.filter((n) => n !== null);
  const previous = prior.at(-1);
  const stamp = (date) =>
    date
      ? new Intl.DateTimeFormat("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Australia/Brisbane",
        }).format(new Date(date + "T12:00:00Z"))
      : null;
  const currentDate = stamp(dates.at(-1));
  if (risk.priority === "Red") {
    let zeros = 0;
    for (const value of [...sequence].reverse()) {
      if (value !== 0) break;
      zeros++;
    }
    if (risk.s7 === 0 && zeros >= 2)
      return `Red because the latest ${zeros} consecutive weekly snapshots each record 0 attended sessions. These are weekly observations; check in about the gap in training.`;
    if (risk.s7 === 0 && previous >= 2)
      return `Red because attendance fell from ${previous} sessions${stamp(dates.at(-2)) ? " in the " + stamp(dates.at(-2)) + " snapshot" : " in the previous snapshot"} to 0${currentDate ? " in the latest " + currentDate + " snapshot" : " in the latest snapshot"}.`;
    if (risk.s7 === 0 && known.length) {
      const average = known.reduce((sum, n) => sum + n, 0) / known.length;
      if (average >= 2)
        return `Red because the latest snapshot records 0 attended sessions, compared with an average of ${Number(average.toFixed(1))} across ${known.length} earlier weekly snapshot${known.length === 1 ? "" : "s"}.`;
    }
  }
  if (risk.priority === "Yellow" && risk.s7 === 0)
    return `Yellow because there are 0 sessions in the latest 7-day snapshot, with ${risk.s30} visits recorded in the last 30 days.`;
  if (risk.priority === "Review")
    return "Review is needed because attendance history or engagement context is incomplete. Check the member's circumstances before deciding the outreach outcome.";
  return `${risk.priority} for this report: ${risk.signal}.`;
}

// One top-layer tooltip works in the table and inside the modal drawer.
export function installAttendanceTooltips() {
  let popup = null,
    active = null,
    pinned = false;
  const hide = () => {
    active?.removeAttribute("aria-describedby");
    if (popup?.matches(":popover-open")) popup.hidePopover();
    if (popup) popup.hidden = true;
    active = null;
    pinned = false;
  };
  const show = (point, pin = false) => {
    if (!point?.isConnected) return;
    active?.removeAttribute("aria-describedby");
    if (!popup?.isConnected) {
      popup = document.createElement("div");
      popup.id = "attendance-tooltip";
      popup.setAttribute("role", "tooltip");
      popup.setAttribute("popover", "manual");
    }
    const root = point.closest("dialog") || document.body;
    if (popup.parentNode !== root) {
      if (popup.matches(":popover-open")) popup.hidePopover();
      root.append(popup);
    }
    const date = document.createElement("strong"),
      count = document.createElement("p"),
      reason = document.createElement("p");
    date.textContent = point.dataset.snapshotLabel;
    count.textContent = point.dataset.attendanceLabel;
    reason.textContent = "Current report: " + point.dataset.reason;
    popup.replaceChildren(date, count, reason);
    active = point;
    pinned = pin;
    point.setAttribute("aria-describedby", popup.id);
    popup.hidden = false;
    if (popup.showPopover && !popup.matches(":popover-open"))
      popup.showPopover();
    const rect = point.getBoundingClientRect(),
      box = popup.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(
        innerWidth - box.width - 8,
        rect.left + rect.width / 2 - box.width / 2,
      ),
    );
    const top =
      rect.top - box.height - 10 >= 8
        ? rect.top - box.height - 10
        : Math.min(innerHeight - box.height - 8, rect.bottom + 10);
    popup.style.left = left + "px";
    popup.style.top = Math.max(8, top) + "px";
  };
  document.addEventListener("pointerover", (e) => {
    const point = e.target.closest?.(".attendance-point");
    if (point && !(active === point && pinned)) show(point);
  });
  document.addEventListener("pointerout", (e) => {
    const point = e.target.closest?.(".attendance-point");
    if (point === active && !point?.contains(e.relatedTarget) && !pinned)
      hide();
  });
  document.addEventListener("focusin", (e) => {
    if (e.target.matches?.(".attendance-point")) show(e.target);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target === active && !pinned) hide();
  });
  document.addEventListener("click", (e) => {
    const point = e.target.closest?.(".attendance-point");
    if (point) {
      if (active === point && pinned) hide();
      else show(point, true);
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest?.(".attendance-point")) hide();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && active) {
        hide();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  document.addEventListener("scroll", hide, true);
  document.addEventListener("close", hide, true);
  window.addEventListener("resize", hide);
  return hide;
}
