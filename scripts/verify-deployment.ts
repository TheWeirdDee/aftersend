/**
 * Checks a deployed AfterSend instance from the outside. It never prints a secret, sends no sign-in email and makes
 * no billable speech request. Exit code 0 only if every check passed.
 *
 *   npx tsx scripts/verify-deployment.ts https://your-app.vercel.app
 *   npx tsx scripts/verify-deployment.ts https://your-app.vercel.app --notice https://your-app.vercel.app/n/<token>
 *
 * Storage privacy (needs the same variables the app uses; run it where they are set):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OBJECT_STORAGE_BUCKET=... npx tsx scripts/verify-deployment.ts <url> --storage
 *   ... --storage --object-key published/<notice>/<revision>/<sha>.wav     # also prove one real (e.g. superseded) object is unreachable
 */
import "./load-env";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, "");
const flagValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!base) {
  console.error("usage: tsx scripts/verify-deployment.ts <https://deployed-url> [--notice <public url>] [--storage [--object-key <key>]]");
  process.exit(2);
}

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const get = (path: string, init?: RequestInit) => fetch(path.startsWith("http") ? path : `${base}${path}`, { redirect: "manual", ...init });

async function app() {
  const health = await get("/api/health");
  check("liveness: /api/health is 200", health.status === 200, `status ${health.status}`);

  const ready = await get("/api/ready");
  const body = (await ready.json().catch(() => ({}))) as { ok?: boolean; checks?: Record<string, string> };
  check("readiness: /api/ready is 200", ready.status === 200 && body.ok === true, `status ${ready.status}`);
  for (const [name, value] of Object.entries(body.checks ?? {})) check(`readiness.${name}`, value.startsWith("ok"), value);
  // The test doubles must never be live in production.
  check("speech is the real AssemblyAI provider", body.checks?.speech?.startsWith("ok (assemblyai)") ?? false, body.checks?.speech ?? "missing");
  check("email is the real provider, not the test outbox", body.checks?.email?.startsWith("ok (resend)") ?? false, body.checks?.email ?? "missing");

  const home = await get("/");
  check("security headers on /", home.headers.get("x-content-type-options") === "nosniff" && home.headers.get("x-frame-options") === "DENY");
  check("the listener route 404s for an unknown notice with no-store", (await get("/n/AAAAAAAAAAAAAAAAAAAAAA")).headers.get("cache-control")?.includes("no-store") ?? false);

  const noOrigin = await get("/api/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@example.com" }) });
  check("sign-in refuses a request without a same-origin header (CSRF)", noOrigin.status === 403, `status ${noOrigin.status}`);
  check("workspace API refuses anonymous reads", (await get("/api/notices")).status === 401);
  check("cron cleanup refuses anonymous calls", [401, 403].includes((await get("/api/cron/cleanup")).status));

  const insecureCookie = await get("/api/health");
  check("no session cookie is set on a plain GET", !insecureCookie.headers.get("set-cookie"));
}

async function notice(url: string) {
  const page = await get(url);
  const html = await page.text();
  check("public page is 200", page.status === 200, `status ${page.status}`);
  check("public page is never cached", page.headers.get("cache-control")?.includes("no-store") ?? false, page.headers.get("cache-control") ?? "");
  const src = /<audio[^>]*\ssrc="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
  if (!src) return check("public page has an audio player (skip if the notice is withdrawn)", false, "no <audio src> found");
  const audio = await get(src.startsWith("http") ? src : new URL(src, url).toString());
  check("public audio is 200", audio.status === 200, `status ${audio.status}`);
  check("public audio is revalidated on every use", audio.headers.get("cache-control") === "private, no-cache", audio.headers.get("cache-control") ?? "");
  const etag = audio.headers.get("etag");
  check("public audio carries an ETag", !!etag);
  if (etag) {
    const again = await get(new URL(src, url).toString(), { headers: { "If-None-Match": etag } });
    check("revalidation with the ETag is 304", again.status === 304, `status ${again.status}`);
  }
}

async function storage() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.OBJECT_STORAGE_BUCKET;
  if (!url || !key || !bucket) return check("storage variables are set", false, "need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OBJECT_STORAGE_BUCKET");
  const auth = { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) };

  const meta = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers: auth });
  const info = (await meta.json().catch(() => ({}))) as { public?: boolean };
  check("the audio bucket exists", meta.status === 200, `status ${meta.status}`);
  check("the audio bucket is PRIVATE", info.public === false, `public=${String(info.public)}`);

  // A throw-away object, so the proof does not depend on any real notice existing.
  const probe = `staging/privacy/probe/${"0".repeat(64)}.wav`;
  const bytes = new TextEncoder().encode(`privacy-probe-${Date.now()}`);
  const put = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${probe}`, { method: "POST", headers: { ...auth, "Content-Type": "audio/wav", "x-upsert": "true" }, body: bytes });
  check("server key can write", put.ok, `status ${put.status}`);
  try {
    await unreachable(url, bucket, probe, "probe object");
    const mine = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${probe}`, { headers: auth });
    check("server key can read it back", mine.ok, `status ${mine.status}`);
  } finally {
    await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`, { method: "DELETE", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [probe] }) });
  }

  const real = flagValue("--object-key");
  if (real) await unreachable(url, bucket, real, "the named object (for example, superseded audio)");
}

/** An object must not be readable without the server key, by any of the public URL shapes. */
async function unreachable(url: string, bucket: string, key: string, label: string) {
  const b = encodeURIComponent(bucket);
  const shapes = [`${url}/storage/v1/object/public/${b}/${key}`, `${url}/storage/v1/object/${b}/${key}`, `${url}/storage/v1/object/authenticated/${b}/${key}`];
  for (const shape of shapes) {
    const res = await fetch(shape);
    check(`${label} is not readable anonymously at ${new URL(shape).pathname.split("/").slice(3, 5).join("/")}`, res.status !== 200, `status ${res.status}`);
  }
}

async function main() {
  await app();
  const n = flagValue("--notice");
  if (n) await notice(n);
  if (args.includes("--storage")) await storage();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${base}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Verification could not run:", err instanceof Error ? err.message : err);
  process.exit(2);
});
