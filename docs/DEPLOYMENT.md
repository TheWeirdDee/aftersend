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
2. **Database URL.** Project → **Connect** → **Transaction pooler**. Copy the URI (port `6543`) and replace `[YOUR-PASSWORD]`. This is `DATABASE_URL`.
3. **Private bucket.** Project → **Storage** → **New bucket** → name `aftersend-audio` → leave **Public bucket OFF** → create. This name is `OBJECT_STORAGE_BUCKET`. Do not add any storage policies; the server key bypasses them and nothing else should read the bucket.
4. **Server key.** Project → **Project Settings → API Keys**. Copy the **secret** key (`sb_secret_…`) or, on older projects, the `service_role` key. This is `SUPABASE_SERVICE_ROLE_KEY`. It is server-only: never prefix it with `NEXT_PUBLIC_`. Also copy the **Project URL** (`https://<ref>.supabase.co`) for `SUPABASE_URL`.

Migrations run during the Vercel build (`vercel-build` → `npm run db:migrate -- --if-configured`), so no SQL needs to be pasted by hand. To apply them manually: `DATABASE_URL=… npm run db:migrate`.

## 2. Resend: email

1. https://resend.com/signup, then https://resend.com/api-keys → **Create API Key** (permission *Sending access*). This is `RESEND_API_KEY`.
2. **Sender.** Without a domain, Resend only delivers from `onboarding@resend.dev` and only to the address that owns the Resend account. That is enough to test your own sign-in: set `EMAIL_FROM` to `AfterSend <onboarding@resend.dev>` and sign in with your own email. For anyone else to receive codes, add a domain at https://resend.com/domains, add the DNS records it shows, wait for **Verified**, and set `EMAIL_FROM` to `AfterSend <login@your-domain>`.
3. Codes expire in 10 minutes and are limited to 5 requests per address per hour, so the free sending quota is not a practical constraint, but check the plan's daily limit in the Resend dashboard.

## 3. Secrets you generate yourself

Run these locally and paste the output into Vercel (not into chat or git):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # CRON_SECRET
```

`AUTH_SECRET` signs sign-in codes. Rotating it invalidates only codes that are currently outstanding (at most 10 minutes' worth). `CRON_SECRET` protects `/api/cron/cleanup`; Vercel sends it as a bearer token automatically.

## 4. Vercel

1. https://vercel.com/new → import the GitHub repository (the framework preset is Next.js). **Do not click Deploy yet.**
2. **Settings → Environment Variables**, scope **Production** (and Preview if you want previews to work). Add exactly:

| Name | Value |
|---|---|
| `APP_URL` | `https://<your-domain>` (no trailing slash) |
| `DATABASE_URL` | the transaction-pooler URI from §1.2 |
| `DATABASE_POOL_MAX` | `3` (use `1` if Supabase reports connection limits) |
| `STORAGE_DRIVER` | `supabase` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key from §1.4 |
| `OBJECT_STORAGE_BUCKET` | `aftersend-audio` |
| `SPEECH_PROVIDER` | `assemblyai` |
| `ASSEMBLYAI_API_KEY` | the **new** key from §0 |
| `EMAIL_DRIVER` | `resend` |
| `RESEND_API_KEY` | from §2.1 |
| `EMAIL_FROM` | from §2.2 |
| `AUTH_SECRET` | from §3 |
| `CRON_SECRET` | from §3 |

   Optional: `ASSEMBLYAI_TTS_VOICES` (default `aai-jane,aai-kyla`), `ASSEMBLYAI_TTS_ENDPOINT` (default US; the EU endpoint is untested), `SYNTHESIS_DEADLINE_MS` (default 50000; must stay under the route's `maxDuration = 60`, so confirm your Vercel plan allows 60 s functions).

   **Never set in production:** `AFTERSEND_ALLOW_TEST_PROVIDER`, `AFTERSEND_ALLOW_TEST_EMAIL`, `AFTERSEND_INSECURE_COOKIES`, `SPEECH_PROVIDER=test`, `EMAIL_DRIVER=file`. The verification script fails if any of them is live.
3. Click **Deploy**. The build runs the migrations; a database failure fails the build rather than shipping a broken app.

## 5. Verify the deployment

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

Finally run the judge path on the deployed URL from a phone and a desktop: sign in with email, create a notice, generate, listen, publish, open the link in a private window, correct 3:00 → 4:00 PM, approve, refresh the same link, withdraw, clear cookies, sign in again and find the notice. Run Lighthouse against the deployed URL and record the numbers in `RESULTS.md`.

## 6. Operating it

- **Logs.** The app writes one JSON object per line to stdout (`event`, `level`, timestamps). In Vercel: project → **Logs**; filter on `auth.`, `synthesis.` or `request.failed`. Credentials are redacted by field name and sign-in events reference an address only by a short hash.
- **Cron.** `vercel.json` runs the cleanup daily at 03:17 UTC: expired previews, abandoned publish copies, expired sessions, rate-limit rows and spent sign-in codes.
- **Withdrawing a notice for a user who has lost access to their email** (rare): in the Supabase SQL editor, `update notices set state = 'withdrawn', withdrawn_at = now() where public_token = '<token>';`. Application access to its audio stops immediately.
- **Rolling back a bad deploy.** Vercel → Deployments → promote the previous deployment. Migrations in this repository only add columns and tables, so the previous build keeps working against the newer schema.
- **Costs.** Nothing here enables a paid service. AssemblyAI usage is billed by that account; the app rate-limits synthesis per user and IP (`SYNTHESIS_LIMIT_PER_HOUR`).

## What has and has not been verified

Verified locally (see `RESULTS.md`): the whole journey against PGlite and the local object store; the `postgres-js` driver, migrations, transactions and row locks over the Postgres wire protocol using PGlite behind a socket; restart persistence of the local drivers; the Supabase Storage driver against a mocked HTTP API; the deployment script's logic against a local production build.

**Not verified:** anything against real Supabase, Resend, Vercel or AssemblyAI infrastructure with the new credentials. Those are the steps above.
