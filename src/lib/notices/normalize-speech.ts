import { TIME_RE } from "./facts";

/**
 * Builds the speech script from approved display text. Only mechanically unambiguous rewrites are
 * applied (clock times, phone digits, a few symbols); the display text is never modified, and nothing
 * is summarised or paraphrased.
 */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty"];

export function numberWords(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t]! : `${TENS[t]}-${ONES[o]}`;
}

export function speakClockTime(hour: number, minute: number, meridiem: "am" | "pm"): string {
  if (minute === 0 && hour === 12) return meridiem === "pm" ? "twelve noon" : "twelve midnight";
  const h = numberWords(hour);
  const m = minute === 0 ? "" : minute < 10 ? ` oh ${numberWords(minute)}` : ` ${numberWords(minute)}`;
  return `${h}${m} ${meridiem === "am" ? "a.m." : "p.m."}`;
}

const DIGIT_WORDS = ONES.slice(0, 10);

export function speakPhoneNumber(raw: string): string {
  const plus = raw.trim().startsWith("+");
  const groups = raw.replace(/[^\d\s-]/g, "").split(/[\s-]+/).filter(Boolean);
  const spoken = groups.map((g) => g.split("").map((d) => DIGIT_WORDS[Number(d)]).join(" ")).join(", ");
  return plus ? `plus ${spoken}` : spoken;
}

const PHONE_RE = /\+?\d[\d\s-]{8,16}\d/g;

function speakable(text: string): string {
  let body = text;

  body = body.replace(TIME_RE, (_m, h: string, min: string | undefined, ap: string) =>
    speakClockTime(Number(h), min ? Number(min) : 0, ap.toLowerCase() === "a" ? "am" : "pm"),
  );
  body = body.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 14 ? speakPhoneNumber(m) : m;
  });
  // "3:00 PM." becomes "three p.m." rather than "three p.m.."
  return body.replace(/(?<!\.)\.\.(?!\.)/g, ".").replace(/\s&\s/g, " and ");
}

export function toSpeechText(title: string, displayText: string, updatePreface?: string | null): string {
  let body = speakable(displayText.replace(/\r\n?/g, "\n").trim());
  // Paragraph breaks become sentence pauses; repeated whitespace collapses.
  body = body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((p) => (/[.!?:,;]$/.test(p) ? p : `${p}.`))
    .join(" ");

  const parts = [title.trim().replace(/[.!?:]?$/, ".")];
  if (updatePreface?.trim()) parts.push(speakable(updatePreface.trim()).replace(/[.!?]?$/, "."));
  parts.push(body);
  return parts.join(" ");
}
