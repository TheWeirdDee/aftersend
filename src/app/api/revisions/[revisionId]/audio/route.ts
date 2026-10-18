import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/http/errors";
import { audioResponse } from "@/lib/http/audio-response";
import { route } from "@/lib/http/route";
import { getRevisionForOwner } from "@/lib/notices/revision-service";
import { objectStore } from "@/lib/storage/audio";

export const dynamic = "force-dynamic";

/** Owner-only preview audio (staging or published) for a revision. Never cached by shared caches. */
export const GET = route<{ revisionId: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { revisionId } = await params;
  const { audio } = await getRevisionForOwner(user.id, revisionId);
  if (!audio?.contentReady) throw new AppError("audio_not_ready", "No audio for this revision yet.");
  const bytes = await objectStore().get(audio.objectKey);
  if (!bytes) throw new AppError("not_found", "Audio file is missing.");
  return audioResponse(bytes, audio.mimeType, req.headers.get("range"), "private, no-store");
});
