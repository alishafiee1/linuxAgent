# انتخاب دستیار، مدل و گفت‌وگو در پیام‌رسان

Shared design: `cycles/015-messenger-chat/design.md`.

## Rules

- **R1** Commands, in the menu where supported: `/menu /bots /model /new /chats /status /stop /help`. Each opens buttons.
- **R2** Bot buttons show name and role. Choosing one sets the current bot and opens its latest conversation.
- **R3** The model list comes from the engine (`supportedModels`), cached and limited by a list in Settings, so unavailable models are never shown.
- **R4** The choice is per conversation: new column `conversations.model`, taking priority over the bot and the default. The panel shows and can change it too.
- **R5** `/chats` shows the latest 8 with paging. Long titles are shortened and button data stays under 64 bytes.
- **R6** A short line under each answer, or a header when it changes, says which bot and model answered.
- **R7** A button pressed on an old menu re-reads the state and never acts on a deleted bot or conversation.

## Acceptance criteria

- Choosing a bot routes the next message to it; the model reaches the engine; an old button is handled safely.

## Documentation Impact

- rodo/linux-agent/project/how-it-works.md — how the messenger works
- rodo/linux-agent/project/client-overview.md — status
- rodo/linux-agent/project/architecture.md — the channel layer
- deploy/README.md — any new package or setting

## Open Questions

- none that block work; see `design.md` for choices a person may want to change

## Decisions

- Model choice stays with the conversation, not the chat (default, not asked). Because a new task should not inherit an expensive model by accident.
