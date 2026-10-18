import Link from "next/link";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { listNotices } from "@/lib/notices/revision-service";
import { AppHeader } from "@/components/app/app-header";
import { StartWorkspaceButton } from "@/components/app/workspace-gate";
import { NoticeStatePill } from "@/components/app/status-pill";
import { CopyButton } from "@/components/app/copy-button";
import { External, Pencil, Plus } from "@/components/icons";
import { formatStamp } from "@/lib/format";
import { appOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workspace", robots: { index: false } };

export default async function WorkspacePage() {
  const user = await currentUser();
  if (!user) {
    return (
      <>
        <AppHeader />
        <main id="main" className="mx-auto grid min-h-[calc(100dvh-64px)] max-w-[1180px] place-items-center px-4 py-16 sm:px-6">
          <div className="w-full max-w-xl">
            <p className="eyebrow">Publisher workspace</p>
            <h1 className="mt-4 text-[clamp(2rem,5vw,3rem)] leading-[1.04] font-semibold tracking-[-0.04em]">
              Start publishing spoken notices.
            </h1>
            <p className="mt-4 text-[16.5px] leading-[1.6] text-muted">
              A workspace is private to this browser and kept with a secure session cookie. Hackathon build: there are no
              email accounts yet, so clearing cookies means losing edit access. Published links keep working.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <StartWorkspaceButton kind="workspace" className="btn-primary h-12 w-full">
                Create a workspace
              </StartWorkspaceButton>
              <StartWorkspaceButton kind="demo" className="btn-secondary h-12 w-full">
                Open demo workspace
              </StartWorkspaceButton>
            </div>
            <p className="mt-4 text-[13px] leading-5 text-faint">The demo workspace comes with a labelled sample school notice.</p>
          </div>
        </main>
      </>
    );
  }

  const notices = await listNotices(user.id);
  const origin = await appOrigin();

  return (
    <>
      <AppHeader workspaceLabel={user.displayName} isDemo={user.kind === "demo"} />
      <main id="main" className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.04em]">Notices</h1>
            <p className="mt-1.5 text-[15px] text-muted">
              {notices.length === 0 ? "Nothing published yet." : `${notices.length} notice${notices.length === 1 ? "" : "s"} in this workspace.`}
            </p>
          </div>
          <Link href="/app/notices/new" className="btn-primary">
            <Plus /> New notice
          </Link>
        </div>

        {notices.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-line-strong px-6 py-16 text-center">
            <p className="text-[18px] font-medium">Write your first spoken notice</p>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-6 text-muted">
              Paste a notice, listen to the spoken version, approve it, and share one link that you can correct later.
            </p>
            <Link href="/app/notices/new" className="btn-primary mt-7">
              <Plus /> New notice
            </Link>
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {notices.map((n) => {
              const url = `${origin}/n/${n.publicToken}`;
              return (
                <li key={n.id} className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/app/notices/${n.id}`} className="text-[17px] font-medium tracking-[-0.02em] hover:underline hover:underline-offset-4">
                        {n.title}
                      </Link>
                      {n.isDemo ? <span className="pill border-warn/40 text-warn">Demo data</span> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px] text-muted">
                      <NoticeStatePill state={n.state} openDrafts={n.openDrafts} />
                      {n.currentRevisionNumber ? <span>Version {n.currentRevisionNumber}</span> : null}
                      <span>Updated {formatStamp(n.updatedAt, n.timezone)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/app/notices/${n.id}/edit`} className="btn-secondary btn-sm">
                      <Pencil /> {n.state === "draft" ? "Continue" : "Edit"}
                    </Link>
                    {n.state === "published" ? (
                      <>
                        <CopyButton value={url} />
                        <a href={`/n/${n.publicToken}`} target="_blank" rel="noopener" className="btn-ghost btn-sm">
                          <External /> Listener
                        </a>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
