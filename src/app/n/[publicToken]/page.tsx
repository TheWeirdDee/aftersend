import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicManifest } from "@/lib/notices/public-manifest";
import { formatStamp } from "@/lib/format";
import { AudioPlayer } from "@/components/audio-player";
import { UpdateWatcher } from "@/components/listener/update-watcher";
import { LogoMark } from "@/components/logo";
import { Download } from "@/components/icons";
import { TestAudioBadge } from "@/components/app/status-pill";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ publicToken: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { publicToken } = await params;
  const m = await getPublicManifest(publicToken);
  return {
    title: m ? m.noticeTitle : "Notice not found",
    description: m?.state === "published" ? "Listen to the current version of this notice." : undefined,
    robots: { index: false, follow: false },
  };
}

function Shell({ children, isDemo }: { children: React.ReactNode; isDemo?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {isDemo ? (
        <div className="border-b border-warn/30 bg-warn/[0.08] px-4 py-2 text-center text-[13px] text-warn">
          Demo data: a fictional sample notice made for the AfterSend demo.
        </div>
      ) : null}
      <main id="main" className="mx-auto w-full max-w-[680px] flex-1 px-4 py-10 sm:px-6 sm:py-16">
        {children}
      </main>
      <footer className="border-t border-line px-4 py-6 text-center text-[12.5px] leading-5 text-faint">
        <p className="inline-flex items-center gap-1.5">
          <LogoMark className="size-3.5" /> Hosted with{" "}
          <Link href="/" className="underline underline-offset-4 hover:text-fg">
            AfterSend
          </Link>
        </p>
        <p className="mt-1">AfterSend hosts this notice for its publisher. It does not verify who issued it or whether it is accurate.</p>
      </footer>
    </div>
  );
}

export default async function ListenerPage({ params }: Props) {
  const { publicToken } = await params;
  const m = await getPublicManifest(publicToken);
  if (!m) notFound();

  if (m.state === "withdrawn") {
    return (
      <Shell isDemo={m.isDemo}>
        <p className="eyebrow">Notice withdrawn</p>
        <h1 className="mt-3 text-[clamp(1.75rem,6vw,2.5rem)] leading-[1.1] font-semibold tracking-[-0.04em]">{m.noticeTitle}</h1>
        <p className="mt-5 rounded-xl border border-danger/40 bg-danger/[0.07] p-4 text-[16px] leading-7">
          This notice has been withdrawn by its publisher. It is no longer current, and its audio is no longer available.
        </p>
        <p className="mt-3 font-mono text-[13px] text-muted">Withdrawn {formatStamp(m.withdrawnAt)}</p>
      </Shell>
    );
  }

  const revised = m.revisionNumber > 1;
  return (
    <Shell isDemo={m.isDemo}>
      <article aria-labelledby="notice-title" data-revision={m.revisionNumber} data-revision-id={m.revisionId}>
        <p className="eyebrow">Current notice</p>
        <h1 id="notice-title" className="mt-3 text-[clamp(1.85rem,6.5vw,2.75rem)] leading-[1.08] font-semibold tracking-[-0.04em] text-balance">
          {m.noticeTitle}
        </h1>
        <p className="mt-3 font-mono text-[13px] text-muted" data-testid="updated-at">
          <time dateTime={m.publishedAt}>
            {revised ? "Updated" : "Published"} {formatStamp(m.publishedAt, m.timezone)}
          </time>
        </p>

        {revised ? (
          <div className="mt-6 rounded-xl border border-signal/35 bg-signal/[0.07] p-4" data-testid="revised-banner">
            <p className="text-[15.5px] leading-6 font-medium text-fg">
              This notice was revised. This is version {m.revisionNumber}.
            </p>
            {m.updatePreface ? <p className="mt-1.5 text-[15px] leading-6 text-fg">{m.updatePreface}</p> : null}
            {m.updateSummary?.length ? (
              <ul className="mt-2 space-y-1 text-[14.5px] text-muted">
                {m.updateSummary.map((s, i) => (
                  <li key={i}>
                    Current {s.changedField}: <span className="font-medium text-fg">{s.currentValue}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[13px] text-faint">First published {formatStamp(m.firstPublishedAt, m.timezone)}.</p>
          </div>
        ) : null}

        <div className="mt-7">
          <AudioPlayer key={m.audioUrl} src={m.audioUrl} label="current notice" durationHintMs={m.audioDurationMs} />
          {m.audioIsTestTone ? (
            <p className="mt-2">
              <TestAudioBadge />
            </p>
          ) : null}
        </div>

        <section aria-labelledby="text-heading" className="mt-9">
          <h2 id="text-heading" className="eyebrow">
            Written notice
          </h2>
          <div className="mt-3 text-[17px] leading-[1.75] whitespace-pre-wrap text-fg" data-testid="notice-text">
            {m.displayText}
          </div>
        </section>

        <div className="mt-9 space-y-3 border-t border-line pt-6 text-[14px] text-muted">
          {m.sourceUrl ? (
            <p>
              Source provided by the publisher:{" "}
              <a href={m.sourceUrl} className="break-all underline underline-offset-4 hover:text-fg" target="_blank" rel="noopener noreferrer nofollow">
                {m.sourceUrl}
              </a>
            </p>
          ) : null}
          <p>
            <a href={m.audioUrl} download={`notice-v${m.revisionNumber}.${m.audioMime === "audio/mpeg" ? "mp3" : "wav"}`} className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-fg hover:underline">
              <Download className="size-4" /> Download this version
            </a>
            <span className="block text-[13px] text-faint">A downloaded file is a static copy and will not update. This link always shows the current version.</span>
          </p>
        </div>
      </article>
      <UpdateWatcher token={publicToken} revisionId={m.revisionId} />
    </Shell>
  );
}
