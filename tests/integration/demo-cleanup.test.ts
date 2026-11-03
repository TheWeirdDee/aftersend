import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureTestEnv } from "../support/setup-integration";

configureTestEnv();

const { getDb, closeDb } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const svc = await import("@/lib/notices/revision-service");
const cleanup = await import("@/lib/notices/cleanup");
const { getPublicManifest } = await import("@/lib/notices/public-manifest");
const { objectStore, setObjectStore } = await import("@/lib/storage/audio");
const { newId } = await import("@/lib/ids");
const { eq, inArray } = await import("drizzle-orm");
type ObjectStore = import("@/lib/storage/audio").ObjectStore;

const DAY = 24 * 3600_000;
const TEXT = "Dear parents,\n\nPickup is at 3:00 PM at the main gate.";

/** A workspace with a published notice (so it has staging and published audio) and, optionally, a live session. */
async function workspace(opts: { kind?: "demo" | "workspace"; ageDays: number; session?: "live" | "expired" | "none"; email?: string }) {
  const db = await getDb();
  const id = newId("usr");
  await db.insert(schema.users).values({
    id,
    kind: opts.kind ?? "demo",
    displayName: "Demo workspace",
    email: opts.email ?? null,
    createdAt: new Date(Date.now() - opts.ageDays * DAY),
  });
  if (opts.session && opts.session !== "none") {
    await db.insert(schema.sessions).values({
      tokenHash: newId("sess") + "x".repeat(20),
      userId: id,
      expiresAt: new Date(Date.now() + (opts.session === "live" ? 5 * DAY : -1 * DAY)),
    });
  }
  const { noticeId, revisionId } = await svc.createNotice(id, { title: "Pickup notice", text: TEXT, sourceUrl: null, voiceId: "test-tone" }, { isDemo: opts.kind !== "workspace" });
  await svc.generatePreview(id, revisionId);
  await svc.approveRevision(id, revisionId);
  const notice = (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
  const assets = await db
    .select()
    .from(schema.audioAssets)
    .where(eq(schema.audioAssets.revisionId, revisionId));
  return { id, noticeId, revisionId, token: notice.publicToken, keys: assets.map((a) => a.objectKey) };
}

const userExists = async (id: string) => (await (await getDb()).select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id))).length === 1;
const noticeRows = async (ids: string[]) => (await (await getDb()).select({ id: schema.notices.id }).from(schema.notices).where(inArray(schema.notices.id, ids))).length;
const bytesExist = async (keys: string[]) => (await Promise.all(keys.map((k) => objectStore().get(k)))).filter(Boolean).length;

beforeAll(async () => {
  await getDb();
});
afterAll(async () => {
  setObjectStore(null);
  await closeDb();
});

