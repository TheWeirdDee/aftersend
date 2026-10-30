import { z } from "zod";
import { verifyCode } from "@/lib/auth/email-auth";
import { currentUser, replaceSession } from "@/lib/auth/session";
import { clientIp, json, readJson, route } from "@/lib/http/route";

export const dynamic = "force-dynamic";

const body = z.object({ email: z.string().max(254), code: z.string().max(16) });

export const POST = route(
  async (req) => {
    const { email, code } = await readJson(req, body);
    const current = await currentUser();
    const result = await verifyCode({ email, code, sessionUserId: current?.id ?? null, ip: clientIp(req) });
    await replaceSession(result.userId);
    return json({ redirect: "/app", linked: result.linked, merged: result.merged, created: result.created });
  },
  { mutation: true },
);
