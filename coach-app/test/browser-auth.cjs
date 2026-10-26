const { chromium } = require("playwright");
const assert = require("assert/strict");
const path = require("path");
const fs = require("fs");
const artifactDir = path.resolve(__dirname, "../test-results");
fs.mkdirSync(artifactDir, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "Welcome back, Urban team." })
    .waitFor();
  assert.equal(
    await page.locator("tbody tr").count(),
    0,
    "No workspace before explicit access",
  );
  assert.equal(
    await page.locator("#login-submit").isDisabled(),
    true,
    "Missing provider cannot fake a login",
  );
  await page.locator("#password").fill("not-a-real-password");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  assert.equal(await page.locator("#password").getAttribute("type"), "text");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  assert.equal(
    await page.locator("#password").getAttribute("type"),
    "password",
  );
  await page.locator("#password").fill("");
  await page.screenshot({
    path: path.join(artifactDir, "coach_login_desktop.png"),
  });
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await page.getByRole("heading", { name: "Reset your password" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Send reset link" }).isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Back to sign in", exact: true })
    .click();
  await page.getByRole("button", { name: "Explore sample workspace" }).click();
  await page.locator("#week").waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "Welcome back, Urban team." })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(artifactDir, "coach_login_mobile.png"),
    fullPage: true,
  });
  const production = await browser.newPage();
  await production.goto("http://127.0.0.1:5174/", { waitUntil: "networkidle" });
  assert.equal(
    await production
      .getByRole("button", { name: "Explore sample workspace" })
      .count(),
    0,
    "Production hides preview access",
  );
  assert.equal(await production.locator("tbody tr").count(), 0);

  // Exercise the actual Supabase SDK and UI with deterministic mock HTTP responses.
  // This verifies client behaviour, not the unconnected hosted project.
  const live = await browser.newPage();
  let approved = false,
    privateReads = 0;
  const uid = "00000000-0000-4000-8000-000000000001";
  const jwt =
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({
        sub: uid,
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: "authenticated",
      }),
    ).toString("base64url") +
    ".test-signature";
  await live.route("**/src/store.js*", async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    body = body
      .replace(
        "const url = import.meta.env.VITE_SUPABASE_URL;",
        'const url = "https://coach-auth-test.supabase.co";',
      )
      .replace(
        "const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;",
        'const key = "test-public-key";',
      );
    await route.fulfill({ response, body });
  });
  await live.route("https://coach-auth-test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let status = 200,
      body = {};
    if (url.pathname === "/auth/v1/token") {
      const data = JSON.parse(req.postData() || "{}");
      if (data.password !== "valid-test-password") {
        status = 400;
        body = {
          code: "invalid_credentials",
          msg: "Invalid login credentials",
        };
      } else
        body = {
          access_token: jwt,
          refresh_token: "test-refresh",
          token_type: "bearer",
          expires_in: 3600,
          user: {
            id: uid,
            email: data.email,
            aud: "authenticated",
            created_at: new Date().toISOString(),
          },
        };
    } else if (url.pathname === "/auth/v1/recover") {
      body = {};
    } else if (url.pathname === "/auth/v1/logout") {
      body = {};
    } else if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").at(-1);
      if (table === "staff")
        body = approved
          ? [
              {
                id: uid,
                display_name: "Approved Test Staff",
                role: "coach",
                active: true,
              },
            ]
          : [];
      else {
        privateReads++;
        body = [];
      }
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await live.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await live.locator("#email").fill("coach@example.test");
  await live.locator("#password").fill("incorrect");
  await live.locator("#login-submit").click();
  await live
    .getByText("Email or password wasn’t recognised.", { exact: false })
    .waitFor();
  assert.equal(privateReads, 0);
  await live.locator("#password").fill("valid-test-password");
  await live.locator("#login-submit").click();
  await live
    .getByText("Your account needs staff approval.", { exact: false })
    .waitFor();
  assert.equal(privateReads, 0, "Unapproved user never loads private tables");
  approved = true;
  await live.locator("#email").fill("coach@example.test");
  await live.locator("#password").fill("valid-test-password");
  await live.locator("#login-submit").click();
  await live.locator("#week").waitFor();
  assert.ok(privateReads > 0, "Approved account loads workspace");
  await live.getByRole("button", { name: "Sign out", exact: true }).click();
  await live
    .getByRole("heading", { name: "Welcome back, Urban team." })
    .waitFor();
  assert.equal(await live.locator("#week").count(), 0);
  assert.equal(await live.locator("#password").inputValue(), "");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: login-first, password toggle, reset UI, explicit preview, production gate, mocked SDK invalid/unapproved/approved sign-in and sign-out",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
