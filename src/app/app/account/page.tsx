import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { listNotices } from "@/lib/notices/revision-service";
import { AppHeader } from "@/components/app/app-header";
import { EmailSignIn } from "@/components/app/email-sign-in";
import { SignOutEverywhereButton } from "@/components/app/sign-out-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account", robots: { index: false } };

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const noticeCount = (await listNotices(user.id)).length;

  return (
    <>
      <AppHeader workspaceLabel={user.email ?? user.displayName} isDemo={user.kind === "demo"} hasEmail={!!user.email} />
      <main id="main" className="mx-auto max-w-[680px] px-4 py-10 sm:px-6 sm:py-14">
        <Link href="/app" className="text-[14px] text-muted hover:text-fg">
          ← Notices
        </Link>
        <h1 className="mt-4 text-[32px] leading-tight font-semibold tracking-[-0.04em]">Account</h1>

        {user.kind === "demo" ? (
          <p className="mt-6 rounded-xl border border-warn/40 bg-warn/[0.07] p-4 text-[15px] leading-6">
            This is a demo workspace with fictional data. It can&apos;t be connected to an email. <Link href="/signin" className="underline underline-offset-4">Sign in with email</Link> to
            start a real workspace.
          </p>
        ) : user.email ? (
          <section aria-labelledby="signed-in" className="mt-6 space-y-5">
            <h2 id="signed-in" className="sr-only">
              Signed in
            </h2>
            <p className="text-[16px] leading-7">
              Signed in as <strong className="font-medium">{user.email}</strong>. {noticeCount} notice{noticeCount === 1 ? "" : "s"} in this workspace.
            </p>
            <p className="text-[14.5px] leading-6 text-muted">
              To open this workspace on another device or after clearing your browser, choose Sign in and enter the code we email you. Sessions last 30 days.
            </p>
            <SignOutEverywhereButton />
          </section>
        ) : (
          <section aria-labelledby="save" className="mt-6 space-y-5">
            <h2 id="save" className="text-[19px] font-semibold tracking-[-0.02em]">
              Save this workspace to your email
            </h2>
            <p className="text-[15px] leading-6 text-muted">
              Right now this workspace lives only in this browser. Clear your cookies and you lose the ability to correct or withdraw your notices, which stay
              public. Connect it to an email to keep access.
            </p>
            <EmailSignIn linkNotices={noticeCount} />
          </section>
        )}
      </main>
    </>
  );
}
