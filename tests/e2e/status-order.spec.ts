import { expect, test } from "@playwright/test";
import { startDemo } from "./helpers";

/**
 * A status response that arrives late must not overwrite a newer one. Without that, a slow "still preparing" answer lands after
 * "ready", the spoken preview disappears, and when it comes back it is a brand-new audio element: whatever the person was
 * listening to is discarded and the listening gate can never open. This reproduced as an unexplained flaky failure under load.
 */
test("a late, older status response does not remove or reset the spoken preview", async ({ page }) => {
  let calls = 0;
  await page.route(/\/api\/revisions\/rev_[a-f0-9]+\/status$/, async (route) => {
    calls++;
    if (calls === 1) {
      const older = await route.fetch(); // the state of the draft right now: no voice yet
      await new Promise((r) => setTimeout(r, 5000)); // ...delivered long after a newer answer
      return route.fulfill({ response: older });
    }
    return route.continue();
  });
  await startDemo(page);
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible({ timeout: 40_000 });
  await page.locator("audio").evaluate((a) => ((a as HTMLAudioElement).dataset.original = "yes"));
  await page.getByRole("button", { name: "Play spoken preview" }).click();
  await page.waitForTimeout(6500); // the old answer is delivered during this time
  expect(calls).toBeGreaterThanOrEqual(2);
  await expect(page.locator("audio")).toHaveAttribute("data-original", "yes"); // the same element, not a replacement
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible();
  await expect(page.getByLabel(/I listened to this preview/)).toBeEnabled({ timeout: 30_000 });
});
