import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { authChallenges, notices, sessions, users, type User } from "../db/schema";
import { emailConfigured, EmailError, sendEmail } from "../email";
import { env } from "../env";
import { AppError } from "../http/errors";
import { enforceRateLimit } from "../http/rate-limit";
import { newId } from "../ids";
import { emailRef, log } from "../log";

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 30_000;
const HOUR = 3600_000;

const emailSchema = z.string().trim().toLowerCase().max(254).email();

/** Lower-cases and validates an address. Returns null when it is not a plausible email. */
export function normalizeEmail(raw: string): string | null {
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Accepts "123456", "123 456" and "123-456". */
export function normalizeCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

function authSecret(): string {
  const configured = env().AUTH_SECRET;
  if (configured) return configured;
  // A fixed fallback is acceptable only where nothing real is protected.
  if (env().NODE_ENV === "production") throw new AppError("internal", "AUTH_SECRET is not configured.");
  return "aftersend-development-only-secret";
}

/** A leaked database row must not reveal the code, so only a keyed hash bound to the challenge is stored. */
export function hashCode(challengeId: string, code: string): string {
  return createHmac("sha256", authSecret()).update(`${challengeId}:${code}`).digest("hex");
}

function invalidCode() {
  // One message for every failure (no such code, expired, used, locked) so nothing about the account leaks.
  return new AppError("invalid_code", "That code is incorrect or has expired. Request a new one.");
}

function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
    if (e.code === "23505") return true;
  }
  return false;
}

/**
 * Starts a sign-in. The response is identical whether or not the address already has an account, and nothing
 * here reads the users table by address, so neither the response nor its timing says whether an account exists.
 *
 * `linkUserId` is the workspace the browser is currently signed in to. Only a code requested from that
 * workspace, and verified from it, may attach the email to it or merge it into an existing account.
 */
export async function requestCode(input: { email: string; linkUserId: string | null; ip: string }): Promise<{ cooldownSec: number }> {
  const email = normalizeEmail(input.email);
  if (!email) throw new AppError("validation_failed", "Enter a valid email address.");
  const config = emailConfigured();
  if (!config.ok) {
    log("error", "auth.email_unavailable", { reason: config.reason });
    throw new AppError("provider_unavailable", "Email sign-in is not available right now. Try again later.", true);
  }
  const ref = emailRef(email);
  await enforceRateLimit(`auth-req-ip:${input.ip}`, env().AUTH_REQUESTS_PER_IP_PER_HOUR, HOUR);
  await enforceRateLimit(`auth-req-email:${ref}`, 5, HOUR);

  const db = await getDb();
  const now = new Date();
  const latest = (await db.select().from(authChallenges).where(eq(authChallenges.email, email)).orderBy(desc(authChallenges.createdAt)).limit(1))[0];
  // The cooldown protects a code that is still usable; once it has been used or locked, a new one may be requested.
  if (latest && !latest.consumedAt && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    // Same shape as a normal request. The earlier code is still valid.
    return { cooldownSec: Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime())) / 1000) };
  }

  let link: User | null = null;
  let noticeCount = 0;
  if (input.linkUserId) {
    link = (await db.select().from(users).where(eq(users.id, input.linkUserId)).limit(1))[0] ?? null;
    // A guest (no email yet) is exactly who this is for: saving the guest session to an email is how a guest keeps their announcements.
    if (link && link.email) link = null;
    if (link) noticeCount = (await db.select({ id: notices.id }).from(notices).where(eq(notices.ownerId, link.id))).length;
  }

  // The email account is shared with other applications and has one daily quota. Count only emails about to be sent.
  await enforceRateLimit("auth-email-global", env().AUTH_EMAILS_PER_DAY, 24 * HOUR).catch((err) => {
    log("warn", "auth.daily_email_cap_reached", { cap: env().AUTH_EMAILS_PER_DAY });
    throw err;
  });

  const id = newId("chl");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(authChallenges).values({
    id,
    email,
    codeHash: hashCode(id, code),
    linkUserId: link?.id ?? null,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });
  // Only the newest code works.
  await db
    .update(authChallenges)
    .set({ consumedAt: now })
    .where(and(eq(authChallenges.email, email), isNull(authChallenges.consumedAt), ne(authChallenges.id, id)));

  const purpose = link
    ? `Entering it will save the announcements you have open${noticeCount ? ` (${noticeCount})` : ""} to this email, so you can reach them from any device.`
    : "Entering it will sign you in to your AfterSend account, or create one if this is your first time.";
  let emailId: string | null = null;
  try {
    ({ id: emailId } = await sendEmail({
      to: email,
      subject: `Your AfterSend code: ${code}`,
      text: [
        `Your AfterSend sign-in code is ${code}.`,
        "",
        purpose,
        "",
        "It works once and expires in 10 minutes.",
        "Never share this code. AfterSend staff will never ask for it.",
        "If you did not ask for it, ignore this email; nothing has changed.",
      ].join("\n"),
    }));
  } catch (err) {
    await db.update(authChallenges).set({ consumedAt: now }).where(eq(authChallenges.id, id));
    log("error", "auth.email_failed", { emailRef: ref, error: err instanceof EmailError ? err.message : "unknown" });
    throw new AppError("provider_unavailable", "We could not send the email. Try again in a moment.", true);
  }
  log("info", "auth.code_requested", { emailRef: ref, linking: !!link, emailId });
  return { cooldownSec: RESEND_COOLDOWN_MS / 1000 };
}

