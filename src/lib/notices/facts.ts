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
// Full names match in any case; abbreviations only when capitalised or upper-case, so "sat" and "wed" stay words.
const WEEKDAY_FULL_RE = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const WEEKDAY_ABBR_RE = /\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun|MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT|SUN)\b/g;
const PHONE_RE = /(?:\+?\d[\d\s-]{8,16}\d)/g;

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

/** Days in a 1-based month. Without a year, February allows 29 because the year may be a leap year. */
function daysIn(month: number, year: number | null) {
  if (month === 2) return year === null || isLeapYear(year) ? 29 : 28;
  return DAYS_IN_MONTH[month - 1]!;
}

/** Checks a written date such as "31 February 2026" or "June 5th" against the calendar. */
function textDateIsReal(value: string) {
  const name = value.match(new RegExp(`\\b(${MONTHS})`, "i"))?.[1]?.slice(0, 3).toLowerCase() ?? "";
  const month = MONTH_NAMES.indexOf(name) + 1;
  const day = Number(value.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/)?.[1]);
  const year = value.match(/\b(\d{4})\b/)?.[1];
  if (!month || !day) return true; // weekday-only or unparseable: leave it to the reader
  return day >= 1 && day <= daysIn(month, year ? Number(year) : null);
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * "Friday, 24 October 2026" names a Friday and a date; when the year is written they can be checked against each other.
 * Returns what is wrong in plain words, or undefined when they agree or there is not enough to check.
 */
function weekdayMismatch(value: string): string | undefined {
  const said = new RegExp(`^(${WEEKDAYS})\\b`, "i").exec(value)?.[1];
  const year = value.match(/\b(\d{4})\b/)?.[1];
  if (!said || !year) return undefined;
  const name = value.match(new RegExp(`\\b(${MONTHS})`, "i"))?.[1]?.slice(0, 3).toLowerCase() ?? "";
  const month = MONTH_NAMES.indexOf(name) + 1;
  const day = Number(value.replace(said, "").match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/)?.[1]);
  if (!month || !day || day > daysIn(month, Number(year))) return undefined;
  const actual = new Date(Date.UTC(Number(year), month - 1, day)).getUTCDay();
  const wanted = WEEKDAY_NAMES.findIndex((n) => n.slice(0, 3).toLowerCase() === said.slice(0, 3).toLowerCase());
  if (actual === wanted) return undefined;
  const written = value.slice(said.length).replace(/^,?\s+/, "");
  return `${WEEKDAY_NAMES[wanted]} is not ${written}: that date is a ${WEEKDAY_NAMES[actual]}. Fix the day or the date.`;
}

/** For dd/mm/yyyy and mm/dd/yyyy: which of the two readings are real calendar dates. */
function numericDateReadings(a: number, b: number, rawYear: string) {
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  const dayFirst = b >= 1 && b <= 12 && a >= 1 && a <= daysIn(b, year);
  const monthFirst = a >= 1 && a <= 12 && b >= 1 && b <= daysIn(a, year);
  return { dayFirst, monthFirst };
}

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

  for (const m of text.matchAll(DATE_TEXT_RE)) {
    const real = textDateIsReal(m[0]);
    const mismatch = real ? weekdayMismatch(m[0]) : undefined;
    add({
      kind: "date",
      value: m[0],
      index: m.index,
      ambiguous: !real || !!mismatch,
      note: real ? mismatch : "This date is not on the calendar.",
    });
  }
  for (const m of text.matchAll(DATE_NUMERIC_RE)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const { dayFirst, monthFirst } = numericDateReadings(a, b, m[3]!);
    const invalid = !dayFirst && !monthFirst;
    const ambiguous = dayFirst && monthFirst && a !== b;
    add({
      kind: "date",
      value: m[0],
      index: m.index,
      ambiguous: ambiguous || invalid,
      note: invalid
        ? "This date is not on the calendar."
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
  for (const re of [WEEKDAY_FULL_RE, WEEKDAY_ABBR_RE]) {
    for (const m of text.matchAll(re)) add({ kind: "date", value: m[0], index: m.index, ambiguous: false });
  }

  return facts.sort((x, y) => x.index - y.index);
}

export function hasAmbiguousFacts(text: string) {
  return detectCriticalFacts(text).some((f) => f.ambiguous);
}

export type SpokenFields = { title: string; text: string; updatePreface?: string | null };

/** Looks through every field the listener hears, in the order it is spoken, and names the first offender. */
export function findAmbiguousSpokenFact(fields: SpokenFields) {
  const checked: [keyof SpokenFields, string | null | undefined][] = [
    ["title", fields.title],
    ["updatePreface", fields.updatePreface],
    ["text", fields.text],
  ];
  for (const [field, value] of checked) {
    const fact = value ? detectCriticalFacts(value).find((f) => f.ambiguous) : undefined;
    if (fact) return { field, fact };
  }
  return null;
}
