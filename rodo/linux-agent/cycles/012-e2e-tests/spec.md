# آزمون‌های سراسری

## Rules

- **R1** `pnpm e2e` runs `apps/server/e2e/panel.e2e.ts`: real server, web app and Chromium with a scripted engine.
- **R2** It needs a built web app and Chromium. It runs on hermes, because the local computer has Node 24.

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
