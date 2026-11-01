---
schemaVersion: 2
title: فایل و عکس در پیام‌رسان
status: todo
priority: medium
workflow: standard
members: []
scope:
  allowed: [apps/server/, apps/web/, packages/shared/, deploy/, rodo/linux-agent/]
  forbidden: [BaleBot, hermes-gateway.service]
---

فایل و عکس را مثل یک گفت‌وگوی عادی به بات می‌دهید و خروجی را همان‌جا می‌گیرید. فایل خیلی بزرگ با لینک پنل می‌آید.

## Progress notes

- Updated: 2026-11-01
- Done: هنوز شروع نشده
- Remaining: همهٔ قدم‌ها

## Refs

- [توضیح ساده](/rodo/linux-agent/cycles/018-messenger-files/simple.md)
- [سند فنی](/rodo/linux-agent/cycles/018-messenger-files/spec.md)
- [طراحی مشترک](/rodo/linux-agent/cycles/015-messenger-chat/design.md)

## Checklist: قدم‌ها

- [ ] دریافت با getFile
- [ ] گروه کردن آلبوم
- [ ] send_file به پیام‌رسان
- [ ] حد حجم و لینک پنل
- [ ] پاک بودن لاگ از توکن
- [ ] آزمون‌ها
