# دیدن پیشرفت، توقف و ادامه در پیام‌رسان

Shared design: `cycles/015-messenger-chat/design.md`.

## Rules

- **R1** One status message per run, edited at most every few seconds, in plain words from tool events ("خواندن فایل", "جست‌وجو در وب"). Buttons: Stop, and later Details.
- **R2** It ends as Done, Failed with its reason, Waiting for the limit with the time, or Interrupted with Continue.
- **R3** Edits respect rate limits: a failed edit is dropped, never queued without limit.
- **R4** `/status` shows running work, what waits for the person, and the limit warning.
- **R5** Approval and question messages sent while a person is in the same chat appear in order, and a message sent during a run is queued with a clear note.
- **R6** "Other" on a question times out with a note instead of silently taking a later message as the answer.

## Acceptance criteria

- Edits stay under the limit in a fast run; Stop ends the run; Continue resumes it; a message during a run is queued.

## Documentation Impact

- rodo/linux-agent/project/how-it-works.md — how the messenger works
- rodo/linux-agent/project/client-overview.md — status
- rodo/linux-agent/project/architecture.md — the channel layer
- deploy/README.md — any new package or setting

## Open Questions

- none that block work; see `design.md` for choices a person may want to change

## Decisions

- A message sent during a run waits for it to end (default, not asked). Because the engine runs one turn at a time in a conversation.
