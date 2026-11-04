# Publisher review, 4 November 2026

Branch: `fix/editor-publish-proof`. No video was recorded during this work.

## Deployed baseline

- Tested URL: `https://aftersend-publish-review.vercel.app`
- Application commit deployed: `04868e5`
- Proof runner: `142f192` (adds the null audio sink used by the e2e suite)
- Health at test time: `{"ok":true,"checks":{"database":"ok"},"commit":"04868e5"}`

A fresh, clearly labelled test notice was created with the editor's own controls. The publisher used one browser context; the recipient used a separate context with no publisher cookies. Every approval, correction and withdrawal below went through the visible UI, not an API shortcut. No playback events or played ranges were fabricated.

### Publish and first listener

- Before playback the blocker read “Listen to the whole preview to continue.”
- The real AssemblyAI preview played 8.72 seconds to the native `ended` state.
- The blocker then read “Tick the box to confirm you checked the details.” and confirmation was enabled.
- Publishing returned HTTP 200. The confirmation screen showed “Published — share this link with families”, Copy link, Open listener page and Share.
- Copy link put the exact listener URL on the clipboard: `https://aftersend-publish-review.vercel.app/n/3mf_Bxeof5HSH1y4tqwRVQ`.
- The signed-out recipient saw 3:00 PM and played the 8.72-second announcement to `ended`.

### Correction at the same URL

- The publisher used Update this announcement and changed 3:00 PM to 4:00 PM.
- The replacement preview played 8.88 seconds to `ended`; approval returned HTTP 200.
- The public URL did not change.
- The recipient reloaded the same URL and saw the corrected badge, the correction summary (“The time is now 4:00 PM”) and the 4:00 PM text, then played the new 8.88-second recording to `ended`.

### Withdrawal

- The publisher used Withdraw announcement.
- The recipient's same URL then showed the withdrawn state, no audio element, and no playable current recording.
- A request for each previously played audio URL returned 404.

Evidence: `evidence/editor-proof-2026-11-04T10-32-59-272Z/report.json`. Screenshots in that directory cover the publish confirmation, the signed-out 3:00 PM listener, the corrected 4:00 PM listener and the withdrawn listener.

### Why the proof browser is muted

Chromium on this Windows host intermittently raises `AUDIO_RENDERER_ERROR` at 0:00 when the host audio device is busy (documented as R2 in `docs/DEFECT_LOG.md`). The first deployed proof hit it on the listener after the editor preview had played. The proof runner now uses the same `--mute-audio --disable-audio-output` null sink as the e2e suite. The media element still decodes the real provider recording and reports real progress and `ended`. This proves timing and playback completion, not audible quality.

## Public site changes

- The standalone “A” was removed; the entire mark and wordmark link to `/` in the public header, app header, footer and listener page.
- `/` is the complete homepage, with the lime headline blocks removed and the page gutters restored.
- `/docs`, `/corrections` and `/trust` are standalone pages, linked from the desktop header, mobile menu and footer.
- The public header, footer, hero, sign-in page and `#start` section use the same `px-5 sm:px-8` gutters and 1216px/`max-w-6xl` content widths.

Public-site evidence: `evidence/public-site-2026-11-04/`. The capture script checked 1440×1000 and 390×844, light and dark, all four pages. It reported zero horizontal overflow and no page errors at every combination. Screenshots include both mobile menus, all three standalone pages in both themes, and full-page homepage captures.

## Regression and checks

`npx playwright test tests/e2e/publish-controls.spec.ts tests/e2e/navigation.spec.ts --project=desktop --reporter=list` — **16 passed**.

The publish-controls test drives the actual editor controls. It plays normally, pauses at 94%, checks that confirmation stays locked, resumes to the end, confirms and publishes. A single injected HTTP 503 tests draft preservation and successful retry. The resulting listener is opened in a separate signed-out context. The navigation test covers the standalone pages and the logo/nav links.

Also passed before the deployed proof:

- `npx tsc --noEmit`
- `npm run lint`
- `npx next build`

The deployed `/api/health`, `/docs`, `/corrections` and `/trust` were fetched after the deployment; health named `04868e5`, and each page returned 200 with its expected title.

## Manual limits

- The headless proof is muted by design. A human listening check of pronunciation and audible output is still separate.
- The deployed journey was exercised in Chromium only; the repository's Firefox/WebKit cross-browser tests were not rerun against this deployment.
- Email account recovery was not part of this guest-based proof.
- The review used the Vercel alias, not a custom domain.
- Downloaded or forwarded copies of audio cannot be recalled after withdrawal; this is a product limit, not a defect.
