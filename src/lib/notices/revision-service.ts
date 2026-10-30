import "server-only";
import { and, desc, eq, inArray, isNull, lt, max, or, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import {
  audioAssets,
  noticeRevisions,
  notices,
  synthesisAttempts,
  type AudioAsset,
  type Notice,
  type NoticeRevision,
  type SynthesisAttempt,
  type UpdateSummary,
} from "../db/schema";
import { inspectAudio } from "../audio/wav";
import { env } from "../env";
import { AppError } from "../http/errors";
import { newId, newPublicToken, sha256Hex } from "../ids";
import { log } from "../log";
import { speechProvider } from "../speech";
import { SpeechProviderError, type SpeechProvider } from "../speech/provider";
import { objectStore, publishedKey, stagingKey } from "../storage/audio";
import { factChanges } from "./diff";
import { findAmbiguousSpokenFact } from "./facts";
import { isValidTimezone } from "./validation";
import { toSpeechText } from "./normalize-speech";

const EDITABLE: NoticeRevision["status"][] = ["draft", "failed", "preview_ready"];
const MAX_RETRIES = 2;
/** Time reserved after the provider returns for validation, storage and the database commit: 10% of the deadline, at most 5 s. */
const postSynthesisReserveMs = () => Math.min(5_000, env().SYNTHESIS_DEADLINE_MS * 0.1);
/** An attempt that cannot get at least this long is not started: 10% of the deadline, at most 5 s. */
const minAttemptMs = () => Math.min(5_000, env().SYNTHESIS_DEADLINE_MS * 0.1);
/** How long a synthesizing claim is trusted after the request deadline before another request may take it over. */
export const CLAIM_GRACE_MS = 15_000;

/** After this long a 'synthesizing' revision is presumed abandoned and can be generated again. */
export function synthesisStaleAfterMs() {
  return env().SYNTHESIS_DEADLINE_MS + CLAIM_GRACE_MS;
}

function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
    if (e.code === "23505") return true;
  }
  return false;
}

function staleVersion(currentVersion: number) {
  return new AppError("conflict", "This draft was changed in another tab or session. Load the latest version before saving.", false, {
    reason: "stale_version",
    currentVersion,
  });
}

function assertSpokenFactsClear(fields: { title: string; text: string; updatePreface?: string | null }) {
  const hit = findAmbiguousSpokenFact(fields);
  if (!hit) return;
  const where = hit.field === "title" ? "the title" : hit.field === "updatePreface" ? "the update note" : "the notice text";
  throw new AppError(
    "validation_failed",
    `Resolve “${hit.fact.value}” in ${where} before continuing. ${hit.fact.note ?? ""}`.trim(),
    false,
    { field: hit.field },
  );
}

export function synthesisKeyFor(provider: string, modelId: string | null, voiceId: string, speechText: string) {
  return sha256Hex(JSON.stringify([provider, modelId ?? "", voiceId, speechText]));
}

async function ownedNotice(db: Db, ownerId: string, noticeId: string): Promise<Notice> {
  const rows = await db
    .select()
    .from(notices)
    .where(and(eq(notices.id, noticeId), eq(notices.ownerId, ownerId)))
    .limit(1);
  // Same response whether the notice is missing or belongs to someone else.
  if (!rows[0]) throw new AppError("not_found", "Notice not found.");
  return rows[0];
}

async function ownedRevision(db: Db, ownerId: string, revisionId: string) {
  const rows = await db
    .select({ revision: noticeRevisions, notice: notices })
    .from(noticeRevisions)
    .innerJoin(notices, eq(notices.id, noticeRevisions.noticeId))
    .where(and(eq(noticeRevisions.id, revisionId), eq(notices.ownerId, ownerId)))
    .limit(1);
  if (!rows[0]) throw new AppError("not_found", "Revision not found.");
  return rows[0];
}

function assertVoiceAvailable(provider: SpeechProvider, voiceId: string) {
  if (!provider.listVoices().some((v) => v.id === voiceId)) {
    throw new AppError("validation_failed", "That voice is not available.");
  }
}

