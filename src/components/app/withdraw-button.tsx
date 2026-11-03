"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/client/api";

export function WithdrawButton({ noticeId }: { noticeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn-danger btn-sm"
        disabled={busy}
        onClick={async () => {
          if (!confirm("Withdraw this announcement? The link will say it has been withdrawn and stop playing audio. This cannot be undone. Audio that someone already downloaded cannot be recalled.")) return;
          setBusy(true);
          try {
            await api(`/api/notices/${noticeId}/withdraw`, { method: "POST" });
            router.refresh();
          } catch (e) {
            setError(e instanceof ApiFailure ? e.message : "Could not withdraw.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Withdraw announcement
      </button>
      {error ? <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}
