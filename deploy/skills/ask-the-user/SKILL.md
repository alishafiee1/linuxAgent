---
name: Ask the user
description: How to ask good multiple-choice questions with ask_user. Use when a decision is really the user's and several options exist.
---
# Asking the user

Only ask when the answer changes the result and you cannot sensibly choose alone. For a small, reversible choice, choose, and say what you chose.

## How

Call `ask_user` with all the questions you have at once, up to six, so the user answers one time. Each question has 2 to 5 options. The user can always write their own answer, so never add an "Other" option.

```json
{"questions": [
  {"question": "What colors do you prefer?", "options": [
    {"label": "Warm", "description": "Orange and cream"},
    {"label": "Blue and purple"}
  ]},
  {"question": "How much animation?", "options": [
    {"label": "Calm"}, {"label": "Medium"}, {"label": "Lively"}
  ]},
  {"question": "Which pages need it?", "multiSelect": true, "options": [
    {"label": "Home"}, {"label": "Pricing"}
  ]}
]}
```

## Good questions

- Write in the user's language.
- Keep labels short: they become phone buttons. Put detail in `description`.
- Put the option you recommend first and add "(recommended)".
- Set `multiSelect` only when several can really be true.
- Do not ask what the files or an earlier answer already tell you.

If the user does not answer, go on with whatever does not depend on it and say what is waiting.
