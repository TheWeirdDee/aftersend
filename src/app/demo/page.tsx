import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { speechProvider } from "@/lib/speech";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/site-footer";
import { StartWorkspaceButton } from "@/components/app/workspace-gate";
import { ProviderUnavailable } from "@/components/app/provider-unavailable";
import { Check } from "@/components/icons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Create an announcement",
  description: "Write an announcement, hear it in real speech, publish a link, then correct it. No account needed.",
};

const STEPS = [
  ["Write", "Start from a sample or replace it with your own words. The spoken preview updates by itself when you stop typing."],
  ["Listen and publish", "Play the preview all the way through, then publish. You get a link that works for anyone."],
  ["Change it later", "Edit the announcement, listen to the corrected voice, and update. The same link plays the new version."],
];

export default async function TryPage() {
  const user = await currentUser();
  const configured = speechProvider().isConfigured();

  return (
    <>
      <SiteHeader />
      <main id="main" className="px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
          <div>
            <p className="eyebrow">No account needed</p>
            <h1 className="mt-3 text-[clamp(2.25rem,6vw,4.25rem)] leading-[1] font-semibold tracking-[-0.045em] text-balance">
              Write an announcement. <span className="mark-lime">Hear it. Share it.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[18px] leading-[1.55] text-muted">
              You start with a sample school announcement that you can replace completely. The speech is real, the link you publish works for anyone, and you
              can correct it afterwards.
            </p>
            <div className="mt-9 max-w-md">
              {!configured.ok ? (
                <ProviderUnavailable reason={configured.reason} />
              ) : user ? (
                <div className="space-y-3">
                  <Link href="/app" className="btn-accent h-[52px] w-full px-7 text-[16px]">
                    Continue to your announcements
                  </Link>
                  <Link href="/app/notices/new" className="btn-secondary h-[52px] w-full px-7 text-[16px]">
                    Start a new announcement
                  </Link>
                </div>
              ) : (
                <StartWorkspaceButton kind="guest" className="btn-accent h-[52px] w-full px-7 text-[16px]">
                  Start writing
                </StartWorkspaceButton>
              )}
              {!user ? (
                <p className="mt-4 text-[14px] text-muted">
                  Already have an account?{" "}
                  <Link href="/signin" className="text-fg underline underline-offset-4">
                    Sign in
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-4">
            <ol className="space-y-3">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="card flex gap-4 p-5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-lime text-[13px] font-semibold text-lime-ink">{i + 1}</span>
                  <div>
                    <p className="text-[16px] font-medium">{t}</p>
                    <p className="mt-1 text-[14.5px] leading-6 text-muted">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <section aria-labelledby="guest-heading" className="rounded-2xl border border-line bg-ink-2 p-5">
              <h2 id="guest-heading" className="text-[15px] font-semibold">
                How guest access works
              </h2>
              <ul className="mt-3 space-y-2.5 text-[14px] leading-6 text-muted">
                {[
                  "Your guest announcements are tied to this browser, for up to 30 days. If you clear your browser, you lose access to them.",
                  "Save your account with an email address and a code, at any time, to keep them and update them from any device.",
                  "Guests can prepare a limited number of spoken previews each hour. Signed-in accounts get more.",
                  "Your announcements are private to you until you publish, and nobody else can see or change them.",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <Check className="mt-1 size-4 shrink-0 text-signal" />
                    {t}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
