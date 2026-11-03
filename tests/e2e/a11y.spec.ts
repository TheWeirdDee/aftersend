import { expect, test } from "@playwright/test";
import { generateListenApprove, publicUrl, scan, startDemo } from "./helpers";

test("landing, sign-in and not-found pages have no detectable WCAG A/AA violations", async ({ page }) => {
  await page.goto("/");
  await scan(page, "landing");
  await page.goto("/signin");
  await scan(page, "sign in");
  await page.goto("/n/AAAAAAAAAAAAAAAAAAAAAA");
  await scan(page, "unknown notice");
});

test("editor, preview, notice detail, listener and withdrawn pages have no detectable violations", async ({ page, context }) => {
  await startDemo(page);
  await scan(page, "editor (first version)");

  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible({ timeout: 40_000 });
  await scan(page, "editor (preview ready)");

  await page.getByRole("button", { name: "Play spoken preview" }).click();
  const confirm = page.getByLabel(/I listened to this preview/);
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await confirm.check();
  await page.getByRole("button", { name: /Publish announcement/ }).first().click();
  await expect(page).toHaveURL(/published=1$/);
  await scan(page, "notice detail");
  const url = await publicUrl(page);

  const listener = await context.newPage();
  await listener.goto(url);
  await scan(listener, "listener");

  await page.getByRole("link", { name: /Update this announcement/ }).click();
  const text = page.getByLabel("Announcement", { exact: true });
  await text.fill((await text.inputValue()).replace("3:00 PM", "4:00 PM"));
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await scan(page, "editor (correction with diff)");
  await page.getByLabel("Title").fill("Trip on 05/06/26");
  await expect(page.locator("#title-problem")).toBeVisible();
  await scan(page, "editor (field problem shown)");

  // Two prompts can appear here: the editor's "unsaved changes" prompt on leaving (the title above is not saveable), and the
  // withdraw confirmation. Both are accepted; a one-shot handler would be used up by whichever comes first.
  page.on("dialog", (d) => void d.accept());
  await page.goto(page.url().replace(/\/edit$/, ""));
  await page.getByRole("button", { name: "Withdraw announcement" }).click();
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
