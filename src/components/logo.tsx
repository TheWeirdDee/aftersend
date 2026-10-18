/**
 * AfterSend mark: a rounded frame (the one stable link) holding a short waveform whose final bar is
 * lifted and lit — the revised part of the message.
 */
export function LogoMark({ className = "size-7", title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.9" />
      <rect x="8" y="13" width="3" height="9" rx="1.5" fill="currentColor" />
      <rect x="13.5" y="9" width="3" height="13" rx="1.5" fill="currentColor" />
      <rect x="19" y="15" width="3" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="21.5" y="8" width="3" height="10" rx="1.5" fill="var(--color-signal)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-fg ${className}`}>
      <LogoMark className="size-7" />
      <span className="text-[19px] font-semibold tracking-[-0.035em]">AfterSend</span>
    </span>
  );
}
