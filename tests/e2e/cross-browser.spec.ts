import { expect, test } from "@playwright/test";
import { generateListenApprove, publicUrl, startDemo } from "./helpers";

/**
 * Real playback in Chromium, Firefox and WebKit (see the projects in playwright.config.ts). These check what a browser
 * does with the audio, not just that the server returned it: the preview plays through, the listening gate opens only
 * then, and the published page plays and pauses. The audio is the labelled test tone, so this says nothing about speech quality.
 */
/** Whether this browser build can play a known-good WAV made in the page, independent of AfterSend's server. */
async function engineCanPlayWav(page: import("@playwright/test").Page) {
  await page.goto("/api/health");
  return page.evaluate(async () => {
    const n = 800;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF");
    v.setUint32(4, 36 + n * 2, true);
    w(8, "WAVE");
    w(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true);
    v.setUint32(28, 16000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, "data");
    v.setUint32(40, n * 2, true);
    const a = new Audio();
    return new Promise<boolean>((resolve) => {
      a.onerror = () => resolve(false);
      a.onloadedmetadata = () => resolve(true);
      a.src = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
      setTimeout(() => resolve(false), 5000);
    });
  });
}

test("the preview plays through, the gate opens, and the listener page plays and pauses", async ({ page, context }) => {
  // Playwright's WebKit build for Windows cannot play any audio (even this in-page WAV fails with code 4), so it says nothing about
  // Safari. Such an engine is skipped, loudly, rather than failing or being counted as a pass.
  test.skip(!(await engineCanPlayWav(page)), "this browser build cannot play a known-good WAV, so playback cannot be tested in it");
  await startDemo(page);
  await generateListenApprove(page, /Publish announcement/);
  const url = await publicUrl(page);

  const listener = await context.newPage();
  await listener.goto(url);
  const paused = () => listener.locator("audio").evaluate((a: HTMLAudioElement) => a.paused);
  expect(await paused()).toBe(true); // never autoplays
  await listener.getByRole("button", { name: "Play announcement" }).click();
  await expect.poll(paused, { timeout: 20_000 }).toBe(false);
  await listener.getByRole("button", { name: "Pause announcement" }).click();
  await expect.poll(paused).toBe(true);

  // Seeking works: the element accepts a new position and reports it.
  const reached = await listener.locator("audio").evaluate(async (a: HTMLAudioElement) => {
    a.currentTime = Math.min(1, a.duration / 2);
    await new Promise((r) => setTimeout(r, 300));
    return a.currentTime;
  });
  expect(reached).toBeGreaterThan(0.5);
});
