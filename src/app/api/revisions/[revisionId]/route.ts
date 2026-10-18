import { requireUser } from "@/lib/auth/session";
import { json, readJson, route } from "@/lib/http/route";
import { discardDraft, updateDraft } from "@/lib/notices/revision-service";
import { updateDraftSchema } from "@/lib/notices/validation";

export const dynamic = "force-dynamic";

export const PATCH = route<{ revisionId: string }>(
  async (req, { params }) => {
    const user = await requireUser();
    const { revisionId } = await params;
    const input = await readJson(req, updateDraftSchema);
    await updateDraft(user.id, revisionId, input);
    return json({ ok: true });
  },
  { mutation: true },
);

export const DELETE = route<{ revisionId: string }>(
  async (_req, { params }) => {
    const user = await requireUser();
    const { revisionId } = await params;
    await discardDraft(user.id, revisionId);
    return json({ ok: true });
  },
  { mutation: true },
);
