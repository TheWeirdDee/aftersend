import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureTestEnv } from "../support/setup-integration";

configureTestEnv();

const { getDb, closeDb } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const svc = await import("@/lib/notices/revision-service");
const cleanup = await import("@/lib/notices/cleanup");
const { getPublicManifest } = await import("@/lib/notices/public-manifest");
const { setSpeechProvider } = await import("@/lib/speech");
const { TestToneProvider } = await import("@/lib/speech/test-provider");
const { SpeechProviderError } = await import("@/lib/speech/provider");
const { resetEnvCache } = await import("@/lib/env");
const { objectStore } = await import("@/lib/storage/audio");
const { newId } = await import("@/lib/ids");
const { and, eq } = await import("drizzle-orm");
type SynthesisInput = import("@/lib/speech/provider").SynthesisInput;
type SpeechProvider = import("@/lib/speech/provider").SpeechProvider;

const ORIGINAL = "Dear parents,\n\nPickup is at 3:00 PM at the main gate.";
const CORRECTED = "Dear parents,\n\nPickup is at 4:00 PM at the main gate.";
const HOUR = 3600_000;

async function makeUser() {
  const db = await getDb();
  const id = newId("usr");
  await db.insert(schema.users).values({ id, kind: "workspace", displayName: "Test" });
  return id;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

async function revision(id: string) {
  const db = await getDb();
  return (await db.select().from(schema.noticeRevisions).where(eq(schema.noticeRevisions.id, id)))[0]!;
}

async function publishNew(owner: string, text = ORIGINAL) {
  const { noticeId, revisionId } = await svc.createNotice(owner, { title: "Pickup notice", text, sourceUrl: null, voiceId: "test-tone" });
  await svc.generatePreview(owner, revisionId);
  await svc.approveRevision(owner, revisionId);
  const db = await getDb();
  const notice = (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
  return { noticeId, revisionId, token: notice.publicToken };
}

/** A preview-ready correction draft of the notice's current version. */
async function previewedDraft(owner: string, noticeId: string, text = CORRECTED) {
  const { revisionId } = await svc.createRevision(owner, noticeId, { text });
  await svc.generatePreview(owner, revisionId);
  return revisionId;
}

/** Test speech double with scripted behaviour per call; real tone audio when it succeeds. */
function scripted(behaviour: (call: number, input: SynthesisInput) => Promise<"ok" | Error | Uint8Array>) {
  const tone = new TestToneProvider();
  const log: { call: number; timeoutMs: number | undefined }[] = [];
  let calls = 0;
  const provider: SpeechProvider = {
    kind: "test",
    modelId: "test-tone",
    isConfigured: () => ({ ok: true }),
    listVoices: () => tone.listVoices(),
    async synthesize(input) {
      const call = ++calls;
      log.push({ call, timeoutMs: input.requestContext.timeoutMs });
      const outcome = await behaviour(call, input);
      if (outcome instanceof Error) throw outcome;
      const real = await tone.synthesize(input);
      return outcome === "ok" ? real : { ...real, audio: outcome };
    },
  };
  return { provider, log, calls: () => calls };
}

const retryable = () => new SpeechProviderError("provider_error", "Temporary provider failure.", true);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await getDb();
});
beforeEach(() => {
  setSpeechProvider(null);
  delete process.env.SYNTHESIS_DEADLINE_MS;
  resetEnvCache();
});
afterAll(async () => {
  await closeDb();
});

