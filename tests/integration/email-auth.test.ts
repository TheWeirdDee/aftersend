import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureTestEnv } from "../support/setup-integration";

configureTestEnv();

const { getDb, closeDb } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const auth = await import("@/lib/auth/email-auth");
const { issueSession, userForToken } = await import("@/lib/auth/session");
const svc = await import("@/lib/notices/revision-service");
const { runCleanup } = await import("@/lib/notices/cleanup");
const { resetEnvCache } = await import("@/lib/env");
const { newId } = await import("@/lib/ids");
const { and, eq } = await import("drizzle-orm");

let ipCounter = 0;
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const outbox = () => process.env.EMAIL_OUTBOX_DIR!;

function mailTo(address: string) {
  const dir = outbox();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { to: string; subject: string; text: string })
    .filter((m) => m.to === address);
}
const lastCode = (address: string) => /code is (\d{6})/.exec(mailTo(address).at(-1)?.text ?? "")?.[1] ?? null;

let counter = 0;
const newAddress = () => `person${++counter}-${Date.now()}@example.com`;

async function workspace(kind: "workspace" | "demo" = "workspace") {
  const db = await getDb();
  const id = newId("usr");
  await db.insert(schema.users).values({ id, kind, displayName: kind === "demo" ? "Demo workspace" : "My workspace" });
  return id;
}

async function withNotice(owner: string, title = "Pickup") {
  const { noticeId } = await svc.createNotice(owner, { title, text: "Pickup is at 3:00 PM.", sourceUrl: null, voiceId: "test-tone" });
  return noticeId;
}

/** Skips the 30 s resend cooldown by ageing the newest challenge. */
async function ageChallenges(address: string) {
  const db = await getDb();
  await db.update(schema.authChallenges).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(schema.authChallenges.email, address));
}

async function signIn(address: string, sessionUserId: string | null = null, linkUserId: string | null = sessionUserId) {
  await ageChallenges(address);
  await auth.requestCode({ email: address, linkUserId, ip: freshIp() });
  return auth.verifyCode({ email: address, code: lastCode(address)!, sessionUserId, ip: freshIp() });
}

async function ownerOf(noticeId: string) {
  const db = await getDb();
  return (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]?.ownerId;
}

beforeAll(async () => {
  await getDb();
});
beforeEach(() => resetEnvCache());
afterAll(async () => {
  await closeDb();
});

