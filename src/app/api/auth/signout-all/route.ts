import { signOutEverywhere } from "@/lib/auth/email-auth";
import { endSession, requireUser } from "@/lib/auth/session";
import { json, route } from "@/lib/http/route";

export const dynamic = "force-dynamic";

/** Ends every session of the signed-in account, on every device, including this one. */
export const POST = route(
  async () => {
    const user = await requireUser();
    const ended = await signOutEverywhere(user.id);
    await endSession();
    return json({ ok: true, ended });
  },
  { mutation: true },
);
