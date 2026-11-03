#!/usr/bin/env node
/**
 * Looks for credentials in what is about to be pushed. Two checks, neither of which ever prints a secret:
 *
 * 1. The real values in .env.local (and any file named with --env) are searched for, exactly, in every tracked file and in
 *    the whole git history. A hit reports the variable NAME and the commit count only.
 * 2. Added lines in the commits not yet on the remote are matched against the shapes of common keys (a Postgres URL with a
 *    password, a JWT, a Resend key, an AssemblyAI-style 32-hex key, a private key block).
 *
 * Usage: node scripts/secret-scan.mjs [--base origin/main] [--env .env.local]
 * Exits 1 when anything is found.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = opt("--base", "origin/main");
const envFile = opt("--env", ".env.local");

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const problems = [];

// 1. Exact values.
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DB_URL/i;
if (fs.existsSync(envFile)) {
  const values = [];
  for (const raw of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    const value = m[2].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
    if (SECRET_NAME.test(m[1]) && value.length >= 12) values.push([m[1], value]);
    // A connection string's password on its own is also a secret.
    const pw = /^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/.exec(value)?.[1];
    if (pw && pw.length >= 6) values.push([`${m[1]} (password part)`, decodeURIComponent(pw)]);
  }
  const files = git("ls-files").split("\n").filter(Boolean);
  for (const [name, value] of values) {
    let inTree = false;
    for (const f of files) {
      try {
        if (fs.readFileSync(f, "utf8").includes(value)) {
          inTree = true;
          problems.push(`${name}: its value appears in tracked file ${f}`);
        }
      } catch {
        // binary or removed: skip
      }
    }
    const hits = git("log", "--all", "--oneline", "-S", value).split("\n").filter(Boolean).length;
    if (hits > 0 && !inTree) problems.push(`${name}: its value appears in ${hits} commit(s) of history`);
  }
  console.log(`Checked ${values.length} secret value(s) from ${envFile} against ${files.length} tracked files and all history.`);
} else {
  console.log(`No ${envFile}; skipped the exact-value check.`);
}

// 2. Shapes, in lines added since the base.
const SHAPES = [
  ["Postgres URL with a password", /postgres(?:ql)?:\/\/[^:\s/]+:(?!postgres@|password@|\[|<|\$\{|YOUR|PASSWORD|example)[^@\s\]>]{6,}@(?!127\.0\.0\.1|localhost)/i],
  ["JWT", /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/],
  ["Resend key", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b/],
  ["32-hex key assigned to a key-like name", /(?:API_KEY|SECRET|TOKEN)\s*[=:]\s*["']?[a-f0-9]{32}["']?\b/i],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
let range;
try {
  git("rev-parse", "--verify", base);
  range = `${base}..HEAD`;
} catch {
  range = "HEAD";
}
const patch = git("log", "-p", "--no-color", "--unified=0", range);
for (const line of patch.split("\n")) {
  if (!line.startsWith("+") || line.startsWith("+++")) continue;
  for (const [label, re] of SHAPES) if (re.test(line)) problems.push(`${label} in an added line (${line.slice(1, 40).trim()}…)`);
}
console.log(`Scanned added lines in ${range} for ${SHAPES.length} key shapes.`);

// The env file itself must never be tracked.
if (git("ls-files", ".env.local", ".env", ".env.production").trim()) problems.push("an .env file is tracked by git");

if (problems.length) {
  console.error("\nPROBLEMS:\n" + [...new Set(problems)].map((p) => " - " + p).join("\n"));
  process.exit(1);
}
console.log("No credentials found.");
