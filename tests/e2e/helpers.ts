import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export async function startDemo(page: Page) {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Start the demo" }).click();
  await expect(page).toHaveURL(/\/app\/notices\/ntc_[a-f0-9]+\/edit$/);
}

/** Generate → listen → confirm → approve, from the editor. */
export async function generateListenApprove(page: Page, approveName: RegExp) {
  await page.getByRole("button", { name: /Generate preview/ }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Ready to preview" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Play audio preview" }).click();
  // The confirmation unlocks only once the preview has actually played through, not when play is pressed.
  const confirm = page.getByLabel(/I listened to the preview/);
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
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
