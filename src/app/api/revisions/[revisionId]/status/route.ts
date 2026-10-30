import { requireUser } from "@/lib/auth/session";
import { json, route } from "@/lib/http/route";
import { getRevisionForOwner, synthesisStaleAfterMs } from "@/lib/notices/revision-service";

export const dynamic = "force-dynamic";

export const GET = route<{ revisionId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { revisionId } = await params;
  const { revision, audio, attempts } = await getRevisionForOwner(user.id, revisionId);
  return json({
    status: revision.status,
    version: revision.version,
    synthesisKey: revision.synthesisKey,
    // When a 'synthesizing' revision stops being trusted, measured by the server's clock.
    synthesis:
      revision.status === "synthesizing"
        ? { claimedAgoMs: Date.now() - revision.updatedAt.getTime(), staleAfterMs: synthesisStaleAfterMs() }
        : null,
    previewUrl: audio && revision.status === "preview_ready" ? `/api/revisions/${revision.id}/audio?v=${audio.sha256.slice(0, 16)}` : null,
    audio: audio && {
      mimeType: audio.mimeType,
      durationMs: audio.durationMs,
      sha256: audio.sha256,
      providerLatencyMs: audio.providerLatencyMs,
      providerKind: audio.providerKind,
    },
    attempts: attempts.map((a) => ({
      id: a.id,
      outcome: a.outcome,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      providerRequestId: a.providerRequestId,
      modelId: a.modelId,
      voiceId: a.voiceId,
      retries: a.retries,
    })),
  });
});
