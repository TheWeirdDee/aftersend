/**
 * The public origin of this deployment, for absolute URLs in page metadata (link previews).
 *
 * `APP_URL` wins. Without it, Vercel's system variables are used, so the first deployment already advertises its
 * own address instead of localhost; the production domain is preferred over the per-deployment one so previews of
 * a shared link keep pointing at the stable address. Request-time share links in the dashboard use the request's own
 * host instead (see origin.ts).
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, "");
  const host = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  if (host) return `https://${host}`;
  return "http://localhost:3000";
}