describe("abandoned demo workspaces", () => {
  it("removes an unreachable demo with its notices, revisions, audio rows, stored bytes and public link", async () => {
    const demo = await workspace({ ageDays: 40, session: "expired" });
    expect(demo.keys.length).toBeGreaterThanOrEqual(2); // staging and published copies
    expect(await bytesExist(demo.keys)).toBe(demo.keys.length);
    expect((await getPublicManifest(demo.token))?.state).toBe("published");

    const out = await cleanup.cleanupAbandonedDemos();
    expect(out.workspaces).toBeGreaterThanOrEqual(1);
    expect(out.failed).toBe(0);

    expect(await userExists(demo.id)).toBe(false);
    expect(await noticeRows([demo.noticeId])).toBe(0);
    const db = await getDb();
    expect(await db.select().from(schema.noticeRevisions).where(eq(schema.noticeRevisions.id, demo.revisionId))).toHaveLength(0);
    expect(await db.select().from(schema.audioAssets).where(eq(schema.audioAssets.revisionId, demo.revisionId))).toHaveLength(0);
    expect(await db.select().from(schema.synthesisAttempts).where(eq(schema.synthesisAttempts.revisionId, demo.revisionId))).toHaveLength(0);
    expect(await bytesExist(demo.keys)).toBe(0);
    expect(await getPublicManifest(demo.token)).toBeNull();
  });

  it("removes a demo that never got a session, once it is old enough", async () => {
    const demo = await workspace({ ageDays: 10, session: "none" });
    await cleanup.cleanupAbandonedDemos();
    expect(await userExists(demo.id)).toBe(false);
  });

  it("keeps a demo whose session is still alive, however old", async () => {
    const demo = await workspace({ ageDays: 29, session: "live" });
    await cleanup.cleanupAbandonedDemos();
    expect(await userExists(demo.id)).toBe(true);
    expect(await bytesExist(demo.keys)).toBe(demo.keys.length);
    expect((await getPublicManifest(demo.token))?.state).toBe("published");
  });

  it("keeps a demo younger than the minimum age even if its session has expired", async () => {
    const demo = await workspace({ ageDays: 2, session: "expired" });
    await cleanup.cleanupAbandonedDemos();
    expect(await userExists(demo.id)).toBe(true);
    expect(await bytesExist(demo.keys)).toBe(demo.keys.length);
  });

  it("never removes a real workspace, however old and idle, with or without an email, or anything that carries an email", async () => {
    // An ordinary workspace nobody has attached an email to yet: not a demo, so it is never this cleanup's to remove.
    const anonymous = await workspace({ kind: "workspace", ageDays: 400, session: "none" });
    const real = await workspace({ kind: "workspace", ageDays: 400, session: "none", email: "owner@example.com" });
    const odd = await workspace({ kind: "demo", ageDays: 400, session: "none", email: "claimed@example.com" });
    await cleanup.cleanupAbandonedDemos();
    expect(await userExists(anonymous.id)).toBe(true);
    expect(await userExists(real.id)).toBe(true);
    expect(await userExists(odd.id)).toBe(true);
    expect(await bytesExist([...anonymous.keys, ...real.keys, ...odd.keys])).toBe(anonymous.keys.length + real.keys.length + odd.keys.length);
  });

  it("leaves other workspaces' bytes alone", async () => {
    const gone = await workspace({ ageDays: 40, session: "expired" });
    const kept = await workspace({ ageDays: 40, session: "live" });
    await cleanup.cleanupAbandonedDemos();
    expect(await bytesExist(gone.keys)).toBe(0);
    expect(await bytesExist(kept.keys)).toBe(kept.keys.length);
  });

  it("leaves a workspace whole for the next run when a stored object cannot be deleted, then removes it", async () => {
    const real = objectStore();
    const demo = await workspace({ ageDays: 40, session: "expired" });
    let failing = true;
    const flaky: ObjectStore = {
      put: real.put.bind(real),
      get: real.get.bind(real),
      delete: async (key, o) => {
        if (failing) throw new Error("storage is down");
        return real.delete(key, o);
      },
    };
    setObjectStore(flaky);
    const first = await cleanup.cleanupAbandonedDemos();
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect(await userExists(demo.id)).toBe(true); // rows kept, so the bytes are still reachable by the next run

    failing = false;
    const second = await cleanup.cleanupAbandonedDemos();
    expect(second.failed).toBe(0);
    setObjectStore(real);
    expect(await userExists(demo.id)).toBe(false);
    expect(await bytesExist(demo.keys)).toBe(0);
  });

  it("removes at most one batch per run and finishes the rest on the next", async () => {
    const a = await workspace({ ageDays: 40, session: "expired" });
    const b = await workspace({ ageDays: 40, session: "expired" });
    const c = await workspace({ ageDays: 40, session: "expired" });
    const first = await cleanup.cleanupAbandonedDemos(new Date(), { limit: 1 });
    expect(first.workspaces).toBe(1);
    const remaining = (await Promise.all([a, b, c].map((w) => userExists(w.id)))).filter(Boolean).length;
    expect(remaining).toBe(2);
    await cleanup.cleanupAbandonedDemos(new Date(), { limit: 10 });
    expect((await Promise.all([a, b, c].map((w) => userExists(w.id)))).filter(Boolean)).toHaveLength(0);
  });

  it("is part of the scheduled cleanup", async () => {
    const demo = await workspace({ ageDays: 40, session: "expired" });
    const out = await cleanup.runCleanup();
    expect(out.demos.workspaces).toBeGreaterThanOrEqual(1);
    expect(await userExists(demo.id)).toBe(false);
  });

  it("a second run finds nothing left to do", async () => {
    await workspace({ ageDays: 40, session: "expired" });
    await cleanup.cleanupAbandonedDemos();
    expect(await cleanup.cleanupAbandonedDemos()).toEqual({ workspaces: 0, objects: 0, failed: 0 });
  });
});
