# Connectors and shareable pages

## Rules

- **R1** `publish_page` asks first, then serves one HTML file at `/p/<secret>`. `update_page` changes content behind the same link without asking and never reopens a revoked page. Code: `apps/server/src/pages.ts`.
- **R2** Pages are served with a CSP that has no script and a sandbox, so a page cannot run code or reach the panel.
- **R3** GitHub uses a personal token. Gmail and Calendar use the person's own Google OAuth client, with a one-time state on the callback. All are encrypted settings. Code: `apps/server/src/connectors.ts`.
- **R4** Reading is free. `gmail_send`, `calendar_create`, `github_create_issue` and `github_comment` go through the approval gate, whose card shows the exact draft. Mail headers cannot be injected.

## Tests

`apps/server/test/phases.test.ts`, run with `pnpm test`.

## Decisions

- The approval card is the draft review (default, not asked). Because it already reaches the panel, Bale and Telegram, and no extra outbox is needed. X stays out of scope.

## Documentation Impact

`project/architecture.md`, `project/how-it-works.md`, `project/client-overview.md`, `deploy/README.md`, `MAP.md`.
