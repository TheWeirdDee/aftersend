import { requireUser } from "@/lib/auth/session";
import { json, readJson, route } from "@/lib/http/route";
import { approveRevision } from "@/lib/notices/revision-service";
import { approveSchema } from "@/lib/notices/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ revisionId: string }>(
  async (req, { params }) => {
    const user = await requireUser();
    const { revisionId } = await params;
    await readJson(req, approveSchema);
    return json(await approveRevision(user.id, revisionId));
  },
  { mutation: true },
);
