# گزارش‌ها، کارت وضعیت و ساعت سکوت

Shared design: `cycles/015-messenger-chat/design.md`.

## Rules

- **R1** Routine results get buttons: Run again, Continue this, Open in panel. "Continue" opens that conversation.
- **R2** `/routines` lists routines with run and on/off buttons.
- **R3** Daily status card, optional: running, waiting for you, usage, and a low disk warning.
- **R4** Notification levels per channel: everything, only what needs me, or nothing. Which messenger receives what is a setting.
- **R5** Quiet hours hold ordinary notices until morning. Anything waiting for the person still arrives, unless turned off.
- **R6** Near the subscription limit, one notice per reset period, not one per run.

## Acceptance criteria

- Quiet hours hold a notice and release it; approvals still arrive; the limit notice is sent once.

## Documentation Impact

- rodo/linux-agent/project/how-it-works.md — how the messenger works
- rodo/linux-agent/project/client-overview.md — status
- rodo/linux-agent/project/architecture.md — the channel layer
- deploy/README.md — any new package or setting

## Open Questions

- none that block work; see `design.md` for choices a person may want to change

## Decisions

- none
