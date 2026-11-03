import { SiteHeader } from "@/components/landing/site-header";
import { BeforeAfter } from "@/components/landing/before-after";
import { CorrectionDemo } from "@/components/landing/correction-demo";
import { SiteFooter } from "@/components/site-footer";
import { CreateAnnouncementButton } from "@/components/app/create-button";
import samples from "../../public/samples/manifest.json";

const seconds = (file: string) => Math.round((samples.clips.find((c) => c.file === file)?.durationMs ?? 8000) / 1000);

/**
 * The one public homepage, read top to bottom: what it is, why it exists, the correction, how to use it, what it will not
 * do, questions. Every section sits in the same two-column grid (a heading, then its content), and every "Create an
 * announcement" on the site is the same button. It reads the same for a first-time visitor, a returning guest and a signed-in
 * account; only where the button leads differs (see CreateAnnouncementButton).
 */
function Section({ id, eyebrow, title, children, tint = false }: { id: string; eyebrow: string; title: React.ReactNode; children: React.ReactNode; tint?: boolean }) {
  return (
    <section id={id} className={`border-t border-line px-4 py-16 sm:px-6 sm:py-24 ${tint ? "bg-ink-2" : ""}`}>
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-3 text-[clamp(1.8rem,3.6vw,2.7rem)] leading-[1.06] font-semibold tracking-[-0.04em] text-balance">{title}</h2>
        </div>
        <div className="min-w-0 text-[17px] leading-[1.65] text-muted text-pretty">{children}</div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: "Write it",
    body: "Type or paste the announcement. Dates, times and phone numbers are picked out so you can check each one before anyone hears it.",
  },
  {
    title: "Hear it",
    body: "AssemblyAI's text-to-speech prepares the spoken version when you stop typing, and again after every edit. You pick a synthetic voice. Nothing is public yet.",
  },
  {
    title: "Share one link",
    body: "Listen to the whole preview, publish, and share the link wherever families already are. That link stays the same for good.",
  },
];

const LIMITS = [
  ["Recall files", "Downloaded or forwarded audio stays as it is. Only the link updates."],
  ["Verify publishers", "AfterSend does not check who a publisher is. There are no verified badges."],
  ["Check facts", "Speech reads the approved text. Making sure it is correct is the publisher's job."],
  ["Publish on its own", "Every first announcement and every correction needs a person to approve it."],
  ["Clone voices", "Only stock synthetic narrator voices. Never a real person's voice."],
  ["Send messages", "AfterSend gives you a link. You decide where to share it."],
];

const FAQ = [
  {
    q: "Does audio that people already downloaded change?",
    a: "No. A downloaded or forwarded audio file can never change. Only the AfterSend link updates, so share the link instead of the file.",
  },
  {
    q: "What does someone see if they already have the page open?",
    a: "The page notices the correction within about half a minute and asks them to reload. It never swaps the audio while they are listening. Anyone who opens the link afterwards gets the corrected announcement straight away.",
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
    a: "No. You can write, hear and publish a real announcement as a guest. Guest announcements are tied to your browser for up to 30 days, so save your account with an email address before you rely on the link.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* Hero */}
        <section id="top" className="px-4 pt-10 pb-16 sm:px-6 sm:pt-16 sm:pb-24">
          <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
            <div>
              <p className="eyebrow">Spoken announcements for schools</p>
              <h1 className="mt-4 text-[clamp(2.3rem,5.4vw,4.4rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance">
                One announcement link, even when <span className="mark-lime">pickup time changes.</span>
              </h1>
              <p className="mt-6 max-w-xl text-[18px] leading-[1.55] text-muted sm:text-[19px]">
                AfterSend helps school staff turn a notice into audio, share it with families, and update the same link when details change.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <CreateAnnouncementButton className="btn-accent h-[52px] px-7 text-[16px]" arrow />
                <a href="#how" className="btn-secondary h-[52px] px-7 text-[16px]">
                  See how it works
                </a>
              </div>
              <p className="mt-4 text-[14px] text-faint">No account needed to try it. Speech by AssemblyAI.</p>
            </div>
            <BeforeAfter beforeSeconds={seconds("pickup-3pm.wav")} afterSeconds={seconds("pickup-4pm.wav")} />
          </div>
        </section>

        <Section id="problem" eyebrow="The problem" title="A forwarded voice note can't take it back.">
          <p>
            Schools send notices into parent group chats. When a time changes, the correction travels slower than the original, and an audio file
            that is already on someone&apos;s phone can never be updated.
          </p>
          <ul className="mt-6 space-y-3 text-[16px] leading-6">
            {["Record it again and send it again.", "The old recording keeps getting forwarded.", "Nobody can tell which version is current."].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-removed" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
          <figure className="mt-8 border-l-2 border-line-strong pl-5">
            <blockquote className="text-[16px] leading-[1.6] text-fg">
              In May 2026, Lagos State&apos;s Office of Education Quality Assurance publicly told schools to disregard a circulating message claiming
              students would be dismissed early the next day.
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
              . A real example of why corrections matter. It does not show that audio would have prevented it, and AfterSend is not affiliated with
              OEQA.
            </figcaption>
          </figure>
        </Section>

        <Section id="correct" eyebrow="The fix" title="Fix the words. The link keeps working." tint>
          <p>
            Edit the announcement and the new spoken version is prepared for you. Until you approve it, the link keeps playing the previous version.
            Once you do, the same link opens the corrected announcement for anyone who opens it next, with the full text beside the audio.
          </p>
          <p className="mt-4">
            People who already have the page open are asked to reload it, so the audio never changes while they listen. Each version keeps its own text
            and audio, so a page never pairs old audio with new words.
          </p>
          <div className="mt-8">
            <CorrectionDemo />
          </div>
        </Section>

        <Section id="how" eyebrow="How it works" title="Write, listen, share.">
          <ol className="divide-y divide-line border-y border-line">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2.25rem_1fr] gap-x-4 py-6 sm:grid-cols-[2.75rem_1fr]">
                <span className="font-display text-[22px] leading-7 font-semibold text-fg tabular-nums">{i + 1}</span>
                <div>
                  <h3 className="text-[20px] leading-7 font-semibold tracking-[-0.025em] text-fg">{s.title}</h3>
                  <p className="mt-1.5 text-[16px] leading-[1.6]">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="trust" eyebrow="Trust and limits" title="What AfterSend will not do." tint>
          <p>A correction tool is only useful if you can trust its limits.</p>
          <dl className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {LIMITS.map(([t, d]) => (
              <div key={t} className="border-t border-line pt-4">
                <dt className="text-[16px] font-medium text-fg">{t}</dt>
                <dd className="mt-1.5 text-[15px] leading-[1.55]">{d}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="faq" eyebrow="FAQ" title="Plain answers.">
          <div className="divide-y divide-line border-y border-line">
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
                <p className="pb-6 text-[15.5px] leading-[1.65]">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <section id="start" className="border-t border-line px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <h2 className="text-[clamp(1.8rem,3.6vw,2.7rem)] leading-[1.06] font-semibold tracking-[-0.04em] text-balance">
              Write it once. Fix it any time. <span className="mark-lime">Keep the link.</span>
            </h2>
            <div>
              <p className="max-w-xl text-[17px] leading-[1.6] text-muted">
                Create a real announcement without signing in, hear it spoken, then change the pickup time and watch the same link play the correction.
              </p>
              <div className="mt-6">
                <CreateAnnouncementButton className="btn-accent h-[52px] px-7 text-[16px]" arrow />
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
