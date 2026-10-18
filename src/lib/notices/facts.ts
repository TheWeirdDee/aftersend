/**
 * Conservative, deterministic detection of facts that change what a listener does: times, dates and
 * phone numbers. Detection only highlights values for a human to check; it never edits text.
 */

export type FactKind = "time" | "date" | "phone";

export type CriticalFact = {
  kind: FactKind;
  value: string;
  index: number;
  /** True when the value cannot be read unambiguously (e.g. 05/06/26). */
  ambiguous: boolean;
  note?: string;
};

const MONTHS =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const WEEKDAYS = "Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?";

// "3:00 PM", "7am", "4:30 p.m." — a trailing full stop is kept only for the dotted "p.m." form.
export const TIME_RE = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?([AaPp])(?:\.\s?[Mm]\.|\s?[Mm])(?![A-Za-z])/g;
const TIME_24_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s?[AaPp]\.?\s?[Mm])/g;
const NOON_RE = /\b(noon|midday|midnight)\b/gi;
const DATE_TEXT_RE = new RegExp(
  `\\b(?:(?:${WEEKDAYS}),?\\s+)?(?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})|(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?)(?:,?\\s+\\d{4})?\\b`,
  "gi",
);
const DATE_NUMERIC_RE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/g;
const WEEKDAY_RE = new RegExp(`\\b(?:${WEEKDAYS.replace(/\?:/g, "?:")})\\b`, "g");
const PHONE_RE = /(?:\+?\d[\d\s-]{8,16}\d)/g;

export function detectCriticalFacts(text: string): CriticalFact[] {
  const facts: CriticalFact[] = [];
  const taken: [number, number][] = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const add = (f: CriticalFact) => {
    const end = f.index + f.value.length;
    if (overlaps(f.index, end)) return;
    taken.push([f.index, end]);
    facts.push(f);
  };

  for (const m of text.matchAll(DATE_TEXT_RE)) add({ kind: "date", value: m[0], index: m.index, ambiguous: false });
  for (const m of text.matchAll(DATE_NUMERIC_RE)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const ambiguous = a <= 12 && b <= 12 && a !== b;
    const invalid = (a > 12 && b > 12) || a === 0 || b === 0 || a > 31 || b > 31;
    add({
      kind: "date",
      value: m[0],
      index: m.index,
      ambiguous: ambiguous || invalid,
      note: invalid
        ? "This date is not valid."
        : ambiguous
          ? "Day and month could be read either way. Write the month as a word, e.g. 5 June 2026."
          : undefined,
    });
  }
  for (const m of text.matchAll(TIME_RE)) add({ kind: "time", value: m[0], index: m.index, ambiguous: false });
  for (const m of text.matchAll(TIME_24_RE)) add({ kind: "time", value: m[0], index: m.index, ambiguous: false });
  for (const m of text.matchAll(NOON_RE)) add({ kind: "time", value: m[0], index: m.index, ambiguous: false });
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 14) {
      add({ kind: "phone", value: m[0].trim(), index: m.index, ambiguous: false });
    }
  }
  for (const m of text.matchAll(WEEKDAY_RE)) add({ kind: "date", value: m[0], index: m.index, ambiguous: false });

  return facts.sort((x, y) => x.index - y.index);
}

export function hasAmbiguousFacts(text: string) {
  return detectCriticalFacts(text).some((f) => f.ambiguous);
}
