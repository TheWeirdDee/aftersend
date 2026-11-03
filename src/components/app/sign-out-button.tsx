"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";

/** Ends this browser's session. With an email on the account, the workspace is one sign-in away; without, it is gone from here. */
export function SignOutButton({ hasEmail }: { hasEmail: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost btn-sm whitespace-nowrap"
      disabled={busy}
      onClick={async () => {
        const message = hasEmail
          ? "Sign out of this browser? You can sign back in with your email at any time. Published links keep working."
          : "Leave this guest session? It is not saved to an email, so this browser will lose the ability to update or withdraw its announcements. Published links keep working. Save your account first to keep control.";
        if (!confirm(message)) return;
        setBusy(true);
        try {
          await api("/api/workspace", { method: "DELETE" });
        } finally {
          router.push("/");
          router.refresh();
        }
      }}
    >
      {hasEmail ? (
        "Sign out"
      ) : (
        <span>
          Leave<span className="hidden sm:inline"> guest session</span>
        </span>
      )}
    </button>
  );
}

/** Ends every session of the account, on every device. */
export function SignOutEverywhereButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={busy}
        onClick={async () => {
          if (!confirm("Sign out on every device, including this one? You can sign back in with your email.")) return;
          setBusy(true);
          setError(null);
          try {
            await api("/api/auth/signout-all", { method: "POST" });
            router.push("/");
            router.refresh();
          } catch {
            setError("Could not sign out everywhere. Try again.");
            setBusy(false);
          }
        }}
      >
        Sign out everywhere
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
