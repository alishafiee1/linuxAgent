# 026 — تحقیق عمیق در چت: technical spec

> Source of truth for the coder. Written in the technical language (`project.json`). Anything not here is not expected.
> Every rule has a bold ID (**R1**, **R2** ...). If the card has scenarios, tag each scenario with the rules it proves (`@R1`) and try to cover every rule.

## 1. Summary

Message option `research`: the server appends RESEARCH_PROMPT to the run prompt.

## 2. Rules

- **R1** With `research: true` the bot prompt gets RESEARCH_PROMPT.
- **R2** The stored user event keeps only the typed text plus `research: true`.
- **R3** Without the option nothing changes.

## 3. Data

none (flag lives in the user event payload)

## 4. API / logic

`POST /api/conversations/:id/messages` accepts optional `research` boolean.

## 5. Screens

Button «تحقیق عمیق» in the composer; tag on the sent message.

## 6. Files to create or change

- `orchestrator.ts`, `app.ts`, `Chat.tsx`, `i18n.tsx`, `styles.css`

## 7. Edge cases

- Bot with a limited tool list may lack WebSearch; then it says so.

## 8. Acceptance run (if the card has scenarios)

Optional. `rodo test` (the card's `test.command`, or `testCommand` from `project.json` with `{NNN}` = `026`).

## Acceptance criteria

- **Must happen:** R1, R2
- **Must not happen:** normal messages change (R3)
- **Done when:** research.test passes

## Documentation Impact

- rodo/linux-agent/MAP.md — list cycle 026

## Open Questions

- none

## Decisions

- The research steps are added on the server, not typed into the chat. Because the user sees only their own question.
