# پیام صوتی در پیام‌رسان

Shared design: `cycles/015-messenger-chat/design.md`.

## Rules

- **R1** Incoming voice goes to speech-to-text through the connected service (ElevenLabs Scribe), and the transcript is shown so a mistake is visible.
- **R2** A short transcript starts the run at once; a person can turn on confirm-before-run in Settings.
- **R3** If no service is connected, the bot says so with a link to the connections page, and keeps the file in `uploads/`.
- **R4** Reply by voice: a "Listen" button under an answer, or a per-chat setting. The text is always sent as well.
- **R5** Long answers: a summary is read, not the whole text, and code is never read. The length is capped to limit cost.
- **R6** Audio is converted to what `sendVoice` needs (OGG Opus through ffmpeg). If that fails, it is sent as a normal audio file.
- **R7** The chosen voice and model are in Settings. Real use is measured on Persian before this card closes, because vendor accuracy numbers conflict.
- **R8** The panel gets the same speech tools, because they live on the server.

## Acceptance criteria

- A voice file becomes a run with a transcript; no service gives a clear note; Listen returns audio; a very long answer is capped.

## Documentation Impact

- rodo/linux-agent/project/how-it-works.md — how the messenger works
- rodo/linux-agent/project/client-overview.md — status
- rodo/linux-agent/project/architecture.md — the channel layer
- deploy/README.md — any new package or setting

## Open Questions

- none that block work; see `design.md` for choices a person may want to change

## Decisions

- ElevenLabs first (default, not asked). Because the user has already connected it and it lists Persian for both directions. Replaces the voice part of cycle 013.
