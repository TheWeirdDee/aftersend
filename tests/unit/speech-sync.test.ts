import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpeechSync } from "@/lib/client/speech-sync";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const deferred = () => {
  let done!: () => void;
  const promise = new Promise<void>((r) => (done = r));
  return { promise, done };
};

describe("automatic speech requests", () => {
  it("waits for a pause, and a burst of edits makes one request", async () => {
    const run = vi.fn(async () => {});
    const sync = createSpeechSync({ delayMs: 1000, run });
    for (let i = 0; i < 20; i++) {
      sync.touch();
      await vi.advanceTimersByTimeAsync(300); // typing faster than the pause
    }
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never runs two requests at once: an edit during a request waits, then makes exactly one follow-up", async () => {
    const gates = [deferred(), deferred()];
    let calls = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const run = vi.fn(async () => {
      const gate = gates[calls++]!;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await gate.promise;
      concurrent--;
    });
    const sync = createSpeechSync({ delayMs: 500, run });
    sync.touch();
    await vi.advanceTimersByTimeAsync(500);
    expect(sync.running).toBe(true);

    // Several edits while the first request is running.
    for (let i = 0; i < 5; i++) {
      sync.touch();
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(run).toHaveBeenCalledTimes(1);

    gates[0]!.done();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1); // the debounce restarts after the first request ends
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(2);
    gates[1]!.done();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1);
  });

  it("marks results computed before the latest edit as stale", () => {
    const sync = createSpeechSync({ delayMs: 500, run: async () => {} });
    const before = sync.generation;
    sync.touch();
    expect(sync.generation).toBeGreaterThan(before);
  });

  it("does not retry by itself after a failure", async () => {
    const run = vi.fn(async () => {
      throw new Error("provider down");
    });
    const sync = createSpeechSync({ delayMs: 200, run });
    sync.touch();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("starts at once for an explicit retry, and cancel stops a pending request", async () => {
    const run = vi.fn(async () => {});
    const sync = createSpeechSync({ delayMs: 5000, run });
    sync.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    sync.touch();
    sync.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
