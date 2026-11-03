"use client";

import { useEffect, useState } from "react";
import { Check, Link as LinkIcon, Play } from "../icons";

/**
 * An illustration of the product's one idea: change a detail, the voice is prepared again, and the link that was
 * already shared now plays the correction. It runs entirely in the browser, plays no audio and calls no API; the real
 * thing is one click away ("Try it with your own words").
 *
 * phase 0  published at 3 PM
 *       1  edited: the voice is out of date
 *       2  updating the voice
 *       3  new voice ready to listen
 *       4  update approved: same link, new announcement
 */
type Phase = 0 | 1 | 2 | 3 | 4;

const LINK = "aftersend.app/n/7Vq2KpXoR1sT";

export function CorrectionDemo() {
  const [phase, setPhase] = useState<Phase>(0);

  useEffect(() => {
    if (phase === 1) {
      const t = setTimeout(() => setPhase(2), 900);
      return () => clearTimeout(t);
    }
    if (phase === 2) {
      const t = setTimeout(() => setPhase(3), 1500);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const edited = phase >= 1;
  const live = phase === 4 ? "4:00 PM" : "3:00 PM";
  const statusText = ["Published", "Voice out of date", "Updating voice…", "Ready to listen", "Published"][phase]!;

  const action =
    phase === 0
      ? { label: "Change the time to 4 PM", disabled: false, onClick: () => setPhase(1) }
      : phase === 1 || phase === 2
        ? { label: "Preparing the new voice…", disabled: true, onClick: () => {} }
        : phase === 3
          ? { label: "Update announcement", disabled: false, onClick: () => setPhase(4) }
          : { label: "Start over", disabled: false, onClick: () => setPhase(0) };

  return (
    <div className="rounded-3xl border border-line bg-surface-2 p-3 sm:p-5" data-testid="correction-demo">
      <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr] lg:gap-5">
        {/* The publisher's side */}
        <section aria-labelledby="demo-publisher" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 id="demo-publisher" className="eyebrow">
              You write
            </h3>
            <span
              role="status"
              className={`pill ${phase === 3 || phase === 4 ? "border-signal/40 text-signal" : phase === 2 ? "border-line-strong text-fg" : phase === 1 ? "border-warn/50 text-warn" : "border-line-strong text-muted"}`}
            >
              {phase === 2 ? <Bars /> : <span className="size-1.5 rounded-full bg-current" aria-hidden />}
              {statusText}
            </span>
          </div>
          <p className="mt-5 font-display text-[22px] leading-tight font-semibold tracking-[-0.03em] sm:text-[26px]">Early pickup on Friday</p>
          <div className="mt-4 space-y-3 text-[16px] leading-[1.6] text-muted">
            <p>Classes end early on Friday for a staff training day.</p>
            <p>
              Pickup is at{" "}
              <span
                className={`rounded-md px-1.5 py-0.5 font-medium transition-colors duration-500 ${edited ? "bg-lime text-lime-ink" : "bg-surface-3 text-fg"}`}
                data-testid="demo-time"
              >
                {edited ? "4:00 PM" : "3:00 PM"}
              </span>{" "}
              at the main gate.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={action.onClick} disabled={action.disabled} className={`${phase === 3 ? "btn-accent" : "btn-primary"} w-full sm:w-auto`}>
              {phase === 3 ? <Check className="size-4" /> : null}
              {action.label}
            </button>
            <p className="text-[13px] leading-5 text-faint">
              {phase === 0 ? "Published. Everyone with the link hears 3 PM." : phase === 4 ? "Everyone with the link now hears 4 PM." : "The old announcement stays live until you approve."}
            </p>
          </div>
        </section>

        {/* The listener's side */}
        <section aria-labelledby="demo-listener" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 id="demo-listener" className="eyebrow">
              Parents hear
            </h3>
            <span className="pill border-line-strong text-muted">Same link</span>
          </div>
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-ink-2 px-3 py-2 text-[13px] text-muted" data-testid="demo-link">
            <LinkIcon className="size-3.5 shrink-0" /> <span className="truncate">{LINK}</span>
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <p className="font-display text-[19px] font-semibold tracking-[-0.025em]">Early pickup on Friday</p>
            {phase === 4 ? <span className="pill border-signal/40 text-signal">Corrected just now</span> : null}
          </div>
          <p className="mt-3 text-[15.5px] leading-[1.6] text-muted" data-testid="demo-listener-text">
            Classes end early on Friday for a staff training day. Pickup is at{" "}
            <span className={phase === 4 ? "mark-lime font-medium" : "font-medium text-fg"}>{live}</span> at the main gate.
          </p>
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-line bg-ink-2 p-3" aria-hidden="true">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-fg text-ink">
              <Play className="size-3.5 translate-x-px" />
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full w-1/3 rounded-full bg-signal" />
            </div>
            <span className="text-[12px] text-faint tabular-nums">0:00 / 0:14</span>
          </div>
        </section>
      </div>
      <p className="mt-3 px-1 text-[12.5px] leading-5 text-faint sm:mt-4">
        An illustration: nothing here is spoken or sent. Try it with real speech and your own words.
      </p>
    </div>
  );
}

function Bars() {
  return (
    <span className="inline-flex h-3 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="w-[3px] origin-bottom rounded-full bg-current" style={{ height: "100%", animation: `bars 0.9s ease-in-out ${i * 0.12}s infinite` }} />
      ))}
    </span>
  );
}
