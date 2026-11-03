import "server-only";
import { z } from "zod";
import { DEFAULT_ENDPOINT } from "./speech/assemblyai-protocol";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),
  // Connections per server instance. Keep it small behind a transaction pooler: every warm instance holds this many.
  // Direct or session-pooler URI used only by `npm run db:migrate`. Falls back to DATABASE_URL.
  MIGRATION_DATABASE_URL: z.string().optional(),
  // `disable` turns TLS off for a non-local database. Leave unset: every hosted database should be reached over TLS.
  DATABASE_SSL: z.enum(["require", "disable"]).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),
  PGLITE_DIR: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "s3", "supabase"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(".data/objects"),
  // Ceiling for one storage request (upload, download or delete). A generate request also clamps it to the time left.
  STORAGE_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(10000),
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  // Server-only. Used solely for Storage requests from API routes.
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  OBJECT_STORAGE_ENDPOINT: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().default("auto"),
  OBJECT_STORAGE_ACCESS_KEY: z.string().optional(),
  OBJECT_STORAGE_SECRET_KEY: z.string().optional(),
  SPEECH_PROVIDER: z.enum(["assemblyai", "test"]).default("assemblyai"),
  // The test provider produces a labelled tone, never speech. It must be opted into explicitly.
  AFTERSEND_ALLOW_TEST_PROVIDER: z.enum(["0", "1"]).default("0"),
  ASSEMBLYAI_API_KEY: z.string().optional(),
  ASSEMBLYAI_TTS_ENDPOINT: z.string().default(DEFAULT_ENDPOINT),
  ASSEMBLYAI_TTS_MODEL: z.string().optional(),
  // Comma-separated voice ids; defaults to the voices named in AssemblyAI's docs.
  ASSEMBLYAI_TTS_VOICES: z.string().optional(),
  // Ceiling for one synthesis attempt.
  ASSEMBLYAI_TTS_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  // Ceiling for a whole generate request (all attempts, backoff and storage). Keep it under the route's maxDuration.
  SYNTHESIS_DEADLINE_MS: z.coerce.number().int().min(1000).default(50000),
  // Signs sign-in codes. Required in production (generate with `openssl rand -base64 32`); never reuse another secret.
  AUTH_SECRET: z.string().min(16).optional(),
  // "resend" sends real email. "file" writes messages to EMAIL_OUTBOX_DIR for automated tests and needs the opt-in below.
  EMAIL_DRIVER: z.enum(["resend", "file"]).default("resend"),
  AFTERSEND_ALLOW_TEST_EMAIL: z.enum(["0", "1"]).default("0"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_OUTBOX_DIR: z.string().default(".data/outbox"),
  // Sign-in abuse limits per client IP per hour. Per-address limits are fixed (5 codes, 30 attempts).
  AUTH_REQUESTS_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(20),
  // Total sign-in emails per UTC day across all addresses. The email account's daily quota is shared by every application
  // that uses it, so this keeps AfterSend from using it all up. Leave room for the other applications.
  AUTH_EMAILS_PER_DAY: z.coerce.number().int().positive().default(60),
  AUTH_VERIFY_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(30),
  // Spoken previews per hour. The editor prepares one on its own after each pause in typing, so this is a ceiling on cost, not on edits.
  SYNTHESIS_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(60),
  // The same ceiling for a guest, who has not given an email address.
  GUEST_SYNTHESIS_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(20),
  // All guests together, per day: a ceiling on what anonymous traffic can spend of the speech budget.
  GUEST_SYNTHESIS_PER_DAY: z.coerce.number().int().positive().default(400),
  DEMO_WORKSPACES_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  // A blank line such as `APP_URL=` in a copied .env.example means "unset", not an empty value.
  if (!cached) cached = schema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));
  return cached;
}

/** Test hook: re-read process.env on next access. */
export function resetEnvCache() {
  cached = null;
}