export async function createNotice(
  ownerId: string,
  input: { title: string; text: string; sourceUrl: string | null; voiceId: string; timezone?: string },
  opts: { isDemo?: boolean } = {},
) {
  const db = await getDb();
  const provider = speechProvider();
  assertVoiceAvailable(provider, input.voiceId);
  const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : "Africa/Lagos";
  const noticeId = newId("ntc");
  const revisionId = newId("rev");
  const speechText = toSpeechText(input.title, input.text);
  await db.transaction(async (tx) => {
    await tx.insert(notices).values({
      id: noticeId,
      ownerId,
      publicToken: newPublicToken(),
      title: input.title,
      sourceUrl: input.sourceUrl,
      timezone,
      isDemo: opts.isDemo ?? false,
    });
    await tx.insert(noticeRevisions).values({
      id: revisionId,
      noticeId,
      baseRevisionId: null,
      title: input.title,
      displayText: input.text,
      speechText,
      voiceId: input.voiceId,
      provider: provider.kind,
      modelId: provider.modelId,
      synthesisKey: synthesisKeyFor(provider.kind, provider.modelId, input.voiceId, speechText),
    });
  });
  return { noticeId, revisionId };
}

/** Starts a correction draft from the current approved revision. */
export async function createRevision(
  ownerId: string,
  noticeId: string,
  input: { title?: string; text: string; voiceId?: string; updatePreface?: string | null; clientToken?: string },
) {
  const db = await getDb();
  const notice = await ownedNotice(db, ownerId, noticeId);
  if (notice.state === "withdrawn") throw new AppError("notice_withdrawn", "This notice has been withdrawn.");
  const provider = speechProvider();
  let base: NoticeRevision | null = null;
  if (notice.currentRevisionId) {
    base = (await db.select().from(noticeRevisions).where(eq(noticeRevisions.id, notice.currentRevisionId)).limit(1))[0] ?? null;
  }
  const diffBase = () =>
    base ? { revisionId: base.id, revisionNumber: base.revisionNumber, displayText: base.displayText } : null;
  const existingByToken = async () =>
    input.clientToken
      ? (
          await db
            .select({ id: noticeRevisions.id, version: noticeRevisions.version })
            .from(noticeRevisions)
            .where(and(eq(noticeRevisions.noticeId, noticeId), eq(noticeRevisions.clientToken, input.clientToken)))
            .limit(1)
        )[0]
      : undefined;
  // A retried create (lost response) returns the draft it already made.
  const already = await existingByToken();
  if (already) return { revisionId: already.id, version: already.version, diffBase: diffBase() };
  const title = input.title ?? base?.title ?? notice.title;
  const voiceId = input.voiceId ?? base?.voiceId ?? provider.listVoices()[0]?.id ?? "";
  assertVoiceAvailable(provider, voiceId);
  const speechText = toSpeechText(title, input.text, input.updatePreface);
  const id = newId("rev");
  try {
    await db.insert(noticeRevisions).values({
      id,
      noticeId,
      baseRevisionId: notice.currentRevisionId,
      title,
      displayText: input.text,
      speechText,
      updatePreface: input.updatePreface ?? null,
      updateSummary: base ? summarize(base.displayText, input.text) : null,
      voiceId,
      provider: provider.kind,
      modelId: provider.modelId,
      synthesisKey: synthesisKeyFor(provider.kind, provider.modelId, voiceId, speechText),
      clientToken: input.clientToken ?? null,
    });
  } catch (err) {
    // Two requests carrying the same token raced: the loser returns the winner's draft.
    const winner = isUniqueViolation(err) ? await existingByToken() : undefined;
    if (!winner) throw err;
    return { revisionId: winner.id, version: winner.version, diffBase: diffBase() };
  }
  return { revisionId: id, version: 1, diffBase: diffBase() };
}

function summarize(before: string, after: string): UpdateSummary[] {
  return factChanges(before, after)
    .filter((c) => c.currentValue)
    .map((c) => ({ changedField: c.kind, previousValue: c.previousValue, currentValue: c.currentValue! }));
}

