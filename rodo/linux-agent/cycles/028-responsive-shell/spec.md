# 028 — طراحی تازهٔ ظاهر برای موبایل و لپ‌تاپ: technical spec

> Source of truth for the coder. Written in the technical language (`project.json`). Anything not here is not expected.
> Every rule has a bold ID (**R1**, **R2** ...). If the card has scenarios, tag each scenario with the rules it proves (`@R1`) and try to cover every rule.

## 1. Summary

One shell: laptop side column (pages and bots), phone bottom bar (4 pages and a more sheet). The approvals page is removed.

## 2. Rules

- **R1** From 781px wide the side column lists all 9 pages and the bots; the top strip only shows status.
- **R2** Up to 780px a bottom bar shows chat, routines, files, settings and «بیشتر»; the rest sit in the more sheet with language and sign-out.
- **R3** There is no approvals page. A waiting approval or question shows in the bot's chat and on its avatar.
- **R4** No horizontal scroll at 390px and 1400px.

## 3. Data

none

## 4. API / logic

none

## 5. Screens

Texts: «بیشتر», «بستن».

## 6. Files to create or change

- `App.tsx`, `pages.tsx`, `Chat.tsx`, `i18n.tsx`, `styles.css`, `apps/server/e2e/panel.e2e.ts`

## 7. Edge cases

- The warning pill opens the chat of the first bot that waits.

## 8. Acceptance run (if the card has scenarios)

Optional. `rodo test` (the card's `test.command`, or `testCommand` from `project.json` with `{NNN}` = `028`).

## Acceptance criteria

- **Must happen:** R1 to R4
- **Must not happen:** a question or approval becomes unreachable (R3)
- **Done when:** typecheck, lint, tests and screenshots at laptop and phone size

## Documentation Impact

- rodo/linux-agent/MAP.md — list cycle 028

## Open Questions

- none

## Decisions

- The four phone tabs are chat, routines, files and settings (default, not asked). Because the owner mostly chats and checks routines; the rest are used rarely.
