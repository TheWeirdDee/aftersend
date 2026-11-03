"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "../logo";
import { ThemeToggle } from "../theme-toggle";
import { Close, Menu } from "../icons";
import { CreateAnnouncementButton } from "../app/create-button";

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#correct", label: "Corrections" },
  { href: "/#trust", label: "Trust" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
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
      className={`sticky top-0 z-50 border-b transition-[background-color,border-color] duration-200 ${
        scrolled || open ? "border-line bg-ink/90 backdrop-blur-xl" : "border-transparent bg-ink"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="AfterSend home" className="shrink-0 rounded-lg" onClick={() => setOpen(false)}>
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="inline-flex min-h-11 items-center rounded-full px-3.5 text-[15px] text-muted transition-colors hover:text-fg">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Link href="/signin" className="btn-ghost btn-sm hidden lg:inline-flex">
            Sign in
          </Link>
          <span className="hidden sm:inline-flex">
            <CreateAnnouncementButton className="btn-primary btn-sm" />
          </span>
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
      <nav id="mobile-nav" aria-label="Mobile" hidden={!open} className="border-t border-line md:hidden">
        <ul className="mx-auto flex max-w-6xl flex-col px-4 py-3">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link href={n.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center rounded-lg px-2 text-[17px] text-fg hover:bg-surface-2">
                {n.label}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/signin" onClick={() => setOpen(false)} className="flex min-h-12 items-center rounded-lg px-2 text-[17px] text-fg hover:bg-surface-2">
              Sign in
            </Link>
          </li>
          <li className="flex pt-2 pb-1 [&>span]:w-full">
            <CreateAnnouncementButton className="btn-primary w-full" />
          </li>
        </ul>
      </nav>
    </header>
  );
}
