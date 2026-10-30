# Deployment (prepared, not executed)

Nothing below has been run. Each step needs the owner's accounts and approval.

## 1. Database: Supabase Postgres

1. Use the pooled connection string (Transaction mode, port 6543) as `DATABASE_URL`.
2. Migrations run automatically in the Vercel build (`vercel-build` → `db:migrate --if-configured`), because the Vercel builder can reach Postgres directly.

## 2. Storage: Supabase Storage

1. Create a **private** bucket, e.g. `aftersend-audio`. The app proxies all audio, so the bucket never needs to be public. This is a requirement, not a preference: a public bucket serves superseded and withdrawn audio directly and bypasses every check the application makes (see "Withdrawal" in `docs/ARCHITECTURE.md`).
2. Set `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only) and `OBJECT_STORAGE_BUCKET`.
   (Alternatively `STORAGE_DRIVER=s3` with Supabase's S3 endpoint and access keys.)

## 3. Web: Vercel

1. Import `TheWeirdDee/aftersend`. The framework preset is Next.js.
2. Environment variables: everything above, plus `APP_URL`, `ASSEMBLYAI_API_KEY` (a fresh key; the one pasted into chat during development must be treated as compromised and rotated in the AssemblyAI dashboard), `CRON_SECRET`, `SPEECH_PROVIDER=assemblyai`. `ASSEMBLYAI_TTS_VOICES` and `ASSEMBLYAI_TTS_MODEL` are optional (defaults: voices `aai-jane,aai-kyla`; the model is reported by the server). `ASSEMBLYAI_TTS_ENDPOINT` defaults to `wss://tts.us.assemblyai.com/v1/ws`; the EU endpoint `tts.eu.assemblyai.com` has not been tried. **Do not** set `AFTERSEND_ALLOW_TEST_PROVIDER` in production.
3. `vercel.json` schedules `/api/cron/cleanup` daily. It needs `CRON_SECRET`.
4. The synthesis route sets `maxDuration = 60`, and `SYNTHESIS_DEADLINE_MS` (default 50 000) bounds every attempt, backoff and storage step inside it. Keep the deadline under `maxDuration`. If real notices need longer, move synthesis to a background worker.

## 4. Verify after deploy

- `GET /api/health` (liveness) returns `database: ok`.
- `GET /api/ready` (readiness) returns `200` with `database: ok`, `speech: ok (assemblyai)` and `storage: ok`. It answers `503` and names the failing check otherwise. Gate the deployment on this, not on `health`. The speech check confirms configuration only; run `npm run tts:smoke` once for a real call.
- Confirm the bucket is private: an unauthenticated request to an object URL must be refused.
- Confirm headers on the deployed URL: `/n/<token>` and `/api/public/<token>/current` are `no-store`; a public audio URL is `private, no-cache` with an `ETag`. If a CDN sits in front, confirm it does not cache these paths.
- Run the judge path on the deployed URL from a phone and a desktop: demo → generate → listen → publish → open link → correct 3:00 → 4:00 PM → approve → refresh the same link.
- Run Lighthouse against the deployed URL and record the numbers in `RESULTS.md`.
