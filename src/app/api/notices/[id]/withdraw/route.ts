import { requireUser } from "@/lib/auth/session";
import { json, route } from "@/lib/http/route";
import { withdrawNotice } from "@/lib/notices/revision-service";

export const POST = route<{ id: string }>(
  async (_req, { params }) => {
    const user = await requireUser();
    const { id } = await params;
    await withdrawNotice(user.id, id);
    return json({ ok: true });
  },
  { mutation: true },
);
