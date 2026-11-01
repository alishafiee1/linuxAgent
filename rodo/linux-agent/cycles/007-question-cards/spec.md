# کارت پرسش چندگزینه‌ای

## Rules

- **R1** `ask_user` takes 1 to 6 questions with up to 8 options each; `multiSelect` allowed; free text is always offered. Code: `apps/server/src/requests.ts`.
- **R2** Claude's own `AskUserQuestion` is intercepted in the tool gate and becomes the same card, never an approval with raw JSON.
- **R3** The panel shows the card in chat and on the approvals page. A question left unanswered is refused with its text.
- **R4** Bale and Telegram get one message per question with buttons; multi-select toggles and confirms; "other" takes the next text from the configured chat only. The first answer from any channel wins; other channels are edited to show the result.
- **R5** Pending requests expire after 24 hours, are cancelled when the run stops, and are cleared on restart.

## Acceptance criteria

The rules above, proved by `apps/server/test/interaction.test.ts` and `apps/server/e2e/panel.e2e.ts`.

## Documentation Impact

- rodo/linux-agent/project/architecture.md — new parts
- rodo/linux-agent/project/how-it-works.md — how they work
- rodo/linux-agent/project/client-overview.md — status

## Open Questions

- none

## Decisions

- Reuse `waiting_approval` as the run state (default, not asked). Because it already means "waiting for you" everywhere in the panel.
