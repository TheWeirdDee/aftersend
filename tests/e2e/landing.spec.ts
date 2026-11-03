import { expect, test } from "@playwright/test";
import { generateListenApprove, publicUrl, startDemo } from "./helpers";

test("the hero is visible with reduced motion", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("correction-demo")).toBeVisible();
  await ctx.close();
});

test("the landing page reads in full without JavaScript", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One announcement. One link.");
  await expect(page.getByRole("heading", { name: /Built for the office that sends the notice/ })).toBeVisible();
  await expect(page.getByTestId("demo-time")).toHaveText("3:00 PM");
  await ctx.close();
});

test("the call to action leads to the guest start page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Create an announcement/ }).first().click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("button", { name: "Start writing" })).toBeVisible();
});

test("the hero demonstration changes 3 PM to 4 PM while the link stays the same", async ({ page }) => {
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
  for (const path of ["/", "/demo"]) {
    await page.goto(path);
    const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
    hrefs.forEach((h) => seen.add(h.split("#")[0] || "/"));
  }
  for (const h of seen) expect((await request.get(h)).status(), h).toBeLessThan(400);
  // In-page anchors exist.
  await page.goto("/");
  for (const id of ["how", "correct", "faq", "trust"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
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
