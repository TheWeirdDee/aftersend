"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/client/api";
import { ArrowRight, Spinner } from "../icons";

export function StartWorkspaceButton({ kind, children, className }: { kind: "workspace" | "demo"; children: React.ReactNode; className: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { redirect } = await api<{ redirect: string }>("/api/workspace", { method: "POST", body: { kind } });
            router.push(redirect);
            router.refresh();
          } catch (e) {
            setError(e instanceof ApiFailure ? e.message : "Could not start the workspace.");
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : null}
        {children}
        {!busy ? <ArrowRight /> : null}
      </button>
      {error ? (
        <p role="alert" className="text-[13.5px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
