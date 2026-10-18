import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Integration tests run against an in-memory Postgres (PGlite) and a temp-dir object store. */
export function configureTestEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftersend-test-"));
  Object.assign(process.env, {
    PGLITE_DIR: "memory://",
    DATABASE_URL: "",
    STORAGE_DRIVER: "local",
    LOCAL_STORAGE_DIR: dir,
    SPEECH_PROVIDER: "test",
    AFTERSEND_ALLOW_TEST_PROVIDER: "1",
    ASSEMBLYAI_TTS_TIMEOUT_MS: "2000",
  });
  return dir;
}
