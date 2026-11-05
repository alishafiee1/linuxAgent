# 029 — منوی بازشونده، لینک صفحه‌های پنل و آدرس‌دهی مرورگر: technical spec

> Source of truth for the coder. Written in the technical language (`project.json`). Anything not here is not expected.
> Every rule has a bold ID (**R1**, **R2** ...). If the card has scenarios, tag each scenario with the rules it proves (`@R1`) and try to cover every rule.

## 1. Summary

Panel pages get hash addresses (#/settings). Bots get a prompt that lists them as Markdown links. The live browser gets a start page and an address normalizer.

## 2. Rules

- **R1** A full http(s) address stays, `example.com/x` gets https, other text becomes a DuckDuckGo search.
- **R2** file:, data:, javascript-like and other schemes are never opened (400 bad_url).
- **R3** The bot prompt lists every page as `[name](#/page)`.
- **R4** A link `#/page` or `<panel origin>/#/page` in a reply opens in place and moves the page.
- **R5** The page list can be collapsed; the choice is kept in this browser.

## 3. Data

none

## 4. API / logic

none; `navigate` input is normalized by the server.

## 5. Screens

Hint in the address field: «آدرس سایت یا عبارت جست‌وجو». Start page title «صفحهٔ شروع».

## 6. Files to create or change

- `browser/address.ts`, `browser/service.ts`, `panelLinks.ts`, `index.ts`, `App.tsx`, `Chat.tsx`, `Markdown.tsx`, `pagesExt.tsx`, `icons.tsx`, `i18n.tsx`, `styles.css`

## 7. Edge cases

- The start page shows Persian text with DejaVu if no better font is installed on the server.

## 8. Acceptance run (if the card has scenarios)

Optional. `rodo test` (the card's `test.command`, or `testCommand` from `project.json` with `{NNN}` = `029`).

## Acceptance criteria

- **Must happen:** R1 to R5
- **Must not happen:** a bad scheme gets opened (R2)
- **Done when:** address.test passes; links move the page in the preview

## Documentation Impact

- rodo/linux-agent/MAP.md — list cycle 029

## Open Questions

- none

## Decisions

- A bot hands over a link; it does not move the person by itself (default, not asked). Because a page that changes under your hands is confusing.
