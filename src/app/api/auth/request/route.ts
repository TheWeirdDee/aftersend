import { z } from "zod";
import { requestCode } from "@/lib/auth/email-auth";
import { currentUser } from "@/lib/auth/session";
import { clientIp, json, readJson, route } from "@/lib/http/route";

export const dynamic = "force-dynamic";

const body = z.object({ email: z.string().max(254) });

/** Sends a one-time code. Always answers 202 with the same body, whether or not the address has an account. */
export const POST = route(
  async (req) => {
    const { email } = await readJson(req, body);
    const user = await currentUser();
    const { cooldownSec } = await requestCode({ email, linkUserId: user?.id ?? null, ip: clientIp(req) });
    return json({ ok: true, cooldownSec }, { status: 202 });
  },
  { mutation: true },
);
