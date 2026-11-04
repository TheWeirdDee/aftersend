# AFTERSEND
## Product Requirements Document — Voice Hackathon Week: Hack into Speech

**Version:** 1.1 — Tightened execution lock  
**Date:** 18 October 2026  
**Status:** P0 scope locked; sponsor TTS protocol and account access still unverified  
**Owner:** Hackathon team (1–4 builders)  
**Submission target:** 23 October 2026, subject to organizer confirmation of the exact cut-off  
**Product line:** **A spoken notice you can correct after the link is shared.**

---

## 0. Executive build decision and scope gates

**Ship one exceptional proof, not a feature collection:** publisher pastes a notice → AssemblyAI synthesizes actual audio → publisher listens and approves → one public link plays the notice → publisher changes a time → new sponsor audio is reviewed and approved → the **identical link** serves the new transcript and audio. The old approved version remains served if anything fails.

**P0 only:** text paste, title, confirmed critical facts, sponsor synthesis, real playback, approval, immutable revisioned audio, stable public link, edit diff, atomic promotion, basic publisher authorization, mobile listener, clear failure states, deployed demo, independent tests, evidence and submission. A lightweight demo workspace is acceptable if isolated, abuse-limited and cannot mutate real publisher content. **Not P0:** PDF ingestion, QR export, MP3 conversion/download, multiple voices, waveform, pronunciation scoring automation, analytics, dark mode, account onboarding polish, withdrawal UI, translation, push updates. Add P1 only after deployed P0 is independently verified.

**Hard gates:** (G0) obtain event TTS protocol and perform a genuine intelligible synthesis; (G1) initial notice publishes with real audio; (G2) a correction promotes new audio at an unchanged URL; (G3) mobile, auth, race/failure tests pass; (G4) evidence, README, demo and submission match deployed functionality. Do not substitute mock audio or the separate Voice Agent API without explicit organizer authorization.

**AssemblyAI Agent bonus:** the organizer says extra points may be available for building directly with https://www.assemblyai.com/dashboard/agent. AssemblyAI's roadmap confirms the coding agent exists, but the dashboard requires authentication. Use it for an actual project-specific TTS integration task, save dated evidence of its contribution and resulting code, independently review and test that code, and ask organizers what qualifies. Do not claim bonus points merely for opening the page.

## 0A. Sponsor API and AssemblyAI Agent verification

- Hackathon Discord supplies `wss://streaming-tts.assemblyai.com/v1/ws`; **this is a supplied endpoint, not yet a verified message protocol**. Confirm authorization method, websocket frames, voices, format, limits, billing, retry semantics, streaming completion and allowed SDK through event-specific docs or a host.
- Public Voice Agent API uses a different endpoint (`wss://agents.assemblyai.com/v1/ws`) and includes STT/LLM/TTS; it is not an assumed replacement for the hackathon standalone TTS endpoint.
- In the authenticated AssemblyAI Agent dashboard, request a minimal TypeScript/Node example that synthesizes an exact 20–35 second school notice through the hackathon TTS endpoint; ask it to cite the documentation for every wire field, to keep secrets server-side, and to show how to capture and decode returned audio. Execute it against the actual account. Log success/failure and latency without secrets.
- Capture evidence of AssemblyAI Agent usage (task, timestamp, generated integration files, verification result), respecting platform terms and never exposing keys. If Agent cannot access hackathon TTS docs, seek organizer clarification rather than fabricating the protocol.
- On failure to access qualifying sponsor TTS, stop **implementation dependent on sponsor output** and report the precise manual blocker; independent UI/architecture preparation may continue only if clearly separated from claims of a working integration.

## 0. Decision, anchor, and constraints

### The problem, in one scene

A school office sends a notice to families. An unauthorized message or an incorrect time circulates afterward. Even if the office issues a correction, screenshots, forwarded files, and old audio messages remain in group chats. The school can correct its official notice, but it cannot edit a downloaded voice message on everyone else's phones.

**AfterSend gives an authorized publisher one stable, shareable link for a spoken notice.** When that publisher corrects a notice and approves the replacement audio, the **same link** plays the updated version and prominently identifies when it changed. Each version still has its own immutable audio file and revision history; the link resolves to the latest approved version.

### Real-world anchor

On **14 May 2026**, Lagos State's Office of Education Quality Assurance issued a public notice telling schools to disregard an unauthorized claim that students should be dismissed early on 15 May. The notice explicitly denied that an early-closure directive had been issued. This is proof of a concrete communication failure and the need for authoritative corrections; **it is not proof that audio would have solved that incident**.

Source: https://oeqalagos.com/urgent-notice-disregard-circulating-message-on-school-dismissal/

Secondary workflow anchor: schools regularly use notices, reminders, and calls to communicate schedule changes to families. We are designing for the **school administrator who actually publishes these notices**, not a speculative universal audio chatbot.

### Not another reading app

The difficult job is not converting text to speech. It is making **an already-shared voice announcement remain accurate**, preserving approved wording, indicating its revision, and giving the publisher an audio artifact usable today. A generic audiobook maker, summarizer, voice chatbot, translator, or text-to-speech playground does not solve this job.

### One critical sponsor dependency

The event description advertises **AssemblyAI's new Text-to-Speech API**. At this writing, AssemblyAI's public FAQ says standalone TTS is not generally offered, and its published roadmap identifies **TTS-1 as upcoming in Q4 2026**. The Voice Agent API already supplies synthesized speech as part of a managed speech-in/speech-out pipeline, but that is not automatically the same as access to the hackathon's standalone endpoint.

