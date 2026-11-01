# Desktop bridge

## Rules

- **R1** `deploy/desktop-bridge/bridge.mjs` runs on the person's computer, needs only Node, and connects out by long polling. Nothing on the computer is exposed.
- **R2** The folder list given on the bridge's command line is the authority: paths are resolved through links and refused if outside it.
- **R3** All `desktop_*` actions ask first, including list and read. The device token is shown once and only its hash is stored.
- **Not built:** the Antigravity CLI engine and voice replies. See Progress notes on the card.

## Tests

`apps/server/test/phases.test.ts`, run with `pnpm test`.

## Decisions

- Antigravity CLI and voice replies are left unbuilt (default, not asked). Because the first needs that product installed and signed in to learn its real interface, and the second needs a choice of speech service.

## Documentation Impact

`project/architecture.md`, `project/how-it-works.md`, `project/client-overview.md`, `deploy/README.md`, `MAP.md`.
