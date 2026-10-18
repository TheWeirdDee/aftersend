import { json, route } from "@/lib/http/route";
import { speechProvider } from "@/lib/speech";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const p = speechProvider();
  const c = p.isConfigured();
  return json({ provider: p.kind, configured: c.ok, reason: c.ok ? null : c.reason, voices: p.listVoices() });
});