**Mandatory first task:** obtain the hackathon-specific TTS documentation, allowed credentials, model name, rate limits, output format, sample code, and submission requirements from the organizer/Discord. Never invent an endpoint or model identifier. The implementation below intentionally uses a `SpeechProvider` interface whose AssemblyAI adapter is populated **only from verified documentation**. If the organizer authorizes the existing Voice Agent API as an alternative, test whether it can render exact, fixed text before adopting it. Do not quietly substitute a competing TTS vendor for the sponsor integration.

Sources: https://www.assemblyai.com/docs/faq/do-you-offer-voice-to-voice-or-text-to-speech-tts ; https://roadmap.assemblyai.com/ ; https://www.assemblyai.com/docs/voice-agents/voice-agent-api

### Truthfulness boundary

- We do **not** claim that published audio bytes, downloaded MP3s, or forwarded WhatsApp voice-note files can change. Only **our hosted, stable share link** can serve updated audio.
- We do **not** claim to authenticate governments or schools in the hackathon MVP. A publisher controls only notices within their own workspace; demo content is clearly marked.
- We do **not** claim that TTS catches incorrect facts. It reads publisher-approved text. Source verification remains a human responsibility.
- We do **not** fabricate a second OEQA notice. A separately labeled **sample correction** is used to demonstrate the live update; the archival OEQA notice is a real source for the problem and an ingestion test.
- We do **not** promise or imply a win. This is the selected entry hypothesis, not a guaranteed result.

---

## 1. Product lock

| Field | Locked decision |
|---|---|
| User | School administrator, community-center manager, small-event organizer |
| Moment | Just issued a schedule notice; one critical detail changes or misinformation circulates |
| Existing artifact | Official circular/notice plus an audio announcement to share |
| Input | Publisher-written or pasted official notice, optionally a text-based PDF |
| Output | One stable listening link, current spoken notice, downloadable versioned audio file, readable notice text |
| First ten seconds | Two browser panes show the same link. Publisher changes “3:00 PM” to “4:00 PM,” approves, and the listening pane reloads to speak the correction and latest notice |
| Dominant mechanism | **An approved source revision regenerates speech and changes what the existing link serves** |
| Sponsor dependency | AssemblyAI synthesizes the actual announcement; without the voice output, the core user-facing artifact disappears |
| Unexpected moment | A listener with the old link hears the revised message and sees precisely when it was changed; there is no new URL to send |
| Live necessity | The final words are unknown until the publisher edits and approves the notice in front of the judge |
| Main proof | Real, timestamped generation and update runs on actual notice text; exported playable audio; measured update time and correction accuracy, including failures |
| Explicit exclusions | Bulk messaging, phone dialing, emergency broadcasting, autonomous publication, school identity verification, cloning a real official's voice |
| Kill trigger | No authorized access to qualifying AssemblyAI TTS within the first two hours **or** no intelligible sponsor-generated audio for the primary notice slice by the first build milestone |

**Positioning:** *AfterSend is not the messaging network. It is the authoritative, updateable audio destination you put inside the messages you already send.*

### Success definition

Within 90 seconds of landing on the product, a judge can inspect a real published notice, listen to its AssemblyAI-generated narration, change a meaningful field in the publisher workspace, approve a replacement, and hear the new audio from the **unchanged** listener URL.

---

## 2. Audience, jobs, and boundaries

**Primary: school office administrator.** Has a one-page notice to communicate, often under time pressure. Needs families to hear the correct date, time, location, and next action. Can paste final wording, listen to a spoken proof, approve it, share one URL, and later correct it.

**Secondary: community or event organizer.** Needs the same workflow for session times, venue changes, and schedule updates. This is a natural later market but receives no separate dashboard in the hackathon build.

**Listener: parent or attendee.** May have a small screen or prefer audio. Opens a link without an account. Must know what the current instruction is, when it changed, and where its source text can be read. The listener does not need a voice assistant or microphone.

**Not targeted:** emergency response control rooms, mass alert infrastructure, political campaigning, high-stakes clinical instructions, public-impersonation campaigns, identity verification, or general purpose AI voice chat.

### Core jobs-to-be-done

1. **Publish:** “Turn the notice I already wrote into an announcement I can share.”
2. **Check:** “Let me hear and inspect exactly what parents will hear before they hear it.”
3. **Correct:** “Change the pickup time without telling everyone to find a new link.”
4. **Prove currency:** “Make the current version unmistakable, with an update timestamp and written source.”
5. **Export:** “Give me an ordinary audio file for channels that require one, knowing files cannot auto-update.”

---

## 3. Product experience: the end-to-end flow

### Flow A — Create and publish

1. Publisher signs in to a protected dashboard.
2. Selects **New notice**. They paste the text of an existing circular or upload a text-based PDF; import is editable, never silently authoritative.
3. Enters a short title and optional source URL. The app detects dates, times, locations, and contact strings using conservative parsing. The human checks all critical values.
4. Publisher sees **Written notice** alongside a short **Spoken script**. In MVP the spoken script is the same approved text, preceded by a neutral title. It does not paraphrase away important facts.
5. Publisher chooses from actual, available AssemblyAI voices returned by the verified catalog or event docs. No invented voice IDs.
6. Clicks **Generate preview**. The UI displays request progress honestly and plays real generated audio.
7. Publisher may edit the script, replay, and then click **Approve and publish**. A revision is created with its own immutable audio asset and hash.
8. The product creates a random, unguessable stable URL of the form `/n/{publicToken}`. The initial page shows the current notice text, play control, date/time updated, and source if supplied.
9. Publisher copies the link, downloads the version-specific audio, or downloads a QR code. The UI clearly explains that only the **link** stays current after edits.

**Acceptance:** One approved version and one playable public page exist. No hidden demo fixtures or fake audio calls.

### Flow B — Correct after sharing (the hero interaction)

