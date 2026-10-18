import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(".data/objects"),
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  OBJECT_STORAGE_ENDPOINT: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().default("auto"),
  OBJECT_STORAGE_ACCESS_KEY: z.string().optional(),
  OBJECT_STORAGE_SECRET_KEY: z.string().optional(),
  SPEECH_PROVIDER: z.enum(["assemblyai", "test"]).default("assemblyai"),
  // The test provider produces a labelled tone, never speech. It must be opted into explicitly.
  AFTERSEND_ALLOW_TEST_PROVIDER: z.enum(["0", "1"]).default("0"),
  ASSEMBLYAI_API_KEY: z.string().optional(),
  ASSEMBLYAI_TTS_ENDPOINT: z.string().default("wss://streaming-tts.assemblyai.com/v1/ws"),
  ASSEMBLYAI_TTS_MODEL: z.string().optional(),
  // Comma-separated voice ids, populated only from the verified voice catalogue.
  ASSEMBLYAI_TTS_VOICES: z.string().optional(),
  ASSEMBLYAI_TTS_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  SYNTHESIS_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),
  DEMO_WORKSPACES_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** Test hook: re-read process.env on next access. */
export function resetEnvCache() {
  cached = null;
}
