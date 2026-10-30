import { expect, test, type Page } from "@playwright/test";
import { generateListenApprove, publicUrl, startDemo, versionOf } from "./helpers";

/**
 * Browser journeys for caching, autosave ordering, concurrent editing, failure recovery and the listening
 * gate. Speech is the labelled test-tone provider, so these prove application behaviour, not AssemblyAI output.
 * Tests marked "mocked status" fake the status endpoint to reach states that are slow or hard to produce.
 */

async function publishFirst(page: Page) {
  await startDemo(page);
  const noticeId = page.url().match(/ntc_[a-f0-9]+/)![0];
  await generateListenApprove(page, /Approve and publish/);
  return { noticeId, url: await publicUrl(page) };
}

const jsonHeaders = (page: Page) => ({ Origin: new URL(page.url()).origin, "Content-Type": "application/json" });

/** Corrects a published notice through the API: draft, preview, approve. */
async function correctViaApi(page: Page, noticeId: string, from: string, to: string) {
  const headers = jsonHeaders(page);
  const detail = await (await page.request.get(`/api/notices/${noticeId}`)).json();
  const created = await (
    await page.request.post(`/api/notices/${noticeId}/revisions`, { headers, data: { text: (detail.current.displayText as string).replace(from, to) } })
  ).json();
  expect((await page.request.post(`/api/revisions/${created.revisionId}/generate`, { headers })).status()).toBe(200);
  const version = await versionOf(page, created.revisionId);
  const done = await page.request.post(`/api/revisions/${created.revisionId}/approve`, { headers, data: { confirmedCriticalFacts: true, expectedVersion: version } });
  expect(done.status()).toBe(200);
  return created.revisionId as string;
}

const openCorrection = (page: Page) => page.getByRole("link", { name: /Correct this notice/ }).click();
const statusOfFetch = (page: Page, url: string) => page.evaluate(async (u) => (await fetch(u)).status, url);

test("a browser that already holds the audio does not get it after a correction or a withdrawal", async ({ page, context }) => {
  const { noticeId, url } = await publishFirst(page);
  const listener = await context.newPage();
  await listener.goto(url);
  const pageHeaders = (await listener.request.get(url)).headers();
  expect(pageHeaders["cache-control"]).toContain("no-store");

  const audio1 = (await listener.locator("audio").getAttribute("src"))!;
  expect(await statusOfFetch(listener, audio1)).toBe(200);
  expect(await statusOfFetch(listener, audio1)).toBe(200); // now in the browser's own HTTP cache

  await correctViaApi(page, noticeId, "3:00 PM", "4:00 PM");
  // Under the old year-long `immutable` policy this answered 200 from the cache without asking the server.
  expect(await statusOfFetch(listener, audio1)).toBe(404);

  await listener.reload();
  const audio2 = (await listener.locator("audio").getAttribute("src"))!;
  expect(audio2).not.toBe(audio1);
  await expect(listener.getByTestId("notice-text")).toContainText("4:00 PM");
  expect(await statusOfFetch(listener, audio2)).toBe(200);
  expect(await statusOfFetch(listener, audio2)).toBe(200);

  const headers = jsonHeaders(page);
  expect((await page.request.post(`/api/notices/${noticeId}/withdraw`, { headers })).status()).toBe(200);
  expect(await statusOfFetch(listener, audio2)).toBe(404); // cached by this browser, refused by the server
  await listener.reload();
  await expect(listener.getByText("This notice has been withdrawn by its publisher.")).toBeVisible();
  await expect(listener.locator("audio")).toHaveCount(0);

  // Navigating away and back must not resurrect the withdrawn notice's player.
  await listener.goto("/");
  await listener.goBack();
  await expect(listener.getByText("This notice has been withdrawn by its publisher.")).toBeVisible();
  await expect(listener.locator("audio")).toHaveCount(0);
});

