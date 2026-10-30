import "server-only";
import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { audioAssets, noticeRevisions, rateLimits, sessions } from "../db/schema";
import { purgeChallenges } from "../auth/email-auth";
import { objectStore } from "../storage/audio";

const STAGING_TTL_MS = 24 * 3600_000;
/** A published copy that never became ready (a lost approval race, a crash) is kept this long, then removed. */
const PENDING_PUBLISHED_GRACE_MS = 3600_000;
const RATE_LIMIT_RETENTION_MS = 24 * 3600_000;

/** Removes the stored bytes unless another live asset row still points at the same object. */
async function deleteObjectIfUnreferenced(assetId: string, objectKey: string) {
  const db = await getDb();
  const others = await db
    .select({ id: audioAssets.id })
    .from(audioAssets)
    .where(and(eq(audioAssets.objectKey, objectKey), ne(audioAssets.id, assetId), isNull(audioAssets.deletedAt)))
    .limit(1);
  if (others.length === 0) await objectStore().delete(objectKey);
}

/**
 * Deletes staging audio older than 24 hours. A staging file is never what listeners hear: published
 * audio is copied to its own immutable path at approval, and unapproved previews expire.
 * The revision row and its metadata are kept; only the temporary bytes go.
 *
 * `hooks.afterSelect` runs between reading the stale assets and acting on them. Tests use it to replay
 * the interleavings that production traffic can produce.
 */
export async function cleanupStagingAudio(now = new Date(), hooks: { afterSelect?: () => Promise<void> } = {}) {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - STAGING_TTL_MS);
  const stale = await db
    .select({ asset: audioAssets, revisionStatus: noticeRevisions.status, revisionAudio: noticeRevisions.audioAssetId })
    .from(audioAssets)
    .innerJoin(noticeRevisions, eq(noticeRevisions.id, audioAssets.revisionId))
    .where(and(eq(audioAssets.stage, "staging"), isNull(audioAssets.deletedAt), lt(audioAssets.createdAt, cutoff)));
  await hooks.afterSelect?.();

  let deleted = 0;
  for (const { asset, revisionStatus, revisionAudio } of stale) {
    // An expired preview can no longer be approved; the publisher regenerates it. Detach it first, and only
    // while this exact asset is still the revision's preview. If the publisher replaced it or approved it since
    // the select above, the condition matches nothing and the new state is left alone.
    if (revisionAudio === asset.id && revisionStatus === "preview_ready") {
      await db
        .update(noticeRevisions)
        .set({
          status: "draft",
          audioAssetId: null,
          generatedAt: null,
          version: sql`${noticeRevisions.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(noticeRevisions.id, asset.revisionId),
            eq(noticeRevisions.status, "preview_ready"),
            eq(noticeRevisions.audioAssetId, asset.id),
          ),
        );
    }
    await db.update(audioAssets).set({ deletedAt: now, contentReady: false }).where(eq(audioAssets.id, asset.id));
    await deleteObjectIfUnreferenced(asset.id, asset.objectKey);
    deleted++;
  }
  return { deleted };
}

/**
 * Approval registers its published copy before writing the bytes and marks it ready only when the revision is
 * promoted. A copy still not ready after the grace period belongs to an approval that lost or died, so its
 * bytes can go. Ready copies are never touched here: superseded audio is kept as the notice's history.
 */
export async function cleanupAbandonedPublished(now = new Date()) {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - PENDING_PUBLISHED_GRACE_MS);
  const pending = await db
    .select()
    .from(audioAssets)
    .where(and(eq(audioAssets.stage, "published"), eq(audioAssets.contentReady, false), isNull(audioAssets.deletedAt), lt(audioAssets.createdAt, cutoff)));
  let deleted = 0;
  for (const asset of pending) {
    await db.update(audioAssets).set({ deletedAt: now }).where(eq(audioAssets.id, asset.id));
    await deleteObjectIfUnreferenced(asset.id, asset.objectKey);
    deleted++;
  }
  return { deleted };
}

/** Drops rows that only ever matter for a short window: expired sessions and old rate-limit counters. */
export async function cleanupExpiredRecords(now = new Date()) {
  const db = await getDb();
  const sessionsRemoved = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ hash: sessions.tokenHash });
  const limitsRemoved = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - RATE_LIMIT_RETENTION_MS)))
    .returning({ key: rateLimits.key });
  return { sessions: sessionsRemoved.length, rateLimits: limitsRemoved.length };
}

export async function runCleanup(now = new Date()) {
  return {
    staging: await cleanupStagingAudio(now),
    abandonedPublished: await cleanupAbandonedPublished(now),
    expired: await cleanupExpiredRecords(now),
    challenges: await purgeChallenges(now),
  };
}
