import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage, InfoSection } from "@/components/landing/info-page";

export const metadata: Metadata = {
  title: "Corrections",
  description: "Correct a school announcement at the same link, and understand exactly what a correction can and cannot reach.",
};

export default function CorrectionsPage() {
  return (
    <InfoPage
      eyebrow="Corrections"
      title="Change the message, not the link."
      lede="One link can outlast every version of a notice. When pickup moves from 3:00 PM to 4:00 PM, publish the correction at the link families already have instead of sending a second address they have to notice and keep."
    >
      <InfoSection id="how" title="How a correction works">
        <p>
          Open the published announcement and press <strong className="font-medium text-fg">Update this announcement</strong>. Edit the text, add an optional
          spoken correction note if you want the new recording to begin with it, and listen to the whole new preview.
        </p>
        <p>
          Until you approve it, the link keeps playing the previous version. Nothing is rewritten and nothing is published automatically. After you approve
          the update, the same URL serves the corrected text and its own recording together, so a listener never hears old audio beside new words.
        </p>
      </InfoSection>

      <InfoSection id="listeners" title="What listeners notice">
        <p>
          The page is marked as corrected and shows when it was last updated. The written announcement and the audio are both the current approved version.
        </p>
        <p>
          Someone who already has the page open is asked to reload rather than having the audio swapped mid-sentence. Anyone who opens the link afterwards gets
          the correction straight away. The address in the browser does not change.
        </p>
      </InfoSection>

      <InfoSection id="limits" title="What a correction cannot reach">
        <p>
          A downloaded audio file is a copy. It never updates, and neither AfterSend nor the publisher can recall it. The same is true of a screenshot, a
          forwarded message or a recording made from a speaker.
        </p>
        <p>
          This is why the link matters: share the link, not the file. A notice that is already circulating cannot be taken back, but the authoritative page can
          be kept current and readers can be pointed to it.
        </p>
      </InfoSection>

      <InfoSection id="failure" title="If the new voice cannot be prepared">
        <p>
          The previous approved announcement stays live with its original text and audio. A failed, unfinished or unapproved preview can never replace what
          listeners already have. The editor keeps the draft, explains that the voice could not be prepared and offers to try again.
        </p>
      </InfoSection>

      <InfoSection id="more" title="More detail">
        <p>
          The <Link href="/docs" className="text-fg underline underline-offset-4">docs</Link> walk through publishing from a guest workspace. The{" "}
          <Link href="/trust" className="text-fg underline underline-offset-4">trust page</Link> lists what AfterSend verifies, what it stores and where its
          guarantees stop.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
