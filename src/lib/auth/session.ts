import "server-only";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "../db/client";
import { sessions, users, type User } from "../db/schema";
import { newId, sha256Hex } from "../ids";
import { AppError } from "../http/errors";

export const SESSION_COOKIE = "aftersend_session";
const SESSION_DAYS = 30;

export async function createWorkspaceUser(kind: User["kind"], displayName: string) {
  const db = await getDb();
  const id = newId("usr");
  await db.insert(users).values({ id, kind, displayName });
  return id;
}

/** Issues an httpOnly, SameSite=Lax session cookie. Only the token's hash is stored. */
export async function startSession(userId: string) {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ tokenHash: sha256Hex(token), userId, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !process.env.AFTERSEND_INSECURE_COOKIES,
    path: "/",
    expires: expiresAt,
  });
}

export async function userForToken(token: string | undefined | null): Promise<User | null> {
  if (!token || token.length > 100) return null;
  const db = await getDb();
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  return userForToken(jar.get(SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AppError("unauthenticated", "Sign in to your workspace first.");
  return user;
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
  }
  jar.delete(SESSION_COOKIE);
}
