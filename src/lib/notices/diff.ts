import { diffArrays } from "diff";
import { detectCriticalFacts, type CriticalFact } from "./facts";

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

const tokens = (s: string) => s.split(/(\s+)/).filter(Boolean);

/** Whitespace-delimited diff so values like "3:00" or "0803" change as whole tokens. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const parts: DiffPart[] = [];
  for (const p of diffArrays(tokens(before), tokens(after))) {
    const kind = p.added ? "added" : p.removed ? "removed" : "same";
    const text = p.value.join("");
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  }
  return parts;
}

export type FactChange = { kind: CriticalFact["kind"]; previousValue: string | null; currentValue: string | null };

/** Pairs critical facts by kind and order so "3:00 PM" → "4:00 PM" is reported as a time change. */
export function factChanges(before: string, after: string): FactChange[] {
  const a = detectCriticalFacts(before);
  const b = detectCriticalFacts(after);
  const changes: FactChange[] = [];
  for (const kind of ["time", "date", "phone"] as const) {
    const av = a.filter((f) => f.kind === kind).map((f) => f.value);
    const bv = b.filter((f) => f.kind === kind).map((f) => f.value);
    const n = Math.max(av.length, bv.length);
    for (let i = 0; i < n; i++) {
      const prev = av[i] ?? null;
      const cur = bv[i] ?? null;
      if (norm(prev) !== norm(cur)) changes.push({ kind, previousValue: prev, currentValue: cur });
    }
  }
  return changes;
}

const norm = (v: string | null) => v?.toLowerCase().replace(/[\s.]/g, "") ?? null;

/** Suggests a short preface from the sentence that contains a changed value. The publisher must accept it. */
export function suggestUpdatePreface(after: string, changes: FactChange[]): string | null {
  const first = changes.find((c) => c.currentValue);
  if (!first?.currentValue) return null;
  const sentences = after.split(/(?<=[.!?])\s+/);
  const sentence = sentences.find((s) => s.includes(first.currentValue!));
  if (!sentence) return null;
  return `Update: ${sentence.trim().replace(/[.!?]$/, "")}.`;
}
