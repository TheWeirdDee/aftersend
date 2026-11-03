import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../env";

/** Per-call options. `timeoutMs` overrides the store's default ceiling for this one operation. */
export type StoreOptions = { timeoutMs?: number };

export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string, opts?: StoreOptions): Promise<void>;
  get(key: string, opts?: StoreOptions): Promise<Uint8Array | null>;
  delete(key: string, opts?: StoreOptions): Promise<void>;
}

/** A storage operation did not finish inside its deadline. Callers decide whether the request can still succeed. */
export class StorageTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`Storage ${what} did not finish within ${ms} ms.`);
    this.name = "StorageTimeoutError";
  }
}

export const DEFAULT_STORAGE_TIMEOUT_MS = 10_000;

/**
 * Runs one storage operation under a hard deadline. The operation gets an AbortSignal so the request is cancelled, and
 * the call is also raced against a timer, so an implementation that ignores the signal still cannot hold the request
 * past its deadline.
 */
export async function withStorageDeadline<T>(what: string, ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const limit = Math.max(1, Math.floor(ms));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new StorageTimeoutError(what, limit));
    }, limit);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } catch (err) {
    if (controller.signal.aborted) throw new StorageTimeoutError(what, limit);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const KEY_PATTERN = /^(staging|published)\/[a-z0-9_]+\/[a-z0-9_]+\/[a-f0-9]{64}\.(wav|mp3)$/;

/** Object keys are generated internally; this guard rejects anything else, including traversal attempts. */
export function assertSafeKey(key: string) {
  if (!KEY_PATTERN.test(key)) throw new Error("Refusing unsafe object key.");
}

export function stagingKey(noticeId: string, revisionId: string, sha256: string, ext: "wav" | "mp3") {
  return `staging/${noticeId}/${revisionId}/${sha256}.${ext}`;
}

export function publishedKey(noticeId: string, revisionId: string, sha256: string, ext: "wav" | "mp3") {
  return `published/${noticeId}/${revisionId}/${sha256}.${ext}`;
}

class LocalStore implements ObjectStore {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Refusing unsafe object path.");
    return full;
  }

  async put(key: string, bytes: Uint8Array) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    // A unique name per write: two concurrent puts of the same key must not share a temp file.
    const tmp = `${full}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, bytes);
    try {
      await fs.rename(tmp, full);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      // Keys are content-addressed, so a concurrent writer of the same key wrote the same bytes. Windows refuses
      // to rename over a file that is open or was just replaced; if the target already holds these bytes, we are done.
      const existing = await fs.readFile(full).catch(() => null);
      if (!existing || Buffer.compare(existing, bytes) !== 0) throw err;
    }
  }

  async get(key: string) {
    try {
      return new Uint8Array(await fs.readFile(this.resolve(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

class S3Store implements ObjectStore {
  private clientPromise: Promise<import("@aws-sdk/client-s3").S3Client>;

  constructor(
    private readonly bucket: string,
    private readonly timeoutMs: number = DEFAULT_STORAGE_TIMEOUT_MS,
  ) {
    const e = env();
    this.clientPromise = import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          region: e.OBJECT_STORAGE_REGION,
          endpoint: e.OBJECT_STORAGE_ENDPOINT,
          forcePathStyle: true,
          credentials: {
            accessKeyId: e.OBJECT_STORAGE_ACCESS_KEY ?? "",
            secretAccessKey: e.OBJECT_STORAGE_SECRET_KEY ?? "",
          },
        }),
    );
  }

  async put(key: string, bytes: Uint8Array, contentType: string, opts?: StoreOptions) {
    assertSafeKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    await withStorageDeadline("upload", opts?.timeoutMs ?? this.timeoutMs, (abortSignal) =>
      client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }), { abortSignal }),
    );
  }

  async get(key: string, opts?: StoreOptions) {
    assertSafeKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    try {
      return await withStorageDeadline("download", opts?.timeoutMs ?? this.timeoutMs, async (abortSignal) => {
        const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal });
        return res.Body ? new Uint8Array(await res.Body.transformToByteArray()) : null;
      });
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async delete(key: string, opts?: StoreOptions) {
    assertSafeKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    await withStorageDeadline("delete", opts?.timeoutMs ?? this.timeoutMs, (abortSignal) =>
      client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal }),
    );
  }
}

/** Supabase Storage over its REST API with a server-only key. The bucket stays private. */
export class SupabaseStore implements ObjectStore {
  constructor(
    private readonly baseUrl: string,
    private readonly bucket: string,
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs: number = DEFAULT_STORAGE_TIMEOUT_MS,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { apikey: this.key, ...extra };
    // Legacy service-role keys are JWTs and go in Authorization; new sb_secret_ keys use apikey alone.
    if (this.key.startsWith("eyJ")) h.Authorization = `Bearer ${this.key}`;
    return h;
  }

  private url(key: string) {
    assertSafeKey(key);
    return `${this.baseUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(this.bucket)}/${key}`;
  }

  async put(key: string, bytes: Uint8Array, contentType: string, opts?: StoreOptions) {
    const url = this.url(key);
    await withStorageDeadline("upload", opts?.timeoutMs ?? this.timeoutMs, async (signal) => {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: this.headers({ "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "private, no-store" }),
        body: bytes as unknown as BodyInit,
        signal,
      });
      if (!res.ok) throw new Error(`Storage upload failed (${res.status}).`);
    });
  }

  async get(key: string, opts?: StoreOptions) {
    const url = this.url(key);
    return withStorageDeadline("download", opts?.timeoutMs ?? this.timeoutMs, async (signal) => {
      const res = await this.fetchImpl(url, { headers: this.headers(), cache: "no-store", signal });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Storage download failed (${res.status}).`);
      return new Uint8Array(await res.arrayBuffer());
    });
  }

  async delete(key: string, opts?: StoreOptions) {
    assertSafeKey(key);
    await withStorageDeadline("delete", opts?.timeoutMs ?? this.timeoutMs, async (signal) => {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(this.bucket)}`, {
        method: "DELETE",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefixes: [key] }),
        signal,
      });
      if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status}).`);
    });
  }
}

