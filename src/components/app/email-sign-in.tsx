"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiFailure } from "@/lib/client/api";
import { Spinner } from "../icons";

type Step = "email" | "code";

/**
 * Two-step passwordless sign-in: enter an email, then the 6-digit code that was sent to it. `linkNotices` is
 * the number of notices in the workspace this browser already holds (or null if none): signing in connects
 * that workspace to the email, and the page says so before the code is requested.
 */
export function EmailSignIn({ linkNotices }: { linkNotices: number | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const request = async (resend: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ cooldownSec: number }>("/api/auth/request", { method: "POST", body: { email } });
      setCooldown(res.cooldownSec);
      setCode("");
      setNotice(resend ? "We sent another code. Only the newest one works." : null);
      setStep("code");
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ redirect: string }>("/api/auth/verify", { method: "POST", body: { email, code } });
      router.push(res.redirect);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Could not verify the code.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {linkNotices !== null ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-[14.5px] leading-6 text-muted">
          This browser already has a workspace{linkNotices ? ` with ${linkNotices} notice${linkNotices === 1 ? "" : "s"}` : ""}. Verifying your email
          connects it to that address. If the address already has an account, this workspace&apos;s notices are moved into it.
        </p>
      ) : null}

      {step === "email" ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void request(false);
          }}
        >
          <div>
            <label htmlFor="email" className="field-label">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby="email-help"
              aria-invalid={!!error}
            />
            <p id="email-help" className="field-hint">
              We email a 6-digit code. There is no password.
            </p>
          </div>
          <button type="submit" className="btn-primary h-12 w-full" disabled={busy || !email.trim()}>
            {busy ? <Spinner /> : null} Send code
          </button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p role="status" aria-live="polite" className="text-[14.5px] leading-6 text-muted">
            {notice ?? `If ${email} can receive mail, a 6-digit code is on its way.`} It expires in 10 minutes.
          </p>
          <div>
            <label htmlFor="code" className="field-label">
              6-digit code
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 -]*"
              maxLength={7}
              required
              autoFocus
              className="input font-mono text-[22px] tracking-[0.3em]"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={!!error}
            />
          </div>
          <button type="submit" className="btn-primary h-12 w-full" disabled={busy || code.replace(/\D/g, "").length !== 6}>
            {busy ? <Spinner /> : null} Verify and continue
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
            <button type="button" className="text-signal underline underline-offset-4 disabled:text-faint disabled:no-underline" disabled={busy || cooldown > 0} onClick={() => void request(true)}>
              {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
            </button>
            <button
              type="button"
              className="text-muted underline underline-offset-4"
              onClick={() => {
                setStep("email");
                setError(null);
                setNotice(null);
              }}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-[14px] leading-5 text-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
