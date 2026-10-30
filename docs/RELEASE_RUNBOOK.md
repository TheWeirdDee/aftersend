# Release runbook

A repeatable procedure for putting a version of AfterSend in front of real users, and for getting out of trouble. It assumes the one-time setup in `DEPLOYMENT.md` is done. Nothing in this file has been executed against real infrastructure; it states what each step is expected to show and what to do when it does not.

## Local secrets file (`.env.local`)

The repository ships `.env.example` only. Create your own private copy once:

```
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local
```

`.env.local` is gitignored, so it never reaches a commit (check: `git check-ignore -v .env.local` prints the rule). Next.js reads it for `npm run dev`; the command-line scripts (`tts:smoke`, `tts:probe`, `verify:deploy`, `verify:live`) now read it too. Variables already set in your shell win, and blank values are treated as unset. Put only what you need locally: for the speech checks that is `ASSEMBLYAI_API_KEY=` followed by the key. If you can't see the file in your editor's explorer, it is a dotfile: check the editor's "exclude" settings, or open it by name (`code .env.local`).

## 0. Principles

- **Expand, then contract.** A migration must work with the previous release's code. Add tables, columns (nullable or with defaults) and indexes in one release; remove or rename things only in a later release, after nothing reads them. Every migration so far is additive. A destructive migration needs its own release and a database backup first.
- **Nothing ships on a red check.** The release gate below is all-or-nothing.
- **Secrets stay out of everything you can paste.** No command in this runbook prints a secret. If one ever does, treat that secret as exposed and rotate it.

## 1. Release gate (on the commit to be released)

```
npm ci
npm run typecheck && npm run lint
npm test                                  # unit + integration
npx next build && npm run test:e2e        # production build + browser suite
npm run check:env -- --file .env.production.local   # configuration (see DEPLOYMENT.md §5 for how to pull it)
```

All five must pass. `check:env` must show no `FAIL` lines; read the `WARN` lines and decide.

## 2. Deploy

1. Push the commit (only with the owner's explicit say-so). Vercel starts a Production build.
2. The build runs `npm run db:migrate -- --if-configured --production-only`, then `next build`.
   - **Migration fails:** the build fails and the previous deployment keeps serving. Read the build log (the error message is printed; the connection string is not). Fix, push again. Nothing to roll back.
   - **Build fails after a successful migration:** the previous deployment keeps serving; the schema is already ahead of it, which is safe because migrations are additive. Fix and push again.
3. When the deployment is Ready, **do not announce anything yet.** Smoke test first.

## 3. Smoke test (about ten minutes)

```
npx tsx scripts/verify-deployment.ts https://<domain>               # liveness, readiness, providers are real, headers, CSRF, anonymous refusals
npx tsx scripts/verify-deployment.ts https://<domain> --storage     # needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OBJECT_STORAGE_BUCKET exported; bucket private, probe object unreachable
```

Expected: every line `PASS`. `readiness.config` appears only on production and must be `ok`. Then the full journey with real email and real speech:

```
npm run verify:live -- https://<domain> --email <mailbox you read> --email2 <another mailbox> --confirm-live
```

It pauses twice for a code, spends two AssemblyAI syntheses and writes `evidence/live-journey-<time>.json`. Expected: every step `PASS`, including step 11b (the superseded object is not readable from storage). Finally, a person listens to the audio and completes `LISTENING_REVIEW.md`, and checks the site on a phone.

**Go/no-go:** all of the above pass, and no step was skipped. Otherwise roll back (§4) or fix forward.

## 4. Rollback

| Situation | Action |
|---|---|
| The new deployment misbehaves, schema unchanged or additive | Vercel → **Deployments** → open the last good deployment → **Promote to Production** (or `vercel promote <url>`). Takes effect immediately; no database action needed. |
| A migration in the bad release was destructive (it should never have shipped) | Promote the previous deployment, then restore the database from a backup/point-in-time snapshot taken before the release (Supabase → Database → Backups; what your plan offers varies, so on the free plan take a manual dump with `pg_dump` before any such release). |
| Only a variable is wrong | Fix it in Vercel and **redeploy**; variable changes apply to new deployments only. Re-run `check:env`. |

After a rollback, re-run `verify-deployment.ts` against the live URL: `ready` must be 200.

## 5. Failure recovery

| Symptom | Likely cause | Recovery |
|---|---|---|
| `/api/ready` 503, `database: error` | Wrong or expired `DATABASE_URL`; Supabase project paused (free-plan projects can be paused after a period of inactivity; check the dashboard) | Check the Supabase dashboard; restore the project; fix the URL and redeploy. Notices already published are not lost; they are served from the database once it is back. |
| `/api/ready` 503, `storage: error` | Wrong key or bucket name; bucket deleted | Fix the three storage variables. Do **not** make the bucket public to "fix" it. |
| `/api/ready` 503, `speech: unavailable` | `ASSEMBLYAI_API_KEY` missing | Set it and redeploy. Publishing and listening to existing notices still work; only new audio is blocked. |
| `/api/ready` 503, `email`/`auth` | Resend key, sender, or `AUTH_SECRET` missing | Set and redeploy. Existing sessions keep working; only new sign-ins are blocked. |
| Generate fails with "rejected the credentials" | AssemblyAI key revoked or rotated | Issue a new key, set it, redeploy. The drafts are kept; press Generate again. |
| Generate fails with "ran out of time" repeatedly | Provider slow, or a very long notice | Retry; shorten the notice; check `synthesis.failed` log lines (`kind`, `elapsedMs`). |
| People say they get no sign-in email | Resend domain not verified (mail only reaches the account owner); daily quota (100/day on the free plan); spam folder | Check https://resend.com/emails for the message and its status; verify the domain; look for `auth.email_failed` in the logs. |
| A user lost their mailbox and wants a notice withdrawn | By design nothing else can prove ownership | After confirming who they are out of band, run in the Supabase SQL editor: `update notices set state = 'withdrawn', withdrawn_at = now() where public_token = '<token>';` |
| Cron cleanup did not run | `CRON_SECRET` missing, or the project is not on a production deployment | Cron runs only on production deployments. Call it by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/cleanup` (do not paste the secret into shared chat). |
| Suspected leaked secret | — | Rotate it at the provider first, update the Vercel variable, redeploy, then check logs for use of the old one. Rotating `AUTH_SECRET` only invalidates sign-in codes outstanding at that moment (at most 10 minutes' worth). |

## 6. Watching it

Vercel → project → **Logs**. Useful filters: `request.failed` (unexpected errors; carries a correlation id that the user also sees), `synthesis.failed`, `auth.email_failed`, `auth.code_locked`. Lines are JSON, credentials are redacted, addresses appear only as a short hash.