1. Publisher opens a notice and clicks **Edit notice**.
2. Changes a significant field, e.g., `Pickup is at 3:00 PM` to `Pickup is at 4:00 PM`.
3. A side-by-side diff shows deleted and added words and highlights the detected time change.
4. The app constructs a restrained **Update preface**, e.g., “Updated at 4:10 PM. Pickup is now at 4:00 PM.” The exact timestamp is the approved version publication time. A publisher must confirm it; the system cannot invent a cause.
5. The publisher plays the **replacement audio preview** generated from the complete approved new notice. A short update preface can be generated as a separate intro segment or within a combined script, depending on API capability and audio seamlessness.
6. On **Approve update**, the server atomically changes the notice's `current_revision_id` to the new approved revision **only after the audio object is uploaded, verified as decodable, and ready**.
7. The old listener tab, refreshed or reopened at the **identical URL**, displays the new publication timestamp, the concise update preface, the latest written notice, and the newest audio. The previous version remains accessible to the publisher only.
8. If synthesis fails, the previous approved version stays online. The editor receives a visible failure and a retry button; no broken partial publication.

**Acceptance:** A judge can copy the public URL before the edit and prove byte-for-byte that it has not changed after publication.

### Flow C — Listener experience

- No sign-in and no microphone.
- The first visible line is the notice title and **Last updated** time with local timezone.
- A prominent **Listen to current notice** button, not autoplay (browser policies and accessibility).
- Visible transcript in the exact current approved wording; text updates along with audio.
- Updated notices get a plain, unobtrusive update label and short current instruction above the player.
- Optional **Download this version** is explicitly described as a static copy.
- **Source** link shown only when the publisher provided one. The app states that the publisher supplied it; it does not confer verification.
- Helpful offline/error state: “This notice cannot be played right now. Read the current text below.” Do not serve an outdated audio track against newer text.

---

## 4. Information architecture and routes

| Route | View | Access |
|---|---|---|
| `/` | Landing / judge entry with working sample link and **Open live editor** CTA | Public |
| `/app` | Notice list and new-notice action | Signed-in publisher |
| `/app/notices/new` | Paste/import notice and preview | Signed-in publisher |
| `/app/notices/[id]` | Publisher detail, audio version, history, edit action, share | Owner |
| `/app/notices/[id]/edit` | Side-by-side diff, new TTS preview, approve | Owner |
| `/n/[publicToken]` | Current public listening page | Public, unindexed by default |
| `/demo` | Explicitly labeled sandbox workflow for judges | Public, isolated from production data |
| `/api/*` | Server-side controls, synthesis, assets, revision operations | Per-route rules |

The primary demo can use a single authorized judge demo workspace rather than requiring judges to create accounts. Ensure they cannot modify other users' notices, delete content, send messages, or create impersonating official pages.

---

## 5. Detailed UI/UX specification

### Design concept

Make it feel like an editorial publishing desk paired with a clean audio player — not an AI chatbot. Everything visually reinforces **the current notice**, **what changed**, and **what people hear**. The human approval decision is prominent. No hero illustration, stock dashboard, animated particles, glassmorphism, generic chat bubbles, or purposeless AI badges.

### Tokens (visual direction, not a requirement to ship dark mode)

- Typography: `Inter` or `Geist` for UI, `Newsreader` optional for the large notice preview heading. Default system fallbacks. Never require paid font files.
- Light surface: `#F7F7F4`; card: `#FFFFFF`; body text: `#202520`; muted text: `#606960`; strokes: `#DDE1D9`; primary ink: `#1F4D3A`; interactive hover: `#163D2D`; focus: `#2664E8`.
- Dark surface: `#111813`; card: `#1B241E`; body text: `#F2F5F1`; muted text: `#AEB9AF`; borders: `#334239`; interactive green: `#B5E0C1`; focus: `#8BAEFF`.
- Accent usage: dark green exclusively for primary publish/listen actions; amber `#9B6500` for **Unpublished changes**; red only for confirmed error or inaccessible audio. Avoid using color alone to encode status.
- Radius: 8px inputs, 12px cards, 999px small status pills. Borders mostly 1px, shadows minimal. 8px spacing system. Width 1180px desktop max; reading column 680px max.
- Desktop: split editor 55/45; listener page single centered column. Mobile: stacked editor and sticky **Preview audio** / **Approve** action bar, 44px minimum targets.

### Layout: publisher notice editor

**Header:** AfterSend wordmark left; right has workspace, last saved, **Open listener link**. 

**Left — Source and edits:** document title; source URL; text editor, preserving paragraphs; extraction warnings; critical-facts panel (`Date`, `Time`, `Place`, `Action`) only when confidence sufficient, otherwise “Review manually.”

**Right — Spoken output:** real audio waveform or simple progress bar, actual selected voice, playback control, exact spoken-script text, request state and synthesis latency. Before generating, show “No audio generated yet,” not a mock waveform. Below, **Changes from last published version** with inline diff and update preface input.

**Footer actions:** `Save draft` (secondary), `Generate preview` (primary until ready), then `Approve and publish` or `Approve update`. Disabled with precise explanation if audio has not completed.

### Layout: public listener

Top: `CURRENT NOTICE` as small neutral metadata, notice title, “Updated Oct 18, 2026 · 4:10 PM WAT” using actual stored time zone and a human-readable absolute timestamp. Primary waveform/player card, button with text label and keyboard control, synchronized sentence highlight only if trustworthy timestamps are available, written source below, and concise version note. If updated, the page text explicitly says “This notice was revised” and displays the **latest** instruction; stale values appear only in an optional history disclosure for the publisher, never the listener's primary instruction.

### Interaction and accessibility