export type VerifyResult = { userId: string; created: boolean; linked: boolean; merged: number };

/**
 * Checks a code and resolves the account. Guesses are limited per code (5), per address and per IP, and the
 * code is consumed atomically, so two simultaneous correct submissions cannot both sign in.
 */
export async function verifyCode(input: { email: string; code: string; sessionUserId: string | null; ip: string }): Promise<VerifyResult> {
  const email = normalizeEmail(input.email);
  const code = normalizeCode(input.code);
  if (!email || !code) throw invalidCode();
  const ref = emailRef(email);
  await enforceRateLimit(`auth-verify-ip:${input.ip}`, env().AUTH_VERIFY_PER_IP_PER_HOUR, HOUR);
  await enforceRateLimit(`auth-verify-email:${ref}`, 30, HOUR);

  const db = await getDb();
  const now = new Date();
  const challenge = (
    await db
      .select()
      .from(authChallenges)
      .where(and(eq(authChallenges.email, email), isNull(authChallenges.consumedAt), gt(authChallenges.expiresAt, now)))
      .orderBy(desc(authChallenges.createdAt))
      .limit(1)
  )[0];
  if (!challenge) throw invalidCode();

  // Count the guess before looking at it, so concurrent guesses cannot exceed the limit.
  const counted = await db
    .update(authChallenges)
    .set({ attempts: challenge.attempts + 1 })
    .where(and(eq(authChallenges.id, challenge.id), eq(authChallenges.attempts, challenge.attempts), isNull(authChallenges.consumedAt)))
    .returning({ attempts: authChallenges.attempts });
  if (counted.length === 0 || counted[0]!.attempts > MAX_ATTEMPTS) throw invalidCode();

  const given = Buffer.from(hashCode(challenge.id, code), "hex");
  const expected = Buffer.from(challenge.codeHash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    if (counted[0]!.attempts >= MAX_ATTEMPTS) {
      await db.update(authChallenges).set({ consumedAt: now }).where(eq(authChallenges.id, challenge.id));
      log("warn", "auth.code_locked", { emailRef: ref });
    }
    throw invalidCode();
  }
  const used = await db
    .update(authChallenges)
    .set({ consumedAt: now })
    .where(and(eq(authChallenges.id, challenge.id), isNull(authChallenges.consumedAt)))
    .returning({ id: authChallenges.id });
  if (used.length === 0) throw invalidCode();

  const wantsLink = !!challenge.linkUserId && challenge.linkUserId === input.sessionUserId;
  const result = await resolveAccount(email, wantsLink ? challenge.linkUserId : null);
  log("info", "auth.signed_in", { emailRef: ref, created: result.created, linked: result.linked, merged: result.merged });
  return result;
}

async function resolveAccount(email: string, linkUserId: string | null): Promise<VerifyResult> {
  const db = await getDb();
  const now = new Date();
  const findExisting = async () => (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];

  const link = linkUserId ? (await db.select().from(users).where(eq(users.id, linkUserId)).limit(1))[0] : undefined;
  const linkable = link && !link.email ? link : undefined;

  const existing = await findExisting();
  if (existing) {
    if (linkable && linkable.id !== existing.id) {
      // The browser proved it holds the cookie workspace, and the mailbox proved the email: both halves
      // are needed to move the notices, so neither a cookie thief nor an email-only attacker can do it.
      return db.transaction(async (tx) => {
        const moved = await tx.update(notices).set({ ownerId: existing.id }).where(eq(notices.ownerId, linkable.id)).returning({ id: notices.id });
        await tx.delete(users).where(eq(users.id, linkable.id));
        return { userId: existing.id, created: false, linked: false, merged: moved.length };
      });
    }
    return { userId: existing.id, created: false, linked: false, merged: 0 };
  }

  try {
    if (linkable) {
      const done = await db.update(users).set({ email, emailVerifiedAt: now, kind: "workspace", displayName: "Your account" }).where(and(eq(users.id, linkable.id), isNull(users.email))).returning({ id: users.id });
      if (done.length > 0) return { userId: linkable.id, created: false, linked: true, merged: 0 };
    }
    const id = newId("usr");
    await db.insert(users).values({ id, kind: "workspace", displayName: "My workspace", email, emailVerifiedAt: now });
    return { userId: id, created: true, linked: false, merged: 0 };
  } catch (err) {
    // Another request created this address first: sign in to that account instead.
    const winner = isUniqueViolation(err) ? await findExisting() : undefined;
    if (!winner) throw err;
    return { userId: winner.id, created: false, linked: false, merged: 0 };
  }
}

/** Ends every session of the account on every device. */
export async function signOutEverywhere(userId: string): Promise<number> {
  const db = await getDb();
  const gone = await db.delete(sessions).where(eq(sessions.userId, userId)).returning({ hash: sessions.tokenHash });
  log("info", "auth.signed_out_everywhere", { sessions: gone.length });
  return gone.length;
}

/** Removes challenges that can no longer be used. Called from the daily cleanup. */
export async function purgeChallenges(now = new Date()): Promise<number> {
  const db = await getDb();
  const gone = await db.delete(authChallenges).where(lt(authChallenges.expiresAt, new Date(now.getTime() - HOUR))).returning({ id: authChallenges.id });
  return gone.length;
}
