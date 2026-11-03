import Link from "next/link";
import { SiteHeader } from "@/components/landing/site-header";
import { CorrectionDemo } from "@/components/landing/correction-demo";
import { SiteFooter } from "@/components/site-footer";
import { ArrowRight, Check, Link as LinkIcon, Pencil, Wave } from "@/components/icons";

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-[clamp(1.9rem,4.2vw,3rem)] leading-[1.05] font-semibold tracking-[-0.04em] text-balance">{title}</h2>
      {children ? <div className="mt-4 text-[17px] leading-[1.6] text-muted text-pretty">{children}</div> : null}
    </div>
  );
}

const STEPS = [
  {
    icon: Pencil,
    title: "Write it",
    body: "Type or paste the announcement. Dates, times and phone numbers are picked out so you can check each one.",
  },
  {
    icon: Wave,
    title: "Hear it",
    body: "The spoken version is prepared automatically when you stop typing, and refreshed whenever you edit. Nothing goes public yet.",
  },
  {
    icon: LinkIcon,
    title: "Share one link",
    body: "Listen to the whole preview, publish, and share the link wherever parents already are. That link stays the same.",
  },
];

const FAQ = [
  {
    q: "Does audio that people already downloaded change?",
    a: "No. A downloaded or forwarded audio file can never change. Only the AfterSend link updates, so share the link instead of the file.",
  },
  {
    q: "Who decides what the listener hears?",
    a: "The publisher. Every version is spoken from the publisher's exact words, played back to them, and published only after they approve it. Nothing is rewritten or published automatically.",
  },
  {
    q: "What if the new voice fails to prepare during a correction?",
    a: "The previous approved announcement stays live, with its audio and its text. A failed or unfinished preview can never be published.",
  },
  {
    q: "Can listeners tell that an announcement was corrected?",
    a: "Yes. The listener page shows when it was last updated, says when it has been corrected, and always shows the full current text next to the audio.",
  },
  {
    q: "Does AfterSend verify that an announcement is official?",
    a: "No. AfterSend hosts what a publisher approves. It does not verify schools or facts, and it never shows a verified badge.",
  },
  {
    q: "Do listeners need an account or an app?",
    a: "No. The link opens in any browser with no sign-in. Audio only plays when they press play, and the written announcement is always there.",
  },
  {
    q: "Do I need an account to try it?",
    a: "No. You can write, hear and publish a real announcement as a guest. Guest announcements are tied to your browser, so save your account with an email address before you rely on the link.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* Hero */}
        <section className="px-4 pt-12 pb-16 sm:px-6 sm:pt-20 sm:pb-24">
          <div className="mx-auto max-w-6xl">
            <p className="eyebrow">Spoken announcements for schools and organisations</p>
            <h1 className="mt-4 max-w-5xl text-[clamp(2.5rem,7.4vw,5.75rem)] leading-[0.98] font-semibold tracking-[-0.05em] text-balance">
              One announcement. One link. <span className="mark-lime">Even when plans change.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-[18px] leading-[1.55] text-muted sm:text-[20px]">
              Write an important notice, let AfterSend turn it into speech, and share one link. When the details change, update the announcement
              without sending everyone a new link.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/demo" className="btn-accent h-[52px] px-7 text-[16px]">
                Create an announcement <ArrowRight />
              </Link>
              <Link href="#how" className="btn-secondary h-[52px] px-7 text-[16px]">
                See how it works
              </Link>
            </div>
            <p className="mt-4 text-[14px] text-faint">No account needed to try it. Real speech by AssemblyAI.</p>
            <div className="mt-12 sm:mt-16">
              <CorrectionDemo />
            </div>
          </div>
        </section>

        {/* Problem */}
        <section id="problem" className="border-t border-line px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
            <SectionHeading eyebrow="The problem" title="A forwarded voice note can't take it back.">
              <p>
                Schools send notices into parent group chats. When a time changes, the correction travels slower than the original, and an audio
                file that is already on someone&apos;s phone can never be updated.
              </p>
            </SectionHeading>
            <div className="space-y-4">
              <div className="card p-6">
                <p className="eyebrow">A recorded voice note</p>
                <ul className="mt-4 space-y-3 text-[15.5px] leading-6 text-muted">
                  <li className="flex gap-3">
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-removed" />
                    Record it again and send it again.
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-removed" />
                    The old recording keeps getting forwarded.
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-removed" />
                    Nobody can tell which version is current.
                  </li>
                </ul>
              </div>
              <figure className="rounded-2xl border border-line bg-ink-2 p-6">
                <blockquote className="text-[16px] leading-[1.6] text-fg">
                  In May 2026, Lagos State&apos;s Office of Education Quality Assurance publicly told schools to disregard a circulating message
                  claiming students would be dismissed early the next day.
                </blockquote>
                <figcaption className="mt-3 text-[13px] leading-6 text-muted">
                  Source:{" "}
                  <a
                    className="underline underline-offset-4 hover:text-fg"
                    href="https://oeqalagos.com/urgent-notice-disregard-circulating-message-on-school-dismissal/"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    OEQA Lagos, “Urgent Notice: Disregard Circulating Message on School Dismissal”
                  </a>
                  . A real example of why corrections matter. It does not show that audio would have prevented it, and AfterSend is not affiliated
                  with OEQA.
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-t border-line bg-ink-2 px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <SectionHeading eyebrow="How it works" title="Write, listen, share.">
              <p>The voice keeps up with your words, so there is no Generate button to remember.</p>
            </SectionHeading>
            <ol className="mt-12 grid gap-4 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="card flex flex-col p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-xl bg-lime text-lime-ink">
                      <s.icon className="size-[18px]" />
                    </span>
                    <span className="text-[13px] font-medium text-faint tabular-nums">Step {i + 1}</span>
                  </div>
                  <h3 className="mt-8 text-[22px] font-semibold tracking-[-0.03em]">{s.title}</h3>
                  <p className="mt-3 text-[15.5px] leading-[1.6] text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Corrections and the same link */}
        <section id="correct" className="border-t border-line px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto grid max-w-6xl items-start gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
            <SectionHeading eyebrow="When a notice changes" title="Fix the words. The link keeps working.">
              <p>
                Edit the announcement and the new spoken version is prepared for you. Until you approve it, the link keeps playing the previous
                version. The moment you do, everyone who already has the link hears the correction, with the full text beside it.
              </p>
              <p className="mt-4">Each version keeps its own text and audio, so the page never pairs old audio with new words.</p>
            </SectionHeading>
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
                  <LinkIcon className="size-3.5 shrink-0" /> <span className="truncate">aftersend.app/n/7Vq2KpXoR1sT</span>
                </span>
                <span className="pill shrink-0 border-signal/40 text-signal">Same link</span>
              </div>
              <ul className="divide-y divide-line">
                <li className="grid grid-cols-[auto_1fr] gap-4 px-5 py-5">
                  <span className="grid size-9 place-items-center rounded-full border border-line-strong text-[13px] text-muted">1</span>
                  <div className="min-w-0">
                    <p className="text-[15.5px] text-muted">
                      Pickup is at <span className="text-removed line-through decoration-removed/60">3:00 PM</span> at the main gate.
                    </p>
                    <p className="mt-1 text-[12.5px] text-faint">Previous version · own audio file</p>
                  </div>
                </li>
                <li className="grid grid-cols-[auto_1fr] gap-4 bg-surface-2 px-5 py-5">
                  <span className="grid size-9 place-items-center rounded-full bg-lime text-[13px] font-semibold text-lime-ink">2</span>
                  <div className="min-w-0">
                    <p className="text-[15.5px] text-fg">
                      Pickup is at <span className="mark-lime font-medium">4:00 PM</span> at the main gate.
                    </p>
                    <p className="mt-1 text-[12.5px] text-faint">Current version · own audio file</p>
                  </div>
                </li>
              </ul>
              <p className="border-t border-line px-5 py-3 text-[12.5px] text-faint">Illustration of an announcement&apos;s history.</p>
            </div>
          </div>
        </section>

        {/* Who it's for: the lime headline treatment */}
        <section className="border-t border-line px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <p className="eyebrow">Two sides of one link</p>
            <h2 className="mt-3 max-w-4xl text-[clamp(2rem,5vw,3.6rem)] leading-[1.12] font-semibold tracking-[-0.04em] text-balance">
              Built for <span className="mark-block">the office that sends the notice</span>, and <span className="mark-block">the parent who hears it.</span>
            </h2>
            <div className="mt-12 grid gap-4 md:grid-cols-2">
              <div className="card p-6 sm:p-8">
                <h3 className="text-[20px] font-semibold tracking-[-0.03em]">If you publish announcements</h3>
                <ul className="mt-5 space-y-3.5 text-[15.5px] leading-6 text-muted">
                  <li className="flex gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-signal" />
                    Hear exactly what parents will hear before anyone else does.
                  </li>
                  <li className="flex gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-signal" />
                    Dates, times and phone numbers are flagged for you to check.
                  </li>
                  <li className="flex gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-signal" />
                    See what changed between versions before you approve.
                  </li>
                  <li className="flex gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-signal" />
                    Share one link, once.
                  </li>
                </ul>
              </div>
              <div className="card p-6 sm:p-8">
                <h3 className="text-[20px] font-semibold tracking-[-0.03em]">If you receive them</h3>
                <ul className="mt-5 space-y-3.5 text-[15.5px] leading-6 text-muted">
                  <li className="flex gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-signal" />
                    Open the link on any phone. No app, no account.
                  </li>
                  <li className="flex gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-signal" />
                    See when it was last updated, and whether it was corrected.
                  </li>
                  <li className="flex gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-signal" />
                    Read the full text if you can&apos;t listen right now.
                  </li>
                  <li className="flex gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-signal" />
                    Audio only plays when you press play.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Real speech */}
        <section id="speech" className="border-t border-line bg-ink-2 px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
            <SectionHeading eyebrow="Real speech" title="Natural spoken announcements, prepared as you type.">
              <p>
                Speech is generated by AssemblyAI&apos;s text-to-speech. You pick a voice, stop typing, and the preview refreshes by itself. You
                hear the real result before anything is published, and again for every correction.
              </p>
            </SectionHeading>
            <div className="card p-6 sm:p-8">
              <ul className="space-y-5">
                {[
                  ["Choose a voice", "Pick from the voices the speech service offers. They are synthetic narrators, never a real person's voice."],
                  ["Edit freely", "Each pause in typing refreshes the preview. A newer edit always replaces an older preview."],
                  ["Listen, then approve", "Publishing unlocks only after you have listened to the current preview in full."],
                ].map(([t, d]) => (
                  <li key={t} className="flex gap-4">
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-lime text-lime-ink">
                      <Check className="size-3.5" />
                    </span>
                    <div>
                      <p className="text-[16px] font-medium">{t}</p>
                      <p className="mt-1 text-[14.5px] leading-6 text-muted">{d}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/demo" className="btn-primary mt-7 w-full">
                Try it with your own words <ArrowRight />
              </Link>
            </div>
          </div>
        </section>

        {/* Trust */}
        <section id="trust" className="border-t border-line px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.3fr] lg:gap-20">
            <SectionHeading eyebrow="Trust and limits" title="What AfterSend will not do.">
              <p>A correction tool is only useful if you can trust its limits.</p>
            </SectionHeading>
            <ul className="grid gap-3 sm:grid-cols-2">
              {[
                ["Recall files", "Downloaded or forwarded audio stays as it is. Only the link updates."],
                ["Verify publishers", "AfterSend does not check who a publisher is. There are no verified badges."],
                ["Check facts", "Speech reads the approved text. Making sure it is correct is the publisher's job."],
                ["Publish on its own", "Every first announcement and every correction needs a person to approve it."],
                ["Clone voices", "Only stock synthetic narrator voices. Never a real person's voice."],
                ["Send messages", "AfterSend gives you a link. You decide where to share it."],
              ].map(([t, d]) => (
                <li key={t} className="rounded-xl border border-line bg-surface p-5">
                  <p className="text-[15.5px] font-medium text-fg">{t}</p>
                  <p className="mt-1.5 text-[14.5px] leading-[1.55] text-muted">{d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-line bg-ink-2 px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-3xl">
            <SectionHeading eyebrow="Questions" title="Plain answers." />
            <div className="mt-10 divide-y divide-line border-y border-line">
              {FAQ.map((f) => (
                <details key={f.q} className="group">
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
        <section className="px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-6xl rounded-[28px] bg-lime px-6 py-14 text-lime-ink sm:px-12 sm:py-20">
            <h2 className="max-w-3xl text-[clamp(2rem,5vw,3.75rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance">
              Write it once. Fix it any time. Keep the link.
            </h2>
            <p className="mt-5 max-w-xl text-[17px] leading-[1.55] text-lime-ink/80">
              Create a real announcement without signing in, hear it spoken, then change the pickup time and watch the same link play the correction.
            </p>
            <Link href="/demo" className="btn bg-lime-ink text-lime hover:opacity-90 mt-8 h-[52px] px-7 text-[16px]">
              Create an announcement <ArrowRight />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
