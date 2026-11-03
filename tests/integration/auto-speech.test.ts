import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureTestEnv } from "../support/setup-integration";

configureTestEnv();

const { getDb, closeDb } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const svc = await import("@/lib/notices/revision-service");
const { setSpeechProvider } = await import("@/lib/speech");
const { TestToneProvider } = await import("@/lib/speech/test-provider");
const { resetEnvCache } = await import("@/lib/env");
const { newId } = await import("@/lib/ids");
const { eq } = await import("drizzle-orm");
type SpeechProvider = import("@/lib/speech/provider").SpeechProvider;

/**
 * The editor refreshes the spoken preview on its own while someone types, so a person can edit while an earlier preview is
 * still being prepared. The earlier result must then never become the preview of the newer text.
 */
const FIRST = "Dear parents,\n\nPickup is at 3:00 PM at the main gate.";
const SECOND = "Dear parents,\n\nPickup is at 4:00 PM at the main gate.";

async function makeUser() {
  const db = await getDb();
  const id = newId("usr");
  await db.insert(schema.users).values({ id, kind: "demo", displayName: "Guest" });
  return id;
}
const row = async (id: string) => (await (await getDb()).select().from(schema.noticeRevisions).where(eq(schema.noticeRevisions.id, id)))[0]!;

/** A speech double whose first call waits until released, so a test can edit while it is in flight. */
function gated() {
  const tone = new TestToneProvider();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const started: string[] = [];
  let entered!: () => void;
  const inFlight = new Promise<void>((r) => (entered = r));
  const provider: SpeechProvider = {
    kind: "test",
    modelId: "test-tone",
    isConfigured: () => ({ ok: true }),
    listVoices: () => tone.listVoices(),
    async synthesize(input) {
      started.push(input.text);
      if (started.length === 1) {
        entered();
        await gate;
      }
      return tone.synthesize(input);
    },
  };
  return { provider, release: () => release(), inFlight, started };
}

beforeAll(async () => {
  await getDb();
});
beforeEach(() => {
  setSpeechProvider(null);
  resetEnvCache();
});
afterAll(async () => {
  await closeDb();
});

describe("editing while a spoken preview is being prepared", () => {
  it("accepts the edit, and the older result never becomes the preview of the newer text", async () => {
    const owner = await makeUser();
    const g = gated();
    setSpeechProvider(g.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "Pickup", text: FIRST, sourceUrl: null, voiceId: "test-tone" });

    const slow = svc.generatePreview(owner, revisionId);
    await g.inFlight;
    expect((await row(revisionId)).status).toBe("synthesizing");

    const edit = await svc.updateDraft(owner, revisionId, { text: SECOND });
    expect(edit.status).toBe("draft");
    expect((await row(revisionId)).synthesisClaim).toBeNull();

    g.release();
    await expect(slow).rejects.toMatchObject({ code: "conflict", details: { reason: "superseded_audio" } });
    const afterOld = await row(revisionId);
    expect(afterOld.status).toBe("draft");
    expect(afterOld.audioAssetId).toBeNull();
    expect(afterOld.displayText).toContain("4:00 PM");

    // The newer text gets its own audio, made from the newer script.
    await svc.generatePreview(owner, revisionId);
    const done = await row(revisionId);
    expect(done.status).toBe("preview_ready");
    // The script spells times out ("four o'clock"), so check the spoken text against the 3 PM version instead.
    expect(g.started.at(-1)).not.toBe(g.started[0]);
    expect(g.started.at(-1)).toMatch(/four|4/i);
    expect(done.audioAssetId).not.toBeNull();
  });

  it("keeps the running attempt when the edit does not change what is spoken", async () => {
    const owner = await makeUser();
    const g = gated();
    setSpeechProvider(g.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "Pickup", text: FIRST, sourceUrl: null, voiceId: "test-tone" });
    const slow = svc.generatePreview(owner, revisionId);
    await g.inFlight;

    const edit = await svc.updateDraft(owner, revisionId, { sourceUrl: "https://example.com/policy" });
    expect(edit.status).toBe("synthesizing");
    g.release();
    await expect(slow).resolves.toMatchObject({ status: "preview_ready" });
    expect((await row(revisionId)).sourceUrl).toBe("https://example.com/policy");
  });

  it("answers a second request for the same text with 'in progress' instead of paying twice", async () => {
    const owner = await makeUser();
    const g = gated();
    setSpeechProvider(g.provider);
    const { revisionId } = await svc.createNotice(owner, { title: "Pickup", text: FIRST, sourceUrl: null, voiceId: "test-tone" });
    const first = svc.generatePreview(owner, revisionId);
    await g.inFlight;
    await expect(svc.generatePreview(owner, revisionId)).rejects.toMatchObject({ code: "synthesis_in_progress" });
    g.release();
    await first;
    expect(g.started).toHaveLength(1);
  });

  it("refuses edits to a published revision, still", async () => {
    const owner = await makeUser();
    setSpeechProvider(new TestToneProvider());
    const { revisionId } = await svc.createNotice(owner, { title: "Pickup", text: FIRST, sourceUrl: null, voiceId: "test-tone" });
    await svc.generatePreview(owner, revisionId);
    await svc.approveRevision(owner, revisionId);
    await expect(svc.updateDraft(owner, revisionId, { text: SECOND })).rejects.toMatchObject({ details: { reason: "locked" } });
  });
});
