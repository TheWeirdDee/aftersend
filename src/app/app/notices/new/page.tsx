import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { speechProvider } from "@/lib/speech";
import { AppHeader } from "@/components/app/app-header";
import { NoticeComposer } from "@/components/app/notice-composer";
import { ProviderUnavailable } from "@/components/app/provider-unavailable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New announcement", robots: { index: false } };

export default async function NewNoticePage() {
  const user = await currentUser();
  if (!user) redirect("/app");
  const provider = speechProvider();
  const configured = provider.isConfigured();
  const voices = provider.listVoices();

  return (
    <>
      <AppHeader workspaceLabel={user.email ?? user.displayName} isDemo={user.kind === "demo"} hasEmail={!!user.email} />
      <main id="main" className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6 sm:py-14">
        <Link href="/app" className="text-[14px] text-muted hover:text-fg">
          ← Your announcements
        </Link>
        <h1 className="mt-4 text-[32px] leading-tight font-semibold tracking-[-0.04em]">New announcement</h1>
        <p className="mt-1.5 max-w-2xl text-[15.5px] text-muted">
          Write or paste the announcement. The spoken preview is prepared for you on the next screen, and nothing is public until you publish.
        </p>
        <div className="mt-10">
          {configured.ok && voices.length > 0 ? (
            <NoticeComposer voices={voices} />
          ) : (
            <ProviderUnavailable reason={configured.ok ? "No voices are configured." : configured.reason} />
          )}
        </div>
      </main>
    </>
  );
}
