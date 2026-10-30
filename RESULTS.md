# AfterSend — measured results

This file holds measurements only. Targets and plans live in `docs/`. Every number below names how it was taken.

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
