# 001 — Core MVP: panel, bots, chat, background runs, approvals: technical spec

> Source of truth for the coder. Anything not here is not expected. Design rationale is in `design.md`.

## 1. Summary

A single-user web panel (Fastify + React) running inside one Incus container. The user creates bots, chats with them, and each message becomes a background run of the Claude Agent SDK that survives browser close and server restarts. Sensitive tool calls wait for human approval from the panel, Bale or Telegram. A usage page shows runs, tokens and subscription-limit state.

## 2. Rules

### Access
- **R1** Exactly one user. Login needs username, password (argon2id) and a 6-digit TOTP code. On success the server sets an `httpOnly`, `Secure`, `SameSite=Strict` session cookie valid for 7 days. After 5 failed logins in 15 minutes from any IP, login is refused for 15 minutes with the message `ورود موقتاً قفل شد؛ ۱۵ دقیقهٔ دیگر دوباره امتحان کنید.`
- **R2** The first user, with a password and TOTP secret, is created only by a CLI command run on the server (`pnpm cwp user:init`). The panel has no sign-up page.

### Bots
- **R3** A bot has: `name` (1–40 chars, unique), `slug` (auto, `a-z0-9-`), `persona` (free text, appended to the system prompt), `model` (default from settings), `allowedTools` (default: all built-in tools), `maxTurns` (default 50), `maxMinutes` (default 120). The working directory is `/home/agent/workspace` (shared). The bot's own notes live in `/home/agent/bots/<slug>/CLAUDE.md`.
- **R4** Deleting a bot needs confirmation in a dialog and removes its DB rows and its `bots/<slug>` folder. The shared workspace is never deleted.

### Runs
- **R5** Sending a chat message creates a `Run` in state `queued`. The orchestrator starts runs FIFO while running runs < `MAX_CONCURRENT_RUNS` (default 3). Run states: `queued → running → (waiting_approval ↔ running) → done | failed | cancelled`. They can also go `running → waiting_limit → queued`, and to `interrupted` on a server restart.
- **R6** Every SDK message is stored as an `Event` row with a monotonic `seq`, then pushed over SSE (`GET /api/runs/:id/stream?after=<seq>`). After reconnecting, the client resumes from its last `seq` without losing or duplicating events.
- **R7** Closing the browser or losing the connection never stops a run. Only the user's "Stop" button (`POST /api/runs/:id/cancel`) or the limits in R8 stop it.
- **R8** A run stops with `failed` and reason `max_turns` or `max_minutes` when it reaches the bot's limits. The final event shows `بات به سقف <نوبت|زمان> رسید.`
- **R9** Each conversation keeps the SDK `session_id` of its last run. The next message resumes that session. On server start, runs left in `running` or `waiting_approval` are marked `interrupted`. The panel offers "Continue", which sends `ادامه بده` with the same session.

### Approvals
- **R10** Each tool call goes through `canUseTool`. It is auto-allowed only when it is a read-only tool (`Read`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `TodoWrite`), or a file write/edit inside `/home/agent/`, or a `Bash` command not matched by the deny-list patterns in `apps/server/src/approval/patterns.ts`. Those patterns cover at least `rm -r`, `rm -f`, `git push`, `git reset --hard`, `curl … | sh`, `sudo`, `apt`, `npm publish`, `ssh`, `scp`, `systemctl`, writes outside `/home/agent/`, and any MCP tool not on the allow-list. Every other call creates an `Approval` and moves the run to `waiting_approval`.
- **R11** A pending approval shows in the panel with the bot name, tool name and full input. It is decided by the first answer from the panel, Bale or Telegram. After 24 hours without an answer it is denied, and the bot gets `کاربر این کار را تأیید نکرد.`
- **R12** Bale and Telegram are configured in Settings (token + allowed chat ID each, stored encrypted; a `آزمایش` button sends `پیام آزمایشی`). Each new approval sends a message to the configured Bale and Telegram chats with buttons `اجازه` / `رد`. Button presses are read by long polling (`getUpdates`), so no inbound webhook is needed. Callbacks are accepted only from the configured chat IDs. The message is edited to show the final decision and the channel it came from.

### Usage
- **R13** The usage page shows, per bot and per day: number of runs, input/output tokens, and the SDK's reported cost estimate (labelled `تخمین؛ با اشتراک پرداخت نمی‌شود`). When the SDK reports a subscription rate-limit, the run goes to `waiting_limit` and stores the reset time if one is given. A timer re-queues it after that time, or after 30 minutes if no time is known. The page shows `در انتظار باز شدن سقف اشتراک تا <ساعت>`.

