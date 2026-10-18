"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost btn-sm whitespace-nowrap"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Leave this workspace? This browser will lose access to its notices; published links keep working.")) return;
        setBusy(true);
        try {
          await api("/api/workspace", { method: "DELETE" });
        } finally {
          router.push("/");
          router.refresh();
        }
      }}
    >
      Leave<span className="hidden sm:inline">&nbsp;workspace</span>
    </button>
  );
}
