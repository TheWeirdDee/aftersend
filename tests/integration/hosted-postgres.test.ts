import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureTestEnv } from "../support/setup-integration";

/**
 * The hosted-database path: `postgres-js` talking the Postgres wire protocol to a server, with migrations applied
 * by the same code `npm run db:migrate` uses. The server here is PGlite behind a TCP socket, so this exercises the
 * driver, the connection string handling, pooling settings, transactions and row locks as production does, but it
 * is NOT a real Postgres (no extensions, one connection at a time) and it says nothing about Supabase itself.
 */
configureTestEnv();

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { applyMigrations } from "@/lib/db/migrator";

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

let server: PGLiteSocketServer;
let pg: PGlite;

const { resetEnvCache } = await import("@/lib/env");

beforeAll(async () => {
  pg = await PGlite.create();
  const port = await freePort();
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
  await server.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;

  // Same function as scripts/migrate.ts, run twice at once the way two simultaneous builds would.
  await Promise.all([applyMigrations(url), applyMigrations(url)]);

  process.env.DATABASE_URL = url;
  process.env.DATABASE_POOL_MAX = "1";
  resetEnvCache();
});

afterAll(async () => {
  const { closeDb } = await import("@/lib/db/client");
  await closeDb();
  await server.stop();
  await pg.close();
});

describe("service over the Postgres wire protocol", () => {
  it("connects with postgres-js, sees every migration, and answers queries", async () => {
    const { getDb } = await import("@/lib/db/client");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    const tables = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`)) as unknown as { table_name: string }[];
    const names = Array.from(tables).map((t) => t.table_name);
    for (const expected of ["users", "sessions", "notices", "notice_revisions", "audio_assets", "synthesis_attempts", "rate_limits", "auth_challenges"]) {
      expect(names).toContain(expected);
    }
  });

  it("applied each migration exactly once even though two migrators started together, and re-running changes nothing", async () => {
    const { getDb } = await import("@/lib/db/client");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    const count = async () =>
      Number((Array.from((await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown as { n: number }[])[0] as { n: number }).n);
    const journal = (JSON.parse((await import("node:fs")).readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] }).entries.length;
    expect(await count()).toBe(journal);
    await applyMigrations(process.env.DATABASE_URL!);
    expect(await count()).toBe(journal);
  });

  it("publishes, corrects and withdraws a notice, with the pointer swap under a row lock", async () => {
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const svc = await import("@/lib/notices/revision-service");
    const { getPublicManifest } = await import("@/lib/notices/public-manifest");
    const { newId } = await import("@/lib/ids");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    const owner = newId("usr");
    await db.insert(schema.users).values({ id: owner, kind: "workspace", displayName: "Wire test" });

    const { noticeId, revisionId } = await svc.createNotice(owner, { title: "Pickup", text: "Pickup is at 3:00 PM at the gate.", sourceUrl: null, voiceId: "test-tone" });
    await svc.generatePreview(owner, revisionId);
    await svc.approveRevision(owner, revisionId);
    const token = (await db.select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!.publicToken;
    expect((await getPublicManifest(token))?.state).toBe("published");

    const correction = await svc.createRevision(owner, noticeId, { text: "Pickup is at 4:00 PM at the gate." });
    await svc.generatePreview(owner, correction.revisionId);
    await svc.approveRevision(owner, correction.revisionId);
    const manifest = await getPublicManifest(token);
    expect(manifest?.state === "published" && manifest.revisionNumber).toBe(2);

    await svc.withdrawNotice(owner, noticeId);
    expect((await getPublicManifest(token))?.state).toBe("withdrawn");
  });

  it("handles two simultaneous approvals of one revision", async () => {
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const svc = await import("@/lib/notices/revision-service");
    const { newId } = await import("@/lib/ids");
    const { and, eq } = await import("drizzle-orm");
    const db = await getDb();
    const owner = newId("usr");
    await db.insert(schema.users).values({ id: owner, kind: "workspace", displayName: "Wire test" });
    const { revisionId } = await svc.createNotice(owner, { title: "Race", text: "Meet at 9:00 AM.", sourceUrl: null, voiceId: "test-tone" });
    await svc.generatePreview(owner, revisionId);
    const results = await Promise.allSettled([svc.approveRevision(owner, revisionId), svc.approveRevision(owner, revisionId)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const ready = await db
      .select()
      .from(schema.audioAssets)
      .where(and(eq(schema.audioAssets.revisionId, revisionId), eq(schema.audioAssets.stage, "published"), eq(schema.audioAssets.contentReady, true)));
    expect(ready).toHaveLength(1);
  });

  it("signs in by email code and recovers the account", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const auth = await import("@/lib/auth/email-auth");
    const address = `wire-${Date.now()}@example.com`;
    const code = async () => {
      const dir = process.env.EMAIL_OUTBOX_DIR!;
      const files = fs.readdirSync(dir).sort();
      const mails = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { to: string; text: string }).filter((m) => m.to === address);
      return /code is (\d{6})/.exec(mails.at(-1)!.text)![1]!;
    };
    await auth.requestCode({ email: address, linkUserId: null, ip: "10.9.9.1" });
    const first = await auth.verifyCode({ email: address, code: await code(), sessionUserId: null, ip: "10.9.9.2" });
    expect(first.created).toBe(true);
    await auth.requestCode({ email: address, linkUserId: null, ip: "10.9.9.3" });
    const again = await auth.verifyCode({ email: address, code: await code(), sessionUserId: null, ip: "10.9.9.4" });
    expect(again).toMatchObject({ userId: first.userId, created: false });
  });
});