### Data, files, ops
- **R14** SQLite at `/var/lib/cwp/cwp.db`, owned by `panel`, mode `0600`, WAL mode. Migrations run on start.
- **R15** A read-only file browser for `/home/agent/workspace` and `/home/agent/bots`, with download. Path traversal outside those roots returns 404.
- **R16** `/etc/cwp/env` (`0600 panel`) holds only the session secret and the master encryption key. Bale/Telegram tokens are stored encrypted in the DB (R12). The Claude subscription credential is stored by `claude setup-token` / login for user `agent` only. No secret appears in logs, events or API responses.
- **R17** `systemd` unit `cwp.service` runs as `panel`. Each SDK run executes as user `agent` (via a small setuid-free helper: `sudo -u agent` with a fixed sudoers rule for one binary). A daily `sqlite3 .backup` and a weekly Incus snapshot are kept (7 and 4 copies).

### Proxy (outbound internet of the hermes container)
- **R18** All internet traffic of the `hermes` container goes through sing-box (TUN) to a VLESS/VMess/Trojan/Shadowsocks proxy. A host-side Incus network ACL on hermes's NIC only allows egress to the proxy server and the local bridge, so if the proxy is down hermes has no internet (kill switch). Setup and rollback are in `deploy/proxy/README.md`.
- **R19** Settings has a Proxy section: paste one share link (`vless://`, `vmess://`, `trojan://`, `ss://`) or a subscription URL. For a subscription the server lists its links and the user picks one. On save, the server writes the sing-box config through a root helper (`/usr/local/sbin/cwp-proxy-apply`, the only sudoers rule for `panel` besides R17), and restarts sing-box. The container cannot change the host ACL: if the new proxy server IP or port is not allowed by the ACL, the save is refused with `این سرور پروکسی در kill switch میزبان مجاز نیست؛ اول روی میزبان deploy/proxy/allow-proxy.sh را اجرا کنید.` and the old config stays. The link is stored encrypted like other secrets and never returned in full by the API (only scheme, host and remark).
- **R20** The top bar shows the proxy state from sing-box's clash API every 15 s: `متصل` (green, with latency in ms), `قطع` (red) or `در حال اتصال`. When it is `قطع`, a banner says `اینترنت سرور قطع است؛ کارها تا وصل شدن پروکسی منتظر می‌مانند.` and new runs stay `queued`.

## 3. Data

| Table | Key fields |
|---|---|
| `users` | id, username, password_hash, totp_secret_enc, created_at |
| `sessions` | id, user_id, expires_at |
| `bots` | id, name, slug, persona, model, allowed_tools (json), max_turns, max_minutes, created_at |
| `conversations` | id, bot_id, title, engine_session_id, created_at, updated_at |
| `runs` | id, conversation_id, state, reason, started_at, ended_at, turns, input_tokens, output_tokens, cost_estimate_usd, limit_reset_at |
| `events` | id, run_id, seq, type, payload (json), created_at; unique (run_id, seq) |
| `approvals` | id, run_id, tool_name, input (json), state (pending/allowed/denied/expired), decided_by_channel, created_at, decided_at |
| `settings` | key, value |

## 4. API / logic

