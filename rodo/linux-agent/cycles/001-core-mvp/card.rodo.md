---
schemaVersion: 2
title: "هستهٔ MVP: پنل، بات، چت، اجرای پس‌زمینه، تأیید"
status: in_progress
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

- Updated: 2026-10-30
- Done: پروکسی و kill switch روی hermes. کد سرور و رابط وب، ۴۰ تست، اسکریپت‌های استقرار. آزمون واقعی محلی: بات با Claude کار کرد و `rm -rf` منتظر تأیید ماند و با «رد» اجرا نشد.
- Remaining: نصب روی hermes (deploy/README.md)، ورود اشتراک Claude برای کاربر agent، دامنه و گواهی، آزمون «لپ‌تاپ خاموش» روی سرور. push به GitHub منتظر دسترسی Masoud-rmz به مخزن است.
- Verified: pnpm test ✓ (40)، pnpm typecheck ✓، pnpm lint ✓، آزمون دستی محلی ✓

## Refs

- [توضیح ساده](/rodo/linux-agent/cycles/001-core-mvp/simple.md)
- [سند فنی](/rodo/linux-agent/cycles/001-core-mvp/spec.md)
- [طراحی](/rodo/linux-agent/cycles/001-core-mvp/design.md)
- [معماری](/rodo/linux-agent/project/architecture.md)

## Checklist: قدم‌ها

- [x] اسکلت مونوریپو pnpm (server، web، shared) با lint، typecheck و vitest که پاس شوند
- [x] پروکسی sing-box و kill switch برای کانتینر hermes، و بررسی دسترسی به Anthropic و تلگرام (R18)
- [ ] اسکریپت آماده‌سازی داخل کانتینر hermes: کاربرهای `panel` و `agent`، Node 22 و Claude Code؛ `claude` با اشتراک وارد شود و hermes-gateway سالم بماند
- [x] دیتابیس SQLite و migration جدول‌ها (R14). تست migration پاس شود
- [x] ورود: رمز و TOTP با کوکی امن (R1–R2). تست ورود درست، غلط و قفل شدن پاس شود
- [x] مدیریت بات‌ها: ساخت، ویرایش و حذف، با پوشهٔ هر بات (R3–R4)
- [x] هماهنگ‌کننده: صف، سقف هم‌زمانی، سقف نوبت و زمان، و اجرای Agent SDK (R5–R9)
- [x] استریم رویدادها با SSE و پخش دوباره بعد از رفرش (R6)
- [x] تأیید: دسته‌بندی ابزارها، canUseTool، صف تأیید در پنل (R10–R11)
- [x] تنظیم توکن بله و تلگرام در پنل، و اعلان و تأیید با دکمه (R12)
- [x] رابط دوزبانهٔ فارسی (راست‌به‌چپ) و انگلیسی
- [x] صفحهٔ مصرف و حالت «منتظر سقف اشتراک» با ادامهٔ خودکار (R13)
- [x] مرورگر فایل فقط‌خواندنی و دانلود (R15)
- [x] بخش پروکسی در تنظیمات: لینک یا سابسکریپشن، اعمال کانفیگ و نمایش وضعیت اتصال (R18–R20)
- [ ] systemd، nginx و گواهی برای agent.roditeam.ir، پشتیبان روزانهٔ دیتابیس، snapshot کانتینر و سند استقرار (R16–R17)
- [ ] آزمون دستی سناریوی «لپ‌تاپ خاموش» از simple.md روی سرور
