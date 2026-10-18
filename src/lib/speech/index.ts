import "server-only";
import { env } from "../env";
import { AssemblyAiTtsProvider } from "./assemblyai";
import type { SpeechProvider } from "./provider";
import { TestToneProvider } from "./test-provider";

let override: SpeechProvider | null = null;

export function speechProvider(): SpeechProvider {
  if (override) return override;
  const e = env();
  if (e.SPEECH_PROVIDER === "test") {
    if (e.AFTERSEND_ALLOW_TEST_PROVIDER !== "1") {
      throw new Error("SPEECH_PROVIDER=test requires AFTERSEND_ALLOW_TEST_PROVIDER=1.");
    }
    return new TestToneProvider();
  }
  return new AssemblyAiTtsProvider();
}

/** Test hook for integration tests. */
export function setSpeechProvider(p: SpeechProvider | null) {
  override = p;
}