test("the listener link follows repeated corrections and shows only the newest version", async ({ page, context }) => {
  const { noticeId, url } = await publishFirst(page);
  const listener = await context.newPage();
  await listener.goto(url);
  const sources = [(await listener.locator("audio").getAttribute("src"))!];
  for (const [from, to] of [["3:00 PM", "4:00 PM"], ["4:00 PM", "4:30 PM"]]) {
    await correctViaApi(page, noticeId, from!, to!);
    await listener.goto(url);
    sources.push((await listener.locator("audio").getAttribute("src"))!);
    await expect(listener.getByTestId("revised-banner")).toBeVisible();
  }
  await expect(listener.getByTestId("notice-text")).toContainText("4:30 PM");
  await expect(listener.getByTestId("notice-text")).not.toContainText("3:00 PM");
  expect(sources).toHaveLength(3);
  expect(new Set(sources).size).toBe(3);
  expect(await Promise.all(sources.map((s) => statusOfFetch(listener, s)))).toEqual([404, 404, 200]);
  await expect(listener.locator("[data-revision='3']")).toHaveCount(1);
});

test("autosave sends one request at a time, newest last, and does not claim 'saved' early", async ({ page }) => {
  await startDemo(page);
  const sent: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  await page.route(/\/api\/revisions\/rev_[a-f0-9]+$/, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    sent.push(JSON.parse(route.request().postData()!).text as string);
    if (sent.length === 1) await new Promise((r) => setTimeout(r, 1500)); // the first save is slow
    const response = await route.fetch();
    inFlight--;
    await route.fulfill({ response });
  });

  const text = page.getByLabel("Notice text");
  const base = await text.inputValue();
  await text.fill(`${base}\nEdit A.`);
  await expect.poll(() => sent.length).toBe(1); // debounce fired, first request is now stuck in the slow path
  await text.fill(`${base}\nEdit B.`);
  await expect(page.getByText("Draft saved")).toHaveCount(0); // a newer edit is waiting: not saved yet

  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 15_000 });
  expect(sent).toHaveLength(2);
  expect(sent[0]).toContain("Edit A.");
  expect(sent[1]).toContain("Edit B.");
  expect(maxInFlight).toBe(1);

  const noticeId = page.url().match(/ntc_[a-f0-9]+/)![0];
  const detail = await (await page.request.get(`/api/notices/${noticeId}`)).json();
  expect(detail.revisions[0].displayText).toContain("Edit B.");
  expect(detail.revisions[0].displayText).not.toContain("Edit A.");
});

test("a slow first save of a correction cannot create a second draft", async ({ page }) => {
  const { noticeId } = await publishFirst(page);
  await openCorrection(page);
  let creates = 0;
  await page.route(/\/api\/notices\/ntc_[a-f0-9]+\/revisions$/, async (route) => {
    creates++;
    if (creates === 1) await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const text = page.getByLabel("Notice text");
  await text.fill((await text.inputValue()).replace("3:00 PM", "4:00 PM"));
  await expect.poll(() => creates).toBe(1);
  await text.fill((await text.inputValue()).replace("4:00 PM", "4:15 PM")); // typed while the create is in flight
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 15_000 });

  const detail = await (await page.request.get(`/api/notices/${noticeId}`)).json();
  const drafts = detail.revisions.filter((r: { status: string }) => r.status === "draft");
  expect(drafts).toHaveLength(1);
  expect(drafts[0].displayText).toContain("4:15 PM");
  expect(creates).toBe(1);
});

test("a lost response to creating a draft is retried without duplicating it", async ({ page }) => {
  const { noticeId } = await publishFirst(page);
  await openCorrection(page);
  let creates = 0;
  await page.route(/\/api\/notices\/ntc_[a-f0-9]+\/revisions$/, async (route) => {
    creates++;
    if (creates === 1) {
      await route.fetch(); // the server creates the draft...
      return route.abort("connectionreset"); // ...but the browser never hears about it
    }
    await route.continue();
  });
  const text = page.getByLabel("Notice text");
  await text.fill((await text.inputValue()).replace("3:00 PM", "4:00 PM"));
  await expect(page.getByText(/Not saved/)).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();

  const detail = await (await page.request.get(`/api/notices/${noticeId}`)).json();
  expect(detail.revisions.filter((r: { status: string }) => r.status === "draft")).toHaveLength(1);
  expect(creates).toBe(2);
});

