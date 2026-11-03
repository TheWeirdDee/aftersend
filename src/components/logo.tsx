/**
 * The AfterSend mark: a speech bubble holding two linked rings. The bubble is the spoken announcement; the rings are the one
 * link that is shared, one for the version that went out and one, in lime, for the correction that now rides on the same
 * link. It is drawn with a bold outline so it still reads at 16 px. The same drawing is public/icon.svg (favicon),
 * the app icon and the social image (scripts/make-brand.mjs).
 *
 * Colours come from --mark-* variables (globals.css), so the tile is dark on the light theme and lime on the dark theme.
 */
export const BUBBLE = "M10 2H22A8 8 0 0 1 30 10V16A8 8 0 0 1 22 24H15L10 29.5V24A8 8 0 0 1 2 16V10A8 8 0 0 1 10 2Z";

export function LogoMark({ className = "size-7", title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} focusable="false">
      {title ? <title>{title}</title> : null}
      <path d={BUBBLE} fill="var(--mark-tile)" />
      <circle cx="12.2" cy="13" r="5.4" fill="none" stroke="var(--mark-a)" strokeWidth="2.7" />
      <path d="M17.3 8.4A5.4 5.4 0 1 1 17.3 17.6" fill="none" stroke="var(--mark-tile)" strokeWidth="4.3" />
      <circle cx="19.8" cy="13" r="5.4" fill="none" stroke="var(--mark-b)" strokeWidth="2.7" />
    </svg>
  );
}

/**
 * The one lockup used on every screen: the mark and the name. `markOnlyBelow` hides the name on narrow screens, where a header
 * has no room for it beside its buttons; the link around it always carries the accessible name.
 */
export function Wordmark({ className = "", markOnlyBelow = false, size = "md" }: { className?: string; markOnlyBelow?: boolean; size?: "sm" | "md" }) {
  const small = size === "sm";
  return (
    <span className={`inline-flex items-center ${small ? "gap-1.5" : "gap-2"} text-fg ${className}`}>
      <LogoMark className={small ? "size-5" : "size-8"} />
      <span
        className={`font-display font-semibold tracking-[-0.04em] ${small ? "text-[15px]" : "text-[20px]"} ${markOnlyBelow ? "hidden min-[440px]:inline" : ""}`}
      >
        AfterSend
      </span>
    </span>
  );
}
