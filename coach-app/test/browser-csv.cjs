const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const { fixture, filesFor } = await import("./csv-fixtures.mjs");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ hasTouch: true });
    const errors = [];
    let imported = null;
    const baselines = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const uid = "00000000-0000-4000-8000-000000000001";
    const jwt =
      [
        { alg: "HS256", typ: "JWT" },
        {
          sub: uid,
          exp: Math.floor(Date.now() / 1000) + 3600,
          role: "authenticated",
        },
      ]
        .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
        .join(".") + ".test-signature";
    const staff = {
      id: uid,
      display_name: "Fictional Admin",
      role: "admin",
      active: true,
    };
    await page.route("https://*.supabase.co/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      let body = [];
      if (url.pathname === "/auth/v1/token")
        body = {
          access_token: jwt,
          refresh_token: "test-refresh",
          token_type: "bearer",
          expires_in: 3600,
          user: {
            id: uid,
            email: "admin@example.test",
            aud: "authenticated",
            created_at: new Date().toISOString(),
          },
        };
      else if (url.pathname === "/rest/v1/rpc/import_retention_week") {
        imported = JSON.parse(req.postData()).p_payload;
        body = imported.members.length;
      } else if (url.pathname.endsWith("/staff")) body = [staff];
      else if (url.pathname.endsWith("/attendance_baselines")) body = baselines;
      else if (imported && url.pathname.endsWith("/weekly_reports"))
        body = [
          {
            week: imported.week,
            source_label: imported.source_label,
            attendance_snapshot: imported.attendance_snapshot,
            import_summary: imported.import_summary,
          },
        ];
      else if (imported && url.pathname.endsWith("/members"))
        body = imported.members.map((m) => ({
          id: m.member_id,
          full_name: m.name,
          membership: m.membership,
          revision: 0,
        }));
      else if (imported && url.pathname.endsWith("/weekly_risks"))
        body = imported.members.map((m) => ({ ...m, week: imported.week }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.goto(
      process.env.CSV_TEST_URL ||
        "http://127.0.0.1:5174/urban-retention-intelligence/member-care/",
    );
    await page.locator("#email").fill("admin@example.test");
    await page.locator("#password").fill("fictional-test-password");
    await page.locator("#login-submit").click();
    await page.locator("#import-open").waitFor();
    await page.locator("#import-open").click();
    const fileInputs = filesFor(
      fixture({ duplicate: true, s7: 1, s30: 4 }),
    ).map((f) => ({
      name: f.name,
      mimeType: "text/csv",
      buffer: Buffer.from(f.text),
    }));
    await page.locator("#import-csv").setInputFiles(fileInputs);
    await page
      .getByText("Review weekly attendance targets", { exact: true })
      .waitFor();
    await page.locator("#preview-csv").click();
    await page.locator("#confirm-identity").waitFor();
    assert.match(
      await page.locator("#import-summary").innerText(),
      /1 people across 2 membership rows/,
    );
    assert.equal(await page.locator("#confirm-import").isDisabled(), true);
    await page.locator("#confirm-identity").check();
    assert.equal(await page.locator("#confirm-import").isEnabled(), true);
    // A changed cutoff must invalidate the previously accepted payload.
    await page.locator("#import-week").fill("2026-10-19");
    assert.equal(await page.locator("#confirm-import").isDisabled(), true);
    await page.locator("#preview-csv").click();
    assert.match(
      await page.locator("#import-error").innerText(),
      /does not match/,
    );
    await page.locator("#import-week").fill("2026-10-26");
    await page.locator("#preview-csv").click();
    await page.locator("#confirm-identity").check();
    await page.locator("#import-csv").setInputFiles(fileInputs.slice(0, 3));
    assert.equal(await page.locator("#confirm-import").isDisabled(), true);
    await page.locator("#import-csv").setInputFiles(fileInputs);
    await page.locator("#preview-csv").waitFor({ state: "visible" });
    await page.waitForFunction(
      () => !document.querySelector("#preview-csv").disabled,
    );
    await page.locator("#preview-csv").click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => {
        const d = document.querySelector("#import-dialog");
        return d.scrollWidth > d.clientWidth + 1;
      }),
      false,
      "Mobile import dialog has no horizontal overflow",
    );
    await page.locator("#confirm-identity").check();
    await page.locator("#confirm-import").click();
    await page.waitForFunction(
      () => !document.querySelector("#import-dialog").open,
    );
    assert.equal(imported.identity_mode, "clubworx-contact-id");
    assert.equal(imported.members.length, 1);
    assert.equal(imported.members[0].s7, 1);
    assert.equal(imported.attendance_snapshot.length, 1);
    assert.equal(imported.members[0].priority, "Review");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    assert.match(await page.locator("tbody").innerText(), /Fictional Member/);
    // Reproduce the reported issue: a fresh Tuesday export in Monday's report week.
    await page.locator("#import-open").click();
    const freshRows = fixture({ s7: 1, s30: 4 });
    freshRows.attendance[0]["Attendance Last Marked"] = "2026-10-27 09:00:00";
    const freshFiles = filesFor(freshRows).map((f, i) => ({
      name: `report_export_${i}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(f.text),
    }));
    await page.locator("#import-csv").setInputFiles(freshFiles);
    await page.waitForFunction(
      () => !document.querySelector("#preview-csv").disabled,
    );
    await page.locator("#import-as-of").fill("2026-10-26");
    await page.locator("#preview-csv").click();
    assert.match(
      await page.locator("#import-error").innerText(),
      /cutoff \(2026-10-26\): 2026-10-27/,
    );
    assert.equal(
      await page
        .locator("#import-error")
        .evaluate((el) => el === document.activeElement),
      true,
      "Validation error is focused instead of hidden at the bottom",
    );
    assert.match(await page.locator("#import-progress").innerText(), /paused/);
    assert.equal(await page.locator("#confirm-import").isDisabled(), true);
    await page.locator("#import-as-of").fill("2026-10-27");
    assert.equal(await page.locator("#import-week").inputValue(), "2026-10-26");
    await page.locator("#preview-csv").click();
    assert.match(
      await page.locator("#import-summary").innerText(),
      /Data as of 27 Oct 2026/,
    );
    await page.locator("#confirm-identity").check();
    await page.locator("#confirm-import").click();
    await page.waitForFunction(
      () => !document.querySelector("#import-dialog").open,
    );
    assert.equal(imported.week, "2026-10-26");
    assert.equal(imported.import_summary.asOf, "2026-10-27");
    assert.match(
      await page.locator(".table-footer").innerText(),
      /data as of 27 Oct 2026/,
    );
    // Cloud history must survive a refresh and be reused by a later CSV import.
    baselines.push({
      as_of: "2026-10-19",
      metadata: { kind: "archived-weekly-summary" },
      snapshot: [
        {
          member_id: "clubworx:123",
          s7: 0,
          s30: 4,
          membership: "Unlimited",
          engagement: "Fringe",
        },
      ],
    });
    const archiveRead = page.waitForResponse((r) =>
      r.url().includes("/rest/v1/attendance_baselines"),
    );
    await page.locator("#refresh").click();
    await archiveRead;
    await page.locator("#import-open").click();
    const zeroRows = fixture({ s7: 0, s30: 4 });
    const zeroFiles = filesFor(zeroRows).map((f, i) => ({
      name: `new_export_${i}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(f.text),
    }));
    await page.locator("#import-csv").setInputFiles(zeroFiles);
    await page.waitForFunction(
      () => !document.querySelector("#preview-csv").disabled,
    );
    await page.locator("#import-as-of").fill("2026-10-27");
    await page.locator("#preview-csv").click();
    assert.match(await page.locator("#import-summary").innerText(), /1 Red/);
    await page.locator("#confirm-identity").check();
    await page.locator("#confirm-import").click();
    await page.waitForFunction(
      () => !document.querySelector("#import-dialog").open,
    );
    await page.getByRole("button", { name: "Red", exact: true }).click();
    assert.match(await page.locator("tbody").innerText(), /Repeated zero/);
    assert.match(
      await page.locator(".history-notice").innerText(),
      /Historical weekly summaries linked/,
    );
    assert.match(
      await page.locator(".attendance-point").nth(4).getAttribute("data-date"),
      /2026-10-19/,
    );
    await page.locator("tbody .row-open").first().click();
    await page
      .locator("#note")
      .fill("Keep this draft while checking attendance.");
    assert.match(
      await page.locator(".risk-explanation").innerText(),
      /weekly snapshots/,
    );
    const point = page.locator("#member-dialog .attendance-point").nth(4);
    await point.hover();
    await page.getByRole("tooltip").waitFor({ state: "visible" });
    assert.match(await page.getByRole("tooltip").innerText(), /19 Oct 2026/);
    assert.match(
      await page.getByRole("tooltip").innerText(),
      /0 attended sessions/,
    );
    assert.match(
      await page.getByRole("tooltip").innerText(),
      /Current report: Red/,
    );
    await page.mouse.move(0, 0);
    await page.getByRole("tooltip").waitFor({ state: "hidden" });
    await point.focus();
    await page.getByRole("tooltip").waitFor({ state: "visible" });
    assert.equal(
      await point.getAttribute("aria-describedby"),
      "attendance-tooltip",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("tooltip").waitFor({ state: "hidden" });
    assert.equal(
      await page.locator("#member-dialog").evaluate((d) => d.open),
      true,
    );
    await point.tap();
    await page.getByRole("tooltip").waitFor({ state: "visible" });
    const bounds = await page.getByRole("tooltip").boundingBox();
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= 390,
      "Tooltip fits mobile viewport",
    );
    require("node:fs").mkdirSync("test-results", { recursive: true });
    await page.screenshot({
      path: "test-results/attendance-tooltip-mobile.png",
    });
    await page.locator("#note").tap();
    await page.getByRole("tooltip").waitFor({ state: "hidden" });
    assert.equal(
      await page.locator("#note").inputValue(),
      "Keep this draft while checking attendance.",
    );
    await page.locator("#close-member").click();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: production CSV picker, preview, identity review, stale-preview invalidation, mobile dialog, SDK import and Review filter (mocked Supabase; no live data written)",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
