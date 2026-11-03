"use client";

import { useSyncExternalStore } from "react";

type Choice = "system" | "light" | "dark";
const KEY = "aftersend-theme";
const EVENT = "aftersend-theme-change";
const ORDER: Choice[] = ["system", "light", "dark"];
const LABEL: Record<Choice, string> = { system: "System", light: "Light", dark: "Dark" };

function read(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Private windows can refuse storage; the choice then lasts until the page closes.
  }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};

function Icon({ choice }: { choice: Choice }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (choice === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (choice === "dark")
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

/** "cycle" is one compact button for a header; "group" shows all three choices for a footer or settings. */
export function ThemeToggle({ variant = "cycle" }: { variant?: "cycle" | "group" }) {
  const choice = useSyncExternalStore(subscribe, read, () => "system" as Choice);

  if (variant === "group") {
    return (
      <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-full border border-line-strong p-0.5">
        {ORDER.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={choice === c}
            onClick={() => apply(c)}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] ${choice === c ? "bg-fg text-ink" : "text-muted hover:text-fg"}`}
          >
            <Icon choice={c} /> {LABEL[c]}
          </button>
        ))}
      </div>
    );
  }

  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
  return (
    <button
      type="button"
      onClick={() => apply(next)}
      className="btn-ghost btn-sm size-10 px-0"
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[next]}.`}
      title={`Theme: ${LABEL[choice]}`}
    >
      <Icon choice={choice} />
    </button>
  );
}
