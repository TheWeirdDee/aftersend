"use client";

import { useMemo } from "react";
import { wordDiff } from "@/lib/notices/diff";

export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => wordDiff(before, after), [before, after]);
  const changed = parts.some((p) => p.kind !== "same");
  if (!changed) return <p className="text-[14px] text-muted">No changes from the published version yet.</p>;
  return (
    <p className="text-[15px] leading-[1.75] whitespace-pre-wrap text-muted">
      {parts.map((p, i) =>
        p.kind === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "removed" ? (
          <del key={i} className="rounded bg-removed/15 px-0.5 text-removed decoration-removed/70">
            <span className="sr-only">Removed: </span>
            {p.text}
          </del>
        ) : (
          <ins key={i} className="rounded bg-signal/15 px-0.5 font-medium text-signal no-underline">
            <span className="sr-only">Added: </span>
            {p.text}
          </ins>
        ),
      )}
    </p>
  );
}