test("editing in a second tab is detected, shown, and recoverable without losing either side", async ({ page, context }) => {
  const { noticeId } = await publishFirst(page);
  await openCorrection(page);
  const one = page.getByLabel("Notice text");
  const original = await one.inputValue();
  await one.fill(original.replace("3:00 PM", "4:00 PM"));
  await expect(page.getByText("Draft saved")).toBeVisible();

  const second = await context.newPage();
  await second.goto(`/app/notices/${noticeId}/edit`); // resumes the same draft at its current version
  const two = second.getByLabel("Notice text");
  await expect(two).toHaveValue(original.replace("3:00 PM", "4:00 PM"));

  await one.fill(original.replace("3:00 PM", "4:15 PM"));
  await expect(page.getByText("Draft saved")).toBeVisible();

  await two.fill(original.replace("3:00 PM", "9:99 PM stale tab"));
  const dialog = second.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This draft changed somewhere else");
  await expect(second.getByText(/Conflict: not saved/)).toBeVisible();

  const server = async () => (await (await page.request.get(`/api/notices/${noticeId}`)).json()).revisions.find((r: { status: string }) => r.status === "draft").displayText as string;
  expect(await server()).toContain("4:15 PM"); // the stale tab did not overwrite it
  expect(await server()).not.toContain("stale tab");

  // Keyboard containment: focus never leaves the dialog, and Escape closes it and returns focus.
  for (let i = 0; i < 6; i++) {
    await second.keyboard.press("Tab");
    expect(await second.evaluate(() => document.activeElement?.closest("[role='alertdialog']") !== null)).toBe(true);
  }
  await second.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(two).toBeFocused();

  // Recovering: save the stale tab's text on purpose.
  await two.fill(original.replace("3:00 PM", "5:00 PM"));
  await expect(dialog).toBeVisible();
  await second.getByRole("button", { name: "Save my edits over it" }).click();
  await expect(second.getByText("Draft saved")).toBeVisible();
  expect(await server()).toContain("5:00 PM");
});

test("another tab publishing the draft is reported when this tab tries to save", async ({ page, context }) => {
  const { noticeId } = await publishFirst(page);
  await openCorrection(page);
  const text = page.getByLabel("Notice text");
  const original = await text.inputValue();
  await text.fill(original.replace("3:00 PM", "4:00 PM"));
  await expect(page.getByText("Draft saved")).toBeVisible();
  const draftId = (await (await page.request.get(`/api/notices/${noticeId}`)).json()).revisions.find((r: { status: string }) => r.status === "draft").id as string;

  const headers = jsonHeaders(page);
  await page.request.post(`/api/revisions/${draftId}/generate`, { headers });
  const version = await versionOf(page, draftId);
  expect((await page.request.post(`/api/revisions/${draftId}/approve`, { headers, data: { confirmedCriticalFacts: true, expectedVersion: version } })).status()).toBe(200);

  await text.fill(original.replace("3:00 PM", "4:30 PM"));
  await expect(page.getByRole("alertdialog")).toContainText("can no longer be edited");
  const live = await (await page.request.get(`/api/notices/${noticeId}`)).json();
  expect(live.current.displayText).toContain("4:00 PM"); // the approved text is untouched
  void context;
});

