# Submission draft — NOT SUBMITTED

Official form: https://forms.gle/NtYDsi3bgqMDK29j9. Submit only after the owner approves, and only once the fields marked **TBD** are real.

- **Project name:** AfterSend
- **One-liner:** A spoken notice you can correct after the link is shared.
- **Repository:** https://github.com/TheWeirdDee/aftersend
- **Live app:** https://aftersend-sigma.vercel.app (deployed 30 Oct 2026; the full publish-correct-withdraw journey is **not yet verified on it**, see `RESULTS.md`)
- **Demo video:** **TBD** (not recorded)

**Problem.** On 14 May 2026, Lagos education authorities had to publicly deny a school-dismissal message circulating in parent groups. Once a notice or voice note is forwarded, the school can't change it. Corrections travel slower than the original.

**What it does.** AfterSend lets a school office turn a notice into a spoken announcement at one stable link. When a detail changes, the publisher edits the text, listens to new audio, and approves it. The link families already have then plays the corrected version and shows when it changed.

**How we built it.** Next.js 16, TypeScript and Postgres (Drizzle). Each approved version is an immutable revision with its own audio file and SHA-256 digest. Approval is one transaction, a row lock with compare-and-swap on the notice's current revision, so the listener page never mixes old audio with new text, and failures leave the previous version live.

**AssemblyAI usage.** A server-only adapter streams text-to-speech over `wss://tts.us.assemblyai.com/v1/ws` (model `assemblyai-tts-1`, voices `aai-jane` and `aai-kyla`) and returns 24 kHz mono WAV. Measured live on 30 Oct 2026 (`evidence/tts-smoke-2026-10-30T11-39-29-250Z.json`): 12 of 12 syntheses succeeded across both voices, median about 1.0 s to first audio and 2.7 s in total for 15 to 19 s of speech; a 2 074-character notice succeeded in about 13 s. The live runs also found two limits the adapter now respects: a single `Generate` frame holds at most 2 000 characters, and the free plan allows 5 new sessions per minute for the whole account (the app waits as long as the provider says, or tells the user how long). **Not reviewed: pronunciation and naturalness; nobody has listened yet.**

**Limitations.** Downloaded audio can't be recalled; only the link updates. AfterSend doesn't verify issuers or facts. A human approves every version.
