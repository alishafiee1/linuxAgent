# 001 — Core MVP: design

> MAJOR change: new project, new infrastructure, security and money-adjacent (subscription usage). Read together with `spec.md`.

## Problem

Long agent tasks with Claude currently need Masoud's laptop to stay on. He wants a personal, always-on Linux machine where several bots work, controlled from a web panel, with human approval for risky actions.

## Proposed approach

```
Browser / phone ──HTTPS agent.roditeam.ir (nginx rodo-proxy-1)──► hermes container: cwp.service (user: panel)
                                         ├─ Fastify API + static React app
                                         ├─ Orchestrator (queue, limits, timers)
                                         ├─ Approval service ◄──► Bale / Telegram webhooks
                                         ├─ SQLite /var/lib/cwp/cwp.db
                                         └─ Engine: Claude Agent SDK ──runs as user agent──►
                                                /home/agent/workspace (shared computer)
                                                /home/agent/bots/<slug>/CLAUDE.md
```

- **Engine boundary.** `Engine.start({prompt, sessionId, cwd, systemPromptAppend, allowedTools, maxTurns, canUseTool, abortSignal}) → AsyncIterable<EngineEvent>`. The first implementation wraps `query()` from `@anthropic-ai/claude-agent-sdk`. A future Antigravity CLI adapter implements the same interface over a PTY.
- **Run as `agent`.** The SDK spawns the Claude Code process. The orchestrator starts it through a tiny wrapper (`/usr/local/bin/cwp-agent-exec`) allowed by one sudoers line, so the child runs with `agent`'s HOME (where the subscription credential lives) and cannot read `/etc/cwp` or the DB.
- **Durability.** Events are written before they are broadcast. The SSE endpoint replays from the DB by `seq`. Runs do not depend on any HTTP connection.
- **Restart.** On boot: `running`/`waiting_approval` → `interrupted`. "Continue" starts a new run on the same `engine_session_id`. We do not try to re-attach to a dead child process.
- **Limits.** Turn cap via SDK `maxTurns`; wall-clock via `AbortController` + timer; concurrency via an in-process semaphore; rate-limit errors from the SDK map to `waiting_limit` with a re-queue timer.
- **Approvals.** `canUseTool` checks the static policy (spec R10). If approval is needed, it creates an `Approval`, notifies the panel (SSE), Bale and Telegram, and awaits a promise resolved by the first decision or by the 24 h expiry.

## Architecture impact

New repository `linuxAgent`. Inside the existing `hermes` container: two new Linux users and one systemd unit; `hermes-gateway.service` is untouched. On the host: one nginx server block and certificate for `agent.roditeam.ir`.

## Components affected

All new: `apps/server`, `apps/web`, `packages/shared`, `deploy/`.

## Data / API impact

New SQLite schema (spec §3) and REST/SSE API (spec §4). No migration of existing data.

## Trade-offs

- **Shared computer vs per-bot sandbox:** shared means installed apps and logins are reused, which is what Masoud asked for; but one compromised bot affects all. Mitigation: approvals, non-root user, snapshots.
- **Subscription vs API key:** no per-token cost and Masoud's choice; but usage windows can pause long tasks (handled by `waiting_limit`), and concurrency must stay low.
- **SDK in-process vs separate worker service:** in-process is simpler; a crash of `cwp.service` interrupts runs (handled by R9).

## Risks

- **Prompt injection** from files/web content leading to harmful tool use → deny-list + approval in code; approvals show full tool input.
- **Network reachability** of Anthropic/Telegram from the server is unverified (spec Open Questions). If blocked, deployment needs an egress route; this is not designed here.
- **Subscription terms** for automated use on a server should be checked by Masoud on Anthropic's current terms; the design does not depend on anything beyond the official Claude Code login.
- **Resource pressure** (8 vCPU / 15 GiB shared with BaleBot, RODO and Hermes Agent) → `MAX_CONCURRENT_RUNS` = 3.
- **Sharing `hermes` with Hermes Agent:** a bot could break Hermes files or services → the `agent` user has no write access outside `/home/agent`, and `systemctl` is on the approval list.
- **Public subdomain:** the panel is reachable from the internet → mandatory TOTP, login lockout, `Secure` cookies, no sign-up.

## Alternatives considered

- **Wrap the Claude Code CLI in a PTY** instead of the SDK: rejected for v1; the SDK gives structured events and `canUseTool`. Kept as the pattern for other CLIs later.
- **Extend BaleBot (Python):** rejected; different goals (multi-user product vs personal tool) and different language.
- **Reuse the Hermes Agent:** rejected for v1; Claude is the required engine.

## Decisions

- Engine behind a replaceable interface; Claude Agent SDK first. Because Antigravity CLI and others come later. (also in MEMORY.md)
- Panel and agents in one container with two Linux users. Because of limited resources and the shared-computer goal. (also in MEMORY.md)
- Approval enforced in code via `canUseTool`. Because prompts can be overridden by injected content. (also in MEMORY.md)
