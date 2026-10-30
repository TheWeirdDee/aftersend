# Deployment (prepared, not executed)

Nothing below has been run against real accounts. Every step needs the owner's accounts and approval. Free tiers are used wherever the code allows; the exact plan limits are the providers' to change, so check each dashboard before relying on a number.

## Architecture choices

| Need | Choice | Why |
|---|---|---|
| Web + API | Vercel (Next.js) | The app is a standard Next.js build; `vercel.json` already schedules the cleanup cron. |
| Database | Supabase Postgres (transaction pooler) | `postgres-js` with `prepare: false` is what the code uses; tested over the wire protocol (see Verification). |
| Audio storage | Supabase Storage, **private** bucket | The app proxies every audio request, so withdrawal and correction can be enforced. A public bucket would bypass them. |
| Email | Resend (HTTPS API) | One server-side key, no SMTP library, plain-text mail. |
| Auth | The app's own one-time-code sign-in | Supabase Auth was evaluated and **not** used: the app already owns sessions, ownership checks and workspaces in its own tables, and adding Supabase Auth would create a second identity store and a JWT layer to keep in sync with them, for no gain. Supabase is used only for Postgres and Storage. |
| Speech | AssemblyAI streaming TTS | The sponsor integration. |

## 0. Rotate the exposed AssemblyAI key

The key used in development was pasted into a chat. Treat it as compromised.

1. Open https://www.assemblyai.com/dashboard and go to **API Keys**.
2. Delete the old key. Create a new one named `aftersend-production`.
3. Keep it for step 5 below. Never paste it into chat, a commit or a browser-side variable.

## 1. Supabase: database and storage

