/**
 * Drives the complete publisher and listener journey against a RUNNING AfterSend instance over HTTP, and records
 * what actually happened. It is the tool for the real-infrastructure checks: real email, real AssemblyAI audio,
 * real storage.
 *
 *   Live (spends AssemblyAI credits: 2 syntheses; sends 2 emails; refuses to run against test providers):
 *     npm run verify:live -- https://your-app.vercel.app --email you@yourdomain.com --confirm-live
 *     (the script pauses twice and asks you to type the 6-digit code that arrives in that mailbox;
 *      add --email2 other@yourdomain.com for the cross-account checks and --storage-check for the bucket)
 *
 *   Rehearsal (local server with the test doubles; reads codes from the file outbox; proves the script, not the infrastructure):
 *     npm run verify:live -- http://localhost:3100 --email a@example.com --rehearsal --outbox .data/e2e/outbox
 *
 * It never prints a code, cookie, key or the email address (only a short hash of it). The listening gate is a
 * browser-side attestation: this script approves through the API and therefore does NOT prove that anyone listened.
 */
import "./load-env";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, "");
const flag = (n: string) => args.includes(n);
const val = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = val("--email");
const email2 = val("--email2");
const rehearsal = flag("--rehearsal");
const outbox = val("--outbox");

if (!base || !email || (!rehearsal && !flag("--confirm-live"))) {
  console.error(
    "usage: tsx scripts/live-journey.ts <https://deployed-url> --email <mailbox you can read> [--email2 <second mailbox>] [--storage-check] --confirm-live\n" +
      "       tsx scripts/live-journey.ts <http://localhost:PORT> --email a@example.com --rehearsal --outbox <dir>\n" +
      "Live mode spends AssemblyAI credits and sends real email, so it needs --confirm-live.",
  );
  process.exit(2);
}
if (rehearsal && !outbox) {
  console.error("--rehearsal needs --outbox <dir> to read the codes from.");
  process.exit(2);
}

type Step = { n: number; name: string; ok: boolean; detail: string; ms: number };
const steps: Step[] = [];
const ref = (a: string) => createHash("sha256").update(a.toLowerCase()).digest("hex").slice(0, 12);
let current = 0;

async function step(name: string, fn: () => Promise<string | void>) {
  const started = Date.now();
  current++;
  let ok = true;
  let detail = "";
  try {
    detail = (await fn()) ?? "";
  } catch (err) {
    ok = false;
    detail = err instanceof Error ? err.message : String(err);
  }
  steps.push({ n: current, name, ok, detail, ms: Date.now() - started });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  return ok;
}
function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

