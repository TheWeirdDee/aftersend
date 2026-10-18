import Link from "next/link";
import { AnnouncementBar, SiteHeader } from "@/components/landing/site-header";
import { ProductStage } from "@/components/landing/product-stage";
import { LandingMotion } from "@/components/landing/landing-motion";
import { SiteFooter } from "@/components/site-footer";
import { ArrowRight, Check, Clock, Link as LinkIcon, Pencil, Wave } from "@/components/icons";

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-4 text-[clamp(2rem,4.6vw,3.25rem)] leading-[1.04] font-semibold tracking-[-0.04em] text-balance">{title}</h2>
      {children ? <div className="mt-5 text-[17px] leading-[1.6] text-muted text-pretty">{children}</div> : null}
    </div>
  );
}

const STEPS = [
  {
    icon: Pencil,
    title: "Write",
    body: "Paste the notice you already wrote. AfterSend picks out dates, times and phone numbers so you can check each one.",
  },
  {
    icon: Wave,
    title: "Approve",
    body: "Generate the spoken version, listen to it, and approve it. Nothing goes public until you do.",
  },
  {
    icon: LinkIcon,
    title: "Correct",
    body: "Change a detail later. You see exactly what changed, listen to the new audio, and approve. The link you already shared now plays the correction.",
  },
];

const FAQ = [
  {
    q: "Does the audio file people already downloaded change?",
    a: "No. A downloaded or forwarded audio file can never change. Only the AfterSend listening link updates. Share the link, not the file.",
  },
  {
    q: "Who decides what the listener hears?",
    a: "The publisher. Every version is generated from the publisher's exact text, played back for them, and published only after they approve it. Nothing is rewritten or published automatically.",
  },
  {
    q: "What happens if speech generation fails during a correction?",
    a: "The previous approved version stays live, with its audio and its text. A failed or half-finished generation can never be published.",
  },
  {
    q: "Can listeners tell that a notice was corrected?",
    a: "Yes. The listening page shows when it was last updated, says when a notice has been revised, and always shows the full current text next to the audio.",
  },
  {
    q: "Does AfterSend verify that a notice is official?",
    a: "No. AfterSend hosts what a publisher approves. It does not verify schools, agencies or facts, and it never shows a ‘verified’ badge.",
  },
  {
    q: "Do listeners need an account or an app?",
    a: "No. The link opens in any browser, with no sign-in, no microphone and no autoplay. The written notice is always there if audio can't play.",
  },
];

