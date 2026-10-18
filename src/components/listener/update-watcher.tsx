"use client";

import { useEffect, useState } from "react";

/**
 * Checks the manifest in the background. If a newer version is published while the page is open, it
 * tells the listener instead of silently swapping audio mid-playback.
 */
export function UpdateWatcher({ token, revisionId }: { token: string; revisionId: string }) {
  const [newer, setNewer] = useState<number | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);

  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/public/${token}/current`, { cache: "no-store" });
        if (!res.ok) return;
        const m = (await res.json()) as { state: string; revisionId?: string; revisionNumber?: number };
        if (stop) return;
        if (m.state === "withdrawn") setWithdrawn(true);
        else if (m.revisionId && m.revisionId !== revisionId) setNewer(m.revisionNumber ?? 0);
      } catch {
        // Offline: keep showing the version already on screen.
      }
    };
    const t = setInterval(check, 30000);
    document.addEventListener("visibilitychange", check);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, [token, revisionId]);

  if (!newer && !withdrawn) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-[640px] flex-col gap-3 rounded-2xl border border-signal/40 bg-surface p-4 shadow-2xl sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[15px] leading-6">
        {withdrawn ? "The publisher has withdrawn this notice." : "This notice was just updated. Reload to read and hear the latest version."}
      </p>
      <button type="button" className="btn-primary btn-sm shrink-0" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
