"use client";

import { useState } from "react";
import { Check, Copy } from "../icons";

export function CopyButton({ value, label = "Copy link", className = "btn-secondary btn-sm" }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          window.prompt("Copy this link:", value);
        }
      }}
    >
      {copied ? <Check className="size-4 text-signal" /> : <Copy className="size-4" />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
