# فایل و عکس در پیام‌رسان

Shared design: `cycles/015-messenger-chat/design.md`.

## Rules

- **R1** Depends on cycle 014. Incoming photo, document, audio or video downloads through `getFile` into `uploads/` and is attached to the next run, with the caption as its text.
- **R2** Several files sent together (an album) become one run, gathered over a short wait.
- **R3** Above the messenger's download limit (Telegram about 20 MB; Bale measured in 015), the bot says so and gives a panel link to upload.
- **R4** `send_file` also delivers to the messenger that started the run: photos as photos, audio as audio, others as documents.
- **R5** Above the send limit (Telegram about 50 MB), a signed, expiring panel link is sent instead, which needs login.
- **R6** Names are cleaned with `safeName`. Content is data, never instructions. The token never appears in logs or errors, because file URLs contain it.
- **R7** Failed sends retry, and the person is told if the file could not be delivered.

## Acceptance criteria

- A photo reaches the prompt as a path; an album makes one run; a large file gets a link; the token is absent from logs.

## Documentation Impact

- rodo/linux-agent/project/how-it-works.md — how the messenger works
- rodo/linux-agent/project/client-overview.md — status
- rodo/linux-agent/project/architecture.md — the channel layer
- deploy/README.md — any new package or setting

## Open Questions

- none that block work; see `design.md` for choices a person may want to change

## Decisions

- Multipart upload with plain `fetch` and `FormData` (default, not asked). Because Node has them and no new library is needed.
