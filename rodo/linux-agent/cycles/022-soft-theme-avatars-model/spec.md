# 022 — ظاهر نرم، آواتار بات‌ها، نشان تأیید و انتخاب مدل: technical spec

## 1. Summary

Restyle the web app (tokens plus a depth layer, both themes). Give every bot a persisted random avatar. Show pending approvals as a badge on the bot's avatar with a floating decision menu. Add model and effort controls beside the composer. The effort level is new on the server and goes to the Agent SDK `effort` option.

## 2. Rules

- **R1** `bots.effort` is nullable: `null` (panel default), `low`, `medium`, `high`, `max`. When null, `effort` is not passed to the engine. Any other value is refused by the request schema with 400 `bad_request`.
- **R2** `bots.avatar` is nullable. `Bot.avatar` in the API is always an integer 1..AVATAR_COUNT: the stored one, else a stable pick from the bot id. A new bot gets a random stored avatar. PATCH accepts an integer in range, else 400 `bad_request`.
- **R3** `Approval` has `botId`. The pending list lets the web group by bot without matching names.
- **R4** `MODEL_CHOICES` in `packages/shared` lists the aliases `opus`, `sonnet`, `haiku` with a plain Persian description. The model chip offers them, "پیش‌فرض پنل" (null) and a free-text field. The old text field in the bot dialog stays and still accepts any name.
- **R5** A bot with pending approvals shows a badge with the count on its avatar (sidebar and chat head). Click opens a floating menu next to the avatar with allow and deny buttons per approval. Deciding calls the existing `POST /api/approvals/:id/decide`. On phones the menu is a bottom sheet. Escape or a click outside closes it.
- **R6** The chat shows a model chip and an effort chip above the composer. Changing them PATCHes the bot at once and reloads the list. Effort shows "پیش‌فرض" when null.
- **R7** Both themes use the same token names. The light theme is soft pastel on a gradient ground; the dark theme is designed on its own. Depth uses stacked shadows plus an inner top highlight. Motion is slow and small and is turned off under `prefers-reduced-motion`.
- **R8** Avatars are 128 px PNGs in `apps/web/public/avatars/NN.png`, from `docs/avatars`. The ring around an avatar shows how busy the bot is.

## 3. Data

- Migration: `ALTER TABLE bots ADD COLUMN effort TEXT;` and `ALTER TABLE bots ADD COLUMN avatar INTEGER;`.

## 4. API / logic

- `Bot` gains `effort: Effort | null` and `avatar: number`. `BotInput` gains `effort?: Effort | null` and `avatar?: number`.
- `EngineStartOptions.effort?: Effort`; `ClaudeAgentEngine` passes it as `options.effort` only when set.
- The orchestrator passes `bot.effort ?? undefined`.
- `GET /api/approvals?state=pending` rows include `botId`.

## 5. Screens

- Sidebar: avatar with a ring (running state), badge, name and state.
- Chat head: larger avatar with the same badge, bot name, conversation picker.
- Composer: two chips (model, effort) above the text box.
- Floating menu: the approval summary, "تأیید" and "رد کردن".

## 6. Files to create or change

- `apps/server/src/db.ts`, `bots.ts`, `app.ts`, `approval/service.ts`, `engine/types.ts`, `engine/claude.ts`, `runs/orchestrator.ts` — server.
- `packages/shared/src/index.ts` — types, `MODEL_CHOICES`, `EFFORT_LEVELS`, `AVATAR_COUNT`.
- `apps/web/src/styles.css`, `App.tsx`, `Chat.tsx`, `BotDialog.tsx`, `i18n.tsx`, new `avatars.tsx`, `approvalPop.tsx`, `modelChips.tsx` — web.
- `apps/web/public/avatars/*.png` — avatars.
- `apps/server/test/*.test.ts` — tests.
- `.gitignore` — `graphify-out/`.

## 7. Edge cases

- A very old Claude Code build may refuse the effort flag. The default is null, so nothing changes until someone picks a level.
- A bot with 0 pending approvals shows no badge.
- Several approvals for one bot: the menu lists them all; the badge shows the count.
- Menu near the screen edge: it is pushed inside the window.

## 8. Acceptance run

Server unit tests (`pnpm --filter @linux-agent/server test`), typecheck, lint, and a look at the real app in a browser.

## Acceptance criteria

- **Must happen:** create a bot, it has an avatar number (R2). PATCH effort `high`, it is stored and sent to the engine (R1). A pending approval shows `botId` (R3). The badge menu approves and the badge disappears (R5). Chips change model and effort (R6).
- **Must not happen:** an invalid effort or avatar is saved. A null effort is passed to the engine. The approvals page stops working.
- **Done when:** tests, typecheck and lint pass, and both themes look right on desktop and phone width.

## Documentation Impact

- `rodo/linux-agent/project/how-it-works.md` — mention avatar, badge and the model chips.
- `rodo/linux-agent/MAP.md`, `MEMORY.md` — close the cycle.
- `README.md` — none.

## Open Questions

- none

## Decisions

- The model list is the aliases opus, sonnet and haiku plus free text (default, not asked). Because the pinned Claude Code 2.1.112 cannot run newer models.
- Effort is null by default and only passed when set (default, not asked). Because an old build may not know the flag.
- The avatar is stored per bot and random at creation (default, not asked). Because a changing picture on every visit would confuse.
- The old approvals page stays (default, not asked). Because the menu is a shortcut and the page also shows history and question cards.
