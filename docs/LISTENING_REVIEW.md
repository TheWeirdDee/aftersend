# Human listening review

Code can prove that audio is intact, unclipped and complete. It cannot hear. A person has to play the files and sign this sheet. **Nothing in this repository claims a listening review took place; until this sheet is filled in by the person who listened, the answer is "not done".**

How to produce the files: `ASSEMBLYAI_API_KEY=… npm run tts:smoke -- --runs 1 --long` (writes WAVs to `evidence/raw/audio/`, not committed). Play each one in full on headphones or decent speakers, once at normal speed.

## Sheet

| | |
|---|---|
| Reviewer (name) | |
| Date | |
| Listening setup | |
| Smoke report file (`evidence/tts-smoke-….json`) | |

For each file, mark Pass / Fail and write what you heard.

| File | Voice | "3:00 PM" / "4:00 PM" clearly said? | Every word present, none repeated? | Natural pace, no odd pauses or glitches? | Dates, names and the phone-style numbers correct? | Verdict | Notes |
|---|---|---|---|---|---|---|---|
| `aai-jane-original-…` | aai-jane | | | | | | |
| `aai-jane-corrected-…` | aai-jane | | | | | | |
| `aai-kyla-original-…` | aai-kyla | | | | | | |
| `aai-kyla-corrected-…` | aai-kyla | | | | | | |
| `…-long-…` (about 1 800 characters) | | | | | | | |

The corrected file must say the update note first ("Update: pickup is at four p.m. at the main gate") and then the full notice with four p.m.

## Decision

- [ ] Approved for the demo and for real notices
- [ ] Approved for the demo only (pronunciation issues noted above)
- [ ] Not approved

Signed (the person who listened): ______________________   Date: ____________