- Keyboard accessible controls, screen-reader labels, semantic headings and buttons, clear 2px focus ring.
- Audio is opt-in; autoplay is prohibited.
- Play/pause, seek, native speed control (client playback rate) and waveform progress use actual audio duration.
- Audio isn't the only way to consume the notice: identical text always appears.
- Waveform is decorative unless genuinely computed from audio; basic native audio control is an acceptable fallback.
- Loading labels distinguish `Preparing script`, `Synthesizing audio`, `Checking file`, `Ready to preview`, `Publishing`.
- No “Verified school” or platform “Official” seal without genuine verification.
- Every notice is HTML-readable on a low-bandwidth phone.

### States to design explicitly

`empty`, `draft_saved`, `tts_queued`, `tts_synthesizing`, `tts_ready`, `tts_failed`, `approval_pending`, `published`, `revision_draft`, `revision_generating`, `revision_ready`, `revision_failed`, `update_published`, `listener_network_error`, `audio_unavailable`.

For each state, the main action and available data must be correct; no clickable dead ends.

---

## 6. MVP requirements (ranked)

### P0 — Submission-critical (revised gates override any conflicting optional wording below)

| ID | Requirement | Verifiable result |
|---|---|---|
| R01 | Import/paste a real notice and edit exact wording | Stored notice text equals publisher-approved text |
| R02 | Human confirms dates/times/contact details | Publish blocked until critical facts review is acknowledged |
| R03 | Generate speech using authorized AssemblyAI TTS | Real sponsor request and playable returned audio, request ID/timing captured |
| R04 | Preview and approve before publication | Cannot publish before preview audio is ready |
| R05 | Stable listener URL with current audio and full text | Public URL remains unchanged across revisions |
| R06 | Edit a published notice and show meaningful diff | Old/new time visible and accurate |
| R07 | New audio generated for updated text | New audio content hash differs from old version |
| R08 | Atomic version promotion | Failed update never changes public audio or text |
| R09 | Playback and version timestamp on mobile | Native audio plays and accessible text remains visible |
| R10 | Revision records and sponsor trace | One genuine run visible: source revision, TTS request metadata, duration, current pointer |
| R11 | Real judge sample and labeled simulated update | Public archival notice used faithfully; fictional demo input labeled as such |
| R12 | 2:00–2:40 filmed live run and working hosted application | Film, repo, URL and writeup agree on shipped functionality |

### P1 — Only after P0 passes

- PDF text extraction (max three pages) with page markers, human edit screen, failure on scanned-only PDF; never deploy OCR during the hackathon unless proven reliable.
- PDF/circular download where existing input was PDF and owner is permitted to redistribute it.
- Versioned MP3/WAV download from the actual sponsor output (transcode only if permitted).
- QR image download for the stable link.
- Change preface synthesized as an additional short segment with seamless join.
- One additional supported voice; multiple voices are **not** required for judging.
- Expiry/unpublish action with explicit `Notice withdrawn` public page rather than silent removal.

### P2 — Explicitly post-hackathon

Organization verification, school-domain SSO, bulk email/SMS, WhatsApp Business integration, IVR telephony, family contact databases, scheduled publication, automatic document watchers, multilingual translation, voice cloning, real-time push updates, and analytics dashboards. None belong in the first live slice or judge path.

---

## 7. Source-to-speech pipeline

### One dominant transaction

`Approved source text` → `normalized speakable script` → `AssemblyAI TTS` → `decodable audio in storage` → `human playback approval` → `atomic revision promotion` → `stable link plays latest`.

### Step 1: input ingestion

- Accept UTF-8 pasted text with paragraphs; maximum 6,000 characters for MVP (adjust after provider limits verified).
- If PDF import is implemented, use extractable text only and require users to inspect an editable rendering. Never silently treat failed extraction as an empty, valid notice.
- Use source URL as optional reference metadata, not a scrape-as-truth or organization credential.
- Strip scripts/HTML tags and escape all output. Source content is untrusted data, never instructions for the LLM or app.

### Step 2: deterministic fact review

- Detect time/date candidate strings using explicit parsers; ask a human to approve facts that could change behavior.
- Normalize only mechanically unambiguous content into an explicit `speechText`, e.g. `3:00 PM` → `three p.m.` or an agreed locale-specific reading. Keep `displayText` unchanged.
- Do not convert ambiguous `05/06/26` automatically: request explicit day/month/year resolution.
- For phone numbers, preserve the string in display text and generate spaced-digit speech according to a tested locale profile, then confirm through playback.
- Don't summarize, embellish, or add an unsourced reason for a change.

### Step 3: synthesis

- `SpeechProvider.synthesize({text, voiceId, outputFormat, requestContext})` returns `{audioBytes|audioStream, format, durationMs?, wordTimings?, providerRequestId?, providerModel?}`.
- Store the exact approved script, returned model/voice identity, real duration, request and completion timestamps, and a SHA-256 digest of the final audio.
- TTS request parameters are derived from the **verified event docs**. Do not assume SSML, pronunciation dictionaries, multilingual voices, streaming chunks, or word timings are exposed until a live call proves them.
- A 60-second announcement is allowed only if verified within the provider's length, billing and timeout constraints. Begin with a 20–35 second text.
- Optional fallback: if streaming chunks fail mid-synthesis, show failure and allow retry; do not publish partial audio.

### Step 4: proof and publication

- The app checks that output exists, has non-zero byte length, can be decoded and has expected media MIME; it does **not** claim that checksums prove the words were pronounced correctly.
- Preview audio must finish generating before the approval control unlocks.
- `approveRevision` uses database transaction or compare-and-swap against `current_revision_id` so two parallel edits cannot overwrite silently.
- Serve `/n/{publicToken}` with `Cache-Control: no-store` or carefully invalidated revalidation for current metadata. Audio assets may use immutable cache headers because each has a unique revisioned path.
- Player fetches one atomic current-revision manifest; it must not mix revision-1 transcript with revision-2 audio.

### Step 5: correction preface

