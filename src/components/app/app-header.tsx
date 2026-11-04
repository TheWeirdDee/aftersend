import Link from "next/link";
import { Wordmark } from "../logo";
import { ThemeToggle } from "../theme-toggle";
import { SignOutButton } from "./sign-out-button";

/**
 * The bar across every signed-in screen. A guest sees a plain "Guest" label and a prominent way to save their account;
 * someone with an email sees it instead.
 */
export function AppHeader({ workspaceLabel, isDemo, hasEmail = false }: { workspaceLabel?: string; isDemo?: boolean; hasEmail?: boolean }) {
  const signedIn = !!workspaceLabel;
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-ink/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-5">
            <Link href="/" aria-label="AfterSend home" className="shrink-0 rounded-lg">
              <Wordmark markOnlyBelow />
            </Link>
            {signedIn ? (
              <nav aria-label="Your announcements" className="hidden items-center gap-1 sm:flex">
                <Link href="/app" className="inline-flex min-h-10 items-center rounded-full px-3 text-[14.5px] text-muted hover:text-fg">
                  Your announcements
                </Link>
                <Link href="/app/notices/new" className="inline-flex min-h-10 items-center rounded-full px-3 text-[14.5px] text-muted hover:text-fg">
                  New announcement
                </Link>
              </nav>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            {signedIn && isDemo ? (
              <>
                <span className="pill hidden border-line-strong text-muted md:inline-flex">Guest</span>
                <Link href="/app/account" className="btn-accent btn-sm whitespace-nowrap">
                  Save your account
                </Link>
              </>
            ) : signedIn ? (
              <>
                <span className="hidden max-w-[200px] truncate text-[13px] text-muted lg:inline">{workspaceLabel}</span>
                <Link href="/app/account" className="btn-ghost btn-sm whitespace-nowrap">
                  Account
                </Link>
              </>
            ) : (
              <Link href="/signin" className="btn-ghost btn-sm whitespace-nowrap">
                Sign in
              </Link>
            )}
            {signedIn ? <SignOutButton hasEmail={hasEmail} /> : null}
          </div>
        </div>
      </header>
      {signedIn && isDemo ? (
        <div className="border-b border-line bg-surface-2">
          <p className="mx-auto max-w-[1180px] px-4 py-2.5 text-[13.5px] leading-5 text-muted sm:px-6">
            <strong className="font-medium text-fg">You&apos;re using AfterSend as a guest.</strong> Your announcements stay with this browser for up to
            30 days. <Link href="/app/account" className="text-fg underline underline-offset-4">Save your account with your email</Link> before you rely
            on a link, so you can still update it from any device.
          </p>
        </div>
      ) : null}
    </>
  );
}