test("a failed synthesis and a dropped connection are visible, and the draft recovers", async ({ page, context }) => {
  const { noticeId, url } = await publishFirst(page);
  await openCorrection(page);
  const text = page.getByLabel("Notice text");
  const original = await text.inputValue();
  const corrected = original.replace("3:00 PM", "4:00 PM");

  // Provider failure (test-only fault marker): visible, retryable, live version untouched.
  await text.fill(`${corrected} [[fail-synthesis]]`);
  await expect(page.getByText("Draft saved")).toBeVisible();
  await page.getByRole("button", { name: /Generate preview/ }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "Audio generation failed" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("generate again to retry")).toBeVisible();
  const listener = await context.newPage();
  await listener.goto(url);
  await expect(listener.getByTestId("notice-text")).toContainText("3:00 PM");

  // Connection drops while editing: the page says so and offers a retry, and refuses to generate meanwhile.
  let generated = 0;
  await page.route(/\/api\/revisions\/rev_[a-f0-9]+\/generate$/, (route) => {
    generated++;
    return route.continue();
  });
  await page.route(/\/api\/revisions\/rev_[a-f0-9]+$/, (route) => (route.request().method() === "PATCH" ? route.abort("internetdisconnected") : route.continue()));
  await text.fill(`${corrected} Bring water.`);
  await expect(page.getByText(/Not saved/)).toBeVisible();
  await expect(page.locator("p[role='alert']")).toContainText("Can't reach AfterSend");
  await page.getByRole("button", { name: /Generate preview/ }).first().click();
  await expect(page.getByText(/Not saved/)).toBeVisible();
  expect(generated).toBe(0);

  // Connection returns: retry saves, and generation then succeeds and publishes.
  await page.unroute(/\/api\/revisions\/rev_[a-f0-9]+$/);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();
  await generateListenApprove(page, /Approve update/);
  await listener.reload();
  await expect(listener.getByTestId("notice-text")).toContainText("4:00 PM");
  await expect(listener.getByTestId("notice-text")).toContainText("Bring water.");
  void noticeId;
});

test("mocked status: a reopened page follows work in progress and offers recovery when it stalls", async ({ page }) => {
  await startDemo(page);
  const statusUrl = /\/api\/revisions\/rev_[a-f0-9]+\/status$/;
  let calls = 0;
  await page.route(statusUrl, async (route) => {
    calls++;
    const real = await (await route.fetch()).json();
    if (calls <= 3) {
      return route.fulfill({ json: { ...real, status: "synthesizing", synthesis: { claimedAgoMs: 4000, staleAfterMs: 65000 } } });
    }
    return route.fulfill({ json: real });
  });
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Synthesizing audio" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate preview/ }).first()).toBeDisabled(); // busy: inputs locked while work is live
  // Polling moves on by itself once the server says the work is over.
  await expect(page.getByRole("status").filter({ hasText: "No audio generated yet" })).toBeVisible({ timeout: 15_000 });
  expect(calls).toBeGreaterThan(3);

  await page.unroute(statusUrl);
  await page.route(statusUrl, async (route) => {
    const real = await (await route.fetch()).json();
    return route.fulfill({ json: { ...real, status: "synthesizing", synthesis: { claimedAgoMs: 120000, staleAfterMs: 65000 } } });
  });
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Generation stalled" })).toBeVisible();
  await expect(page.getByText("seems to have stalled")).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate preview/ }).first()).toBeEnabled();
});

test("approval waits until the whole preview has been played, and skipping ahead does not count", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: /Generate preview/ }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Ready to preview" })).toBeVisible({ timeout: 30_000 });
  const confirm = page.getByLabel(/I listened to the preview/);
  await expect(confirm).toBeDisabled();
  await expect(page.getByTestId("listen-progress")).toContainText("play it through");

  const audio = page.locator("audio");
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Play audio preview" }).click();
  await page.waitForTimeout(500);
  await expect(confirm).toBeDisabled(); // pressing play is not listening

  // Jump to the last moments and let it finish: only a fraction has been played.
  await audio.evaluate((a: HTMLAudioElement) => {
    a.currentTime = Math.max(0, a.duration - 0.4);
  });
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.ended)).toBe(true);
  await expect(confirm).toBeDisabled();

  // Playing it from the start through to the end opens the gate.
  await audio.evaluate((a: HTMLAudioElement) => {
    a.currentTime = 0;
    void a.play();
  });
  await expect(confirm).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByTestId("listen-progress")).toContainText("Listened to the whole preview");
});

test("an ambiguous date is flagged on the control that holds it and blocks generation", async ({ page }) => {
  await startDemo(page);
  const title = page.getByLabel("Title");
  await title.fill("Trip on 05/06/26");
  const problem = page.locator("#title-problem");
  await expect(problem).toContainText("05/06/26");
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toHaveAttribute("aria-describedby", "title-problem");
  await expect(page.getByRole("button", { name: /Generate preview/ }).first()).toBeDisabled();
  await title.fill("Trip on 5 June 2026");
  await expect(problem).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Generate preview/ }).first()).toBeEnabled();

  const text = page.getByLabel("Notice text");
  await text.fill("Lunch is on 31/02/2026.");
  await expect(page.locator("#text-problem")).toContainText("not on the calendar");
  await expect(page.getByRole("button", { name: /Generate preview/ }).first()).toBeDisabled();
});

