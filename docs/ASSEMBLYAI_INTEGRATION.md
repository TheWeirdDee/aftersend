# AssemblyAI TTS integration notes

## Protocol

The wire format comes from AssemblyAI's Streaming TTS quickstart (https://www.assemblyai.com/docs/tts/getting-started/quickstart), which supersedes the earlier hackathon endpoint `wss://streaming-tts.assemblyai.com/v1/ws`.

- Endpoint `wss://tts.us.assemblyai.com/v1/ws` (`tts.eu.assemblyai.com` keeps processing in the EU).
- Raw API key in the `Authorization` header. Voice and format are query parameters: `voice_id`, `language`, `sample_rate=24000`, `encoding=pcm_s16le`.
- The server sends `Begin` first (session id, model, sample rate). The client then sends `Generate { text }` and `Flush`.
- `Audio` frames carry base64 PCM (16-bit mono, no header). `FlushDone` ends the request. `Error` frames carry `error_code` and `error`.
- Voices used: `aai-jane` (the documented default) and `aai-kyla` (the playground's voice). Override with `ASSEMBLYAI_TTS_VOICES`.

## What has been checked

- 30 Oct 2026: `npm run tts:smoke -- --runs 1` synthesised the sample notice before and after the correction with `aai-jane`. Both returned decodable WAVs (15.8 s and 19.0 s), first audio after about 1 s, total about 2.6 s, model `assemblyai-tts-1`. The result file is in `evidence/`.
- `npm run audio:inspect -- evidence/raw/audio/*.wav` (30 Oct, local, no network) confirms both files are well-formed 24 kHz mono 16-bit PCM whose SHA-256 and duration match the smoke record; peak about -4 dBFS, no clipped samples, no pause over 700 ms, 0.2-0.4 s of trailing silence. This is a structural and level check only.
- **Nobody has listened to those files.** Pronunciation of times, dates and school terms, missing words and naturalness are unreviewed and cannot be judged by code. A person must play `evidence/raw/audio/original-run1-d023fce7.wav` and `corrected-run1-9459ddcd.wav` and confirm "3:00 PM" and "4:00 PM" are spoken clearly.
- Not checked against the real service: `aai-kyla`, the EU endpoint, text-length and rate limits, repeatability across runs, and the new completeness check (bytes versus the `audio_duration_ms` the server reports in `FlushDone`). Live checks stopped when the key used on 30 Oct was exposed; no replacement key has been provided.

## How the code is arranged

- `src/lib/speech/provider.ts` holds the provider-neutral `SpeechProvider.synthesize({ text, voiceId, outputFormat, requestContext })` contract.
- `src/lib/speech/assemblyai-protocol.ts` holds the wire format above.
- `src/lib/speech/assemblyai.ts` is the adapter: connection, handshake and overall timeouts, abort, chunk accumulation, a 25 MB cap, error mapping (auth / rate limit / provider / network, each retryable or not) and WAV wrapping.
- The revision service adds bounded retries, idempotency by `synthesisKey`, audio validation, SHA-256 and storage verification.

## Failure handling

Tested against a local server that speaks the documented frames (`tests/unit/assemblyai-adapter.test.ts`), not against the real service:

| Condition | Result | Retried |
|---|---|---|
| Audio frame with invalid base64 | `provider_error` | yes |
| Socket closes before `FlushDone` | `network` | yes |
| Bytes disagree with `audio_duration_ms` (lost frame) | `provider_error` "incomplete" | yes |
| No audio, or audio ending mid-sample | `provider_error` | yes |
| `Error` frame, auth (code 1008 / "unauthorized") | `auth` | no |
| `Error` frame, rate limit | `rate_limited` (2 s base backoff) | yes |
| No `FlushDone` within the attempt budget, or no `Begin` | `timeout` | yes, if the deadline allows |
| Caller aborts | `cancelled` | no |
| No API key | `not_configured` | no |

Retries and the overall deadline are in the revision service (`docs/ARCHITECTURE.md` section 3). The unproven assumption behind the completeness check is that `FlushDone.audio_duration_ms` equals the audio actually streamed, as in the quickstart's example output; confirm it with a live run and loosen `completenessProblem` if the real service differs.

## Live verification tooling (third pass)

`npm run tts:smoke` now covers everything the release needs, within a request budget (default 14 syntheses; it refuses to start if the plan exceeds it):

```
ASSEMBLYAI_API_KEY=... npm run tts:smoke -- --runs 3 --long --timeout-probe   # both voices x 3 runs x (original, corrected, ~1 800-char notice) = 18 requests: raise --max-requests or trim
ASSEMBLYAI_API_KEY=... npm run tts:smoke -- --runs 3                           # both voices x 3 runs x 2 notices = 12 requests
ASSEMBLYAI_API_KEY=... npm run tts:smoke -- --runs 1 --long --timeout-probe   # 7 requests
npm run tts:smoke -- --bad-key-probe                                           # no key needed, no credits
```

It records, per request: time to first audio, total time, decoded duration, **the duration the provider itself reported** (and the difference, which is the evidence for or against the completeness check's assumption), the request id, the model and the file hash. A timeout probe gives one attempt 150 ms and expects a retryable `timeout`. The summary line states that the human listening review is not done.

Run on 30 Oct with no credits: the bad-key probe. An invalid key is refused as non-retryable `auth` (provider code 1008) in under a second, which is the live confirmation that the adapter's auth mapping matches what the service really sends. Everything else needs a valid key.

## Key handling

The key is read only by `src/lib/speech/assemblyai.ts` on the server and sent only in the `Authorization` header. It is not in URLs, frames, logs, error messages, evidence files or the client bundle (checked 30 Oct). The key used for the 30 Oct run was pasted into a chat and must be treated as compromised: revoke it in the AssemblyAI dashboard and issue a new one.

## Running it

1. Put `ASSEMBLYAI_API_KEY` in `.env.local` (gitignored) or the host's environment settings, never in git or chat.
2. `npm run tts:smoke -- --runs 3`, then listen to every WAV in `evidence/raw/audio/` and record the results in `RESULTS.md`.

## AssemblyAI Agent

Per the team's account, the AssemblyAI Agent dashboard was used during early research and hit its free-tier request limit before producing a working integration. No export of that session has been added to this repository. Do not claim it generated working code. No further Agent credits were spent here.
