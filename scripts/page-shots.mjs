#!/usr/bin/env node
/**
 * Screenshots a path at several widths and themes, and reports horizontal overflow at each:
 *
 *   node scripts/page-shots.mjs http://localhost:3100 evidence/navigation/after home 320,390,1440 light,dark   (route "home" is /; others are given without the leading slash)
 *
 * Arguments: base URL, output directory, path, widths, themes (light, dark, or system, which follows the browser's colour scheme).
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [base, out, routeArg = "home", widthsArg = "390,1440", themesArg = "light"] = process.argv.slice(2);
const route = routeArg === "home" ? "/" : "/" + routeArg.replace(/^\/+/, "");
fs.mkdirSync(out, { recursive: true });
const slug = route === "/" ? "home" : route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
const browser = await chromium.launch();
for (const theme of themesArg.split(",")) {
  for (const w of widthsArg.split(",").map(Number)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 700 ? 800 : 900 }, colorScheme: theme === "dark" ? "dark" : "light" });
    const page = await ctx.newPage();
    await page.goto(base + route, { waitUntil: "networkidle" });
    if (theme === "light" || theme === "dark") await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const file = path.join(out, `${slug}-${theme}-${w}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${file} overflow=${overflow}px`);
    await ctx.close();
  }
}
await browser.close();
