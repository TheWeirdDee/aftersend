"use client";

import { useMemo } from "react";
import { detectCriticalFacts, type FactKind } from "@/lib/notices/facts";
import { Alert } from "../icons";

const LABEL: Record<FactKind, string> = { time: "Time", date: "Date", phone: "Phone" };

/** Highlights values that change what a listener does. Detection is a prompt to check, not a check. */
export function FactsPanel({ text, changedValues = [] }: { text: string; changedValues?: string[] }) {
  const facts = useMemo(() => detectCriticalFacts(text), [text]);
  const ambiguous = facts.filter((f) => f.ambiguous);
  return (
    <section aria-labelledby="facts-heading" className="rounded-xl border border-line bg-ink-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="facts-heading" className="text-[13px] font-medium tracking-wide text-muted uppercase">
          Critical facts
        </h3>
        <span className="text-[12px] text-faint">Detected automatically. Check them yourself.</span>
      </div>
      {facts.length === 0 ? (
        <p className="mt-3 text-[14px] leading-6 text-muted">
          No dates, times or phone numbers detected. Review the notice manually for places and instructions.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {facts.map((f, i) => {
            const changed = changedValues.includes(f.value);
            return (
              <li
                key={`${f.index}-${i}`}
                className={`pill py-1 text-[13px] ${
                  f.ambiguous ? "border-danger/50 text-danger" : changed ? "border-signal/50 bg-signal/10 text-signal" : "border-line-strong text-fg"
                }`}
              >
                <span className="text-faint">{LABEL[f.kind]}</span> {f.value}
                {changed ? <span className="sr-only">(changed)</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      {ambiguous.length > 0 ? (
        <div role="alert" className="mt-3 flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-[13.5px] leading-5 text-fg">
          <Alert className="mt-0.5 size-4 shrink-0 text-danger" />
          <p>
            “{ambiguous[0]!.value}” is ambiguous. {ambiguous[0]!.note} Audio can&apos;t be generated until it is resolved.
          </p>
        </div>
      ) : null}
    </section>
  );
}
