# Task ledger (18 Oct 2026)

## Implemented and verified (automated tests or manual inspection)
- Notice creation, drafts, corrections with word diff and fact-change summary
- Critical fact detection (time, date, phone); ambiguous numeric dates block synthesis
- Deterministic speech normalisation (clock times, phone digits)
- Immutable revisions; atomic promotion with compare-and-swap; conflict on stale or competing approvals
- Idempotent, rate-limited synthesis with bounded retries, decode validation, SHA-256 and storage verification
- Stable public link; manifest consistency; only the current audio is served; withdrawal
- Workspace sessions, ownership checks, CSRF origin check, body limits, safe error envelopes
- Landing, demo, dashboard, composer, editor, detail and listener pages; dark visual system; logo, favicon, OG image
- GSAP and Motion animation with reduced-motion and no-JavaScript fallbacks
- Responsive sweep at 320–1920px; Lighthouse local runs
- Staging audio cleanup (24 h) plus a cron route

## Implemented but unverified
- S3 storage driver (no bucket available)
- Hosted Postgres path (`postgres-js` + `db:migrate`); tests use PGlite
- AssemblyAI adapter transport, error mapping and WAV assembly against the real service

## Blocked by external dependency
- Real AssemblyAI synthesis: needs `ASSEMBLYAI_API_KEY` and the hackathon TTS message schema
- Deployment: needs hosting accounts and owner approval
- Demo video: needs real sponsor audio and a deployed app
- Submission: needs the above plus owner approval

## Not yet implemented
- Background worker for long syntheses (only if real latency requires it)

## Excluded from the hackathon MVP (per PRD)
- PDF import, QR export, MP3 transcoding, multiple voices beyond the verified catalogue, analytics, translation, push notifications, email accounts, organisation verification
