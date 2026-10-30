import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { configureTestEnv } from "../support/setup-integration";

configureTestEnv();

const { getDb, closeDb } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const svc = await import("@/lib/notices/revision-service");
const { getPublicManifest } = await import("@/lib/notices/public-manifest");
const { setSpeechProvider } = await import("@/lib/speech");
const { TestToneProvider } = await import("@/lib/speech/test-provider");
const audioRoute = await import("@/app/api/public/[token]/audio/[revisionId]/[file]/route");
const currentRoute = await import("@/app/api/public/[token]/current/route");
const readyRoute = await import("@/app/api/ready/route");
const healthRoute = await import("@/app/api/health/route");
const { newId } = await import("@/lib/ids");
const { eq } = await import("drizzle-orm");

const text = (time: string) => `Dear parents,\n\nPickup is at ${time} at the main gate.`;

async function makeUser() {
  const db = await getDb();
  const id = newId("usr");
  await db.insert(schema.users).values({ id, kind: "workspace", displayName: "Test" });
  return id;
}

async function publish(owner: string) {
  const { noticeId, revisionId } = await svc.createNotice(owner, { title: "Pickup", text: text("3:00 PM"), sourceUrl: null, voiceId: "test-tone" });
  await svc.generatePreview(owner, revisionId);
  await svc.approveRevision(owner, revisionId);
  const db = await getDb();
  const notice = (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
  return { noticeId, token: notice.publicToken };
}

async function correct(owner: string, noticeId: string, time: string) {
  const { revisionId } = await svc.createRevision(owner, noticeId, { text: text(time) });
  await svc.generatePreview(owner, revisionId);
  await svc.approveRevision(owner, revisionId);
  return revisionId;
}

type Current = Extract<NonNullable<Awaited<ReturnType<typeof getPublicManifest>>>, { state: "published" }>;
async function current(token: string): Promise<Current> {
  const m = await getPublicManifest(token);
  if (m?.state !== "published") throw new Error("expected a published notice");
  return m;
}

/** Calls the real route handler for a public audio path. */
async function fetchAudio(audioUrl: string, headers: Record<string, string> = {}) {
  const [, , , token, , revisionId, file] = audioUrl.split("/") as [string, string, string, string, string, string, string];
  const req = new NextRequest(`http://localhost${audioUrl}`, { headers });
  return audioRoute.GET(req, { params: Promise.resolve({ token, revisionId, file }) });
}

beforeAll(async () => {
  await getDb();
});
beforeEach(() => setSpeechProvider(null));
afterAll(async () => {
  await closeDb();
});

describe("public audio cache policy", () => {
  it("is revalidated on every use and never shared or immutable", async () => {
    const owner = await makeUser();
    const { token } = await publish(owner);
    const m = await current(token);
    const res = await fetchAudio(m.audioUrl);
    expect(res.status).toBe(200);
    const cache = res.headers.get("cache-control") ?? "";
    expect(cache).toBe("private, no-cache");
    expect(cache).not.toMatch(/immutable|public|max-age|s-maxage/);
    expect(res.headers.get("etag")).toBe(`"${m.audioSha256}"`);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("answers a matching revalidation with 304, and still supports byte ranges", async () => {
    const owner = await makeUser();
    const { token } = await publish(owner);
    const m = await current(token);
    const res = await fetchAudio(m.audioUrl, { "if-none-match": `"${m.audioSha256}"` });
    expect(res.status).toBe(304);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(await res.text()).toBe("");

    const range = await fetchAudio(m.audioUrl, { range: "bytes=0-99" });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toMatch(/^bytes 0-99\/\d+$/);
    expect(range.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("a browser that cached the old audio is told 404, not 304, after a correction", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publish(owner);
    const v1 = await current(token);
    expect((await fetchAudio(v1.audioUrl)).status).toBe(200);

    await correct(owner, noticeId, "4:00 PM");
    const v2 = await current(token);
    expect(v2.audioUrl).not.toBe(v1.audioUrl);
    expect(v2.revisionNumber).toBe(2);

    // Revalidating the old URL with its own ETag is exactly what a caching browser does.
    const stale = await fetchAudio(v1.audioUrl, { "if-none-match": `"${v1.audioSha256}"` });
    expect(stale.status).toBe(404);
    expect(stale.headers.get("cache-control")).toBe("no-store");
    expect((await fetchAudio(v2.audioUrl, { "if-none-match": `"${v1.audioSha256}"` })).status).toBe(200); // wrong ETag: full response
    expect((await fetchAudio(v2.audioUrl)).status).toBe(200);
  });

  it("serves only the newest of several corrections at the unchanged link", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publish(owner);
    const urls = [(await current(token)).audioUrl];
    for (const time of ["4:00 PM", "4:30 PM", "5:00 PM"]) {
      await correct(owner, noticeId, time);
      urls.push((await current(token)).audioUrl);
    }
    const statuses = await Promise.all(urls.map(async (u) => (await fetchAudio(u)).status));
    expect(statuses).toEqual([404, 404, 404, 200]);
    const m = await current(token);
    expect(m.revisionNumber).toBe(4);
    expect(m.displayText).toContain("5:00 PM");
    expect(m.displayText).not.toContain("3:00 PM");
  });

  it("never exposes a draft's audio, approved or not", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publish(owner);
    const before = await current(token);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: text("6:00 PM") });
    await svc.generatePreview(owner, revisionId);
    const db = await getDb();
    const draft = (await db.select().from(schema.noticeRevisions).where(eq(schema.noticeRevisions.id, revisionId)))[0]!;
    const staged = (await db.select().from(schema.audioAssets).where(eq(schema.audioAssets.id, draft.audioAssetId!)))[0]!;

    const guess = `/api/public/${token}/audio/${revisionId}/${staged.sha256}.wav`;
    expect((await fetchAudio(guess)).status).toBe(404);
    const after = await current(token);
    expect(after.revisionId).toBe(before.revisionId);
    expect(after.displayText).toContain("3:00 PM");
  });

  it("stops serving the moment a notice is withdrawn, even to a client holding the ETag", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publish(owner);
    const m = await current(token);
    expect((await fetchAudio(m.audioUrl)).status).toBe(200);

    await svc.withdrawNotice(owner, noticeId);
    for (const headers of [{}, { "if-none-match": `"${m.audioSha256}"` }, { range: "bytes=0-9" }] as Record<string, string>[]) {
      const res = await fetchAudio(m.audioUrl, headers);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    const manifest = await getPublicManifest(token);
    expect(manifest?.state).toBe("withdrawn");
    expect(JSON.stringify(manifest)).not.toContain("audio");
  });

  it("returns no-store 404s for malformed paths", async () => {
    const bad = await fetchAudio(`/api/public/not-a-token/audio/rev_x/${"a".repeat(64)}.wav`);
    expect(bad.status).toBe(404);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    const traversal = await audioRoute.GET(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ token: "t", revisionId: "r", file: "../../etc/passwd" }),
    });
    expect(traversal.status).toBe(404);
  });
});

