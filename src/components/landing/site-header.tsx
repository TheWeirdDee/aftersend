"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "../logo";
import { ArrowRight, Close, Menu } from "../icons";

const NAV = [
  { href: "/#product", label: "Product" },
  { href: "/#how", label: "How it works" },
  { href: "/demo", label: "Live demo" },
  { href: "/#faq", label: "FAQ" },
];

export function AnnouncementBar() {
  return (
    <div data-hero className="border-b border-line/70 bg-ink-2">
      <p className="mx-auto flex min-h-10 max-w-6xl flex-wrap items-center justify-center gap-x-2 px-4 py-2 text-center text-[13px] text-muted">
        <span className="inline-block size-1.5 rounded-full bg-signal" aria-hidden />
        <span className="text-fg">Built for AssemblyAI&apos;s Hack into Speech 2026.</span>
        <Link href="/demo" className="inline-flex items-center gap-1 underline-offset-4 hover:text-fg hover:underline">
          Try the live demo <ArrowRight className="size-3.5" />
        </Link>
      </p>
    </div>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      data-hero
      className={`sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled || open ? "border-b border-line/80 bg-ink/80 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 md:h-[72px]">
        <Link href="/" aria-label="AfterSend home" className="shrink-0 rounded-lg">
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="rounded-full px-3.5 py-2 text-[15px] text-muted transition-colors hover:text-fg">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/demo" className="btn-primary btn-sm hidden sm:inline-flex">
            Try live demo
          </Link>
          <button
            type="button"
            className="btn-ghost btn-sm size-10 px-0 md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <Close className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      <nav id="mobile-nav" aria-label="Mobile" hidden={!open} className="border-t border-line/80 md:hidden">
        <ul className="mx-auto flex max-w-6xl flex-col px-4 py-3">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center rounded-lg px-2 text-[17px] text-fg hover:bg-surface"
              >
                {n.label}
              </Link>
            </li>
          ))}
          <li className="pt-2 pb-1">
            <Link href="/demo" onClick={() => setOpen(false)} className="btn-primary w-full">
              Try live demo
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
