# AfterSend — measured results

This file holds measurements only. Targets and plans live in `docs/`. Every number below names how it was taken.

## Eighth pass, 3 November 2026: recovery and redesign (live on production)

Commit `142cd42` on `main`, deployed to https://aftersend-sigma.vercel.app. Evidence classes are kept apart below.

**Live (the deployed site, real AssemblyAI speech).**
- `npm run verify:deploy -- <url> --storage`: 23 of 23 checks passed after the deploy. Migration `0003` is applied (4 of 4 migrations, `notice_revisions.source_url` present; read-only query).
- `npm run verify:live:guest`: 7 of 7 steps passed, `evidence/live-guest-2026-11-03T09-56-22-363Z.json`: guest session with the sample announcement; speech (15.8 s of 24 kHz WAV, provider 1.5 s, request 9.2 s); publish, the public link serves text and audio; correction to 4:00 PM (18.2 s of audio, provider 1.7 s) with the public link unchanged until approval; approval, the same link serves 4:00 PM and a new audio file; the superseded audio returns 404; withdrawal, the page says so and no audio is served.
- A recorded browser run of the same journey in the real UI (editor with automatic speech, listening gate, publish, correction, same link): `evidence/demo-video/`. It ran to the end without an error. It is silent and captioned; caption timings in the `.srt` are measured from the start of the script and may be about a second off the video.
- `npm run tts:smoke` (local, real service, 2 requests): both succeeded, first audio in 0.9 and 1.4 s, 2.6 and 3.1 s in total, `evidence/tts-smoke-2026-11-03T09-18-17-234Z.json`.

**Automated (not live).** Local: lint and typecheck clean; 309 of 309 unit and integration tests; 55 of 55 browser tests on Chromium (desktop and mobile projects); Firefox playback passed twice earlier the same day before this machine's audio output began failing. GitHub Actions, run `41613559968` on the pull request: `verify` passed with 309 of 309 unit and integration tests (including two migrators started at once against a real Postgres 16 service container, each migration applied once) and 56 passed and 1 skipped browser tests (WebKit playback passed on Linux; Firefox skipped because the runner has no sound device). The speech provider in these tests is the labelled test tone: they prove application behaviour, not speech quality.

**Defects found and fixed**, with root causes, in `docs/DEFECT_LOG.md`: the red CI job (two simultaneous migrators against a one-connection test database); a listening gate that stalled when the browser failed to open the audio output (measured as `MediaError 3, AUDIO_RENDERER_ERROR`, not a server or file fault); edits refused while speech was being prepared; a late older status answer overwriting a newer one; no speech after a retried save; a sample date whose weekday did not match.

**Not verified.**
- No person has listened to the speech (`docs/LISTENING_REVIEW.md` unsigned).
- Sign-in email delivery, email recovery and the two-account boundary on the deployed site: they need a code from a real inbox. Covered by the integration and browser tests, not re-run live.
- Saving a guest to an email on the deployed site (same reason).
- Safari itself; Firefox with a working sound device in CI.
- The demo video has no narration and does not show saving the account. The hackathon's required length is unconfirmed.
- Whether an AssemblyAI key exposed earlier has been deleted.
- Cross-device behaviour of the guest 30-day window beyond what the integration tests cover.

## Seventh pass, 3 November 2026: review findings fixed, gates re-run

Starting point: a source review (not by me, not reproduced at the time) listed five defects and some unproven items. Each was checked against the source first; all five were real. **Nothing in this pass was deployed or pushed, and nothing was run against production.** The deployed build is still the one from 30 October.

### The three kinds of evidence, kept apart

| Kind | What it covers | Status |
|---|---|---|
| **Live** (real services, real deployment) | 30 Oct: AssemblyAI synthesis, Resend acceptance, Supabase migrations, private bucket, 23 of 23 deployment checks (`evidence/verify-deploy-2026-10-30.txt`) | Historical. Not re-run today |
| **Live journey** (publish, correct, withdraw, recover, two accounts, storage URLs) | The one attempt (`evidence/live-journey-2026-10-30T16-37-26-196Z.json`) stopped at sign-in because no code was supplied within 9 minutes: **2 steps passed, 11 failed from missing state, 2 never ran. It proves nothing about the product.** | **Not verified** |
| **Mocked or local tests** (PGlite, local store, fake transports, Playwright on a local production build) | Everything below | See the table |
| **Manual listening** | `docs/LISTENING_REVIEW.md` | **Unsigned. Nobody has listened.** |

