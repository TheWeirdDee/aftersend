import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureTestEnv } from "../support/setup-integration";

configureTestEnv();

const { getDb, closeDb } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const svc = await import("@/lib/notices/revision-service");
const { getPublicManifest } = await import("@/lib/notices/public-manifest");
const { newId } = await import("@/lib/ids");
const { eq } = await import("drizzle-orm");

const ORIGINAL = "Dear parents,\n\nPickup is at 3:00 PM at the main gate.";
const CORRECTED = "Dear parents,\n\nPickup is at 4:00 PM at the main gate.";
const OLD_LINK = "https://school.example/notices/pickup-old";
const NEW_LINK = "https://school.example/notices/pickup-new";

async function makeUser() {
  const db = await getDb();
  const id = newId("usr");
  await db.insert(schema.users).values({ id, kind: "workspace", displayName: "Test" });
  return id;
}

async function publishNew(owner: string, sourceUrl: string | null) {
  const { noticeId, revisionId } = await svc.createNotice(owner, { title: "Pickup notice", text: ORIGINAL, sourceUrl, voiceId: "test-tone" });
  await svc.generatePreview(owner, revisionId);
  await svc.approveRevision(owner, revisionId);
  const notice = (await (await getDb()).select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
  return { noticeId, token: notice.publicToken };
}

const live = async (token: string) => {
  const m = await getPublicManifest(token);
  return m?.state === "published" ? m.sourceUrl : "not published";
};

async function approveCorrection(owner: string, revisionId: string) {
  await svc.generatePreview(owner, revisionId);
  const { version } = await svc.updateDraft(owner, revisionId, {}); // reads the current saved version
  await svc.approveRevision(owner, revisionId, { expectedVersion: version });
}

beforeAll(async () => {
  await getDb();
});
afterAll(async () => {
  await closeDb();
});

describe("the source link of a published notice can be corrected", () => {
  it("a correction starts from the link listeners see now", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner, OLD_LINK);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    const row = (await (await getDb()).select().from(schema.noticeRevisions).where(eq(schema.noticeRevisions.id, revisionId)))[0]!;
    expect(row.sourceUrl).toBe(OLD_LINK);
  });

  it("the new link goes live only when the correction is approved, not while it is a draft", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publishNew(owner, OLD_LINK);
    expect(await live(token)).toBe(OLD_LINK);

    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    await svc.updateDraft(owner, revisionId, { sourceUrl: NEW_LINK });
    expect(await live(token)).toBe(OLD_LINK); // the public page is untouched while the draft is edited

    await svc.generatePreview(owner, revisionId);
    expect(await live(token)).toBe(OLD_LINK); // and while its audio is previewed

    await approveCorrection(owner, revisionId);
    expect(await live(token)).toBe(NEW_LINK);
  });

  it("a link can be supplied when the correction is created", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publishNew(owner, OLD_LINK);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED, sourceUrl: NEW_LINK });
    await approveCorrection(owner, revisionId);
    expect(await live(token)).toBe(NEW_LINK);
  });

  it("a link can be removed in a correction", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publishNew(owner, OLD_LINK);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    await svc.updateDraft(owner, revisionId, { sourceUrl: null });
    await approveCorrection(owner, revisionId);
    expect(await live(token)).toBeNull();
  });

  it("a link can be added to a notice that had none", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publishNew(owner, null);
    expect(await live(token)).toBeNull();
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    await svc.updateDraft(owner, revisionId, { sourceUrl: NEW_LINK });
    await approveCorrection(owner, revisionId);
    expect(await live(token)).toBe(NEW_LINK);
  });

  it("a save that does not mention the link leaves it alone", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publishNew(owner, OLD_LINK);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    await svc.updateDraft(owner, revisionId, { sourceUrl: NEW_LINK });
    await svc.updateDraft(owner, revisionId, { text: CORRECTED + " Please be on time." }); // no sourceUrl in this save
    await approveCorrection(owner, revisionId);
    expect(await live(token)).toBe(NEW_LINK);
  });

  it("a discarded correction never changes the live link", async () => {
    const owner = await makeUser();
    const { noticeId, token } = await publishNew(owner, OLD_LINK);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    await svc.updateDraft(owner, revisionId, { sourceUrl: NEW_LINK });
    await svc.discardDraft(owner, revisionId);
    expect(await live(token)).toBe(OLD_LINK);
    // The next correction starts from what is live, not from the discarded draft.
    const next = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    const row = (await (await getDb()).select().from(schema.noticeRevisions).where(eq(schema.noticeRevisions.id, next.revisionId)))[0]!;
    expect(row.sourceUrl).toBe(OLD_LINK);
  });

  it("changing only the link does not throw away a previewed audio", async () => {
    const owner = await makeUser();
    const { noticeId } = await publishNew(owner, OLD_LINK);
    const { revisionId } = await svc.createRevision(owner, noticeId, { text: CORRECTED });
    await svc.generatePreview(owner, revisionId);
    await svc.updateDraft(owner, revisionId, { sourceUrl: NEW_LINK });
    const row = (await (await getDb()).select().from(schema.noticeRevisions).where(eq(schema.noticeRevisions.id, revisionId)))[0]!;
    expect(row.status).toBe("preview_ready");
    expect(row.audioAssetId).not.toBeNull();
  });

  it("before first publication the link is editable as it always was", async () => {
    const owner = await makeUser();
    const { noticeId, revisionId } = await svc.createNotice(owner, { title: "T", text: ORIGINAL, sourceUrl: OLD_LINK, voiceId: "test-tone" });
    await svc.updateDraft(owner, revisionId, { sourceUrl: NEW_LINK });
    const notice = (await (await getDb()).select().from(schema.notices).where(eq(schema.notices.id, noticeId)))[0]!;
    expect(notice.sourceUrl).toBe(NEW_LINK);
    await svc.generatePreview(owner, revisionId);
    await svc.approveRevision(owner, revisionId);
    expect(await live(notice.publicToken)).toBe(NEW_LINK);
  });
});

describe("the migration that adds the column", () => {
  it("gives every existing revision its notice's current link, and changes nothing else", async () => {
    const dir = path.resolve("drizzle");
    const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files.at(-1)).toBe("0003_revision_source_url.sql");
    const pg = new PGlite();
    const run = async (file: string) => {
      for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
        if (stmt.trim()) await pg.exec(stmt);
      }
    };
    // The database as it was before this change.
    for (const f of files.slice(0, -1)) await run(f);
    await pg.exec(`insert into users (id, kind, display_name) values ('u1', 'workspace', 'U')`);
    await pg.exec(`insert into notices (id, owner_id, public_token, title, source_url) values
      ('n1', 'u1', 'tok1', 'With link', 'https://example.org/a'),
      ('n2', 'u1', 'tok2', 'No link', null)`);
    for (const [id, notice] of [["r1", "n1"], ["r2", "n1"], ["r3", "n2"]] as const) {
      await pg.exec(`insert into notice_revisions (id, notice_id, title, display_text, speech_text, voice_id, provider, synthesis_key)
        values ('${id}', '${notice}', 'T', 'text', 'speech', 'v', 'test', 'k${id}')`);
    }
    await run(files.at(-1)!);
    const rows = (await pg.query<{ id: string; source_url: string | null; display_text: string }>(`select id, source_url, display_text from notice_revisions order by id`)).rows;
    expect(rows.map((r) => [r.id, r.source_url])).toEqual([
      ["r1", "https://example.org/a"],
      ["r2", "https://example.org/a"],
      ["r3", null],
    ]);
    expect(rows.every((r) => r.display_text === "text")).toBe(true);
    await pg.close();
  });
});
