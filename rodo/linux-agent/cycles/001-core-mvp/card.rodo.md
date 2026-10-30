---
schemaVersion: 2
title: "هستهٔ MVP: پنل، بات، چت، اجرای پس‌زمینه، تأیید"
status: todo
priority: high
workflow: major
members: []
scope:
  allowed:
    - apps/server/
    - apps/web/
    - packages/shared/
    - deploy/
    - root workspace config (package.json, pnpm-workspace.yaml, tsconfig)
    - rodo/linux-agent/ docs of this cycle and current docs
  forbidden:
    - the BaleBot repository and its server services
    - the hermes-gateway.service and Hermes Agent files inside the hermes container
    - any change on the host except one nginx server block and certificate for agent.roditeam.ir
    - routines, browser, vault, connectors (later cycles)
---

پنل وب با ورود دومرحله‌ای، ساخت بات، چت زنده، اجرای پس‌زمینه که با بستن مرورگر قطع نمی‌شود، تأیید کارهای حساس از پنل، بله و تلگرام، و نمایش مصرف. جزئیات در spec.md و design.md.

## Progress notes

- Updated: 2026-10-29
- Done: برنامه‌ریزی (simple، spec، design)
- Remaining: یک سؤال باز (دسترسی شبکه)، بعد همهٔ قدم‌ها

## Refs

- [توضیح ساده](/rodo/linux-agent/cycles/001-core-mvp/simple.md)
- [سند فنی](/rodo/linux-agent/cycles/001-core-mvp/spec.md)
- [طراحی](/rodo/linux-agent/cycles/001-core-mvp/design.md)
- [معماری](/rodo/linux-agent/project/architecture.md)

## Checklist: قدم‌ها

- [ ] اسکلت مونوریپو pnpm (server، web، shared) با lint، typecheck و vitest که پاس شوند
- [ ] بررسی دسترسی شبکهٔ کانتینر hermes به Anthropic و تلگرام (سؤال باز spec)
- [ ] اسکریپت آماده‌سازی داخل کانتینر hermes: کاربرهای `panel` و `agent`، Node 22 و Claude Code؛ `claude` با اشتراک وارد شود و hermes-gateway سالم بماند
- [ ] دیتابیس SQLite و migration جدول‌ها (R14). تست migration پاس شود
- [ ] ورود: رمز و TOTP با کوکی امن (R1–R2). تست ورود درست، غلط و قفل شدن پاس شود
- [ ] مدیریت بات‌ها: ساخت، ویرایش و حذف، با پوشهٔ هر بات (R3–R4)
- [ ] هماهنگ‌کننده: صف، سقف هم‌زمانی، سقف نوبت و زمان، و اجرای Agent SDK (R5–R9)
- [ ] استریم رویدادها با SSE و پخش دوباره بعد از رفرش (R6)
- [ ] تأیید: دسته‌بندی ابزارها، canUseTool، صف تأیید در پنل (R10–R11)
- [ ] تنظیم توکن بله و تلگرام در پنل، و اعلان و تأیید با دکمه (R12)
- [ ] رابط دوزبانهٔ فارسی (راست‌به‌چپ) و انگلیسی
- [ ] صفحهٔ مصرف و حالت «منتظر سقف اشتراک» با ادامهٔ خودکار (R13)
- [ ] مرورگر فایل فقط‌خواندنی و دانلود (R15)
- [ ] systemd، nginx و گواهی برای agent.roditeam.ir، پشتیبان روزانهٔ دیتابیس، snapshot کانتینر و سند استقرار (R16–R17)
- [ ] آزمون دستی سناریوی «لپ‌تاپ خاموش» از simple.md روی سرور