1. https://supabase.com/dashboard → **New project**. Name `aftersend`, choose the region closest to your Vercel region, set a strong database password and save it in a password manager. The free plan is enough to start; do not enable paid add-ons.
2. **Database URLs.** Project → **Connect**. Copy two URIs and replace `[YOUR-PASSWORD]` in each: the **Transaction pooler** (port `6543`) is `DATABASE_URL`, used by the running app; the **Session pooler** (port `5432`, same pooler host) is `MIGRATION_DATABASE_URL`, used only to run migrations. Why two: migrations hold a lock so that two builds starting together cannot race, and a lock cannot be held through the transaction pooler. Do not use the *Direct connection* string: on the free plan it is IPv6-only (Supabase's shared poolers are IPv4-reachable on every plan).
3. **Private bucket.** Project → **Storage** → **New bucket** → name `aftersend-audio` → leave **Public bucket OFF** → create. This name is `OBJECT_STORAGE_BUCKET`. Do not add any storage policies; the server key bypasses them and nothing else should read the bucket.
4. **Server key.** Project → **Project Settings → API Keys**. Copy the **secret** key (`sb_secret_…`) or, on older projects, the `service_role` key. This is `SUPABASE_SERVICE_ROLE_KEY`. It is server-only: never prefix it with `NEXT_PUBLIC_`. Also copy the **Project URL** (`https://<ref>.supabase.co`) for `SUPABASE_URL`.

Migrations run **in the build, never at application start**. `vercel-build` runs `npm run db:migrate -- --if-configured --production-only` before `next build`: it takes an advisory lock, applies pending migrations from `drizzle/`, and a failure fails the build, so the previous deployment keeps serving. It is skipped on Preview and Development builds, so a preview that inherited the production database URL can never migrate production, and a *production* build with no database URL fails instead of skipping. The app itself only auto-migrates the embedded database used in local development. To apply manually: `MIGRATION_DATABASE_URL=… npm run db:migrate`. Every migration so far only adds tables, columns and indexes, so the previous deployment keeps working while a new one is being built (see `docs/RELEASE_RUNBOOK.md` for the rule going forward).

## 2. Resend: email

1. https://resend.com/signup, then https://resend.com/api-keys → **Create API Key** (permission *Sending access*). This is `RESEND_API_KEY`.
2. **Sender (done for this project).** The domain `micromindapp.xyz` is verified in Resend and a key named `aftersend-production` with *Sending access* exists. Use `EMAIL_FROM="AfterSend <login@micromindapp.xyz>"`: recipients see the display name **AfterSend**; the address part necessarily shows the verified domain, so a mail client that shows the full address will show `micromindapp.xyz`. No mailbox needs to exist for `login@`; Resend sends for the whole verified domain. If replies to that address should go somewhere, that is a separate Resend/DNS decision; the app sends no `Reply-To`.
3. **Sharing the Resend account with other applications (Micromind and so on).** AfterSend only ever calls `POST /emails` with its own key, from its own sender address. It creates no domains, audiences, contacts, webhooks or API keys, and never lists or reads other mail, so it cannot change another app's configuration. What *is* shared is the **account quota** (free plan: 100 emails a day, 3 000 a month, counted per UTC day across every application and domain) and Resend's request-rate limit. To stop AfterSend using up everyone's allowance, the app caps its own sign-in emails at `AUTH_EMAILS_PER_DAY` (default **60** per UTC day, all addresses together) on top of 5 per address per hour and 20 per IP per hour; when the cap is reached new codes are refused with a "try again later" message while people who already hold a code can still sign in. Lower it if the other applications need more of the 100. Watch the day's usage at https://resend.com/emails.
4. **Check delivery with the real provider** (no person's mailbox involved): `npm run email:probe` sends one message through AfterSend's own sender to Resend's test address `delivered@resend.dev`. To see the message and the sender name yourself, run `npm run email:probe -- --to <your own mailbox>` and look at the From line.

## 3. Secrets you generate yourself

Run these locally and paste the output into Vercel (not into chat or git):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # CRON_SECRET
```

`AUTH_SECRET` signs sign-in codes. Rotating it invalidates only codes that are currently outstanding (at most 10 minutes' worth). `CRON_SECRET` protects `/api/cron/cleanup`; Vercel sends it as a bearer token automatically.

## 4. Vercel

1. https://vercel.com/new → import the GitHub repository (the framework preset is Next.js). **Do not click Deploy yet.**
2. **Settings → Environment Variables**. Give every variable below the **Production** scope **only**. Leave Preview and Development empty: a preview would otherwise talk to the production database, storage and AssemblyAI account. (Previews then have no working backend; that is the safe default for a single-database project. To use previews, create a second Supabase project and give previews their own values.)

| Name | Value |
|---|---|
| `APP_URL` | optional for the first deploy; set `https://<final-domain>` (no trailing slash) once you have it. Unset, link previews use Vercel's production address (`VERCEL_PROJECT_PRODUCTION_URL`) and the dashboard's share links use the host of the request, so nothing points at localhost. |
| `DATABASE_URL` | the **transaction**-pooler URI from §1.2 (port 6543) |
| `MIGRATION_DATABASE_URL` | the **session**-pooler URI from §1.2 (port 5432) |
| `DATABASE_POOL_MAX` | `3` (use `1` if Supabase reports connection limits) |
| `STORAGE_DRIVER` | `supabase` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key from §1.4 |
| `OBJECT_STORAGE_BUCKET` | `aftersend-audio` |
| `SPEECH_PROVIDER` | `assemblyai` |
| `ASSEMBLYAI_API_KEY` | the **new** key from §0 |
| `EMAIL_DRIVER` | `resend` |
| `RESEND_API_KEY` | the full secret of the `aftersend-production` key (shown once, when it was created) |
| `EMAIL_FROM` | `AfterSend <login@micromindapp.xyz>` |
| `AUTH_EMAILS_PER_DAY` | optional; default `60` (see §2.3) |
| `AUTH_SECRET` | from §3 |
| `CRON_SECRET` | from §3 |

   Optional: `ASSEMBLYAI_TTS_VOICES` (default `aai-jane,aai-kyla`), `ASSEMBLYAI_TTS_ENDPOINT` (default US; the EU endpoint is untested), `SYNTHESIS_DEADLINE_MS` (default 50000; must stay under the route's `maxDuration = 60`, so confirm your Vercel plan allows 60 s functions).

   **Never set in production:** `AFTERSEND_ALLOW_TEST_PROVIDER`, `AFTERSEND_ALLOW_TEST_EMAIL`, `AFTERSEND_INSECURE_COOKIES`, `SPEECH_PROVIDER=test`, `EMAIL_DRIVER=file`. The verification script fails if any of them is live.
3. Click **Deploy**. Before you do, run `npm run check:env -- --file <file>` against the values you entered (see §5); it names anything missing or unsafe without printing a value. The build runs the migrations; a database failure fails the build rather than shipping a broken app.

## 5. Verify the deployment

**Before the first deploy (and before every later one that changes variables),** check the configuration itself. In Vercel, **Settings → Environment Variables** has no export; use the CLI (`npm i -g vercel`, then `vercel link`) and `vercel env pull .env.production.local --environment=production`, then:

```
npm run check:env -- --file .env.production.local
```

It fails on: a missing required variable, the local storage driver or embedded database, any test double or insecure switch, secrets that are too short, an `http`/localhost `APP_URL`, a deadline at or above the route limit, and warns about the direct-connection and wrong-pooler mistakes. Delete `.env.production.local` afterwards; it is gitignored but holds your secrets.

From a machine with the repository (no secrets needed for the first command):

```
npx tsx scripts/verify-deployment.ts https://<your-domain>
```

It checks liveness, readiness (database, speech, storage, email, auth), that the real providers (not test doubles) are live, security headers, the CSRF refusal, anonymous refusals and the cron guard. It sends no email and makes no speech request.

Then, with the Supabase variables exported in the same shell (they are only read, never printed):

```
npx tsx scripts/verify-deployment.ts https://<your-domain> --storage
```

It asserts the bucket is private, that a probe object is unreachable anonymously through every public URL shape, and that the server key can still read and write. After you have published and then corrected a notice, add `--object-key published/<notice-id>/<revision-id>/<sha>.wav` (take it from the `audio_assets` table) to prove a superseded object is unreachable through storage as well.

Then the speech checks, locally, with the new key:

```
ASSEMBLYAI_API_KEY=… npm run tts:smoke -- --runs 3 --long --timeout-probe
npm run audio:inspect -- evidence/raw/audio/*.wav
```

and have a person complete `docs/LISTENING_REVIEW.md`.

Finally the whole journey over HTTP against the real stack, which sends two real emails (you will be asked to type each 6-digit code), spends two AssemblyAI syntheses and checks that superseded audio is not readable from storage:

```
npm run verify:live -- https://<your-domain> --email <a mailbox you can read> --email2 <a second mailbox> --confirm-live
```

It refuses to run against a target that reports test speech or test email, writes `evidence/live-journey-<time>.json` (no codes, cookies or addresses), and does not prove that anyone listened. Rehearse it first against a local build with `--rehearsal --outbox <dir>`; rehearsal output is labelled as not live evidence.

Finally run the judge path on the deployed URL from a phone and a desktop: sign in with email, create a notice, generate, listen, publish, open the link in a private window, correct 3:00 → 4:00 PM, approve, refresh the same link, withdraw, clear cookies, sign in again and find the notice. Run Lighthouse against the deployed URL and record the numbers in `RESULTS.md`.

## 6. Operating it

- **Logs.** The app writes one JSON object per line to stdout (`event`, `level`, timestamps). In Vercel: project → **Logs**; filter on `auth.`, `synthesis.` or `request.failed`. Credentials are redacted by field name and sign-in events reference an address only by a short hash.
- **Cron.** `vercel.json` runs the cleanup daily at 03:17 UTC: expired previews, abandoned publish copies, expired sessions, rate-limit rows and spent sign-in codes.
- **Withdrawing a notice for a user who has lost access to their email** (rare): in the Supabase SQL editor, `update notices set state = 'withdrawn', withdrawn_at = now() where public_token = '<token>';`. Application access to its audio stops immediately.
- **Rolling back a bad deploy.** Vercel → Deployments → promote the previous deployment. Migrations in this repository only add columns and tables, so the previous build keeps working against the newer schema.
- **Costs.** Nothing here enables a paid service. AssemblyAI usage is billed by that account; the app rate-limits synthesis per user and IP (`SYNTHESIS_LIMIT_PER_HOUR`).

## Platform limits this design depends on (checked 30 Oct 2026)

Looked up in the providers' documentation on the date above; they can change, so re-check anything that looks wrong in your own dashboard.

| Question | Answer | Consequence here |
|---|---|---|
| Is a 60 s speech request allowed on Vercel? | With Fluid compute (the default), Hobby functions have a 300 s default and maximum; without it, Hobby is limited to 60 s. A function that overruns gets a 504. ([Vercel Functions limits](https://vercel.com/docs/functions/limitations), [Fluid compute](https://vercel.com/docs/fluid-compute)) | The generate route sets `maxDuration = 60` and the synthesis deadline is 50 s, which fits both ways. `check:env` refuses a deadline of 60 s or more. |
| Cron on the free plan? | Hobby cron jobs run at most once a day, only on production deployments, and may fire anywhere inside the scheduled hour. The `CRON_SECRET` variable is sent as a bearer token. ([Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), [managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)) | `vercel.json` schedules one daily job (03:17 UTC), which is allowed; the route still authenticates the bearer token itself. |
| Which Supabase connection for what? | Transaction pooler (6543): serverless apps; no prepared statements. Session pooler (5432): IPv4-reachable, supports session features. Direct connection: IPv6-only unless the paid IPv4 add-on is bought. ([Supabase: connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)) | App on 6543 with `prepare: false`; migrations on 5432 with a lock; direct connection avoided. |
| Can Resend mail anyone on the free plan? | Only from a **verified domain**. `onboarding@resend.dev` may send only to the Resend account owner's own address (otherwise a 403). Free plan: 100 emails a day, 3 000 a month. ([Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [403 with resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)) | Without a domain, only your own mailbox can sign in. With 5 codes per address per hour a normal day stays far below 100. |

## What has and has not been verified

Verified locally (see `RESULTS.md`): the whole journey against PGlite and the local object store; the `postgres-js` driver, migrations, transactions and row locks over the Postgres wire protocol using PGlite behind a socket; restart persistence of the local drivers; the Supabase Storage driver against a mocked HTTP API; the deployment script's logic against a local production build.

**Not verified:** anything against real Supabase, Resend, Vercel or AssemblyAI infrastructure with the new credentials. Those are the steps above.
