# AssemblyAI TTS integration notes

## What is verified

| Fact | How |
|---|---|
| Endpoint `wss://streaming-tts.assemblyai.com/v1/ws` (supplied by organisers) accepts WebSocket upgrades | Live probe, 18 Oct 2026 (`evidence/tts-probe-unauthenticated-2026-10-18.json`) |
| Credentials go in an `Authorization` header or a `token` query parameter | The server's own error text |
| Error frame shape `{"type":"Error","error_code":<int>,"error":"<text>"}`, then close code 1008 | Same probe |

## What is not verified

- Whether `Authorization` takes the bare key or `Bearer <key>` (`npm run tts:probe -- --auth bearer` checks this)
- Model ids and voice ids
- The client message that submits text and the one that ends input
- Audio frame format (binary PCM vs base64 JSON), sample rate, channel count
- The completion message, request ids, rate limits, maximum text length, billing

None of these were found in `llms.txt`, `llms-full.txt`, `agent-instructions.md` or a web search on 18 Oct 2026. Public docs describe only the separate Voice Agent API (`wss://agents.assemblyai.com/v1/ws`). AfterSend does **not** substitute the Voice Agent API or another vendor.

## How the code is arranged

- `src/lib/speech/provider.ts` holds the provider-neutral `SpeechProvider.synthesize({ text, voiceId, outputFormat, requestContext })` contract.
- `src/lib/speech/assemblyai.ts` is the adapter. It already handles connection, auth header, handshake timeout, overall timeout, abort, chunk accumulation, a 25 MB cap, the verified error frame, close codes, error mapping (auth / rate limit / provider / network, each retryable or not), and WAV wrapping.
- `src/lib/speech/assemblyai-protocol.ts` holds the only unverified part: `PROTOCOL_VERIFIED = false` and `protocol = null`. While it is unset, the adapter refuses with `provider_not_configured`, and the UI says speech generation is unavailable.
- The revision service adds bounded retries (2, exponential backoff), idempotency by `synthesisKey`, decode validation, SHA-256 and storage verification.

## Finishing the integration (minimum manual steps)

1. Add `ASSEMBLYAI_API_KEY` to the environment (cloud environment settings or Vercel env), never in chat or git.
2. Get the TTS message schema from the hackathon Discord or organisers, or run `npm run tts:probe` to see what the server sends after a successful auth.
3. Fill `protocol` in `assemblyai-protocol.ts` from that source (auth header, URL params, request frames, frame parser, PCM format). Set `ASSEMBLYAI_TTS_VOICES` and `ASSEMBLYAI_TTS_MODEL`.
4. Run `npm run tts:smoke -- --runs 3`, then listen to every WAV in `evidence/raw/audio/` and record the results in `RESULTS.md`.

## AssemblyAI Agent

Per the team's account, the AssemblyAI Agent dashboard was used during early research and hit its free-tier request limit before producing a working integration. No export of that session has been added to this repository. Do not claim it generated working code. No further Agent credits were spent here.
