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
  await page.getByLabel(/I listened to the preview/).check();
  await page.getByRole("button", { name: approveName }).first().click();
  await expect(page).toHaveURL(/\/app\/notices\/ntc_[a-f0-9]+\?published=\d+$/);
}

export async function publicUrl(page: Page) {
  return (await page.getByTestId("public-url").textContent())!.trim();
}
