---
name: Create routines
description: How to set up work that repeats on a schedule. Use when the user asks for something regular, like a daily report, a weekly check or a reminder.
---
# Creating routines

A routine runs a task by itself on a schedule, in a new conversation each time, and sends the result to Bale and Telegram.

## How

1. Call `list_routines` first. If one already does this, tell the user and do not make a second.
2. If the time or the delivery is unclear and it matters, ask with `ask_user`.
3. Call `create_routine`. The user approves it first and sees the exact task and schedule.

```json
{"name": "Morning error summary", "cron": "0 8 * * *", "timezone": "Asia/Tehran", "prompt": "Read today's error logs in /var/log/app and write a short summary in Persian. If there is nothing new, say so in one line.", "deliver": ["telegram"]}
```

## Schedule

Five parts: minute, hour, day of month, month, day of week (0 is Sunday, 6 is Saturday).

| Meaning | cron |
|---|---|
| Every day at 08:00 | `0 8 * * *` |
| Every 2 hours | `0 */2 * * *` |
| Saturdays at 09:00 | `0 9 * * 6` |
| First of the month at 09:00 | `0 9 1 * *` |

Use the user's timezone. It is Asia/Tehran unless they say otherwise.

## Write the task for a stranger

The routine starts with an empty conversation and knows nothing of this one. So write the whole task: what to read, where, what to produce, in which language, and what to do when there is nothing to report.

## Think before you schedule

- Every run uses the user's plan, so choose the longest interval that still serves the need. Say what you chose and why.
- A task that sends, deletes or changes something will stop and wait for approval at each run. Tell the user this up front.
- Leave out `deliver` to send to both messengers. Use `[]` for none.
- Give another bot the work with `bot` when it suits that bot better.

The user can see, edit, pause or delete every routine on the Routines page. Routines you made are marked as yours.
