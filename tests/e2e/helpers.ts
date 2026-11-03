import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

/** Starts a guest session the way a visitor does, from the homepage button; it opens the editor on the sample announcement. */
export async function startDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an announcement" }).first().click();
  await expect(page).toHaveURL(/\/app\/notices\/ntc_[a-f0-9]+\/edit$/);
}

/**
 * A guest session made through the API only, without opening the editor. The editor prepares speech by itself the moment it
 * opens, so tests that drive the API step by step must not have an editor open on the same draft.
 */
export async function startGuestViaApi(page: Page) {
  const origin = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
  const res = await page.request.post("/api/workspace", { headers: { Origin: origin, "Content-Type": "application/json" }, data: { kind: "guest" } });
  expect(res.status()).toBe(201);
  const noticeId = ((await res.json()) as { redirect: string }).redirect.match(/ntc_[a-f0-9]+/)![0];
  return { noticeId, origin };
}

/**
 * Records, in the page, every play(), pause() and load() call, every media event and every audio element added or removed from
 * the document, so a listening gate that does not open can be explained from the failure report.
 */
export async function traceMedia(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __mediaTrace?: string[]; __mediaTraced?: boolean };
    if (w.__mediaTraced) return;
    w.__mediaTraced = true;
    const trace: string[] = (w.__mediaTrace = []);
    const t0 = performance.now();
    const note = (what: string) => trace.push(`${Math.round(performance.now() - t0)}ms ${what}`);
    const proto = HTMLMediaElement.prototype;
    for (const name of ["play", "pause", "load"] as const) {
      const original = proto[name] as (...a: unknown[]) => unknown;
      (proto as unknown as Record<string, unknown>)[name] = function (this: HTMLMediaElement, ...a: unknown[]) {
        note(`${name}() paused=${this.paused} ready=${this.readyState} t=${this.currentTime.toFixed(2)}`);
        const result = original.apply(this, a);
        if (result instanceof Promise) result.then(() => note(`${name}() resolved`), (e: Error) => note(`${name}() rejected ${e.name}`));
        return result;
      };
    }
    for (const type of ["loadstart", "loadedmetadata", "canplay", "playing", "pause", "waiting", "stalled", "suspend", "abort", "emptied", "error", "ended", "seeking"]) {
      document.addEventListener(
        type,
        (e) => {
          const el = e.target as HTMLMediaElement;
          const err = type === "error" && el.error ? ` code=${el.error.code} message=${el.error.message} net=${el.networkState} ready=${el.readyState} t=${el.currentTime.toFixed(2)}` : "";
          note(`event ${type}${err}`);
        },
        true,
      );
    }
    new MutationObserver((records) => {
      for (const r of records) {
        r.removedNodes.forEach((n) => n instanceof Element && (n.tagName === "AUDIO" || n.querySelector("audio")) && note("audio element REMOVED"));
        r.addedNodes.forEach((n) => n instanceof Element && (n.tagName === "AUDIO" || n.querySelector("audio")) && note("audio element ADDED"));
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

/** Wait for the voice to be prepared by itself → listen → confirm → publish, from the editor. */
export async function generateListenApprove(page: Page, approveName: RegExp) {
  await expect(page.getByRole("status").filter({ hasText: "Ready to listen" })).toBeVisible({ timeout: 40_000 });
  await traceMedia(page);
  await page.getByRole("button", { name: "Play spoken preview" }).click();
  // The confirmation unlocks only once the preview has actually played through, not when play is pressed.
  const confirm = page.getByLabel(/I listened to this preview/);
  try {
    await expect(confirm).toBeEnabled({ timeout: 30_000 });
  } catch (err) {
    // Say what the browser's media element was doing, so a stuck gate is diagnosed from the report rather than guessed at.
    const media = await page
      .locator("audio")
      .first()
      .evaluate((a: HTMLAudioElement) => {
        const ranges = (r: TimeRanges) => Array.from({ length: r.length }, (_, i) => [r.start(i), r.end(i)]);
        return { readyState: a.readyState, networkState: a.networkState, paused: a.paused, ended: a.ended, currentTime: a.currentTime, duration: a.duration, error: a.error && { code: a.error.code, message: a.error.message }, played: ranges(a.played), buffered: ranges(a.buffered), src: a.currentSrc.slice(-60) };
      })
      .catch((e) => String(e));
    const trace = await page.evaluate(() => (window as unknown as { __mediaTrace?: string[] }).__mediaTrace ?? []).catch(() => []);
    throw new Error(`The listening gate did not open. Media element: ${JSON.stringify(media)}
Trace: ${trace.join(" | ")}
${String(err)}`);
  }
  await confirm.check();
  await page.getByRole("button", { name: approveName }).first().click();
  await expect(page).toHaveURL(/\/app\/notices\/ntc_[a-f0-9]+\?published=\d+$/);
}

/** The saved version of a revision, as the approve endpoint requires. */
export async function versionOf(page: Page, revisionId: string) {
  const status = await (await page.request.get(`/api/revisions/${revisionId}/status`)).json();
  return status.version as number;
}

export async function publicUrl(page: Page) {
  return (await page.getByTestId("public-url").textContent())!.trim();
}

/**
 * Automated WCAG 2.1 A/AA checks. They catch a share of problems; they do not replace a manual screen-reader pass.
 *
 * Colour contrast is computed from live styles, so a scan taken while an entrance animation is fading in reports
 * the whole animated area as low contrast (this happened once on the landing page, and once earlier on the
 * editor). A violation therefore only counts if it is still there after the page has had time to settle:
 * every scan is repeated up to four times, 600 ms apart, and fails only if the last one still has violations.
 */
export async function scan(page: Page, label: string) {
  let summary: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(attempt === 0 ? 150 : 600);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
    if (summary.length === 0) return;
  }
  expect(summary, `${label}: accessibility violations that persisted after the page settled`).toEqual([]);
}

const OUTBOX = path.resolve(".data/e2e/outbox");

function mailFor(address: string) {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs
    .readdirSync(OUTBOX)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), "utf8")) as { to: string; text: string })
    .filter((m) => m.to === address);
}

/** How many messages have been sent to an address so far. Read before asking for a code. */
export const mailCount = (address: string) => mailFor(address).length;

/** Waits for a message newer than `before` and returns the six-digit code in it. Reads the test outbox, never a real mailbox. */
export async function waitForCode(address: string, before: number) {
  await expect.poll(() => mailFor(address).length, { timeout: 15_000 }).toBeGreaterThan(before);
  return /code is (\d{6})/.exec(mailFor(address).at(-1)!.text)![1]!;
}

let sequence = 0;
export const newEmail = () => `e2e-${Date.now()}-${++sequence}@example.com`;

/** Signs a browser in (or up) through the real sign-in page. */
export async function signInWithEmail(page: Page, address: string) {
  await page.goto("/signin");
  const before = mailCount(address);
  await page.getByLabel("Email address").fill(address);
  await page.getByRole("button", { name: "Send code" }).click();
  const code = await waitForCode(address, before);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
}
