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
    await enforceRateLimit(`notice-create:${user.id}`, user.kind === "demo" ? env().GUEST_SYNTHESIS_LIMIT_PER_HOUR : env().SYNTHESIS_LIMIT_PER_HOUR, 3600_000);
    // Only the sample created by the dedicated /demo workspace is demonstration data. Anything a guest writes is their own
    // notice and must not be labelled as fake.
    const result = await createNotice(user.id, input, { isDemo: false });
    return json(result, { status: 201 });
  },
  { mutation: true },
);
