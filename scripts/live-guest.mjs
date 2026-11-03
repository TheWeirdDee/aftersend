#!/usr/bin/env node
/**
 * A real journey against a deployed AfterSend, as a guest: no email, no code to type.
 *
 *   guest session -> real speech for the sample -> publish -> open the public link -> change 3 PM to 4 PM ->
 *   real speech again -> update -> the SAME link serves the new text and a new audio file, the old file is refused ->
 *   withdraw -> the link says so and serves no audio.
 *
 * It spends two real speech syntheses (about 15 s of audio each) and creates one guest workspace on the target.
 * It never reads a secret. It writes evidence/live-guest-<timestamp>.json. Exit code is non-zero on any failure.
 *
 *   node scripts/live-guest.mjs https://aftersend-sigma.vercel.app --confirm-live
 */
import fs from "node:fs";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith("http")) ?? "").replace(/\/$/, "");
if (!base) {
  console.error("Usage: node scripts/live-guest.mjs <base-url> --confirm-live");
  process.exit(2);
}
if (!args.includes("--confirm-live")) {
  console.error("This spends real speech credits and creates a guest workspace on the target. Add --confirm-live to proceed.");
  process.exit(2);
}

// For checking this script itself against a local test-provider server. Never use it to claim real speech.
const allowTest = args.includes("--allow-test-provider");
const steps = [];
let cookie = "";
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { origin: base } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return res;
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    steps.push({ name, ok: true, ms: Date.now() - started, ...(detail ?? {}) });
    console.log(`ok   ${name}`);
    return true;
  } catch (e) {
    steps.push({ name, ok: false, ms: Date.now() - started, error: String(e.message ?? e) });
    console.log(`FAIL ${name}: ${e.message ?? e}`);
    return false;
  }
}
const need = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

