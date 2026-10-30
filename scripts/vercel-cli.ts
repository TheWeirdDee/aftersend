import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Finds the Vercel CLI's own JavaScript entry point, so it can be run with `node` and no shell. Going through a shell
 * on Windows (npx.cmd) re-parses the arguments, which kept literal quote characters in values passed to `--value`.
 * Set VERCEL_CLI_JS to override.
 */
export function vercelEntry(): string {
  const candidates: string[] = [];
  if (process.env.VERCEL_CLI_JS) candidates.push(process.env.VERCEL_CLI_JS);
  candidates.push(path.resolve("node_modules/vercel/dist/vc.js"));
  const root = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32" });
  if (root.status === 0 && root.stdout.trim()) candidates.push(path.join(root.stdout.trim(), "vercel/dist/vc.js"));
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error("The Vercel CLI was not found. Install it with `npm i -g vercel`, run `vercel login` and `vercel link`, or set VERCEL_CLI_JS.");
  return found;
}

/** Runs a Vercel CLI command with no shell. Output is returned, never printed, because it may name values. */
export function vercel(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [vercelEntry(), ...args], { encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Sets one Production variable, replacing any existing value. The value goes in as a single argument and is never
 * echoed. Secrets are stored as sensitive (write-only) by Vercel's default for Production.
 */
export function setProductionVariable(name: string, value: string): boolean {
  return vercel(["env", "add", name, "production", "--yes", "--force", "--value", value]).ok;
}
