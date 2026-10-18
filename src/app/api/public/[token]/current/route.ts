import { AppError } from "@/lib/http/errors";
import { json, route } from "@/lib/http/route";
import { getPublicManifest } from "@/lib/notices/public-manifest";

export const dynamic = "force-dynamic";

export const GET = route<{ token: string }>(async (_req, { params }) => {
  const { token } = await params;
  const manifest = await getPublicManifest(token);
  if (!manifest) throw new AppError("not_found", "Notice not found.");
  return json(manifest, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
});
