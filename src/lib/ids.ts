import { createHash, randomBytes } from "node:crypto";

/** Opaque internal identifier, e.g. `rev_3b9c…`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

/** 128 bits of entropy, URL-safe. Used for the stable public listener link. */
export function newPublicToken(): string {
  return randomBytes(16).toString("base64url");
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const ID_PATTERN = /^[a-z]{2,6}_[0-9a-f]{24}$/;