/** Editing a draft invalidates any preview whose audio no longer matches the text. */
export async function updateDraft(
  ownerId: string,
  revisionId: string,
  input: {
    title?: string;
    text?: string;
    voiceId?: string;
    updatePreface?: string | null;
    confirmedCriticalFacts?: boolean;
    sourceUrl?: string | null;
    expectedVersion?: number;
  },
) {
  const db = await getDb();
  const { revision, notice } = await ownedRevision(db, ownerId, revisionId);
  if (notice.state === "withdrawn") throw new AppError("notice_withdrawn", "This notice has been withdrawn.");
  if (!EDITABLE.includes(revision.status)) {
    throw new AppError("conflict", "This revision can no longer be edited.", false, { reason: "locked", status: revision.status });
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== revision.version) throw staleVersion(revision.version);
  const provider = speechProvider();
  const title = input.title ?? revision.title;
  const text = input.text ?? revision.displayText;
  const voiceId = input.voiceId ?? revision.voiceId;
  if (input.voiceId) assertVoiceAvailable(provider, voiceId);
  const updatePreface = input.updatePreface !== undefined ? input.updatePreface : revision.updatePreface;
  const speechText = toSpeechText(title, text, updatePreface);
  const synthesisKey = synthesisKeyFor(provider.kind, provider.modelId, voiceId, speechText);
  const contentChanged = synthesisKey !== revision.synthesisKey;
  const textChanged = text !== revision.displayText || title !== revision.title;

  let updateSummary = revision.updateSummary;
  if (revision.baseRevisionId && textChanged) {
    const base = (await db.select().from(noticeRevisions).where(eq(noticeRevisions.id, revision.baseRevisionId)).limit(1))[0];
    if (base) updateSummary = summarize(base.displayText, text);
  }

  await db.transaction(async (tx) => {
    const res = await tx
      .update(noticeRevisions)
      .set({
        title,
        displayText: text,
        speechText,
        voiceId,
        updatePreface,
        updateSummary,
        provider: provider.kind,
        modelId: provider.modelId,
        synthesisKey,
        confirmedCriticalFacts: textChanged ? false : (input.confirmedCriticalFacts ?? revision.confirmedCriticalFacts),
        ...(contentChanged ? { status: "draft" as const, audioAssetId: null, generatedAt: null, requestId: null } : {}),
        version: revision.version + 1,
        updatedAt: new Date(),
      })
      // Compare-and-swap on the version read above: a concurrent save makes this match nothing.
      .where(
        and(
          eq(noticeRevisions.id, revisionId),
          inArray(noticeRevisions.status, EDITABLE),
          eq(noticeRevisions.version, revision.version),
        ),
      )
      .returning({ id: noticeRevisions.id });
    if (res.length === 0) {
      const now = (await tx.select({ version: noticeRevisions.version }).from(noticeRevisions).where(eq(noticeRevisions.id, revisionId)))[0];
      throw staleVersion(now?.version ?? revision.version);
    }
    if (input.sourceUrl !== undefined && notice.state === "draft") {
      await tx.update(notices).set({ sourceUrl: input.sourceUrl, updatedAt: new Date() }).where(eq(notices.id, notice.id));
    }
  });
  return { version: revision.version + 1, status: contentChanged ? ("draft" as const) : revision.status };
}

