import { startGuestSession } from "@/lib/auth/guest";
import { createWorkspaceUser, currentUser, endSession, startSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { clientIp, json, readJson, route } from "@/lib/http/route";
import { z } from "zod";

export const dynamic = "force-dynamic";

// "demo" starts the judge-facing sample workspace. "guest" and "create" start a normal guest workspace; "create" is what
// every "Create an announcement" button sends.
const body = z.object({ kind: z.enum(["workspace", "guest", "demo", "create"]) });

/**
 * Starts a guest session (or a plain workspace) bound to this browser via an httpOnly session cookie. "create" is the one
 * entry into writing: a visitor with no session gets a guest workspace and its sample announcement; anyone who already has a
 * session (a returning guest or a signed-in account) keeps it and is taken to a new announcement in it, so their earlier
 * announcements are never replaced by a new guest.
 */
export const POST = route(
  async (req) => {
    const { kind } = await readJson(req, body);
    if (kind === "create") {
      if (await currentUser()) return json({ redirect: "/app/notices/new" });
      await enforceRateLimit(`workspace:${clientIp(req)}`, env().DEMO_WORKSPACES_PER_IP_PER_HOUR, 3600_000);
      const { noticeId } = await startGuestSession();
      return json({ redirect: noticeId ? `/app/notices/${noticeId}/edit` : "/app" }, { status: 201 });
    }
    await enforceRateLimit(`workspace:${clientIp(req)}`, env().DEMO_WORKSPACES_PER_IP_PER_HOUR, 3600_000);
    if (kind === "guest" || kind === "demo") {
      const { noticeId } = await startGuestSession({ demo: kind === "demo" });
      return json({ redirect: noticeId ? `/app/notices/${noticeId}/edit` : "/app" }, { status: 201 });
    }
    const userId = await createWorkspaceUser("workspace", "Your account");
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
