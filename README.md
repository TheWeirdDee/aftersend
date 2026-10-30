# AfterSend

**A spoken notice you can correct after the link is shared.**

AfterSend turns a school notice into a spoken announcement behind one stable link. When a detail changes, for example the pickup time, the publisher edits the text, listens to newly generated audio, and approves it. The link families already have then plays the corrected notice and shows the corrected text.

![AfterSend landing page](docs/screenshots/landing.png)

> **Status, 30 Oct 2026.** Passwordless email accounts (one-time codes) now let a publisher recover and reach their notices from any device; the product, revision engine and tests pass locally. The AssemblyAI adapter speaks the documented protocol and produced two valid recordings in one live run, and a no-cost live probe confirmed an invalid key is refused as non-retryable. **Nobody has listened to the recordings, no replacement AssemblyAI key is configured, and nothing is deployed**, so live verification of both voices, longer notices and repeated runs is pending. Deployment steps, exact values and the verification script are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Design and guarantees: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Audit status: [`docs/BUILD_AUDIT.md`](docs/BUILD_AUDIT.md). See [Known limitations](#known-limitations).

| | |
|---|---|
| Live app | Not deployed yet (needs hosting credentials and approval, see [Deployment](#deployment)) |
| Demo video | Not recorded yet. Script and shot list: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) |
| Product spec | [`docs/PRD.md`](docs/PRD.md) |
| Architecture, lifecycle, cache and withdrawal guarantees | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Measured results | [`RESULTS.md`](RESULTS.md) |

---

## Problem

A school office sends a notice to parents. Then a detail changes, or a wrong message starts circulating. The office can issue a correction, but forwarded screenshots and voice notes stay in group chats. A recording already on someone's phone can't be edited.

## Real-world context

On 14 May 2026, Lagos State's Office of Education Quality Assurance publicly told schools to disregard a circulating message claiming students would be dismissed early the next day ([source](https://oeqalagos.com/urgent-notice-disregard-circulating-message-on-school-dismissal/)). This shows that authoritative corrections matter. It does **not** show that audio would have prevented that incident, and AfterSend is not affiliated with OEQA.

## Solution

AfterSend is the place you send people to, not the messaging channel. The publisher shares one link. It always resolves to the newest **human-approved** version: its text and its own immutable audio file, published together.

## Core workflow

1. **Write.** Paste the exact notice. Dates, times and phone numbers are detected, and ambiguous numeric dates such as `05/06/26` block audio generation.
2. **Approve.** Generate the spoken preview, play it, confirm the critical facts, and approve. The stable link `/n/{token}` goes live.
3. **Correct.** Edit the notice and review a word-level diff (`3:00 PM` → `4:00 PM`). Optionally accept a suggested update note quoted from your own text. Generate new audio, listen, and approve. The same link now serves version 2.

![Correction editor](docs/screenshots/editor-correction.png)

## Why AssemblyAI

The spoken announcement is the product's output, and the hackathon's sponsor speech API is meant to produce it. The sponsor call sits behind a typed `SpeechProvider` interface in a server-only adapter ([`src/lib/speech/assemblyai.ts`](src/lib/speech/assemblyai.ts)) that speaks AssemblyAI's Streaming TTS WebSocket protocol at `wss://tts.us.assemblyai.com/v1/ws`. The wire format (auth header, query parameters, `Generate`/`Flush` frames, base64 `Audio` frames) is taken from AssemblyAI's published quickstart and recorded in [`src/lib/speech/assemblyai-protocol.ts`](src/lib/speech/assemblyai-protocol.ts). `npm run tts:smoke` exercises it against the real service with a key; pronunciation still needs a person to listen to the output.

## Features

- Stable, unguessable listener link (128-bit token). It stays byte-for-byte identical across versions, and end-to-end tests check this.
- Immutable revisions. Each approved version keeps its exact text, speech script, voice/model ids, audio digest (SHA-256) and timestamps.
- Atomic promotion. A row lock plus compare-and-swap on `current_revision_id` means a stale draft or a competing approval fails with a conflict instead of overwriting.
- Failure safety. Timeouts, provider errors, malformed audio or a text edit during synthesis never change what listeners get.
- Idempotent synthesis. A repeated or concurrent "Generate" for the same text, voice and model makes one provider call.
- Human approval is enforced on the server (`confirmedCriticalFacts`, preview ready) and in the UI (preview must be played first).
- Listener page: no sign-in, no autoplay, full text always shown, update banner and timestamp in the notice's time zone, live "newer version available" prompt, `noindex`.
- Withdrawal shows an explicit "withdrawn" page and stops serving audio.
- Dark, typography-led UI with GSAP and Motion animation, a reduced-motion mode, and full content without JavaScript.

![Mobile listener](docs/screenshots/listener-mobile.png)

*Screenshots come from a local production build using the **test-tone provider**. The audio there is a labelled tone, not speech, and the UI marks it "Test audio · not AssemblyAI".*

## Architecture

```mermaid
flowchart LR
  P[Publisher] --> E[Notice editor<br/>/app/notices/:id/edit]
  E -->|POST /api/notices/:id/revisions| RS[Revision service<br/>immutable drafts + diff]
  E -->|POST /api/revisions/:id/generate| RS
  RS -->|SpeechProvider.synthesize| TTS[AssemblyAI streaming TTS<br/>wss://tts.us.assemblyai.com/v1/ws]
  TTS -->|audio| V[Structural check + SHA-256]
  V --> ST[(Object storage<br/>staging/…)]
  E -->|POST /api/revisions/:id/approve| TX[Approval transaction<br/>row lock + compare-and-swap]
  ST -->|verified copy| PUB[(Object storage<br/>published/notice/revision/sha.wav)]
  TX --> DB[(Postgres<br/>notices.current_revision_id)]
  DB --> M[Current revision manifest<br/>one join: text + audio]
  M --> L[Public listener<br/>/n/:token]
  PUB --> L
```

| Layer | Implementation |
|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Motion | GSAP 3 + ScrollTrigger (landing page, lazy-loaded), Motion for React (component transitions) |
| Data | PostgreSQL via Drizzle ORM. Locally and in tests, embedded Postgres (PGlite) |
| Storage | `ObjectStore` with local-disk, Supabase Storage and S3-compatible drivers, immutable revision paths, key allow-list |
| Auth | Passwordless email sign-in with 6-digit one-time codes (HMAC-stored, single use, 10 minutes, 5 guesses) plus anonymous browser workspaces that can be connected to an email later. Sessions: random 256-bit token in an httpOnly SameSite=Lax cookie, only its hash stored, 30 days, sign-out everywhere. Ownership is checked on every read and mutation |
| Speech | `SpeechProvider` interface. AssemblyAI adapter (server-only), plus a test-only tone provider for automated tests |
| Tests | Vitest (unit + integration on real Postgres semantics), Playwright (production build, desktop + mobile) |

### Project structure

```text
src/
  app/
    page.tsx                         landing
    demo/page.tsx                    judge demo entry
    app/…                            publisher workspace, new/detail/edit
    n/[publicToken]/page.tsx         public listener
    api/…                            REST API (see below)
  components/                        UI (landing/, app/, listener/, audio-player, logo)
  lib/
    db/schema.ts, db/client.ts       schema + Postgres/PGlite client
    notices/revision-service.ts      create, synthesize, approve, withdraw
    notices/public-manifest.ts       single-revision manifest + audio resolution
    notices/facts.ts, normalize-speech.ts, diff.ts
    speech/provider.ts, assemblyai.ts, assemblyai-protocol.ts, test-provider.ts
    storage/audio.ts, audio/wav.ts, auth/, http/
drizzle/                             SQL migrations
scripts/                             migrate, tts-probe, tts-smoke
tests/unit, tests/integration, tests/e2e
evidence/                            probe log, Lighthouse reports
docs/                                PRD, integration notes, demo script, submission copy, ledger
```

### API

| Method | Path | Notes |
|---|---|---|
| POST/DELETE | `/api/workspace` | Create a workspace without email or an isolated demo workspace (rate-limited per IP) / sign out of this browser |
| POST | `/api/auth/request`, `/api/auth/verify` | Email a one-time code (always `202`, identical for known and unknown addresses) / verify it, sign in, and link or merge a browser workspace |
| POST | `/api/auth/signout-all` | End every session of the account on every device |
| GET/POST | `/api/notices` | List / create draft (owner) |
| GET | `/api/notices/:id` | Owner detail with revisions, audio, attempts |
| POST | `/api/notices/:id/revisions` | Start a correction; returns diff and fact changes |
| PATCH/DELETE | `/api/revisions/:id` | Edit / discard draft. Edits carry `expectedVersion`; a stale one gets `409`. Edits invalidate stale previews |
| POST | `/api/revisions/:id/generate` | Synthesize (idempotent, rate-limited per user and IP) |
| GET | `/api/revisions/:id/status` | Status, attempts, preview URL |
| GET | `/api/revisions/:id/audio` | Owner-only preview audio (`no-store`, Range support) |
| POST | `/api/revisions/:id/approve` | Atomic promotion; requires `confirmedCriticalFacts: true` and the previewed `expectedVersion` |
| POST | `/api/notices/:id/withdraw` | Withdraw |
| GET | `/api/public/:token/current` | Listener manifest (`no-store`) |
| GET | `/api/public/:token/audio/:revisionId/:sha.wav` | Current revision only; `private, no-cache` with an ETag, so every reuse is re-checked |
| GET | `/api/health`, `/api/ready`, `/api/voices` | Liveness / readiness (database, speech configuration, storage) / configured voices |
| GET | `/api/cron/cleanup` | Expired previews, abandoned publish copies, expired sessions and rate-limit rows (Bearer `CRON_SECRET`) |

Errors always use `{ code, message, retryable, correlationId }`. Raw provider or database errors never reach the client.

## Installation and running locally

Requires Node 20.9+ (CI uses 24).

```bash
git clone https://github.com/TheWeirdDee/aftersend && cd aftersend
npm install
cp .env.example .env.local      # then edit; gitignored. The scripts (tts:smoke, verify:live, ...) read it too
npm run dev                     # http://localhost:3000
```

Without `DATABASE_URL`, the app uses embedded Postgres in `.data/pglite` and migrates it automatically. Leaving a variable blank, as the template does, means "unset". To click through the full flow without sponsor credentials, set `SPEECH_PROVIDER=test` and `AFTERSEND_ALLOW_TEST_PROVIDER=1`. Every clip is then a tone labelled "Test audio · not AssemblyAI".

### Environment

See [`.env.example`](.env.example). `ASSEMBLYAI_API_KEY` is read only on the server and is never sent to the browser.

### Database migrations

```bash
npm run db:generate            # after editing src/lib/db/schema.ts
DATABASE_URL=postgres://… npm run db:migrate
```

## Testing

```bash
npm run typecheck && npm run lint
npm test                       # Vitest: 216 unit + integration tests
npx next build && npm run test:e2e   # Playwright: 49 tests (desktop + mobile) against a production build
npm run audio:inspect -- file.wav    # structure, level, clipping and silence of a WAV (not pronunciation)
```

Integration tests cover creation, synthesis, idempotency, concurrent approvals, optimistic versioning, stale drafts, failed and malformed synthesis, retries and deadlines, stalled-worker takeover, cleanup races, public cache headers, authorization, withdrawal and readiness. Unit tests include the AssemblyAI adapter against a local WebSocket server that speaks the documented frames. The e2e journeys cover first publication, correction at the same URL (a browser that cached the old audio is refused after the correction and after withdrawal), autosave ordering and lost responses, two-tab conflicts, provider failure and dropped connections, the listening gate, cross-workspace and anonymous access, CSRF, competing approvals, widths from 320 to 1440 px, automated accessibility scans, reduced motion, rendering without JavaScript, dead links and keyboard focus.

`.github/workflows/ci.yml` runs lint, typecheck, the unit and integration tests, a production build and the browser suite on every push and pull request. It has not yet run on GitHub. The live AssemblyAI smoke test is a manual job that spends credits.

The automated suites use the test-tone provider. **They prove storage, revision and consistency behaviour, not speech quality or pronunciation.** Real-provider checks are in `npm run tts:smoke` (see below).

### Release tooling

```bash
npm run check:env -- --file .env.production.local   # production configuration, names only, never values
npm run verify:deploy -- https://<domain> [--storage]  # deployed instance, incl. private-bucket proof
npm run verify:live -- https://<domain> --email <mailbox> --confirm-live   # full journey with real email and speech
```

See `docs/DEPLOYMENT.md` and `docs/RELEASE_RUNBOOK.md`.

### Sponsor checks (need a valid `ASSEMBLYAI_API_KEY`)

```bash
npm run tts:probe              # records server frames to evidence/raw/ (no key printed)
npm run tts:smoke -- --runs 3  # original + corrected notice, saves WAVs and timings
npm run audio:inspect -- evidence/raw/audio/*.wav
```

Then listen to every file. The checks above cannot hear.

## Deployment

Target: Vercel (web + API, `maxDuration` 60 s for synthesis), Supabase Postgres, and Supabase Storage through its S3 endpoint. Steps are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). **Nothing has been deployed.** It needs your hosting accounts and explicit approval.

## Security and privacy

- Provider keys are server-only. No key appears in client bundles or logs, and the probe never prints it.
- Every mutation checks session, ownership, same-origin `Origin`, JSON content type and a 32 KB body limit. Other users' notices return `404`.
- Rate limits are stored in Postgres: synthesis per user and IP, and workspace creation per IP.
- Input is stripped of tags and control characters, React escapes all output, and source links are restricted to http(s) and marked `nofollow`.
- Storage keys follow a strict allow-list pattern, so path traversal is rejected. Staging audio is owner-only and is deleted after 24 h.
- Listener pages are `noindex`, show no verification badges, and state that AfterSend does not verify the issuer.
- Security headers are set: `nosniff`, `DENY` framing, a strict referrer policy and a permissions policy.

## Verified results

Only measured numbers are listed. Details are in [`RESULTS.md`](RESULTS.md).

- 30 Oct 2026: 216/216 Vitest and 49/49 Playwright tests pass locally on the final code (run history, including the failures along the way, is in `RESULTS.md`). Lint, typecheck and the production build are clean.
- 18 Oct 2026 (historical): 54/54 Vitest and 16/16 Playwright.
- Lighthouse mobile on a local production build: landing page 90–94 performance, 100 accessibility, 100 best practices, 100 SEO; `/demo` 93–95 performance and 100 on the rest.
- No horizontal overflow on any page at 320, 375, 390, 430, 768, 1024, 1280, 1440 or 1920px.
- **AssemblyAI synthesis, one live run on 30 Oct 2026:** 2 of 2 succeeded with `aai-jane`; first audio in about 1 s, about 2.6 s per request, for 15.8 s and 19.0 s of audio. Both files are intact and unclipped. **They have not been listened to**, and a single run is not a latency distribution.

## Known limitations

- **Speech quality is unreviewed.** The integration works against the real service, but no person has listened to the output, `aai-kyla`, the EU endpoint and the provider's limits are untested, and the key used for the live run was exposed and must be rotated.
- **Recovery depends on the mailbox.** A workspace connected to an email survives cleared cookies, a new browser and a lapsed session. A workspace started *without* email is still only a cookie until it is connected (the header offers **Save to email**). Losing the mailbox as well needs an operator. There is no second factor. Details and residual risks: `docs/ARCHITECTURE.md` section 8A.
- Withdrawal stops every application route immediately, but cannot recall audio a listener already downloaded or buffered.
- Synthesis runs inside the API request under a 50 s deadline. A very long notice can fail with "ran out of time" rather than hang; a background worker would remove that limit.
- Place names are not detected as critical facts; the editor asks the publisher to check them.
- No PDF import, QR export, multiple-voice catalogue or analytics. These are P1/P2 in the PRD.
- The AssemblyAI Agent was used during early research and hit its free-tier limit without producing a working integration. No bonus eligibility is claimed.

## Hackathon submission

Built for AssemblyAI's *Hack into Speech 2026*. Not affiliated with or endorsed by AssemblyAI. Draft submission copy is in [`docs/SUBMISSION.md`](docs/SUBMISSION.md). **It has not been submitted.**
