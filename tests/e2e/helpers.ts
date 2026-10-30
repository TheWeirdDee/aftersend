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
