# صفحهٔ اتصال به پلتفرم‌ها و کارت دریافت کلید

## Rules

- **R1** A catalog of known services, plus custom ones. Each has fields, steps, a help link, and a test call. Code: `apps/server/src/platforms.ts`.
- **R2** Secrets live encrypted in settings and no API returns them.
- **R3** `call_api` adds the key server side. The address is fixed by the connection, redirects are refused, custom services must be https, and a key echoed in a response is hidden.
- **R4** GET runs freely; any other method goes through the approval gate with the exact call shown.
- **R5** `request_connection` opens the card in chat and waits. Bale and Telegram only link to the panel: a key is never typed in a chat.
- **R6** Gmail and Calendar use the Google OAuth flow and their own tools.

## Acceptance criteria

The rules above, proved by `apps/server/test/interaction.test.ts` and `apps/server/e2e/panel.e2e.ts`.

## Documentation Impact

- rodo/linux-agent/project/architecture.md — new parts
- rodo/linux-agent/project/how-it-works.md — how they work
- rodo/linux-agent/project/client-overview.md — status

## Open Questions

- none

## Decisions

- Outlook and plain email are not in the catalog yet (default, not asked). Because Outlook needs its own OAuth flow and plain email needs a mail library.
- Keys are given to the panel, not to bots as environment variables (default, not asked). Because a bot that reads a web page must not be able to print a key.