function wavInfo(bytes) {
  const b = Buffer.from(bytes);
  need(b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WAVE", "not a WAV file");
  const rate = b.readUInt32LE(24);
  const byteRate = b.readUInt32LE(28);
  return { bytes: b.length, sampleRate: rate, seconds: Math.round(((b.length - 44) / byteRate) * 10) / 10 };
}

const ctx = {};

async function generateAndCheck(revisionId, label) {
  const t = Date.now();
  const res = await call(`/api/revisions/${revisionId}/generate`, { method: "POST" });
  const text = await res.text();
  need(res.status === 200, `generate returned ${res.status}: ${text.slice(0, 200)}`);
  const latencyMs = Date.now() - t;
  const status = await (await call(`/api/revisions/${revisionId}/status`)).json();
  need(status.status === "preview_ready", `status is ${status.status}`);
  need(status.audio?.providerKind === "assemblyai" || (allowTest && status.audio?.providerKind === "test"), `audio provider is ${status.audio?.providerKind}, not assemblyai`);
  const audioRes = await call(status.previewUrl);
  need(audioRes.status === 200, `preview audio returned ${audioRes.status}`);
  const bytes = new Uint8Array(await audioRes.arrayBuffer());
  const info = wavInfo(bytes);
  need(info.seconds > 3, `audio is only ${info.seconds}s`);
  need(sha(bytes) === status.audio.sha256, "downloaded audio does not match its recorded sha256");
  return { label, latencyMs, version: status.version, sha256: status.audio.sha256, ...info, providerLatencyMs: status.audio.providerLatencyMs };
}

const ok1 = await step("start a guest session with the sample announcement", async () => {
  const res = await call("/api/workspace", { method: "POST", body: { kind: "guest" } });
  need(res.status === 201, `workspace returned ${res.status}`);
  const { redirect } = await res.json();
  ctx.noticeId = /ntc_[a-f0-9]+/.exec(redirect)?.[0];
  need(ctx.noticeId, "no notice id in the redirect");
  const detail = await (await call(`/api/notices/${ctx.noticeId}`)).json();
  ctx.firstRevision = detail.revisions[0].id;
  ctx.token = detail.notice.publicToken;
  need(/Pickup is at 3:00 PM/.test(detail.revisions[0].displayText), "sample does not contain the 3:00 PM pickup");
  ctx.sampleText = detail.revisions[0].displayText;
});

const ok2 = ok1 && (await step("real speech for the first announcement (AssemblyAI)", async () => {
  ctx.first = await generateAndCheck(ctx.firstRevision, "first");
  return ctx.first;
}));

const ok3 = ok2 && (await step("publish it; the public link serves the text and audio", async () => {
  const res = await call(`/api/revisions/${ctx.firstRevision}/approve`, { method: "POST", body: { confirmedCriticalFacts: true, expectedVersion: ctx.first.version } });
  need(res.status === 200, `approve returned ${res.status}`);
  const m = await (await call(`/api/public/${ctx.token}/current`)).json();
  need(m.state === "published" && m.revisionNumber === 1, "manifest is not published revision 1");
  need(m.displayText.includes("3:00 PM"), "public text lacks 3:00 PM");
  ctx.audio1 = m.audioUrl;
  const a = await call(m.audioUrl);
  need(a.status === 200, `public audio returned ${a.status}`);
  const page = await (await call(`/n/${ctx.token}`)).text();
  need(page.includes("3:00 PM"), "listener page lacks 3:00 PM");
  need(!page.includes("usr_"), "listener page leaks an owner id");
}));

const ok4 = ok3 && (await step("correct 3:00 PM to 4:00 PM and prepare real speech again", async () => {
  const res = await call(`/api/notices/${ctx.noticeId}/revisions`, { method: "POST", body: { text: ctx.sampleText.replace("3:00 PM", "4:00 PM"), updatePreface: "Update: Pickup is now at 4:00 PM." } });
  need(res.status === 201 || res.status === 200, `create correction returned ${res.status}`);
  ctx.correction = (await res.json()).revisionId;
  // Until approval the public link must still serve 3:00 PM.
  const m = await (await call(`/api/public/${ctx.token}/current`)).json();
  need(m.revisionNumber === 1 && m.displayText.includes("3:00 PM"), "the public link changed before approval");
  ctx.second = await generateAndCheck(ctx.correction, "corrected");
  need(ctx.second.sha256 !== ctx.first.sha256, "corrected audio is identical to the first");
  return ctx.second;
}));

const ok5 = ok4 && (await step("approve the correction: the same link now serves 4:00 PM and new audio", async () => {
  const res = await call(`/api/revisions/${ctx.correction}/approve`, { method: "POST", body: { confirmedCriticalFacts: true, expectedVersion: ctx.second.version } });
  need(res.status === 200, `approve returned ${res.status}`);
  const m = await (await call(`/api/public/${ctx.token}/current`)).json();
  need(m.revisionNumber === 2 && m.displayText.includes("4:00 PM") && !m.displayText.includes("3:00 PM"), "manifest does not show the correction");
  need(m.audioUrl !== ctx.audio1, "audio URL did not change");
  ctx.audio2 = m.audioUrl;
  const a = await call(m.audioUrl);
  need(a.status === 200, `new public audio returned ${a.status}`);
  const page = await (await call(`/n/${ctx.token}`)).text();
  need(page.includes("4:00 PM") && page.includes("corrected"), "listener page does not show the correction");
}));

const ok6 = ok5 && (await step("the superseded audio is refused at the public link", async () => {
  const old = await call(ctx.audio1);
  need(old.status === 404, `superseded audio returned ${old.status}, expected 404`);
}));

const ok7 = ok6 && (await step("withdraw: the link says so and serves no audio", async () => {
  const res = await call(`/api/notices/${ctx.noticeId}/withdraw`, { method: "POST" });
  need(res.status === 200, `withdraw returned ${res.status}`);
  const m = await (await call(`/api/public/${ctx.token}/current`)).json();
  need(m.state === "withdrawn", `manifest state is ${m.state}`);
  need((await call(ctx.audio2)).status === 404, "withdrawn audio is still served");
  need((await call(ctx.audio1)).status === 404, "superseded audio is served after withdrawal");
  const page = await (await call(`/n/${ctx.token}`)).text();
  need(page.includes("withdrawn"), "listener page does not say withdrawn");
}));

const failed = steps.filter((s) => !s.ok);
const report = {
  target: base,
  at: new Date().toISOString(),
  kind: (allowTest ? "LOCAL CHECK WITH THE TEST TONE, NOT A LIVE RESULT. " : "") + "live guest journey (real AssemblyAI speech; no email, so sign-in, recovery and the two-account boundary are NOT covered here)",
  passed: steps.filter((s) => s.ok).length,
  failed: failed.length,
  notRun: 7 - steps.length,
  steps,
};
fs.mkdirSync("evidence", { recursive: true });
const file = `evidence/live-guest-${report.at.replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
console.log(`\n${report.passed} passed, ${report.failed} failed, ${report.notRun} not run. Evidence: ${file}`);
void ok7;
process.exit(failed.length || report.notRun ? 1 : 0);
