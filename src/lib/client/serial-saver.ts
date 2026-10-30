/**
 * Runs saves strictly one at a time and always sends the newest edit last.
 *
 * Edits arrive faster than a network round trip. Firing a request per edit lets responses come back out of
 * order, so an older save can finish after a newer one and be taken for the latest state. Here `submit` only
 * records the newest value; a single loop sends it, and anything submitted while a request is in flight is
 * coalesced into one follow-up request. "Saved" therefore means: the newest submitted value was acknowledged.
 */
export type SaverState = "saved" | "dirty" | "saving" | "error";

export type SerialSaver<T> = {
  /** Records the newest value. Nothing is sent until `flush`. */
  submit(value: T): void;
  /** Sends pending values one at a time. Resolves true only if everything submitted so far was acknowledged. */
  flush(): Promise<boolean>;
  /** The most recent failure, cleared by the next successful save. */
  readonly error: unknown;
  readonly state: SaverState;
};

export function createSerialSaver<T>(options: {
  save: (value: T) => Promise<void>;
  onState?: (state: SaverState, error: unknown) => void;
}): SerialSaver<T> {
  let latest: { value: T; seq: number } | null = null;
  let seq = 0;
  let acknowledged = 0;
  let running: Promise<boolean> | null = null;
  let state: SaverState = "saved";
  let error: unknown = null;

  const set = (next: SaverState, err: unknown = null) => {
    state = next;
    error = err;
    options.onState?.(next, err);
  };

  const run = async (): Promise<boolean> => {
    while (acknowledged < seq && latest) {
      const sending = latest;
      set("saving");
      try {
        await options.save(sending.value);
      } catch (err) {
        set("error", err);
        return false;
      }
      acknowledged = sending.seq;
      set(acknowledged < seq ? "dirty" : "saved");
    }
    return true;
  };

  return {
    submit(value) {
      latest = { value, seq: ++seq };
      if (state !== "saving") set("dirty");
    },
    async flush() {
      // A flush that arrives mid-save waits for the loop, which also picks up anything newer. The re-check
      // covers a value submitted in the instant after the loop finished but before it was cleared.
      for (;;) {
        running ??= run().finally(() => {
          running = null;
        });
        if (!(await running)) return false;
        if (acknowledged >= seq) return true;
      }
    },
    get error() {
      return error;
    },
    get state() {
      return state;
    },
  };
}
