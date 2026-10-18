import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { AppError } from "@/lib/http/errors";
import { getNoticeDetail } from "@/lib/notices/revision-service";
import { appOrigin } from "@/lib/origin";
import { formatDuration, formatStamp } from "@/lib/format";
import { AppHeader } from "@/components/app/app-header";
import { AudioPlayer } from "@/components/audio-player";
import { CopyButton } from "@/components/app/copy-button";
import { NoticeStatePill, RevisionStatePill, TestAudioBadge } from "@/components/app/status-pill";
import { WithdrawButton } from "@/components/app/withdraw-button";
import { Check, External, Pencil } from "@/components/icons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notice", robots: { index: false } };

export default async function NoticePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ published?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/app");
  const { id } = await params;
  const { published } = await searchParams;
  let detail;
  try {
    detail = await getNoticeDetail(user.id, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { notice, revisions, current } = detail;
  if (notice.state === "draft") redirect(`/app/notices/${notice.id}/edit`);
  const url = `${await appOrigin()}/n/${notice.publicToken}`;
  const openDraft = revisions.find((r) => ["draft", "failed", "preview_ready"].includes(r.status) && r.baseRevisionId === notice.currentRevisionId);

  return (
    <>
      <AppHeader workspaceLabel={user.displayName} isDemo={user.kind === "demo"} />
      <main id="main" className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-12">
        <Link href="/app" className="text-[14px] text-muted hover:text-fg">
          ← Notices
        </Link>

        {published && notice.state === "published" ? (
          <div role="status" className="mt-6 flex items-start gap-3 rounded-2xl border border-signal/40 bg-signal/[0.07] p-4 sm:p-5">
            <Check className="mt-0.5 size-5 shrink-0 text-signal" />
            <div>
              <p className="font-medium">Version {published} is live.</p>
              <p className="mt-1 text-[14.5px] text-muted">
                {Number(published) > 1
                  ? "The link you already shared now plays this version. Refresh any open listener page to hear it."
                  : "Copy the link below and share it wherever you share notices."}
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[clamp(1.75rem,4vw,2.5rem)] leading-tight font-semibold tracking-[-0.04em]">{notice.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px] text-muted">
              <NoticeStatePill state={notice.state} openDrafts={openDraft ? 1 : 0} />
              {notice.isDemo ? <span className="pill border-warn/40 text-warn">Demo data</span> : null}
              {current?.publishedAt ? <span>Version {current.revisionNumber} · {formatStamp(current.publishedAt, notice.timezone)}</span> : null}
            </div>
          </div>
          {notice.state === "published" ? (
            <Link href={`/app/notices/${notice.id}/edit`} className="btn-primary">
              <Pencil /> {openDraft ? "Continue correction" : "Correct this notice"}
            </Link>
          ) : null}
        </div>

        <section aria-labelledby="link-heading" className="card mt-8 p-5 sm:p-6">
          <h2 id="link-heading" className="eyebrow">
            Listener link · stays the same for every version
          </h2>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-ink-2 px-3.5 py-2.5 font-mono text-[14px] text-fg" data-testid="public-url">
              {url}
            </code>
            <div className="flex gap-2">
              <CopyButton value={url} />
              <a href={`/n/${notice.publicToken}`} target="_blank" rel="noopener" className="btn-secondary btn-sm">
                <External /> Open
              </a>
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-5 text-faint">
            Share this link, not a downloaded audio file. Downloaded files never update.
          </p>
        </section>

        {notice.state === "withdrawn" ? (
          <div className="mt-8 rounded-2xl border border-danger/40 bg-danger/[0.07] p-5 text-[15px]">
            Withdrawn {notice.withdrawnAt ? formatStamp(notice.withdrawnAt, notice.timezone) : ""}. The link shows a withdrawal message and no audio.
          </div>
        ) : null}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          {current ? (
            <section aria-labelledby="current-heading" className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="current-heading" className="text-[19px] font-semibold tracking-[-0.02em]">
                  Current version
                </h2>
                {current.audio?.providerKind === "test" ? <TestAudioBadge /> : null}
              </div>
              <div className="mt-4">
                <AudioPlayer key={current.id} src={`/api/revisions/${current.id}/audio`} label="current version" durationHintMs={current.audio?.durationMs} />
              </div>
              {current.updatePreface ? <p className="mt-5 rounded-lg border border-line bg-surface px-4 py-3 text-[15px]">{current.updatePreface}</p> : null}
              <div className="mt-5 text-[16px] leading-[1.7] whitespace-pre-wrap text-fg">{current.displayText}</div>
              {notice.sourceUrl ? (
                <p className="mt-5 text-[14px] text-muted">
                  Source:{" "}
                  <a href={notice.sourceUrl} className="underline underline-offset-4 hover:text-fg" target="_blank" rel="noopener noreferrer nofollow">
                    {notice.sourceUrl}
                  </a>
                </p>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="history-heading" className="min-w-0">
            <h2 id="history-heading" className="text-[19px] font-semibold tracking-[-0.02em]">
              Version history
            </h2>
            <p className="mt-1 text-[13.5px] text-muted">Only you can see this. Listeners always get the current version.</p>
            <ol className="mt-4 space-y-3">
              {revisions.map((r) => (
                <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[15px] font-medium">{r.revisionNumber ? `Version ${r.revisionNumber}` : "Unpublished draft"}</span>
                    <RevisionStatePill status={r.status} />
                  </div>
                  <p className="mt-2 line-clamp-2 text-[13.5px] leading-5 text-muted">{r.displayText}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11.5px] text-faint">
                    {r.publishedAt ? (
                      <>
                        <dt>Published</dt>
                        <dd className="text-right">{formatStamp(r.publishedAt, notice.timezone)}</dd>
                      </>
                    ) : null}
                    {r.audio ? (
                      <>
                        <dt>Audio</dt>
                        <dd className="text-right">
                          {formatDuration(r.audio.durationMs)} · {r.audio.providerKind === "test" ? "test tone" : r.provider}
                        </dd>
                        <dt>Generation</dt>
                        <dd className="text-right">{r.audio.providerLatencyMs != null ? `${(r.audio.providerLatencyMs / 1000).toFixed(1)}s` : "–"}</dd>
                        <dt>sha256</dt>
                        <dd className="truncate text-right">{r.audio.sha256.slice(0, 16)}…</dd>
                      </>
                    ) : null}
                    <dt>Voice</dt>
                    <dd className="truncate text-right">{r.voiceId}</dd>
                    {r.attempts.length ? (
                      <>
                        <dt>Attempts</dt>
                        <dd className="text-right">
                          {r.attempts.length} ({r.attempts.filter((a) => a.outcome === "success").length} ok)
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ol>
            {notice.state === "published" ? (
              <div className="mt-8 border-t border-line pt-6">
                <WithdrawButton noticeId={notice.id} />
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
}
