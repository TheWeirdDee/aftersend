import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { generateListenApprove, publicUrl, startDemo } from "./helpers";

/**
 * Automated WCAG 2.1 A/AA checks. They catch a share of problems; they do not replace a manual screen-reader pass.
 *
 * Colour contrast is computed from live styles, so a scan taken while an entrance animation is fading in reports
 * the whole animated area as low contrast (this happened once on the landing page, and once earlier on the
 * editor). A violation therefore only counts if it is still there after the page has had time to settle:
 * every scan is repeated up to four times, 600 ms apart, and fails only if the last one still has violations.
 */
async function scan(page: Page, label: string) {
  let summary: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(attempt === 0 ? 150 : 600);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
    if (summary.length === 0) return;
  }
  expect(summary, `${label}: accessibility violations that persisted after the page settled`).toEqual([]);
}

test("landing, demo and not-found pages have no detectable WCAG A/AA violations", async ({ page }) => {
  await page.goto("/");
  await scan(page, "landing");
  await page.goto("/demo");
  await scan(page, "demo");
  await page.goto("/n/AAAAAAAAAAAAAAAAAAAAAA");
  await scan(page, "unknown notice");
});

test("editor, preview, notice detail, listener and withdrawn pages have no detectable violations", async ({ page, context }) => {
  await startDemo(page);
  await scan(page, "editor (first version)");

  await page.getByRole("button", { name: /Generate preview/ }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Ready to preview" })).toBeVisible({ timeout: 30_000 });
  await scan(page, "editor (preview ready)");

  await page.getByRole("button", { name: "Play audio preview" }).click();
  const confirm = page.getByLabel(/I listened to the preview/);
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await confirm.check();
  await page.getByRole("button", { name: /Approve and publish/ }).first().click();
  await expect(page).toHaveURL(/published=1$/);
  await scan(page, "notice detail");
  const url = await publicUrl(page);

  const listener = await context.newPage();
  await listener.goto(url);
  await scan(listener, "listener");

  await page.getByRole("link", { name: /Correct this notice/ }).click();
  const text = page.getByLabel("Notice text");
  await text.fill((await text.inputValue()).replace("3:00 PM", "4:00 PM"));
  await expect(page.getByText("Draft saved")).toBeVisible();
  await scan(page, "editor (correction with diff)");
  await page.getByLabel("Title").fill("Trip on 05/06/26");
  await expect(page.locator("#title-problem")).toBeVisible();
  await scan(page, "editor (field problem shown)");

  page.once("dialog", (d) => d.accept());
  await page.goto(page.url().replace(/\/edit$/, ""));
  await page.getByRole("button", { name: "Withdraw notice" }).click();
  await expect(page.getByText(/^Withdrawn /)).toBeVisible();
  await listener.reload();
  await scan(listener, "withdrawn listener");
});

test("every interactive control in the editor is reachable by keyboard and shows focus", async ({ page }) => {
  await startDemo(page);
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const visibleFocus = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0 || style.boxShadow !== "none";
      return { id: el.id || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 30) || el.tagName, visibleFocus };
    });
    if (info) {
      expect(info.visibleFocus, `focus indicator on ${info.id}`).toBe(true);
      seen.add(info.id);
    }
  }
  for (const expected of ["title", "text", "voice"]) expect([...seen]).toContain(expected);
});

test("the scan itself still fails on a real, persistent violation", async ({ page }) => {
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>x</title></head><body><main><h1>Heading</h1><p style="color:#bbbbbb;background:#ffffff">Pale grey text on white</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main></body></html>',
  );
  await expect(scan(page, "deliberately bad page")).rejects.toThrow(/persisted after the page settled/);
});
