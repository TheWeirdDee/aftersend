import { requireUser } from "@/lib/auth/session";
import { json, readJson, route } from "@/lib/http/route";
import { approveRevision } from "@/lib/notices/revision-service";
import { approveSchema } from "@/lib/notices/validation";

export const dynamic = "force-dynamic";
// Approval verifies, copies and re-reads the audio in storage; each request has its own ceiling (STORAGE_TIMEOUT_MS).
export const maxDuration = 60;

export const POST = route<{ revisionId: string }>(
  async (req, { params }) => {
    const user = await requireUser();
    const { revisionId } = await params;
    const { expectedVersion } = await readJson(req, approveSchema);
    return json(await approveRevision(user.id, revisionId, { expectedVersion }));
  },
  { mutation: true },
);