describe("public manifest route", () => {
  it("is never cached and tracks the current revision", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publish(owner);
    const call = () => currentRoute.GET(new NextRequest(`http://localhost/api/public/${token}/current`), { params: Promise.resolve({ token }) });
    const first = await call();
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect((await first.json()).revisionNumber).toBe(1);
    await correct(owner, noticeId, "4:00 PM");
    expect((await (await call()).json()).revisionNumber).toBe(2);
    await svc.withdrawNotice(owner, noticeId);
    const gone = await call();
    expect(gone.headers.get("cache-control")).toBe("no-store");
    expect((await gone.json()).state).toBe("withdrawn");
  });
});

describe("liveness and readiness", () => {
  it("health says the process and database are up; ready also needs speech and storage", async () => {
    setSpeechProvider(new TestToneProvider());
    const health = await healthRoute.GET();
    expect(health.status).toBe(200);
    const ready = await readyRoute.GET();
    expect(ready.status).toBe(200);
    expect((await ready.json()).checks).toMatchObject({ database: "ok", speech: "ok (test)", storage: "ok" });
  });

  it("ready fails, while health stays up, when speech is not configured", async () => {
    const tone = new TestToneProvider();
    setSpeechProvider({ ...tone, kind: "assemblyai", modelId: null, listVoices: () => tone.listVoices(), synthesize: tone.synthesize.bind(tone), isConfigured: () => ({ ok: false, reason: "ASSEMBLYAI_API_KEY is not set on the server." }) });
    expect((await healthRoute.GET()).status).toBe(200);
    const ready = await readyRoute.GET();
    expect(ready.status).toBe(503);
    const body = await ready.json();
    expect(body.ok).toBe(false);
    expect(body.checks.speech).toContain("ASSEMBLYAI_API_KEY");
    expect(JSON.stringify(body)).not.toMatch(/sk_|secret/i);
  });
});
