# Architecture and operating guarantees

Written 30 October 2026 against the code in this repository. Where a statement depends on a test, the test is named. Nothing here has been run against a deployed instance.

## 1. System overview

```
Publisher browser ── /app/* pages (Next.js, server-rendered) ── /api/* route handlers ──┬─ Postgres (Drizzle)
   NoticeEditor ── serialized autosave ───────────────────────────────────────────────────┤   notices, revisions,
                                                                                          │   audio_assets, attempts
Listener browser ── /n/:token (page, no-store) ── /api/public/:token/* ───────────────────┼─ Object storage (private)
   AudioPlayer                                                                            │   staging/…  published/…
                                                                                          └─ SpeechProvider ── AssemblyAI
                                                                                                 wss://tts.us.assemblyai.com/v1/ws
```

- **Framework:** Next.js 16 App Router, React 19. Route handlers are `force-dynamic`.
- **Data:** PostgreSQL through Drizzle. Embedded PGlite locally and in tests; `postgres-js` when `DATABASE_URL` is a Postgres URL. Migrations live in `drizzle/` and run on start for PGlite and in the Vercel build for hosted Postgres.
- **Storage:** `ObjectStore` with `local`, `s3` and `supabase` drivers. Keys are content-addressed and validated against a strict pattern.
- **Auth:** browser-bound workspace sessions (random 256-bit token in an httpOnly cookie, hash stored). Every read and mutation checks ownership; another workspace's ids answer `404`.
- **Speech:** `SpeechProvider` interface; `AssemblyAiTtsProvider` (server-only) and a labelled test-tone provider that must be opted into.

## 2. Revision lifecycle

A **notice** has one permanent `publicToken` and a pointer `current_revision_id`. A **revision** is an immutable-once-published version of the text, voice, speech script and audio.

```
                     edit (version+1)                    edit (version+1; drops the preview)
                    ┌──────────────┐                    ┌──────────────────────────────┐
                    ▼              │                    ▼                              │
 create ──► draft ──generate──► synthesizing ──ok──► preview_ready ──approve──► published ──new version published──► superseded
              ▲  ▲                  │ │                    │                       
              │  └─ failed ◄──error─┘ └─ stale claim ─┐    └─ preview expires (24 h) ─► draft
              │        │ generate again                │
              └────────┘            reclaimed by another generate request
```

- `discarded` is reached only by explicit discard of an unpublished correction.
- **Only `draft`, `failed` and `preview_ready` revisions can be edited.** `synthesizing`, `published` and `superseded` ones refuse with `409 conflict` (`reason: "locked"`), so approved text and audio cannot change.
- A notice is `draft` until its first publication, then `published`, and finally `withdrawn` (terminal).

### Versions and optimistic concurrency

Each revision has an integer `version`, bumped by every edit and by promotion.

- `PATCH /api/revisions/:id` carries `expectedVersion`. The update is `WHERE version = <version read>`, so a save made against an older version matches nothing and returns `409 conflict` with `details.reason = "stale_version"` and the current version. A concurrent pair of saves can never both apply on the same base.
- `POST /api/revisions/:id/approve` **requires** `expectedVersion`: the saved version whose audio was previewed. A newer save makes it `409`. Promotion is conditioned on `status = preview_ready`, `audio_asset_id = <the verified staged asset>` and that version.
- `POST /api/notices/:id/revisions` accepts a `clientToken`; a unique index on `(notice_id, client_token)` makes a retried create (lost response) return the original draft.
- Approval compare-and-swaps `notices.current_revision_id` under a row lock. A draft started from an older version cannot be published (`reason: "superseded"`); `generate` refuses such a draft before spending provider credits.

### Autosave (browser)

`src/lib/client/serial-saver.ts` runs saves strictly one at a time and sends only the newest edit; edits made while a request is in flight are coalesced into one follow-up. The editor reports "Draft saved" only when the newest edit was acknowledged and the status shown matches it. States: *Unsaved changes*, *Saving…*, *Not saved* (with Retry, and an automatic retry when the browser comes back online), and *Conflict: not saved* (a dialog offering "Save my edits over it" or "Load the latest"). Generate and approve both wait for, or refuse on, an unsaved or failed save.

## 3. Synthesis

