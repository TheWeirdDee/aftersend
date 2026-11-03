/**
 * The AfterSend mark: a bold "A" for announcement whose crossbar is lit. The crossbar is the part of a message that
 * gets revised after it has been sent, which is what the product is for. The same drawing is used for the favicon,
 * the app icon and the social image (src/app/icon.svg).
 */
export function LogoMark({ className = "size-7", title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M6.5 26 16 6l9.5 20" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="10.4" y="17.6" width="11.2" height="3.8" rx="1.9" fill="var(--color-lime)" />
    </svg>
  );
}

/** `markOnlyBelow` hides the name on narrow screens, where a header has no room for it beside its buttons. */
export function Wordmark({ className = "", markOnlyBelow = false }: { className?: string; markOnlyBelow?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 text-fg ${className}`}>
      <LogoMark className="size-7" />
      <span className={`font-display text-[20px] font-semibold tracking-[-0.04em] ${markOnlyBelow ? "hidden min-[440px]:inline" : ""}`}>AfterSend</span>
    </span>
  );
}
