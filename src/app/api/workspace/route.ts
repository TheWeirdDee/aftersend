import { startDemoWorkspace } from "@/lib/auth/demo";
import { createWorkspaceUser, endSession, startSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { clientIp, json, readJson, route } from "@/lib/http/route";
import { z } from "zod";

export const dynamic = "force-dynamic";

const body = z.object({ kind: z.enum(["workspace", "demo"]) });

/** Creates a private publisher workspace bound to this browser via an httpOnly session cookie. */
export const POST = route(
  async (req) => {
    const { kind } = await readJson(req, body);
    await enforceRateLimit(`workspace:${clientIp(req)}`, env().DEMO_WORKSPACES_PER_IP_PER_HOUR, 3600_000);
    if (kind === "demo") {
      const { noticeId } = await startDemoWorkspace();
      return json({ redirect: noticeId ? `/app/notices/${noticeId}/edit` : "/app" }, { status: 201 });
    }
    const userId = await createWorkspaceUser("workspace", "My workspace");
    await startSession(userId);
    return json({ redirect: "/app" }, { status: 201 });
  },
  { mutation: true },
);

export const DELETE = route(
  async () => {
    await endSession();
    return json({ ok: true });
  },
  { mutation: true },
);
