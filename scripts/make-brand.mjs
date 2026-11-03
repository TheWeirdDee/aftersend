#!/usr/bin/env node
/**
 * Renders the brand files from the one mark drawing (src/components/logo.tsx): the favicon sizes, the Apple touch icon and
 * the social image, plus a proof sheet that shows the mark by itself at 16 and 24 px on light, dark and white backgrounds.
 *
 *   node scripts/make-brand.mjs
 *
 * Writes public/icon.svg, public/icon-32.png, public/apple-icon.png, public/og.png and docs/screenshots/brand-mark.png.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BUBBLE = "M10 2H22A8 8 0 0 1 30 10V16A8 8 0 0 1 22 24H15L10 29.5V24A8 8 0 0 1 2 16V10A8 8 0 0 1 10 2Z";
const LIGHT = { tile: "#14170f", a: "#f6f5ee", b: "#d4f36b" };
const DARK = { tile: "#d4f36b", a: "#0c0e0b", b: "#0c0e0b" };

const mark = (c, size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">
<path d="${BUBBLE}" fill="${c.tile}"/>
<circle cx="12.2" cy="13" r="5.4" fill="none" stroke="${c.a}" stroke-width="2.7"/>
<path d="M17.3 8.4A5.4 5.4 0 1 1 17.3 17.6" fill="none" stroke="${c.tile}" stroke-width="4.3"/>
<circle cx="19.8" cy="13" r="5.4" fill="none" stroke="${c.b}" stroke-width="2.7"/>
</svg>`;

fs.writeFileSync("public/icon.svg", mark(LIGHT, 32).replace(' width="32" height="32"', "") + "\n");

const font = pathToFileURL(path.resolve("node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2")).href;
const css = `@font-face{font-family:"IT";src:url("${font}");font-weight:100 900}
*{box-sizing:border-box}body{margin:0;font-family:"IT",system-ui,sans-serif}`;
const tmp = path.resolve(".data", "brand.html");
fs.mkdirSync(path.dirname(tmp), { recursive: true });

const browser = await chromium.launch();
async function shot(html, out, w, h, opts = {}) {
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>${css}</style>${html}`);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: opts.scale ?? 1 });
  await page.goto(pathToFileURL(tmp).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, omitBackground: !!opts.transparent });
  await page.close();
}

// Favicon and touch icon: the mark on a flat square so it survives rounding by each platform.
await shot(`<div style="width:32px;height:32px;display:grid;place-items:center">${mark(LIGHT, 32)}</div>`, "public/icon-32.png", 32, 32, { transparent: true });
await shot(`<div style="width:180px;height:180px;background:#14170f;display:grid;place-items:center">${mark({ tile: "#d4f36b", a: "#14170f", b: "#14170f" }, 118)}</div>`, "public/apple-icon.png", 180, 180);

// Social image.
await shot(
  `<div style="width:1200px;height:630px;background:#f6f5ee;color:#14170f;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:16px">${mark(LIGHT, 64)}<span style="font-size:40px;font-weight:600;letter-spacing:-0.04em">AfterSend</span></div>
    <div style="font-size:92px;line-height:1.02;font-weight:600;letter-spacing:-0.05em;max-width:1000px">One announcement link, even when <span style="background:linear-gradient(#d4f36b,#d4f36b) no-repeat 0 88%/100% .52em">pickup time changes.</span></div>
    <div style="display:flex;gap:20px;align-items:center;font-size:30px;color:#4e5247"><span><s style="color:#a42f1d">3:00 PM</s> &rarr; <b style="color:#14170f">4:00 PM</b></span><span>&middot;</span><span>The same link, spoken again.</span></div>
  </div>`,
  "public/og.png",
  1200,
  630,
);

// Proof sheet: the mark alone at 16 and 24 px (and larger for reference), on each background it is used on.
const row = (bg, c) => `<div style="background:${bg};padding:18px 24px;display:flex;gap:28px;align-items:center">${[16, 24, 32, 64, 128].map((s) => mark(c, s)).join("")}</div>`;
fs.mkdirSync("docs/screenshots", { recursive: true });
await shot(`<div style="width:480px">${row("#f6f5ee", LIGHT)}${row("#0c0e0b", DARK)}${row("#ffffff", LIGHT)}</div>`, "docs/screenshots/brand-mark.png", 480, 216, { scale: 2 });

await browser.close();
fs.rmSync(tmp, { force: true });
console.log("Wrote public/icon.svg, icon-32.png, apple-icon.png, og.png and docs/screenshots/brand-mark.png");
