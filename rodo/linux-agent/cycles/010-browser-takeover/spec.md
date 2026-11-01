# تحویل مرورگر به کاربر

## Rules

- **R1** `request_browser_takeover` opens a card with the live browser in chat and on the approvals page, and waits.
- **R2** Bale and Telegram get the reason, a link, and a Done button.
- **R3** The person can click, scroll and type in the live view, and fill from the vault.
- **R4** The panel skill tells bots when to hand over and never to get past a CAPTCHA themselves.

## Acceptance criteria

The rules above, proved by `apps/server/test/interaction.test.ts` and `apps/server/e2e/panel.e2e.ts`.

## Documentation Impact

- rodo/linux-agent/project/architecture.md — new parts
- rodo/linux-agent/project/how-it-works.md — how they work
- rodo/linux-agent/project/client-overview.md — status

## Open Questions

- none

## Decisions

- none
