# Bot collaboration

## Rules

- **R1** `delegate_to_bot` starts a run of another bot in a new conversation and returns its final answer. Code: `Orchestrator.delegate`.
- **R2** Limits: depth 3, 10 delegated runs per top-level run, and never to a bot already in the chain.
- **R3** A parent waiting on a child gives up its slot, so the concurrency limit cannot deadlock them. Stopping the parent stops the child.

## Tests

`apps/server/test/phases.test.ts`, run with `pnpm test`.

## Decisions

- Delegation waits for the answer (default, not asked). Because the caller usually needs the result to finish its own task.

## Documentation Impact

`project/architecture.md`, `project/how-it-works.md`, `project/client-overview.md`, `deploy/README.md`, `MAP.md`.
