import { expect, test, type Browser, type Page } from "@playwright/test";
import { newEmail, signInWithEmail, startGuestViaApi } from "./helpers";

/**
 * There is one public homepage, `/`. These tests drive the navigation the way a visitor does: the same page for a fresh
 * visitor, a returning guest and a signed-in account, section links that land on their section from any page, Back, the one
 * "Create an announcement" button, themes, reduced motion and narrow widths.
 */
const HEADLINE = "One announcement link, even when pickup time changes.";
const SECTIONS = [
  ["How it works", "how"],
  ["FAQ", "faq"],
] as const;
const PAGES = [
  ["Docs", "/docs", "Everything you need to send one link."],
  ["Corrections", "/corrections", "Change the message, not the link."],
  ["Trust", "/trust", "What AfterSend will not claim."],
] as const;

/** Waits for smooth scrolling to finish. */
async function settled(page: Page) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const y = await page.evaluate(() => Math.round(window.scrollY));
    if (y === last) return;
    last = y;
  }
}

const primary = (page: Page) => page.getByRole("navigation", { name: "Primary" });

async function signedInContext(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInWithEmail(page, newEmail());
  return { ctx, page };
}

for (const visitor of ["a fresh visitor", "a returning guest"] as const) {
  test.describe(visitor, () => {
    test("sees the same homepage, and every section link lands on its section", async ({ page }) => {
      if (visitor === "a returning guest") await startGuestViaApi(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
      for (const [name, id] of SECTIONS) {
        await page.goto("/");
        await primary(page).getByRole("link", { name }).click();
        await settled(page);
        await expect(page).toHaveURL(new RegExp(`/#${id}$`));
        const top = await page.evaluate((i) => Math.round(document.getElementById(i)!.getBoundingClientRect().top), id);
        expect(top, `${name} sits under the header`).toBeLessThanOrEqual(100);
        expect(top).toBeGreaterThanOrEqual(0);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
      }
    });

    test("opens Docs, Corrections and Trust from the header", async ({ page }) => {
      if (visitor === "a returning guest") await startGuestViaApi(page);
      for (const [name, path, heading] of PAGES) {
        await page.goto("/");
        await primary(page).getByRole("link", { name, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
      }
    });

    test("opens a section from another page, and Back returns to it", async ({ page }) => {
      if (visitor === "a returning guest") await startGuestViaApi(page);
      await page.goto("/signin");
      await primary(page).getByRole("link", { name: "FAQ" }).click();
      await settled(page);
      await expect(page).toHaveURL(/\/#faq$/);
      await expect(page.getByRole("heading", { name: "Plain answers." })).toBeInViewport();
      await page.goBack();
      await expect(page).toHaveURL(/\/signin$/);
    });

    test("Create an announcement opens an editable draft", async ({ page }) => {
      if (visitor === "a returning guest") {
        const { noticeId } = await startGuestViaApi(page);
        await page.goto("/");
        await page.getByRole("button", { name: "Create an announcement" }).first().click();
        // The same workspace: a new announcement, not a second guest.
        await expect(page).toHaveURL(/\/app\/notices\/new$/);
        await page.getByLabel("Title").fill("Library closed on Monday");
        await page.getByLabel("Announcement", { exact: true }).fill("The library is closed on Monday for repairs. It opens again on Tuesday at 8:00 AM.");
        await page.getByRole("button", { name: "Continue to the spoken preview" }).click();
        await expect(page).toHaveURL(/\/app\/notices\/ntc_[a-f0-9]+\/edit$/);
        await page.goto("/app");
        await expect(page.getByText("Early pickup on Friday")).toBeVisible();
        expect(noticeId).toMatch(/^ntc_/);
      } else {
        await page.goto("/");
        await page.getByRole("button", { name: "Create an announcement" }).first().click();
        await expect(page).toHaveURL(/\/app\/notices\/ntc_[a-f0-9]+\/edit$/);
        await expect(page.getByLabel("Announcement", { exact: true })).toBeEditable();
      }
    });
  });
}

test("a signed-in account sees the same homepage and its button opens a new announcement in the account", async ({ browser }) => {
  const { ctx, page } = await signedInContext(browser);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
  await primary(page).getByRole("link", { name: "How it works" }).click();
  await settled(page);
  await expect(page).toHaveURL(/\/#how$/);
  await page.getByRole("button", { name: "Create an announcement" }).first().click();
  await expect(page).toHaveURL(/\/app\/notices\/new$/);
  await ctx.close();
});

test("the homepage reads in order from the hero to the FAQ and the hero button is above the fold", async ({ page }) => {
  await page.goto("/");
  const ids = await page.evaluate(() => [...document.querySelectorAll("main > section")].map((s) => s.id));
  expect(ids).toEqual(["top", "problem", "correct", "how", "trust", "faq", "start"]);
  const box = await page.getByRole("button", { name: "Create an announcement" }).nth(1).boundingBox();
  expect(box && box.y + box.height).toBeLessThan(900);
});

test("the hero recordings are real files and each plays on request", async ({ page, request }) => {
  await page.goto("/");
  for (const file of ["pickup-3pm.wav", "pickup-4pm.wav"]) {
    const res = await request.get(`/samples/${file}`);
    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(body.subarray(0, 4).toString()).toBe("RIFF");
    expect(body.byteLength).toBeGreaterThan(100_000);
  }
  // Nothing plays by itself.
  expect(await page.evaluate(() => [...document.querySelectorAll("audio")].every((a) => a.paused))).toBe(true);
  await page.getByRole("button", { name: "Play: Hear the corrected 4:00 PM announcement" }).click();
  await expect(page.getByRole("button", { name: "Pause: Hear the corrected 4:00 PM announcement" })).toBeVisible();
  await page.getByRole("button", { name: "Play: Hear the 3:00 PM announcement" }).click();
  // Starting the second clip stops the first.
  await expect(page.getByRole("button", { name: "Play: Hear the corrected 4:00 PM announcement" })).toBeVisible();
});

test("the header menu on a phone is an accessible button that opens and closes the links", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Docs" }).click();
  await settled(page);
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Everything you need to send one link.");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
  await ctx.close();
});

test("no horizontal scroll from 320 px to desktop, in light and dark", async ({ browser }) => {
  for (const scheme of ["light", "dark"] as const) {
    for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme });
      const page = await ctx.newPage();
      for (const route of ["/", "/signin", "/docs", "/corrections", "/trust"]) {
        await page.goto(route);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${route} at ${width}px (${scheme})`).toBeLessThanOrEqual(0);
      }
      await ctx.close();
    }
  }
});

test("the theme choice (system, light, dark) applies and is remembered across the pages", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe("rgb(12, 14, 11)");
  await page.evaluate(() => localStorage.setItem("aftersend-theme", "light"));
  await page.goto("/signin");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  expect(await bg()).toBe("rgb(246, 245, 238)");
});

test("the mark by itself is a drawn speech bubble with two rings, not a letter", async ({ page, request }) => {
  await page.goto("/");
  const mark = page.getByRole("link", { name: "AfterSend home" }).first().locator("svg");
  await expect(mark).toBeVisible();
  expect(await mark.locator("circle").count()).toBe(2);
  const icon = await (await request.get("/icon.svg")).text();
  expect(icon).toContain("<circle");
  expect(icon).not.toContain("M6.5 26");
});
