# پیام بین بات‌ها و یادگیری از گفت‌وگوها

## Rules

- **R1** `send_message_to_bot` does not wait and keeps one conversation per pair. Limits: depth 6 and 10 per top-level job.
- **R2** Every bot is told to add a line to shared memory when the user states a preference.
- **R3** At 03:00 Tehran time, if on, a digest of user messages and final answers goes to `/home/agent/shared/digests/`, and the `یادگیری` bot updates memory and skills. Code: `apps/server/src/learning.ts`.
- **R4** That bot has only file tools and is told the digest is data, so a planted sentence cannot make it run anything. It still may write a bad line; memory stays visible and editable in the panel.
- **R5** A setting turns it off. A day with nothing to read starts no run.

## Acceptance criteria

The rules above, proved by `apps/server/test/interaction.test.ts` and `apps/server/e2e/panel.e2e.ts`.

## Documentation Impact

- rodo/linux-agent/project/architecture.md — new parts
- rodo/linux-agent/project/how-it-works.md — how they work
- rodo/linux-agent/project/client-overview.md — status

## Open Questions

- none

## Decisions

- Learning is on by default with a small model (default, not asked). Because the user asked for it and it uses little of the plan. It can be turned off in Settings.
