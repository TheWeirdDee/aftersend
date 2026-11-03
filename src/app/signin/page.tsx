import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { listNotices } from "@/lib/notices/revision-service";
import { SiteHeader } from "@/components/landing/site-header";
import { EmailSignIn } from "@/components/app/email-sign-in";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function SignInPage() {
  const user = await currentUser();
  if (user?.email) redirect("/app");
  // A guest session (or an account with no email yet) is saved to the email that gets verified here.
  const linkNotices = user ? (await listNotices(user.id)).length : null;

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto grid min-h-[calc(100dvh-65px)] max-w-[1180px] place-items-center px-4 py-16 sm:px-6">
        <div className="w-full max-w-md">
          <p className="eyebrow">Sign in or save your account</p>
          <h1 className="mt-4 text-[clamp(1.85rem,5vw,2.5rem)] leading-[1.05] font-semibold tracking-[-0.04em]">Use your email to get back to your announcements.</h1>
          <p className="mt-4 text-[16px] leading-[1.6] text-muted">
            Your announcements are saved to your email, so you can reach them from any device and recover them if you clear your browser. Published links never
            depend on signing in.
          </p>
          <div className="mt-8">
            <EmailSignIn linkNotices={linkNotices} />
          </div>
          <p className="mt-8 text-[13px] leading-5 text-faint">
            No password to remember or leak. Codes work once and expire in 10 minutes.{" "}
            <Link href="/app" className="underline underline-offset-4">
              Back to your announcements
            </Link>
            .
          </p>
        </div>
      </main>
    </>
  );
}
