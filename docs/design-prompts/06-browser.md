You are a senior product designer. Redesign ONE page of an existing web app, in LIGHT theme first, then give the dark variant.

## The product
linuxAgent is a personal web panel (Persian, right-to-left) where one person manages several AI "bots" that run on an always-on Linux server. The owner mostly uses it from a phone to approve sensitive actions, answer questions from bots and read reports. It must feel calm, trustworthy and soft, not like a developer dashboard.

## Design system you must keep
- Language: Persian (fa), dir="rtl". Font: Vazirmatn (400, 500, 600, 700). Digits are Persian.
- Soft style: rounded corners (12-18px), gentle depth (soft shadows, subtle sheen), generous spacing, no harsh borders.
- Accent: blue-violet (#3a66ee). Status colors: green = ok, amber = waiting, red = problem. Never rely on color alone: add an icon and a word.
- Bots have round avatars inside a thin ring, with a small badge for pending approvals (4 example bots: محقق، کدنویس، سرمایه، یادگیری).
- Navigation: top bar (logo, tabs: چت، تأییدها، اتصال‌ها، روتین‌ها، حافظه، مرورگر، صفحه‌ها، مصرف، فایل‌ها، تنظیمات, a small proxy-status pill, a "jobs running" pill, theme toggle, language, logout) and a right-side list of bots. On phone the tabs scroll sideways and menus become bottom sheets.
- Light theme is the one to perfect. Provide dark theme tokens too (same structure, same contrast rules).

## Hard rules
1. Easy to read: body 14-15px, contrast at least 4.5:1 in both themes.
2. Right-to-left done properly: Latin text (file names, model names, URLs, dates, numbers with units) is isolated so punctuation does not flip. Show it as a left-to-right chip.
3. Phone first: design 390px wide first, then 1280px desktop. Touch targets at least 44px.
4. Every state, not only the happy one: empty, loading, error, long text, many items, one item.
5. Plain Persian for a non-technical owner. Short labels, no jargon, say what happens after a click.
6. Do not invent features. Only reorganize, restyle and clarify what the page already does.
7. Keep it simple: the fewest elements that do the job. Remove what does not help the owner decide or act.

## What I want from you
1. A short critique of the attached screenshot: the 5 biggest problems, most important first.
2. The new layout as a clear flow: what the person sees first, what they do next, what happens after.
3. Visual design for phone (390px) and desktop (1280px), light theme. Then the dark variant.
4. The key states listed below.
5. A small token table (colors, radius, shadow, spacing, font sizes) I can paste into CSS variables.
6. Real Persian copy for every label, button, empty message and error. No lorem ipsum.

## PAGE
Name: Browser and vault (مرورگر و گاوصندوق)
Purpose: Open a bot's live browser to log in for it, and keep logins safely.

Content and actions on this page:
- Card «مرورگر زنده»: a bot picker, the state («مرورگر این بات بسته است»), a button «باز کن». When open: a live view the owner can click and type in, with a clear 'give it back to the bot' button.
- Card «گاوصندوق» (vault): explains that passwords are encrypted and never shown again; the bot only sees the name; form: name, username, password, site (recommended: only for this site), save; a list of saved items without secrets, with delete.

States I need drawn: Browser closed; opening; open and live; a vault with no items; a vault with 5 items; a save error; the live view on a 390px phone.

Problems already seen on the current page (fix them): The two cards look like one long form; nothing tells the owner the live view is private and safe; the vault list is invisible.

Attached: a screenshot of the current page (and, if available, one more of the page on a phone).
