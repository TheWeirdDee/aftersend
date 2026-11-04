import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';

const base = process.argv[2] ?? 'https://aftersend-sigma.vercel.app';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = `evidence/editor-proof-${stamp}`;
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync('.data/editor-proof', { recursive: true });
const browser = await chromium.launch();
const publisher = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const recipient = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await publisher.newPage();
page.on('dialog', dialog => dialog.accept());
const report = { base, at: new Date().toISOString(), events: [], approvals: [] };
page.on('pageerror', error => { (report.pageErrors ??= []).push(error.message); });
page.on('framenavigated', frame => { if (frame === page.mainFrame()) (report.navigation ??= []).push(frame.url()); });
page.on('response', async res => {
  if (/\/approve$/.test(res.url())) report.approvals.push({ status: res.status(), request: res.request().postDataJSON(), response: await res.json().catch(() => null) });
  if (/\/status$/.test(res.url())) {
    const status = await res.json().catch(() => null);
    if (status?.audio) report.provider = status.audio.providerKind;
  }
  if (/\/api\/workspace$/.test(res.url())) report.workspace = { status: res.status(), response: await res.json().catch(() => null) };
});
async function mediaTrace(p) {
  await p.evaluate(() => {
    window.__media = [];
    if (window.__mediaTraced) return;
    window.__mediaTraced = true;
    for (const name of ['loadedmetadata', 'playing', 'pause', 'waiting', 'error', 'ended', 'emptied', 'seeking']) {
      document.addEventListener(name, e => {
        if (!(e.target instanceof HTMLMediaElement)) return;
        const a = e.target;
        window.__media.push({ name, time: a.currentTime, duration: a.duration, ready: a.readyState, error: a.error?.message, played: Array.from({ length: a.played.length }, (_, i) => [a.played.start(i), a.played.end(i)]) });
      }, true);
    }
  });
}
async function listen(p, label) {
  await p.waitForLoadState('load', { timeout: 120000 });
  console.log(`Playing ${label} to completion: ${p.url()}`);
  await mediaTrace(p);
  await p.getByRole('button', { name: `Play ${label}`, exact: true }).click();
  try {
    await p.waitForFunction(() => document.querySelector('audio')?.ended, null, { timeout: 120000 });
  } catch (error) {
    report.playbackFailure = await p.locator('audio').evaluate(a => ({ url: location.href, time: a.currentTime, duration: a.duration, paused: a.paused, error: a.error?.message, readyState: a.readyState, trace: window.__media })).catch(() => null);
    await p.screenshot({ path: `${dir}/playback-failure.png`, fullPage: true });
    throw error;
  }
  const detail = await p.locator('audio').evaluate(a => ({ src: a.currentSrc, duration: a.duration, ended: a.ended, played: Array.from({ length: a.played.length }, (_, i) => [a.played.start(i), a.played.end(i)]), trace: window.__media }));
  report.events.push({ label, ...detail });
}
try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('load', { timeout: 120000 });
  const create = page.getByRole('button', { name: 'Create an announcement', exact: true });
  if (await create.count()) await create.first().click();
  else {
    await page.getByRole('link', { name: 'Create an announcement', exact: true }).first().click();
    await page.getByRole('button', { name: 'Start writing', exact: true }).click();
  }
  await page.waitForURL(/\/edit$/, { waitUntil: 'domcontentloaded', timeout: 60000 });
  report.editor = page.url();
  await publisher.storageState({ path: `.data/editor-proof/publisher-${stamp}.json` });
  // Enter original text in the actual editor before its automatic speech update.
  await page.getByLabel('Title', { exact: true }).fill('AfterSend test notice — publishing review');
  await page.getByLabel('Announcement', { exact: true }).fill('This is a test announcement. Pickup is at 3:00 PM at the main gate. Please bring your pickup card.');
  await expect(page.getByRole('status').filter({ hasText: 'Ready to listen' })).toBeVisible({ timeout: 120000 });
  report.before = await page.locator('#approve-help').innerText();
  await listen(page, 'spoken preview');
  report.afterPlayback = { blocker: await page.locator('#approve-help').innerText(), progress: await page.getByTestId('listen-progress').innerText(), confirmationDisabled: await page.getByLabel(/I listened to this preview/).isDisabled() };
  await page.screenshot({ path: `${dir}/preview-ended.png`, fullPage: true });
  await expect(page.getByLabel(/I listened to this preview/)).toBeEnabled();
  await page.getByLabel(/I listened to this preview/).check();
  await page.getByRole('button', { name: 'Publish announcement', exact: true }).click();
  await page.waitForURL(/published=1$/, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open listener page', exact: true })).toBeVisible();
  expect(report.provider).toBe('assemblyai');
  await page.screenshot({ path: `${dir}/publish-confirmation.png`, fullPage: true });
  report.listener = (await page.getByTestId('public-url').innerText()).trim();
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  report.copiedLink = await page.evaluate(() => navigator.clipboard.readText());
  expect(report.copiedLink).toBe(report.listener);
  const listener = await recipient.newPage();
  await listener.goto(report.copiedLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
  expect(await recipient.cookies()).toHaveLength(0);
  await expect(listener.getByText(/Pickup is at 3:00 PM/).first()).toBeVisible();
  await listen(listener, 'announcement');
  await listener.screenshot({ path: `${dir}/signed-out-listener.png`, fullPage: true });
  await page.getByRole('link', { name: 'Update this announcement', exact: true }).click();
  const text = page.getByLabel('Announcement', { exact: true });
  await text.fill((await text.inputValue()).replace('3:00 PM', '4:00 PM'));
  await expect(page.getByRole('status').filter({ hasText: 'Ready to listen' })).toBeVisible({ timeout: 120000 });
  await listen(page, 'spoken preview');
  await page.getByLabel(/I listened to this preview/).check();
  await page.getByRole('button', { name: 'Update announcement', exact: true }).click();
  await page.waitForURL(/published=2$/, { timeout: 60000, waitUntil: 'domcontentloaded' });
  expect((await page.getByTestId('public-url').innerText()).trim()).toBe(report.listener);
  await listener.reload();
  await expect(listener.getByText(/Pickup is at 4:00 PM/).first()).toBeVisible();
  await listen(listener, 'announcement');
  await listener.screenshot({ path: `${dir}/corrected-listener.png`, fullPage: true });
  // Withdrawal also goes through the publisher controls.
  await page.getByRole('button', { name: /Withdraw/ }).click();
  await expect(page.getByText(/Withdrawn/).first()).toBeVisible();
  await listener.reload();
  await expect(listener.getByText(/withdrawn/i).first()).toBeVisible();
  await expect(listener.locator('audio')).toHaveCount(0);
  for (const event of report.events.filter(event => event.label === 'announcement')) {
    expect((await recipient.request.get(event.src)).status()).toBe(404);
  }
  await listener.screenshot({ path: `${dir}/withdrawn-listener.png`, fullPage: true });
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error);
  report.url = page.url();
  report.screen = (await page.locator('body').innerText().catch(() => '')).slice(-6000);
  report.media = await page.evaluate(() => window.__media).catch(() => null);
  await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ dir, ok: report.ok, error: report.error, listener: report.listener, provider: report.provider, approvals: report.approvals.map(a => a.status) }, null, 2));
}
process.exitCode = report.ok ? 0 : 1;
