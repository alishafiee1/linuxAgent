# گفت‌وگوی کامل از بله و تلگرام، با امنیت

## Rules

- **R1** A `MessengerChannel` interface wraps Bale and Telegram: send, edit, buttons, files, download. The notifier uses it too. The rest of the code does not know which messenger it is.
- **R2** Only updates from the configured chat are handled. A message from any other chat gets no answer and is logged by count only.
- **R3** Text not claimed by a waiting question or "other" answer becomes a run in the chat's current conversation with the current bot, through `Orchestrator.submit`, the same path as the panel.
- **R4** State per channel: current bot and current conversation. Table `messenger_chats`. The first message uses the last bot used, or the first bot.
- **R5** The final answer is converted from Markdown to the messenger's format and split under the message limit without breaking code blocks. If formatting is refused, it is sent as plain text.
- **R6** The polling offset is stored, so a restart neither loses nor repeats a message. Each update is handled once.
- **R7** Text that looks like a key or token is not sent to the bot. The person is warned and pointed to the panel, and the message is deleted where the messenger allows.
- **R8** Optional lock code: after a set idle time, messages need the code first. Approvals still work through the gate as before.
- **R9** Sending too fast is limited per chat, and 429 answers are retried after the time the API gives.
- **R10** The first step measures real Bale behaviour against this spec, with a test bot: limits, edit, delete, formats. Results go to `spec.md`.

## Acceptance criteria

- A fake Bot API server for tests that records calls and sends updates.
- Message arrives, run starts, answer returns; messages from another chat are ignored; restart does not repeat a message; a pasted key does not reach the prompt.

## Documentation Impact

- rodo/linux-agent/project/how-it-works.md — how the messenger works
- rodo/linux-agent/project/client-overview.md — status
- rodo/linux-agent/project/architecture.md — the channel layer
- deploy/README.md — any new package or setting

## Open Questions

- none that block work; see `design.md` for choices a person may want to change

## Decisions

- One messenger bot with a bot selector, not one messenger bot per agent (default, not asked). Because it needs no new tokens and keeps approvals in one place. Separate bots can come later.
- Keep long polling (default, not asked). Because it needs no public webhook and already works through the proxy.
- The two messengers share state per channel, not across them (default, not asked). Because a person usually keeps a task in one place.
