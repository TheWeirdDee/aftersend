/**
 * Production configuration rules, as a pure function over an environment map. The same rules run in three places:
 * `npm run check:env` before a deploy, `/api/ready` after it, and the hard guards on hosted production. It reports
 * variable names and what is wrong with them; it never includes a value.
 */

export type ConfigReport = { problems: string[]; warnings: string[] };

const TEST_FLAGS = ["AFTERSEND_ALLOW_TEST_PROVIDER", "AFTERSEND_ALLOW_TEST_EMAIL"] as const;

/** True on Vercel's production environment, or when AFTERSEND_ENV=production says so explicitly. */
export function isHostedProduction(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === "production" || env.AFTERSEND_ENV === "production";
}

/**
 * Whether the session cookie carries the Secure attribute. Always in a production build; the single exception, a
 * local production build served over plain http for the browser tests, needs AFTERSEND_INSECURE_COOKIES, and hosted
 * production ignores that switch entirely.
 */
export function cookiesAreSecure(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" && (isHostedProduction(env) || !env.AFTERSEND_INSECURE_COOKIES);
}

function present(v: string | undefined) {
  return !!v && v.trim() !== "";
}

function hostAndPort(url: string): { host: string; port: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port };
  } catch {
    return null;
  }
}

export function checkProductionConfig(env: Record<string, string | undefined>): ConfigReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  const need = (name: string, why: string) => {
    if (!present(env[name])) problems.push(`${name} is not set (${why}).`);
  };

  // A connection string copied from a dashboard still has its password placeholder until someone fills it in.
  for (const name of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
    if (/\[YOUR-PASSWORD\]|\[PASSWORD\]|<password>/i.test(env[name] ?? "")) problems.push(`${name} still contains its password placeholder.`);
  }

  // Database: a hosted Postgres is the only option on a serverless host (the embedded one writes to a read-only disk).
  const db = env.DATABASE_URL;
  if (!present(db)) problems.push("DATABASE_URL is not set (production needs hosted Postgres; the embedded database cannot persist on a serverless host).");
  else if (!/^postgres(ql)?:\/\//.test(db!)) problems.push("DATABASE_URL must start with postgres:// or postgresql://.");
  else {
    const hp = hostAndPort(db!);
    if (hp && /^db\.[a-z0-9]+\.supabase\.co$/.test(hp.host)) {
      warnings.push("DATABASE_URL points at Supabase's direct host, which is IPv6-only on the free plan and unreachable from IPv4-only hosts; use the transaction pooler (port 6543).");
    }
    if (hp && hp.port === "5432" && /pooler\.supabase\.com$/.test(hp.host)) {
      warnings.push("DATABASE_URL uses the session pooler (port 5432) for the app; use the transaction pooler (port 6543) for the app and keep 5432 for MIGRATION_DATABASE_URL.");
    }
  }
  const mig = env.MIGRATION_DATABASE_URL;
  if (present(mig)) {
    if (!/^postgres(ql)?:\/\//.test(mig!)) problems.push("MIGRATION_DATABASE_URL must start with postgres:// or postgresql://.");
    else if (hostAndPort(mig!)?.port === "6543") warnings.push("MIGRATION_DATABASE_URL uses port 6543 (transaction mode): the migration lock cannot be held there; use the session pooler (port 5432).");
  } else if (present(db) && hostAndPort(db!)?.port === "6543") {
    warnings.push("MIGRATION_DATABASE_URL is not set, so migrations will run through the transaction pooler (port 6543), where the lock that serialises concurrent builds is not reliable. Set it to the session pooler URI (port 5432).");
  }

  // Storage.
  const driver = env.STORAGE_DRIVER || "local";
  if (driver === "local") problems.push("STORAGE_DRIVER is local (or unset): audio would be written to a disk that does not persist. Use supabase or s3.");
  else if (driver === "supabase") {
    need("SUPABASE_URL", "Supabase Storage");
    need("SUPABASE_SERVICE_ROLE_KEY", "server-only key for Supabase Storage");
    need("OBJECT_STORAGE_BUCKET", "the private audio bucket");
  } else if (driver === "s3") {
    need("OBJECT_STORAGE_BUCKET", "the private audio bucket");
    need("OBJECT_STORAGE_ACCESS_KEY", "S3 access key");
    need("OBJECT_STORAGE_SECRET_KEY", "S3 secret key");
  } else problems.push(`STORAGE_DRIVER=${driver} is not a known driver.`);

  // Speech.
  if ((env.SPEECH_PROVIDER || "assemblyai") !== "assemblyai") problems.push("SPEECH_PROVIDER must be assemblyai in production.");
  need("ASSEMBLYAI_API_KEY", "real speech");

  // Email and sign-in.
  if ((env.EMAIL_DRIVER || "resend") !== "resend") problems.push("EMAIL_DRIVER must be resend in production.");
  need("RESEND_API_KEY", "sign-in email");
  need("EMAIL_FROM", "sign-in email sender");
  if (!present(env.AUTH_SECRET)) problems.push("AUTH_SECRET is not set (it signs sign-in codes).");
  else if (env.AUTH_SECRET!.length < 32) problems.push("AUTH_SECRET is shorter than 32 characters.");
  if (!present(env.CRON_SECRET)) problems.push("CRON_SECRET is not set (the cleanup cron would be unauthenticated or unusable).");
  else if (env.CRON_SECRET!.length < 16) problems.push("CRON_SECRET is shorter than 16 characters.");

  // Things that must never be on in production.
  for (const flag of TEST_FLAGS) if (env[flag] === "1") problems.push(`${flag}=1 must not be set in production.`);
  if (present(env.AFTERSEND_INSECURE_COOKIES)) problems.push("AFTERSEND_INSECURE_COOKIES must not be set in production.");

  // The public address.
  if (present(env.APP_URL)) {
    const hp = hostAndPort(env.APP_URL!);
    if (!hp) problems.push("APP_URL is not a valid URL.");
    else {
      if (!env.APP_URL!.startsWith("https://")) problems.push("APP_URL must be an https:// URL in production.");
      if (/^(localhost|127\.|0\.0\.0\.0)/.test(hp.host)) problems.push("APP_URL points at localhost.");
    }
  } else {
    warnings.push("APP_URL is not set; link previews use Vercel's own production address. Set it once you have a final domain.");
  }

  const pool = Number(env.DATABASE_POOL_MAX ?? "3");
  if (!Number.isInteger(pool) || pool < 1 || pool > 20) problems.push("DATABASE_POOL_MAX must be an integer from 1 to 20.");
  const deadline = Number(env.SYNTHESIS_DEADLINE_MS ?? "50000");
  if (!Number.isFinite(deadline) || deadline >= 60000) problems.push("SYNTHESIS_DEADLINE_MS must be below the 60 s the generate route allows.");

  return { problems, warnings };
}
