# Build audit — 30 October 2026

This is a source audit against `docs/PRD.md`, the root PRD supplied in the workspace, implementation, tests, deployment files and reachable Git history. Findings below distinguish defects from incomplete work and optional scope. Runtime checks could not be completed: dependencies were absent and installation did not complete during this audit. The older test and Lighthouse results are historical evidence, not a fresh verification.

## Current status, 3 November 2026

This section replaces the status of everything below. The numbered list that follows is the original 30 October audit, kept unchanged as history; its blockers were resolved in the passes that follow it, and a later review found five more items, listed here.

| Item | Status now |
|---|---|
| Original findings 1 to 17 | **Resolved** except the three caveats in the next rows. Each has a regression test (see the second pass table) |
| #1 real speech | Verified live for both voices, repeats and a long notice. **Pronunciation not reviewed: nobody has listened** |
| #9 listening gate | Still an attestation (90 % of the preview played), not proof of listening |
| #10 place detection | Absent by decision; the interface asks for a manual check |
| Review finding: storage calls had no deadline | **Fixed.** Every storage request has a hard deadline, clamped to the time left in a generate request; timeouts fail the attempt cleanly and are recorded (`storage-deadlines.test.ts`, `storage-deadline.test.ts`) |
| Review finding: readiness probes shared one object | **Fixed.** Each probe uses its own random key and cleans up after itself |
| Review finding: the live journey cascaded after a failed prerequisite | **Fixed.** A step whose prerequisite did not pass is recorded as skipped with the reason; the report separates failed from skipped (`journey-needs.test.ts`) |
| Review finding: a published notice's source link could not be corrected | **Fixed.** The link is stored per revision and goes live with the revision (migration `0003`, backfilled; `source-link.test.ts`, including the migration run over old-shape data) |
| Review finding: abandoned demo workspaces were never removed | **Fixed.** Removed with their audio once unreachable (`demo-cleanup.test.ts`) |
| Production deployment | Deployed 30 Oct (23 of 23 checks). The fixes above are **committed locally, not deployed**; migration `0003` runs in the next production build |
| Full journey on production (publish, correct, withdraw, recover) | **Not verified.** The one attempt stopped when no sign-in code was supplied |
| Direct storage access to superseded and withdrawn audio | **Not verified** (needs a real published notice; the journey checks it) |
| Two-account boundary on production | **Not verified** |
| Migration lock under concurrent builds | **Not verified** |
| Exposed AssemblyAI key deleted | **Unconfirmed** |
| Demo video | **Not recorded** |

## Release blockers and high-priority defects

1. **Real speech integration is unfinished.** `src/lib/speech/assemblyai-protocol.ts:19` fixes `PROTOCOL_VERIFIED` to false and line 53 exports a null protocol. Adding a key alone cannot enable speech. Request frames, audio parsing, completion, auth format and the verified voice catalogue still need implementation and genuine provider smoke tests. This blocks the central P0 product promise, not just an enhancement.

2. **The documented environment template fails URL validation when copied as directed.** `.env.example` includes empty `APP_URL` and `SUPABASE_URL`; `src/lib/env.ts` declares both as optional URL strings. An empty string is present, not undefined, so parsing rejects it even when local storage is selected. Normalize blank optional environment values before validation; test the complete example configuration.

3. **Autosave can lose edits or create duplicate correction drafts.** In `src/components/app/notice-editor.tsx:98–166`, debounce callbacks do not serialize requests, the timer reference remains set after firing, and `flush()` can call `persist()` before an existing save completes. Two POSTs can create two drafts while `revisionId` is still null; overlapping PATCH responses can overwrite newer content or mark unsaved content saved. Use one serialized save queue, a stable revision ID reference, edit sequence tracking, and wait for the latest successful save before generating. Add delayed-response browser tests.