export async function discardDraft(ownerId: string, revisionId: string) {
  const db = await getDb();
  const { revision, notice } = await ownedRevision(db, ownerId, revisionId);
  if (!EDITABLE.includes(revision.status)) throw new AppError("conflict", "Only unpublished drafts can be discarded.");
  if (!notice.currentRevisionId) throw new AppError("conflict", "The first draft of an unpublished notice cannot be discarded.");
  await db
    .update(noticeRevisions)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(and(eq(noticeRevisions.id, revisionId), inArray(noticeRevisions.status, EDITABLE)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generatePreview(ownerId: string, revisionId: string) {
  const db = await getDb();
  const { revision, notice } = await ownedRevision(db, ownerId, revisionId);
  const provider = speechProvider();

  if (revision.status === "preview_ready" && revision.audioAssetId) {
    return { status: "preview_ready" as const, reused: true }; // idempotent: same text, voice and model
  }
  if (!["draft", "failed", "synthesizing"].includes(revision.status)) {
    throw new AppError("conflict", "This revision is not awaiting audio.");
  }
  if (notice.state === "withdrawn") throw new AppError("notice_withdrawn", "This notice has been withdrawn.");
  // Do not spend provider credits on a draft that can no longer be published.
  if ((revision.baseRevisionId ?? null) !== (notice.currentRevisionId ?? null)) {
    throw new AppError(
      "conflict",
      "A newer version was published while you were editing. Review the latest version and start a new correction.",
      false,
      { reason: "superseded" },
    );
  }
  assertSpokenFactsClear({ title: revision.title, text: revision.displayText, updatePreface: revision.updatePreface });
  const configured = provider.isConfigured();
  if (!configured.ok) throw new AppError("provider_not_configured", `Speech generation is unavailable: ${configured.reason}`);

  // Claim the revision under a fresh attempt id. Only the holder of that id may finish or fail the synthesis,
  // so a stalled worker that wakes up after its claim was taken over cannot touch the replacement's result.
  const attemptId = newId("att");
  const staleBefore = new Date(Date.now() - synthesisStaleAfterMs());
  const claimed = await db
    .update(noticeRevisions)
    .set({ status: "synthesizing", synthesisClaim: attemptId, updatedAt: new Date() })
    .where(
      and(
        eq(noticeRevisions.id, revisionId),
        eq(noticeRevisions.synthesisKey, revision.synthesisKey),
        or(
          inArray(noticeRevisions.status, ["draft", "failed"]),
          and(eq(noticeRevisions.status, "synthesizing"), lt(noticeRevisions.updatedAt, staleBefore)),
        ),
      ),
    )
    .returning({ id: noticeRevisions.id });
  if (claimed.length === 0) {
    throw new AppError("synthesis_in_progress", "Audio is already being generated for this revision.", true);
  }

  await db.insert(synthesisAttempts).values({
    id: attemptId,
    revisionId,
    synthesisKey: revision.synthesisKey,
    provider: provider.kind,
    modelId: provider.modelId,
    voiceId: revision.voiceId,
    outcome: "in_progress",
  });

  // One deadline covers every attempt, backoff and the storage work, so the request can always record
  // its outcome before the platform ends it. Each attempt gets what is left, minus the post-work reserve.
  const deadline = Date.now() + env().SYNTHESIS_DEADLINE_MS;
  const remaining = () => deadline - Date.now();
  let retries = 0;
  try {
    let result;
    for (;;) {
      const available = remaining() - postSynthesisReserveMs();
      if (available < minAttemptMs()) {
        throw new SpeechProviderError("timeout", "Audio generation ran out of time. Try again, or shorten the notice.", false);
      }
      const attemptBudget = Math.min(env().ASSEMBLYAI_TTS_TIMEOUT_MS, available);
      try {
        result = await provider.synthesize({
          text: revision.speechText,
          voiceId: revision.voiceId,
          outputFormat: "wav",
          requestContext: { revisionId, attemptId, timeoutMs: attemptBudget },
        });
        break;
      } catch (err) {
        // When the provider says how long to wait (its new-sessions-per-minute window), wait exactly that, if it fits
        // in the time left; otherwise fail now with the number, rather than burn the budget on retries that cannot work.
        const hinted = err instanceof SpeechProviderError && err.retryAfterSec != null ? err.retryAfterSec * 1000 + 250 : null;
        const backoff = hinted ?? (err instanceof SpeechProviderError && err.kind === "rate_limited" ? 2000 : 500) * 2 ** retries;
        if (
          err instanceof SpeechProviderError &&
          err.retryable &&
          retries < MAX_RETRIES &&
          remaining() - backoff - postSynthesisReserveMs() >= minAttemptMs()
        ) {
          retries++;
          await sleep(backoff);
          continue;
        }
        throw err;
      }
    }

    const inspection = inspectAudio(result.audio);
    if (!inspection.ok) throw new SpeechProviderError("provider_error", `Audio failed validation: ${inspection.reason}`, true);
    const sha256 = sha256Hex(result.audio);
    const ext = inspection.mimeType === "audio/mpeg" ? "mp3" : "wav";
    const objectKey = stagingKey(notice.id, revisionId, sha256, ext);
    const store = objectStore();
    await store.put(objectKey, result.audio, inspection.mimeType);
    const stored = await store.get(objectKey);
    if (!stored || sha256Hex(stored) !== sha256) throw new SpeechProviderError("provider_error", "Stored audio did not verify.", true);

    const assetId = newId("aud");
    const latency = result.completedAt.getTime() - result.startedAt.getTime();
    const committed = await db.transaction(async (tx) => {
      await tx.insert(audioAssets).values({
        id: assetId,
        revisionId,
        stage: "staging",
        objectKey,
        providerKind: provider.kind,
        mimeType: inspection.mimeType,
        sha256,
        bytes: result.audio.byteLength,
        durationMs: inspection.durationMs ?? result.durationMs,
        providerLatencyMs: latency,
        contentReady: true,
      });
      // Attach the audio only if this attempt still owns the claim and the text is still the text it was made from.
      const updated = await tx
        .update(noticeRevisions)
        .set({
          status: "preview_ready",
          audioAssetId: assetId,
          synthesisClaim: null,
          generatedAt: result.completedAt,
          requestId: result.providerRequestId,
          modelId: result.providerModel ?? provider.modelId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(noticeRevisions.id, revisionId),
            eq(noticeRevisions.status, "synthesizing"),
            eq(noticeRevisions.synthesisKey, revision.synthesisKey),
            eq(noticeRevisions.synthesisClaim, attemptId),
          ),
        )
        .returning({ id: noticeRevisions.id });
      await tx
        .update(synthesisAttempts)
        .set({
          outcome: updated.length ? "success" : "cancelled",
          providerRequestId: result.providerRequestId,
          modelId: result.providerModel ?? provider.modelId,
          firstAudioAt: result.firstAudioAt,
          completedAt: result.completedAt,
          retries,
          errorCode: updated.length ? null : "superseded",
        })
        .where(eq(synthesisAttempts.id, attemptId));
      return updated.length > 0;
    });
    if (!committed) throw new AppError("conflict", "The text changed while audio was generating. Generate again.", true);
    log("info", "synthesis.succeeded", { revisionId, attemptId, retries, providerLatencyMs: latency, bytes: result.audio.byteLength, providerRequestId: result.providerRequestId });
    return { status: "preview_ready" as const, reused: false, latencyMs: latency };
  } catch (err) {
    const providerErr = err instanceof SpeechProviderError ? err : null;
    log(providerErr?.retryable ? "warn" : "error", "synthesis.failed", {
      revisionId,
      attemptId,
      kind: providerErr?.kind ?? (err instanceof AppError ? err.code : "internal"),
      providerCode: providerErr?.providerCode,
      providerDetail: providerErr?.providerDetail,
      retryAfterSec: providerErr?.retryAfterSec,
      retries,
      elapsedMs: env().SYNTHESIS_DEADLINE_MS - (deadline - Date.now()),
    });
    await db
      .update(synthesisAttempts)
      .set({
        outcome: providerErr?.kind === "cancelled" ? "cancelled" : "failed",
        completedAt: new Date(),
        retries,
        errorCode: providerErr ? providerErr.kind : err instanceof AppError ? err.code : "internal",
        errorMessage: providerErr ? providerErr.message.slice(0, 300) : null,
      })
      .where(and(eq(synthesisAttempts.id, attemptId), eq(synthesisAttempts.outcome, "in_progress")));
    await db
      .update(noticeRevisions)
      .set({ status: "failed", synthesisClaim: null, updatedAt: new Date() })
      .where(
        and(eq(noticeRevisions.id, revisionId), eq(noticeRevisions.status, "synthesizing"), eq(noticeRevisions.synthesisClaim, attemptId)),
      );
    if (err instanceof AppError) throw err;
    if (providerErr) {
      if (providerErr.kind === "rate_limited") {
        const wait = providerErr.retryAfterSec;
        throw new AppError(
          "rate_limited",
          wait ? `The speech service is busy right now. Try again in ${wait} seconds.` : "The speech service is busy right now. Try again in a minute.",
          true,
          { retryAfterSec: wait ?? 60 },
        );
      }
      throw new AppError(
        providerErr.kind === "not_configured" ? "provider_not_configured" : "synthesis_failed",
        `Audio generation failed: ${providerErr.message}`,
        providerErr.retryable,
      );
    }
    throw err;
  }
}

export async function approveRevision(ownerId: string, revisionId: string, opts: { expectedVersion?: number } = {}) {
  const db = await getDb();
  const { revision, notice } = await ownedRevision(db, ownerId, revisionId);
  if (revision.status === "published") return { noticeId: notice.id, revisionNumber: revision.revisionNumber, alreadyPublished: true };
  // The approval must name the saved version whose audio the publisher heard.
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== revision.version) throw staleVersion(revision.version);
  if (revision.status !== "preview_ready" || !revision.audioAssetId) {
    throw new AppError("audio_not_ready", "Generate and listen to the audio preview before approving.");
  }
  assertSpokenFactsClear({ title: revision.title, text: revision.displayText, updatePreface: revision.updatePreface });
  const staged = (await db.select().from(audioAssets).where(eq(audioAssets.id, revision.audioAssetId)).limit(1))[0];
  if (!staged || !staged.contentReady || staged.revisionId !== revision.id || staged.stage !== "staging") {
    throw new AppError("audio_not_ready", "The preview audio is not ready.");
  }

  // Verify the staged bytes again and copy them to an immutable, revision-specific published path.
  const store = objectStore();
  const bytes = await store.get(staged.objectKey);
  if (!bytes || sha256Hex(bytes) !== staged.sha256 || !inspectAudio(bytes).ok) {
    throw new AppError("audio_not_ready", "The preview audio failed verification. Generate it again.", true);
  }
  const ext = staged.mimeType === "audio/mpeg" ? "mp3" : "wav";
  const pubKey = publishedKey(notice.id, revision.id, staged.sha256, ext);
  // Record the intended object before writing it. If this approval loses a race or crashes, the row is
  // still not ready, and cleanup can find and remove the bytes after a grace period.
  const pubAssetId = newId("aud");
  await db.insert(audioAssets).values({
    id: pubAssetId,
    revisionId: revision.id,
    stage: "published",
    objectKey: pubKey,
    providerKind: staged.providerKind,
    mimeType: staged.mimeType,
    sha256: staged.sha256,
    bytes: staged.bytes,
    durationMs: staged.durationMs,
    providerLatencyMs: staged.providerLatencyMs,
    contentReady: false,
  });
  await store.put(pubKey, bytes, staged.mimeType);
  const check = await store.get(pubKey);
  if (!check || sha256Hex(check) !== staged.sha256) throw new AppError("internal", "Published audio did not verify.", true);

  const publishedAt = new Date();
  return db.transaction(async (tx) => {
    // Lock the notice row so concurrent approvals serialise, then compare-and-swap the current pointer.
    const locked = (await tx.select().from(notices).where(eq(notices.id, notice.id)).for("update"))[0];
    if (!locked) throw new AppError("not_found", "Notice not found.");
    if (locked.state === "withdrawn") throw new AppError("notice_withdrawn", "This notice has been withdrawn.");
    if ((locked.currentRevisionId ?? null) !== (revision.baseRevisionId ?? null)) {
      const current = locked.currentRevisionId
        ? (await tx.select().from(noticeRevisions).where(eq(noticeRevisions.id, locked.currentRevisionId)))[0]
        : null;
      throw new AppError(
        "conflict",
        "Someone published a newer version while you were editing. Review the latest version and start a new correction.",
        false,
        { reason: "superseded", currentRevisionNumber: current?.revisionNumber ?? null },
      );
    }
    const top = await tx
      .select({ n: max(noticeRevisions.revisionNumber) })
      .from(noticeRevisions)
      .where(eq(noticeRevisions.noticeId, notice.id));
    const revisionNumber = (top[0]?.n ?? 0) + 1;
    // Promotion is conditioned on the exact version and staged audio that were verified above.
    const promoted = await tx
      .update(noticeRevisions)
      .set({
        status: "published",
        revisionNumber,
        publishedAt,
        audioAssetId: pubAssetId,
        confirmedCriticalFacts: true,
        version: revision.version + 1,
        updatedAt: publishedAt,
      })
      .where(
        and(
          eq(noticeRevisions.id, revision.id),
          eq(noticeRevisions.status, "preview_ready"),
          eq(noticeRevisions.audioAssetId, staged.id),
          eq(noticeRevisions.version, revision.version),
        ),
      )
      .returning({ id: noticeRevisions.id });
    if (promoted.length === 0) throw new AppError("conflict", "The revision changed during approval. Reload and try again.");
    await tx.update(audioAssets).set({ contentReady: true }).where(eq(audioAssets.id, pubAssetId));
    if (locked.currentRevisionId) {
      await tx
        .update(noticeRevisions)
        .set({ status: "superseded", updatedAt: publishedAt })
        .where(eq(noticeRevisions.id, locked.currentRevisionId));
    }
    const swapped = await tx
      .update(notices)
      .set({ currentRevisionId: revision.id, state: "published", title: revision.title, updatedAt: publishedAt })
      .where(
        and(
          eq(notices.id, notice.id),
          locked.currentRevisionId ? eq(notices.currentRevisionId, locked.currentRevisionId) : isNull(notices.currentRevisionId),
        ),
      )
      .returning({ id: notices.id });
    if (swapped.length === 0) throw new AppError("conflict", "Another version was published first.");
    log("info", "notice.published", { noticeId: notice.id, revisionId: revision.id, revisionNumber });
    return { noticeId: notice.id, revisionNumber, alreadyPublished: false, publishedAt };
  });
}

export async function withdrawNotice(ownerId: string, noticeId: string) {
  const db = await getDb();
  await ownedNotice(db, ownerId, noticeId);
  const now = new Date();
  // Conditional on the state, so two withdrawals (or a withdrawal racing an approval's swap) cannot both win.
  const done = await db
    .update(notices)
    .set({ state: "withdrawn", withdrawnAt: now, updatedAt: now })
    .where(and(eq(notices.id, noticeId), eq(notices.state, "published")))
    .returning({ id: notices.id });
  if (done.length === 0) throw new AppError("conflict", "Only a published notice can be withdrawn.");
  log("info", "notice.withdrawn", { noticeId });
}

export type NoticeListItem = Notice & { currentRevisionNumber: number | null; openDrafts: number };

export async function listNotices(ownerId: string): Promise<NoticeListItem[]> {
  const db = await getDb();
  const rows = await db.select().from(notices).where(eq(notices.ownerId, ownerId)).orderBy(desc(notices.updatedAt));
  if (rows.length === 0) return [];
  const revs = await db
    .select({
      noticeId: noticeRevisions.noticeId,
      id: noticeRevisions.id,
      revisionNumber: noticeRevisions.revisionNumber,
      status: noticeRevisions.status,
    })
    .from(noticeRevisions)
    .where(inArray(noticeRevisions.noticeId, rows.map((r) => r.id)));
  return rows.map((n) => ({
    ...n,
    currentRevisionNumber: revs.find((r) => r.id === n.currentRevisionId)?.revisionNumber ?? null,
    openDrafts: revs.filter((r) => r.noticeId === n.id && EDITABLE.includes(r.status)).length,
  }));
}

export type RevisionView = NoticeRevision & { audio: AudioAsset | null; attempts: SynthesisAttempt[] };

export async function getNoticeDetail(ownerId: string, noticeId: string) {
  const db = await getDb();
  const notice = await ownedNotice(db, ownerId, noticeId);
  const revisions = await db
    .select()
    .from(noticeRevisions)
    .where(and(eq(noticeRevisions.noticeId, noticeId), sql`${noticeRevisions.status} <> 'discarded'`))
    .orderBy(desc(noticeRevisions.createdAt));
  const ids = revisions.map((r) => r.id);
  const assets = ids.length ? await db.select().from(audioAssets).where(inArray(audioAssets.revisionId, ids)) : [];
  const attempts = ids.length
    ? await db.select().from(synthesisAttempts).where(inArray(synthesisAttempts.revisionId, ids)).orderBy(desc(synthesisAttempts.startedAt))
    : [];
  const views: RevisionView[] = revisions.map((r) => ({
    ...r,
    audio: assets.find((a) => a.id === r.audioAssetId) ?? null,
    attempts: attempts.filter((a) => a.revisionId === r.id),
  }));
  return { notice, revisions: views, current: views.find((r) => r.id === notice.currentRevisionId) ?? null };
}

export async function getRevisionForOwner(ownerId: string, revisionId: string) {
  const db = await getDb();
  const { revision, notice } = await ownedRevision(db, ownerId, revisionId);
  const audio = revision.audioAssetId
    ? ((await db.select().from(audioAssets).where(eq(audioAssets.id, revision.audioAssetId)).limit(1))[0] ?? null)
    : null;
  const attempts = await db
    .select()
    .from(synthesisAttempts)
    .where(eq(synthesisAttempts.revisionId, revisionId))
    .orderBy(desc(synthesisAttempts.startedAt));
  let base: NoticeRevision | null = null;
  if (revision.baseRevisionId) {
    base = (await db.select().from(noticeRevisions).where(eq(noticeRevisions.id, revision.baseRevisionId)).limit(1))[0] ?? null;
  }
  return { revision, notice, audio, attempts, base };
}
