---
schemaVersion: 2
title: پیام صوتی در پیام‌رسان
status: todo
priority: medium
workflow: standard
members: []
scope:
  allowed: [apps/server/, apps/web/, packages/shared/, deploy/, rodo/linux-agent/]
  forbidden: [BaleBot, hermes-gateway.service]
---

پیام صوتی می‌فرستید و به متن تبدیل می‌شود. جواب را هم می‌توانید به صدا بشنوید. برای این کار ElevenLabs باید وصل باشد.

## Progress notes

- Updated: 2026-11-01
- Done: هنوز شروع نشده
- Remaining: همهٔ قدم‌ها

## Refs

- [توضیح ساده](/rodo/linux-agent/cycles/019-messenger-voice/simple.md)
- [سند فنی](/rodo/linux-agent/cycles/019-messenger-voice/spec.md)
- [طراحی مشترک](/rodo/linux-agent/cycles/015-messenger-chat/design.md)

## Checklist: قدم‌ها

- [ ] آزمون واقعی فارسی
- [ ] تبدیل گفتار به متن
- [ ] تبدیل متن به گفتار با دکمهٔ شنیدن
- [ ] ffmpeg و sendVoice
- [ ] تنظیمات صدا و سقف طول
- [ ] آزمون‌ها