A revision can have `updateSummary` fields: `changedField`, `currentValue`, `publishedAt`. Publisher reviews a simple sentence generated from those known values, e.g., “Updated at 4:10 p.m. The pickup time is now four p.m.” Only speak this preface if the audio really contains it and the written page shows it. Never announce an old value as if current.

### AI authority boundary

The model may speak the publisher-approved script. Non-generative code decides what notice is current, which versions exist, what URL resolves, and whether audio is ready. **A human approves every publication and correction.**

---

## 8. Technical architecture

### Reference stack

- **Web app:** Next.js (App Router), React, TypeScript, Tailwind, light-first CSS variables; dark mode deferred.
- **API:** Next.js server routes/server actions or small Node service; server-only AssemblyAI adapter.
- **Persistence:** PostgreSQL (Supabase or managed Postgres), Prisma or Drizzle, minimal migration scripts.
- **Object storage:** Supabase Storage or S3-compatible bucket; private synthesis staging and revisioned public assets exposed via safe signed/proxy URL.
- **Jobs:** a simple Postgres-backed queue with worker or managed queue; a background API job must not depend on a serverless request that times out during audio generation.
- **Audio:** browser HTMLAudioElement and Media Session API where available; server-side FFmpeg only if actual output conversion or joining is required and verified.
- **PDF text extraction (optional):** `pdfjs-dist` or server PDF text parser; no default OCR.
- **Auth:** managed email magic link or limited demo-mode auth. Protect write actions with server session + notice ownership checks.
- **Hosting:** Vercel for web, provider suitable for queue worker, managed Postgres/storage. Choose based on real running generation time; do not pretend Vercel functions are indefinite workers.

### Components

`NoticeEditor` → `NoticeService` → `NoticeVersionStore`  
`NoticeEditor` → `SynthesisJob` → `AssemblyAITtsAdapter` → `ObjectStorage`  
`PreviewAudio` ← `SynthesisJobStatus`  
`ApproveUpdate` → `VersionPromotionTransaction`  
`PublicListener` → `CurrentRevisionManifest` → `AudioAsset`.

### Hard reliability rules

- No customer API key in client bundles.
- No direct mutable audio URL for listener; asset URLs always include revision ID/digest.
- Idempotency key per text/voice/model synthesis request; duplicate clicks cannot produce duplicate published revisions.
- Retry generation (bounded exponential backoff) only on transient errors; render user-friendly rate limit and quota errors.
- Confirm job completion using actual provider response status; never advance from optimistic timers.
- Versions are immutable once published; edits create new drafts.
- Protect against two editors approving in parallel: conflict modal and review required.
- On unpublish, return “This notice has been withdrawn,” never quietly reuse stale audio.

---

## 9. Data model

```ts
type Notice = {
  id: string;
  ownerId: string;
  publicToken: string;        // unguessable, stable
  title: string;
  sourceUrl: string | null;
  timezone: string;           // e.g. Africa/Lagos
  currentRevisionId: string | null;
  state: 'draft' | 'published' | 'withdrawn';
  createdAt: string;
  updatedAt: string;
};

type NoticeRevision = {
  id: string;
  noticeId: string;
  revisionNumber: number;
  displayText: string;
  speechText: string;
  updatePreface: string | null;
  updateSummary: string | null;
  confirmedCriticalFacts: boolean;
  voiceId: string;
  provider: 'assemblyai';
  modelId: string | null;
  requestId: string | null;
  audioAssetId: string | null;
  status: 'draft' | 'queued' | 'synthesizing' |
          'preview_ready' | 'failed' | 'published';
  generatedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
};

type AudioAsset = {
  id: string;
  revisionId: string;
  objectKey: string;
  mimeType: string;
  sha256: string;
  bytes: number;
  durationMs: number | null;
  providerLatencyMs: number | null;
  contentReady: boolean;
};

type SynthesisAttempt = {
  id: string;
  revisionId: string;
  providerRequestId: string | null;
  modelId: string | null;
  voiceId: string;
  startedAt: string;
  firstAudioAt: string | null;
  completedAt: string | null;
  outcome: 'success' | 'failed' | 'cancelled';
  errorCode: string | null;
};
```

Every public manifest includes `noticeTitle`, `revisionId`, `revisionNumber`, `publishedAt`, `timezone`, `displayText`, `updateSummary`, `audioUrl`, `audioMime`, and optional `sourceUrl`. No raw private prompts or provider credentials.

---

