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

/** Optional fields in a PATCH keep "omitted" (leave alone) distinct from null (clear). */
const patchSourceUrl = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? v : null))
  .refine((v) => {
    if (!v) return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Source must be a full http(s) URL.");

const updatePreface = z
  .string()
  .max(300)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? stripTags(stripControl(v)).trim() || null : null));

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
  updatePreface: updatePreface.transform((v) => v ?? null),
  // Retrying a create whose response was lost returns the same draft instead of a second one.
  clientToken: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});

export const updateDraftSchema = z.object({
  title: cleanText(MAX_TITLE_CHARS, "Title").optional(),
  text: cleanText(MAX_NOTICE_CHARS, "Notice text").optional(),
  voiceId: z.string().trim().min(1).max(100).optional(),
  updatePreface,
  confirmedCriticalFacts: z.boolean().optional(),
  sourceUrl: patchSourceUrl,
  // The version this edit was made against; a stale writer is refused rather than overwriting.
  expectedVersion: z.number().int().positive().optional(),
});

export const approveSchema = z.object({
  confirmedCriticalFacts: z.literal(true, { message: "Confirm the critical facts before publishing." }),
  // Approval names the exact saved version whose audio was previewed.
  expectedVersion: z.number().int().positive({ message: "Say which saved version you are approving." }),
});

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
