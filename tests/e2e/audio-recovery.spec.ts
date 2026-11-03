import { expect, test } from "@playwright/test";
import { startDemo, traceMedia } from "./helpers";

/**
 * The listening gate must not be defeated by a media request that is cut off or never answers: the player asks again,
 * and the gate still opens only after the audio has really been played through.
 */
async function playThrough(page: import("@playwright/test").Page) {
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible({ timeout: 40_000 });
  await page.getByRole("button", { name: "Play spoken preview" }).click();
  const confirm = page.getByLabel(/I listened to this preview/);
  await expect(confirm).toBeEnabled({ timeout: 40_000 });
  return confirm;
}

test("an audio request that is cut off is retried and the gate still opens", async ({ page }) => {
  let aborted = 0;
  await page.route(/\/api\/revisions\/rev_[a-f0-9]+\/audio/, async (route) => {
    if (aborted < 2) {
      aborted++;
      return route.abort("connectionreset");
    }
    return route.continue();
  });
  await startDemo(page);
  const confirm = await playThrough(page);
  expect(aborted).toBe(2);
  await expect(confirm).toBeEnabled();
  await expect(page.getByTestId("listen-progress")).toContainText("Listened to the whole preview");
});

test("an audio request that never answers is abandoned and asked for again", async ({ page }) => {
  let hung = 0;
  await page.route(/\/api\/revisions\/rev_[a-f0-9]+\/audio/, async (route) => {
    if (hung < 2) {
      hung++; // never answered: the browser would wait forever
      return;
    }
    return route.continue();
  });
  await startDemo(page);
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible({ timeout: 40_000 });
  await traceMedia(page);
  await page.getByRole("button", { name: "Play spoken preview" }).click();
  try {
    await expect(page.getByLabel(/I listened to this preview/)).toBeEnabled({ timeout: 45_000 });
  } catch (err) {
    const trace = await page.evaluate(() => (window as unknown as { __mediaTrace?: string[] }).__mediaTrace ?? []);
    throw new Error(`hung=${hung} trace: ${trace.join(" | ")}
${String(err)}`);
  }
  expect(hung).toBeGreaterThanOrEqual(1);
});

test("the gate does not open for audio that was never played", async ({ page }) => {
  await startDemo(page);
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByLabel(/I listened to this preview/)).toBeDisabled();
  await expect(page.getByRole("button", { name: /Publish announcement/ })).toBeDisabled();
});

test("an audio output error during playback is recovered and the preview still plays through", async ({ page }) => {
  await startDemo(page);
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible({ timeout: 40_000 });
  // Report the failure Chromium raises when the audio output is lost (MEDIA_ERR_DECODE, AUDIO_RENDERER_ERROR) right after playback starts.
  const failed = page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const a = document.querySelector("audio")!;
        a.addEventListener(
          "playing",
          () => {
            a.pause();
            Object.defineProperty(a, "error", { configurable: true, get: () => ({ code: 3, message: "AUDIO_RENDERER_ERROR: audio render error" }) });
            a.dispatchEvent(new Event("error"));
            delete (a as unknown as { error?: unknown }).error;
            resolve();
          },
          { once: true },
        );
      }),
  );
  await page.getByRole("button", { name: "Play spoken preview" }).click();
  await failed;
  await expect(page.getByLabel(/I listened to this preview/)).toBeEnabled({ timeout: 40_000 });
  await expect(page.getByTestId("listen-progress")).toContainText("Listened to the whole preview");
});
