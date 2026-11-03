import { expect, test, type Browser, type Page } from "@playwright/test";
import { generateListenApprove, mailCount, newEmail, publicUrl, scan, signInWithEmail, startDemo, waitForCode } from "./helpers";

/**
 * Passwordless email sign-in, recovery and account boundaries, in a real browser against the production build.
 * Mail goes to the file outbox (EMAIL_DRIVER=file), speech comes from the labelled test-tone provider. These
 * tests prove the application's behaviour; they do not prove delivery by a real mail provider or real AssemblyAI audio.
 */

const jsonHeaders = (page: Page) => ({ Origin: new URL(page.url()).origin, "Content-Type": "application/json" });

async function newBrowserContext(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** Creates a notice through the API and publishes it through the real editor. Returns ids and the public link. */
async function publishNotice(page: Page, title = "Pickup notice") {
  const created = await (
    await page.request.post("/api/notices", {
      headers: jsonHeaders(page),
      data: { title, text: "Dear parents,\n\nPickup is at 3:00 PM at the main gate.", voiceId: "test-tone" },
    })
  ).json();
  await page.goto(`/app/notices/${created.noticeId}/edit`);
  await generateListenApprove(page, /Publish announcement/);
  return { noticeId: created.noticeId as string, url: await publicUrl(page) };
}

test("release journey: email sign-up, publish, correct, withdraw, lose the session, recover, and stay isolated", async ({ page, browser }) => {
  const email = newEmail();

  // 1-2. Sign up with email; this creates the workspace.
  await signInWithEmail(page, email);
  await expect(page.getByText(email).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Account" })).toBeVisible();

  // 3-6. Create, generate (test tone), listen, approve, publish and keep the permanent link.
  const { noticeId, url } = await publishNotice(page);
  expect(url).toMatch(/\/n\/[A-Za-z0-9_-]{22}$/);

  // 7. Open the link anonymously.
  const anon = await newBrowserContext(browser);
  await anon.page.goto(url);
  await expect(anon.page.getByTestId("notice-text")).toContainText("Pickup is at 3:00 PM");
  const audio1 = (await anon.page.locator("audio").getAttribute("src"))!;
  expect((await anon.page.request.get(audio1)).status()).toBe(200);

  // 8-10. Correct 3 PM to 4 PM through the editor; the same link now serves the correction.
  await page.getByRole("link", { name: /Update this announcement/ }).click();
  const text = page.getByLabel("Announcement", { exact: true });
  await text.fill((await text.inputValue()).replace("3:00 PM", "4:00 PM"));
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await generateListenApprove(page, /Update announcement/);
  expect(await publicUrl(page)).toBe(url);
  await anon.page.reload();
  await expect(anon.page.getByTestId("notice-text")).toContainText("Pickup is at 4:00 PM");
  const audio2 = (await anon.page.locator("audio").getAttribute("src"))!;
  expect(audio2).not.toBe(audio1);

  // 11. The old audio can no longer be fetched through the application.
  expect((await anon.page.request.get(audio1)).status()).toBe(404);
  expect((await anon.page.request.get(audio2)).status()).toBe(200);

  // 12-13. Withdraw; public access is revoked.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Withdraw announcement" }).click();
  await expect(page.getByText(/^Withdrawn /)).toBeVisible();
  await anon.page.reload();
  await expect(anon.page.getByText("The publisher has withdrawn this announcement.")).toBeVisible();
  expect((await anon.page.request.get(audio2)).status()).toBe(404);

  // 14. Lose the browser session: the cookie is gone and the workspace is unreachable from this browser.
  await page.context().clearCookies();
  await page.goto("/app");
  await expect(page.getByRole("link", { name: "Sign in with email" })).toBeVisible();
  expect((await page.request.get(`/api/notices/${noticeId}`)).status()).toBe(401);

  // 15. Recover with the verified email, in a brand-new browser, and find the original notice.
  const device = await newBrowserContext(browser);
  await signInWithEmail(device.page, email);
  await expect(device.page.getByRole("link", { name: "Pickup notice" })).toBeVisible();
  const detail = await (await device.page.request.get(`/api/notices/${noticeId}`)).json();
  expect(detail.notice.state).toBe("withdrawn");
  expect(detail.revisions.some((r: { displayText: string }) => r.displayText.includes("4:00 PM"))).toBe(true);

  // 16. Another account, and an anonymous visitor, cannot touch it.
  const other = await newBrowserContext(browser);
  await signInWithEmail(other.page, newEmail());
  const headers = jsonHeaders(other.page);
  expect((await other.page.request.get(`/api/notices/${noticeId}`)).status()).toBe(404);
  expect((await other.page.request.post(`/api/notices/${noticeId}/revisions`, { headers, data: { text: "hijack" } })).status()).toBe(404);
  expect((await other.page.request.post(`/api/notices/${noticeId}/withdraw`, { headers })).status()).toBe(404);
  await other.page.goto(`/app/notices/${noticeId}/edit`);
  await expect(other.page.getByRole("heading", { name: "This page does not exist." })).toBeVisible();
  expect((await anon.page.request.get(`/api/notices/${noticeId}`)).status()).toBe(401);
  expect((await other.page.request.get("/api/notices")).status()).toBe(200);
  expect(((await (await other.page.request.get("/api/notices")).json()) as { notices: unknown[] }).notices).toHaveLength(0);

  for (const c of [anon, device, other]) await c.context.close();
});

test("a guest can save their account to an email and recover it later", async ({ page, browser }) => {
  await startDemo(page); // a guest, with the sample announcement as an unpublished draft
  await page.goto("/app");
  await expect(page.getByRole("link", { name: "Save your account", exact: true })).toBeVisible();
  const { noticeId } = await publishNotice(page, "Keep me");

  await page.goto("/app/account");
  await expect(page.getByRole("heading", { name: "Save your account with your email" })).toBeVisible();
  await expect(page.getByText(/with 2 announcements in this browser/)).toBeVisible(); // the sample draft and the published one
  const email = newEmail();
  const before = mailCount(email);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await waitForCode(email, before));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(email).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Keep me" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Save your account", exact: true })).toHaveCount(0);

  // The cookie is lost; the email brings the same notice back, from another browser.
  await page.context().clearCookies();
  const device = await newBrowserContext(browser);
  await signInWithEmail(device.page, email);
  await expect(device.page.getByRole("link", { name: "Keep me" })).toBeVisible();
  expect((await device.page.request.get(`/api/notices/${noticeId}`)).status()).toBe(200);
  await device.context.close();
});

