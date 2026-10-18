import { z } from "zod";

export const MAX_NOTICE_CHARS = 6000;
export const MAX_TITLE_CHARS = 140;

const stripControl = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");

const cleanText = (max: number, label: string) =>
  z
    .string()
    .transform((s) => stripTags(stripControl(s)).replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`));

export const sourceUrlSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (v === null) return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Source must be a full http(s) URL.");

export const createNoticeSchema = z.object({
  title: cleanText(MAX_TITLE_CHARS, "Title"),
  text: cleanText(MAX_NOTICE_CHARS, "Notice text"),
  sourceUrl: sourceUrlSchema,
  voiceId: z.string().trim().min(1, "Choose a voice.").max(100),
  timezone: z.string().trim().max(64).optional(),
});

export const createRevisionSchema = z.object({
  title: cleanText(MAX_TITLE_CHARS, "Title").optional(),
  text: cleanText(MAX_NOTICE_CHARS, "Notice text"),
  voiceId: z.string().trim().min(1).max(100).optional(),
  updatePreface: z
    .string()
    .max(300)
    .optional()
    .nullable()
    .transform((v) => (v ? stripTags(stripControl(v)).trim() || null : null)),
});

export const updateDraftSchema = createRevisionSchema.extend({
  text: cleanText(MAX_NOTICE_CHARS, "Notice text").optional(),
  confirmedCriticalFacts: z.boolean().optional(),
  sourceUrl: sourceUrlSchema,
});

export const approveSchema = z.object({
  confirmedCriticalFacts: z.literal(true, { message: "Confirm the critical facts before publishing." }),
});

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
