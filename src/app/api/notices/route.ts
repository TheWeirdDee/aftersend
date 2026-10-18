import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { json, readJson, route } from "@/lib/http/route";
import { createNotice, listNotices } from "@/lib/notices/revision-service";
import { createNoticeSchema } from "@/lib/notices/validation";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  return json({ notices: await listNotices(user.id) });
});

export const POST = route(
  async (req) => {
    const user = await requireUser();
    const input = await readJson(req, createNoticeSchema);
    await enforceRateLimit(`notice-create:${user.id}`, env().SYNTHESIS_LIMIT_PER_HOUR, 3600_000);
    const result = await createNotice(user.id, input, { isDemo: user.kind === "demo" });
    return json(result, { status: 201 });
  },
  { mutation: true },
);
