#!/usr/bin/env node
/**
 * Starts the production build the way the end-to-end suite does (test-tone speech, local storage, local database, no real
 * keys), on a port of your choosing, for manual and scripted checks:
 *
 *   npm run build && node scripts/serve-test.mjs 3100
 *
 * It only ever touches .data/e2e and never reads a real service's credentials: every variable that could reach one is pinned.
 */
import { spawn } from "node:child_process";

const port = process.argv[2] ?? "3100";
const env = {
  ...process.env,
  SPEECH_PROVIDER: "test",
  EMAIL_DRIVER: "file",
  AFTERSEND_ALLOW_TEST_EMAIL: "1",
  EMAIL_OUTBOX_DIR: ".data/e2e/outbox",
  AUTH_SECRET: "e2e-only-secret-0123456789abcdef",
  AFTERSEND_ALLOW_TEST_PROVIDER: "1",
  AFTERSEND_INSECURE_COOKIES: "1",
  STORAGE_DRIVER: "local",
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  OBJECT_STORAGE_BUCKET: "",
  ASSEMBLYAI_API_KEY: "",
  RESEND_API_KEY: "",
  EMAIL_FROM: "",
  CRON_SECRET: "",
  MIGRATION_DATABASE_URL: "",
  APP_URL: "",
  PGLITE_DIR: ".data/e2e/pglite",
  LOCAL_STORAGE_DIR: ".data/e2e/objects",
  DATABASE_URL: "",
  SYNTHESIS_LIMIT_PER_HOUR: "200",
  GUEST_SYNTHESIS_LIMIT_PER_HOUR: "500",
  GUEST_SYNTHESIS_PER_DAY: "100000",
  DEMO_WORKSPACES_PER_IP_PER_HOUR: "200",
};

const clean = spawn(process.execPath, ["scripts/e2e-clean.mjs"], { stdio: "inherit" });
clean.on("exit", () => {
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], { stdio: "inherit", env });
  next.on("exit", (c) => process.exit(c ?? 0));
});
