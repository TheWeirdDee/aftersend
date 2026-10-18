# Submission draft — NOT SUBMITTED

Official form: https://forms.gle/NtYDsi3bgqMDK29j9. Submit only after the owner approves, and only once the fields marked **TBD** are real.

- **Project name:** AfterSend
- **One-liner:** A spoken notice you can correct after the link is shared.
- **Repository:** https://github.com/TheWeirdDee/aftersend
- **Live app:** **TBD** (not deployed)
- **Demo video:** **TBD** (not recorded)

**Problem.** On 14 May 2026, Lagos education authorities had to publicly deny a school-dismissal message circulating in parent groups. Once a notice or voice note is forwarded, the school can't change it. Corrections travel slower than the original.

**What it does.** AfterSend lets a school office turn a notice into a spoken announcement at one stable link. When a detail changes, the publisher edits the text, listens to new audio, and approves it. The link families already have then plays the corrected version and shows when it changed.

**How we built it.** Next.js 16, TypeScript and Postgres (Drizzle). Each approved version is an immutable revision with its own audio file and SHA-256 digest. Approval is one transaction, a row lock with compare-and-swap on the notice's current revision, so the listener page never mixes old audio with new text, and failures leave the previous version live.

**AssemblyAI usage.** **TBD.** Fill in only after a real authenticated synthesis: endpoint, model, voice, measured latency. Current state: a server-only adapter targets `wss://streaming-tts.assemblyai.com/v1/ws`; only the endpoint and its auth error frame are verified.

**Limitations.** Downloaded audio can't be recalled; only the link updates. AfterSend doesn't verify issuers or facts. A human approves every version.