4. **Public caching undermines withdrawal and current-version enforcement.** `src/app/api/public/[token]/audio/[revisionId]/[file]/route.ts:21` returns `public, max-age=31536000, immutable`. A cached response bypasses subsequent database checks after correction or withdrawal. Use a policy that rechecks access on subsequent requests, and test actual browser caching as well as API requests. Already downloaded or buffered bytes cannot be recalled.

5. **Synthesis retries exceed the function lifetime.** `generate/route.ts:9` allows 60 seconds, but `revision-service.ts` permits three 45-second attempts plus backoff and storage work. The function can be terminated before recording failure, leaving a synthesizing draft. The stale-claim interval is about 150 seconds and UI conflict polling lasts about 90 seconds. Introduce an overall request deadline with cancellation or a durable worker; align retry, recovery and UI budgets. The comment claiming retries fit comfortably is incorrect.

6. **Ambiguity checks omit parts of the spoken script.** Generation and approval check only `revision.displayText` in `revision-service.ts`; title and update preface are spoken too. An ambiguous date in either field bypasses the gate. Validate all spoken fields and highlight problems in the corresponding controls.

7. **Staging cleanup has a race with preview replacement.** `src/lib/notices/cleanup.ts:28–33` checks the selected audio pointer in memory, then updates using revision ID and status only. If another request replaces an expired preview before that UPDATE, cleanup can clear the new valid preview. Include `audioAssetId = asset.id` in the conditional update and coordinate deletion with approval. Add an interleaving integration test.

## Other defects and incomplete safeguards

8. **PATCH can clear an omitted source URL.** `sourceUrlSchema` transforms undefined to null, and `updateDraftSchema` reuses it. `updateDraft()` interprets any non-undefined value as a requested change. A caller updating only text can therefore erase the draft source. Keep omission distinct from explicit clearing in the PATCH schema.

9. **The listening gate means “started playback.”** `src/components/audio-player.tsx:61–64` invokes `onListened` from `onPlay`, immediately enabling confirmation. The browser tests encode this shortcut. If the intended requirement is full preview review, track playback coverage/completion and reset it for changed audio. The server receives an attestation, not proof someone listened; describe that limitation accurately.

10. **Fact detection accepts impossible calendar dates.** `facts.ts:45–60` checks numeric ranges without month length or leap years, so `31/02/2026` passes. Text dates have no calendar validation, and standalone weekday matching is case sensitive. Add real calendar checks and representative mixed-case tests. Place detection is also absent; the UI asks people to review places manually.

11. **The E2E startup command is incompatible with standard Windows shells.** `playwright.config.ts:21` uses `rm -rf`. Replace it with a cross-platform Node helper scoped to `.data/e2e`. Keep the clean production-server startup, and verify on Windows.

12. **Audio inspection is weaker than the documentation implies.** `src/lib/audio/wav.ts` performs header checks, not decoding. MPEG acceptance needs only a frame-sync prefix; WAV does not fully check bit depth, block alignment, byte-rate consistency or sample alignment. Invalid content can pass the claimed decode gate. Strengthen structural validation or use a decoder, and revise claims to match what is tested.

13. **The body limit is enforced after buffering.** `src/lib/http/route.ts:44` reads the whole body before checking its actual size. Without a trustworthy Content-Length, this is not a bounded-memory 32 KB read. Enforce the limit while streaming and cancel oversized input.

14. **Published object cleanup is incomplete.** Approval copies bytes before the transaction; a losing approval can leave an unreferenced published object. Scheduled cleanup only processes database-tracked staging assets. Add reconciliation with a grace period and a clear retention policy; do not delete legitimate historical audio indiscriminately.

15. **Old synthesis workers lack a unique claim guard.** Reclaiming a stale synthesis uses status and synthesis key, but final success/failure updates are not conditioned on the owning attempt. A delayed worker can finalize or fail a replacement worker's claim. Persist a claim/attempt token and require it for all completion updates; test stalled-worker recovery.

