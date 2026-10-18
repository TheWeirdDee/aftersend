import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { speechProvider } from "@/lib/speech";
import { SAMPLE_NOTICE } from "@/lib/notices/samples";
import { AnnouncementBar, SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/site-footer";
import { StartWorkspaceButton } from "@/components/app/workspace-gate";
import { ProviderUnavailable } from "@/components/app/provider-unavailable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Live demo",
  description: "Publish a sample spoken notice, correct it, and hear the change at the same link.",
};

const STEPS = [
  ["Generate", "Generate the spoken version of the sample notice and listen to it."],
  ["Publish", "Confirm the facts and approve. You get a listener link: open it in another tab or on your phone."],
  ["Correct", `Change “${SAMPLE_NOTICE.correctedFrom}” to “${SAMPLE_NOTICE.correctedTo}”, check the diff, regenerate and listen.`],
  ["Approve", "Approve the update, then refresh the listener tab. Same link, new voice, new text."],
];

export default async function DemoPage() {
  const user = await currentUser();
  const provider = speechProvider();
  const configured = provider.isConfigured();

  return (
    <>
      <AnnouncementBar />
      <SiteHeader />
      <main id="main" className="px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <div>
            <p className="eyebrow">Live demo</p>
            <h1 className="mt-4 text-[clamp(2.25rem,6vw,4rem)] leading-[1] font-semibold tracking-[-0.045em] text-balance">
              Change the pickup time. Keep the link.
            </h1>
            <p className="mt-6 max-w-lg text-[17px] leading-[1.6] text-muted">
              You get your own private demo workspace with a fictional sample school notice. Every audio clip is generated live
              when you press the button. Nothing is pre-recorded.
            </p>
            <div className="mt-9 max-w-md">
              {configured.ok ? (
                <StartWorkspaceButton kind="demo" className="btn-primary h-[52px] w-full px-7 text-[16px]">
                  Start the demo
                </StartWorkspaceButton>
              ) : (
                <ProviderUnavailable reason={configured.reason} />
              )}
              {user ? (
                <p className="mt-4 text-[14px] text-muted">
                  You already have a workspace in this browser.{" "}
                  <Link href="/app" className="text-fg underline underline-offset-4">
                    Open it
                  </Link>
                  .
                </p>
              ) : null}
            </div>
            <p className="mt-6 max-w-md text-[13px] leading-5 text-faint">
              Demo workspaces are isolated. They can&apos;t see or change anyone else&apos;s notices, and audio generation is
              rate-limited.
            </p>
          </div>
          <div>
            <ol className="space-y-3">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="card flex gap-4 p-5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong font-mono text-[13px] text-muted">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[16px] font-medium">{t}</p>
                    <p className="mt-1 text-[14.5px] leading-6 text-muted">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <figure className="mt-6 rounded-2xl border border-line bg-ink-2 p-5">
              <figcaption className="flex items-center justify-between">
                <span className="eyebrow">Sample notice</span>
                <span className="pill border-warn/40 text-warn">Demo data</span>
              </figcaption>
              <p className="mt-3 text-[15px] font-medium">{SAMPLE_NOTICE.title}</p>
              <p className="mt-2 text-[14px] leading-6 whitespace-pre-wrap text-muted">{SAMPLE_NOTICE.text}</p>
            </figure>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
