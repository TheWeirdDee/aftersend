import { expect, test } from "@playwright/test";
import { generateListenApprove, publicUrl, startDemo } from "./helpers";

test("hero content is visible with reduced motion", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const opacity = await page.locator("[data-hero='line']").first().evaluate((el) => getComputedStyle(el).opacity);
  expect(opacity).toBe("1");
  await ctx.close();
});

test("landing works without JavaScript", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The message changed.");
  const opacity = await page.locator("[data-reveal]").first().evaluate((el) => getComputedStyle(el).opacity);
  expect(opacity).toBe("1");
  await ctx.close();
});

test("animated hero settles visible and the CTA leads to the demo", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.locator("[data-hero='cta']").first().evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await page.getByRole("link", { name: /Try live demo/ }).first().click();
  await expect(page).toHaveURL(/\/demo$/);
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
  for (const id of ["product", "how", "faq", "trust"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
});

test("keyboard users can reach the primary action and see focus", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  let found = false;
  for (let i = 0; i < 15 && !found; i++) {
    await page.keyboard.press("Tab");
    found = await page.evaluate(() => document.activeElement?.textContent?.includes("Try live demo") ?? false);
  }
  expect(found).toBe(true);
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");
});

test("withdrawal shows an explicit withdrawn page with no audio", async ({ page, context }) => {
  await startDemo(page);
  await generateListenApprove(page, /Approve and publish/);
  const url = await publicUrl(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Withdraw notice" }).click();
  await expect(page.getByText(/^Withdrawn /)).toBeVisible();
  const listener = await context.newPage();
  await listener.goto(url);
  await expect(listener.getByText("This notice has been withdrawn by its publisher.")).toBeVisible();
  await expect(listener.locator("audio")).toHaveCount(0);
});

test("non-landing pages never wait on landing motion", async ({ page }) => {
  await page.goto("/demo");
  const opacity = await page.locator("header[data-hero]").evaluate((el) => getComputedStyle(el).opacity);
  expect(opacity).toBe("1");
});
