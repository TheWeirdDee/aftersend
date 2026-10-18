import "server-only";
import { and, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { audioAssets, noticeRevisions } from "../db/schema";
import { objectStore } from "../storage/audio";

const STAGING_TTL_MS = 24 * 3600_000;

/**
 * Deletes staging audio older than 24 hours. A staging file is never what listeners hear: published
 * audio is copied to its own immutable path at approval, and unapproved previews expire.
 * The revision row and its metadata are kept; only the temporary bytes go.
 */
export async function cleanupStagingAudio(now = new Date()) {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - STAGING_TTL_MS);
  const stale = await db
    .select({ asset: audioAssets, revisionStatus: noticeRevisions.status, revisionAudio: noticeRevisions.audioAssetId })
    .from(audioAssets)
    .innerJoin(noticeRevisions, eq(noticeRevisions.id, audioAssets.revisionId))
    .where(and(eq(audioAssets.stage, "staging"), isNull(audioAssets.deletedAt), lt(audioAssets.createdAt, cutoff)));

  let deleted = 0;
  for (const { asset, revisionStatus, revisionAudio } of stale) {
    await objectStore().delete(asset.objectKey);
    await db.update(audioAssets).set({ deletedAt: now, contentReady: false }).where(eq(audioAssets.id, asset.id));
    // An expired preview can no longer be approved; the publisher regenerates it.
    if (revisionAudio === asset.id && revisionStatus === "preview_ready") {
      await db
        .update(noticeRevisions)
        .set({ status: "draft", audioAssetId: null, generatedAt: null, updatedAt: now })
        .where(and(eq(noticeRevisions.id, asset.revisionId), eq(noticeRevisions.status, "preview_ready")));
    }
    deleted++;
  }
  return { deleted };
}