describe("optimistic concurrency on drafts", () => {
  it("refuses a save made against an old version and keeps the newer content", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    expect((await revision(revisionId)).version).toBe(1);

    const a = await svc.updateDraft(owner, revisionId, { text: CORRECTED + "\nTab A.", expectedVersion: 1 });
    expect(a.version).toBe(2);
    await expect(svc.updateDraft(owner, revisionId, { text: CORRECTED + "\nTab B (stale).", expectedVersion: 1 })).rejects.toMatchObject({
      code: "conflict",
      details: { reason: "stale_version", currentVersion: 2 },
    });
    const row = await revision(revisionId);
    expect(row.displayText).toContain("Tab A.");
    expect(row.displayText).not.toContain("stale");
    expect(row.version).toBe(2);
  });

  it("serialises two simultaneous saves: no lost update, and version counts only what was applied", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    const results = await Promise.allSettled([
      svc.updateDraft(owner, revisionId, { text: CORRECTED + "\nFirst." }),
      svc.updateDraft(owner, revisionId, { text: CORRECTED + "\nSecond." }),
    ]);
    const applied = results.filter((r) => r.status === "fulfilled").length;
    expect(applied).toBeGreaterThanOrEqual(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "conflict" });
    const row = await revision(revisionId);
    expect(row.version).toBe(1 + applied);
    expect(row.displayText.endsWith("First.") || row.displayText.endsWith("Second.")).toBe(true);
  });

  it("an omitted field in a save leaves it alone", async () => {
    const owner = await makeUser();
    const { noticeId, revisionId } = await svc.createNotice(owner, {
      title: "Trip",
      text: "Bus leaves at 8:00 AM.",
      sourceUrl: "https://example.com/trip",
      voiceId: "test-tone",
    });
    await svc.updateDraft(owner, revisionId, { text: "Bus leaves at 8:30 AM." });
    const db = await getDb();
    const notice = (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
    expect(notice.sourceUrl).toBe("https://example.com/trip");
    await svc.updateDraft(owner, revisionId, { sourceUrl: null });
    const cleared = (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
    expect(cleared.sourceUrl).toBeNull();

    const pub = await publishNew(owner);
    const { revisionId: corr } = await svc.createRevision(owner, pub.noticeId, { text: CORRECTED, updatePreface: "Update: 4 PM." });
    await svc.updateDraft(owner, corr, { text: CORRECTED + "\nBring water." });
    expect((await revision(corr)).updatePreface).toBe("Update: 4 PM.");
    await svc.updateDraft(owner, corr, { updatePreface: null });
    expect((await revision(corr)).updatePreface).toBeNull();
  });

  it("approval must name the saved version that was previewed", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const rev = await previewedDraft(owner, noticeId);
    const previewed = (await revision(rev)).version;

    // The publisher edits in another tab after previewing: the preview is gone and the old version is stale.
    await svc.updateDraft(owner, rev, { text: CORRECTED.replace("4:00", "4:30") });
    await expect(svc.approveRevision(owner, rev, { expectedVersion: previewed })).rejects.toMatchObject({
      code: "conflict",
      details: { reason: "stale_version" },
    });
    const now = await revision(rev);
    await expectCode(svc.approveRevision(owner, rev, { expectedVersion: now.version }), "audio_not_ready");

    await svc.generatePreview(owner, rev);
    const ready = await revision(rev);
    const done = await svc.approveRevision(owner, rev, { expectedVersion: ready.version });
    expect(done.alreadyPublished).toBe(false);
  });

  it("an edit after approval cannot alter the approved audio or text", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const rev = await previewedDraft(owner, noticeId);
    await svc.approveRevision(owner, rev);
    const before = await revision(rev);
    await expect(svc.updateDraft(owner, rev, { text: "Sneaky edit at 9:00 PM." })).rejects.toMatchObject({
      code: "conflict",
      details: { reason: "locked" },
    });
    const after = await revision(rev);
    expect(after.displayText).toBe(before.displayText);
    expect(after.audioAssetId).toBe(before.audioAssetId);
    expect(after.version).toBe(before.version);
  });

  it("creating a draft twice with the same client token returns one draft", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const token = "retry-token-0001";
    const first = await svc.createRevision(owner, noticeId, { text: CORRECTED, clientToken: token });
    const again = await svc.createRevision(owner, noticeId, { text: CORRECTED + "\nlater edit", clientToken: token });
    expect(again.revisionId).toBe(first.revisionId);

    const raced = await Promise.all([
      svc.createRevision(owner, noticeId, { text: CORRECTED, clientToken: "race-token-0002" }),
      svc.createRevision(owner, noticeId, { text: CORRECTED, clientToken: "race-token-0002" }),
      svc.createRevision(owner, noticeId, { text: CORRECTED, clientToken: "race-token-0002" }),
    ]);
    expect(new Set(raced.map((r) => r.revisionId)).size).toBe(1);

    const db = await getDb();
    const drafts = await db.select().from(schema.noticeRevisions).where(eq(schema.noticeRevisions.noticeId, noticeId));
    expect(drafts.filter((d) => d.status === "draft")).toHaveLength(2); // one per token
  });

  it("two simultaneous approvals of one revision publish it once", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const rev = await previewedDraft(owner, noticeId);
    const results = await Promise.allSettled([svc.approveRevision(owner, rev), svc.approveRevision(owner, rev)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "conflict" });

    const db = await getDb();
    const ready = await db
      .select()
      .from(schema.audioAssets)
      .where(and(eq(schema.audioAssets.revisionId, rev), eq(schema.audioAssets.stage, "published"), eq(schema.audioAssets.contentReady, true)));
    expect(ready).toHaveLength(1);
    const notice = (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
    expect(notice.currentRevisionId).toBe(rev);
    expect((await revision(rev)).audioAssetId).toBe(ready[0]!.id);
  });
});

