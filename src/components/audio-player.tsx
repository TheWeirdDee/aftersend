"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import { Pause, Play } from "./icons";

const RATES = [0.75, 1, 1.25, 1.5];
/** A request for the audio can be cut off (a dropped connection, a server restarting). The player asks again this many times before giving up. */
const MAX_AUTO_RELOADS = 3;
/** Share of the audio that must actually have played before it counts as listened to. */
export const LISTENED_COVERAGE = 0.9;

/** Fraction of the media that has been played, from the browser's own record of played ranges. */
function playedCoverage(a: HTMLAudioElement) {
  if (!Number.isFinite(a.duration) || a.duration <= 0) return 0;
  let seconds = 0;
  for (let i = 0; i < a.played.length; i++) seconds += a.played.end(i) - a.played.start(i);
  return Math.min(1, seconds / a.duration);
}

/**
 * Accessible audio control around a native <audio> element. Never autoplays. Progress and duration
 * come from the element itself, not from a timer. Callers key it by `src` so a new file starts fresh.
 */
export function AudioPlayer({
  src,
  label,
  durationHintMs,
  onListened,
  compact = false,
}: {
  src: string;
  label: string;
  durationHintMs?: number | null;
  onListened?: () => void;
  compact?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(durationHintMs ? durationHintMs / 1000 : null);
  const [rate, setRate] = useState(1);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [coverage, setCoverage] = useState(0);
  const reported = useRef(false);
  const reloads = useRef(0);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
  }, []);

  /** Requests the file again. The listened-to record is kept: only ranges that were really played ever count. */
  const reload = () => {
    const a = ref.current;
    if (!a) return;
    setState("loading");
    a.load();
  };

  const onMediaError = () => {
    setPlaying(false);
    if (reloads.current < MAX_AUTO_RELOADS) {
      reloads.current += 1;
      setState("loading");
      reloadTimer.current = setTimeout(reload, 400 * reloads.current);
    } else {
      setState("error");
    }
  };

  // Skipping ahead does not count: `played` only records ranges the browser actually played through.
  const checkCoverage = (a: HTMLAudioElement) => {
    const c = playedCoverage(a);
    setCoverage(c);
    if (c >= LISTENED_COVERAGE && !reported.current) {
      reported.current = true;
      onListened?.();
    }
  };

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate]);

  const toggle = async () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      try {
        setState("loading");
        await a.play();
        setState("idle");
      } catch (e) {
        // play() is rejected with AbortError when the element is reloaded or paused while starting; that is not a failure.
        if (e instanceof DOMException && e.name === "AbortError") setState("idle");
        else setState("error");
      }
    } else a.pause();
  };

  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className={`w-full ${compact ? "" : "rounded-xl border border-line bg-ink-2 p-3.5 sm:p-4"}`}>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          if (onListened) checkCoverage(e.currentTarget);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(e) => {
          setPlaying(false);
          if (onListened) checkCoverage(e.currentTarget);
        }}
        onWaiting={() => setState("loading")}
        onPlaying={() => {
          reloads.current = 0;
          setState("idle");
        }}
        onError={onMediaError}
      />
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={toggle}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-fg text-ink transition-transform hover:bg-white active:scale-95"
          aria-label={`${playing ? "Pause" : "Play"} ${label}`}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="relative h-5">
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-signal transition-[width] duration-150 ease-linear" style={{ width: `${pct}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={duration ?? 0}
              step={0.1}
              value={time}
              disabled={!duration}
              aria-label={`Seek ${label}`}
              aria-valuetext={`${formatDuration(time * 1000)} of ${formatDuration((duration ?? 0) * 1000)}`}
              onChange={(e) => {
                const a = ref.current;
                if (a) a.currentTime = Number(e.target.value);
                setTime(Number(e.target.value));
              }}
              className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-default"
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[11.5px] text-muted">
            <span aria-hidden>
              {formatDuration(time * 1000)} / {formatDuration(duration != null ? duration * 1000 : null)}
            </span>
            <label className="flex items-center gap-1.5">
              <span className="sr-only">Playback speed</span>
              <select
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11.5px] text-muted hover:text-fg"
              >
                {RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
      {onListened ? (
        <p className="mt-2 font-mono text-[11.5px] text-faint" data-testid="listen-progress">
          {coverage >= LISTENED_COVERAGE ? "Listened to the whole preview" : `Listened to ${Math.floor(coverage * 100)}%: play it through to approve`}
        </p>
      ) : null}
      <div role="status" aria-live="polite" className={state === "error" ? "mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-danger" : "sr-only"}>
        {state === "error" ? (
          <>
            <span>This audio could not be loaded.</span>
            <button
              type="button"
              className="text-fg underline underline-offset-4"
              onClick={() => {
                reloads.current = 0;
                reload();
              }}
            >
              Try again
            </button>
          </>
        ) : state === "loading" ? (
          "Loading audio"
        ) : (
          ""
        )}
      </div>
    </div>
  );
}
