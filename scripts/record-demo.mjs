#!/usr/bin/env node
/**
 * Records the demo footage from a DEPLOYED AfterSend with a real browser: guest start, real speech, listening, publishing,
 * the public link, the 3 PM to 4 PM correction, and the same link serving the update. Nothing is simulated: every frame is
 * the real site. Captions are drawn on the page, so the video can be watched muted. It is silent: record narration
 * separately (see docs/DEMO_SCRIPT.md). It does not cover saving the account, which needs a code from a real inbox.
 *
 *   node scripts/record-demo.mjs https://aftersend-sigma.vercel.app --confirm-live
 *
 * Spends two real speech syntheses and creates one guest workspace. Writes evidence/demo-video/<timestamp>/demo.webm
 * and demo.srt (caption timings measured while recording).
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith("http")) ?? "").replace(/\/$/, "");
if (!base || !args.includes("--confirm-live")) {
  console.error("Usage: node scripts/record-demo.mjs <base-url> --confirm-live   (spends real speech credits)");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.join("evidence", "demo-video", stamp);
fs.mkdirSync(dir, { recursive: true });

// A null audio sink: the footage is silent, and this keeps playback from depending on the recording machine's sound device.
const browser = await chromium.launch({ args: ["--mute-audio", "--disable-audio-output"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } }, colorScheme: "light" });
const page = await context.newPage();
const t0 = Date.now();
const cues = [];

async function caption(text, holdMs = 2500) {
  const at = Date.now() - t0;
  cues.push({ at, text, holdMs });
  await page.evaluate((t) => {
    let el = document.getElementById("__caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__caption";
      el.setAttribute("aria-hidden", "true");
      el.style.cssText =
        "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:82%;padding:12px 22px;background:rgba(12,14,11,.94);color:#f3f4ee;font:600 21px/1.35 Inter,system-ui,sans-serif;border-radius:14px;z-index:2147483647;text-align:center;box-shadow:0 6px 30px rgba(0,0,0,.35)";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
  await page.waitForTimeout(holdMs);
}

const ready = () => page.getByRole("status").filter({ hasText: "Ready to listen" }).waitFor({ timeout: 90_000 });

async function listenAndConfirm(note) {
  await ready();
  await caption(note, 1800);
  await page.getByRole("button", { name: "Play spoken preview" }).click();
  // Real playback, at normal speed, until the gate opens.
  await page.getByLabel(/I listened to this preview/).waitFor();
  await page.waitForFunction(() => { const c = document.querySelector("input[type=checkbox]"); return !!c && !c.disabled; }, null, { timeout: 120_000 });
  await page.getByLabel(/I listened to this preview/).check();
}

try {
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await caption("An important school announcement has been shared. Then the pickup time changes.", 3500);
  await page.getByRole("button", { name: "Change the time to 4 PM" }).click();
  await caption("An illustration: change the time, the voice is prepared again, the link stays the same.", 4500);

  await page.getByRole("link", { name: /Create an announcement/ }).first().click();
  await page.waitForURL(/\/demo$/);
  await caption("No account is needed to try it.", 2500);
  await page.getByRole("button", { name: "Start writing" }).click();
  await page.waitForURL(/\/edit$/);
  await caption("A sample announcement. Replace every word if you like. The voice is prepared automatically by AssemblyAI.", 4000);

  await listenAndConfirm("Real speech is ready. I listen to the whole preview before anything is public.");
  await caption("Nothing is public until I publish it.", 1800);
  await page.getByRole("button", { name: /Publish announcement/ }).click();
  await page.waitForURL(/published=1$/);
  await caption("Published. This link is what parents receive.", 3000);
  const link = (await page.getByTestId("public-url").textContent())?.trim();

  await page.goto(link);
  await caption("The listener page: no account, no autoplay, the full text beside the audio.", 3500);
  await page.getByRole("button", { name: "Play announcement" }).click();
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "Pause announcement" }).click();

  await page.goBack();
  await page.getByRole("link", { name: /Update this announcement/ }).click();
  await caption("Now the pickup time changes: 3 PM becomes 4 PM.", 2500);
  const text = page.getByLabel("Announcement", { exact: true });
  await text.fill((await text.inputValue()).replace("3:00 PM", "4:00 PM"));
  await caption("The old voice is marked out of date. The new one is prepared when I stop typing.", 4500);
  await listenAndConfirm("The corrected speech is ready. I listen to it before approving.");
  await caption("The old announcement stays live until I approve this one.", 2500);
  await page.getByRole("button", { name: /Update announcement/ }).click();
  await page.waitForURL(/published=2$/);
  await caption("Updated. The link has not changed.", 3000);

  await page.goto(link);
  await caption("The same link now says 4:00 PM, marked as corrected, with the new voice.", 4500);
  await page.getByRole("button", { name: "Play announcement" }).click();
  await page.waitForTimeout(5000);
  await caption("The words changed. The voice changed. The link stayed the same.", 4000);
} finally {
  const video = page.video();
  await context.close();
  const file = path.join(dir, "demo.webm");
  if (video) fs.renameSync(await video.path(), file);
  await browser.close();
  const ts = (ms) => new Date(ms).toISOString().slice(11, 23).replace(".", ",");
  fs.writeFileSync(
    path.join(dir, "demo.srt"),
    cues.map((c, i) => `${i + 1}\n${ts(c.at)} --> ${ts(c.at + c.holdMs)}\n${c.text}\n`).join("\n"),
  );
  console.log(`Wrote ${file} (${Math.round((Date.now() - t0) / 1000)} s) and demo.srt`);
}
