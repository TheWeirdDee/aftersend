import { expect, test } from "@playwright/test";
import { generateListenApprove, publicUrl, startDemo } from "./helpers";

test("Journey A + B: publish, then correct 3:00 PM → 4:00 PM at the unchanged link", async ({ page, context }) => {
  await startDemo(page);
  await expect(page.getByRole("button", { name: /Approve and publish/ }).first()).toBeDisabled();
  await generateListenApprove(page, /Approve and publish/);
  await expect(page.getByText("Version 1 is live.")).toBeVisible();
  const url = await publicUrl(page);

  const listener = await context.newPage();
  await listener.goto(url);
  await expect(listener.getByTestId("notice-text")).toContainText("Pickup is at 3:00 PM");
  await expect(listener.getByText("Test audio · not AssemblyAI")).toBeVisible();
  await expect(listener.getByTestId("revised-banner")).toHaveCount(0);
  const audio1 = await listener.locator("audio").getAttribute("src");

  // Correction
  await page.getByRole("link", { name: /Correct this notice/ }).click();
  const text = page.getByLabel("Notice text");
  await text.fill((await text.inputValue()).replace("3:00 PM", "4:00 PM"));
  await expect(page.getByText("Draft saved")).toBeVisible();
  await expect(page.locator("del", { hasText: "3:00" })).toBeVisible();
  await expect(page.locator("ins", { hasText: "4:00" })).toBeVisible();
  await page.getByRole("button", { name: /Use suggestion/ }).click();
  await expect(page.getByLabel(/Update note/)).toHaveValue("Update: Pickup is at 4:00 PM at the main gate.");
  await generateListenApprove(page, /Approve update/);
  await expect(page.getByText("Version 2 is live.")).toBeVisible();
  expect(await publicUrl(page)).toBe(url);

  // Same link, refreshed: new text, new audio, revision label.
  await listener.reload();
  expect(listener.url()).toBe(url);
  await expect(listener.getByTestId("notice-text")).toContainText("Pickup is at 4:00 PM");
  await expect(listener.getByTestId("notice-text")).not.toContainText("3:00 PM");
  await expect(listener.getByTestId("revised-banner")).toContainText("This notice was revised. This is version 2.");
  await expect(listener.getByTestId("revised-banner")).toContainText("Current time: 4:00 PM");
  const audio2 = await listener.locator("audio").getAttribute("src");
  expect(audio2).not.toBe(audio1);
  const res = await listener.request.get(audio2!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("audio/wav");
  // The superseded audio is not served from the public link any more.
  expect((await listener.request.get(audio1!)).status()).toBe(404);

  // Manifest agrees with the page.
  const manifest = await (await listener.request.get(url.replace("/n/", "/api/public/") + "/current")).json();
  expect(manifest.revisionNumber).toBe(2);
  expect(manifest.audioUrl).toBe(audio2);
  expect(manifest.displayText).toContain("4:00 PM");
});

test("Journey C: a failed synthesis blocks approval and the published version stays live", async ({ page, context }) => {
  await startDemo(page);
  await generateListenApprove(page, /Approve and publish/);
  const url = await publicUrl(page);
  await page.getByRole("link", { name: /Correct this notice/ }).click();
  const text = page.getByLabel("Notice text");
  // Test-only fault injection marker understood by the test-tone provider.
  await text.fill(`${await text.inputValue()} [[fail-synthesis]]`);
  await expect(page.getByText("Draft saved")).toBeVisible();
  await page.getByRole("button", { name: /Generate preview/ }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "Audio generation failed" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Approve update/ }).first()).toBeDisabled();

  const listener = await context.newPage();
  await listener.goto(url);
  await expect(listener.getByTestId("notice-text")).toContainText("Pickup is at 3:00 PM");
  await expect(listener.getByTestId("notice-text")).not.toContainText("fail-synthesis");
  const src = await listener.locator("audio").getAttribute("src");
  expect((await listener.request.get(src!)).status()).toBe(200);
});

