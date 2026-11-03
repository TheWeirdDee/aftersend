# Defect log: recovery and redesign, 3 November 2026

Each row says where the defect was, how it was reproduced, how serious it was, and what fixed it. "Reproduced" means it was made to happen on purpose; where it was not, the row says so.

Baseline screenshots of the production site as it was before this work (30 Oct build) are in `evidence/baseline-2026-11-03/`.

## Reliability

| # | Where | How it was found / reproduced | Severity | Fix |
|---|---|---|---|---|
| R1 | GitHub Actions `CI / verify`, step `npm test` (commit ecb3f21) | The job log shows `tests/integration/hosted-postgres.test.ts` failing with `read ECONNRESET` in `applyMigrations`. Root cause: the test started two migrators at once against `PGLiteSocketServer`, which accepts one connection by default and closes a second one (shown deterministically with two raw sockets: the second is closed). Windows timing hid it; the Linux runner did not. Raising `maxConnections` only moved the failure, because PGlite is a single session, so the advisory lock cannot serialise two migrators (they collided on `CREATE TABLE`). | High (CI red on main) | The PGlite test now runs the migrators in sequence. Concurrent migrators are tested against a real Postgres service container in CI (`tests/integration/real-postgres-migrations.test.ts`, `TEST_POSTGRES_URL`). That test has not run on this machine (no Postgres here); its first run is on GitHub. |
| R2 | Editor → listening gate, `/app/notices/:id/edit` | Not reproduced as a server or encoding fault: 80/80 plays of the same file in a bare `<audio>`, and 65/65 full editor flows, all passed. The symptom ("Loading audio", 0%, checkbox never enabling) was then seen once in the full suite and reproduced on purpose by making the audio request hang or abort. Cause in the product: the player entered a permanent error state after one failed request and never asked again, and a request that never answered left it waiting forever. | High (blocks publishing) | `AudioPlayer` reloads after a failed request (3 times) and after a start that does not happen within 4 s (3 times), then offers Try again. The gate still opens only after the audio has played through. `tests/e2e/audio-recovery.spec.ts` covers aborted and hung requests and checks the gate stays closed for audio that was never played. What caused the one stall in the suite run is not established. |
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

- The single stall seen in the full e2e run (R2): cause not established; recovery added and tested with forced failures.
- Cross-browser audio playback (Firefox, WebKit): not run in this session; see RESULTS.md.
