import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { clientIp, json, route } from "@/lib/http/route";
import { generatePreview } from "@/lib/notices/revision-service";

export const dynamic = "force-dynamic";
// Synthesis runs inside this request; the provider timeout and retries are bounded well below this.
export const maxDuration = 60;

export const POST = route<{ revisionId: string }>(
  async (req, { params }) => {
    const user = await requireUser();
    const { revisionId } = await params;
    const limit = env().SYNTHESIS_LIMIT_PER_HOUR;
    await enforceRateLimit(`synth-user:${user.id}`, limit, 3600_000);
    await enforceRateLimit(`synth-ip:${clientIp(req)}`, limit * 2, 3600_000);
    return json(await generatePreview(user.id, revisionId));
  },
  { mutation: true },
);
