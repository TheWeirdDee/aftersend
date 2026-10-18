import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureTestEnv } from "../support/setup-integration";

configureTestEnv();

const { getDb, closeDb } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const svc = await import("@/lib/notices/revision-service");
const { getPublicManifest, getPublicAudio } = await import("@/lib/notices/public-manifest");
const { setSpeechProvider } = await import("@/lib/speech");
const { TestToneProvider, FAIL_MARKER } = await import("@/lib/speech/test-provider");
const { SpeechProviderError } = await import("@/lib/speech/provider");
const { AssemblyAiTtsProvider } = await import("@/lib/speech/assemblyai");
const { newId } = await import("@/lib/ids");
const { eq } = await import("drizzle-orm");

const ORIGINAL = "Dear parents,\n\nPickup is at 3:00 PM at the main gate.";
const CORRECTED = "Dear parents,\n\nPickup is at 4:00 PM at the main gate.";

async function makeUser() {
  const db = await getDb();
  const id = newId("usr");
  await db.insert(schema.users).values({ id, kind: "workspace", displayName: "Test" });
  return id;
}

async function publishNew(owner: string, text = ORIGINAL) {
  const { noticeId, revisionId } = await svc.createNotice(owner, { title: "Pickup notice", text, sourceUrl: null, voiceId: "test-tone" });
  await svc.generatePreview(owner, revisionId);
  await svc.approveRevision(owner, revisionId);
  const db = await getDb();
  const notice = (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
  return { noticeId, revisionId, token: notice.publicToken };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  await getDb();
});
beforeEach(() => setSpeechProvider(null));
afterAll(async () => {
  await closeDb();
});

describe("first publication", () => {
  it("creates, generates, approves and serves a self-consistent manifest", async () => {
    const owner = await makeUser();
    const { token, revisionId } = await publishNew(owner);
    const m = await getPublicManifest(token);
    expect(m?.state).toBe("published");
    if (m?.state !== "published") return;
    expect(m.revisionId).toBe(revisionId);
    expect(m.revisionNumber).toBe(1);
    expect(m.displayText).toBe(ORIGINAL);
    expect(m.audioUrl).toContain(`/api/public/${token}/audio/${revisionId}/${m.audioSha256}.wav`);
    expect(m.audioIsTestTone).toBe(true);
    expect(await getPublicAudio(token, revisionId, m.audioSha256)).not.toBeNull();
  });

  it("blocks approval before audio exists", async () => {
    const owner = await makeUser();
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await expectCode(svc.approveRevision(owner, revisionId), "audio_not_ready");
  });

  it("unpublished notices are not publicly reachable", async () => {
    const owner = await makeUser();
    const { noticeId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    const db = await getDb();
    const n = (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
    expect(await getPublicManifest(n.publicToken)).toBeNull();
  });

  it("rejects an unknown voice", async () => {
    const owner = await makeUser();
    await expectCode(
      svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "made-up" }),
      "validation_failed",
    );
  });
});

describe("correction at the same link", () => {
  it("promotes a new revision with new audio while the token stays identical", async () => {
    const owner = await makeUser();
    const first = await publishNew(owner);
    const before = await getPublicManifest(first.token);
    const { revisionId } = await svc.createRevision(owner, first.noticeId, { text: CORRECTED });
    const draft = await svc.getRevisionForOwner(owner, revisionId);
    expect(draft.revision.updateSummary).toEqual([{ changedField: "time", previousValue: "3:00 PM", currentValue: "4:00 PM" }]);
    expect(draft.revision.speechText).toContain("four p.m.");

    // Until approval the public link still serves revision 1.
    await svc.generatePreview(owner, revisionId);
    expect((await getPublicManifest(first.token)) as unknown).toEqual(before);

    await svc.approveRevision(owner, revisionId);
    const after = await getPublicManifest(first.token);
    if (before?.state !== "published" || after?.state !== "published") throw new Error("expected published");
    expect(after.revisionNumber).toBe(2);
    expect(after.revisionId).toBe(revisionId);
    expect(after.displayText).toBe(CORRECTED);
    expect(after.audioSha256).not.toBe(before.audioSha256);
    expect(after.audioUrl).not.toBe(before.audioUrl);
    expect(after.updateSummary?.[0]?.currentValue).toBe("4:00 PM");
    // Old audio is no longer served from the public link.
    expect(await getPublicAudio(first.token, before.revisionId, before.audioSha256)).toBeNull();
    // Version history is preserved for the owner.
    const detail = await svc.getNoticeDetail(owner, first.noticeId);
    expect(detail.revisions.map((r) => r.status).sort()).toEqual(["published", "superseded"]);
  });

  it("editing a draft after preview invalidates the preview", async () => {
    const owner = await makeUser();
    const first = await publishNew(owner);
    const { revisionId } = await svc.createRevision(owner, first.noticeId, { text: CORRECTED });
    await svc.generatePreview(owner, revisionId);
    await svc.updateDraft(owner, revisionId, { text: CORRECTED.replace("4:00", "4:30") });
    const r = await svc.getRevisionForOwner(owner, revisionId);
    expect(r.revision.status).toBe("draft");
    expect(r.revision.audioAssetId).toBeNull();
    expect(r.revision.confirmedCriticalFacts).toBe(false);
    await expectCode(svc.approveRevision(owner, revisionId), "audio_not_ready");
  });
});