### Defects fixed

| Finding | Confirmed by | Fix | Tests that fail without it |
|---|---|---|---|
| Storage calls had no deadline, so a slow store could outlive the function before the outcome was recorded | Source: `store.put/get` awaited with no signal | Every storage request has a hard deadline (abort signal plus an independent timer); during generation it is clamped to the time left, and a timeout fails the attempt as a retryable `timeout` with the outcome recorded; during approval it becomes a retryable 503 | `storage-deadlines.test.ts` (9), `storage-deadline.test.ts` (4) |
| Readiness probes shared one object key | Source: one constant key | Random key per probe, removed in `finally` | `storage-deadlines.test.ts` (overlapping probes) |
| Live journey cascaded after a failed prerequisite | The 30 Oct evidence file: 11 consecutive errors after one sign-in failure | Each step names its prerequisites; a step whose prerequisite did not pass is recorded as skipped with the reason; the report counts failed and skipped separately | `journey-needs.test.ts` (7), which also checks the table against the real step names in the script |
| A published notice's source link could not be corrected (the editor stopped sending it, the API ignored it) | Source | The link is stored per revision (`notice_revisions.source_url`, migration `0003`, backfilled from the notices) and goes live in the same transaction as its revision, so a draft never changes the public page | `source-link.test.ts` (10), including the migration run over old-shape data |
| Abandoned demo workspaces and their audio were never removed | Source | `cleanupAbandonedDemos` in the daily cron: demo, no email, at least 7 days old, no live session. Bytes first; a storage failure leaves the workspace whole; at most 25 per run | `demo-cleanup.test.ts` (10) |

**Mutation check.** 18 deliberate breakages of the new code (removing a deadline, a guard, the migration backfill, the session condition and so on) were each run against the tests. 17 failed as they should; one survived, because the test only covered a workspace with an email, so I added the missing case (a non-demo workspace with no email) and the survivor is now caught. All 18 are caught.

### Other changes in this pass
Environment hygiene after the inline-comment incident: `.env.example` has no inline comments; `check:env` reads the raw file; the production check (also run by `/api/ready` and `verify:deploy`) refuses inline comments, quote characters and non-integers in numeric settings; `npm run env:sync` (dry run by default) copies `.env.local` to Vercel Production only after those checks; `npm run db:set-password` percent-encodes a new database password, tests both URLs and updates `.env.local` only if both connect. New setting `STORAGE_TIMEOUT_MS` (default 10000). Documentation reconciled: the README status, the submission draft (live address and measured AssemblyAI numbers filled in) and a "current status" section at the top of the audit that supersedes the historical list.

### Gates on the final committed code

| Gate | Result |
|---|---|
| Typecheck, lint | **clean** |
| Production build | **succeeded** (run on the code before the final two test-only commits) |
| Unit and integration (Vitest) | **289 of 289 passed** with 3 workers. With default parallelism on this machine the runs failed three different ways: worker processes ran out of memory (`Fatal process out of memory: Zone`), a test that launches a real `tsx` process timed out at 30 s, and two timing assertions of mine were too tight. The assertions were loosened; the rest is the machine |
| Browser (Playwright, production build) | **Not a clean pass.** Best full run: **43 of 49**, one worker. The 6 failures are always the same step, the "I listened to the preview" box never enabling because the browser reports the preview audio "can't be played right now". The server side is fine (the audio request answered 206 with the full 236 KB in 126 ms). **The previous commit, `0368ae1`, which passed 49 of 49 on 30 Oct, also fails 6 of 49 on this machine today**, so this pass did not cause it. The failing tests differ from run to run (three recur), and tests that failed in one run passed alone or in a group of six, and vice versa. Cause not established; free memory was 0.8 to 2 GB of 8 GB with several other dev servers running. Every one of the 49 tests has passed on the current code at least once today, but **not in one run** |

### Still not done
Full journey on production; superseded and withdrawn audio read directly from storage; two-account boundary on production; the migration lock under concurrent builds; human listening; confirmation that the exposed AssemblyAI key was deleted; the demo video; deploying the fixes above (they need a production build, which runs migration `0003`).

## Sixth pass, 30 October 2026: real database, real storage, first production deployment

Observed with the owner's `.env.local` (never printed) and the Vercel CLI logged in as the owner. The code was not changed in this pass; the commit under test is the one at the top of the fifth pass.

