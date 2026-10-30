import fs from "node:fs";

/** Reads KEY=value lines the way dotenv (and so Next.js) does: `#` starts a comment, quotes are removed, blanks stay blank. */
export function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = /^(["'])(.*)\1$/.exec(value);
    // Unquoted values end at an inline comment; quoted ones keep everything inside the quotes.
    value = quoted ? quoted[2]! : value.replace(/(^|\s+)#.*$/, "");
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * Loads `.env.local` into process.env for command-line scripts. Next.js does this for the app itself, but `tsx`
 * does not, so a key saved only in `.env.local` would otherwise be invisible to `npm run tts:smoke`. Variables
 * already set in the shell win, and blank values are ignored. Never prints a value.
 */
export function loadLocalEnv(path = ".env.local"): string[] {
  if (!fs.existsSync(path)) return [];
  const loaded: string[] = [];
  for (const [name, value] of Object.entries(parseEnvFile(path))) {
    if (value !== "" && process.env[name] === undefined) {
      process.env[name] = value;
      loaded.push(name);
    }
  }
  return loaded;
}
