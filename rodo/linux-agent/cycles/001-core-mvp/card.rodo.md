<!-- RODO_ERROR: ITEM_LINE_INVALID: line 49: write - [ ] title (+1 more: rodo/linux-agent/.rodo/last-sync.json) -->
---
schemaVersion: 2
id: cmvw714t5000fpc01mspdflhq
title: "هستهٔ MVP: پنل، بات، چت، اجرای پس‌زمینه، تأیید"
status: in_progress
priority: high
scope:
  allowed: [apps/server/, apps/web/, packages/shared/, deploy/, "root workspace config (package.json, pnpm-workspace.yaml, tsconfig)", rodo/linux-agent/ docs of this cycle and current docs]
  forbidden: [the BaleBot repository and its server services, the hermes-gateway.service and Hermes Agent files inside the hermes container, any change on the host except one nginx server block and certificate for agent.roditeam.ir, "routines, browser, vault, connectors (later cycles)"]
workflow: major
updatedAt: 1793436830020
---

پنل وب با ورود دومرحله‌ای، ساخت بات، چت زنده، اجرای پس‌زمینه که با بستن مرورگر قطع نمی‌شود، تأیید کارهای حساس از پنل، بله و تلگرام، و نمایش مصرف. جزئیات در spec.md و design.md.

## Progress notes

- Updated: 2026-10-31
- Done: پروکسی و kill switch روی hermes. کد سرور و رابط وب، ۴۰ تست، اسکریپت‌های استقرار. نصب روی hermes انجام شد: `cwp.service` بالاست، ورود Claude برای agent درست است، کاربر پنل ساخته شد، گواهی و nginx برای agent.roditeam.ir فعال است و سایت از بیرون جواب می‌دهد.
- Remaining: اتصال دوبارهٔ پروژه به برد: توکن این دستگاه اجازهٔ برد قبلی را ندارد و کد اتصال تازه از وب‌سایت برد لازم است؛ کارت‌ها شناسهٔ برد را هم از دست داده‌اند، پس پیش از همگام‌سازی باید جلوی ساخته شدن کارت تکراری گرفته شود. توکن تلگرام مسعود اشتباه ذخیره شده و باید دوباره وارد شود. آزمون واقعی بله و تلگرام، اعمال پروکسی از پنل و سناریوی «لپ‌تاپ خاموش». push به GitHub منتظر دسترسی Masoud-rmz به مخزن است.
- Verified: آزمون Playwright روی نمونهٔ جدا: ورود، بات‌ها، چت زنده، تأیید و رد، ریلود، توقف و ادامه، فایل‌ها، مصرف، تنظیمات، دو زبان، گوشی و تبلت. تست‌های سرور ✓ (40). طراحی جدید رابط با اصلاح‌ها ادغام و نصب شد. بازبینی دوم روی نمونهٔ جدا با دو اصلاح تازه: ۱۳۶۶ و ۳۷۵ پیکسل، دو زبان، روشن و تیره، تأیید و رد، خطای توقف و ادامه ✓؛ typecheck و lint ✓. چهار تست قدیمی تأیید و رد و یک تست گفت‌وگوی تازه در اسکریپت کامل رد شدند و با تست دقیق‌تر ✓ شدند.

## Refs

- [توضیح ساده](/rodo/linux-agent/cycles/001-core-mvp/simple.md) <!-- rodo:ref_cmvw714ui000hpc01waxdnul2 -->
- [سند فنی](/rodo/linux-agent/cycles/001-core-mvp/spec.md) <!-- rodo:ref_cmvw714uu000jpc01y37f1ktf -->
- [طراحی](/rodo/linux-agent/cycles/001-core-mvp/design.md) <!-- rodo:ref_cmvw714uy000lpc016wfm7ttz -->
- [معماری](/rodo/linux-agent/project/architecture.md) <!-- rodo:ref_cmvw714v3000npc01xi4873qw -->

## Checklist: قدم‌ها <!-- rodo:chk_cmvw714wp000ppc01uzljgmaj -->

- [x] اسکلت مونوریپو pnpm (server، web، shared) با lint، typecheck و vitest که پاس شوند <!-- rodo:ckl_cmvw714x8000rpc01psbjcb37 -->
- [x] پروکسی sing-box و kill switch برای کانتینر hermes، و بررسی دسترسی به Anthropic و تلگرام (R18) <!-- rodo:ckl_cmvw714y0000tpc01criam8un -->
- [x] اسکریپت آماده‌سازی داخل کانتینر hermes: کاربرهای `panel` و `agent`، Node 22 و Claude Code؛ `claude` با اشتراک وارد شود و hermes-gateway سالم بماند <!-- rodo:ckl_cmvw714yg000vpc010x23m6tu -->
- [x] دیتابیس SQLite و migration جدول‌ها (R14). تست migration پاس شود <!-- rodo:ckl_cmvw714z0000xpc01fovwpv33 -->
- [x] ورود: رمز و TOTP با کوکی امن (R1–R2). تست ورود درست، غلط و قفل شدن پاس شود <!-- rodo:ckl_cmvw714zg000zpc01wngrulqw -->
- [x] مدیریت بات‌ها: ساخت، ویرایش و حذف، با پوشهٔ هر بات (R3–R4) <!-- rodo:ckl_cmvw714zy0011pc0118pw7x18 -->
- [x] هماهنگ‌کننده: صف، سقف هم‌زمانی، سقف نوبت و زمان، و اجرای Agent SDK (R5–R9) <!-- rodo:ckl_cmvw7150f0013pc01wnm3i5lg -->
- [x] استریم رویدادها با SSE و پخش دوباره بعد از رفرش (R6) <!-- rodo:ckl_cmvw7150v0015pc017vbwua52 -->
- [x] تأیید: دسته‌بندی ابزارها، canUseTool، صف تأیید در پنل (R10–R11) <!-- rodo:ckl_cmvw7151d0017pc01ft39bgdu -->
- [x] تنظیم توکن بله و تلگرام در پنل، و اعلان و تأیید با دکمه (R12) <!-- rodo:ckl_cmvw7151s0019pc01hjyj5h3d -->
- [x] رابط دوزبانهٔ فارسی (راست‌به‌چپ) و انگلیسی <!-- rodo:ckl_cmvw71528001bpc014q4vubmm -->
- [x] صفحهٔ مصرف و حالت «منتظر سقف اشتراک» با ادامهٔ خودکار (R13) <!-- rodo:ckl_cmvw7152w001dpc012ditg9z4 -->
- [x] مرورگر فایل فقط‌خواندنی و دانلود (R15) <!-- rodo:ckl_cmvw7153l001fpc01rzr88ubc -->
- [x] بخش پروکسی در تنظیمات: لینک یا سابسکریپشن، اعمال کانفیگ و نمایش وضعیت اتصال (R18–R20) <!-- rodo:ckl_cmvw7154j001hpc0176424szm -->
- [x] systemd، nginx و گواهی برای agent.roditeam.ir، پشتیبان روزانهٔ دیتابیس، snapshot کانتینر و سند استقرار (R16–R17) <!-- rodo:ckl_cmvw7155j001jpc01f037b1d0 -->
- [ ] آزمون دستی سناریوی «لپ‌تاپ خاموش» از simple.md روی سرور <!-- rodo:ckl_cmvw7156k001lpc01x7mrevyb -->
- Updated: 2026-10-31
- Remaining: Real tests on the live panel: messages reach Bale and Telegram, a refused proxy leaves the connection up, an 18-minute run finished with no browser open. Remaining: pressing an approval button in Bale or Telegram, switching to a second real proxy, turning the laptop off for real.