describe("failure safety", () => {
  it("a failed synthesis cannot promote and the previous version stays live", async () => {
    const owner = await makeUser();
    const first = await publishNew(owner);
    const before = await getPublicManifest(first.token);
    const { revisionId } = await svc.createRevision(owner, first.noticeId, { text: `${CORRECTED} ${FAIL_MARKER}` });
    await expectCode(svc.generatePreview(owner, revisionId), "synthesis_failed");
    const r = await svc.getRevisionForOwner(owner, revisionId);
    expect(r.revision.status).toBe("failed");
    expect(r.attempts[0]?.outcome).toBe("failed");
    await expectCode(svc.approveRevision(owner, revisionId), "audio_not_ready");
    expect(await getPublicManifest(first.token)).toEqual(before);
  });

  it("retries transient provider errors with a bound", async () => {
    const owner = await makeUser();
    const real = new TestToneProvider();
    let calls = 0;
    setSpeechProvider({
      kind: "test",
      modelId: "test-tone",
      isConfigured: () => ({ ok: true }),
      listVoices: () => real.listVoices(),
      synthesize: async (input) => {
        calls++;
        if (calls === 1) throw new SpeechProviderError("network", "flaky", true);
        return real.synthesize(input);
      },
    });
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await svc.generatePreview(owner, revisionId);
    const r = await svc.getRevisionForOwner(owner, revisionId);
    expect(calls).toBe(2);
    expect(r.attempts[0]).toMatchObject({ outcome: "success", retries: 1 });
  });

  it("gives up after the retry bound", async () => {
    const owner = await makeUser();
    let calls = 0;
    setSpeechProvider({
      kind: "test",
      modelId: "test-tone",
      isConfigured: () => ({ ok: true }),
      listVoices: () => [{ id: "test-tone", label: "t" }],
      synthesize: async () => {
        calls++;
        throw new SpeechProviderError("timeout", "slow", true);
      },
    });
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await expectCode(svc.generatePreview(owner, revisionId), "synthesis_failed");
    expect(calls).toBe(3);
  });

  it("rejects malformed audio from the provider", async () => {
    const owner = await makeUser();
    setSpeechProvider({
      kind: "test",
      modelId: "test-tone",
      isConfigured: () => ({ ok: true }),
      listVoices: () => [{ id: "test-tone", label: "t" }],
      synthesize: async () => ({
        audio: new Uint8Array(500).fill(7),
        mimeType: "audio/wav",
        durationMs: 1,
        providerRequestId: null,
        providerModel: null,
        startedAt: new Date(),
        firstAudioAt: null,
        completedAt: new Date(),
      }),
    });
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    await expectCode(svc.generatePreview(owner, revisionId), "synthesis_failed");
    expect((await svc.getRevisionForOwner(owner, revisionId)).revision.status).toBe("failed");
  });

  it("discards audio when the text changed during synthesis", async () => {
    const owner = await makeUser();
    const real = new TestToneProvider();
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    setSpeechProvider({
      kind: "test",
      modelId: "test-tone",
      isConfigured: () => ({ ok: true }),
      listVoices: () => real.listVoices(),
      synthesize: async (input) => {
        const db = await getDb();
        // Simulate a concurrent edit landing mid-synthesis.
        await db.update(schema.noticeRevisions).set({ synthesisKey: "changed" }).where(eq(schema.noticeRevisions.id, revisionId));
        return real.synthesize(input);
      },
    });
    await expectCode(svc.generatePreview(owner, revisionId), "conflict");
    const r = await svc.getRevisionForOwner(owner, revisionId);
    expect(r.revision.audioAssetId).toBeNull();
    expect(r.attempts[0]?.outcome).toBe("cancelled");
  });

  it("refuses to synthesize with the AssemblyAI adapter when it is not configured", async () => {
    const owner = await makeUser();
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    const aai = new AssemblyAiTtsProvider();
    setSpeechProvider({
      kind: "assemblyai",
      modelId: null,
      isConfigured: () => aai.isConfigured(),
      listVoices: () => [{ id: "test-tone", label: "t" }],
      synthesize: (i) => aai.synthesize(i),
    });
    await expectCode(svc.generatePreview(owner, revisionId), "provider_not_configured");
  });

  it("blocks generation for ambiguous dates", async () => {
    const owner = await makeUser();
    const { revisionId } = await svc.createNotice(owner, {
      title: "T",
      text: "School resumes on 05/06/26 at 8:00 AM.",
      sourceUrl: null,
      voiceId: "test-tone",
    });
    await expectCode(svc.generatePreview(owner, revisionId), "validation_failed");
  });
});

