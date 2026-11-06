# 027 — فهرست مدل از Claude Code و تلاش هر مدل: technical spec

> Source of truth for the coder. Written in the technical language (`project.json`). Anything not here is not expected.
> Every rule has a bold ID (**R1**, **R2** ...). If the card has scenarios, tag each scenario with the rules it proves (`@R1`) and try to cover every rule.

## 1. Summary

ModelCatalogService reads engine.listModels() on demand and stores it in settings `models.catalog`.

## 2. Rules

- **R1** Before any refresh the built-in list (Opus, Sonnet, Haiku) is served.
- **R2** `POST /api/models/refresh` stores the engine list; the default row is dropped and Sonnet is kept.
- **R3** Each model carries its own effort levels; none means the effort chip is hidden.
- **R4** A failed refresh keeps the saved list and says «گرفتن فهرست مدل‌ها ناموفق بود».

## 3. Data

settings key `models.catalog` (JSON); shared types ModelOption, ModelCatalog; effort level `xhigh` added.

## 4. API / logic

`GET /api/models`, `POST /api/models/refresh`.

## 5. Screens

Model menu: refresh button and last update date.

## 6. Files to create or change

- `models.ts`, `engine/claude.ts`, `engine/types.ts`, `app.ts`, `index.ts`, `modelChips.tsx`, `i18n.tsx`, `packages/shared/src/index.ts`

## 7. Edge cases

- Picking a model that lacks the bot's effort clears the effort.

## 8. Acceptance run (if the card has scenarios)

Optional. `rodo test` (the card's `test.command`, or `testCommand` from `project.json` with `{NNN}` = `027`).

## Acceptance criteria

- **Must happen:** R1 to R4
- **Must not happen:** a failed refresh empties the list (R4)
- **Done when:** models.test passes

## Documentation Impact

- rodo/linux-agent/MAP.md — list cycle 027

## Open Questions

- none

## Decisions

- The list is refreshed only by the button, not on a timer. Because each refresh starts a Claude Code process.
