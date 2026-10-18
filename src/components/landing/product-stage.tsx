"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Check, Link as LinkIcon, Play } from "../icons";
import { LogoMark } from "../logo";

type V = 1 | 2;
const URL_PATH = "/n/7Vq2KpXoR1sT-3mB9aLw";
const TIMES: Record<V, string> = { 1: "3:00 PM", 2: "4:00 PM" };
const STAMP: Record<V, string> = { 1: "Published 18 Oct 2026 · 2:05 PM WAT", 2: "Updated 18 Oct 2026 · 4:10 PM WAT" };

function Swap({ v, children, className = "" }: { v: V; children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={`relative inline-grid ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={v}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: "60%", filter: "blur(2px)" }}
          animate={{ opacity: 1, y: "0%", filter: "blur(0px)" }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: "-60%", filter: "blur(2px)" }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="col-start-1 row-start-1"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Chrome({ path, children, className = "" }: { path: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-3 border-b border-line bg-ink-2 px-3 py-2 ${className}`}>
      <span className="flex gap-1.5" aria-hidden>
        <i className="size-2.5 rounded-full bg-[#3a3f3b]" />
        <i className="size-2.5 rounded-full bg-[#3a3f3b]" />
        <i className="size-2.5 rounded-full bg-[#3a3f3b]" />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-surface px-2.5 py-1 font-mono text-[11px] text-muted">
        <LinkIcon className="size-3 shrink-0" />
        <span className="truncate">{path}</span>
      </span>
      {children}
    </div>
  );
}

function FakeProgress({ v }: { v: V }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fg text-ink">
        <Play className="size-3.5 translate-x-px" />
      </span>
      <div className="flex-1">
        <div className="h-1 overflow-hidden rounded-full bg-line">
          <motion.div
            key={v}
            className="h-full rounded-full bg-signal"
            initial={{ width: "0%" }}
            animate={{ width: v === 2 ? "38%" : "0%" }}
            transition={{ duration: 1.2, ease: "easeOut", delay: 0.4 }}
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-faint">
          <span>0:00</span>
          <span>0:24</span>
        </div>
      </div>
    </div>
  );
}

function Editor({ v }: { v: V }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
      <Chrome path="/app/notices/ntc_4f…/edit" />
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <LogoMark className="size-4" />
          <span className="text-[12px] font-medium">Sample School Schedule Notice</span>
          <span className="pill border-warn/40 text-[10px] text-warn">Demo data</span>
        </div>
        <span className="hidden font-mono text-[10px] text-faint sm:inline">Saved</span>
      </div>
      <div className="grid gap-0 sm:grid-cols-[1.15fr_1fr]">
        <div className="space-y-3 border-line p-4 text-[12.5px] leading-[1.6] text-muted sm:border-r">
          <p className="eyebrow text-[10px]">Notice text</p>
          <p>Dear parents and guardians,</p>
          <p>Classes will end early on Friday, 24 October 2026, for a staff training day.</p>
          <p className="text-fg">
            Pickup is at{" "}
            {v === 1 ? (
              <span className="rounded bg-surface-3 px-1 font-medium text-fg">3:00 PM</span>
            ) : (
              <>
                <del className="rounded bg-removed/15 px-1 text-removed decoration-removed/70">3:00 PM</del>{" "}
                <ins className="rounded bg-signal/15 px-1 font-medium text-signal no-underline">4:00 PM</ins>
              </>
            )}{" "}
            at the main gate.
          </p>
          <div className="rounded-lg border border-line bg-ink-2 p-2.5">
            <p className="mb-1.5 text-[10px] font-medium tracking-wide text-faint uppercase">Critical facts</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="pill border-line-strong text-[10px] text-muted">Fri, 24 October 2026</span>
              <span className={`pill text-[10px] ${v === 2 ? "border-signal/50 text-signal" : "border-line-strong text-muted"}`}>
                <Swap v={v}>{TIMES[v]}</Swap>
              </span>
            </div>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <p className="eyebrow text-[10px]">Spoken output</p>
          <div className="rounded-lg border border-line bg-ink-2 p-3">
            <div className="mb-2.5 flex items-center justify-between text-[11px]">
              <span className="text-muted">
                Revision <Swap v={v}>{v}</Swap>
              </span>
              <span className="pill border-signal/40 text-[10px] text-signal">
                <Swap v={v}>{v === 1 ? "Published" : "Ready to approve"}</Swap>
              </span>
            </div>
            <FakeProgress v={v} />
          </div>
          <label className="flex items-start gap-2 text-[11px] leading-4 text-muted">
            <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-[4px] bg-signal text-signal-ink">
              <Check className="size-2.5" />
            </span>
            I listened and the date, time and place are correct.
          </label>
          <div className="flex gap-2">
            <span className="btn-secondary btn-sm pointer-events-none min-h-8 flex-1 px-3 text-[12px]">Regenerate</span>
            <span className="btn-primary btn-sm pointer-events-none min-h-8 flex-1 px-3 text-[12px]">
              <Swap v={v}>{v === 1 ? "Published" : "Approve update"}</Swap>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Listener({ v, pulse }: { v: V; pulse: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-ink-2 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)]">
      <Chrome path={URL_PATH}>
        <motion.span
          key={pulse}
          initial={{ scale: 0.9, opacity: 0.4 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="pill hidden border-signal/40 text-[10px] text-signal sm:inline-flex"
        >
          <Check className="size-3" /> Same link
        </motion.span>
      </Chrome>
      <div className="space-y-3.5 p-4">
        <div>
          <p className="eyebrow text-[10px]">Current notice</p>
          <p className="mt-1.5 text-[15px] leading-tight font-semibold tracking-[-0.02em]">Sample School Schedule Notice</p>
          <p className="mt-1 font-mono text-[10.5px] text-muted">
            <Swap v={v}>{STAMP[v]}</Swap>
          </p>
        </div>
        <AnimatePresence initial={false}>
          {v === 2 && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <span className="block rounded-lg border border-signal/30 bg-signal/[0.07] px-3 py-2 text-[11.5px] leading-snug text-fg">
                This notice was revised. Pickup is now at 4:00 PM.
              </span>
            </motion.p>
          )}
        </AnimatePresence>
        <div className="rounded-lg border border-line bg-surface p-3">
          <FakeProgress v={v} />
        </div>
        <p className="text-[12px] leading-[1.6] text-muted">
          Classes will end early on Friday, 24 October 2026. Pickup is at{" "}
          <Swap v={v} className="font-medium text-fg">
            {TIMES[v]}
          </Swap>{" "}
          at the main gate.
        </p>
      </div>
    </div>
  );
}