## 10. API contract

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/notices` | Create draft from title/text/source metadata |
| `GET` | `/api/notices/:id` | Owner's latest state and revisions |
| `POST` | `/api/notices/:id/revisions` | Create proposed revision, return meaningful diff |
| `POST` | `/api/revisions/:revisionId/generate` | Queue sponsor TTS, idempotent |
| `GET` | `/api/revisions/:revisionId/status` | Poll queue state, attempts, preview URL if ready |
| `POST` | `/api/revisions/:revisionId/approve` | Atomically publish validated audio |
| `GET` | `/api/public/:token/current` | Return one self-consistent listener manifest |
| `POST` | `/api/notices/:id/withdraw` | Withdraw current notice (owner) |
| `GET` | `/api/health` | Health of app/storage/database; exclude sensitive keys |

**Auth:** all mutation endpoints validate the signed-in user's ownership; `GET /api/public/:token/current` accepts only the random public token and returns no unpublished revision. Rate-limit synthesis per user and IP. Use browser CSRF protections and request-body limits.

**Error envelopes:** `{ code, message, retryable, correlationId }`. Never send raw provider exception, API token, or internal stack trace to listener.

---

## 11. Judge path and demo data

### Public real anchor (research and ingestion)

Use the **14 May 2026 Lagos OEQA correction notice** as a real document in an archival demo. Do not make a fake notice impersonating OEQA; show attribution, historical date, public source, and **“Historical public example; AfterSend is not affiliated with this agency.”** Ingest the source text into the editor and produce a playable, clearly attributed demonstration narration. Show no endorsement or authentication claims.

### Hero workflow (separately labeled sample school scenario)

Use a clearly fictional **“Sample School Schedule Notice”** created solely for the judge demonstration, with the first approved instruction “Pickup is at 3:00 PM.” In a **live, unscripted edit**, change it to “Pickup is at 4:00 PM.” This sample is explicitly labeled `Demo data` on both the publisher and listening views. Show two browser panes: the producer generating and approving the corrected sponsor audio on the left; the old URL, unchanged, playing the new current version on the right.

### Additional judge-reachable scenarios

1. **Ordinary publication:** publish and listen to a 20–35 second notice; static audio download is P1.
2. **Correction:** same URL, new revision, updated time, updated audio, proper timestamp.
3. **Failure recovery:** automated integration test must prove failed synthesis cannot promote a revision; optionally demonstrate this with a clearly labeled sandbox fault-injection control, never as a fake sponsor outage.
4. **Mobile listener:** open the unchanged URL directly on a phone, read the text and play audio; QR generation is optional P1.

These are the entire judged feature set. Hide unsupported controls rather than presenting inert features.

---

## 12. Verification, metrics, and honest evidence

Run **real sponsor synthesis** for every judge sample before freeze. Create `RESULTS.md` outside the product UI and summarize only measured results in the README.

### Sponsor behavior sample

At least **three real synthesis calls** of the same 20–35 second notice under controlled conditions. Capture model/voice, text length, time to first audio if streaming, time to complete, decoded duration, response status, and whether the audio sounded intelligible on playback. Publish median observed timings only after measurement.

### Product experiment

- Use at least **10 actual generation/update runs** if rate limits permit; include successful and unsuccessful attempts in the denominator.
- Publish `successes / attempts`, `median synthesis time`, `median approval-to-current-link time`, and exact number of listener text/audio version mismatches observed.
- Include at least one named miss (mispronounced time, slow response, failed PDF parse, lost connection) and exactly how the UI handles it. Never claim zero errors from only a handful of runs.
- For correctness, have one human check every date/time/contact string in the exported audio against the approved text. The reviewer listens; a transcription model may help but does not prove correctness by itself.

### Comparisons

Compare the user workflow with a **static recorded voice note**: after a time changes, static audio must be rerecorded and redistributed; with AfterSend, the editor regenerates and approves a new version at the existing link. Measure actual elapsed seconds for both when possible. Do not claim a generalized productivity improvement from one demonstration.

### Acceptance checklist

- [ ] One real AssemblyAI speech generation request returns decodable audio.
- [ ] The actual spoken content uses the correct approved date/time in the hero demo.
- [ ] Old link token is identical before and after update.
- [ ] Old and new audio have distinct asset digests and immutable paths.
- [ ] Listener audio and text refer to the same revision ID.
- [ ] A synthesis failure cannot promote an incomplete revision.
- [ ] User can find updated information without hearing audio.
- [ ] All real/historical/sample inputs are correctly labeled.
- [ ] No API credentials appear in browser source or logs.
- [ ] Each button the judge can click has been exercised in a deployed run.

---

## 13. Threats, privacy, and responsible deployment

**Most important abuse case:** Someone could create an announcement that looks official but is not. MVP mitigations: no verified seals; publisher-controlled workspace; unguessable public token; demo watermark; visible source attribution (when supplied); product footer identifying AfterSend as the hosting tool, not the issuer. The product makes no real identity or provenance attestation. Commercial deployment requires real organization verification and moderation before serving trusted public institutions.

- Do not proactively distribute school/parent alerts or send WhatsApp/SMS in MVP. The publisher decides what and where to share.
- Do not scrape private family data or upload sensitive student records. Demo uses public historical notice plus invented, clearly labeled schedule sample.
- Upload files and notice text are untrusted; escape/validate; cap size and rate.
- Retain versions for account history and dispute resolution; provide deletion/withdrawal behavior. Set a short retention period for temporary synthesis staging files (e.g. 24 hours) and enforce it via scheduled cleanup.
- Use presigned object URLs or controlled asset proxies; never expose private staging audio.
- Do not allow custom impersonation of principals or public officials via cloned voices. Use catalog synthetic narrators identified as such.
- No platform claims that an issued notice is factually verified; the workflow enforces **approval**, not external truth.
- Public pages use `noindex,nofollow` by default. Make consent and publication consequences clear to owners.

---

## 14. Nonfunctional requirements

- **Audio:** intelligible spoken dates/times and minimal robotic pauses on the tested primary voice; exact model behavior must be proven with real calls.
- **Latency:** measure live, then choose honest UI thresholds; do not advertise arbitrary `sub-1s` synthesis. Target <30s for short previews only if actual provider performance supports it; otherwise adapt the length of the sample, not the measurement.
- **Listener load:** current revision metadata API should respond within 2s under normal demo hosting; audio starts after user taps using real network buffering state.
- **Consistency:** 100% atomicity for published revision manifests in automated integration tests; real-world speaker quality remains measured, not guaranteed.
- **Availability:** degraded text-only listening page remains accessible when audio delivery fails.
- **Security:** OWASP-style input validation, least-privilege storage, auth on mutations, no exposed API keys, basic throttling.
- **Responsive:** desktop 1440px and mobile 390px must both pass judge workflow.
- **Accessibility:** screen reader navigation, contrast, no autoplay, caption/text equivalent, keyboard-only operation.

---

## 15. Delivery plan (18–23 October 2026)

**The event copy specifies October 15–23, while the event screenshot also displays an October 24 time in its event schedule. Confirm the actual submission deadline and timezone in organizer Discord before freeze. Use October 23 as the conservative internal target, not as a verified submission rule.**

| Window | Non-negotiable deliverable |
|---|---|
| First 2 hours, Oct 18 | Confirm eligible TTS access, output format, request authentication and terms; run one successful synthesis. If unavailable, ask host rather than inventing integration. |
| First 25% | Plain text notice → sponsor-generated audio → real playback on a deployed route. Nothing else takes priority. |
| Through Oct 19 | Saved notices, revision data model, public stable link, human approval, atomic promotion. |
| Oct 20 | Correction diff, real update preface, idempotency, error cases, mobile listener. |
| Oct 21 | Two complete end-to-end real live rehearsals; observe audio pronunciation and fix critical failures. Gather evidence including misses. |
| Oct 22 (T–24h) | Feature freeze; working deployment; first submitted video and README; capture final screen footage. |
| Oct 23 | Final film, verify every reachable control, update measured numbers and exact API names, submit safely before organizer cutoff. |

**Stop work:** no voice cloning, no CRM, no translations, no marketing landing page overbuilding, no notification sending, no fake real-time viewer count, and no data dashboard until the central loop is genuinely working.

---

## 16. Film plan (2:00–2:40)

1. **Person:** School administrator needs to fix a message families have already received.
2. **Proof of problem:** Briefly show the public May 2026 notice denying unauthorized school dismissal information; accurately identify it as a historical example, not the same as the fictional demo.
3. **Gap:** You cannot recall a forwarded recording or audio file; a corrected circular may not travel as fast as the old message.
4. **Turn:** “AfterSend. A spoken notice you can correct after the link is shared.”
5. **Setup:** Paste a clearly marked demo school notice and synthesize with a real AssemblyAI call.
6. **Live proof:** Split screen. On left, change pickup time; show exact diff; generate new voice, listen, approve. On right, refresh the old URL. It speaks the **new** time.
7. **Artifact:** Show public mobile listening page, complete notice text, updated timestamp, and static MP3 download warning.
8. **Why AssemblyAI:** State the verified API/model actually used and show its real request/response timing; note why the synthetic voice is the core output.
9. **Payoff:** The school shares one link; changes now lead to one current voice. Disclose demo source and limitations. End with working URL.

**Recording rules:** Record actual browser interaction and actual generated audio. Do not pre-generate the supposedly live replacement. Minor edit cuts or time compression must be disclosed on-screen. Show at least one frame where the edited source and listener output are simultaneously visible. View once muted and once audio-only before upload.

### Judge-facing first sentences

**Inspiration:** “On May 14, 2026, Lagos education authorities had to publicly deny a school-dismissal message circulating in parent groups. Corrections need a place that stays current.”

**What it does:** “AfterSend lets an authorized publisher turn a notice into audio and update what the *same link* plays after the text changes.”

**How we built it:** “The app stores immutable approved revisions, generates narration through AssemblyAI's qualifying speech API, and atomically points a stable listening link at the newest ready version.”

**Limitation:** “We cannot recall downloaded audio or certify the factual truth of a notice; the stable link updates only after a human approves a new generation.”

---

## 17. README and submission package

`README.md` should begin with the one-line pitch, a GIF of the source edit and playback change, a link to the live product, and one sentence naming the school administrator's moment. Then provide a simple five-command local setup, a real API integration file map, the measured results **including misses**, and limitations. Keep planning documents internal rather than filling the repo root with reports.

Submission must include, if organizer rules require them: public hosted URL, source repository, short demo film, description, challenge tags, and explicit sponsor API usage. **The supplied event description does not provide a judge rubric, named judges, API endpoint, submission form, or guaranteed project-eligibility terms. Obtain them from the official event Discord instead of guessing.**

### Environment contracts

```text
DATABASE_URL=
AUTH_SECRET=
ASSEMBLYAI_API_KEY=          # server-only
ASSEMBLYAI_TTS_MODEL=        # fill from organizer's verified docs
ASSEMBLYAI_TTS_ENDPOINT=     # fill from organizer's verified docs
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_ACCESS_KEY=
OBJECT_STORAGE_SECRET_KEY=
APP_URL=
DEMO_MODE=false
```

Never commit `.env` or real credentials. Expose approved sample voice IDs only after querying the authorized voice catalog.

### Repository structure

```text
app/
  page.tsx
  demo/page.tsx
  app/notices/new/page.tsx
  app/notices/[id]/page.tsx
  app/notices/[id]/edit/page.tsx
  n/[publicToken]/page.tsx
  api/... 
