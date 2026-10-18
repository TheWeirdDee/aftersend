import Link from "next/link";
import { Wordmark } from "./logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-line/70 px-4 py-12 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-4 text-[13.5px] leading-6 text-muted">
            A spoken notice you can correct after the link is shared. Built for AssemblyAI&apos;s Hack into Speech 2026. Not
            affiliated with or endorsed by AssemblyAI.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-10 gap-y-3 text-[14px] text-muted">
            <li><Link className="hover:text-fg" href="/demo">Live demo</Link></li>
            <li><Link className="hover:text-fg" href="/#how">How it works</Link></li>
            <li><Link className="hover:text-fg" href="/#trust">Trust and limits</Link></li>
            <li><Link className="hover:text-fg" href="/#faq">FAQ</Link></li>
            <li><Link className="hover:text-fg" href="/app">Publisher workspace</Link></li>
            <li>
              <a className="hover:text-fg" href="https://github.com/TheWeirdDee/aftersend" rel="noopener noreferrer" target="_blank">
                Source code
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
