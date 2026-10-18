import { expect, test } from "@playwright/test";
import { generateListenApprove, publicUrl, startDemo } from "./helpers";

test("Journey D: mobile listener reads, plays and pauses without autoplay", async ({ page, browser }) => {
  await startDemo(page);
  await generateListenApprove(page, /Approve and publish|Publish/);
  const url = await publicUrl(page);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  await p.goto(url);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Sample School Schedule Notice");
  await expect(p.getByTestId("updated-at")).toContainText(/Published \d{1,2} \w{3} \d{4}, \d{1,2}:\d{2} (AM|PM) \w+/);
  await expect(p.getByTestId("notice-text")).toContainText("Pickup is at 3:00 PM");
  await expect(p.getByText("Demo data: a fictional sample notice")).toBeVisible();

  const paused = () => p.locator("audio").evaluate((a: HTMLAudioElement) => a.paused);
  expect(await paused()).toBe(true); // no autoplay
  await p.getByRole("button", { name: "Play current notice" }).tap();
  await expect.poll(paused).toBe(false);
  await p.getByRole("button", { name: "Pause current notice" }).tap();
  await expect.poll(paused).toBe(true);

  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const res = await p.request.get(url);
  expect(res.headers()["cache-control"]).toContain("no-store");
  await phone.close();
});

test("unknown and withdrawn links show honest states", async ({ page }) => {
  const res = await page.goto("/n/AAAAAAAAAAAAAAAAAAAAAA");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("This notice link doesn't exist.")).toBeVisible();
});
