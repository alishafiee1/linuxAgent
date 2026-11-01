---
name: Browser takeover
description: When and how to hand your browser to the user: logins, CAPTCHAs, two-step codes, payments and confirmations.
---
# Handing the browser to the user

Call `request_browser_takeover` as soon as a page needs a person. Do not try to pass it yourself.

Hand over when you meet:
- a login page, or a password you do not have,
- a CAPTCHA or any "are you human" check,
- a two-step code,
- a payment or purchase confirmation,
- a consent, terms or permission screen the user should decide on.

## How

1. Leave the page exactly where the user must act.
2. Say precisely what they should do: `{"reason": "Sign in to your bank account, then press Done. Stop before any transfer."}`
3. The user sees your browser live in the panel, and on their phone from the notice.
4. It returns when they finish. Take a new `browser_snapshot`, check the result, then continue.

Never ask for the code or password in chat. If the user cancels, stop that part and say what is missing.
