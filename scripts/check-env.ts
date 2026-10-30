/**
 * Checks a production environment before deploying. It reads variable NAMES and VALUES only to judge them and never
 * prints a value.
 *
 *   npm run check:env                                  # the current process environment
 *   npm run check:env -- --file .env.production.local  # a file, e.g. from `vercel env pull .env.production.local`
 *
 * Exit code 0 only when there are no problems. Warnings do not fail the check.
 */
import fs from "node:fs";
import { checkProductionConfig } from "../src/lib/config-check";
import { parseEnvFile } from "./env-file";

const args = process.argv.slice(2);
const fileIndex = args.indexOf("--file");
let env: Record<string, string | undefined> = process.env;
if (fileIndex >= 0) {
  const path = args[fileIndex + 1];
  if (!path || !fs.existsSync(path)) {
    console.error(`File not found: ${path ?? "(none given)"}`);
    process.exit(2);
  }
  // Blank values mean "unset", exactly as the application treats them.
  env = Object.fromEntries(Object.entries(parseEnvFile(path)).filter(([, v]) => v !== ""));
  console.log(`Checking ${path} (${Object.keys(env).length} variables set)`);
}

const { problems, warnings } = checkProductionConfig(env);
for (const w of warnings) console.log(`WARN  ${w}`);
for (const p of problems) console.log(`FAIL  ${p}`);
if (problems.length === 0) console.log("PASS  no production configuration problems found.");
console.log(`\n${problems.length} problem(s), ${warnings.length} warning(s).`);
process.exit(problems.length === 0 ? 0 : 1);
