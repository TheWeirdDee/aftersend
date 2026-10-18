# Deployment (prepared, not executed)

Nothing below has been run. Each step needs the owner's accounts and approval.

## 1. Database: Supabase Postgres

1. Create a project and copy the pooled connection string (Transaction mode, port 6543).
2. `DATABASE_URL=… npm run db:migrate`

## 2. Storage: Supabase Storage (S3 protocol)

1. Create a **private** bucket, e.g. `aftersend-audio`. The app proxies all audio, so the bucket never needs to be public.
2. Create S3 access keys (Project Settings → Storage → S3 Connection).
3. Set `STORAGE_DRIVER=s3`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ENDPOINT` (`https://<ref>.supabase.co/storage/v1/s3`), `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ACCESS_KEY` and `OBJECT_STORAGE_SECRET_KEY`.

## 3. Web: Vercel

1. Import `TheWeirdDee/aftersend`. The framework preset is Next.js.
2. Environment variables: everything above, plus `APP_URL`, `ASSEMBLYAI_API_KEY`, `ASSEMBLYAI_TTS_MODEL`, `ASSEMBLYAI_TTS_VOICES`, `CRON_SECRET`, `SPEECH_PROVIDER=assemblyai`. **Do not** set `AFTERSEND_ALLOW_TEST_PROVIDER` in production.
3. `vercel.json` schedules `/api/cron/cleanup` daily.
4. The synthesis route sets `maxDuration = 60`. Check this against real provider latency. If notices take longer, move synthesis to a background worker.

## 4. Verify after deploy

- `GET /api/health` returns `database: ok` and `speech: ok (assemblyai)`.
- Run the judge path on the deployed URL from a phone and a desktop: demo → generate → listen → publish → open link → correct 3:00 → 4:00 PM → approve → refresh the same link.
- Run Lighthouse against the deployed URL and record the numbers in `RESULTS.md`.
