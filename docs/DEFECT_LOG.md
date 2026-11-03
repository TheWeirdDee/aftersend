# Defect log: recovery and redesign, 3 November 2026

Each row says where the defect was, how it was reproduced, how serious it was, and what fixed it. "Reproduced" means it was made to happen on purpose; where it was not, the row says so.

Baseline screenshots of the production site as it was before this work (30 Oct build) are in `evidence/baseline-2026-11-03/`.

## Reliability

| # | Where | How it was found / reproduced | Severity | Fix |
|---|---|---|---|---|
| R1 | GitHub Actions `CI / verify`, step `npm test` (commit ecb3f21) | The job log shows `tests/integration/hosted-postgres.test.ts` failing with `read ECONNRESET` in `applyMigrations`. Root cause: the test started two migrators at once against `PGLiteSocketServer`, which accepts one connection by default and closes a second one (shown deterministically with two raw sockets: the second is closed). Windows timing hid it; the Linux runner did not. Raising `maxConnections` only moved the failure, because PGlite is a single session, so the advisory lock cannot serialise two migrators (they collided on `CREATE TABLE`). | High (CI red on main) | The PGlite test now runs the migrators in sequence. Concurrent migrators are tested against a real Postgres service container in CI (`tests/integration/real-postgres-migrations.test.ts`, `TEST_POSTGRES_URL`). That test has not run on this machine (no Postgres here); its first run is on GitHub. |
| R2 | Editor → listening gate, `/app/notices/:id/edit` | Seen as an unexplained flaky failure (the checkbox never enabled, "Loading audio" at 0%, a random handful of tests per run). Not reproducible in 80/80 bare plays or 65/65 editor loops. Made measurable by recording every `play()`, `pause()`, `load()` and media event in the failing page: playback started (`playing`), then about 0.1 to 0.5 s later the element raised `MediaError code=3, "AUDIO_RENDERER_ERROR: audio render error"` and paused, with the file fully buffered. That is the browser failing to open the **audio output device** on this machine, and it recurred on every retry within a test. It is not the file, the server or the network. | High (blocks publishing) | Product: the player now reloads the audio and starts again from the beginning after an error that happened while the person was listening, reloads after a failed request and after a start that never happens (3 tries each), and offers Try again; the gate still opens only after the audio has played through (`audio-recovery.spec.ts`, including a simulated render error). Tests: Chromium runs with a null audio sink, so the suite does not depend on the host's audio hardware. With that change the full desktop and mobile suite passed 55/55. If a real listener's device keeps failing, the player cannot fix the device; the written announcement is always on the page. |
| R2b | Editor status, `notice-editor.tsx` | An older status answer arriving after a newer one overwrote it (the spoken preview would vanish and be replaced by a new audio element). Found while chasing R2. It was written as a deterministic test (a status answer held back for 5 s) and fixed by applying answers in the order the questions were asked (`src/lib/client/ordered.ts`). This did not cause the R2 failures. | Medium | Fixed; `status-order.spec.ts`, `ordered.test.ts`. |
| R2c | Editor, after a failed save | If a save failed and was retried successfully, no speech was ever requested: the automatic request had already given up while the text could not be saved. Found by `reliability.spec.ts`. | Medium | A successful retry restarts the pause timer for the voice. |
| R3 | `/app/notices/:id/edit` | A person could not edit while a preview was being prepared (fields locked, API refused the save). That makes automatic speech updates impossible. | High | Edits are accepted while speech is being prepared; a changed script drops the in-flight attempt's claim, so its audio can never attach (`tests/integration/auto-speech.test.ts`). |

## Product behaviour

| # | Where | Defect | Severity | Fix |
|---|---|---|---|---|
| P1 | Editor | Speech had to be requested with Generate / Regenerate. A stale preview stayed on screen after an edit. | High | Edits are saved, the preview is marked out of date at once, and after a 1.8 s pause one request is made, one at a time, newest text wins (`src/lib/client/speech-sync.ts`, unit-tested). Retry audio appears only after a failure. |
| P2 | Sample announcement, landing page | "Friday, 24 October 2026" is a Saturday. Nothing in the fact checker compared a weekday with its date. | Medium | The sample is computed from today's date (tests over 800 days). The fact checker now flags a weekday that disagrees with a written date that includes a year. |
| P3 | `/app/account` | A guest ("demo workspace") could not be saved to an email at all. | High | A guest can be saved to an email with a verified code, keeping everything (`tests/integration/email-auth.test.ts`, including the cross-browser refusal and the merge into an existing account). |
| P4 | `/n/:token`, `/app` | Real published announcements carried "Demo data" labels and a demo banner. | Medium | Guest announcements are ordinary announcements. |
| P5 | Generate route | One hourly limit for everyone. | Medium | Guests get a lower hourly limit and a shared daily ceiling (`GUEST_SYNTHESIS_LIMIT_PER_HOUR`, `GUEST_SYNTHESIS_PER_DAY`). |

## Design and copy

| # | Where | Defect | Severity | Fix |
|---|---|---|---|---|
| D1 | `/`, 1440 and 390 | Most of the page was blank black: sections stayed invisible until a scroll animation revealed them (see baseline `landing-*.png`). | High | No content is hidden pending JavaScript. |
| D2 | `/`, all | Weak hero, unclear audience, hackathon banner and footer copy, dark theme only. | High | New landing page built on the problem, with an interactive 3 PM → 4 PM demonstration, light, dark and system themes, Inter Tight display type, a new mark. |
| D3 | All app screens | Developer language: "Demo workspace", "Demo data", "Generate", "Regenerate", "Revision", "Synthesizing", sha256 and model ids on screen. | Medium | Product language throughout; technical detail removed from customer screens. |
| D4 | Header at 768 px (found during this work) | 2 px of horizontal scroll from a crowded header. | Low | Sign in moves behind the large breakpoint. |
| D5 | Dark theme (found during this work) | Marker highlight put light text on lime. | Medium | Dark theme uses a solid marker with dark text. |

## Not reproduced / not established

- Safari. Chromium and Firefox play the preview and the published page. Playwright's WebKit build on Windows cannot play any audio at all (a WAV made inside the page fails with code 4 there too), so WebKit playback is **unverified**; the spec skips that engine with the reason.
- Whether the AUDIO_RENDERER_ERROR in R2 would occur for real listeners: it depends on their device. It was seen only on this machine.