test("signing in on a browser that holds a guest session merges it into the existing account", async ({ page, browser }) => {
  const email = newEmail();
  const first = await newBrowserContext(browser);
  await signInWithEmail(first.page, email);
  await publishNotice(first.page, "From the account");

  await startDemo(page);
  await publishNotice(page, "From this browser");

  await page.goto("/signin");
  await expect(page.getByText(/with 2 announcements in this browser/)).toBeVisible(); // told before anything is sent
  const before = mailCount(email);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await waitForCode(email, before));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("link", { name: "From the account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "From this browser" })).toBeVisible();
  await first.context.close();
});

test("wrong, malformed and locked codes are refused with one calm message", async ({ page }) => {
  await page.goto("/signin");
  // The server, not the browser, judges the address.
  await page.getByLabel("Email address").fill("a@b");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.locator("p[role='alert']")).toContainText("Enter a valid email address");

  const email = newEmail();
  const before = mailCount(email);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const real = await waitForCode(email, before);
  const wrong = real === "000000" ? "111111" : "000000";

  await expect(page.getByLabel("6-digit code")).toBeFocused();
  await expect(page.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled(); // resend cooldown
  const verify = page.getByRole("button", { name: "Verify and continue" });
  await expect(verify).toBeDisabled(); // not until six digits
  for (let i = 0; i < 5; i++) {
    await page.getByLabel("6-digit code").fill(wrong);
    await verify.click();
    await expect(page.locator("p[role='alert']")).toContainText("incorrect or has expired");
  }
  // Locked: even the right code no longer works.
  await page.getByLabel("6-digit code").fill(real);
  await verify.click();
  await expect(page.locator("p[role='alert']")).toContainText("incorrect or has expired");
  await expect(page).toHaveURL(/\/signin$/);

  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
});

test("sign-in works from the keyboard alone", async ({ page }) => {
  const email = newEmail();
  await page.goto("/signin");
  const before = mailCount(email);
  await page.getByLabel("Email address").focus();
  await page.keyboard.type(email);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("6-digit code")).toBeFocused();
  await page.keyboard.type(await waitForCode(email, before));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app$/);
});

test("signing out here leaves other devices signed in; signing out everywhere ends them all", async ({ page, browser }) => {
  const email = newEmail();
  await signInWithEmail(page, email);
  const second = await newBrowserContext(browser);
  await signInWithEmail(second.page, email);

  // Sign out of just this browser.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await second.page.goto("/app");
  await expect(second.page.getByText(email).first()).toBeVisible();

  // Sign back in on the first, then end everything from the account page.
  await signInWithEmail(page, email);
  await page.goto("/app/account");
  await expect(page.getByText(`Signed in as`)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(/\/$/);
  await second.page.goto("/app");
  await expect(second.page.getByRole("link", { name: "Sign in with email" })).toBeVisible();
  expect((await second.page.request.get("/api/notices")).status()).toBe(401);
  await second.context.close();
});

test("a guest is offered the email form to save their account, and a signed-in account is not", async ({ page }) => {
  await startDemo(page);
  await expect(page.getByText("You're using AfterSend as a guest.")).toBeVisible();
  await page.goto("/app/account");
  await expect(page.getByText("You are using AfterSend as a guest.")).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
});

test("the sign-in and account pages have no detectable accessibility violations", async ({ page }) => {
  await page.goto("/signin");
  await scan(page, "sign-in (email step)");
  const email = newEmail();
  const before = mailCount(email);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  await scan(page, "sign-in (code step)");
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.locator("p[role='alert']")).toBeVisible();
  await scan(page, "sign-in (error shown)");

  await page.getByLabel("6-digit code").fill(await waitForCode(email, before));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await scan(page, "announcements");
  await page.goto("/app/account");
  await scan(page, "account (signed in)");

  await page.context().clearCookies();
  await page.goto("/app");
  await scan(page, "signed-out announcements page");
  await startDemo(page);
  await page.goto("/app/account");
  await scan(page, "account (guest)");
});

for (const width of [320, 390, 768]) {
  test(`sign-in and account pages do not overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.goto("/signin");
    expect(await overflow()).toBeLessThanOrEqual(0);
    const email = newEmail();
    const before = mailCount(email);
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByLabel("6-digit code")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByLabel("6-digit code").fill(await waitForCode(email, before));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.goto("/app/account");
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}