All under `/api`, JSON, session cookie required (except login).
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST /bots`, `GET/PATCH/DELETE /bots/:id`
- `GET /bots/:id/conversations`, `POST /bots/:id/conversations`
- `GET /conversations/:id` (messages + runs), `POST /conversations/:id/messages` → `{runId}`
- `GET /runs/:id`, `GET /runs/:id/stream?after=` (SSE), `POST /runs/:id/cancel`, `POST /runs/:id/continue`
- `GET /approvals?state=pending`, `POST /approvals/:id/decide {allow:boolean}`
- `GET /usage?from=&to=`
- `GET /proxy/status`, `PUT /proxy {link?|subscriptionUrl?}`, `GET /proxy/subscription/nodes`, `POST /proxy/select {index}`
- `GET /files?path=`, `GET /files/download?path=`
- `GET /status` (top bar), `GET /activity/stream` (SSE), `GET /settings`, `PUT /settings`, `POST /settings/notify/:channel/test`
- Every non-GET request must carry the header `x-cwp: 1` (CSRF guard on top of the SameSite cookie).

## 5. Screens

- **Login:** username, password, 6-digit code.
- **Main:** right sidebar (RTL) with the bot list and `+ بات جدید`; right-click on a bot → `ویرایش`, `حذف`. Center: conversation list and chat. Tool calls are collapsible cards. A pending approval is a highlighted card with `اجازه` / `رد`.
- **Top bar:** count of running/queued runs and pending approvals, plus a link to Usage and Files.
- **Usage:** a table per bot and day, plus the limit banner from R13.
- **Settings:** default model, `MAX_CONCURRENT_RUNS`, UI language (فارسی / English), Bale and Telegram token + chat ID with a test button (sends `پیام آزمایشی`).
- **Language:** every UI string comes from `apps/web/src/i18n/{fa,en}.ts`; `dir` switches between `rtl` and `ltr`.

## 6. Files to create or change

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- `apps/server/src/{index,config,db,auth,bots,conversations,orchestrator,engine,approval,notify,usage,files}/…`
- `apps/server/src/engine/engine.ts` — `Engine` interface; `claude-agent-sdk.ts` — first implementation
- `apps/web/src/…` — React app (RTL)
- `packages/shared/src/api.ts` — request/response types
- `deploy/provision-hermes.sh` (users, Node, app, sudoers, services inside `hermes`), `deploy/bin/cwp-agent-exec`, `deploy/bin/cwp-proxy-apply`, `deploy/proxy/allow-proxy.sh`, `deploy/nginx/agent.roditeam.ir.conf`, `deploy/systemd/{cwp.service,cwp-backup.service,cwp-backup.timer}`, `deploy/README.md`

## 7. Edge cases

- Server restart during a run → R9 `interrupted`; no duplicate tool execution on continue.
- Two answers to one approval (panel + Telegram) → only the first counts; the second gets `قبلاً تصمیم گرفته شده است.`
- SSE client far behind (> 10,000 events) → it loads the history page by page, then streams.
- Bot deleted while a run is active → the delete is refused with `این بات در حال کار است؛ اول اجرا را متوقف کنید.`
- Disk usage of `/home/agent` > 90% → the banner `فضای دیسک کم است` shows.

## 8. Acceptance run

No `acceptance.feature` in this cycle (manual end-to-end check is the last card step). Unit/integration: `pnpm test`.

## Acceptance criteria

- **Must happen:** a 2-hour run continues after the browser closes and is fully visible afterwards (R5–R7); a `git push` waits for approval and Telegram can approve it (R10–R12); a server restart marks runs `interrupted` and "Continue" resumes the session (R9); hitting the subscription limit pauses and auto-resumes (R13).
- **Must not happen:** any tool on the deny-list runs without approval; any secret in logs or API output; BaleBot or hermes services touched.
- **Done when:** `pnpm lint && pnpm typecheck && pnpm test` pass, and the manual scenario from `simple.md` passes on the server.

## Documentation Impact

- `rodo/linux-agent/project/architecture.md` — replace "planned" with what was built; confirm the web stack.
- `rodo/linux-agent/project/glossary.md` — add any new terms.
- `deploy/README.md` — new.

## Open Questions

- Can the `hermes` container reach `api.anthropic.com`, `claude.ai` (subscription login) and `api.telegram.org` directly? BaleBot reaches its model (Z.ai) through a proxy. — default: none; this blocks deployment until checked with `curl -I` from inside `hermes`.

## Decisions

- One Incus container holds panel and agents, with two Linux users (`panel`, `agent`). Because resources are limited and a shared "cloud computer" is wanted; user separation keeps panel secrets and DB out of the agents' reach.
- Approvals are enforced in `canUseTool`, not in the prompt. Because prompt injection can override instructions but not code.
- SQLite instead of Postgres (default, not asked). Because there is a single user and a single server, and backups are a file copy.
- SSE instead of WebSocket for streaming (default, not asked). Because traffic is one-way and SSE reconnects with `Last-Event-ID` natively.
- Authentication with the personal Claude subscription (asked; answered by Masoud). Because only Masoud uses it.
- Runs inside the existing Incus container `hermes` (asked; answered by Masoud), as new Linux users `panel` and `agent`; `hermes-gateway.service` is not touched. Because Masoud wants one shared computer.
- Container resource limits stay as they are for `hermes` (asked; Masoud agreed with the proposal); `MAX_CONCURRENT_RUNS` = 3. Because subscription hourly limits are not expected to be hit soon (Masoud).
- Panel is served at `https://agent.roditeam.ir` through the existing nginx (`rodo-proxy-1`) with a Let's Encrypt certificate, and login always needs TOTP. Because Masoud chose a subdomain.
- Bale and Telegram bot tokens and chat IDs are entered in the panel Settings page, not in env files (asked; answered by Masoud). Stored encrypted (AES-256-GCM) in `settings` with a master key from `/etc/cwp/env`.
- The UI supports Persian (RTL) and English (LTR), switchable in Settings (asked; answered by Masoud).
- Docs follow RODO language settings: simple docs in Persian, technical docs in English (asked; answered by Masoud).
- Repository: `linuxAgent` (`github.com/alishafiee1/linuxAgent`) (asked; answered by Masoud).
- Stack: pnpm 10 workspaces, Fastify, React + Vite, vitest (Masoud left it to the planner). Because they are light, match rodo-spec tooling, and build to static files.
- Bale/Telegram button presses are read by long polling instead of webhooks (default, not asked). Because the panel then needs no public webhook path and works the same for both bots.
- The SDK runs with `settingSources: []` and without its `allowedTools` option; the bot's tool allow-list is enforced in `canUseTool` (default, not asked). Because settings files written by a bot, or SDK allow-lists, would skip the approval gate. The bot's notes file is put into the system prompt instead.
- Claude Code is spawned as user `agent` through `sudo -n -u agent /usr/local/bin/cwp-agent-exec env …`, passing only `CLAUDE*`, `PATH`, locale and `NODE_*` variables (default, not asked). Because panel secrets must never reach the agent process.
- The panel listens on `127.0.0.1:8787` inside hermes and is published to nginx with an Incus proxy device on `172.18.0.1:8788` (default, not asked). Because hermes's kill-switch ACL and Hermes Agent stay untouched.
