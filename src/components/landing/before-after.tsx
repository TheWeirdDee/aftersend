import { Link as LinkIcon } from "../icons";
import { SampleClip } from "./sample-clip";

/**
 * The product in one picture: the same link, before and after the pickup time changed from 3 PM to 4 PM, with a recording
 * of each. The two clips are real AssemblyAI speech (public/samples, recorded by scripts/make-sample-audio.ts), not a
 * simulation; the card itself is an illustration of how one shared link keeps working.
 */
export function BeforeAfter({ beforeSeconds, afterSeconds }: { beforeSeconds: number; afterSeconds: number }) {
  return (
    <figure className="rounded-3xl border border-line bg-surface p-4 shadow-[0_1px_0_0_var(--color-line)] sm:p-6" data-testid="before-after">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-ink-2 px-3 py-2 text-[13px] text-muted" data-testid="hero-link">
          <LinkIcon className="size-3.5 shrink-0" />
          <span className="truncate">aftersend.app/n/7Vq2KpXoR1sT</span>
        </span>
        <span className="pill shrink-0 border-signal/40 text-signal">Same link</span>
      </figcaption>

      <ol className="mt-5 space-y-5">
        <li>
          <p className="eyebrow">First version</p>
          <p className="mt-2 text-[17px] leading-[1.5] text-muted">
            Pickup is at <s className="text-removed decoration-removed/70">3:00 PM</s> at the main gate.
          </p>
          <div className="mt-3">
            <SampleClip src="/samples/pickup-3pm.wav" label="Hear the 3:00 PM announcement" seconds={beforeSeconds} />
          </div>
        </li>
        <li className="border-t border-line pt-5">
          <p className="eyebrow flex items-center gap-2">
            After the correction <span className="pill border-signal/40 text-signal normal-case tracking-normal">Corrected</span>
          </p>
          <p className="mt-2 text-[17px] leading-[1.5] text-fg">
            Pickup is at <span className="font-semibold text-fg">4:00 PM</span> at the main gate.
          </p>
          <div className="mt-3">
            <SampleClip src="/samples/pickup-4pm.wav" label="Hear the corrected 4:00 PM announcement" seconds={afterSeconds} />
          </div>
        </li>
      </ol>

      <p className="mt-5 text-[12.5px] leading-5 text-faint">
        Both recordings are real speech from AssemblyAI. The link did not change: whoever opens it next hears the corrected announcement.
      </p>
    </figure>
  );
}
