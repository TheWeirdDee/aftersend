/**
 * Copies a local env file to Vercel's Production environment, refusing anything that would start the app broken.
 *
 *   npm run env:sync -- --app-url https://your-domain          # dry run: checks everything, lists names, changes nothing
 *   npm run env:sync -- --app-url https://your-domain --apply  # sets the variables, then you redeploy
 *
 * Before it touches Vercel it runs the same production checks as `npm run check:env` on the exact values it would
 * send, and it refuses a file with an inline "# comment" (which Vercel would store as part of the value). It never
 * prints a value. It does not deploy.
 */
import fs from "node:fs";
import { checkProductionConfig } from "../src/lib/config-check";
import { inlineCommentNames, parseEnvFile } from "./env-file";
import { setProductionVariable } from "./vercel-cli";

/** Local-only settings and test switches that must never reach production. */
const NEVER_SYNC = new Set(["LOCAL_STORAGE_DIR", "EMAIL_OUTBOX_DIR", "PGLITE_DIR", "AFTERSEND_ALLOW_TEST_PROVIDER", "AFTERSEND_ALLOW_TEST_EMAIL", "AFTERSEND_INSECURE_COOKIES"]);
/** Only needed for the S3 driver. */
const S3_ONLY = new Set(["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_REGION", "OBJECT_STORAGE_ACCESS_KEY", "OBJECT_STORAGE_SECRET_KEY"]);

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const val = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = val("--file") ?? ".env.local";
const apply = flag("--apply");

if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(2);
}

const values = Object.fromEntries(Object.entries(parseEnvFile(file)).filter(([, v]) => v !== ""));
const appUrl = val("--app-url");
if (appUrl) values.APP_URL = appUrl;

const outgoing = Object.entries(values).filter(([name]) => !NEVER_SYNC.has(name) && (values.STORAGE_DRIVER === "s3" || !S3_ONLY.has(name)));
const payload = Object.fromEntries(outgoing);

const problems = [
  ...inlineCommentNames(file).map((n) => `${n} has an inline "# comment" in ${file}; move the comment to its own line.`),
  ...checkProductionConfig(payload).problems,
];
if (!payload.APP_URL) problems.push("APP_URL is not set: pass --app-url https://your-domain.");

console.log(`${apply ? "Applying" : "Dry run of"} ${outgoing.length} Production variables from ${file}:`);
console.log(outgoing.map(([n]) => n).join(", "));
if (problems.length > 0) {
  for (const p of problems) console.log(`FAIL  ${p}`);
  console.log(`\nRefusing: ${problems.length} problem(s). Nothing was sent.`);
  process.exit(1);
}
if (!apply) {
  console.log("\nPASS  checks clean. Run again with --apply to set them on Vercel, then redeploy.");
  process.exit(0);
}

let failed = 0;
for (const [name, value] of outgoing) {
  const ok = setProductionVariable(name, value);
  if (!ok) failed++;
  console.log(`${ok ? "set   " : "FAILED"} ${name}`);
}
console.log(failed === 0 ? "\nAll variables set. A deployment made before this does not see them: redeploy to apply." : `\n${failed} variable(s) failed to set.`);
process.exit(failed === 0 ? 0 : 1);
