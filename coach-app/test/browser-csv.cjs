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
    const reportEvents = [],
      olderReports = [],
      olderRisks = [];
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
      else if (url.pathname.endsWith("/outreach_events")) body = reportEvents;
      else if (imported && url.pathname.endsWith("/weekly_reports"))
        body = [
          ...olderReports,
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
        body = [
          ...olderRisks,
          ...imported.members.map((m) => ({ ...m, week: imported.week })),
        ];
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
    await page.locator(".workspace-choices").waitFor();
    assert.equal(
      await page.locator(".sidebar").count(),
      0,
      "Login opens a separate portal",
    );
    assert.match(
      await page
        .locator(".member-portal")
        .evaluate((el) => getComputedStyle(el, "::before").backgroundImage),
      /urban-gym-community/,
    );
    assert.equal(await page.locator(".workspace-choices button").count(), 3);
    await page.locator('.workspace-choices [data-view="queue"]').click();
    await page.locator("#import-open").waitFor();
    assert.equal(
      await page.locator('nav [data-view="cancellations"]').count(),
      0,
      "At Risk navigation stays in one workspace",
    );
    await page.locator('[data-view="reporting"]').click();
    assert.match(
      await page.locator("main").innerText(),
      /No weekly reports yet/,
    );
    await page.locator('[data-view="queue"]').click();
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
    // Selecting a complete batch prepares the preview without an extra click.
    await page.locator("#confirm-identity").waitFor();
    assert.equal(
      imported,
      null,
      "Automatic preparation must not write before review",
    );
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
    assert.match(await page.locator("#import-error").innerText(), /all four/);
    assert.equal(imported, null, "Incomplete batches must never be imported");
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
    for (const as_of of [
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
    ]) {
      baselines.push({ ...baselines[0], as_of });
    }
    const archiveRead = page.waitForResponse((r) =>
      r.url().includes("/rest/v1/attendance_baselines"),
    );
    await page.locator("#refresh").click();
    await archiveRead;
    await page.locator("#import-open").click();
    const zeroRows = fixture({ s7: 0, s30: 4 });
    zeroRows.cancellations[0]["Membership Expiry Date"] = "2026-10-27";
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
      await page.locator(".attendance-point").nth(6).getAttribute("data-date"),
      /2026-10-19/,
    );
    await page.locator("#attendance-stage").selectOption("Extended absence");
    assert.match(await page.locator("tbody").innerText(), /Extended absence/);
    assert.match(
      await page.locator("tbody").innerText(),
      /8 consecutive zero-attendance snapshots/,
    );
    await page.locator("#attendance-stage").selectOption("Disengaged");
    assert.equal(await page.locator("tbody .row-open").count(), 0);
    await page.locator("#attendance-stage").selectOption("All");
    await page.locator("tbody .row-open").first().click();
    await page
      .locator("#note")
      .fill("Keep this draft while checking attendance.");
    assert.match(
      await page.locator(".risk-explanation").innerText(),
      /weekly snapshots/,
    );
    const point = page.locator("#member-dialog .attendance-point").nth(6);
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
    await page.locator('[data-view="home"]').first().click();
    assert.equal(await page.locator(".workspace-choices button").count(), 3);
    assert.equal(
      await page.getByText("Daily Numbers", { exact: true }).count(),
      0,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: "test-results/workspace-home-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "test-results/workspace-portal-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator('.workspace-choices [data-view="cancellations"]')
      .click();
    assert.match(
      await page.locator("main").innerText(),
      /Retention exclusions need review/,
    );
    imported.import_summary.retentionPolicy = {
      version: 1,
      excludedMembershipIds: [],
    };
    for (const period of imported.import_summary.operations.periods)
      period.policyApplied = true;
    const operationRead = page.waitForResponse((r) =>
      r.url().includes("/rest/v1/weekly_reports"),
    );
    await page.locator("#refresh").click();
    await operationRead;
    await page
      .getByRole("heading", {
        name: "Memberships ending this week",
        exact: true,
      })
      .waitFor();
    assert.equal(await page.locator("main tbody tr").count(), 1);
    assert.match(await page.locator("main tbody").innerText(), /Moved/);
    assert.equal(
      await page.locator("#operation-period").inputValue(),
      "2026-10-23",
    );
    assert.match(
      await page.locator(".report-period").innerText(),
      /Fri 23 Oct 2026.*Thu 29 Oct 2026/,
    );
    await page.locator("#operation-period").selectOption("2026-10-16");
    assert.match(
      await page.locator("main").innerText(),
      /No records for this week/,
    );
    await page.locator("#operation-period").selectOption("2026-10-23");
    assert.match(await page.locator("main tbody").innerText(), /Moved/);
    assert.equal(await page.locator('nav [data-view="due"]').count(), 0);
    await page.locator('main [data-view="home"]').click();
    await page.locator('.workspace-choices [data-view="suspensions"]').click();
    assert.match(
      await page.locator("main").innerText(),
      /Suspensions during this week/,
    );
    await page.locator('main [data-view="home"]').click();
    await page.locator('.workspace-choices [data-view="queue"]').click();
    olderReports.push({
      week: "2026-10-19",
      import_summary: { asOf: "2026-10-19" },
    });
    olderRisks.push({ ...imported.members[0], week: "2026-10-19" });
    reportEvents.push(
      {
        id: "note-a",
        member_id: "clubworx:123",
        week: imported.week,
        status: "contacted",
        sequence: 1,
        created_at: "2026-10-27T01:00:00Z",
      },
      {
        id: "note-b",
        member_id: "clubworx:123",
        week: imported.week,
        status: "booked",
        sequence: 2,
        created_at: "2026-10-27T02:00:00Z",
      },
      {
        id: "note-c",
        member_id: "clubworx:123",
        week: "2026-10-19",
        status: null,
        sequence: 3,
        created_at: "2026-10-27T02:00:00Z",
      },
    );
    const reportingRead = page.waitForResponse((r) =>
      r.url().includes("/rest/v1/outreach_events"),
    );
    await page.locator("#refresh").click();
    await reportingRead;
    await page.locator('[data-view="reporting"]').click();
    await page.getByRole("heading", { name: "Weekly reporting." }).waitFor();
    const reportRows = page
      .locator(".reporting-panel")
      .first()
      .locator("tbody tr");
    assert.deepEqual(await reportRows.first().locator("td").allTextContents(), [
      "1",
      "1",
      "0",
      "100%",
      "0",
    ]);
    assert.equal(await page.locator("[data-report-week]").count(), 2);
    await page.locator('[data-report-week="2026-10-19"]').click();
    assert.deepEqual(
      await page
        .locator(".reporting-panel")
        .first()
        .locator("tbody tr")
        .first()
        .locator("td")
        .allTextContents(),
      ["1", "0", "1", "0%", "0"],
    );
    await page.locator("#week").selectOption("2026-10-26");
    await page.locator("#report-open-red").click();
    assert.equal(
      await page.locator('[data-priority="Red"]').getAttribute("aria-pressed"),
      "true",
    );
    await page.locator('[data-view="reporting"]').click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "Reporting fits mobile viewport",
    );
    await page.screenshot({
      path: "test-results/weekly-reporting-mobile.png",
      fullPage: true,
    });
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