16. **Workspace recovery and retention are missing.** Sessions expire after 30 days; logout deletes the only access token. There is no account login, recovery or workspace transfer. Notices can remain public after their owner loses access to correct or withdraw them. This is documented browser-only scope, but needs an explicit recovery decision before general use. Expired sessions, abandoned demo users and rate-limit keys also lack retention cleanup.

17. **Health does not mean product readiness.** `/api/health` returns `ok: true` when the database works even if speech is unavailable; storage is not checked. Keep liveness separate from readiness, and ensure deployment checks fail if required speech/storage configuration is unavailable.

## Unfinished P0 and missing verification

- Genuine intelligible sponsor synthesis, pronunciation review, real latency and failure evidence remain absent.
- Deployment, a deployed original-and-correction journey, a recorded demo and final submission are marked unfinished in repository documentation. No external deployment/account state was inspected.
- Hosted Postgres and S3 are not covered by the existing local integration suite; Supabase Storage tests mock HTTP. Run migrations, concurrent promotion and storage round trips against disposable hosted resources.
- No checked-in CI workflow was found. Add lint, typecheck, unit/integration tests and a production-build browser suite; keep paid provider smoke tests explicit and credential-gated.
- Add regression coverage for autosave ordering, browser cache invalidation, cleanup/replacement races, blank env values, omitted PATCH fields and request deadlines. Existing happy-path tests do not prove these behaviors.
- Conflict dialog in `notice-editor.tsx` declares modal semantics but has no focus trap or Escape handling. Test keyboard containment and focus restoration.
- Resuming a synthesizing draft fetches status once; automatic polling only occurs after a generate conflict. Poll active work when the editor reopens, and show a recovery action when its deadline expires.

## Cleanup and scope decisions

- Correct misleading comments first: retry duration, immutable public caching despite revocation, “decode” validation, and the claim in `http/errors.ts` that only correlation IDs are logged (the code also logs error stacks).
- Decorative section dividers in `revision-service.ts` and JSX labels that merely repeat visible section names can be removed. Ownership, compare-and-swap, protocol provenance and storage safety comments explain important constraints and should remain.
- README/results are dated 18 October; preserve dates and clearly label historical measurements. The ledger omits the subsequently added Supabase driver/tests. Consolidate the duplicate PRD copies only after choosing the maintained source; the root PRD was already untracked and was left untouched.
- PDF import, QR export, MP3 export, analytics, translation, organisation verification and a larger voice catalogue are explicitly deferred scope, not broken MVP features. Prioritize the speech and correctness gaps before adding them.

## Git attribution

Inspected all 146 commits reachable from the local branches and remote-tracking refs. No commit message matched `Co-authored-by` or `Claude` (case insensitive). `main` and cached `origin/main` both point to `1fa20eb`. No commit messages were rewritten and no force push was performed. This does not inspect unreachable commits, other clones, or remote changes not fetched into this repository.

## Recommended order

1. Make the example environment boot; complete and verify real sponsor speech.
2. Fix autosave ordering, public cache policy, request deadlines and spoken-field validation.
3. Fix cleanup/claim concurrency and PATCH omission semantics with regression tests.
4. Run current lint, typecheck, tests and production browser journeys; validate hosted drivers and wire CI.
5. Deploy and record evidence, then address recovery, retention and accessibility before wider use.


---

# Resolution status, 30 October 2026 (second pass)

Evidence key: **U** unit test, **I** integration test (PGlite + local store), **B** browser test (Playwright, production build), **L** live provider call, **R** code review or manual check. "Fixed" means a regression test fails without the fix; it does not mean deployed.

