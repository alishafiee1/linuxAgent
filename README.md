# linuxAgent

A personal web panel for Claude agents that work on an always-on Linux container, so long tasks
keep running while your laptop is off. Bots run on the Claude Agent SDK; risky actions wait for
your approval in the panel, Bale or Telegram.

- Plan, decisions and specs: `rodo/linux-agent/` (RODO method, see `AGENTS.md`)
- Deploy: `deploy/README.md`
- Plain-language overview (Persian): `rodo/linux-agent/project/client-overview.md`
- How each part works, for beginners (Persian): `rodo/linux-agent/project/how-it-works.md`

## Develop

```bash
pnpm install
pnpm test && pnpm typecheck && pnpm lint
# server (needs CWP_MASTER_KEY etc., see apps/server/src/config.ts)
CWP_ENV_FILE=./dev.env pnpm dev:server
pnpm dev:web   # Vite on :5173, proxies /api to :8787
```
