/**
 * Decides when the editor asks for new speech. Editing is frequent and each speech request costs money, so:
 *
 * - a request starts only after the person has paused for `delayMs` (the timer restarts on every edit);
 * - only one request runs at a time. An edit made while one runs does not start a second; once the running one ends,
 *   the debounce starts again and a single follow-up request covers everything typed meanwhile;
 * - the running request is never aborted here. The server discards its audio if the text changed (see updateDraft),
 *   and the caller discards its result by comparing `generation` before using it.
 */
export type SpeechSync = {
  /** Call on every edit. Restarts the pause timer. */
  touch(): void;
  /** Starts a request now, without waiting for the pause (the Retry audio button, a reopened draft). */
  now(): void;
  /** Stops a pending timer. A request already running is left to finish. */
  cancel(): void;
  /** Increases on every touch; a result computed for an older value is stale. */
  readonly generation: number;
  readonly pending: boolean;
  readonly running: boolean;
};

export function createSpeechSync(options: {
  delayMs: number;
  run: () => Promise<void>;
  onChange?: () => void;
}): SpeechSync {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let generation = 0;

  const changed = () => options.onChange?.();

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const start = async () => {
    clear();
    if (running) {
      // Wait for the running request, then debounce again from now.
      again = true;
      return;
    }
    running = true;
    changed();
    try {
      await options.run();
    } catch {
      // The caller reports its own errors; a failure must never turn into a retry loop here.
    } finally {
      running = false;
      changed();
    }
    if (again) {
      again = false;
      schedule();
    }
  };

  const schedule = () => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      changed();
      void start();
    }, options.delayMs);
    changed();
  };

  return {
    touch() {
      generation++;
      schedule();
    },
    now() {
      void start();
    },
    cancel() {
      clear();
      again = false;
      changed();
    },
    get generation() {
      return generation;
    },
    get pending() {
      return timer !== null || again;
    },
    get running() {
      return running;
    },
  };
}