| # | Finding | Root cause | Status | Evidence |
|---|---|---|---|---|
| 1 | Speech protocol unfinished | Protocol constants unverified | **Implemented; live verification partial.** Protocol implemented from AssemblyAI's published quickstart. One live run (2 syntheses, `aai-jane`) succeeded; failure handling is tested against a local protocol server. `aai-kyla`, the EU endpoint, limits, repeatability and pronunciation are unchecked; no key is currently available | U `assemblyai-adapter.test.ts`, L `evidence/tts-smoke-2026-10-30T07-45-44-130Z.json`, R `audio:inspect` |
| 2 | Example env fails validation | Blank values parsed as present | **Fixed** (`env.ts` treats blank as unset) | U `.env.example` boot test |
| 3 | Autosave races, duplicate drafts | Unserialized debounce; no versioning; no create idempotency | **Fixed.** Serialized saver, `version` compare-and-swap, `expectedVersion` on approve, `clientToken` idempotent create, visible conflict dialog | U `serial-saver.test.ts`, I `reliability.test.ts`, B autosave ordering, slow create, lost create response, two-tab conflict, publish in other tab |
| 4 | Year-long public audio cache | `public, max-age=31536000, immutable` on revocable audio | **Fixed.** `private, no-cache` + ETag; 404 once superseded or withdrawn, even to an ETag holder | I `public-routes.test.ts`, B real browser cache after correction and withdrawal, Back navigation |
| 5 | Retries exceed function lifetime | 3 x 45 s attempts vs 60 s route | **Fixed.** One 50 s deadline shared by attempts, backoff and storage; per-attempt budgets; retry only if it fits; stale-claim and UI polling windows derived from the same value; misleading comment corrected | I deadline and stalled-worker tests |
| 6 | Ambiguity check skips title and preface | Only `displayText` checked | **Fixed.** All spoken fields checked at generate and approve; the problem is shown on the control | U, I (title, update note, approval), B |
| 7 | Cleanup vs preview replacement race | Unconditional UPDATE | **Fixed.** Detach conditioned on `audio_asset_id = asset.id`; bytes deleted only if no live row shares the object | I interleaving tests (replace during cleanup, approve during cleanup) |
| 8 | PATCH clears omitted source URL | Schema turned `undefined` into `null` | **Fixed**, and the same defect in `updatePreface` | U schema, I service |
| 9 | Listening gate means "started playback" | `onPlay` fired the callback | **Changed to "90 % of the preview played"** (browser `played` ranges; skipping ahead does not count). Still an attestation, not proof of listening | B listening-gate test |
| 10 | Impossible dates accepted; weekday case | Range checks only | **Fixed** (month length, leap years, written dates, mixed-case weekdays). **Place detection remains absent**; the UI asks for a manual check | U `facts.test.ts` |
| 11 | E2E start uses `rm -rf` | POSIX-only | **Fixed** (`scripts/e2e-clean.mjs`, scoped to `.data/e2e`); full suite run on Windows 11 | B |
| 12 | Audio inspection weaker than claimed | Header-only checks | **Fixed and claims corrected.** Strict 16-bit PCM WAV and MPEG frame-walk validation, silence rejected; documented as structural, not a decode | U `wav.test.ts` |
| 13 | Body limit after buffering | `req.text()` first | **Fixed.** Streamed read cancelled at 32 KB | U chunked-body test |
| 14 | Published object cleanup incomplete | Copy not tracked until promotion | **Fixed for tracked objects.** An intent row is written before the copy; not-ready rows are removed after 1 h. Bytes with no row at all would not be found | I reconciliation tests |
| 15 | Old workers lack claim guard | Completion not conditioned on owner | **Fixed.** `synthesis_claim` is required for success and failure updates | I stalled-worker tests (late success, late failure) |
| 16 | Workspace recovery and retention | Browser-only by design | **Resolved in the third pass.** Decision taken: passwordless email (one-time codes). Anonymous workspaces can be connected to a verified email, accounts can be recovered on any device, sessions can be ended everywhere, and expired sessions, rate-limit rows and spent sign-in codes are purged. Residual: mailbox compromise equals workspace compromise, there is no second factor, and an operator is needed if the mailbox is lost | I `email-auth.test.ts` (30), U `email.test.ts`, B `auth.spec.ts` (11), I `persistence.test.ts` |
| 17 | Health is not readiness | Single endpoint | **Fixed.** `/api/health` is liveness; `/api/ready` checks database, speech configuration and a storage write/read/delete probe | I |
| - | Conflict dialog lacks focus trap and Escape | - | **Fixed** | B keyboard containment and focus return |
| - | Resumed synthesizing draft polled once | - | **Fixed**; stalled claims show a recovery message | B (mocked status) |
| - | No CI | - | **Added** `.github/workflows/ci.yml`; not yet run on GitHub | R |
| - | Misleading comments | - | **Corrected** (retry budget, immutable caching, "decode", logging claim); decorative dividers removed | R |


