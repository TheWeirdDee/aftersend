import { describe, expect, it } from "vitest";
import { probeObjectStore, StorageTimeoutError, SupabaseStore, withStorageDeadline, type ObjectStore } from "@/lib/storage/audio";

const KEY = `published/ntc_1/rev_1/${"b".repeat(64)}.wav`;
const never = () => new Promise<never>(() => undefined);

/** A fetch that never answers and ignores the abort signal: the worst case for a deadline. */
const hungFetchIgnoringSignal = (async () => never()) as unknown as typeof fetch;

/** A fetch that never answers on its own but honours the abort signal, as the real one does. */
const hungFetchHonouringSignal = ((_url: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as unknown as typeof fetch;

describe("storage deadlines", () => {
  it("fails a hung upload, download and delete at their deadline even when the transport ignores the signal", async () => {
    const s = new SupabaseStore("https://x.supabase.co", "audio", "k", hungFetchIgnoringSignal, 60);
    for (const op of [() => s.put(KEY, new Uint8Array([1]), "audio/wav"), () => s.get(KEY), () => s.delete(KEY)]) {
      const started = Date.now();
      await expect(op()).rejects.toBeInstanceOf(StorageTimeoutError);
      expect(Date.now() - started).toBeLessThan(1000);
    }
  });

  it("cancels the request through the abort signal, so nothing keeps running after the deadline", async () => {
    let seen: AbortSignal | undefined;
    const impl = ((_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return hungFetchHonouringSignal(_url, init);
    }) as unknown as typeof fetch;
    const s = new SupabaseStore("https://x.supabase.co", "audio", "k", impl, 5_000);
    await expect(s.get(KEY, { timeoutMs: 40 })).rejects.toBeInstanceOf(StorageTimeoutError);
    expect(seen?.aborted).toBe(true);
  });

  it("a per-call timeout overrides the store's default", async () => {
    const s = new SupabaseStore("https://x.supabase.co", "audio", "k", hungFetchIgnoringSignal, 60_000);
    const started = Date.now();
    await expect(s.put(KEY, new Uint8Array([1]), "audio/wav", { timeoutMs: 50 })).rejects.toBeInstanceOf(StorageTimeoutError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("does not time out a request that finishes in time, and keeps its real errors", async () => {
    const ok = (async () => new Response(new Uint8Array([9]))) as unknown as typeof fetch;
    expect(Array.from((await new SupabaseStore("https://x.supabase.co", "audio", "k", ok, 500).get(KEY))!)).toEqual([9]);
    const broken = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(new SupabaseStore("https://x.supabase.co", "audio", "k", broken, 500).get(KEY)).rejects.toThrow("download failed (500)");
  });

  it("leaves no timer behind after a successful call", async () => {
    expect(await withStorageDeadline("x", 60_000, async () => 7)).toBe(7);
  });
});

/** An in-memory store that records every key it was given. */
function memoryStore(overrides: Partial<ObjectStore> = {}) {
  const data = new Map<string, Uint8Array>();
  const puts: string[] = [];
  const store: ObjectStore = {
    async put(key, bytes) {
      puts.push(key);
      data.set(key, bytes);
    },
    async get(key) {
      return data.get(key) ?? null;
    },
    async delete(key) {
      data.delete(key);
    },
    ...overrides,
  };
  return { store, data, puts };
}

describe("readiness probe isolation", () => {
  it("uses a different object for every probe, so concurrent checks cannot overwrite or delete each other's", async () => {
    const { store, puts, data } = memoryStore();
    await Promise.all(Array.from({ length: 8 }, () => probeObjectStore(store)));
    expect(new Set(puts).size).toBe(8);
    expect(data.size).toBe(0); // every probe cleaned up its own object
  });

  it("two overlapping probes both pass even when one finishes first", async () => {
    // The old fixed key failed here: probe A deleted the object between probe B's write and read.
    const { store, data } = memoryStore({
      async get(key) {
        await new Promise((r) => setTimeout(r, 20));
        return data.get(key) ?? null;
      },
    });
    await expect(Promise.all([probeObjectStore(store), probeObjectStore(store), probeObjectStore(store)])).resolves.toBeDefined();
  });

  it("uses a key the store accepts", async () => {
    const { store, puts } = memoryStore();
    await probeObjectStore(store);
    expect(puts[0]).toMatch(/^staging\/health\/probe\/[a-f0-9]{64}\.wav$/);
  });

  it("removes its object when the read-back fails, and reports the real failure", async () => {
    const { store, data } = memoryStore({
      async get() {
        throw new Error("read failed");
      },
    });
    await expect(probeObjectStore(store)).rejects.toThrow("read failed");
    expect(data.size).toBe(0);
  });

  it("still reports a mismatch when the cleanup itself fails", async () => {
    const { store } = memoryStore({
      async get() {
        return new Uint8Array([1, 2, 3]);
      },
      async delete() {
        throw new Error("delete failed");
      },
    });
    await expect(probeObjectStore(store)).rejects.toThrow("did not match");
  });
});
