# Files in chat and locked core skills

## Rules

- **R1** Files up to 50 MB go up in 1 MB pieces, below the nginx 2 MB body limit, so no server setting changes. A repeated piece is accepted once. Code: `apps/server/src/uploads.ts`.
- **R2** The composer takes paste, drag and a picker. Each file shows progress, cancel, delete and retry. Sending waits for uploads.
- **R3** A finished file lands in `uploads/<id>/` in the workspace. The message lists full paths for the bot, marked as data. Names are cleaned so they cannot become a path.
- **R4** `send_file` gives a file from the workspace or a bot folder; links outside are refused. It needs no approval, because the file only goes to the person.
- **R5** Only images, audio and video open inline, with `nosniff`. Everything else downloads, because HTML or SVG from a bot could run on the panel's address.
- **R6** Core skills are read from `deploy/skills` in the installed app, owned by root. The API refuses to change or delete them, and a shared folder with the same name is ignored.

## Acceptance criteria

The rules above, proved by `apps/server/test/interaction.test.ts` and `apps/server/e2e/panel.e2e.ts`.

## Documentation Impact

- rodo/linux-agent/project/architecture.md — uploads
- rodo/linux-agent/project/how-it-works.md — files in chat
- rodo/linux-agent/project/client-overview.md — status

## Open Questions

- none

## Decisions

- Sending files to Bale and Telegram is left out (default, not asked). Because the request was for the chat, and it needs multipart upload.
