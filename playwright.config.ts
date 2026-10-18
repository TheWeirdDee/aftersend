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
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, testMatch: /mobile|listener/ },
  ],
  webServer: {
    command: `rm -rf .data/e2e && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SPEECH_PROVIDER: "test",
      AFTERSEND_ALLOW_TEST_PROVIDER: "1",
      AFTERSEND_INSECURE_COOKIES: "1",
      PGLITE_DIR: ".data/e2e/pglite",
      LOCAL_STORAGE_DIR: ".data/e2e/objects",
      DATABASE_URL: "",
      SYNTHESIS_LIMIT_PER_HOUR: "200",
      DEMO_WORKSPACES_PER_IP_PER_HOUR: "200",
    },
  },
});