describe("idempotency", () => {
  it("a repeated generate request reuses the ready preview", async () => {
    const owner = await makeUser();
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    const a = await svc.generatePreview(owner, revisionId);
    const b = await svc.generatePreview(owner, revisionId);
    expect(a.reused).toBe(false);
    expect(b.reused).toBe(true);
    expect((await svc.getRevisionForOwner(owner, revisionId)).attempts).toHaveLength(1);
  });

  it("concurrent generate requests produce one synthesis", async () => {
    const owner = await makeUser();
    const { revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: null, voiceId: "test-tone" });
    const results = await Promise.allSettled([svc.generatePreview(owner, revisionId), svc.generatePreview(owner, revisionId)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect((await svc.getRevisionForOwner(owner, revisionId)).attempts).toHaveLength(1);
  });

  it("approving twice does not create a second revision", async () => {
    const owner = await makeUser();
    const { revisionId, noticeId } = await publishNew(owner);
    const again = await svc.approveRevision(owner, revisionId);
    expect(again.alreadyPublished).toBe(true);
    expect((await svc.getNoticeDetail(owner, noticeId)).revisions).toHaveLength(1);
  });
});

describe("concurrent corrections", () => {
  it("a stale draft cannot overwrite a newer publication", async () => {
    const owner = await makeUser();
    const first = await publishNew(owner);
    const a = await svc.createRevision(owner, first.noticeId, { text: CORRECTED });
    const b = await svc.createRevision(owner, first.noticeId, { text: CORRECTED.replace("4:00", "5:00") });
    await svc.generatePreview(owner, a.revisionId);
    await svc.generatePreview(owner, b.revisionId);
    await svc.approveRevision(owner, a.revisionId);
    await expectCode(svc.approveRevision(owner, b.revisionId), "conflict");
    const m = await getPublicManifest(first.token);
    expect(m?.state === "published" && m.displayText).toBe(CORRECTED);
  });

  it("simultaneous approvals: exactly one wins", async () => {
    const owner = await makeUser();
    const first = await publishNew(owner);
    const a = await svc.createRevision(owner, first.noticeId, { text: CORRECTED });
    const b = await svc.createRevision(owner, first.noticeId, { text: CORRECTED.replace("4:00", "5:00") });
    await svc.generatePreview(owner, a.revisionId);
    await svc.generatePreview(owner, b.revisionId);
    const results = await Promise.allSettled([svc.approveRevision(owner, a.revisionId), svc.approveRevision(owner, b.revisionId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const m = await getPublicManifest(first.token);
    if (m?.state !== "published") throw new Error("expected published");
    expect(m.revisionNumber).toBe(2);
    const winner = results[0]!.status === "fulfilled" ? a.revisionId : b.revisionId;
    expect(m.revisionId).toBe(winner);
  });
});

describe("authorization", () => {
  it("another publisher cannot read, edit, generate, approve or withdraw", async () => {
    const owner = await makeUser();
    const intruder = await makeUser();
    const first = await publishNew(owner);
    const { revisionId } = await svc.createRevision(owner, first.noticeId, { text: CORRECTED });
    await expectCode(svc.getNoticeDetail(intruder, first.noticeId), "not_found");
    await expectCode(svc.createRevision(intruder, first.noticeId, { text: "hijack" }), "not_found");
    await expectCode(svc.updateDraft(intruder, revisionId, { text: "hijack" }), "not_found");
    await expectCode(svc.generatePreview(intruder, revisionId), "not_found");
    await expectCode(svc.approveRevision(intruder, revisionId), "not_found");
    await expectCode(svc.withdrawNotice(intruder, first.noticeId), "not_found");
    expect(await svc.listNotices(intruder)).toEqual([]);
  });
});

describe("withdrawal", () => {
  it("shows a withdrawn state and stops serving audio", async () => {
    const owner = await makeUser();
    const first = await publishNew(owner);
    const before = await getPublicManifest(first.token);
    await svc.withdrawNotice(owner, first.noticeId);
    const m = await getPublicManifest(first.token);
    expect(m?.state).toBe("withdrawn");
    if (before?.state !== "published") throw new Error("expected published");
    expect(await getPublicAudio(first.token, before.revisionId, before.audioSha256)).toBeNull();
    await expectCode(svc.createRevision(owner, first.noticeId, { text: CORRECTED }), "notice_withdrawn");
  });

  it("rejects malformed public tokens without querying", async () => {
    expect(await getPublicManifest("../../etc/passwd")).toBeNull();
  });
});
