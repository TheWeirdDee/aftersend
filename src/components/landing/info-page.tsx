import { SiteFooter } from "../site-footer";
import { SiteHeader } from "./site-header";

/**
 * The shell for the standalone public pages. It uses the same header, footer and content width as the homepage, so moving
 * between them never shifts the page sideways.
 */
export function InfoPage({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-4 max-w-4xl text-[clamp(2.15rem,5vw,3.6rem)] leading-[1.04] font-semibold tracking-[-0.045em] text-balance">{title}</h1>
          <p className="mt-6 max-w-2xl text-[18px] leading-[1.6] text-pretty text-muted sm:text-[19px]">{lede}</p>
          <div className="mt-14 max-w-2xl space-y-12">{children}</div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

/** One titled block on an info page. Every block starts with the same rule, so the page reads as one document. */
export function InfoSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="border-t border-line pt-10">
      <h2 id={`${id}-heading`} className="text-[clamp(1.4rem,2.4vw,1.8rem)] leading-[1.15] font-semibold tracking-[-0.03em] text-fg">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[16.5px] leading-[1.7] text-muted">{children}</div>
    </section>
  );
}
