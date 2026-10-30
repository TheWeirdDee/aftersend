import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { configureTestEnv } from "../support/setup-integration";

/**
 * Restart persistence: everything a publisher or listener depends on must survive the server process going away
 * and coming back. Here "restart" means closing the database and reopening the same on-disk directory and object
 * store, which is what a redeploy or crash does to the local drivers. It does not test a hosted database.
 */
configureTestEnv();
const data = fs.mkdtempSync(path.join(os.tmpdir(), "aftersend-persist-"));
process.env.PGLITE_DIR = path.join(data, "pglite");
process.env.LOCAL_STORAGE_DIR = path.join(data, "objects");

const { resetEnvCache } = await import("@/lib/env");
resetEnvCache();
const { getDb, closeDb } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const svc = await import("@/lib/notices/revision-service");
const { getPublicManifest, getPublicAudio } = await import("@/lib/notices/public-manifest");
const auth = await import("@/lib/auth/email-auth");
const { issueSession, userForToken } = await import("@/lib/auth/session");
const { objectStore } = await import("@/lib/storage/audio");
const { sha256Hex } = await import("@/lib/ids");
const { eq } = await import("drizzle-orm");

afterAll(async () => {
  await closeDb();
  fs.rmSync(data, { recursive: true, force: true });
});

describe("restart persistence", () => {
  it("keeps accounts, sessions, notices, revisions, audio and the public link across a restart", async () => {
    // Before the restart.
    let db = await getDb();
    const address = `restart-${Date.now()}@example.com`;
    await auth.requestCode({ email: address, linkUserId: null, ip: "10.8.8.1" });
    const mail = fs
      .readdirSync(process.env.EMAIL_OUTBOX_DIR!)
      .map((f) => JSON.parse(fs.readFileSync(path.join(process.env.EMAIL_OUTBOX_DIR!, f), "utf8")) as { to: string; text: string })
      .filter((m) => m.to === address)
      .at(-1)!;
    const account = await auth.verifyCode({ email: address, code: /code is (\d{6})/.exec(mail.text)![1]!, sessionUserId: null, ip: "10.8.8.2" });
    const { token: sessionToken } = await issueSession(account.userId);

    const { noticeId, revisionId } = await svc.createNotice(account.userId, { title: "Pickup", text: "Pickup is at 3:00 PM.", sourceUrl: null, voiceId: "test-tone" });
    await svc.generatePreview(account.userId, revisionId);
    await svc.approveRevision(account.userId, revisionId);
    const notice = (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
    const before = await getPublicManifest(notice.publicToken);
    expect(before?.state).toBe("published");
    if (before?.state !== "published") return;
    const audioRow = await getPublicAudio(notice.publicToken, revisionId, before.audioSha256);
    const bytesBefore = await objectStore().get(audioRow!.objectKey);
    expect(bytesBefore).not.toBeNull();

    // The process goes away.
    await closeDb();
    resetEnvCache();

    // After the restart: a fresh connection to the same directories.
    db = await getDb();
    expect((await userForToken(sessionToken))?.email).toBe(address);
    const after = await getPublicManifest(notice.publicToken);
    expect(after).toEqual(before);
    const audioAfter = await getPublicAudio(notice.publicToken, revisionId, before.audioSha256);
    const bytesAfter = await objectStore().get(audioAfter!.objectKey);
    expect(sha256Hex(bytesAfter!)).toBe(before.audioSha256);
    expect((await svc.listNotices(account.userId)).map((n) => n.id)).toEqual([noticeId]);

    // And the service still works: correct, publish, withdraw.
    const fix = await svc.createRevision(account.userId, noticeId, { text: "Pickup is at 4:00 PM." });
    await svc.generatePreview(account.userId, fix.revisionId);
    await svc.approveRevision(account.userId, fix.revisionId);
    const corrected = await getPublicManifest(notice.publicToken);
    expect(corrected?.state === "published" && corrected.displayText).toContain("4:00 PM");
    await svc.withdrawNotice(account.userId, noticeId);
    expect((await getPublicManifest(notice.publicToken))?.state).toBe("withdrawn");

    // Signing in again after the restart finds the same account.
    await auth.requestCode({ email: address, linkUserId: null, ip: "10.8.8.3" });
    const again = fs
      .readdirSync(process.env.EMAIL_OUTBOX_DIR!)
      .map((f) => JSON.parse(fs.readFileSync(path.join(process.env.EMAIL_OUTBOX_DIR!, f), "utf8")) as { to: string; text: string })
      .filter((m) => m.to === address)
      .at(-1)!;
    expect((await auth.verifyCode({ email: address, code: /code is (\d{6})/.exec(again.text)![1]!, sessionUserId: null, ip: "10.8.8.4" })).userId).toBe(account.userId);
  });
});
