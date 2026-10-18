# AfterSend — measured results

This file holds measurements only. Targets and plans live in `docs/`. Every number below names how it was taken.

## Sponsor speech (AssemblyAI)

| Check | Result | Evidence |
|---|---|---|
| Endpoint reachable | `wss://streaming-tts.assemblyai.com/v1/ws` upgrades (HTTP 101, server `Python/3.13 websockets/15.0.1`) | `evidence/tts-probe-unauthenticated-2026-10-18.json` |
| Unauthenticated behaviour | One text frame `{"type":"Error","error_code":1008,"error":"Unauthorized: missing Authorization header or token query param"}`, then close 1008 | same |
| Authenticated synthesis | **Not run.** No API key in the build environment, and the message protocol is not published | — |
| Synthesis latency, first audio, durations | **Not measured** | — |
| Human listening check of times and dates | **Not done.** Needs real audio | — |

Successful sponsor syntheses so far: **0 of 0 attempted.**

## Automated tests (local, 18 Oct 2026)

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
