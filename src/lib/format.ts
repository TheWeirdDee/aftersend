/** Absolute, human-readable timestamps in the notice's own time zone, e.g. "18 Oct 2026, 4:10 PM WAT". */
export function formatStamp(iso: string | Date, timeZone = "Africa/Lagos") {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${parts.replace(/\b(am|pm)\b/, (m) => m.toUpperCase())} ${zoneLabel(timeZone, d)}`;
}

const ZONE_NAMES: Record<string, string> = { "Africa/Lagos": "WAT" };

export function zoneLabel(timeZone: string, d = new Date()) {
  if (ZONE_NAMES[timeZone]) return ZONE_NAMES[timeZone];
  const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

export function formatDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "–:––";
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
