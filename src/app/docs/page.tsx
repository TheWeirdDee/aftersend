import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage, InfoSection } from "@/components/landing/info-page";

export const metadata: Metadata = {
  title: "Docs",
  description: "How to write, hear, publish, share, correct and withdraw an AfterSend announcement.",
};

const STEPS = [
  {
    title: "Write the announcement",
    body: "Press Create an announcement and type the notice as you would send it. You do not need an account. Dates, times, places and phone numbers are picked out so you can check them before anyone hears the recording.",
  },
  {
    title: "Listen to the whole preview",
    body: "The spoken version is prepared automatically when you pause. Press play and listen to the end. The confirmation box and Publish stay locked until the recording has actually played through; skipping ahead does not count.",
  },
  {
    title: "Publish and share the link",
    body: "Publishing gives you one stable link. Copy link, Open listener page and Share are on the confirmation screen. Publishing does not send messages: you decide where to share the link with families.",
  },
  {
    title: "Correct the notice later",
    body: "Open the published announcement, update the words, listen to the new preview and approve it. The same link then plays the corrected version for everyone who opens it next.",
  },
];

export default function DocsPage() {
  return (
    <InfoPage
      eyebrow="Documentation"
      title="Everything you need to send one link."
      lede="AfterSend turns a written school notice into speech behind one stable link. This page covers the whole journey: writing, hearing the preview, publishing, sharing with families, correcting a detail and withdrawing a notice."
    >
      <InfoSection id="start" title="Start here">
        <p>
          You can try the complete workflow without signing in. A guest workspace keeps your announcements in this browser for up to 30 days and can be
          saved to an email address at any time.
        </p>
        <ol className="space-y-6">
          {STEPS.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span className="font-display text-[20px] leading-7 font-semibold text-fg tabular-nums">{index + 1}</span>
              <div>
                <h3 className="text-[16.5px] leading-7 font-semibold text-fg">{step.title}</h3>
                <p className="mt-1 text-[16px] leading-[1.65]">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </InfoSection>

      <InfoSection id="families" title="What families see">
        <p>
          A listener opens the link in any browser. There is no sign-in, no app and no autoplay. The written announcement is always shown in full beside a play
          button, so the notice still works when sound is unavailable or unwanted.
        </p>
        <p>
          When an announcement has been corrected, the page says so, shows when it was last updated and offers the audio for the approved version. A page that
          was already open is asked to reload; it never swaps the recording in the middle of playback.
        </p>
        <p>
          Listener pages are not indexed by search engines and carry no verified badge. They state that AfterSend hosts what a publisher approved and does not
          verify the publisher or the facts.
        </p>
      </InfoSection>

      <InfoSection id="accounts" title="Guests and accounts">
        <p>
          A guest session is a cookie in one browser. Clearing that cookie, switching browsers or waiting past the 30-day window ends the session, and after a
          while the links stop working. Choose <strong className="font-medium text-fg">Save your account</strong> and verify an email address to keep the
          announcements and reach them from another device.
        </p>
        <p>
          Sign-in uses a six-digit code sent by email. There is no password. A code works once, expires after 10 minutes and can be tried a limited number of
          times. Published listener links never depend on the publisher being signed in.
        </p>
      </InfoSection>

      <InfoSection id="withdraw" title="Withdrawing a notice">
        <p>
          Withdrawing immediately stops the listener page from serving the announcement and its audio, and replaces it with an explicit withdrawal message.
          It cannot recall a copy that someone downloaded or forwarded earlier. The same limit applies to a correction: the link updates, downloaded files do
          not.
        </p>
        <p>
          Read <Link href="/corrections" className="text-fg underline underline-offset-4">how corrections work</Link> and{" "}
          <Link href="/trust" className="text-fg underline underline-offset-4">what AfterSend will not claim</Link>.
        </p>
      </InfoSection>

      <InfoSection id="help" title="If something goes wrong">
        <p>
          Your written notice is saved as you type. If the spoken preview fails, the previous approved version stays live and the editor offers to try the voice
          again. If publishing fails, the draft is kept and you can retry without retyping anything.
        </p>
        <p>
          If a browser cannot open the audio output, the player reloads and tries again, then offers Try again. The written announcement remains available
          throughout.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
