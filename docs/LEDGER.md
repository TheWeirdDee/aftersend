# Task ledger (updated 30 Oct 2026)

## Implemented and verified (automated tests or manual inspection)
- Notice creation, drafts, corrections with word diff and fact-change summary
- Critical fact detection (time, date, phone); ambiguous numeric dates block synthesis
- Deterministic speech normalisation (clock times, phone digits)
- Immutable revisions; atomic promotion with compare-and-swap; conflict on stale or competing approvals
- Idempotent, rate-limited synthesis under one overall deadline, with bounded retries, claim tokens so a stalled worker cannot overwrite a replacement, structural audio validation, SHA-256 and storage verification
- Stable public link; manifest consistency; only the current audio is served, revalidated on every use (`private, no-cache` + ETag); withdrawal
- Optimistic versioning of drafts and approvals; serialized browser autosave; visible conflict recovery; idempotent draft creation
- Calendar-aware date checks on every spoken field; field-level problem display
- Cleanup that cannot clear a replacement preview; tracking and removal of abandoned publish copies; retention of expired sessions and rate-limit rows
- Liveness (`/api/health`) separate from readiness (`/api/ready`); CI workflow; cross-platform E2E startup
- Workspace sessions, ownership checks, CSRF origin check, body limits, safe error envelopes
- Landing, demo, dashboard, composer, editor, detail and listener pages; dark visual system; logo, favicon, OG image
- GSAP and Motion animation with reduced-motion and no-JavaScript fallbacks
- Responsive sweep at 320–1920px; Lighthouse local runs
- Staging audio cleanup (24 h) plus a cron route

- Passwordless email sign-in (one-time codes), linking and merging of browser workspaces, recovery on another device, sign-out everywhere (unit, integration and browser tests; email delivery tested only against the file outbox and a mocked Resend client)
- Structured JSON logging with credential redaction; liveness vs readiness (database, speech, storage, email, auth); deployment verification script

## Implemented but unverified
- S3 storage driver (no bucket available)
- Hosted Postgres path (`postgres-js` + `db:migrate`); tests use PGlite
- AssemblyAI adapter: transport and WAV assembly ran once against the real service on 30 Oct 2026 (`npm run tts:smoke`, 2 syntheses, sub-3 s each). Failure handling (bad base64, dropped stream, short audio, auth, rate limit, timeout, abort) is covered against a local protocol server, not the real service. `aai-kyla`, the EU endpoint, text-length and rate limits, repeatability and pronunciation are unchecked
- Supabase Storage driver (mocked HTTP only), S3 (not run), Resend (mocked HTTP only)
- Hosted Postgres: `postgres-js` over the wire protocol against PGlite behind a socket; never against real Postgres or Supabase

## Blocked by external dependency
- Deployment: needs hosting accounts and owner approval
- Demo video: needs real sponsor audio and a deployed app
- Submission: needs the above plus owner approval

## Not yet implemented
- Place detection in critical facts
- Reconciliation of published objects that have no database row at all (only tracked rows are cleaned)
- Background worker for long syntheses (only if real latency requires it)

## Excluded from the hackathon MVP (per PRD)
- PDF import, QR export, MP3 transcoding, multiple voices beyond the verified catalogue, analytics, translation, push notifications, email accounts, organisation verification
