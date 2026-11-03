# 024 — ترمیم خودکار پروکسی با ساب و اتصال‌های بعدی: technical spec

## 1. Summary

Add subscription sync to the saved connections, run it before failover and on a timer while healthy, and ship an opt-in host script that follows a changed proxy domain address.

## 2. Rules

- **R1** `syncSubscription()` fetches the subscription, parses every link, and adds links that are not saved yet with `source: "subscription"`. A saved link with that source that is no longer in the subscription is removed unless it is the active one. Links without a source (added by hand) are never removed. The list stays within 20; extra subscription links are skipped.
- **R2** Without a subscription URL the sync is a 400 `no_subscription`. A fetch that fails is 502 `subscription_fetch`. In both cases nothing in the list changes.
- **R3** The result is kept in `ProxyStatus.subscriptionSync` as `{lastAt, lastResult}`. `lastResult` is `ok:<added>:<removed>` or `failed`.
- **R4** While connected, with the automatic switch on and a subscription set, the panel syncs when the last sync is older than 6 hours (and on the first check).
- **R5** Failover (spec 023 R8) first tries a sync (errors are ignored), then goes through the saved links. The sync does not change the cooldown.
- **R6** `POST /api/proxy/subscription/sync` runs the sync and returns the connection list.
- **R7** `ProxyConnection.fromSubscription` tells the page where a link came from.
- **R8** `deploy/proxy/move-proxy-ip.sh` moves the hermes proxy from an old IP to a new one (kill switch rule, config swap, restart, rollback on failure). `deploy/proxy/proxy-heal.sh`, run from the host user's crontab, calls it when the configured domain now resolves to another IP that answers while the old one does not. No crontab line is installed by anything in the repo.
- **R9** The settings page has a "بروزرسانی از ساب" button and shows the last sync and last heal result.

## 3. Data

No migration. `SavedLink.source` is optional inside the encrypted setting.

## 4. API / logic

`ProxyStatus.subscriptionSync: {lastAt: string | null; lastResult: string | null}`.

## 5. Screens

Settings, proxy card: sync button in the subscription block with the result line, a "از ساب" tag on rows that came from it.

## 6. Files to create or change

- `apps/server/src/proxy/service.ts`, `app.ts`, `packages/shared/src/index.ts`
- `apps/web/src/proxyPanel.tsx`, `i18n.tsx`, `styles.css`
- `apps/server/test/proxy-connections.test.ts`
- `deploy/proxy/move-proxy-ip.sh`, `proxy-heal.sh`, `README.md`

## 7. Edge cases

- While the proxy is down the kill switch blocks the subscription server, so the sync fails and failover goes on with what is saved.
- A subscription that returns an error page has no links: that is `failed`, and nothing is removed.
- The heal script only acts when the old IP does not answer, the new one does, and the port is the same.

## 8. Acceptance run

Server unit tests, typecheck, lint, `sh -n` on the scripts, a look at the page.

## Acceptance criteria

- **Must happen:** sync adds and prunes right (R1). A failed sync changes nothing (R2). Failover syncs first and can then use a new link (R5). The periodic sync runs only when due (R4).
- **Must not happen:** a hand-added link or the active link is removed by a sync. The host script runs by itself after install.
- **Done when:** tests, typecheck and lint pass and the scripts pass `sh -n`.

## Documentation Impact

- `rodo/linux-agent/project/how-it-works.md` — extend the proxy section.
- `deploy/proxy/README.md` — the host scripts and how to turn them on.
- `rodo/linux-agent/MAP.md`, `MEMORY.md` — close the cycle.

## Open Questions

- none

## Decisions

- The host script is opt-in and never installed by the provision script (default, not asked). Because it widens the kill switch by itself, and a changed DNS record could point it at someone else's server.
- The sync runs every 6 hours while healthy (default, not asked). Because the subscription cannot be fetched during an outage.
- A removed subscription link is dropped only if it came from the subscription (default, not asked). Because links added by hand are the user's own.
