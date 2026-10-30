import { describe, expect, it } from "vitest";
import { createSerialSaver, type SaverState } from "@/lib/client/serial-saver";

/** A save the test resolves or rejects by hand, so network timing is under its control. */
function controlledSave() {
  const calls: { value: string; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const save = (value: string) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ value, resolve, reject });
    });
  return { calls, save };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("serial saver", () => {
  it("never has two requests in flight, and sends the newest edit last", async () => {
    const { calls, save } = controlledSave();
    const saver = createSerialSaver<string>({ save });
    saver.submit("a");
    const done = saver.flush();
    await tick();
    expect(calls.map((c) => c.value)).toEqual(["a"]);

    // Edits arrive while "a" is still on the wire.
    saver.submit("b");
    saver.submit("c");
    void saver.flush();
    await tick();
    expect(calls.map((c) => c.value)).toEqual(["a"]); // still only one request

    calls[0]!.resolve();
    await tick();
    expect(calls.map((c) => c.value)).toEqual(["a", "c"]); // "b" was coalesced into "c"
    calls[1]!.resolve();
    await expect(done).resolves.toBe(true);
    expect(saver.state).toBe("saved");
  });

  it("is not 'saved' while a newer edit is waiting", async () => {
    const { calls, save } = controlledSave();
    const states: SaverState[] = [];
    const saver = createSerialSaver<string>({ save, onState: (s) => states.push(s) });
    saver.submit("a");
    const first = saver.flush();
    await tick();
    saver.submit("b");
    calls[0]!.resolve();
    await tick();
    expect(saver.state).toBe("saving"); // the follow-up for "b" is already underway, so not "saved"
    calls[1]!.resolve();
    await first;
    expect(states.at(-1)).toBe("saved");
    expect(calls.map((c) => c.value)).toEqual(["a", "b"]);
  });

  it("reports failure honestly and keeps the newest value for a retry", async () => {
    const { calls, save } = controlledSave();
    const saver = createSerialSaver<string>({ save });
    saver.submit("a");
    const attempt = saver.flush();
    await tick();
    const boom = new Error("network down");
    calls[0]!.reject(boom);
    await expect(attempt).resolves.toBe(false);
    expect(saver.state).toBe("error");
    expect(saver.error).toBe(boom);

    saver.submit("b");
    const retry = saver.flush();
    await tick();
    expect(calls.at(-1)!.value).toBe("b");
    calls.at(-1)!.resolve();
    await expect(retry).resolves.toBe(true);
    expect(saver.state).toBe("saved");
    expect(saver.error).toBeNull();
  });

  it("retries the same value after a failure when nothing newer was submitted", async () => {
    const { calls, save } = controlledSave();
    const saver = createSerialSaver<string>({ save });
    saver.submit("a");
    const first = saver.flush();
    await tick();
    calls[0]!.reject(new Error("x"));
    await first;
    const second = saver.flush();
    await tick();
    expect(calls.map((c) => c.value)).toEqual(["a", "a"]);
    calls[1]!.resolve();
    await expect(second).resolves.toBe(true);
  });

  it("flush with nothing pending resolves true without a request", async () => {
    const { calls, save } = controlledSave();
    const saver = createSerialSaver<string>({ save });
    await expect(saver.flush()).resolves.toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("a flush issued mid-save resolves only after the newest edit is acknowledged", async () => {
    const { calls, save } = controlledSave();
    const saver = createSerialSaver<string>({ save });
    saver.submit("a");
    void saver.flush();
    await tick();
    saver.submit("b");
    let resolved = false;
    const waiter = saver.flush().then((ok) => {
      resolved = ok;
      return ok;
    });
    calls[0]!.resolve();
    await tick();
    expect(resolved).toBe(false); // "b" has been sent but not acknowledged
    calls[1]!.resolve();
    await waiter;
    expect(resolved).toBe(true);
  });
});
