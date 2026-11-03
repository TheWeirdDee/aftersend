"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/client/api";
import { ArrowRight, Spinner } from "../icons";

/**
 * Every "Create an announcement" on the public pages is this one button, so there is one way in. A visitor with no session
 * gets a guest workspace with a sample announcement already open in the editor; someone who already has a session (a
 * returning guest or a signed-in account) is taken to a new announcement in it. The server decides which (POST /api/workspace
 * with kind "create"), so the page itself reads the same for everyone.
 */
export function CreateAnnouncementButton({ className, arrow = false, children = "Create an announcement" }: { className: string; arrow?: boolean; children?: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { redirect } = await api<{ redirect: string }>("/api/workspace", { method: "POST", body: { kind: "create" } });
      router.push(redirect);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Could not start. Try again.");
      setBusy(false);
    }
  };

  return (
    <span className="relative inline-flex">
      <button type="button" className={className} aria-busy={busy} disabled={busy} onClick={start}>
        {busy ? <Spinner /> : null}
        {children}
        {arrow && !busy ? <ArrowRight /> : null}
      </button>
      {error ? (
        <span role="alert" className="absolute top-full right-0 z-10 mt-2 w-64 rounded-lg border border-line-strong bg-surface p-3 text-[13px] leading-5 text-danger shadow-lg">
          {error}
        </span>
      ) : null}
    </span>
  );
}
