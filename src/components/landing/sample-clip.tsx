"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "../icons";

// Only one clip plays at a time, so pressing the second one never talks over the first.
let playing: HTMLAudioElement | null = null;

/**
 * A play button for one of the two recordings made with AssemblyAI speech (public/samples, see scripts/make-sample-audio.ts).
 * The file is only fetched when someone presses play, and never plays by itself.
 */
export function SampleClip({ src, label, seconds }: { src: string; label: string; seconds: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = audio.current;
    return () => {
      el?.pause();
      if (playing === el) playing = null;
    };
  }, []);

  const toggle = async () => {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    if (playing && playing !== el) playing.pause();
    playing = el;
    setFailed(false);
    try {
      await el.play();
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        aria-label={on ? `Pause: ${label}` : `Play: ${label}`}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-fg text-ink transition-opacity hover:opacity-85"
      >
        {on ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-5 font-medium text-fg">{label}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className="h-full rounded-full bg-signal" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="text-[12px] text-faint tabular-nums">0:{String(seconds).padStart(2, "0")}</span>
        </div>
        {failed ? (
          <p role="status" className="mt-1 text-[12px] text-danger">
            This browser could not play the clip. The text is above.
          </p>
        ) : null}
      </div>
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setOn(true)}
        onPause={() => setOn(false)}
        onEnded={() => {
          setOn(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration) setProgress(a.currentTime / a.duration);
        }}
        onError={() => {
          setOn(false);
          setFailed(true);
        }}
      />
    </div>
  );
}
