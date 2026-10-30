/**
 * Puts a new database password into DATABASE_URL and MIGRATION_DATABASE_URL, safely.
 *
 *   npm run db:set-password                 # asks for the password with no echo, tests both URLs, then rewrites .env.local
 *   npm run db:set-password -- --vercel     # also sets both on Vercel Production (then redeploy to apply)
 *
 * Run it in your own terminal so the password never passes through a chat or a shell history. It percent-encodes the
 * password, connects with both URLs, and changes .env.local only if both connections work. It never prints the
 * password or a connection string. Piped input also works: `... | npm run db:set-password`.
 */
import fs from "node:fs";
import { appClient } from "../src/lib/db/connection";
import { withPassword } from "./db-password";
import { parseEnvFile } from "./env-file";
import { setProductionVariable } from "./vercel-cli";

const NAMES = ["DATABASE_URL", "MIGRATION_DATABASE_URL"] as const;
const file = ".env.local";

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  }
  process.stdout.write("New database password (input is hidden): ");
  return new Promise((resolve) => {
    let typed = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(typed);
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
        else typed += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function reaches(url: string): Promise<boolean> {
  const sql = appClient(url, 1, process.env.DATABASE_SSL);
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function main() {
  if (!fs.existsSync(file)) throw new Error(`${file} not found. Copy .env.example to .env.local first.`);
  const current = parseEnvFile(file);
  for (const n of NAMES) if (!current[n]) throw new Error(`${n} is empty in ${file}; paste the connection string from the Supabase dashboard (Connect) first.`);

  const password = await readPassword();
  if (password.length < 8) throw new Error("That password is shorter than 8 characters; nothing was changed.");

  const next = Object.fromEntries(NAMES.map((n) => [n, withPassword(current[n]!, password)])) as Record<(typeof NAMES)[number], string>;
  for (const n of NAMES) {
    const ok = await reaches(next[n]);
    console.log(`${ok ? "PASS" : "FAIL"}  ${n} connects with the new password`);
    if (!ok) throw new Error("A connection failed, so nothing was changed. Check the password in the Supabase dashboard (Project Settings, Database).");
  }

  const lines = fs.readFileSync(file, "utf8").split(/(\r?\n)/);
  for (const n of NAMES) {
    const i = lines.findIndex((l) => l.startsWith(`${n}=`));
    lines[i] = `${n}=${next[n]}`;
  }
  fs.writeFileSync(file, lines.join(""));
  console.log(`Updated ${NAMES.join(" and ")} in ${file}.`);

  if (process.argv.includes("--vercel")) {
    for (const n of NAMES) console.log(`${setProductionVariable(n, next[n]) ? "set   " : "FAILED"} ${n} on Vercel Production`);
    console.log("Redeploy for production to use them.");
  } else {
    console.log("Vercel still has the old password. Run again with --vercel, or use `npm run env:sync -- --apply`.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
