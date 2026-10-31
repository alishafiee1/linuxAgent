# Routines, skills and memory

## Rules

- **R1** A routine belongs to one bot and starts on a five-field cron (read in its own timezone, default Asia/Tehran) or on a secret webhook. Code: `apps/server/src/routines/`.
- **R2** Each firing is an ordinary run in a new conversation. A firing is skipped while the previous one is active. A firing missed while the server was down runs once.
- **R3** With notify on, the result goes to Bale and Telegram when the run ends.
- **R4** A webhook token is shown once and only its hash is stored. The body reaches the bot wrapped and marked as data, never as instructions.
- **R5** Skills are files at `/home/agent/shared/skills/<slug>/SKILL.md`; shared memory is `/home/agent/shared/MEMORY.md`. Bots and the panel edit the same files. The prompt lists skill names and includes shared memory. Code: `apps/server/src/knowledge.ts`.

## Tests

`apps/server/test/phases.test.ts`, run with `pnpm test`.

## Decisions

- Skills and memory are plain files, not database rows (default, not asked). Because bots already have file tools, and this keeps them readable and backed up with the home folder.

## Documentation Impact

`project/architecture.md`, `project/how-it-works.md`, `project/client-overview.md`, `deploy/README.md`, `MAP.md`.
