import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { AppError } from "@/lib/http/errors";
import { getNoticeDetail } from "@/lib/notices/revision-service";
import { speechProvider } from "@/lib/speech";
import { AppHeader } from "@/components/app/app-header";
import { NoticeEditor } from "@/components/app/notice-editor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit notice", robots: { index: false } };

export default async function EditNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/app");
  const { id } = await params;
  let detail;
  try {
    detail = await getNoticeDetail(user.id, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { notice, revisions, current } = detail;
  if (notice.state === "withdrawn") redirect(`/app/notices/${notice.id}`);

  // Resume the newest open draft that was started from the current version.
  const draft = revisions.find(
    (r) => ["draft", "failed", "preview_ready", "synthesizing"].includes(r.status) && (r.baseRevisionId ?? null) === (notice.currentRevisionId ?? null),
  );
  const provider = speechProvider();
  const configured = provider.isConfigured();

  return (
    <>
      <AppHeader workspaceLabel={user.displayName} isDemo={user.kind === "demo"} />
      <main id="main" className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-12">
        <Link href={notice.state === "draft" ? "/app" : `/app/notices/${notice.id}`} className="text-[14px] text-muted hover:text-fg">
          ← {notice.state === "draft" ? "Notices" : notice.title}
        </Link>
        <h1 className="mt-4 mb-8 text-[clamp(1.75rem,4vw,2.25rem)] leading-tight font-semibold tracking-[-0.04em]">
          {notice.state === "draft" ? "Generate, listen, publish" : "Correct this notice"}
        </h1>
        <NoticeEditor
          noticeId={notice.id}
          noticeState={notice.state}
          publicPath={`/n/${notice.publicToken}`}
          isDemo={notice.isDemo}
          sourceUrl={notice.sourceUrl}
          base={
            current
              ? {
                  revisionId: current.id,
                  revisionNumber: current.revisionNumber!,
                  title: current.title,
                  displayText: current.displayText,
                  voiceId: current.voiceId,
                }
              : null
          }
          draft={
            draft
              ? {
                  revisionId: draft.id,
                  title: draft.title,
                  displayText: draft.displayText,
                  updatePreface: draft.updatePreface,
                  voiceId: draft.voiceId,
                }
              : null
          }
          voices={provider.listVoices()}
          provider={{ ok: configured.ok, reason: configured.ok ? null : configured.reason }}
        />
      </main>
    </>
  );
}
