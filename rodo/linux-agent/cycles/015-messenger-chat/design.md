# Design: Bale and Telegram as full assistants (cycles 015 to 020)

## Goal

The messenger becomes a complete way to work with the panel, not only a place for notices. Everything goes through the same path as the panel: orchestrator, approval gate, requests and uploads. The messenger adds no second set of rules.

## Where we start

Already built: long polling with `Notifier`, approval buttons, question cards with "other", and the browser handoff link. Missing: incoming work, a choice of bot and model, progress, files and voice.

## Shape

```
Bale / Telegram <-> MessengerChannel (one per messenger)
                         |
                    MessengerRouter
     (button? waiting answer? command? file? voice? plain text?)
                         |
        Orchestrator  RequestService  ApprovalService  UploadService  PlatformService
```

- **MessengerChannel:** the only code that knows Bot API details. Each messenger has its limits as data, so differences stay in one place.
- **MessengerRouter:** decides what an update means, in this order: lock, secret check, button, waiting "other" answer, command, file or voice, plain text.
- **RunReporter:** turns run events into the status message and the final answer. It listens to `EventStore`, so runs started in the panel can report too if the person wants.

## Data

- `messenger_chats`: channel, chat id, current bot, current conversation, voice reply on or off, lock state, poll offset.
- `conversations.model`: nullable override.
- `run_origin`: which channel started a run, so the answer goes back there.

Settings hold notification levels, quiet hours, allowed models and voice.

## Security

The messenger account becomes a way to start work, so this is the main risk.

1. Only the configured chat counts, checked on every update and button.
2. The approval gate is unchanged: a phone message cannot skip it. A stolen account can still approve, which is why the optional lock code exists.
3. No secrets in chat: keys are detected and refused. The connection card stays in the panel.
4. Files and transcripts are data, never instructions. A voice message from the person is treated like their text, but text inside a file is not.
5. Bot tokens never reach logs. Telegram file URLs contain the token, so they never appear in errors or events.
6. Telegram and Bale see what passes through them, and ElevenLabs hears voice. This is stated to the person, and the panel stays available for sensitive work.

## Order and dependencies

| Cycle | What | Needs | Size |
|---|---|---|---|
| 015 | Chat and security | | 3 to 5 days |
| 016 | Bot, model, conversation | 015 | 2 to 3 days |
| 017 | Progress, stop, continue | 015 | 2 days |
| 018 | Files and photos | 015, 014 | 2 to 3 days |
| 019 | Voice | 018 | 2 to 3 days |
| 020 | Reports and quiet hours | 017 | 2 days |

015 is usable alone. After it, the order of the rest can change.

## Testing

- A fake Bot API server plays both messengers in `apps/server/e2e/`: it records calls and sends updates, so tests use no real bot and no subscription.
- Each card closes with one real check on Bale and on Telegram, driven by the person's own chat.

## Choices a person may want to change

These have defaults, so work is not blocked:

| Choice | Default | Other option |
|---|---|---|
| One messenger bot or one per agent | One, with a selector | One per agent: separate tokens and a separate identity |
| Reply by voice | On request, with a button | Always, per chat |
| Learning from messenger chats | Same as panel | Exclude them |
| Lock code | Off | On, with an idle time |

## Known unknowns

- **Bale limits:** official limits were not found in search; a third-party tool lists 50 MB for sending. Cycle 015 measures them first.
- **Telegram limits:** about 20 MB to receive and 50 MB to send, from secondary sources. Check against the official docs during 015.
- **Persian speech quality:** ElevenLabs lists Persian, but its own pages give conflicting accuracy. Cycle 019 tests it on real audio.
