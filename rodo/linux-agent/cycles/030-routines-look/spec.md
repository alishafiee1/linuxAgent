# 030 — ظاهر تازهٔ صفحهٔ روتین‌ها: technical spec

> Source of truth for the coder. Written in the technical language (`project.json`). Anything not here is not expected.
> Every rule has a bold ID (**R1**, **R2** ...). If the card has scenarios, tag each scenario with the rules it proves (`@R1`) and try to cover every rule.

## 1. Summary

Routines page restyled to the design file: header, stats strip, tips on timeline dots, creator icons, neutral grey theme with a dark twin.

## 2. Rules

- **R1** A strip shows total, active, paused and the next run.
- **R2** Each timeline dot shows routine name and time on hover or focus.
- **R3** A routine made by the owner shows a user icon, one made by a bot shows a sparkle icon.
- **R4** Rows collapse to cards at 1150px wide or less so nothing overflows.

## 3. Data

none

## 4. API / logic

none

## 5. Screens

Texts: «کل», «فعال», «متوقف».

## 6. Files to create or change

- `routines.tsx`, `icons.tsx`, `i18n.tsx`, `styles.css`

## 7. Edge cases

- No routines: the strip is hidden and the empty message shows.

## 8. Acceptance run (if the card has scenarios)

Optional. `rodo test` (the card's `test.command`, or `testCommand` from `project.json` with `{NNN}` = `030`).

## Acceptance criteria

- **Must happen:** R1 to R4
- **Must not happen:** creating, editing, running or deleting a routine stops working
- **Done when:** typecheck, lint and screenshots

## Documentation Impact

- rodo/linux-agent/MAP.md — list the cycle

## Open Questions

- none

## Decisions

- The page keeps its own grey colours instead of the panel's soft blue (the owner asked for the look of the file). Because the file was chosen as the reference.
