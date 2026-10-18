import { requireUser } from "@/lib/auth/session";
import { json, route } from "@/lib/http/route";
import { getNoticeDetail } from "@/lib/notices/revision-service";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  return json(await getNoticeDetail(user.id, id));
});
