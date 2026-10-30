import { AppError } from "@/lib/http/errors";
import { audioResponse } from "@/lib/http/audio-response";
import { route } from "@/lib/http/route";
import { getPublicAudio } from "@/lib/notices/public-manifest";
import { objectStore } from "@/lib/storage/audio";

export const dynamic = "force-dynamic";

/**
 * Revision- and digest-addressed audio. The bytes behind a URL never change, but whether they may still be
 * served does: a correction or withdrawal revokes them. So the response is never `immutable` and never
 * shareable: `private, no-cache` lets a browser keep the bytes but forces it to ask us again before each reuse.
 * That check runs the access query, so a withdrawn or superseded URL answers 404 on the next request, and an
 * unchanged one answers a cheap 304 without reading storage.
 */
const CACHE_CONTROL = "private, no-cache";

export const GET = route<{ token: string; revisionId: string; file: string }>(async (req, { params }) => {
  const { token, revisionId, file } = await params;
  const m = file.match(/^([a-f0-9]{64})\.(wav|mp3)$/);
  if (!m) throw new AppError("not_found", "Audio not found.");
  const asset = await getPublicAudio(token, revisionId, m[1]!);
  if (!asset) throw new AppError("not_found", "This audio is no longer current. Reload the notice.");
  const headers = { ETag: `"${asset.sha256}"`, "X-Robots-Tag": "noindex, nofollow" };
  if (req.headers.get("if-none-match")?.split(",").some((t) => t.trim().replace(/^W\//, "") === headers.ETag)) {
    return new Response(null, { status: 304, headers: { ...headers, "Cache-Control": CACHE_CONTROL } });
  }
  const bytes = await objectStore().get(asset.objectKey);
  if (!bytes) throw new AppError("not_found", "Audio file is missing.");
  return audioResponse(bytes, asset.mimeType, req.headers.get("range"), CACHE_CONTROL, headers);
});
