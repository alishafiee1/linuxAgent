# 025 — نصب‌شدنی روی گوشی و اعلان فوری تأیید: technical spec

> Source of truth for the coder. Written in the technical language (`project.json`). Anything not here is not expected.
> Every rule has a bold ID (**R1**, **R2** ...). If the card has scenarios, tag each scenario with the rules it proves (`@R1`) and try to cover every rule.

## 1. Summary

Installable PWA (manifest, icons, service worker) plus Web Push (VAPID) for new approvals and user requests.

## 2. Rules

- **R1** `/manifest.webmanifest`, `/sw.js` and icons are served without login; dir rtl, lang fa, display standalone.
- **R2** VAPID keys are generated on first use and stored in settings (`push.vapidPrivate.secret` encrypted).
- **R3** Push endpoints need a logged-in user; a subscription is stored once per endpoint.
- **R4** A new approval or user request sends one push to every subscription; endpoints answering 404/410 are deleted.
- **R5** A push failure never blocks Bale/Telegram or the approval.

## 3. Data

Table `push_subscriptions(endpoint PK, p256dh, auth, user_agent, created_at)`.

## 4. API / logic

`GET /api/push/key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`.

## 5. Screens

Settings: toggle «اعلان روی این دستگاه». Push title «بات X اجازه می‌خواهد».

## 6. Files to create or change

- `apps/server/src/push.ts`, `db.ts`, `app.ts`, `index.ts`, `notify/notifier.ts`
- `apps/web/public/*`, `apps/web/index.html`, `apps/web/src/*`

## 7. Edge cases

- iOS needs the app installed to the home screen before push works.
- Unsupported browser: toggle hidden.

## 8. Acceptance run (if the card has scenarios)

Optional. `rodo test` (the card's `test.command`, or `testCommand` from `project.json` with `{NNN}` = `025`).

## Acceptance criteria

- **Must happen:** install prompt appears; push arrives (R4)
- **Must not happen:** approvals on Bale/Telegram stop working (R5)
- **Done when:** typecheck and tests pass; a test push reaches a phone

## Documentation Impact

- rodo/linux-agent/MAP.md — list cycle 025

## Open Questions

- none

## Decisions

- Library `web-push` is used instead of hand-written encryption. Because it is the standard, well-tested way.
