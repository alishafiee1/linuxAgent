# 023 — مدیریت چند اتصال پروکسی: technical spec

## 1. Summary

Keep a list of saved proxy links (encrypted), show them in the settings page, activate one at a time through the existing root helper, explain why the proxy is down, and optionally fail over to the next saved link.

## 2. Rules

- **R1** Saved links live in the setting `proxy.links.secret` (encrypted JSON array of `{id, name, link, addedAt}`), at most 20. The active link `proxy.link.secret` stays as it is.
- **R2** The first read of the list imports the active link if it is missing. A link applied from the old form is saved to the list too.
- **R3** Adding validates the link with `parseLink`. A bad link is 400 `bad_link`. The same link twice is 409 `duplicate` ("این لینک قبلاً ذخیره شده است."). More than 20 is 409 `too_many`.
- **R4** Removing the active connection is 409 `active` ("اتصال فعال را نمی‌شود حذف کرد؛ اول یکی دیگر را فعال کنید."). Unknown id is 404 `no_connection`.
- **R5** Activating calls `applyLink` with the saved link. `applyLink` errors (not allowed by the kill switch, apply failed) pass through unchanged.
- **R6** The list response never has the full link: id, name, scheme, host, port, remark, active, addedAt, and `ip` (resolved, or null).
- **R7** `ProxyStatus.reason` is `server_unreachable` when sing-box answers but the delay probe fails, `engine_down` when sing-box does not answer, else null.
- **R8** Failover is off by default (`proxy.failover` setting). When on, and the state turns `disconnected`, and the last failover was more than 10 minutes ago, the panel tries every other saved link in order: apply, wait 8 s, probe. It stops at the first one that connects. A link that is not allowed by the kill switch is skipped. The result is kept in `ProxyStatus.failover.lastResult`.
- **R9** The settings page shows the status with the reason in plain words, the list with the actions, an add form (link and optional name), the failover switch, and the old subscription part unchanged. A 409 `not_allowed` error shows the host command with the real IP and port.

## 3. Data

No migration. Settings keys: `proxy.links.secret`, `proxy.failover`.

## 4. API / logic

- `GET /api/proxy/connections` → list.
- `POST /api/proxy/connections` `{link, name?}` → the list.
- `PATCH /api/proxy/connections/:id` `{name}` → the list.
- `DELETE /api/proxy/connections/:id` → the list.
- `POST /api/proxy/connections/:id/activate` → `ProxyStatus`.
- `PUT /api/proxy/failover` `{enabled}` → `ProxyStatus`.
- `ProxyStatus` gains `reason`, `connectionCount`, `failover: {enabled, lastAt, lastResult}`.

## 5. Screens

Settings, proxy card: status line with reason, connection rows (name, `scheme://host:port`, active badge, buttons), add form, failover switch, subscription block.

## 6. Files to create or change

- `apps/server/src/proxy/service.ts`, `apps/server/src/app.ts` — logic and routes.
- `packages/shared/src/index.ts` — types.
- `apps/web/src/pages.tsx`, new `apps/web/src/proxyPanel.tsx`, `i18n.tsx`, `styles.css`.
- `apps/server/test/proxy-connections.test.ts` — tests.

## 7. Edge cases

- The saved list has the active link twice under different names: R3 compares the raw trimmed link, so it is one entry.
- Failover must not run while a manual apply is in progress.
- The kill switch only allows servers the host allowed: the panel cannot test an unallowed link, so it cannot tell if it works.

## 8. Acceptance run

Server unit tests, typecheck, lint, a look at the page in a browser.

## Acceptance criteria

- **Must happen:** add, rename, remove and activate work (R1 to R5). The list never shows a full link (R6). The reason is right (R7). Failover moves to a working link and skips a blocked one (R8).
- **Must not happen:** the active link is deleted. A full link or key leaves the server. Failover runs when it is off.
- **Done when:** tests, typecheck and lint pass and the page looks right on desktop and phone width.

## Documentation Impact

- `rodo/linux-agent/project/how-it-works.md` — new section for proxy connections.
- `deploy/proxy/README.md` — not changed (deploy is out of scope).
- `rodo/linux-agent/MAP.md`, `MEMORY.md` — close the cycle.

## Open Questions

- none

## Decisions

- Failover is off by default (default, not asked). Because a restart of the proxy interrupts running bots, and the user should choose it.
- Adding a link does not apply it (default, not asked). Because the kill switch may not allow the server yet.
- The panel does not try to change the host kill switch (default, not asked). Because it lives outside the container and is a security boundary.