describe("requesting a code", () => {
  it("emails a six-digit code and stores only a keyed hash of it", async () => {
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    const code = lastCode(address)!;
    expect(code).toMatch(/^\d{6}$/);
    expect(mailTo(address).at(-1)!.subject).toContain(code);

    const db = await getDb();
    const row = (await db.select().from(schema.authChallenges).where(eq(schema.authChallenges.email, address)))[0]!;
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.codeHash).toBe(auth.hashCode(row.id, code));
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(auth.CODE_TTL_MS + 1000);
  });

  it("rejects things that are not email addresses", async () => {
    await expect(auth.requestCode({ email: "nope", linkUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("answers the same, and sends the same message, whether or not the address has an account", async () => {
    const known = newAddress();
    await signIn(known); // creates the account
    const unknown = newAddress();
    await ageChallenges(known);
    const a = await auth.requestCode({ email: known, linkUserId: null, ip: freshIp() });
    const b = await auth.requestCode({ email: unknown, linkUserId: null, ip: freshIp() });
    expect(a).toEqual(b);
    const strip = (t: string) => t.replace(/\d{6}/g, "######");
    expect(strip(mailTo(known).at(-1)!.text)).toBe(strip(mailTo(unknown).at(-1)!.text));
    expect(mailTo(known).at(-1)!.subject.replace(/\d{6}/, "")).toBe(mailTo(unknown).at(-1)!.subject.replace(/\d{6}/, ""));
  });

  it("does not send a second email inside the cooldown, and the earlier code keeps working", async () => {
    const address = newAddress();
    const first = await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    const again = await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    expect(mailTo(address)).toHaveLength(1);
    expect(again.cooldownSec).toBeGreaterThan(0);
    expect(again.cooldownSec).toBeLessThanOrEqual(first.cooldownSec);
    await expect(auth.verifyCode({ email: address, code: lastCode(address)!, sessionUserId: null, ip: freshIp() })).resolves.toMatchObject({ created: true });
  });

  it("lets someone request a new code straight after using the last one", async () => {
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    await auth.verifyCode({ email: address, code: lastCode(address)!, sessionUserId: null, ip: freshIp() });
    // Signing in on a second device a few seconds later must not be told to wait for a code that no longer works.
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    expect(mailTo(address)).toHaveLength(2);
    await expect(auth.verifyCode({ email: address, code: lastCode(address)!, sessionUserId: null, ip: freshIp() })).resolves.toMatchObject({ created: false });
  });

  it("caps the total number of sign-in emails per day, so a shared email account's quota cannot be used up", async () => {
    const db = await getDb();
    const used = async () => (await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, "auth-email-global")))[0]?.count ?? 0;
    const before = await used();
    process.env.AUTH_EMAILS_PER_DAY = String(before + 2);
    resetEnvCache();
    try {
      const a = newAddress();
      await auth.requestCode({ email: a, linkUserId: null, ip: freshIp() });
      // A request inside the resend cooldown sends nothing, so it must not use up the allowance.
      await auth.requestCode({ email: a, linkUserId: null, ip: freshIp() });
      expect(await used()).toBe(before + 1);
      await auth.requestCode({ email: newAddress(), linkUserId: null, ip: freshIp() });
      const blocked = newAddress();
      await expect(auth.requestCode({ email: blocked, linkUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "rate_limited" });
      expect(mailTo(blocked)).toHaveLength(0);
      // People who already hold a code can still finish signing in: the cap stops new emails, not verification.
      await expect(auth.verifyCode({ email: a, code: lastCode(a)!, sessionUserId: null, ip: freshIp() })).resolves.toMatchObject({ created: true });
    } finally {
      process.env.AUTH_EMAILS_PER_DAY = "100000";
      resetEnvCache();
    }
  });

  it("limits requests per address and per IP", async () => {
    const address = newAddress();
    for (let i = 0; i < 5; i++) {
      await ageChallenges(address);
      await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    }
    await ageChallenges(address);
    await expect(auth.requestCode({ email: address, linkUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "rate_limited" });

    const ip = freshIp();
    for (let i = 0; i < 20; i++) await auth.requestCode({ email: newAddress(), linkUserId: null, ip });
    await expect(auth.requestCode({ email: newAddress(), linkUserId: null, ip })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("only the newest code works", async () => {
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    const old = lastCode(address)!;
    await ageChallenges(address);
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    const fresh = lastCode(address)!;
    if (old !== fresh) {
      await expect(auth.verifyCode({ email: address, code: old, sessionUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(auth.verifyCode({ email: address, code: fresh, sessionUserId: null, ip: freshIp() })).resolves.toMatchObject({ created: true });
  });

  it("fails cleanly, and leaves no usable code, when email cannot be sent", async () => {
    const address = newAddress();
    const original = process.env.EMAIL_OUTBOX_DIR;
    const blocker = path.join(outbox(), "..", `blocker-${Date.now()}`);
    fs.mkdirSync(path.dirname(blocker), { recursive: true });
    fs.writeFileSync(blocker, "a file where a directory is needed");
    process.env.EMAIL_OUTBOX_DIR = blocker;
    resetEnvCache();
    try {
      await expect(auth.requestCode({ email: address, linkUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
    } finally {
      process.env.EMAIL_OUTBOX_DIR = original;
      resetEnvCache();
    }
    const db = await getDb();
    const rows = await db.select().from(schema.authChallenges).where(eq(schema.authChallenges.email, address));
    expect(rows.every((r) => r.consumedAt)).toBe(true);
  });

  it("refuses to run when email is not configured, without leaking why to the client", async () => {
    const saved = { d: process.env.EMAIL_DRIVER, a: process.env.AFTERSEND_ALLOW_TEST_EMAIL };
    process.env.EMAIL_DRIVER = "resend";
    delete process.env.RESEND_API_KEY;
    resetEnvCache();
    try {
      const err = await auth.requestCode({ email: newAddress(), linkUserId: null, ip: freshIp() }).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "provider_unavailable" });
      expect((err as Error).message).not.toContain("RESEND");
    } finally {
      process.env.EMAIL_DRIVER = saved.d;
      process.env.AFTERSEND_ALLOW_TEST_EMAIL = saved.a;
      resetEnvCache();
    }
  });

  it("in production, refuses to sign codes without AUTH_SECRET", async () => {
    const saved = { n: process.env.NODE_ENV, s: process.env.AUTH_SECRET };
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.AUTH_SECRET;
    resetEnvCache();
    try {
      await expect(auth.requestCode({ email: newAddress(), linkUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "internal" });
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = saved.n;
      process.env.AUTH_SECRET = saved.s;
      resetEnvCache();
    }
  });
});

describe("verifying a code", () => {
  it("creates a verified workspace for a new address, and the code works once", async () => {
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    const code = lastCode(address)!;
    const first = await auth.verifyCode({ email: address, code, sessionUserId: null, ip: freshIp() });
    expect(first).toMatchObject({ created: true, linked: false, merged: 0 });
    const db = await getDb();
    const user = (await db.select().from(schema.users).where(eq(schema.users.id, first.userId)))[0]!;
    expect(user).toMatchObject({ email: address, kind: "workspace" });
    expect(user.emailVerifiedAt).not.toBeNull();
    await expect(auth.verifyCode({ email: address, code, sessionUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("accepts the address in any case and the code with spaces", async () => {
    const address = newAddress();
    await auth.requestCode({ email: address.toUpperCase(), linkUserId: null, ip: freshIp() });
    const code = lastCode(address)!;
    await expect(auth.verifyCode({ email: `  ${address.toUpperCase()} `, code: `${code.slice(0, 3)} ${code.slice(3)}`, sessionUserId: null, ip: freshIp() })).resolves.toMatchObject({ created: true });
  });

  it("gives one identical error for a wrong code, an unknown address, an expired code and a used code", async () => {
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    const code = lastCode(address)!;
    const wrong = code === "000000" ? "111111" : "000000";
    const attempts = [
      auth.verifyCode({ email: address, code: wrong, sessionUserId: null, ip: freshIp() }),
      auth.verifyCode({ email: newAddress(), code, sessionUserId: null, ip: freshIp() }),
      auth.verifyCode({ email: address, code: "abc", sessionUserId: null, ip: freshIp() }),
    ];
    const errors = await Promise.all(
      attempts.map((p) =>
        p.then(
          () => {
            throw new Error("expected a rejection");
          },
          (e: unknown) => e as Error & { code: string },
        ),
      ),
    );
    for (const e of errors) expect(e).toMatchObject({ code: "invalid_code", message: errors[0]!.message });

    const db = await getDb();
    await db.update(schema.authChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.authChallenges.email, address));
    await expect(auth.verifyCode({ email: address, code, sessionUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "invalid_code", message: errors[0]!.message });
  });

  it("locks a code after five wrong guesses, even if the next guess is right", async () => {
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    const code = lastCode(address)!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < auth.MAX_ATTEMPTS; i++) {
      await expect(auth.verifyCode({ email: address, code: wrong, sessionUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(auth.verifyCode({ email: address, code, sessionUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "invalid_code" });
    const db = await getDb();
    expect(await db.select().from(schema.users).where(eq(schema.users.email, address))).toHaveLength(0);
    // The fifth miss retired the code outright; it did not merely run out of attempts.
    const row = (await db.select().from(schema.authChallenges).where(eq(schema.authChallenges.email, address)))[0]!;
    expect(row.consumedAt).not.toBeNull();
  });

  it("never evaluates a sixth guess, even if a racing request reaches a code that already used its five", async () => {
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    const code = lastCode(address)!;
    // The state a lost race can leave behind: five attempts used and the code not yet marked consumed.
    const db = await getDb();
    await db.update(schema.authChallenges).set({ attempts: auth.MAX_ATTEMPTS }).where(eq(schema.authChallenges.email, address));
    await expect(auth.verifyCode({ email: address, code, sessionUserId: null, ip: freshIp() })).rejects.toMatchObject({ code: "invalid_code" });
    expect(await db.select().from(schema.users).where(eq(schema.users.email, address))).toHaveLength(0);
  });

  it("lets only one of several simultaneous correct submissions through", async () => {
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    const code = lastCode(address)!;
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => auth.verifyCode({ email: address, code, sessionUserId: null, ip: freshIp() })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "invalid_code" });
    const db = await getDb();
    expect(await db.select().from(schema.users).where(eq(schema.users.email, address))).toHaveLength(1);
  });

  it("limits verification attempts per IP", async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i++) await auth.verifyCode({ email: newAddress(), code: "123456", sessionUserId: null, ip }).catch(() => {});
    await expect(auth.verifyCode({ email: newAddress(), code: "123456", sessionUserId: null, ip })).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("recovery and cross-device access", () => {
  it("signing in again, from anywhere, reaches the same workspace and its notices", async () => {
    const address = newAddress();
    const first = await signIn(address);
    const noticeId = await withNotice(first.userId);

    // A different browser with no cookie, later.
    const second = await signIn(address, null);
    expect(second).toMatchObject({ userId: first.userId, created: false });
    const list = await svc.listNotices(second.userId);
    expect(list.map((n) => n.id)).toContain(noticeId);
    expect((await svc.getNoticeDetail(second.userId, noticeId)).notice.id).toBe(noticeId);
  });

  it("recovers a workspace that was connected to an email after its cookie is lost", async () => {
    const address = newAddress();
    const cookieWorkspace = await workspace();
    const noticeId = await withNotice(cookieWorkspace);
    const linked = await signIn(address, cookieWorkspace);
    expect(linked).toMatchObject({ userId: cookieWorkspace, linked: true });

    const { token } = await issueSession(cookieWorkspace);
    expect((await userForToken(token))?.email).toBe(address);
    // The cookie is gone for good. Only the email remains.
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, cookieWorkspace));
    expect(await userForToken(token)).toBeNull();

    const recovered = await signIn(address, null);
    expect(recovered.userId).toBe(cookieWorkspace);
    expect((await svc.listNotices(recovered.userId)).map((n) => n.id)).toEqual([noticeId]);
  });

  it("signs out of every device at once", async () => {
    const { userId } = await signIn(newAddress());
    const tokens = await Promise.all([issueSession(userId), issueSession(userId), issueSession(userId)]);
    for (const t of tokens) expect((await userForToken(t.token))?.id).toBe(userId);
    expect(await auth.signOutEverywhere(userId)).toBeGreaterThanOrEqual(3);
    for (const t of tokens) expect(await userForToken(t.token)).toBeNull();
    // Signing back in still works: the account and notices are untouched.
    const db = await getDb();
    expect((await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0]).toBeDefined();
  });

  it("a session expires on its own", async () => {
    const { userId } = await signIn(newAddress());
    const { token } = await issueSession(userId);
    const db = await getDb();
    await db.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.sessions.userId, userId));
    expect(await userForToken(token)).toBeNull();
  });
});

describe("linking an existing workspace", () => {
  it("attaches the email to the workspace that asked, keeping its notices", async () => {
    const owner = await workspace();
    const noticeId = await withNotice(owner);
    const address = newAddress();
    const result = await signIn(address, owner);
    expect(result).toMatchObject({ userId: owner, linked: true, created: false, merged: 0 });
    expect(await ownerOf(noticeId)).toBe(owner);
    expect(mailTo(address).at(-1)!.text).toContain("save the announcements you have open (1) to this email");
  });

  it("does not link when the code is verified from a different browser session than the one that asked", async () => {
    const owner = await workspace();
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: owner, ip: freshIp() });
    const result = await auth.verifyCode({ email: address, code: lastCode(address)!, sessionUserId: null, ip: freshIp() });
    expect(result).toMatchObject({ linked: false, created: true });
    expect(result.userId).not.toBe(owner);
    const db = await getDb();
    expect((await db.select().from(schema.users).where(eq(schema.users.id, owner)))[0]!.email).toBeNull();
  });

  it("does not link when a different workspace presents the code", async () => {
    const asker = await workspace();
    const other = await workspace();
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: asker, ip: freshIp() });
    const result = await auth.verifyCode({ email: address, code: lastCode(address)!, sessionUserId: other, ip: freshIp() });
    expect(result.linked).toBe(false);
    expect([asker, other]).not.toContain(result.userId);
  });

  it("saves a guest to the email that was verified, keeping every announcement and turning the guest into an account", async () => {
    const guest = await workspace("demo");
    const noticeId = await withNotice(guest);
    const address = newAddress();
    const result = await signIn(address, guest);
    expect(result).toMatchObject({ userId: guest, linked: true, created: false, merged: 0 });
    expect(await ownerOf(noticeId)).toBe(guest);
    expect(mailTo(address).at(-1)!.text).toContain("save the announcements you have open (1) to this email");
    const db = await getDb();
    const row = (await db.select().from(schema.users).where(eq(schema.users.id, guest)))[0]!;
    expect(row).toMatchObject({ email: address, kind: "workspace" });
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it("does not save a guest to an email when the code is verified from another browser", async () => {
    const guest = await workspace("demo");
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: guest, ip: freshIp() });
    const result = await auth.verifyCode({ email: address, code: lastCode(address)!, sessionUserId: null, ip: freshIp() });
    expect(result).toMatchObject({ linked: false, created: true });
    const db = await getDb();
    expect((await db.select().from(schema.users).where(eq(schema.users.id, guest)))[0]).toMatchObject({ email: null, kind: "demo" });
  });

  it("moves a guest's announcements into an account that already owns the address", async () => {
    const address = newAddress();
    const account = (await signIn(address)).userId;
    const guest = await workspace("demo");
    const guestNotice = await withNotice(guest, "Written as a guest");
    const result = await signIn(address, guest);
    expect(result).toMatchObject({ userId: account, merged: 1 });
    expect(await ownerOf(guestNotice)).toBe(account);
    const db = await getDb();
    expect(await db.select().from(schema.users).where(eq(schema.users.id, guest))).toHaveLength(0);
  });

  it("merges a browser workspace into the account that already owns the address, moving notices one way only", async () => {
    const address = newAddress();
    const account = (await signIn(address)).userId;
    const accountNotice = await withNotice(account, "From the account");
    const cookieWorkspace = await workspace();
    const cookieNotice = await withNotice(cookieWorkspace, "From the browser");

    const result = await signIn(address, cookieWorkspace);
    expect(result).toMatchObject({ userId: account, merged: 1, linked: false });
    expect(await ownerOf(cookieNotice)).toBe(account);
    expect(await ownerOf(accountNotice)).toBe(account);
    const db = await getDb();
    expect(await db.select().from(schema.users).where(eq(schema.users.id, cookieWorkspace))).toHaveLength(0);
    expect((await svc.listNotices(account)).map((n) => n.title).sort()).toEqual(["From the account", "From the browser"]);
  });

  it("cannot be used to take over an account: a signed-in attacker without the mailbox gets nothing", async () => {
    const address = newAddress();
    const victim = (await signIn(address)).userId;
    const victimNotice = await withNotice(victim);
    const attacker = await workspace();
    const attackerNotice = await withNotice(attacker);

    await ageChallenges(address);
    await auth.requestCode({ email: address, linkUserId: attacker, ip: freshIp() });
    const real = lastCode(address)!;
    const guess = real === "000000" ? "111111" : "000000";
    await expect(auth.verifyCode({ email: address, code: guess, sessionUserId: attacker, ip: freshIp() })).rejects.toMatchObject({ code: "invalid_code" });

    expect(await ownerOf(victimNotice)).toBe(victim);
    expect(await ownerOf(attackerNotice)).toBe(attacker);
    await expect(svc.getNoticeDetail(attacker, victimNotice)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("accounts are isolated from each other", () => {
  it("one email account cannot read, edit, generate or withdraw another's notice", async () => {
    const a = (await signIn(newAddress())).userId;
    const b = (await signIn(newAddress())).userId;
    const { noticeId, revisionId } = await svc.createNotice(a, { title: "Private", text: "Pickup is at 3:00 PM.", sourceUrl: null, voiceId: "test-tone" });
    await svc.generatePreview(a, revisionId);
    await svc.approveRevision(a, revisionId);

    await expect(svc.getNoticeDetail(b, noticeId)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.getRevisionForOwner(b, revisionId)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.updateDraft(b, revisionId, { text: "hijack" })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.createRevision(b, noticeId, { text: "hijack" })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.withdrawNotice(b, noticeId)).rejects.toMatchObject({ code: "not_found" });
    expect((await svc.listNotices(b)).map((n) => n.id)).not.toContain(noticeId);
  });
});

describe("retention", () => {
  it("removes spent challenges after they can no longer matter", async () => {
    const address = newAddress();
    await auth.requestCode({ email: address, linkUserId: null, ip: freshIp() });
    const db = await getDb();
    await db.update(schema.authChallenges).set({ expiresAt: new Date(Date.now() - 3 * 3600_000) }).where(and(eq(schema.authChallenges.email, address)));
    const out = await runCleanup();
    expect(out.challenges).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(schema.authChallenges).where(eq(schema.authChallenges.email, address))).toHaveLength(0);
  });
});
