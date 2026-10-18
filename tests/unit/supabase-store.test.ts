import { describe, expect, it } from "vitest";
import { SupabaseStore } from "@/lib/storage/audio";

const KEY = `published/ntc_1/rev_1/${"b".repeat(64)}.wav`;

function fakeFetch(responses: Record<string, Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responses[init?.method ?? "GET"] ?? new Response(null, { status: 500 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("SupabaseStore", () => {
  it("uploads to the private bucket with the server key", async () => {
    const { impl, calls } = fakeFetch({ POST: new Response("{}", { status: 200 }) });
    await new SupabaseStore("https://x.supabase.co/", "audio", "sb_secret_abc", impl).put(KEY, new Uint8Array([1]), "audio/wav");
    expect(calls[0]!.url).toBe(`https://x.supabase.co/storage/v1/object/audio/${KEY}`);
    const h = calls[0]!.init!.headers as Record<string, string>;
    expect(h.apikey).toBe("sb_secret_abc");
    expect(h.Authorization).toBeUndefined();
    expect(h["x-upsert"]).toBe("true");
  });

  it("sends legacy JWT keys as a bearer token", async () => {
    const { impl, calls } = fakeFetch({ GET: new Response(new Uint8Array([7, 8])) });
    const bytes = await new SupabaseStore("https://x.supabase.co", "audio", "eyJhbGciOi", impl).get(KEY);
    expect(Array.from(bytes!)).toEqual([7, 8]);
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer eyJhbGciOi");
  });

  it("returns null for missing objects and rejects unsafe keys", async () => {
    const { impl } = fakeFetch({ GET: new Response("not found", { status: 404 }) });
    const s = new SupabaseStore("https://x.supabase.co", "audio", "k", impl);
    expect(await s.get(KEY)).toBeNull();
    await expect(s.get("../../secrets.wav")).rejects.toThrow();
  });
});