components/
  notice-editor.tsx
  audio-preview.tsx
  current-notice-player.tsx
  revision-diff.tsx
lib/
  speech/provider.ts
  speech/assemblyai.ts
  notices/revision-service.ts
  notices/normalize-speech.ts
  notices/public-manifest.ts
  storage/audio.ts
  db/schema.ts
workers/
  synthesize-notice.ts
tests/
  notice-revision.test.ts
  public-manifest.test.ts
  sponsor-smoke.test.ts
README.md
```

---

## 17A. Mandatory independent verification matrix

| Proof | Pass condition |
|---|---|
| Sponsor wire protocol | One real authenticated TTS session with saved non-secret request metadata and playable audio |
| Speech fidelity | Human verifies dates, times, numbers and proper names by listening; pronunciation misses documented |
| Unchanged URL | Capture exact URL/token before and after an approved correction; byte-for-byte equality |
| Version consistency | Public manifest text, audio asset and revision ID agree under refresh and concurrent edits |
| Failure safety | Timeouts, disconnects, malformed audio and provider errors never replace last approved revision |
| Security | Unauthorized users cannot publish or edit another owner's notice; API key absent from client/logs |
| Mobile and accessibility | Test 390px viewport, keyboard navigation, screen reader labels, no autoplay, text fallback |
| Real deployment | Independent browser run verifies every reachable judge action and no dead buttons |
| Evidence | `RESULTS.md` separates measured data from targets and includes failures, model/voice identifiers if exposed |
| Submission | Actual URL, repo, demo film, claims and organizer form agree; deadline confirmed |

**Execution discipline:** Work autonomously until the end-to-end product and verification are complete, pausing only for truly manual credentials, account authorization, organizer-only documentation or submission actions. Never fabricate provider output, success rates, evidence, production users or screenshots. Make one-file-at-a-time git staging and commits (`git add path/to/file`), never `git add .`, and never add a `Co-authored-by: Claude` trailer. Treat pushes/deployments as separate actions requiring explicit owner authorization; audit-only work must never mutate remotes.

## 18. Execution brief for an AI coding agent

> Build **AfterSend** from this PRD with no redesign or scope expansion. Start by evaluating the authenticated AssemblyAI Agent for a real TTS integration contribution and documenting its use for the organizer bonus; do not confuse the coding agent with the runtime Voice Agent API. First inspect the verified event-specific AssemblyAI TTS documentation and test one authentic request that returns playable audio. Report the model, endpoint, voice IDs, output format, request latency and any access blocker. If TTS is inaccessible, stop at that blocker and request the organizer details; do not invent an endpoint or silently use another voice vendor. Once sponsor output works, implement the smallest vertical slice: pasted notice → real synthesized preview → human approval → stable public listening URL → edit time → newly synthesized preview → approve update → unchanged URL serving updated audio and text. Use TypeScript, Next.js, Postgres and object storage, keep credentials server-side, make versions immutable and promotion atomic. Ship a legible editorial UI with mobile playback and correct failure states. Use the actual May 2026 OEQA notice only as an attributed historical source and use separately labeled sample content for the live changed-time demonstration. Write tests for version consistency, publish failure, authorization and idempotency. Run every judge-visible path against the deployed app and report real timings and failures, never invented benchmarks. Finish the demo video and submission before adding optional features.

---

## 19. Decision risks and launch gates

| Risk | Severity | Early test | Decision |
|---|---|---|---|
| Hackathon TTS unavailable / lacks qualifying endpoint | Critical | Real auth + sample synthesis within 2 hours | Stop; ask organizers. Do not fake sponsor fit. |
| TTS mispronounces a critical time/date | Critical | Human playback of three real texts | Add deterministic speech normalization, or block publish with correction prompt. |
| Text and audio become different revisions | Critical | Two concurrent update integration tests | Atomic manifest and compare-and-swap approval. |
| Correction looks official when issuer is unverified | High | Demo page usability test | No badges or issuer verification claims; visible sample/hosting metadata. |
| Public notice can be abused for impersonation | High | Publishing permissions review | Restrict demo publication; production verification deferred. |
| PDF parser mangles a fact | Medium | Import real text-based PDF and compare | Fall back to paste/manual editing; PDF is P1. |
| Narration takes too long | Medium | Three real response timings | Honest progress, shorter sample, asynchronous jobs. |
| Judges mistake product for an MP3 editor | Medium | Unmuted first-ten-second test | Show original stable link + changed live voice simultaneously. |
| Existing school notification vendors overlap | Medium | Competitor review | Position tightly on link-level corrected **spoken** notices and human-approved revision, not bulk alert delivery. |

**Final ship decision:** Submit only if the hosted app demonstrably uses qualifying AssemblyAI speech, the edit-to-current-audio loop works with unchanged URL, at least one real archived notice has been ingested and narrated honestly, and the demo makes cause and effect legible. Everything else is optional.

---

## 20. Sources and research boundaries

- **Primary real-world incident:** Lagos Office of Education Quality Assurance, “Urgent Notice: Disregard Circulating Message on School Dismissal,” 14 May 2026. https://oeqalagos.com/urgent-notice-disregard-circulating-message-on-school-dismissal/
- **AssemblyAI public standalone TTS FAQ:** https://www.assemblyai.com/docs/faq/do-you-offer-voice-to-voice-or-text-to-speech-tts
- **AssemblyAI roadmap, TTS and recent features:** https://roadmap.assemblyai.com/
- **AssemblyAI Voice Agent API, existing real-time synthesized voice:** https://www.assemblyai.com/docs/voice-agents/voice-agent-api
- **AssemblyAI Voice Agent browser security:** https://www.assemblyai.com/docs/voice-agents/voice-agent-api/browser-integration
- **Event:** “Voice hackathon week: Hack into speech,” AssemblyAI, October 2026; the event copy was provided by the participant and should be treated as the source of disclosed dates, team size and prize structure. Its screenshot and pasted description do not state judging weights, submission requirements, or the event-only API access method.

All incident facts above are public-document-backed; product UX, architecture, estimated effort and proposed demo scenarios are design proposals, not externally validated market or performance claims.


## 21. Research and verification update — 18 October 2026

- AssemblyAI roadmap lists **AssemblyAI Agent**, a coding agent for working sample code, shipped September 10, 2026 and default onboarding since September 25: https://roadmap.assemblyai.com/ .
- Public dashboard Agent link redirected to account login when checked without an authenticated session: https://www.assemblyai.com/dashboard/agent . Its authenticated feature set and ability to use event-only TTS could not be independently inspected.
- AssemblyAI's published Voice Agent API documentation uses `wss://agents.assemblyai.com/v1/ws` for a speech-in/speech-out system; it is **not** the event's advertised standalone TTS endpoint: https://www.assemblyai.com/blog/how-to-build-with-voice-agent-api .
- Event-supplied standalone TTS endpoint is `wss://streaming-tts.assemblyai.com/v1/ws`. Authentication, frames, voices and model must be verified with organizers and a live authorized request.
- Organizer says AssemblyAI Agent use receives extra points; bonus criteria and scoring were not independently confirmed.
