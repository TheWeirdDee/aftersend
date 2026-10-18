import { requireUser } from "@/lib/auth/session";
import { json, readJson, route } from "@/lib/http/route";
import { wordDiff, factChanges } from "@/lib/notices/diff";
import { createRevision } from "@/lib/notices/revision-service";
import { createRevisionSchema } from "@/lib/notices/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(
  async (req, { params }) => {
    const user = await requireUser();
    const { id } = await params;
    const input = await readJson(req, createRevisionSchema);
    const { revisionId, diffBase } = await createRevision(user.id, id, input);
    return json(
      {
        revisionId,
        diff: diffBase ? wordDiff(diffBase.displayText, input.text) : null,
        factChanges: diffBase ? factChanges(diffBase.displayText, input.text) : [],
      },
      { status: 201 },
    );
  },
  { mutation: true },
);
