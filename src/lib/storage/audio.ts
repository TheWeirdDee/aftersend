import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../env";

export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
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
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, full);
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

  constructor(private readonly bucket: string) {
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

  async put(key: string, bytes: Uint8Array, contentType: string) {
    assertSafeKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  }

  async get(key: string) {
    assertSafeKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const res = await (await this.clientPromise).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body ? new Uint8Array(await res.Body.transformToByteArray()) : null;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async delete(key: string) {
    assertSafeKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let store: ObjectStore | null = null;

export function objectStore(): ObjectStore {
  if (store) return store;
  const e = env();
  if (e.STORAGE_DRIVER === "s3") {
    if (!e.OBJECT_STORAGE_BUCKET) throw new Error("OBJECT_STORAGE_BUCKET is required for the s3 storage driver.");
    store = new S3Store(e.OBJECT_STORAGE_BUCKET);
  } else {
    store = new LocalStore(e.LOCAL_STORAGE_DIR);
  }
  return store;
}

/** Test hook. */
export function setObjectStore(s: ObjectStore | null) {
  store = s;
}
