import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * End-to-end journeys run against a production build. Speech comes from the labelled test-tone
 * provider so the suite can run without spending sponsor credits; it never proves AssemblyAI output.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    // Chromium is started muted: it then does not depend on the host's audio output device, which on a busy Windows machine fails
    // intermittently with AUDIO_RENDERER_ERROR (see docs/DEFECT_LOG.md, R2); a null audio sink is used instead. Playback logic is still real: the element plays and reports progress.
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: { args: ["--mute-audio", "--disable-audio-output"] } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, launchOptions: { args: ["--mute-audio", "--disable-audio-output"] } }, testMatch: /mobile|listener/ },
    // Real playback in the other two engines. Run with: npx playwright test --project=firefox --project=webkit
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 800 } }, testMatch: /cross-browser/ },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } }, testMatch: /cross-browser/ },
  ],
  webServer: {
    // The helper is cross-platform (no `rm -rf`) and only ever touches .data/e2e.
    command: `node scripts/e2e-clean.mjs && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SPEECH_PROVIDER: "test",
      EMAIL_DRIVER: "file",
      AFTERSEND_ALLOW_TEST_EMAIL: "1",
      EMAIL_OUTBOX_DIR: ".data/e2e/outbox",
      AUTH_SECRET: "e2e-only-secret-0123456789abcdef",
      AFTERSEND_ALLOW_TEST_PROVIDER: "1",
      AFTERSEND_INSECURE_COOKIES: "1",
      // Hermetic: Next.js also reads .env.local, which holds real keys and the production database. Every variable
      // that could reach a real service is pinned here (a defined-but-empty value is not overridden by .env.local).
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
      // One IP makes every request in the suite, so the guest limits (20 an hour each, 400 a day for all guests) are lifted here.
      GUEST_SYNTHESIS_LIMIT_PER_HOUR: "500",
      GUEST_SYNTHESIS_PER_DAY: "100000",
      AUTH_EMAILS_PER_DAY: "100000",
      AUTH_REQUESTS_PER_IP_PER_HOUR: "500",
      AUTH_VERIFY_PER_IP_PER_HOUR: "500",
      DEMO_WORKSPACES_PER_IP_PER_HOUR: "200",
    },
  },
});
