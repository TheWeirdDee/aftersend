import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureTestEnv } from "../support/setup-integration";

configureTestEnv();

const { getDb, closeDb } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const svc = await import("@/lib/notices/revision-service");
const { setSpeechProvider } = await import("@/lib/speech");
const { TestToneProvider } = await import("@/lib/speech/test-provider");
const { resetEnvCache } = await import("@/lib/env");
const { objectStore, setObjectStore, StorageTimeoutError } = await import("@/lib/storage/audio");
const { newId } = await import("@/lib/ids");
const { eq } = await import("drizzle-orm");
type ObjectStore = import("@/lib/storage/audio").ObjectStore;

const TEXT = "Dear parents,\n\nPickup is at 3:00 PM at the main gate.";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeUser() {
  const db = await getDb();
  const id = newId("usr");
  await db.insert(schema.users).values({ id, kind: "workspace", displayName: "Test" });
  return id;
}
async function newDraft(owner: string) {
  return svc.createNotice(owner, { title: "T", text: TEXT, sourceUrl: null, voiceId: "test-tone" });
}
async function revision(id: string) {
  return ((await (await getDb()).select().from(schema.noticeRevisions).where(eq(schema.noticeRevisions.id, id))))[0]!;
}
async function attempts(revisionId: string) {
  return (await getDb()).select().from(schema.synthesisAttempts).where(eq(schema.synthesisAttempts.revisionId, revisionId));
}

/** A store that behaves like the real adapters: an operation that outlasts its `timeoutMs` throws StorageTimeoutError. */
function slowStore(real: ObjectStore, delayMs: number, seen: number[]): ObjectStore {
  const run = async <T>(timeoutMs: number | undefined, work: () => Promise<T>) => {
    seen.push(timeoutMs ?? Infinity);
    if (delayMs > (timeoutMs ?? Infinity)) {
      await sleep(timeoutMs ?? 0);
      throw new StorageTimeoutError("operation", timeoutMs ?? 0);
    }
    await sleep(delayMs);
    return work();
  };
  return {
    put: (k, b, c, o) => run(o?.timeoutMs, () => real.put(k, b, c)),
    get: (k, o) => run(o?.timeoutMs, () => real.get(k)),
    delete: (k, o) => run(o?.timeoutMs, () => real.delete(k)),
  };
}

beforeAll(async () => {
  await getDb();
});
beforeEach(() => {
  setSpeechProvider(null);
  setObjectStore(null);
  delete process.env.SYNTHESIS_DEADLINE_MS;
  delete process.env.STORAGE_TIMEOUT_MS;
  resetEnvCache();
});
afterAll(async () => {
  setObjectStore(null);
  await closeDb();
});

describe("storage inside the synthesis deadline", () => {
  it("a hung upload fails the attempt cleanly, inside the deadline, and the draft can be retried", async () => {
    process.env.SYNTHESIS_DEADLINE_MS = "3000";
    process.env.STORAGE_TIMEOUT_MS = "500";
    resetEnvCache();
    const real = objectStore();
    const seen: number[] = [];
    setObjectStore(slowStore(real, 60_000, seen)); // every storage call would take a minute
    const owner = await makeUser();
    const { revisionId } = await newDraft(owner);

    const started = Date.now();
    await expect(svc.generatePreview(owner, revisionId)).rejects.toMatchObject({ code: "synthesis_failed", retryable: true });
    // Never outlives the function: the deadline is 3 s and storage would have taken a minute. The slack is for a loaded
    // machine; the exact budget is asserted below through the timeout storage was given.
    expect(Date.now() - started).toBeLessThan(3000 + 5000);

    // The outcome was recorded, so the draft is not stuck in 'synthesizing'.
    expect((await revision(revisionId)).status).toBe("failed");
    const [attempt] = await attempts(revisionId);
    expect(attempt).toMatchObject({ outcome: "failed", errorCode: "timeout" });
    expect(seen[0]).toBeLessThanOrEqual(500);

    // And the next try works once storage recovers.
    setObjectStore(real);
    await expect(svc.generatePreview(owner, revisionId)).resolves.toMatchObject({ status: "preview_ready" });
  });

  it("hands storage only what is left of the request deadline, not its full ceiling", async () => {
    process.env.SYNTHESIS_DEADLINE_MS = "6000";
    process.env.STORAGE_TIMEOUT_MS = "30000";
    resetEnvCache();
    const real = objectStore();
    const seen: number[] = [];
    setObjectStore(slowStore(real, 0, seen));
    // The speech call itself eats most of the budget.
    const tone = new TestToneProvider();
    setSpeechProvider({
      kind: "test",
      modelId: "test-tone",
      isConfigured: () => ({ ok: true }),
      listVoices: () => tone.listVoices(),
      async synthesize(input) {
        await sleep(1500);
        return tone.synthesize(input);
      },
    });
    const owner = await makeUser();
    const { revisionId } = await newDraft(owner);
    await svc.generatePreview(owner, revisionId);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const ms of seen) expect(ms).toBeLessThan(4600); // 6000 - 1500 elapsed, less the commit reserve; far below the 30 s ceiling
  });

  it("does not start storage when the deadline is already spent", async () => {
    process.env.SYNTHESIS_DEADLINE_MS = "1000";
    process.env.STORAGE_TIMEOUT_MS = "10000";
    resetEnvCache();
    const real = objectStore();
    const seen: number[] = [];
    setObjectStore(slowStore(real, 0, seen));
    const tone = new TestToneProvider();
    setSpeechProvider({
      kind: "test",
      modelId: "test-tone",
      isConfigured: () => ({ ok: true }),
      listVoices: () => tone.listVoices(),
      async synthesize(input) {
        const result = await tone.synthesize(input);
        await sleep(950); // returns just before the deadline, with nothing left for storage
        return result;
      },
    });
    const owner = await makeUser();
    const { revisionId } = await newDraft(owner);
    await expect(svc.generatePreview(owner, revisionId)).rejects.toMatchObject({ code: "synthesis_failed" });
    expect(seen).toEqual([]);
    expect((await revision(revisionId)).status).toBe("failed");
  });
});

describe("storage during approval", () => {
  it("a hung copy becomes a retryable 503, leaves the revision approvable, and the retry publishes", async () => {
    const real = objectStore();
    const owner = await makeUser();
    const { revisionId } = await newDraft(owner);
    await svc.generatePreview(owner, revisionId);

    setObjectStore(slowStore(real, 60_000, [])); // reads time out at their ceiling
    process.env.STORAGE_TIMEOUT_MS = "500";
    resetEnvCache();
    // The adapters use their configured ceiling when no per-call value is given; the stub mirrors that.
    const stub: ObjectStore = {
      put: real.put.bind(real),
      get: async () => {
        throw new StorageTimeoutError("download", 500);
      },
      delete: real.delete.bind(real),
    };
    setObjectStore(stub);
    await expect(svc.approveRevision(owner, revisionId)).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
    expect((await revision(revisionId)).status).toBe("preview_ready");

    setObjectStore(real);
    await expect(svc.approveRevision(owner, revisionId)).resolves.toMatchObject({ revisionNumber: 1 });
  });
});
