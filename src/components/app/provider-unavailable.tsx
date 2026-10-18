import { Alert } from "../icons";

/** Shown instead of inert controls when the server cannot generate speech. */
export function ProviderUnavailable({ reason }: { reason: string }) {
  return (
    <div role="alert" className="flex max-w-2xl gap-3 rounded-2xl border border-warn/40 bg-warn/[0.07] p-5">
      <Alert className="mt-0.5 size-5 shrink-0 text-warn" />
      <div>
        <p className="font-medium text-fg">Speech generation is unavailable on this server.</p>
        <p className="mt-1.5 text-[14.5px] leading-6 text-muted">{reason}</p>
        <p className="mt-1.5 text-[14.5px] leading-6 text-muted">
          AfterSend won&apos;t publish a notice without real generated audio, so publishing is paused until this is fixed.
        </p>
      </div>
    </div>
  );
}