`POST /api/revisions/:id/generate` (`maxDuration = 60`):

1. Checks ownership, state, that the draft still builds on the current version, and every spoken field (title, update note, text) for ambiguous or impossible dates.
2. **Claims** the revision with a fresh attempt id stored in `synthesis_claim`. Only that attempt may complete or fail the synthesis; every completion update is conditioned on the claim, the status and the `synthesis_key`. A stalled worker that wakes up after its claim was taken over therefore changes nothing (`reliability.test.ts`).
3. Runs the provider under one **deadline** (`SYNTHESIS_DEADLINE_MS`, default 50 s). Each attempt gets `min(ASSEMBLYAI_TTS_TIMEOUT_MS, time left − reserve)`; a retry starts only if backoff plus a minimum attempt still fit. At most two retries, with exponential backoff (500 ms, or 2 s after a rate limit).
4. Validates the audio (`inspectAudio`), writes it to `staging/`, reads it back and compares SHA-256, then attaches it in a transaction.

A claim older than `deadline + 15 s` is presumed abandoned and may be taken over. The status endpoint reports how long the current claim has been held; the editor polls while work is in progress and shows a recovery message when it passes that limit.

If the browser disconnects mid-request the server keeps going and the result is stored. Reopening the editor shows it. On platforms that terminate the function on disconnect, the claim simply goes stale and the draft can be generated again.

### The adapter

`src/lib/speech/assemblyai-protocol.ts` holds the wire format, taken from AssemblyAI's Streaming TTS quickstart. `assemblyai.ts` rejects: invalid base64 (never decoded loosely), a stream that closes before `FlushDone`, no audio, audio ending mid-sample, and audio whose length disagrees with the `audio_duration_ms` the server reported (a lost frame). Each of these is a retryable `provider_error`/`network` failure. Auth and invalid-request errors are not retried. Error text from the provider is never forwarded to the client and the API key never appears in URLs, frames, messages or logs.

## 4. Publication and the public link

`GET /n/:token` and `GET /api/public/:token/current` resolve the notice's **current** revision with one join (notice → current revision → that revision's published audio), so text and audio always come from the same version. Drafts, previews and superseded revisions are not reachable from either.

Approval copies the verified staged bytes to `published/<notice>/<revision>/<sha>.wav`. It first inserts the `audio_assets` row with `content_ready = false`, writes the object, and flips the row to ready inside the promotion transaction. A lost or crashed approval therefore leaves a tracked, not-ready row that cleanup removes after an hour (`cleanupAbandonedPublished`).

## 5. Cache strategy and withdrawal

| Response | `Cache-Control` | Why |
|---|---|---|
| `/n/:token` page | `private, no-cache, no-store, max-age=0, must-revalidate` (Next.js default for dynamic pages; asserted in e2e) | The current version can change at any time. |
| `/api/public/:token/current` | `no-store` | Same. |
| `/api/public/:token/audio/…` | `private, no-cache` plus `ETag: "<sha256>"` | The bytes for a URL never change, but permission to serve them does. `no-cache` lets the browser keep the file yet forces it to ask before each reuse; the server answers `404` once the revision is superseded or withdrawn, or `304` if still current. |
| Error responses | `no-store` | A `404` must not be cached either. |
| Owner preview audio | `private, no-store` | |

The previous policy, `public, max-age=31536000, immutable`, let a browser or shared cache replay the audio without contacting the server. Regression tests: `tests/integration/public-routes.test.ts` (headers, 304, 404 after correction and withdrawal, including with the old ETag) and `tests/e2e/reliability.spec.ts` (a real browser cache that already holds the file gets `404` after a correction and after withdrawal, and Back navigation shows the withdrawn page).

### What withdrawal guarantees, and what it cannot

- From the moment `withdraw` commits, every application route stops serving the notice's audio and text: the page shows "withdrawn", the manifest says `withdrawn` without an audio URL, and every audio URL answers `404`, including to a client holding a cached copy and presenting its ETag.
- The object bytes stay in storage as history. They are reachable only through the application, **provided the bucket is private** (see `docs/DEPLOYMENT.md`). A public bucket would bypass every check above.
- Already-downloaded files, audio a listener has buffered or saved, and copies made by anyone else **cannot be recalled**. The listener page says so next to the download link.
- A page that is already open keeps playing what it has loaded; the update watcher tells the listener the notice was withdrawn when it next checks (every 30 s, on tab focus and on back/forward restore).