| Check | Result |
|---|---|
| `npm run check:env -- --file .env.local` | **0 problems**, 1 warning (`APP_URL` blank locally; it is set on Vercel) |
| Migrations against the real Supabase database (session pooler, port 5432) | **Applied.** Tables present afterwards: `audio_assets`, `auth_challenges`, `notice_revisions`, `notices`, `rate_limits`, `sessions`, `synthesis_attempts`, `users` |
| The app's own database client against the real transaction pooler (port 6543) | `select 1` succeeded; a local production server with the real env answered `/api/health` and `/api/ready` with 200 (database, speech, storage, email all ok) |
| Deployment to Vercel production (`aftersend-sigma.vercel.app`), by CLI from the working tree | **Ready.** Nothing was pushed to GitHub |
| `npm run verify:deploy -- https://aftersend-sigma.vercel.app --storage` | **23 of 23 passed** (`evidence/verify-deploy-2026-10-30.txt`): `/api/health` and `/api/ready` 200, speech is AssemblyAI, email is Resend, production config check ok, security headers, CSRF refusal, anonymous workspace access refused, cron refuses anonymous calls |
| Storage bucket `aftersend-audio` | Exists, **private**; the server key can write and read; a probe object is **not** readable anonymously through the public, plain or authenticated URL shapes |
| Email: probe to the owner's Gmail through the app's sender | Delivered to the inbox; the From line reads `AfterSend <login@micromindapp.xyz>` (owner's screenshot) |

### Defects found while deploying (all in deployment procedure, none in the application)

| Defect | Evidence | Fix |
|---|---|---|
| Hosted variables were first stored with a mangled value, so the app answered 503 and 500 | `/api/health` 503, `/api/ready` 500; runtime log: `ZodError` for `DATABASE_POOL_MAX`, `ASSEMBLYAI_TTS_TIMEOUT_MS`, `SYNTHESIS_DEADLINE_MS` (NaN) | The three numeric lines in `.env.local` carry a trailing `# comment`; the local loader strips it, my copy to Vercel did not. Re-added with comments stripped; redeploy then passed 23/23 |
| `vercel env add` through a Windows shell kept literal quotes in values | Same log | Call the CLI without a shell and pass the value with `--value` |
| `vercel env pull` shows production values as empty | Pulled file | Not a fault: Vercel marks Production variables sensitive by default, so they cannot be read back. Verify through `/api/ready`, which reports the configuration check |

### Not done

The two-mailbox live journey (`npm run verify:live`) needs the owner to type two codes from a real inbox and was not run. Nobody has listened to the audio. The migration lock (`pg_advisory_lock`) has not been exercised by two concurrent builds. Superseded-audio direct access was not tested against a real published notice. The exposed AssemblyAI key's deletion is unconfirmed.

## Fifth pass, 30 October 2026: first live provider checks

Observed on one Windows 11 machine, Node 24, with the real AssemblyAI and Resend keys from the owner's `.env.local` (never printed). **Not done: anything that needs the Supabase database password or service key, a deployment, or a human listening.**

### Live AssemblyAI (real service)

| Check | Result |
|---|---|
| Both voices, 3 runs each, original and corrected notice | **12 of 12 succeeded.** Median 1.0 s to first audio, 2.7 s total, for 15 to 19 s of audio |
| Long notice, 2 074 characters (two `Generate` frames) | **2 of 2 succeeded**, about 133 s of audio in about 13 s |
| Provider-reported duration vs audio actually received | **Equal on all 23 successful syntheses (0 ms difference).** The assumption behind the completeness check holds |
| Timeout probe (150 ms budget) | Refused as retryable `timeout` in 157 ms |
| Rate limit | **5 new sessions per minute on this plan, account-wide.** The 6th is refused with code 3009, `retry_after_seconds` given. Reproduced twice (`evidence/tts-session-limit-probe-2026-10-30.jsonl`) |
| 25 WAV files inspected | All valid 24 kHz mono 16-bit; 0 clipped samples; peaks -10.1 to -2.9 dBFS; no pause over 700 ms (`evidence/audio-inspection-live-2026-10-30.jsonl`) |
| Pronunciation, naturalness, "3:00 PM" / "4:00 PM" spoken clearly | **Not reviewed. No one has listened.** |
| EU endpoint | Not tried |
| Whether the key in `.env.local` replaced the exposed one | **Cannot be told from the key itself** (a rotated key has the same format and length). Confirm in the AssemblyAI dashboard that the old key is deleted |

### Defects found by the live checks, and fixed

| Defect | Evidence | Fix | Test |
|---|---|---|---|
| The adapter sent the whole script in one `Generate` frame; the service accepts at most 2 000 characters per frame | The limits page; the product allows 6 000-character notices | Split into frames of at most 1 800 characters at sentence ends, rejoined exactly | `provider-and-security.test.ts`, `assemblyai-adapter.test.ts`; the 2 074-character live run succeeded |
| Retry backoff (2 s, then 4 s) could never outlast the provider's one-minute rate-limit window; every retry also spends one of the 5 sessions | First unpaced live run: 5 successes, then 7 consecutive `rate_limited` | The provider's `retry_after_seconds` is read and honoured when it fits the request budget; otherwise the request stops at once and tells the user how long to wait (HTTP 429 with `Retry-After`) | `reliability.test.ts` (waits the hinted time; fails fast when it cannot fit), parser test on the exact frame the service sent |
| Provider error wording was discarded, so a failure could not be diagnosed from logs | Reading the rate-limit rejections | Kept truncated in `providerDetail` for logs only, never shown to users | `provider-and-security.test.ts` |

**Consequence for the product:** on the free AssemblyAI plan, more than five audio generations (including regenerations) in one minute, across all users, will be told to wait. A paid plan raises the allowance.

### Live Resend (real service, verified domain `micromindapp.xyz`)

| Check | Result |
|---|---|
| `npm run email:probe` to Resend's own test address `delivered@resend.dev`, through AfterSend's own sender | **Accepted by Resend in 952 ms**, message id returned. Sender configured as `AfterSend <login@micromindapp.xyz>` |
| Same probe from an unverified domain | **Refused (403)**, classified non-retryable, response body not echoed |
| Local production build with the real Resend driver, sign-in endpoint over HTTP | Request: 202; a second request inside the 30 s cooldown: 202 and **no second send**; the log holds one send with a Resend message id and no address or code; six wrong codes all answered `invalid_code`; a request without the same-origin header: 403 |
| Secrets in the server log | None of `RESEND_API_KEY`, `AUTH_SECRET`, `CRON_SECRET`, `ASSEMBLYAI_API_KEY` appear |
| Reading the message back from Resend | 401: a sending-only key cannot read messages, so the delivery event is not visible to the tooling |
| **Not verified** | That a code email lands in a real inbox, how the sender renders there, and a full sign-in and recovery with real mail. Run `npm run email:probe -- --to <your mailbox>`, then `npm run verify:live` |

Expiry, replay, lockout, rate limiting and recovery were tested earlier against the file mailbox; they are independent of the transport and are not repeated against real mail.

### Shared-account protection added

The Resend free quota (100 emails a day, per account) is shared with Micromind and any other application. A global cap, `AUTH_EMAILS_PER_DAY` (default 60 per UTC day, counted only when an email is about to be sent), now sits on top of the per-address and per-IP limits. Test: the cap refuses new codes once reached, requests inside the cooldown do not count, and someone already holding a code can still sign in.

### Other changes

The production checker now reports a connection string that still contains `[YOUR-PASSWORD]`. The browser-test server is pinned so that a populated `.env.local` (real keys, Supabase) can never reach it.

### Tests (final code)

| Suite | Result |
|---|---|
| Unit + integration (Vitest) | **226 passed, 0 failed** (18 files) |
| Browser (Playwright, production build) | **49 passed, 0 failed**, one full run |
| Typecheck, lint, production build | clean |

### Still not done (inputs needed)

Supabase: the database password and the service key are not in `.env.local`, so nothing was run against the real database or storage (migrations, the private bucket, the direct-access test of superseded audio, `verify:deploy --storage`). Vercel: not deployed. Live journey: needs a mailbox the tester can read. Human listening review: not done.

## Fourth pass, 30 October 2026: release preparation

Observed on one Windows 11 machine, Node 24. **No real Supabase, Resend, Vercel or AssemblyAI account was used, and no replacement AssemblyAI key exists, so nothing in this pass is live evidence.** What it did: audit the deployment design against the implementation and the providers' own documentation, fix what was wrong, and build and rehearse the tools that will produce live evidence.

### Defects found and fixed

| # | Defect | Effect if shipped | Fix | Test |
|---|---|---|---|---|
| 1 | `layout.tsx` fell back to `http://localhost:3000` for page metadata when `APP_URL` was unset | Link-preview images and URLs pointed at localhost on a first deploy | `siteUrl()`: `APP_URL`, then Vercel's production address, then the deployment address | `production-config.test.ts` |
| 2 | `vercel-build` migrated whenever a database URL was present | A preview build that inherited the production URL would migrate production | `--production-only`: skipped on preview/development builds | `migrate-script.test.ts` (real process) |
| 3 | `--if-configured` skipped migrations when no database URL existed, even on a production build | A production deploy with no database would succeed and then fail at runtime | A production build with no database URL fails | `migrate-script.test.ts` |
| 4 | Migrations ran through whatever `DATABASE_URL` was, with no lock | Two builds starting together could race on the migration journal; the documented URL was the transaction pooler, where a lock cannot be held | Advisory lock; `MIGRATION_DATABASE_URL` (session pooler) preferred; a warning when falling back to port 6543 | Applying twice at once leaves each migration applied exactly once (`hosted-postgres.test.ts`). **The lock itself is not proven: see below.** |
| 5 | Hosted database connections: no TLS requirement, no idle or connect timeout | Plaintext to a hosted database; hung instances on a slow database | TLS for every non-local host (`DATABASE_SSL=disable` to override), 20 s idle and 10 s connect timeouts | `production-config.test.ts` (TLS rule only) |
| 6 | The test speech provider, the file mailbox and insecure cookies were guarded only by opt-in variables | One stray variable in production would leave a test double or a non-Secure cookie live | Refused outright on hosted production (`VERCEL_ENV=production` or `AFTERSEND_ENV=production`) whatever the variables say; `/api/ready` also reports the full configuration check there | `production-config.test.ts` |
| 7 | Command-line scripts did not read `.env.local` (only Next.js does) | A key saved in `.env.local` would have been silently ignored by `npm run tts:smoke` | Scripts load `.env.local` (shell values win, blanks ignored) | loader check, `env-file` parser test |
| 8 | The cleanup cron route had no `maxDuration` | A large cleanup could be cut off at the default limit | `maxDuration = 60` | none (platform setting) |
| 9 | My own `check:env` parser read `KEY=   # comment` as a value | Missing keys looked present | Matches dotenv: a comment-only value is blank | `production-config.test.ts` |
| 10 | My own `verify:live` kept going after the target failed the live-capability check | It would have sent email and asked for codes against a test deployment | Aborts before touching the target; writes no report | run against a local test server (refused) |

### Platform facts checked against documentation (and what follows)

Vercel Hobby functions: 300 s with Fluid compute, 60 s without, so the 60 s route and 50 s deadline fit either way. Hobby cron: once a day, production deployments only. Supabase: transaction pooler for the app (6543), session pooler for migrations (5432), direct connection is IPv6-only on the free plan. Resend: `onboarding@resend.dev` reaches only the account owner; a verified domain is required to mail anyone else; free quota 100 a day. Sources are linked in `docs/DEPLOYMENT.md`.

### Automated tests (final code)

| Suite | Result | Command |
|---|---|---|
| Unit + integration (Vitest) | **216 passed, 0 failed** (18 files) | `npm test` |
| Browser (Playwright, production build) | **49 passed, 0 failed** (47 desktop + 2 mobile), one full run on the final build | `npx next build && npm run test:e2e` |
| Typecheck, lint, production build | clean | `npm run typecheck`, `npm run lint`, `npx next build` |

### Mutation checks on the new guards

Ten defects applied one at a time and the relevant tests re-run. **Nine were caught** (speech guard removed, mailbox guard removed, cookie opt-out honoured on production, test flags allowed, local storage allowed, preview builds migrating, production build skipping a missing database, TLS never required, `siteUrl` ignoring `APP_URL`). **One was not: removing the migration lock.** The in-process server used for the wire-protocol tests accepts one connection at a time, so it serialises two migrators with or without the lock. The lock is therefore **unverified**; it needs a real Postgres (or Supabase) to demonstrate.

### Rehearsal of the live journey (not live evidence)

`npm run verify:live -- http://localhost:3299 --rehearsal --outbox <dir>` against a local production build with the test doubles: **13 of 13 steps passed** (sign-up, create, generate, approve, anonymous open with cache headers, correction at the same link, superseded audio refused, withdrawal, session loss, recovery by email, a second account refused, sign-out everywhere). The report is `evidence/rehearsal-journey-2026-10-30T10-49-43-115Z.json` and is labelled as a rehearsal. In live mode the same script refused a test-double target and sent nothing. `scripts/verify-deployment.ts` was run against the same local build earlier (13 of 15, the two expected failures being the test-provider guards).

### Not done (needs credentials or authorisation)

Real AssemblyAI verification (both voices, repeats, long notice, timeout probe, the server-reported-duration assumption), real Resend delivery, a real Supabase database and private bucket, deployment, the live journey, direct-access tests on superseded storage objects, and the human listening review. Exact steps are in `docs/DEPLOYMENT.md` and `docs/RELEASE_RUNBOOK.md`.

## Third pass, 30 October 2026: email accounts and release preparation

Observed on one Windows 11 machine, Node 24. Nothing here touched real Supabase, Resend, Vercel or a replacement AssemblyAI key; none exists yet.

### Automated tests (final code)

| Suite | Result | Command |
|---|---|---|
| Unit + integration (Vitest) | **187 passed, 0 failed** (16 files), three consecutive full runs green | `npm test` |
| Browser (Playwright, production build) | **49 passed, 0 failed** (47 desktop + 2 mobile), one full run | `npx next build && npm run test:e2e` |
| Typecheck, lint, production build | clean | `npm run typecheck`, `npm run lint`, `npx next build` |

Two parts of the stack are exercised for the first time this pass: the `postgres-js` driver over the Postgres wire protocol (PGlite behind a TCP socket: migrations, publish, correction, withdrawal, simultaneous approvals, email sign-in, 4 tests) and restart persistence of the local database and object store (1 test).

### Problems this pass found, and how they were handled (nothing hidden)

| What happened | Cause | Outcome |
|---|---|---|
| First email-sign-in browser run: 6 of 11 failed | One **real defect**: the 30 s resend cooldown also blocked requesting a code right after the previous code had been used, so a second device got no email. Three test mistakes: a selector that also matched Next.js's route announcer, an exact-text match on a header label, and the same cooldown hit. | Cooldown now guards only a still-usable code; regression test added (`email-auth.test.ts`); tests corrected. Re-run: 11 of 11. |
| First full Vitest run after adding integration files: 5 files failed | Seven files each boot an embedded Postgres in parallel; the default 10 s hook timeout was too short. | `hookTimeout: 60000` in `vitest.config.ts`. Three green runs after. |
| Lockfile churn | A first attempt to add a dev dependency with `--legacy-peer-deps` rewrote the lockfile (739 deletions). | Reverted; installed properly, which required `@electric-sql/pglite` 0.5.10 to 0.5.13. Full suite re-run on 0.5.13. |

### Mutation checks on the new authentication code

Each defect was applied on its own and `email-auth.test.ts` re-run.

| Defect applied | Caught? |
|---|---|
| Link or merge without requiring the verifying session to match the requesting one | Yes (2 tests) |
| Merge in the wrong direction (account notices into the browser workspace) | Yes |
| Request path that treats known addresses differently (account enumeration) | Yes (5 tests) |
| Cooldown that also blocks after a code was used | Yes |
| Store the code in plain text | Yes (20 tests) |
| No per-code attempt ceiling | Not at first; a test was added that sets the race-leftover state directly. Now caught. |
| A lockout that does not retire the code | Not at first (the ceiling masked it); an assertion on the stored row was added. Now caught. |
| Consume the code without the atomic "still unused" condition | **Not caught.** It overlaps the attempt compare-and-swap, so with it removed the suite still passes. It is defence in depth that cannot be exercised without fault injection, and it is not claimed as tested. |

### Live AssemblyAI

| Check | Result |
|---|---|
| Invalid key, live (`npm run tts:smoke -- --bad-key-probe`, no credits) | Refused as `auth`, non-retryable, provider code 1008, in 971 ms. File: `evidence/tts-smoke-2026-10-30T09-44-48-264Z.json` |
| `aai-kyla`, repeated runs, a long notice, the timeout probe, the server-reported-duration assumption | **Not run: no replacement key.** The script supports all of them within a request budget (default 14). |
| Human listening review | **Not done.** Sheet: `docs/LISTENING_REVIEW.md` (unsigned). |

### Local production-build check of the deployment script

`scripts/verify-deployment.ts` against a local production server with test providers: 13 of 15 checks passed and the 2 that must fail did (it refuses to accept the test speech provider or the test email outbox as a production configuration).

## Second pass, 30 October 2026

Everything in this section was observed on 30 Oct 2026 on one Windows 11 machine with Node 24. The sections below it are the 18 Oct measurements, kept as they were, and are **historical**.

### Live AssemblyAI synthesis (live provider call)

| Check | Result | Evidence |
|---|---|---|
| Endpoint, voice, model | `wss://tts.us.assemblyai.com/v1/ws`, voice `aai-jane`, model `assemblyai-tts-1` | `evidence/tts-smoke-2026-10-30T07-45-44-130Z.json` |
| Syntheses | **2 of 2 succeeded** (one original notice, one corrected), 1 run | same |
| Time to first audio | 1 142 ms and 957 ms | same |
| Total request time | 2 554 ms and 2 655 ms | same |
| Audio produced | 15 760 ms and 18 960 ms of 24 kHz mono 16-bit PCM | same |
| Text sent | `three p.m.` / `four p.m.` (the speech normaliser spells clock times out) | same |
| Not checked live | `aai-kyla`, the EU endpoint, text-length and rate limits, repeatability (only 1 run), the new `FlushDone` duration cross-check | no key available after the exposed key was withdrawn from use |
| **Human listening check** | **Not done.** No one has played the files. | `evidence/raw/audio/` (not committed) |

One run is a tiny sample. These numbers show that the integration works once; they are not a latency distribution.

### Objective audio inspection (local script, no network)

`npm run audio:inspect -- evidence/raw/audio/*.wav`, output in `evidence/audio-inspection-2026-10-30.jsonl`:

| File | Format | Duration | SHA-256 matches smoke record | Peak | RMS | Clipped samples | Pauses over 700 ms | Trailing silence |
|---|---|---|---|---|---|---|---|---|
| original | 24 kHz, mono, 16-bit PCM WAV | 15 760 ms | yes | -4.6 dBFS | -22.3 dBFS | 0 | none | 390 ms |
| corrected | 24 kHz, mono, 16-bit PCM WAV | 18 960 ms | yes | -4.0 dBFS | -22.5 dBFS | 0 | none | 230 ms |

This proves the files are intact and unclipped. It says nothing about which words were spoken or how they sound.

### Automated tests (local, final code)

| Suite | Result | Command |
|---|---|---|
| Unit + integration (Vitest; PGlite, local store, fake WebSocket server) | **144 passed, 0 failed** (12 files) | `npm test` |
| Browser (Playwright, production build, labelled test-tone provider) | **38 passed, 0 failed** (36 desktop + 2 mobile); history below | `npx next build && npm run test:e2e` |
| Typecheck, lint | clean | `npm run typecheck`, `npm run lint` |
| Production build | succeeds | `npx next build` |

Baseline before this pass: 56 Vitest tests and no browser run in this session.

### Browser run history (nothing hidden)

| Run | Result | Cause of any failure |
|---|---|---|
| 1 (first full run) | 34 passed, 3 failed | Two were defects in the new tests (a selector that matched Next.js's route announcer, and `/api/workspace` being POST-only). One was an accessibility scan of the editor that failed once and **did not reproduce** in 12 isolated repeats; its message was not captured. |
| 2 | 37 of 37 passed | n/a |
| 3 | 37 of 37 passed | n/a |
| 4 | 36 passed, 1 failed | The landing-page accessibility scan reported `color-contrast` across the entire animated hero. The scan ran while the entrance animation was fading in, so contrast was measured on partly transparent text. Not a real contrast defect. |
| after hardening | 12 of 12 a11y runs passed (3 repeats of the 4-test file) | The scan now repeats up to four times, 600 ms apart, and only fails on a violation that persists; a deliberately bad page is included to prove it still fails. |
| 5 (final code, full suite) | **38 of 38 passed** (36 desktop + 2 mobile) in 4.1 min | n/a |

Run 5 is the only run that includes the hardened accessibility scan together with every other test, and it is a single run: the intermittent scan failures above were not reproduced on demand, so "stable" is not claimed beyond what was observed (runs 2, 3 and 5 green, plus the 12 repeats).

### Regression tests proven to fail without their fix

Each fix was temporarily reverted and the named tests re-run. All six were caught.

| Reverted fix | Tests that failed |
|---|---|
| Public audio `Cache-Control` back to `public, max-age=31536000, immutable` | 2 in `public-routes.test.ts` |
| Cleanup update without `audio_asset_id = asset.id` | the replaced-preview race test |
| Draft update without the version compare-and-swap | the simultaneous-saves test |
| Completion update without the synthesis claim | the "stalled worker returns while its replacement works" test |
| PATCH schema turning omitted fields into `null` | the omission test |
| Title left out of the spoken-field ambiguity check | the spoken-field test |

The first mutation run exposed a gap: removing the claim guard went unnoticed because the status check masked it. The test for the case that matters (the old worker returning while the new one is still running) was added after that.

### Credential hygiene

Searched on 30 Oct (counts and file names only, values never printed): no 32-character hex token on any key or authorization line in the working tree; none added in any commit on any ref; no server-side secret name in `.next/static`; `.env.local` and `.env*` are ignored. The API key used for the live run was pasted into a chat and **must be rotated**.

## Sponsor speech (AssemblyAI), 18 Oct 2026 (historical)

| Check | Result | Evidence |
|---|---|---|
| Endpoint reachable | `wss://streaming-tts.assemblyai.com/v1/ws` upgrades (HTTP 101, server `Python/3.13 websockets/15.0.1`) | `evidence/tts-probe-unauthenticated-2026-10-18.json` |
| Unauthenticated behaviour | One text frame `{"type":"Error","error_code":1008,"error":"Unauthorized: missing Authorization header or token query param"}`, then close 1008 | same |
| Authenticated synthesis | **Not run.** No API key in the build environment, and the message protocol is not published | — |
| Synthesis latency, first audio, durations | **Not measured** | — |
| Human listening check of times and dates | **Not done.** Needs real audio | — |

Successful sponsor syntheses so far: **0 of 0 attempted.**

## Automated tests (local, 18 Oct 2026, historical)

| Suite | Result | Command |
|---|---|---|
| Unit + integration (Vitest, embedded Postgres) | 54 passed, 0 failed | `npm test` |
| End-to-end (Playwright, production build, test-tone provider) | 16 passed, 0 failed | `npm run test:e2e` |
| Typecheck / lint | clean | `npm run typecheck && npm run lint` |
| Production build | succeeds | `npx next build` |

The automated suites use the labelled test-tone provider. They verify revision, storage, consistency and authorization behaviour. They say nothing about speech quality.

### Failures found during development, and their fixes

- The test double produced identical bytes for scripts with the same word count, so an integration test caught equal digests across revisions. Fixed by seeding the tone from the text hash. Real provider output is not affected.
- `3:00 PM.` was parsed as `3:00 PM.` (with the full stop), so the fact diff misreported changes. Fixed the time pattern; unit tests were added.
- The landing page's largest paint was held back by the entrance animation (Lighthouse LCP 4.1 s). Headline and subcopy now stay opaque and animate by transform only, and GSAP loads lazily. LCP is now 2.5–2.6 s.
- Landing-page motion CSS hid the header on other pages for up to 2.5 s. It is now scoped to the landing page, with an e2e test added.

## Lighthouse (mobile preset, simulated throttling, local `next start`)

| Page | Run | Perf | A11y | Best practices | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `/` | 1 | 90 | 100 | 100 | 100 | 2.6 s | 320 ms | 0 |
| `/` | 2 | 94 | 100 | 100 | 100 | 2.5 s | 200 ms | 0 |
| `/demo` | 1 | 95 | 100 | 100 | 100 | 1.7 s | 240 ms | 0 |
| `/demo` | 2 | 93 | 100 | 100 | 100 | 2.8 s | 170 ms | 0 |

Reports: `evidence/lighthouse/`. These are local measurements, not the deployed site.

## Responsive sweep

Pages `/`, `/demo`, `/app`, `/app/notices/new`, notice detail, editor and listener were each rendered at 320, 375, 390, 430, 768, 1024, 1280, 1440 and 1920px wide in Chromium. Result: no horizontal overflow and no elements past the viewport edge. Before fixes, the landing product stage overflowed by 2px at 320px and the version toggle wrapped. Both were fixed and re-checked.

## Not yet measured

Deployed performance, real synthesis success rate, median synthesis time, approval-to-current-link time on a deployed instance, and a comparison with re-recording a static voice note. These need sponsor access and a deployment.