/**
 * Writes, reads back and removes a tiny object, proving the configured store is reachable and writable. Every call uses
 * its own key: concurrent readiness checks (or a check overlapping a deploy check) must never overwrite or delete each
 * other's object, which would report a healthy store as broken.
 */
export async function probeObjectStore(s: ObjectStore = objectStore()): Promise<void> {
  const key = `staging/health/probe/${randomBytes(32).toString("hex")}.wav`;
  const payload = new TextEncoder().encode(`probe-${randomUUID()}`);
  let back: Uint8Array | null = null;
  try {
    await s.put(key, payload, "audio/wav");
    back = await s.get(key);
  } finally {
    // Best effort: a failed cleanup must not hide the real result, and a leftover probe is a few bytes under staging/.
    await s.delete(key).catch(() => undefined);
  }
  if (!back || back.byteLength !== payload.byteLength || back.some((b, i) => b !== payload[i])) {
    throw new Error("Object store read-back did not match what was written.");
  }
}

let store: ObjectStore | null = null;

export function objectStore(): ObjectStore {
  if (store) return store;
  const e = env();
  if (e.STORAGE_DRIVER === "supabase") {
    if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY || !e.OBJECT_STORAGE_BUCKET) {
      throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OBJECT_STORAGE_BUCKET are required for the supabase storage driver.");
    }
    store = new SupabaseStore(e.SUPABASE_URL, e.OBJECT_STORAGE_BUCKET, e.SUPABASE_SERVICE_ROLE_KEY, fetch, e.STORAGE_TIMEOUT_MS);
  } else if (e.STORAGE_DRIVER === "s3") {
    if (!e.OBJECT_STORAGE_BUCKET) throw new Error("OBJECT_STORAGE_BUCKET is required for the s3 storage driver.");
    store = new S3Store(e.OBJECT_STORAGE_BUCKET, e.STORAGE_TIMEOUT_MS);
  } else {
    store = new LocalStore(e.LOCAL_STORAGE_DIR);
  }
  return store;
}

/** Test hook. */
export function setObjectStore(s: ObjectStore | null) {
  store = s;
}
