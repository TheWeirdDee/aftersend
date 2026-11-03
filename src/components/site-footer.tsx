import Link from "next/link";
import { Wordmark } from "./logo";
import { CreateAnnouncementButton } from "./app/create-button";
import { ThemeToggle } from "./theme-toggle";

export function SiteFooter() {
  return (
    <footer className="border-t border-line px-4 py-12 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-4 text-[14px] leading-6 text-muted">
            Spoken school announcements you can correct after the link is shared. Speech is generated with AssemblyAI. AfterSend is independent
            and is not endorsed by AssemblyAI.
          </p>
        </div>
        <nav aria-label="Product">
          <p className="eyebrow">Product</p>
          <ul className="mt-4 space-y-3 text-[14.5px] text-muted">
            <li>
              <CreateAnnouncementButton className="text-left hover:text-fg" />
            </li>
            <li>
              <Link className="hover:text-fg" href="/#how">
                How it works
              </Link>
            </li>
            <li>
              <Link className="hover:text-fg" href="/#correct">
                Corrections
              </Link>
            </li>
            <li>
              <Link className="hover:text-fg" href="/#trust">
                Trust and limits
              </Link>
            </li>
            <li>
              <Link className="hover:text-fg" href="/#faq">
                FAQ
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Account and code">
          <p className="eyebrow">Account</p>
          <ul className="mt-4 space-y-3 text-[14.5px] text-muted">
            <li>
              <Link className="hover:text-fg" href="/app">
                Your announcements
              </Link>
            </li>
            <li>
              <Link className="hover:text-fg" href="/signin">
                Sign in or recover your account
              </Link>
            </li>
            <li>
              <a className="hover:text-fg" href="https://github.com/TheWeirdDee/aftersend" rel="noopener noreferrer" target="_blank">
                Source code
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <p className="text-[13px] text-faint">AfterSend hosts what a publisher approves. It does not verify publishers or facts.</p>
        <ThemeToggle variant="group" />
      </div>
    </footer>
  );
}