## 6. Cleanup and retention

`GET /api/cron/cleanup` (Bearer `CRON_SECRET`, daily via `vercel.json`) runs:

- **Staging previews older than 24 h.** The revision is detached first, conditioned on that exact asset still being its preview, then the row is marked deleted and the bytes removed unless another live row points at the same object. A preview replaced or approved while cleanup runs is left alone (`reliability.test.ts`).
- **Abandoned published copies** (`content_ready = false`, older than 1 h).
- **Expired sessions**, **rate-limit rows older than 24 h** and **sign-in challenges** that expired more than an hour ago.

Ready published audio is never removed: superseded versions are the notice's history. There is no workspace recovery (see §9).

## 7. Readiness

`/api/health` is liveness: the process answers and the database is reachable. `/api/ready` is readiness: database, speech configured (configuration only; it never makes a billable call) and an object-store write/read/delete probe. It answers `503` if any fail. Point load-balancer checks at `health` and deployment gates at `ready`.

## 8. Security notes

- Same-origin check, JSON-only bodies, `SameSite=Lax` cookie. Request bodies are read as a stream and cancelled at 32 KB; `Content-Length` is only an early exit.
- Audio inspection is structural: 16-bit PCM WAV with consistent header fields, whole samples and audible content, or an unbroken run of valid MPEG frames. It does not decode audio and cannot tell which words were spoken.
- Secrets: `ASSEMBLYAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the object-storage keys are read only by server modules. A search of `.next/static` for these names finds nothing.
- The listening gate is an attestation: the editor requires 90 % of the preview to have actually played (not merely started, and skipping ahead does not count) and a ticked confirmation. The server records that the publisher approved a specific saved version; it cannot know that anyone listened.

## 8A. Accounts, sign-in and recovery

A **workspace** is a row in `users`. It is *anonymous* (reachable only through a session cookie), *email-verified* (`email` and `email_verified_at` set), or *demo* (fictional data, never linkable). Every notice belongs to exactly one workspace and every read or write checks that ownership, so email accounts add a way to reach a workspace without changing who may touch what.

### Sign-in with a one-time code

There are no passwords and no links in the email. A code was chosen over a magic link on purpose: a link can be consumed by a mail scanner's prefetch, can be opened on the wrong device, and teaches users to click links in sign-in mail; a code is typed by the person who asked for it, on the device they are using.

1. `POST /api/auth/request { email }` creates a challenge (a 6-digit code from `crypto.randomInt`) and emails it. The response is always `202 { ok, cooldownSec }`.
2. `POST /api/auth/verify { email, code }` checks it and signs the browser in with a **brand-new session token**; the token the browser presented before (if any) is deleted, so a planted or stale token cannot ride through sign-in.

Properties, each covered by a test in `tests/integration/email-auth.test.ts` unless noted:

- **Codes are not stored.** Only `HMAC-SHA256(AUTH_SECRET, challengeId:code)` is kept. In production the app refuses to issue codes without `AUTH_SECRET`.
- **Single use, short life, newest wins.** Valid for 10 minutes, consumed atomically (two simultaneous correct submissions: exactly one signs in), and requesting a new code retires the old one.
- **Guessing is bounded.** 5 wrong guesses kill the code (even a later correct guess fails); 30 verify attempts per address and per IP per hour; 5 code requests per address and 20 per IP per hour (the two IP limits are configurable). A 6-digit code with these limits gives an online guesser a chance of about 2.5 in 100 000 per hour per address (5 guesses on each of 5 codes, out of 1 000 000).
- **No account enumeration.** The request path never looks an address up in `users`; the response, status and email body are identical for known and unknown addresses (compared in a test), and every verify failure (wrong, expired, used, locked, unknown address) returns the same message. The resend cooldown (30 s, applied only while the earlier code is still usable) is the same for every address. What this cannot hide: rate-limit responses are per address and so reveal that *someone* has been requesting codes for it, and delivery timing is up to the mail provider.
- **Plain-text email only,** sent server-side with a key that is never sent to the browser, never logged and never placed in a URL (`tests/unit/email.test.ts`). Provider error bodies are not echoed.

### Linking, merging and takeover resistance

Whether an email attaches to the browser's current workspace is decided by two facts that must both hold: the code was **requested** from that workspace's session, and is **verified** from the same session. Then:

| Situation | Result |
|---|---|
| New address, browser holds an anonymous workspace that asked | The email is attached to that workspace; its notices and link stay as they are. |
| Address already owns an account, browser holds an anonymous workspace that asked | The workspace's notices move into the account and the empty workspace is deleted (one way only: the account's notices never move). The sign-in page says this before a code is requested. |
| Address already owns an account, no workspace involved | Plain sign-in, including from a new device or after clearing cookies. |
| Code requested in one session but verified in another | No link, no merge. |
| Demo workspace | Never linked or merged. |

To take over someone's notices an attacker would need the victim's mailbox (to read the code) *and* the victim's cookie workspace (to merge it), or the victim's mailbox alone, which is the same trust as any email-based recovery. Holding only a signed-in workspace of their own gets an attacker nothing (tested: a wrong guess fails, and the account's notices stay put).

**Residual risks, stated plainly.** Whoever controls the mailbox controls the workspace. A person who is talked into reading a code aloud can have their address attached to the caller's workspace; the email says, in plain words, never to share it and what entering it will do. There is no second factor.

### Sessions

Sessions last 30 days from sign-in (absolute, no sliding renewal; signing in again is a code away). **Sign out** removes this browser's session. **Sign out everywhere** (`/app/account`) deletes every session of the account on every device. Expired sessions are purged by the daily cleanup. The cookie is `httpOnly`, `SameSite=Lax` and `Secure` in production.

### What a user sees

`/signin` (email, then code), `/app/account` (status, connect an email, sign out everywhere), a **Save to email** prompt in the header for anonymous workspaces, and a workspace gate that offers email first. The anonymous "start without email" path still exists and can be connected later.

## 9. Known limitations

- **Recovery depends on the mailbox.** A workspace connected to an email survives cleared cookies, a new browser and a lapsed session. An *anonymous* workspace (started without email) is still only a cookie: until it is connected, losing the cookie loses the ability to correct or withdraw its notices. A user who has also lost their mailbox needs an operator to withdraw by hand (`update notices set state = 'withdrawn', withdrawn_at = now() where public_token = ...`). There is no second factor and no mailbox-change flow yet.
- Place names are not detected as critical facts; the UI asks the publisher to check them. Written dates and times are validated against the calendar; weekday/date agreement is not checked.
- Synthesis runs inside the request. Real speech took about 2.6 s for a 15–19 s notice, so a 6 000-character notice (about six minutes of speech) may exceed the 50 s deadline and will fail with a clear message rather than hang.
- The `postgres-js` driver is exercised over the Postgres wire protocol against PGlite behind a socket, and the Supabase Storage driver against a mocked HTTP API. Neither has run against real Supabase, and S3 has not run at all. Email delivery through Resend has been tested only against a mocked HTTP client.
- Pronunciation of times, dates and school vocabulary has not been reviewed by a person.

## 10. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| "Speech generation is unavailable" | No `ASSEMBLYAI_API_KEY`, or `SPEECH_PROVIDER=test` without `AFTERSEND_ALLOW_TEST_PROVIDER=1` | `GET /api/ready` names the reason. |
| Generate keeps failing with "rejected the credentials" | Key revoked, rotated or wrong | Set a new key; no redeploy of code needed. |
| "Audio generation ran out of time" | Notice too long for the deadline, or the provider is slow | Shorten the notice or retry; check `synthesis_attempts` for timings. |
| Editor says "Generation stalled" | A worker died holding the claim | Press Generate again; the claim is taken over after `deadline + 15 s`. |
| "This draft changed somewhere else" | The draft was saved from another tab | Choose *Load the latest*, or *Save my edits over it*. |
| Listener hears an old version | They hold a downloaded file, or an unrelated proxy ignores `Cache-Control` | The link itself always resolves to the current version. |
| E2E fails to start on Windows | Stale `.data/e2e` held by a running server | Stop the server; `node scripts/e2e-clean.mjs` clears it. |