/** A minimal cookie jar: one per simulated browser. */
class Jar {
  private cookies = new Map<string, string>();
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

async function call(jar: Jar | null, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(p.startsWith("http") ? p : `${base}${p}`, {
    method,
    redirect: "manual",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { Origin: base! } : {}),
      ...(jar?.header() ? { Cookie: jar.header() } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  jar?.absorb(res);
  return res;
}
const json = async <T = Record<string, any>>(res: Response) => (await res.json()) as T;

function newestCodeFromOutbox(to: string, afterCount: number): string | null {
  const dir = path.resolve(outbox!);
  if (!fs.existsSync(dir)) return null;
  const mails = fs
    .readdirSync(dir)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { to: string; text: string })
    .filter((m) => m.to === to);
  return mails.length > afterCount ? (/code is (\d{6})/.exec(mails.at(-1)!.text)?.[1] ?? null) : null;
}
const outboxCount = (to: string) =>
  fs.existsSync(path.resolve(outbox ?? "."))
    ? fs.readdirSync(path.resolve(outbox!)).map((f) => JSON.parse(fs.readFileSync(path.join(path.resolve(outbox!), f), "utf8")) as { to: string }).filter((m) => m.to === to).length
    : 0;

async function askCode(address: string, label: string, before: number) {
  if (rehearsal) {
    for (let i = 0; i < 40; i++) {
      const code = newestCodeFromOutbox(address, before);
      if (code) return code;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("no code arrived in the outbox");
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\n>>> Type the 6-digit code sent to the mailbox for ${label} (it is not echoed in the report): `)).trim();
  rl.close();
  return answer;
}

async function signIn(jar: Jar, address: string, label: string) {
  const before = rehearsal ? outboxCount(address) : 0;
  const req = await call(jar, "POST", "/api/auth/request", { email: address });
  expect(req.status === 202, `code request answered ${req.status}`);
  const code = await askCode(address, label, before);
  const verify = await call(jar, "POST", "/api/auth/verify", { email: address, code });
  expect(verify.status === 200, `verify answered ${verify.status}`);
  const me = await call(jar, "GET", "/api/notices");
  expect(me.status === 200, `signed-in read answered ${me.status}`);
}

const sniffWav = async (res: Response) => {
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE", "not a WAV file");
  return bytes.byteLength;
};

const ORIGINAL = "Dear parents,\n\nPickup is at 3:00 PM at the main gate. Please bring your pickup card.";

async function main() {
  const owner = new Jar();
  const ctx: Record<string, any> = {};

  const targetOk = await step("target is live-capable (real speech and real email), unless rehearsing", async () => {
    const ready = await json(await call(null, "GET", "/api/ready"));
    const speech = String(ready.checks?.speech ?? "");
    const mail = String(ready.checks?.email ?? "");
    if (rehearsal) return `rehearsal: speech=${speech}, email=${mail}`;
    expect(speech.startsWith("ok (assemblyai)"), `speech is "${speech}", not the real AssemblyAI provider`);
    expect(mail.startsWith("ok (resend)"), `email is "${mail}", not the real provider`);
    expect(ready.ok === true, "readiness is not ok");
    return `speech=${speech}, email=${mail}`;
  });
  // Never go on to send email, spend credits or ask for codes against a target that failed the live-capability check.
  if (!targetOk) throw new Error("the target is not a live deployment; nothing else was attempted");

  await step("1. sign up with email (code delivered to a real mailbox)", () => signIn(owner, email!, "the first address"));

  await step("2-3. create a notice and start from the first configured voice", async () => {
    const voices = await json(await call(owner, "GET", "/api/voices"));
    ctx.voice = voices.voices[0].id;
    const created = await call(owner, "POST", "/api/notices", { title: "Pickup notice", text: ORIGINAL, voiceId: ctx.voice });
    expect(created.status === 201, `create answered ${created.status}`);
    Object.assign(ctx, await json(created));
    return `voice ${ctx.voice}`;
  });

  await step("4. generate audio (real synthesis in live mode)", async () => {
    const t = Date.now();
    const gen = await call(owner, "POST", `/api/revisions/${ctx.revisionId}/generate`);
    expect(gen.status === 200, `generate answered ${gen.status}: ${JSON.stringify(await gen.json().catch(() => ({})))}`);
    const status = await json(await call(owner, "GET", `/api/revisions/${ctx.revisionId}/status`));
    ctx.version = status.version;
    const preview = await call(owner, "GET", `/api/revisions/${ctx.revisionId}/audio`);
    expect(preview.status === 200, `preview audio answered ${preview.status}`);
    const bytes = await sniffWav(preview);
    return `${Date.now() - t} ms, ${bytes} bytes, provider ${status.audio?.providerKind}, ${status.audio?.durationMs} ms of audio`;
  });

  await step("5-6. approve and publish; obtain the permanent link", async () => {
    const done = await call(owner, "POST", `/api/revisions/${ctx.revisionId}/approve`, { confirmedCriticalFacts: true, expectedVersion: ctx.version });
    expect(done.status === 200, `approve answered ${done.status}`);
    const detail = await json(await call(owner, "GET", `/api/notices/${ctx.noticeId}`));
    ctx.token = detail.notice.publicToken;
    ctx.firstAsset = detail.current.audio;
    return "published as version 1";
  });

  await step("7. open the link anonymously; audio is revalidated, not cached", async () => {
    const page = await call(null, "GET", `/n/${ctx.token}`);
    expect(page.status === 200, `page answered ${page.status}`);
    expect((page.headers.get("cache-control") ?? "").includes("no-store"), "page is cacheable");
    expect((await page.text()).includes("3:00 PM"), "page does not show the original text");
    const manifest = await json(await call(null, "GET", `/api/public/${ctx.token}/current`));
    ctx.audio1 = manifest.audioUrl;
    const audio = await call(null, "GET", ctx.audio1);
    expect(audio.status === 200, `audio answered ${audio.status}`);
    expect(audio.headers.get("cache-control") === "private, no-cache", `audio cache-control is ${audio.headers.get("cache-control")}`);
    const etag = audio.headers.get("etag");
    expect(etag, "no ETag");
    const again = await call(null, "GET", ctx.audio1, undefined, { "If-None-Match": etag! });
    expect(again.status === 304, `revalidation answered ${again.status}`);
    return `${await sniffWav(audio)} bytes`;
  });

  await step("8-10. correct 3 PM to 4 PM, regenerate, republish; the same link serves the correction", async () => {
    const rev = await call(owner, "POST", `/api/notices/${ctx.noticeId}/revisions`, { text: ORIGINAL.replace("3:00 PM", "4:00 PM"), updatePreface: "Update: Pickup is at 4:00 PM at the main gate." });
    expect(rev.status === 201, `correction answered ${rev.status}`);
    const { revisionId } = await json(rev);
    const gen = await call(owner, "POST", `/api/revisions/${revisionId}/generate`);
    expect(gen.status === 200, `regenerate answered ${gen.status}`);
    const { version } = await json(await call(owner, "GET", `/api/revisions/${revisionId}/status`));
    const done = await call(owner, "POST", `/api/revisions/${revisionId}/approve`, { confirmedCriticalFacts: true, expectedVersion: version });
    expect(done.status === 200, `approve answered ${done.status}`);
    const page = await (await call(null, "GET", `/n/${ctx.token}`)).text();
    expect(page.includes("4:00 PM") && !page.includes("Pickup is at 3:00 PM"), "the link does not serve the corrected text");
    const manifest = await json(await call(null, "GET", `/api/public/${ctx.token}/current`));
    expect(manifest.revisionNumber === 2, `revision ${manifest.revisionNumber}`);
    ctx.audio2 = manifest.audioUrl;
    expect(ctx.audio2 !== ctx.audio1, "audio URL did not change");
    return "version 2 at the unchanged link";
  });

  await step("11a. superseded audio is refused by the application (even with its old ETag)", async () => {
    const stale = await call(null, "GET", ctx.audio1);
    expect(stale.status === 404, `old audio answered ${stale.status}`);
    const withTag = await call(null, "GET", ctx.audio1, undefined, { "If-None-Match": `"${ctx.firstAsset?.sha256 ?? "x"}"` });
    expect(withTag.status === 404, `old audio with ETag answered ${withTag.status}`);
    expect((await call(null, "GET", ctx.audio2)).status === 200, "current audio not served");
  });

  if (flag("--storage-check") || rehearsal === false) {
    await step("11b. the superseded storage object is not readable directly from storage", async () => {
      const supa = process.env.SUPABASE_URL?.replace(/\/$/, "");
      const bucket = process.env.OBJECT_STORAGE_BUCKET;
      if (!supa || !bucket) {
        if (flag("--storage-check")) throw new Error("--storage-check needs SUPABASE_URL and OBJECT_STORAGE_BUCKET (no key is needed)");
        return "skipped: SUPABASE_URL / OBJECT_STORAGE_BUCKET not set in this shell";
      }
      const detail = await json(await call(owner, "GET", `/api/notices/${ctx.noticeId}`));
      const v1 = detail.revisions.find((r: any) => r.revisionNumber === 1);
      const key: string | undefined = v1?.audio?.objectKey;
      expect(key, "owner detail has no object key for version 1");
      const b = encodeURIComponent(bucket);
      const shapes = [`/storage/v1/object/public/${b}/${key}`, `/storage/v1/object/${b}/${key}`, `/storage/v1/object/authenticated/${b}/${key}`];
      const results: number[] = [];
      for (const s of shapes) {
        const res = await fetch(`${supa}${s}`);
        results.push(res.status);
        expect(res.status !== 200, `storage served the superseded object at ${s.split("/").slice(3, 5).join("/")}`);
      }
      return `anonymous statuses ${results.join(", ")}`;
    });
  }

  await step("12-13. withdraw; every public route stops serving the notice", async () => {
    const w = await call(owner, "POST", `/api/notices/${ctx.noticeId}/withdraw`);
    expect(w.status === 200, `withdraw answered ${w.status}`);
    expect((await call(null, "GET", ctx.audio2)).status === 404, "audio still served after withdrawal");
    const manifest = await json(await call(null, "GET", `/api/public/${ctx.token}/current`));
    expect(manifest.state === "withdrawn" && !manifest.audioUrl, "manifest not withdrawn");
    const page = await (await call(null, "GET", `/n/${ctx.token}`)).text();
    expect(page.includes("has been withdrawn") && !page.includes("<audio"), "page still offers audio");
  });

  await step("14. lose the browser session", async () => {
    const fresh = new Jar(); // a different browser with no cookie
    expect((await call(fresh, "GET", `/api/notices/${ctx.noticeId}`)).status === 401, "an anonymous browser could read the workspace");
    ctx.lost = fresh;
  });

  await step("15. recover the workspace with the verified email", async () => {
    await signIn(ctx.lost as Jar, email!, "the first address, again");
    const detail = await call(ctx.lost as Jar, "GET", `/api/notices/${ctx.noticeId}`);
    expect(detail.status === 200, `recovered read answered ${detail.status}`);
    const body = await json(detail);
    expect(body.notice.state === "withdrawn" && body.revisions.length >= 2, "recovered workspace is missing the notice history");
    return "original notice and both versions found";
  });

  if (email2) {
    await step("16. another account cannot read or change the first account's notice", async () => {
      const other = new Jar();
      await signIn(other, email2, "the second address");
      expect((await call(other, "GET", `/api/notices/${ctx.noticeId}`)).status === 404, "second account could read it");
      expect((await call(other, "POST", `/api/notices/${ctx.noticeId}/withdraw`)).status === 404, "second account could withdraw it");
      expect((await call(other, "POST", `/api/notices/${ctx.noticeId}/revisions`, { text: "hijack" })).status === 404, "second account could correct it");
      const list = await json(await call(other, "GET", "/api/notices"));
      expect(list.notices.length === 0, "second account sees notices that are not its own");
      expect((await call(null, "GET", `/api/notices/${ctx.noticeId}`)).status === 401, "anonymous read allowed");
    });
  } else {
    console.log("SKIP  16. cross-account check (pass --email2 <second mailbox> to include it)");
  }

  await step("17. sign out everywhere ends the recovered session", async () => {
    const out = await call(ctx.lost as Jar, "POST", "/api/auth/signout-all");
    expect(out.status === 200, `answered ${out.status}`);
    expect((await call(ctx.lost as Jar, "GET", "/api/notices")).status === 401, "recovered session still works");
    expect((await call(owner, "GET", "/api/notices")).status === 401, "the original session survived sign-out-everywhere");
  });
}

main()
  .catch((err) => console.error("Journey aborted:", err instanceof Error ? err.message : err))
  .finally(() => {
    const failed = steps.filter((s) => !s.ok).length;
    // A run that stopped at the capability check did nothing worth keeping as evidence.
    if (steps.length <= 1 && failed > 0) {
      console.log("No report written: the run stopped before touching the target.");
      process.exitCode = 1;
      return;
    }
    const report = {
      mode: rehearsal ? "rehearsal (test doubles; NOT live evidence)" : "live",
      at: new Date().toISOString(),
      target: base,
      account: ref(email!),
      steps,
      failed,
      note: "The listening gate is a browser attestation; this run approved through the API and does not show that anyone listened. Pronunciation is judged only by docs/LISTENING_REVIEW.md.",
    };
    fs.mkdirSync("evidence", { recursive: true });
    const file = `evidence/${rehearsal ? "rehearsal" : "live"}-journey-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`\n${steps.length - failed}/${steps.length} steps passed. Report: ${file}`);
    process.exitCode = failed === 0 && steps.length > 0 ? 0 : 1;
  });