## Third pass, 30 October 2026: recovery, live-probe tooling, infrastructure preparation

| Item | Status |
|---|---|
| Workspace recovery (#16) | Implemented and tested. See ARCHITECTURE section 8A. |
| A found defect: the 30 s resend cooldown blocked a new code right after the previous one was used | Fixed (cooldown now protects only a still-usable code); regression test added. Found by the browser suite. |
| Live AssemblyAI verification | **Blocked: no replacement key.** Tooling extended (both voices, repeats, a long notice, a timeout probe, a request budget). The no-cost bad-key probe was run live: an invalid key is refused as non-retryable `auth` (provider code 1008). |
| Human listening review | **Not done.** Template: `docs/LISTENING_REVIEW.md`. |
| Production infrastructure | Configuration, migrations, scripts, readiness (now including email and auth) and exact setup steps are prepared (`docs/DEPLOYMENT.md`, `scripts/verify-deployment.ts`). **No external account was touched; nothing is provisioned or deployed.** |
| Hosted-database path | Exercised with `postgres-js` over the Postgres wire protocol against PGlite behind a socket (migrations, publish, correction, withdrawal, simultaneous approvals, email sign-in). Not real Postgres, not Supabase. |
| Restart persistence | Tested for the local database and object store. |


## Fourth pass, 30 October 2026: release preparation

Ten defects in the deployment path were found and fixed (full table with tests in `RESULTS.md`): localhost fallback in page metadata, preview builds able to migrate production, a production build that could skip a missing database, unlocked migrations through the transaction pooler, no TLS or timeouts on the hosted database connection, test doubles and insecure cookies guarded only by opt-in variables, scripts ignoring `.env.local`, a cron route without a duration limit, and two bugs in the new tooling. Added: `check:env`, `verify:deploy`, `verify:live`, `docs/RELEASE_RUNBOOK.md`.

| Item | Status |
|---|---|
| Configuration checker (`npm run check:env`) | Done; covered by 23 unit tests. Two of its rules (test switches, local storage) were broken on purpose and caught; the others are covered by tests but were not individually mutated. |
| Hosted-production guards | Done; refuse test speech, file mailbox and non-Secure cookies on Vercel production. |
| Migration safety | Done except the lock itself, which cannot be demonstrated without a real Postgres. |
| Live verification (AssemblyAI, Resend, Supabase, Vercel) | **Blocked: no credentials, no deployment authorisation.** Tooling ready and rehearsed. |
| Human listening review | **Not done.** |


## Fifth pass, 30 October 2026: first live provider checks

| Item | Status |
|---|---|
| #1 Real speech: both voices, repeats, long notice, timeout, completeness assumption | **Verified live** (12/12 and 6/6 syntheses, duration difference 0 ms on all 23). Pronunciation **not reviewed**; EU endpoint not tried |
| New defects found only by the live service | Two: a 2 000-character per-frame limit the adapter ignored, and retry timing that could not outlast the 5-sessions-per-minute window. Both fixed with tests (see `RESULTS.md`) |
| Email (Resend, verified domain) | Sending and the real failure path verified; inbox receipt and rendering **not verified** |
| Shared Resend account | Protected by a daily cap on sign-in emails; AfterSend makes no other call to the account |
| Supabase database and storage | **Blocked**: password and service key not in `.env.local` |
| Deployment and live journey | **Blocked**: not authorised / needs a readable mailbox |
