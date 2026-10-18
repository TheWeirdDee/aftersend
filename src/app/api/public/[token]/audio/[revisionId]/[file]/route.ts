import { AppError } from "@/lib/http/errors";
import { audioResponse } from "@/lib/http/audio-response";
import { route } from "@/lib/http/route";
import { getPublicAudio } from "@/lib/notices/public-manifest";
import { objectStore } from "@/lib/storage/audio";

export const dynamic = "force-dynamic";

/**
 * Revision- and digest-addressed audio. The bytes behind a given URL never change, so it can be cached
 * immutably; only the current revision of a published notice is served.
 */
export const GET = route<{ token: string; revisionId: string; file: string }>(async (req, { params }) => {
  const { token, revisionId, file } = await params;
  const m = file.match(/^([a-f0-9]{64})\.(wav|mp3)$/);
  if (!m) throw new AppError("not_found", "Audio not found.");
  const asset = await getPublicAudio(token, revisionId, m[1]!);
  if (!asset) throw new AppError("not_found", "This audio is no longer current. Reload the notice.");
  const bytes = await objectStore().get(asset.objectKey);
  if (!bytes) throw new AppError("not_found", "Audio file is missing.");
  const res = audioResponse(bytes, asset.mimeType, req.headers.get("range"), "public, max-age=31536000, immutable");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
});
