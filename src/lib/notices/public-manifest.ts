import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { audioAssets, noticeRevisions, notices, type UpdateSummary } from "../db/schema";
import { PUBLIC_TOKEN_PATTERN } from "../ids";

export type PublicManifest =
  | {
      state: "published";
      noticeTitle: string;
      revisionId: string;
      revisionNumber: number;
      publishedAt: string;
      firstPublishedAt: string;
      timezone: string;
      displayText: string;
      updatePreface: string | null;
      updateSummary: UpdateSummary[] | null;
      audioUrl: string;
      audioMime: string;
      audioDurationMs: number | null;
      audioSha256: string;
      audioIsTestTone: boolean;
      sourceUrl: string | null;
      isDemo: boolean;
    }
  | { state: "withdrawn"; noticeTitle: string; withdrawnAt: string; isDemo: boolean };

export function audioPath(token: string, revisionId: string, sha256: string, mime: string) {
  return `/api/public/${token}/audio/${revisionId}/${sha256}.${mime === "audio/mpeg" ? "mp3" : "wav"}`;
}

/**
 * One query joins the notice, its current revision and that revision's published audio, so text and
 * audio always come from the same revision. Unpublished drafts are never reachable from here.
 */
export async function getPublicManifest(token: string): Promise<PublicManifest | null> {
  if (!PUBLIC_TOKEN_PATTERN.test(token)) return null;
  const db = await getDb();
  const rows = await db
    .select({ notice: notices, revision: noticeRevisions, audio: audioAssets })
    .from(notices)
    .innerJoin(noticeRevisions, eq(noticeRevisions.id, notices.currentRevisionId))
    .innerJoin(audioAssets, eq(audioAssets.id, noticeRevisions.audioAssetId))
    .where(and(eq(notices.publicToken, token), eq(noticeRevisions.status, "published"), eq(audioAssets.stage, "published")))
    .limit(1);
  const row = rows[0];
  if (!row) {
    const n = (await db.select().from(notices).where(eq(notices.publicToken, token)).limit(1))[0];
    if (n?.state === "withdrawn") {
      return { state: "withdrawn", noticeTitle: n.title, withdrawnAt: (n.withdrawnAt ?? n.updatedAt).toISOString(), isDemo: n.isDemo };
    }
    return null;
  }
  const { notice, revision, audio } = row;
  if (notice.state === "withdrawn") {
    return {
      state: "withdrawn",
      noticeTitle: notice.title,
      withdrawnAt: (notice.withdrawnAt ?? notice.updatedAt).toISOString(),
      isDemo: notice.isDemo,
    };
  }
  const first = await db
    .select({ publishedAt: noticeRevisions.publishedAt })
    .from(noticeRevisions)
    .where(and(eq(noticeRevisions.noticeId, notice.id), eq(noticeRevisions.revisionNumber, 1)))
    .limit(1);
  return {
    state: "published",
    noticeTitle: revision.title,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber!,
    publishedAt: revision.publishedAt!.toISOString(),
    firstPublishedAt: (first[0]?.publishedAt ?? revision.publishedAt!).toISOString(),
    timezone: notice.timezone,
    displayText: revision.displayText,
    updatePreface: revision.updatePreface,
    updateSummary: revision.revisionNumber! > 1 ? revision.updateSummary : null,
    audioUrl: audioPath(token, revision.id, audio.sha256, audio.mimeType),
    audioMime: audio.mimeType,
    audioDurationMs: audio.durationMs,
    audioSha256: audio.sha256,
    audioIsTestTone: audio.providerKind === "test",
    sourceUrl: notice.sourceUrl,
    isDemo: notice.isDemo,
  };
}

/** Resolves audio bytes for the public route: only the notice's *current* published revision is served. */
export async function getPublicAudio(token: string, revisionId: string, sha256: string) {
  if (!PUBLIC_TOKEN_PATTERN.test(token)) return null;
  const db = await getDb();
  const rows = await db
    .select({ audio: audioAssets, notice: notices })
    .from(notices)
    .innerJoin(noticeRevisions, eq(noticeRevisions.id, notices.currentRevisionId))
    .innerJoin(audioAssets, eq(audioAssets.id, noticeRevisions.audioAssetId))
    .where(
      and(
        eq(notices.publicToken, token),
        eq(notices.state, "published"),
        eq(noticeRevisions.id, revisionId),
        eq(audioAssets.sha256, sha256),
        eq(audioAssets.stage, "published"),
      ),
    )
    .limit(1);
  return rows[0]?.audio ?? null;
}
