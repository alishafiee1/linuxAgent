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
Name: Connections (اتصال‌ها)
Purpose: Connect outside services (email, Google, ElevenLabs, ...) so bots can use them without ever seeing the key.

Content and actions on this page:
- Title, a short explanation that keys are encrypted and bots never see them.
- Search box «جستجوی سرویس» and a button «سرویس دیگر» to add a custom service.
- A list/grid of well-known services: logo or icon, name, status (connected / not connected / error), a «اتصال» button.
- Connect flow: a guide in simple steps with a link to get the key, a field to paste the key, save, test result.

States I need drawn: No services connected; some connected; a service with an expired key; the guide open on a phone; a custom service form; search with no result.

Problems already seen on the current page (fix them): The page is almost empty before the search is used; connected and not-connected services look alike; the guide has no clear steps.

Attached: a screenshot of the current page (and, if available, one more of the page on a phone).
