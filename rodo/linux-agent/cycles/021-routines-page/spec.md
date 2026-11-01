# Routines page

## Rules

- **R1** The page has a summary, a 24-hour timeline, filters by maker, and a list with schedule in words, next run, last run and on/off. Design taken from the user's prototype and rebuilt with the panel's own tokens, so dark mode and RTL work.
- **R2** The last run shows its state, age and tokens, and opens its conversation. No usage limit is applied, by the user's decision.
- **R3** The form offers hourly, daily, weekly, monthly, custom and webhook. `POST /api/routines/preview` judges the schedule with the same parser that saves it.
- **R4** A schedule that cannot be said simply is shown as written, never guessed.
- **R5** `create_routine` needs approval and records the bot as maker. An edit keeps the maker. Bots cannot make webhook routines, because the token would reach them. `list_routines` runs freely.
- **R6** `deliver` picks channels per routine. Migration 4 keeps old "notify off" routines silent.
- **R7** The timeline merges close runs into one mark and shows at most 300 runs per routine.

## Acceptance criteria

Proved by `apps/server/test/interaction.test.ts` and `apps/server/e2e/panel.e2e.ts`.

## Documentation Impact

- deploy/skills/create-routines/SKILL.md — new
- deploy/skills/panel-guide/SKILL.md — the tool

## Open Questions

- none

## Decisions

- Bot-made routines ask for approval (default, agreed in review). Because they create work that later runs alone.
