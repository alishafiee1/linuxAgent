---
schemaVersion: 2
title: تحویل مرورگر به کاربر
status: done
priority: medium
workflow: standard
members: []
scope:
  allowed: [apps/server/, apps/web/, packages/shared/, deploy/, rodo/linux-agent/]
  forbidden: [BaleBot, hermes-gateway.service]
---

وقتی بات در مرورگرش به صفحه‌ای برسد که به شما نیاز دارد، مثل ورود، کد دومرحله‌ای یا CAPTCHA، خبر می‌دهد و همان صفحه را زنده به شما می‌سپارد. کارتان که تمام شد «ادامه بده» را می‌زنید.

## Progress notes

- Updated: 2026-11-01
- Done: ساخته و آزموده شد.
- Remaining: هیچ.

## Refs

- [توضیح ساده](/rodo/linux-agent/cycles/010-browser-takeover/simple.md)
- [سند فنی](/rodo/linux-agent/cycles/010-browser-takeover/spec.md)
