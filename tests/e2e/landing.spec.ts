import { expect, test } from "@playwright/test";
import { generateListenApprove, publicUrl, startDemo } from "./helpers";

test("the hero is visible with reduced motion", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("before-after")).toBeVisible();
  await ctx.close();
});

test("the landing page reads in full without JavaScript", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One announcement link, even when pickup time changes.");
  await expect(page.getByRole("heading", { name: "What AfterSend will not do." })).toBeVisible();
  await expect(page.getByTestId("demo-time")).toHaveText("3:00 PM");
  await ctx.close();
});

test("the call to action starts writing on the sample announcement, with no detour", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an announcement" }).first().click();
  await expect(page).toHaveURL(/\/app\/notices\/ntc_[a-f0-9]+\/edit$/);
  await expect(page.getByLabel("Announcement", { exact: true })).toBeEditable();
});

test("/demo is a working, clearly labelled sample listener page", async ({ page }) => {
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One link. A correction. No re-recording.");
  await expect(page.getByText("Demo data").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Hear the 3:00 PM announcement" })).toBeVisible();
});

test("the correction example changes 3 PM to 4 PM while the link stays the same", async ({ page }) => {
  await page.goto("/");
  const link = page.getByTestId("demo-link");
  const before = await link.textContent();
  await expect(page.getByTestId("demo-listener-text")).toContainText("3:00 PM");
  await page.getByRole("button", { name: "Change the time to 4 PM" }).click();
  await expect(page.getByTestId("demo-time")).toHaveText("4:00 PM");
  await expect(page.getByRole("status").filter({ hasText: "Updating voice" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible({ timeout: 10_000 });
  // The listener still hears the old announcement until the update is approved.
  await expect(page.getByTestId("demo-listener-text")).toContainText("3:00 PM");
  await page.getByRole("button", { name: "Update announcement" }).click();
  await expect(page.getByTestId("demo-listener-text")).toContainText("4:00 PM");
  await expect(link).toHaveText(before!);
});

test("every internal link on public pages resolves", async ({ page, request }) => {
  const seen = new Set<string>();
  for (const path of ["/", "/demo", "/signin", "/docs", "/corrections", "/trust"]) {
    await page.goto(path);
    const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
    hrefs.forEach((h) => seen.add(h.split("#")[0] || "/"));
  }
  for (const h of seen) expect((await request.get(h)).status(), h).toBeLessThan(400);
  // In-page anchors exist.
  await page.goto("/");
  for (const id of ["problem", "correct", "how", "trust", "faq"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
});

test("keyboard users can reach the primary action and see focus", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  let found = false;
  for (let i = 0; i < 15 && !found; i++) {
    await page.keyboard.press("Tab");
    found = await page.evaluate(() => document.activeElement?.textContent?.includes("Create an announcement") ?? false);
  }
  expect(found).toBe(true);
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");
});

test("the judge demo labels its sample in the editor and on the public listener page", async ({ page, context }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Open the demo workspace" }).click();
  await expect(page).toHaveURL(/\/app\/notices\/ntc_[a-f0-9]+\/edit$/);
  await expect(page.getByText("Demo data").first()).toBeVisible();
  await generateListenApprove(page, /Publish announcement/);
  const url = await publicUrl(page);
  const listener = await context.newPage();
  await listener.goto(url);
  await expect(listener.getByTestId("demo-notice")).toContainText("sample demonstration data");
  await expect(listener.getByText("Demo data").first()).toBeVisible();
});

test("withdrawal shows an explicit withdrawn page with no audio", async ({ page, context }) => {
  await startDemo(page);
  await generateListenApprove(page, /Publish announcement/);
  const url = await publicUrl(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Withdraw announcement" }).click();
  await expect(page.getByText(/^Withdrawn /)).toBeVisible();
  const listener = await context.newPage();
  await listener.goto(url);
  await expect(listener.getByText("The publisher has withdrawn this announcement.")).toBeVisible();
  await expect(listener.locator("audio")).toHaveCount(0);
});