export default function Home() {
  return (
    <>
      <LandingMotion />
      <div data-hero="bar">
        <AnnouncementBar />
      </div>
      <SiteHeader />
      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden px-4 pt-14 sm:px-6 sm:pt-20 lg:pt-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(212,243,107,0.07),transparent_70%)]"
          />
          <div className="mx-auto max-w-[1040px] text-center">
            <h1 className="text-[clamp(2.6rem,7.6vw,5.5rem)] leading-[0.98] font-semibold tracking-[-0.05em] text-balance">
              <span className="block overflow-hidden pb-[0.06em]">
                <span data-hero="line" className="block">
                  The message changed.
                </span>
              </span>
              <span className="block overflow-hidden pb-[0.06em]">
                <span data-hero="line" className="block text-muted">
                  The link didn&apos;t.
                </span>
              </span>
            </h1>
            <p data-hero="copy" className="mx-auto mt-7 max-w-[600px] text-[17px] leading-[1.6] text-muted sm:text-[19px]">
              Turn important notices into natural spoken announcements.{" "}
              <strong className="font-medium text-fg">
                Correct the words, approve the new voice, and keep everyone on the same link.
              </strong>
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link data-hero="cta" href="/demo" className="btn-primary h-[52px] w-full px-7 text-[16px] sm:w-auto">
                Try live demo <ArrowRight />
              </Link>
              <Link data-hero="cta" href="#how" className="btn-secondary h-[52px] w-full px-7 text-[16px] sm:w-auto">
                See how it works
              </Link>
            </div>
          </div>
          <div id="product" data-hero="stage" className="mx-auto mt-14 max-w-6xl scroll-mt-24 sm:mt-16">
            <ProductStage />
          </div>
        </section>

        {/* Problem */}
        <section id="problem" className="px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto max-w-6xl">
            <div data-reveal>
              <SectionHeading eyebrow="The problem" title="A forwarded voice note can't take it back.">
                <p>
                  Schools send notices into parent group chats. When a time changes, the correction travels slower than the
                  original, and an audio file already on someone&apos;s phone can never be updated.
                </p>
              </SectionHeading>
            </div>
            <div data-reveal className="mt-14 grid gap-4 md:grid-cols-2">
              <div data-reveal-item className="card p-6 sm:p-8">
                <p className="eyebrow">Static voice note</p>
                <ul className="mt-6 space-y-4 text-[15.5px] leading-6 text-muted">
                  <li className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-removed" />Record it again and send it again.</li>
                  <li className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-removed" />The old recording keeps getting forwarded.</li>
                  <li className="flex gap-3"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-removed" />Nobody can tell which version is current.</li>
                </ul>
              </div>
              <div data-reveal-item className="card border-signal/25 p-6 sm:p-8">
                <p className="eyebrow text-signal">AfterSend link</p>
                <ul className="mt-6 space-y-4 text-[15.5px] leading-6 text-fg">
                  <li className="flex gap-3"><Check className="mt-1 size-4 shrink-0 text-signal" />Edit the text, regenerate the audio, approve.</li>
                  <li className="flex gap-3"><Check className="mt-1 size-4 shrink-0 text-signal" />The link people already have plays the correction.</li>
                  <li className="flex gap-3"><Check className="mt-1 size-4 shrink-0 text-signal" />Listeners see when it was updated, with the full text.</li>
                </ul>
              </div>
            </div>
            <figure data-reveal className="mt-10 rounded-2xl border border-line bg-ink-2 p-6 sm:p-8">
              <blockquote className="max-w-3xl text-[17px] leading-[1.6] text-fg">
                On 14 May 2026, Lagos State&apos;s Office of Education Quality Assurance publicly told schools to disregard a
                circulating message claiming students would be dismissed early the next day.
              </blockquote>
              <figcaption className="mt-4 text-[13.5px] leading-6 text-muted">
                Source:{" "}
                <a
                  className="underline underline-offset-4 hover:text-fg"
                  href="https://oeqalagos.com/urgent-notice-disregard-circulating-message-on-school-dismissal/"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  OEQA Lagos, “Urgent Notice: Disregard Circulating Message on School Dismissal”
                </a>
                . It is a historical example of why authoritative corrections matter. It does not show that audio would have
                prevented it, and AfterSend is not affiliated with OEQA.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-t border-line/70 px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto max-w-6xl">
            <div data-reveal>
              <SectionHeading eyebrow="How it works" title="Write. Approve. Correct.">
                <p>One workflow, built around the moment a detail changes after the notice has already gone out.</p>
              </SectionHeading>
            </div>
            <ol data-reveal className="mt-14 grid gap-4 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li data-reveal-item key={s.title} className="card flex flex-col p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-xl border border-line-strong bg-ink-2">
                      <s.icon className="size-[18px]" />
                    </span>
                    <span className="font-mono text-[12px] text-faint">0{i + 1}</span>
                  </div>
                  <h3 className="mt-8 text-[22px] font-semibold tracking-[-0.03em]">{s.title}</h3>
                  <p className="mt-3 text-[15px] leading-[1.6] text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Revisions */}
        <section id="revisions" className="border-t border-line/70 px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1fr_1.1fr]">
            <div data-reveal>
              <SectionHeading eyebrow="Before and after" title="Every version is kept. The link follows the newest one.">
                <p>
                  Each approved version keeps its own text and its own audio file, which never changes. Approving a correction
                  makes it current in a single step, so the page never mixes old audio with new text.
                </p>
              </SectionHeading>
            </div>
            <div data-reveal className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <span className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-muted">
                  <LinkIcon className="size-3.5 shrink-0" /> <span className="truncate">/n/7Vq2KpXoR1sT-3mB9aLw</span>
                </span>
                <span className="pill shrink-0 border-signal/40 text-signal">Same link</span>
              </div>
              <ul className="divide-y divide-line">
                <li data-reveal-item className="grid grid-cols-[auto_1fr] gap-4 px-5 py-5 sm:grid-cols-[auto_1fr_auto]">
                  <span className="grid size-9 place-items-center rounded-full border border-line-strong font-mono text-[13px] text-muted">1</span>
                  <div className="min-w-0">
                    <p className="text-[15px] text-muted">
                      Pickup is at <span className="text-removed line-through decoration-removed/60">3:00 PM</span> at the main gate.
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 font-mono text-[11.5px] text-faint">
                      <Clock className="size-3" /> Approved 2:05 PM · own audio file
                    </p>
                  </div>
                  <span className="pill col-start-2 w-fit border-line-strong text-muted sm:col-start-auto">Previous</span>
                </li>
                <li data-reveal-item className="grid grid-cols-[auto_1fr] gap-4 bg-signal/[0.04] px-5 py-5 sm:grid-cols-[auto_1fr_auto]">
                  <span className="grid size-9 place-items-center rounded-full bg-signal font-mono text-[13px] font-semibold text-signal-ink">2</span>
                  <div className="min-w-0">
                    <p className="text-[15px] text-fg">
                      Pickup is at <span className="font-medium text-signal">4:00 PM</span> at the main gate.
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 font-mono text-[11.5px] text-faint">
                      <Clock className="size-3" /> Approved 4:10 PM · own audio file
                    </p>
                  </div>
                  <span className="pill col-start-2 w-fit border-signal/50 text-signal sm:col-start-auto">Current</span>
                </li>
              </ul>
              <p className="border-t border-line px-5 py-3 text-[12.5px] text-faint">Illustration of a notice&apos;s revision history.</p>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="border-t border-line/70 px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto max-w-6xl">
            <div data-reveal>
              <SectionHeading eyebrow="Who it's for" title="Built for the office that sends the notice, and the parent who hears it." />
            </div>
            <div data-reveal className="mt-14 grid gap-4 md:grid-cols-2">
              <div data-reveal-item className="card p-6 sm:p-8">
                <h3 className="text-[20px] font-semibold tracking-[-0.03em]">For publishers</h3>
                <ul className="mt-6 space-y-3.5 text-[15.5px] leading-6 text-muted">
                  <li>Hear exactly what parents will hear before anyone else does.</li>
                  <li>Dates, times and phone numbers are flagged for you to check.</li>
                  <li>See what changed between versions before you approve.</li>
                  <li>Share one link, once.</li>
                </ul>
              </div>
              <div data-reveal-item className="card p-6 sm:p-8">
                <h3 className="text-[20px] font-semibold tracking-[-0.03em]">For listeners</h3>
                <ul className="mt-6 space-y-3.5 text-[15.5px] leading-6 text-muted">
                  <li>Open the link on any phone. No app, no account.</li>
                  <li>See when the notice was last updated, and whether it changed.</li>
                  <li>Read the full text if you can&apos;t listen right now.</li>
                  <li>Audio only plays when you press play.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Trust */}
        <section id="trust" className="border-t border-line/70 px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.2fr]">
            <div data-reveal>
              <SectionHeading eyebrow="Trust and limits" title="What AfterSend will not do.">
                <p>A correction tool is only useful if you can trust its limits.</p>
              </SectionHeading>
            </div>
            <ul data-reveal className="grid gap-3 sm:grid-cols-2">
              {[
                ["Recall files", "Downloaded or forwarded audio stays as it is. Only the link updates."],
                ["Verify issuers", "AfterSend does not check that a school or agency is who it says it is. No verified badges."],
                ["Check facts", "Speech reads the approved text. Making sure it's correct is the publisher's job."],
                ["Publish on its own", "Every first version and every correction needs a person to approve it."],
                ["Clone voices", "Only stock synthetic narrator voices. Never a real person's voice."],
                ["Send messages", "AfterSend gives you a link. You decide where to share it."],
              ].map(([t, d]) => (
                <li data-reveal-item key={t} className="rounded-xl border border-line bg-ink-2 p-5">
                  <p className="text-[15px] font-medium text-fg">{t}</p>
                  <p className="mt-1.5 text-[14px] leading-[1.55] text-muted">{d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-line/70 px-4 py-24 sm:px-6 sm:py-32">
          <div className="mx-auto max-w-3xl">
            <div data-reveal>
              <SectionHeading eyebrow="FAQ" title="Questions, answered plainly." />
            </div>
            <div data-reveal className="mt-12 divide-y divide-line border-y border-line">
              {FAQ.map((f) => (
                <details data-reveal-item key={f.q} className="group">
                  <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-4 text-left text-[17px] font-medium text-fg marker:hidden [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span
                      aria-hidden
                      className="grid size-7 shrink-0 place-items-center rounded-full border border-line-strong text-muted transition-transform duration-300 group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="pb-6 text-[15.5px] leading-[1.65] text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-4 pt-10 pb-28 sm:px-6">
          <div
            data-reveal
            className="relative mx-auto max-w-6xl overflow-hidden rounded-[28px] border border-line bg-surface px-6 py-16 text-center sm:py-24"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_100%,rgba(212,243,107,0.10),transparent_70%)]"
            />
            <h2 className="relative text-[clamp(2.1rem,5.5vw,4rem)] leading-[1] font-semibold tracking-[-0.045em] text-balance">
              Fix the notice. Keep the link.
            </h2>
            <p className="relative mx-auto mt-5 max-w-lg text-[17px] leading-[1.6] text-muted">
              Publish a sample school notice, change the pickup time, and hear the correction on the link you already have.
            </p>
            <div className="relative mt-9 flex justify-center">
              <Link href="/demo" className="btn-primary h-[52px] px-7 text-[16px]">
                Try live demo <ArrowRight />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
