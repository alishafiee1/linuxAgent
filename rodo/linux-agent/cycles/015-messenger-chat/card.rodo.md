---
schemaVersion: 2
title: گفت‌وگوی کامل از بله و تلگرام، با امنیت
status: todo
priority: high
workflow: major
members: []
scope:
  allowed: [apps/server/, apps/web/, packages/shared/, deploy/, rodo/linux-agent/]
  forbidden: [BaleBot, hermes-gateway.service]
---

از گوشی به بات کار می‌دهید و جواب همان‌جا می‌آید. ربات فقط به حساب شما جواب می‌دهد و کد قفل اختیاری دارد.

## Progress notes

- Updated: 2026-11-01
- Done: هنوز شروع نشده
- Remaining: همهٔ قدم‌ها

## Refs

- [توضیح ساده](/rodo/linux-agent/cycles/015-messenger-chat/simple.md)
- [سند فنی](/rodo/linux-agent/cycles/015-messenger-chat/spec.md)
- [طراحی مشترک](/rodo/linux-agent/cycles/015-messenger-chat/design.md)

## Checklist: قدم‌ها

- [ ] آزمون Bale واقعی و ثبت نتیجه در spec
- [ ] رابط MessengerChannel و انتقال Notifier به آن
- [ ] جدول messenger_chats و ذخیرهٔ offset
- [ ] پیام ورودی به run
- [ ] تبدیل قالب و تقسیم پیام بلند
- [ ] تشخیص کلید و کد قفل
- [ ] سرور ساختگی Bot API و آزمون‌ها