test("security: other workspaces, anonymous visitors and drafts see nothing they should not", async ({ page, browser }) => {
  const { noticeId, url } = await publishFirst(page);
  const detail = await (await page.request.get(`/api/notices/${noticeId}`)).json();
  const revisionId = detail.current.id as string;
  const headers = jsonHeaders(page);

  // An unpublished notice has no public face at all.
  await page.goto("/app/notices/new");
  const created = await (
    await page.request.post("/api/notices", { headers, data: { title: "Draft only", text: "Meeting at 10:00 AM.", voiceId: "test-tone" } })
  ).json();
  const draftDetail = await (await page.request.get(`/api/notices/${created.noticeId}`)).json();
  const draftToken = draftDetail.notice.publicToken as string;
  const anon = await browser.newContext();
  expect((await anon.request.get(`/n/${draftToken}`)).status()).toBe(404);
  expect((await anon.request.get(`/api/public/${draftToken}/current`)).status()).toBe(404);
  const draftStaged = await (await page.request.post(`/api/revisions/${created.revisionId}/generate`, { headers })).status();
  expect(draftStaged).toBe(200);
  const stagedStatus = await (await page.request.get(`/api/revisions/${created.revisionId}/status`)).json();
  expect(stagedStatus.audio.sha256).toBeTruthy();
  expect((await anon.request.get(`/api/public/${draftToken}/audio/${created.revisionId}/${stagedStatus.audio.sha256}.wav`)).status()).toBe(404);

  // Anonymous visitors cannot reach any workspace API.
  for (const path of ["/api/notices", `/api/notices/${noticeId}`, `/api/revisions/${revisionId}/status`, `/api/revisions/${revisionId}/audio`]) {
    expect((await anon.request.get(path)).status(), path).toBe(401);
  }
  // The published page is public and carries no workspace identifiers.
  const publicHtml = await (await anon.request.get(url)).text();
  expect(publicHtml).not.toContain("usr_");
  expect(publicHtml).not.toContain(noticeId);

  // A second workspace cannot read, edit, generate, approve, discard or withdraw the first one's work.
  const other = await browser.newContext();
  const intruder = await other.newPage();
  await intruder.goto("/demo");
  await intruder.getByRole("button", { name: "Start the demo" }).click();
  await expect(intruder).toHaveURL(/\/edit$/);
  const h = jsonHeaders(intruder);
  const attempts = [
    intruder.request.get(`/api/revisions/${revisionId}/status`),
    intruder.request.get(`/api/revisions/${revisionId}/audio`),
    intruder.request.patch(`/api/revisions/${revisionId}`, { headers: h, data: { text: "hijack" } }),
    intruder.request.delete(`/api/revisions/${revisionId}`, { headers: h }),
    intruder.request.post(`/api/revisions/${revisionId}/generate`, { headers: h }),
    intruder.request.post(`/api/revisions/${revisionId}/approve`, { headers: h, data: { confirmedCriticalFacts: true, expectedVersion: 1 } }),
    intruder.request.post(`/api/notices/${noticeId}/withdraw`, { headers: h }),
  ];
  for (const res of await Promise.all(attempts)) expect(res.status()).toBe(404);
  const after = await (await page.request.get(`/api/notices/${noticeId}`)).json();
  expect(after.notice.state).toBe("published");
  expect(after.current.displayText).toBe(detail.current.displayText);

  await other.close();
  await anon.close();
});

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`no horizontal overflow at ${width}px on the landing, editor and listener pages`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.goto("/");
    expect(await overflow()).toBeLessThanOrEqual(0);
    await startDemo(page);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await generateListenApprove(page, /Approve and publish|Publish/);
    const url = await publicUrl(page);
    await page.goto(url);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}

test("the mobile menu opens, is keyboard operable and closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Open menu" });
  await expect(page.locator("#mobile-nav")).toBeHidden();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#mobile-nav")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.locator("#mobile-nav")).toBeHidden();
});
