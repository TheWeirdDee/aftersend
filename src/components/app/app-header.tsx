import Link from "next/link";
import { Wordmark } from "../logo";
import { SignOutButton } from "./sign-out-button";

export function AppHeader({ workspaceLabel, isDemo, hasEmail = false }: { workspaceLabel?: string; isDemo?: boolean; hasEmail?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/app" aria-label="AfterSend workspace" className="shrink-0 rounded-lg">
            <Wordmark />
          </Link>
          {workspaceLabel && !isDemo ? (
            <span className="hidden truncate text-[13px] text-muted sm:inline">
              <span aria-hidden className="mr-3 text-line-strong">/</span>
              {workspaceLabel}
            </span>
          ) : null}
          {isDemo ? (
            <span className="pill border-warn/40 text-warn">
              Demo<span className="hidden sm:inline">&nbsp;workspace</span>
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {workspaceLabel && !isDemo && !hasEmail ? (
            <Link href="/app/account" className="btn-ghost btn-sm whitespace-nowrap text-signal">
              Save to email
            </Link>
          ) : workspaceLabel ? (
            <Link href="/app/account" className="btn-ghost btn-sm whitespace-nowrap">
              Account
            </Link>
          ) : (
            <Link href="/signin" className="btn-ghost btn-sm whitespace-nowrap">
              Sign in
            </Link>
          )}
          {workspaceLabel ? <SignOutButton hasEmail={hasEmail} /> : null}
        </div>
      </div>
    </header>
  );
}
