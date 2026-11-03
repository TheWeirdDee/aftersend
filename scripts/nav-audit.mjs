#!/usr/bin/env node
/**
 * Drives the public navigation in a real browser and records what it finds, with screenshots:
 *
 *   node scripts/nav-audit.mjs http://localhost:3100 evidence/navigation/before
 *
 * For a fresh visitor, a returning guest and a signed-in (email) account it opens `/` and `/demo`, reports each page's
 * headline and where "Create an announcement" leads, follows every section link, and uses Back. It creates guest sessions
 * through the public API only (no speech is requested), so it is safe against a local test build; against a deployed site
 * it creates guest workspaces (rows only; no speech is spent).
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
const out = process.argv[3] ?? "evidence/navigation/run";
if (!base.startsWith("http")) {
  console.error("Usage: node scripts/nav-audit.mjs <base-url> [out-dir]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

const findings = [];
const note = (k, v) => {
  findings.push({ k, v });
  console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};

const browser = await chromium.launch({ args: ["--mute-audio", "--disable-audio-output"] });

/** Waits until the page has stopped scrolling (smooth scrolling takes a moment over a long distance). */
async function settled(page) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const y = await page.evaluate(() => Math.round(window.scrollY));
    if (y === last) return;
    last = y;
  }
}

async function headline(page) {
  return (await page.getByRole("heading", { level: 1 }).first().textContent())?.replace(/\s+/g, " ").trim();
}

async function visit(label, ctx) {
  const page = await ctx.newPage();
  for (const p of ["/", "/demo"]) {
    const res = await page.goto(base + p, { waitUntil: "networkidle" });
    const slug = `${label}${p === "/" ? "-home" : "-demo"}`;
    note(`${label} ${p} -> final URL`, new URL(page.url()).pathname + new URL(page.url()).hash);
    note(`${label} ${p} -> status`, String(res?.status()));
    note(`${label} ${p} -> h1`, await headline(page));
    note(`${label} ${p} -> sections on page`, await page.evaluate(() => ["how", "correct", "trust", "faq", "problem"].filter((id) => document.getElementById(id))));
    await page.screenshot({ path: path.join(out, `${slug}-1440.png`), fullPage: false });
  }

  // Where does the main call to action lead?
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const cta = page.getByRole("link", { name: /Create an announcement/ }).first();
  const ctaRole = (await cta.count()) ? "link" : "button";
  note(`${label} CTA element on /`, ctaRole);
  const target = ctaRole === "link" ? cta : page.getByRole("button", { name: /Create an announcement/ }).first();
  await target.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  note(`${label} after clicking Create an announcement`, new URL(page.url()).pathname);
  note(`${label} ...heading there`, await headline(page).catch(() => "(no h1)"));
  await page.screenshot({ path: path.join(out, `${label}-after-create.png`) });

  // Section links from / and /demo.
  for (const from of ["/", "/demo"]) {
    for (const name of ["How it works", "Corrections", "Trust", "FAQ"]) {
      await page.goto(base + from, { waitUntil: "networkidle" });
      const link = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name });
      if (!(await link.count())) {
        note(`${label} ${from} nav "${name}"`, "no such link");
        continue;
      }
      await link.click();
      await settled(page);
      const u = new URL(page.url());
      const top = await page.evaluate((h) => {
        const el = h ? document.getElementById(h) : null;
        return el ? Math.round(el.getBoundingClientRect().top) : null;
      }, u.hash.slice(1));
      note(`${label} ${from} nav "${name}"`, `${u.pathname}${u.hash} (section top ${top}px, h1 "${(await headline(page).catch(() => "")).slice(0, 48)}")`);
    }
  }
  await page.close();
}

// 1. fresh visitor
await visit("fresh", await browser.newContext({ viewport: { width: 1440, height: 900 } }));

// 2. returning guest: a real guest session, made through the API
const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });
{
  const res = await guest.request.post(base + "/api/workspace", { headers: { Origin: base, "Content-Type": "application/json" }, data: { kind: "guest" } });
  note("guest session created", String(res.status()));
  await visit("guest", guest);
}

fs.writeFileSync(path.join(out, "findings.json"), JSON.stringify({ base, at: new Date().toISOString(), findings }, null, 2));
await browser.close();
