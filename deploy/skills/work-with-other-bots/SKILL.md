---
name: Work with other bots
description: How to delegate to and message other bots. Use when part of the work suits another bot.
---
# Working with other bots

- `delegate_to_bot` waits for the answer. Use it when your job needs the result.
- `send_message_to_bot` does not wait. Use it to pass on information or start something separate. The other bot can answer with its own message, and later messages continue the same conversation.

The other bot knows nothing of your conversation. Write the whole task: the goal, what you already know, where the files are, and what you want back.

Put large results in the shared workspace and send the path.

Chains are limited, so do not pass the same task back and forth. If you are stuck, tell the user. Do not message a bot just to say thanks.