export function ProductStage() {
  const [v, setV] = useState<V>(1);
  const [pulse, setPulse] = useState(0);
  const touched = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const choose = (next: V, fromUser = true) => {
    if (fromUser) touched.current = true;
    setV(next);
    setPulse((p) => p + 1);
  };

  // Plays the correction once when the stage is first seen; viewers can switch versions themselves.
  useEffect(() => {
    if (reduce || !root.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !touched.current) {
          timer = setTimeout(() => !touched.current && choose(2, false), 2200);
          io.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    io.observe(root.current);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [reduce]);

  return (
    <div ref={root} className="relative">
      <div className="mb-5 flex flex-col items-center gap-3">
        <div role="radiogroup" aria-label="Notice version" className="inline-flex rounded-full border border-line-strong bg-ink-2 p-1">
          {([1, 2] as V[]).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={v === n}
              onClick={() => choose(n)}
              className={`relative min-h-10 rounded-full px-4 text-[13.5px] font-medium transition-colors ${
                v === n ? "text-ink" : "text-muted hover:text-fg"
              }`}
            >
              {v === n && (
                <motion.span
                  layoutId="version-pill"
                  className="absolute inset-0 rounded-full bg-fg"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <span className="relative">
                Version {n} · {TIMES[n]}
              </span>
            </button>
          ))}
        </div>
        <p className="flex items-center gap-2 font-mono text-[12px] text-muted" aria-live="polite">
          <LinkIcon className="size-3.5" /> {URL_PATH}
          <span className="text-signal">· unchanged</span>
        </p>
      </div>

      <div data-stage className="relative mx-auto max-w-6xl">
        <div className="rounded-[22px] border border-line bg-gradient-to-b from-surface-2 to-ink-2 p-2 shadow-[0_60px_160px_-40px_rgba(212,243,107,0.10)] sm:p-3">
          <div className="flex items-center justify-between rounded-t-[14px] px-3 pt-1 pb-2.5 font-mono text-[10.5px] text-faint">
            <span className="flex items-center gap-2">
              <LogoMark className="size-3.5" /> AfterSend
            </span>
            <span>Sat 18 Oct · 4:10 PM</span>
          </div>
          <div className="relative grid gap-3 rounded-[14px] bg-[radial-gradient(120%_120%_at_50%_0%,#1a211c_0%,#0d100e_70%)] p-3 sm:p-6 lg:block lg:min-h-[470px] lg:p-8">
            <div data-window="editor" className="lg:w-[63%]">
              <Editor v={v} />
            </div>
            <div data-window="listener" className="lg:absolute lg:top-[96px] lg:right-8 lg:w-[37%]">
              <Listener v={v} pulse={pulse} />
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-[12.5px] text-faint">
          Interface illustration. The <a className="underline underline-offset-4 hover:text-fg" href="/demo">live demo</a> runs
          the real workflow.
        </p>
      </div>
    </div>
  );
}
