import { expect, test } from "@playwright/test";
import { startDemo } from "./helpers";

test("the entire preview must finish; publish errors preserve the draft and sharing works signed out", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await startDemo(page);
  const text = `${"Please check this test notice carefully. ".repeat(30)}Pickup is at 3:00 PM.`;
  await page.getByLabel("Announcement", { exact: true }).fill(text);
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible({ timeout: 40_000 });
  const confirm = page.getByLabel(/I listened to this preview/);
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Playback speed").selectOption("0.75");
  await page.getByRole("button", { name: "Play spoken preview" }).click();
  // Observe real playback, then pause with the actual control. No synthetic events or fabricated played ranges.
  await page.waitForFunction(() => {
    const audio = document.querySelector("audio")!;
    return audio.currentTime / audio.duration >= 0.94;
  }, null, { timeout: 40_000, polling: 50 });
  await page.getByRole("button", { name: "Pause spoken preview" }).click();
  await expect(confirm).toBeDisabled();
  await expect(page.locator("#approve-help")).toHaveText("Listen to the whole preview to continue.");
  await page.getByRole("button", { name: "Play spoken preview" }).click();
  await page.waitForFunction(() => document.querySelector("audio")!.ended);
  await expect(confirm).toBeEnabled();
  await confirm.check();

  let fail = true;
  await page.route(/\/api\/revisions\/[^/]+\/approve$/, async route => {
    if (!fail) return route.continue();
    fail = false;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "internal", message: "Temporary publish outage. Your draft is saved.", retryable: true, correlationId: "publish-regression" }) });
  });
  const publish = page.getByRole("button", { name: "Publish announcement", exact: true });
  await publish.click();
  await expect(page.getByRole("alert").filter({ hasText: "Temporary publish outage" })).toBeVisible();
  await expect(page.getByLabel("Announcement", { exact: true })).toHaveValue(text);
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page).toHaveURL(/published=1$/);
  await expect(page.getByText("Published — share this link with families", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open listener page", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  const recipient = await browser.newContext();
  try {
    const listener = await recipient.newPage();
    await listener.goto((await page.getByTestId("public-url").innerText()).trim());
    await expect(listener.getByTestId("notice-text")).toContainText("Pickup is at 3:00 PM.");
    expect(await recipient.cookies()).toHaveLength(0);
    await listener.getByRole("button", { name: "Play announcement", exact: true }).click();
    await expect.poll(() => listener.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0);
  } finally {
    await recipient.close();
  }
});
