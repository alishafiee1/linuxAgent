# Live browser and vault

## Rules

- **R1** A bot with `browser` on gets the Playwright MCP tools and `open_browser`. Each bot has its own Chromium profile under `/home/agent/browser/<slug>`, running as `agent` and listening on localhost only. At most 2 run at once; idle ones close after 15 minutes. Code: `apps/server/src/browser/service.ts`.
- **R2** The panel shows the page by polling one screenshot at a time and sends click, scroll, text, key and navigate. No new socket or nginx change is needed.
- **R3** Looking at pages runs freely. A click or typed text asks first unless `browserClicksAuto` is on; running scripts and uploading files always ask. Rules: `approval/policy.ts`.
- **R4** Vault values are AES-256-GCM encrypted. No API returns one. The only way out is the person pressing fill in the live browser: there is no bot tool for it. Code: `apps/server/src/vault.ts`.
- **R5** A vault item bound to a site only goes into pages of that origin. A password only goes into a focused `input type=password`.

## Tests

`apps/server/test/phases.test.ts`, run with `pnpm test`.

## Decisions

- A bot on the same machine could still read a filled password through the DevTools port if it tried, because both run as `agent` (known limit, not asked). Because separating them needs a second Linux user per browser; for now keep important accounts on site-bound items and watch logins live.

## Documentation Impact

`project/architecture.md`, `project/how-it-works.md`, `project/client-overview.md`, `deploy/README.md`, `MAP.md`.