describe("every spoken field is checked for ambiguous dates", () => {
  it("blocks generation when only the title is ambiguous", async () => {
    const owner = await makeUser();
    const { revisionId } = await svc.createNotice(owner, { title: "Trip on 05/06/26", text: "Bus leaves at 8:00 AM.", sourceUrl: null, voiceId: "test-tone" });
    await expect(svc.generatePreview(owner, revisionId)).rejects.toMatchObject({ code: "validation_failed", message: expect.stringContaining("the title") });
  });

  it("blocks generation when only the update note is ambiguous", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED, updatePreface: "Moved to 31/02/2026." });
    await expect(svc.generatePreview(owner, revisionId)).rejects.toMatchObject({ code: "validation_failed", message: expect.stringContaining("update note") });
  });

  it("blocks approval if an ambiguous date is somehow present in a previewed draft", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const rev = await previewedDraft(owner, noticeId);
    const db = await getDb();
    await db.update(schema.noticeRevisions).set({ title: "Pickup 05/06/26" }).where(eq(schema.noticeRevisions.id, rev));
    await expect(svc.approveRevision(owner, rev)).rejects.toMatchObject({ code: "validation_failed" });
    expect((await revision(rev)).status).toBe("preview_ready");
  });
});

describe("synthesis retries, deadlines and claims", () => {
  it("recovers from transient failures within the retry budget and records the retries", async () => {
    const owner = await makeUser();
    const flaky = scripted(async (call) => (call < 3 ? retryable() : "ok"));
    setSpeechProvider(flaky.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await svc.generatePreview(owner, revisionId);
    expect(flaky.calls()).toBe(3);
    expect((await revision(revisionId)).status).toBe("preview_ready");
    const db = await getDb();
    const attempt = (await db.select().from(schema.synthesisAttempts).where(eq(schema.synthesisAttempts.revisionId, revisionId)))[0]!;
    expect(attempt).toMatchObject({ outcome: "success", retries: 2 });
  });

  it("gives up after the retry limit and leaves a failed, retryable draft", async () => {
    const owner = await makeUser();
    const down = scripted(async () => retryable());
    setSpeechProvider(down.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await expect(svc.generatePreview(owner, revisionId)).rejects.toMatchObject({ code: "synthesis_failed", retryable: true });
    expect(down.calls()).toBe(3); // first try plus two retries
    const row = await revision(revisionId);
    expect(row).toMatchObject({ status: "failed", audioAssetId: null, synthesisClaim: null });

    // The same draft can be generated again once the provider recovers.
    setSpeechProvider(scripted(async () => "ok").provider);
    await svc.generatePreview(owner, revisionId);
    expect((await revision(revisionId)).status).toBe("preview_ready");
  });

  it("does not retry a failure that cannot succeed on retry", async () => {
    const owner = await makeUser();
    const rejected = scripted(async () => new SpeechProviderError("invalid_request", "Cannot speak this.", false));
    setSpeechProvider(rejected.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await expect(svc.generatePreview(owner, revisionId)).rejects.toMatchObject({ code: "synthesis_failed", retryable: false });
    expect(rejected.calls()).toBe(1);
  });

  it("keeps every attempt inside one overall deadline", async () => {
    process.env.SYNTHESIS_DEADLINE_MS = "2000";
    resetEnvCache();
    const owner = await makeUser();
    // Each attempt hangs until the time it was given runs out, as a stuck connection would.
    const hung = scripted(async (_call, input) => {
      await sleep(input.requestContext.timeoutMs ?? 60_000);
      return new SpeechProviderError("timeout", "Timed out.", true);
    });
    setSpeechProvider(hung.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    const started = Date.now();
    await expect(svc.generatePreview(owner, revisionId)).rejects.toMatchObject({ code: "synthesis_failed" });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2000 + 500); // never beyond the deadline, plus bookkeeping
    expect(hung.log.every((l) => (l.timeoutMs ?? Infinity) <= 2000)).toBe(true);
    expect(hung.log[0]!.timeoutMs).toBeLessThanOrEqual(1800); // post-work reserve held back
    expect((await revision(revisionId)).status).toBe("failed");
  });

  it("refuses to start an attempt it has no time to finish, and says why", async () => {
    process.env.SYNTHESIS_DEADLINE_MS = "1000";
    resetEnvCache();
    const owner = await makeUser();
    const slow = scripted(async (_c, input) => {
      await sleep((input.requestContext.timeoutMs ?? 0) + 10);
      return new SpeechProviderError("timeout", "Timed out.", true);
    });
    setSpeechProvider(slow.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await expect(svc.generatePreview(owner, revisionId)).rejects.toMatchObject({ code: "synthesis_failed" });
    expect(slow.calls()).toBe(1);
  });

  it("a stalled worker that wakes up late cannot touch the replacement's result", async () => {
    const owner = await makeUser();
    let releaseA!: () => void;
    const stalled = new Promise<void>((r) => (releaseA = r));
    const worker = scripted(async (call) => {
      if (call === 1) await stalled; // worker A hangs
      return "ok";
    });
    setSpeechProvider(worker.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });

    const a = svc.generatePreview(owner, revisionId);
    while (worker.calls() < 1) await sleep(10);
    const claimA = (await revision(revisionId)).synthesisClaim;
    expect(claimA).toBeTruthy();

    // While A is merely slow, nobody else can take over.
    await expectCode(svc.generatePreview(owner, revisionId), "synthesis_in_progress");

    // Once the claim is stale (A presumed dead), B takes over and finishes.
    const db = await getDb();
    await db.update(schema.noticeRevisions).set({ updatedAt: new Date(Date.now() - HOUR) }).where(eq(schema.noticeRevisions.id, revisionId));
    await svc.generatePreview(owner, revisionId);
    const afterB = await revision(revisionId);
    expect(afterB.status).toBe("preview_ready");
    expect(afterB.synthesisClaim).toBeNull();
    const winningAsset = afterB.audioAssetId;

    // A finally returns. Its result must be discarded, not attached.
    releaseA();
    await expect(a).rejects.toMatchObject({ code: "conflict" });
    const final = await revision(revisionId);
    expect(final.status).toBe("preview_ready");
    expect(final.audioAssetId).toBe(winningAsset);
    const attempts = await db.select().from(schema.synthesisAttempts).where(eq(schema.synthesisAttempts.revisionId, revisionId));
    expect(attempts.map((x) => x.outcome).sort()).toEqual(["cancelled", "success"]);
  });

  it("a stalled worker that fails late cannot mark the replacement's revision failed", async () => {
    const owner = await makeUser();
    let failA!: () => void;
    const stalled = new Promise<void>((r) => (failA = r));
    const worker = scripted(async (call) => {
      if (call === 1) {
        await stalled;
        return new SpeechProviderError("invalid_request", "Late failure.", false);
      }
      return "ok";
    });
    setSpeechProvider(worker.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    const a = svc.generatePreview(owner, revisionId);
    while (worker.calls() < 1) await sleep(10);
    const db = await getDb();
    await db.update(schema.noticeRevisions).set({ updatedAt: new Date(Date.now() - HOUR) }).where(eq(schema.noticeRevisions.id, revisionId));
    await svc.generatePreview(owner, revisionId);

    failA();
    await expect(a).rejects.toMatchObject({ code: "synthesis_failed" });
    expect((await revision(revisionId)).status).toBe("preview_ready");
  });

  describe("a stalled worker that returns while its replacement is still working", () => {
    /** Worker A hangs and is replaced by worker B, which also hangs. Returns the handles to release them. */
    async function twoWorkers(owner: string, aOutcome: "ok" | Error) {
      let releaseA!: () => void;
      let releaseB!: () => void;
      const gateA = new Promise<void>((r) => (releaseA = r));
      const gateB = new Promise<void>((r) => (releaseB = r));
      const worker = scripted(async (call) => {
        await (call === 1 ? gateA : gateB);
        return call === 1 ? aOutcome : "ok";
      });
      setSpeechProvider(worker.provider);
      const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
      const a = svc.generatePreview(owner, revisionId);
      while (worker.calls() < 1) await sleep(10);
      const db = await getDb();
      await db.update(schema.noticeRevisions).set({ updatedAt: new Date(Date.now() - HOUR) }).where(eq(schema.noticeRevisions.id, revisionId));
      const b = svc.generatePreview(owner, revisionId);
      while (worker.calls() < 2) await sleep(10);
      return { revisionId, a, b, releaseA, releaseB };
    }

    it("cannot attach its audio over the replacement's claim", async () => {
      const owner = await makeUser();
      const w = await twoWorkers(owner, "ok");
      const claimB = (await revision(w.revisionId)).synthesisClaim;

      w.releaseA();
      await expect(w.a).rejects.toMatchObject({ code: "conflict" });
      const mid = await revision(w.revisionId);
      expect(mid).toMatchObject({ status: "synthesizing", audioAssetId: null, synthesisClaim: claimB }); // still B's to finish

      w.releaseB();
      await w.b;
      const done = await revision(w.revisionId);
      expect(done.status).toBe("preview_ready");
      expect(done.requestId).toBe(`test-${claimB}`); // the audio is B's, not A's
    });

    it("cannot mark the revision failed over the replacement's claim", async () => {
      const owner = await makeUser();
      const w = await twoWorkers(owner, new SpeechProviderError("invalid_request", "Late failure.", false));
      const claimB = (await revision(w.revisionId)).synthesisClaim;

      w.releaseA();
      await expect(w.a).rejects.toMatchObject({ code: "synthesis_failed" });
      expect(await revision(w.revisionId)).toMatchObject({ status: "synthesizing", synthesisClaim: claimB });

      w.releaseB();
      await w.b;
      expect((await revision(w.revisionId)).status).toBe("preview_ready");
    });
  });

  it("does not spend provider credits on a draft that a newer publication already superseded", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const { revisionId: x } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    const y = await previewedDraft(owner, noticeId, CORRECTED.replace("4:00", "5:00"));
    await svc.approveRevision(owner, y);

    const counting = scripted(async () => "ok");
    setSpeechProvider(counting.provider);
    await expect(svc.generatePreview(owner, x)).rejects.toMatchObject({ code: "conflict", details: { reason: "superseded" } });
    expect(counting.calls()).toBe(0);
  });

  it("refuses generation and edits once the notice is withdrawn", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    await svc.withdrawNotice(owner, noticeId);
    await expectCode(svc.generatePreview(owner, revisionId), "notice_withdrawn");
    await expectCode(svc.updateDraft(owner, revisionId, { text: "Too late." }), "notice_withdrawn");
    await expectCode(svc.createRevision(owner, noticeId, { text: CORRECTED }), "notice_withdrawn");
  });

  it("never attaches audio that fails validation, even if the provider calls it a success", async () => {
    const owner = await makeUser();
    const silent = new Uint8Array(1000);
    const bad = scripted(async () => silent);
    setSpeechProvider(bad.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await expect(svc.generatePreview(owner, revisionId)).rejects.toMatchObject({ code: "synthesis_failed" });
    const row = await revision(revisionId);
    expect(row).toMatchObject({ status: "failed", audioAssetId: null });
    const db = await getDb();
    expect(await db.select().from(schema.audioAssets).where(eq(schema.audioAssets.revisionId, revisionId))).toHaveLength(0);
  });
});

describe("withdrawal", () => {
  it("withdraws exactly once and the manifest stops presenting the notice as current", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publishNew(owner);
    await svc.withdrawNotice(owner, noticeId);
    expect((await getPublicManifest(token))?.state).toBe("withdrawn");
    await expectCode(svc.withdrawNotice(owner, noticeId), "conflict");
  });
});

describe("staging cleanup races", () => {
  async function backdate(assetId: string, ageMs: number) {
    const db = await getDb();
    await db.update(schema.audioAssets).set({ createdAt: new Date(Date.now() - ageMs) }).where(eq(schema.audioAssets.id, assetId));
  }

  it("expires an old preview, returns the draft to 'draft' and removes the bytes", async () => {
    const owner = await makeUser();
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await svc.generatePreview(owner, revisionId);
    const before = await revision(revisionId);
    const db = await getDb();
    const asset = (await db.select().from(schema.audioAssets).where(eq(schema.audioAssets.id, before.audioAssetId!)))[0]!;
    await backdate(asset.id, 25 * HOUR);

    expect((await cleanup.cleanupStagingAudio()).deleted).toBe(1);
    const after = await revision(revisionId);
    expect(after).toMatchObject({ status: "draft", audioAssetId: null });
    expect(after.version).toBe(before.version + 1); // a pending approval of the old preview is now stale
    expect(await objectStore().get(asset.objectKey)).toBeNull();
  });

  it("does not clear a fresh preview that replaced the expired one while cleanup was running", async () => {
    const owner = await makeUser();
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await svc.generatePreview(owner, revisionId);
    const old = await revision(revisionId);
    await backdate(old.audioAssetId!, 25 * HOUR);

    let replacement: string | null = null;
    await cleanup.cleanupStagingAudio(new Date(), {
      // Between cleanup's read and its write, the publisher edits and generates a new preview.
      afterSelect: async () => {
        await svc.updateDraft(owner, revisionId, { text: ORIGINAL.replace("3:00", "3:30") });
        await svc.generatePreview(owner, revisionId);
        replacement = (await revision(revisionId)).audioAssetId;
      },
    });

    const after = await revision(revisionId);
    expect(replacement).not.toBe(old.audioAssetId);
    expect(after.status).toBe("preview_ready"); // the old code reset this to 'draft' and dropped the new audio
    expect(after.audioAssetId).toBe(replacement);
    const db = await getDb();
    const fresh = (await db.select().from(schema.audioAssets).where(eq(schema.audioAssets.id, replacement!)))[0]!;
    expect(fresh.deletedAt).toBeNull();
    expect(await objectStore().get(fresh.objectKey)).not.toBeNull();
  });

  it("does not undo an approval that happened while cleanup was running", async () => {
    const owner = await makeUser();
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await svc.generatePreview(owner, revisionId);
    await backdate((await revision(revisionId)).audioAssetId!, 25 * HOUR);
    await cleanup.cleanupStagingAudio(new Date(), { afterSelect: async () => void (await svc.approveRevision(owner, revisionId)) });
    const after = await revision(revisionId);
    expect(after.status).toBe("published");
    const db = await getDb();
    const published = (await db.select().from(schema.audioAssets).where(eq(schema.audioAssets.id, after.audioAssetId!)))[0]!;
    expect(published).toMatchObject({ stage: "published", contentReady: true, deletedAt: null });
    expect(await objectStore().get(published.objectKey)).not.toBeNull();
  });
});

describe("published object reconciliation", () => {
  it("removes the bytes of an approval that lost a race, after the grace period, and keeps the winner's", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publishNew(owner);
    const a = await previewedDraft(owner, noticeId, CORRECTED);
    const b = await previewedDraft(owner, noticeId, CORRECTED.replace("4:00", "5:00"));
    await svc.approveRevision(owner, a);
    await expectCode(svc.approveRevision(owner, b), "conflict");

    const db = await getDb();
    const rows = await db.select().from(schema.audioAssets).where(eq(schema.audioAssets.stage, "published"));
    const loser = rows.find((r) => r.revisionId === b)!;
    expect(loser.contentReady).toBe(false);
    expect(await objectStore().get(loser.objectKey)).not.toBeNull(); // written before it lost

    // Inside the grace period nothing is touched.
    expect((await cleanup.cleanupAbandonedPublished()).deleted).toBe(0);
    await db.update(schema.audioAssets).set({ createdAt: new Date(Date.now() - 2 * HOUR) }).where(eq(schema.audioAssets.id, loser.id));
    expect((await cleanup.cleanupAbandonedPublished()).deleted).toBe(1);
    expect(await objectStore().get(loser.objectKey)).toBeNull();

    // The notice still serves the winner, and its superseded history is untouched.
    const m = await getPublicManifest(token);
    expect(m?.state === "published" && m.revisionId).toBe(a);
    const ready = rows.filter((r) => r.contentReady);
    for (const r of ready) expect(await objectStore().get(r.objectKey)).not.toBeNull();
  });

  it("never deletes bytes that a winning approval of the same revision shares", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner);
    const rev = await previewedDraft(owner, noticeId);
    await Promise.allSettled([svc.approveRevision(owner, rev), svc.approveRevision(owner, rev)]);
    const db = await getDb();
    await db.update(schema.audioAssets).set({ createdAt: new Date(Date.now() - 2 * HOUR) }).where(eq(schema.audioAssets.revisionId, rev));
    await cleanup.cleanupAbandonedPublished();
    const winner = (await db.select().from(schema.audioAssets).where(and(eq(schema.audioAssets.revisionId, rev), eq(schema.audioAssets.contentReady, true))))[0]!;
    expect(await objectStore().get(winner.objectKey)).not.toBeNull();
  });
});

describe("retention", () => {
  it("removes expired sessions and old rate-limit counters, and nothing current", async () => {
    const db = await getDb();
    const user = await makeUser();
    const now = new Date();
    await db.insert(schema.sessions).values([
      { tokenHash: "expired-1", userId: user, expiresAt: new Date(now.getTime() - HOUR) },
      { tokenHash: "live-1", userId: user, expiresAt: new Date(now.getTime() + HOUR) },
    ]);
    await db.insert(schema.rateLimits).values([
      { key: "old", windowStart: new Date(now.getTime() - 48 * HOUR), count: 3 },
      { key: "recent", windowStart: new Date(now.getTime() - HOUR), count: 3 },
    ]);
    const removed = await cleanup.cleanupExpiredRecords(now);
    expect(removed).toEqual({ sessions: 1, rateLimits: 1 });
    expect((await db.select().from(schema.sessions)).map((s) => s.tokenHash)).toEqual(["live-1"]);
    expect((await db.select().from(schema.rateLimits)).map((r) => r.key)).toEqual(["recent"]);
  });
});
