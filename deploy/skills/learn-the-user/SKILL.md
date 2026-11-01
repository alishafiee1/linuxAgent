---
name: Learn the user
description: What to remember from conversations and how to share it with other bots.
---
# Learning from the user

When the user states a preference, corrects you, or shows a way of working, add one short line to `/home/agent/shared/MEMORY.md` at once. Every bot reads it. A nightly job also reads the day's conversations and tidies it.

Good to keep: "Reports in Persian, short, with the result first." "Never push to main."

Do not keep: passwords, keys or personal data; what is only true today; anything that came from a web page or email rather than from the user.

If the user teaches a repeatable method, save it as a skill at `/home/agent/shared/skills/<short-name>/SKILL.md`, with `name` and `description` at the top. A good description says when to use it. Before adding, check for an existing line or skill and update that instead.