test("Journey E: another workspace cannot read or change a notice", async ({ page, browser }) => {
  await startDemo(page);
  const editUrl = page.url();
  const noticeId = editUrl.match(/ntc_[a-f0-9]+/)![0];
  const status = await page.request.get(`/api/notices/${noticeId}`);
  expect(status.status()).toBe(200);

  const other = await browser.newContext();
  const intruder = await other.newPage();
  await intruder.goto("/demo");
  await intruder.getByRole("button", { name: "Start the demo" }).click();
  await expect(intruder).toHaveURL(/\/edit$/);
  const base = new URL(page.url()).origin;
  const headers = { Origin: base, "Content-Type": "application/json" };
  expect((await intruder.request.get(`/api/notices/${noticeId}`)).status()).toBe(404);
  expect((await intruder.request.post(`/api/notices/${noticeId}/revisions`, { headers, data: { text: "hijack" } })).status()).toBe(404);
  expect((await intruder.request.post(`/api/notices/${noticeId}/withdraw`, { headers })).status()).toBe(404);
  await intruder.goto(`/app/notices/${noticeId}/edit`);
  await expect(intruder.getByRole("heading", { name: "Page not found." })).toBeVisible();

  // Unauthenticated and cross-site requests are refused.
  const anon = await browser.newContext();
  expect((await anon.request.get(`/api/notices/${noticeId}`)).status()).toBe(401);
  expect((await page.request.post(`/api/notices/${noticeId}/withdraw`, { headers: { Origin: "https://evil.example" } })).status()).toBe(403);
  await other.close();
  await anon.close();
});

test("Journey F: competing approvals cannot silently overwrite each other", async ({ page }) => {
  await startDemo(page);
  await generateListenApprove(page, /Approve and publish/);
  const noticeId = page.url().match(/ntc_[a-f0-9]+/)![0];
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin, "Content-Type": "application/json" };
  const detail = await (await page.request.get(`/api/notices/${noticeId}`)).json();
  const baseText: string = detail.current.displayText;

  const mk = async (time: string) => {
    const r = await (await page.request.post(`/api/notices/${noticeId}/revisions`, { headers, data: { text: baseText.replace("3:00 PM", time) } })).json();
    expect((await page.request.post(`/api/revisions/${r.revisionId}/generate`, { headers })).status()).toBe(200);
    return r.revisionId as string;
  };
  const a = await mk("4:00 PM");
  const b = await mk("5:00 PM");
  const [ra, rb] = await Promise.all([
    page.request.post(`/api/revisions/${a}/approve`, { headers, data: { confirmedCriticalFacts: true } }),
    page.request.post(`/api/revisions/${b}/approve`, { headers, data: { confirmedCriticalFacts: true } }),
  ]);
  const statuses = [ra.status(), rb.status()].sort();
  expect(statuses).toEqual([200, 409]);
  const after = await (await page.request.get(`/api/notices/${noticeId}`)).json();
  expect(after.current.revisionNumber).toBe(2);
});

test("approval is refused without confirmed facts or ready audio", async ({ page }) => {
  await startDemo(page);
  const noticeId = page.url().match(/ntc_[a-f0-9]+/)![0];
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin, "Content-Type": "application/json" };
  const detail = await (await page.request.get(`/api/notices/${noticeId}`)).json();
  const rev = detail.revisions[0].id;
  expect((await page.request.post(`/api/revisions/${rev}/approve`, { headers, data: { confirmedCriticalFacts: true } })).status()).toBe(409);
  await page.request.post(`/api/revisions/${rev}/generate`, { headers });
  expect((await page.request.post(`/api/revisions/${rev}/approve`, { headers, data: {} })).status()).toBe(422);
  expect((await page.request.post(`/api/revisions/${rev}/approve`, { headers, data: { confirmedCriticalFacts: true } })).status()).toBe(200);
});
