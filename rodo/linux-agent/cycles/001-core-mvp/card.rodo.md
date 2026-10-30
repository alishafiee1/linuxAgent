---
schemaVersion: 2
id: cmvu8nrtv035hmk019qycgyfu
title: "هستهٔ MVP: پنل، بات، چت، اجرای پس‌زمینه، تأیید"
status: todo
priority: high
scope:
  allowed: [apps/server/, apps/web/, packages/shared/, deploy/, "root workspace config (package.json, pnpm-workspace.yaml, tsconfig)", rodo/linux-agent/ docs of this cycle and current docs]
  forbidden: [the BaleBot repository and its server services, the hermes-gateway.service and Hermes Agent files inside the hermes container, any change on the host except one nginx server block and certificate for agent.roditeam.ir, "routines, browser, vault, connectors (later cycles)"]
workflow: major
updatedAt: 1793316698027
---

پنل وب با ورود دومرحله‌ای، ساخت بات، چت زنده، اجرای پس‌زمینه که با بستن مرورگر قطع نمی‌شود، تأیید کارهای حساس از پنل، بله و تلگرام، و نمایش مصرف. جزئیات در spec.md و design.md.

## Progress notes

- Updated: 2026-10-29
- Done: برنامه‌ریزی (simple، spec، design)
- Remaining: یک سؤال باز (دسترسی شبکه)، بعد همهٔ قدم‌ها

## Refs

- [توضیح ساده](/rodo/linux-agent/cycles/001-core-mvp/simple.md) <!-- rodo:ref_cmvu8nrw1035jmk01u2atryi9 -->
- [سند فنی](/rodo/linux-agent/cycles/001-core-mvp/spec.md) <!-- rodo:ref_cmvu8nrwb035lmk018y6cukw2 -->
- [طراحی](/rodo/linux-agent/cycles/001-core-mvp/design.md) <!-- rodo:ref_cmvu8nrwg035nmk01cbc6cs9d -->
- [معماری](/rodo/linux-agent/project/architecture.md) <!-- rodo:ref_cmvu8nrwl035pmk01eqx8i6w7 -->

## Checklist: قدم‌ها <!-- rodo:chk_cmvu8nry5035rmk012x531ngq -->

- [ ] اسکلت مونوریپو pnpm (server، web، shared) با lint، typecheck و vitest که پاس شوند <!-- rodo:ckl_cmvu8nrz2035tmk018v7qnpvw -->
- [ ] بررسی دسترسی شبکهٔ کانتینر hermes به Anthropic و تلگرام (سؤال باز spec) <!-- rodo:ckl_cmvu8ns04035vmk01glbttv13 -->
- [ ] اسکریپت آماده‌سازی داخل کانتینر hermes: کاربرهای `panel` و `agent`، Node 22 و Claude Code؛ `claude` با اشتراک وارد شود و hermes-gateway سالم بماند <!-- rodo:ckl_cmvu8ns11035xmk01wos3ezw0 -->
- [ ] دیتابیس SQLite و migration جدول‌ها (R14). تست migration پاس شود <!-- rodo:ckl_cmvu8ns21035zmk01llz63pe8 -->
- [ ] ورود: رمز و TOTP با کوکی امن (R1–R2). تست ورود درست، غلط و قفل شدن پاس شود <!-- rodo:ckl_cmvu8ns2z0361mk015cwvr198 -->
- [ ] مدیریت بات‌ها: ساخت، ویرایش و حذف، با پوشهٔ هر بات (R3–R4) <!-- rodo:ckl_cmvu8ns3x0363mk01hcsza27i -->
- [ ] هماهنگ‌کننده: صف، سقف هم‌زمانی، سقف نوبت و زمان، و اجرای Agent SDK (R5–R9) <!-- rodo:ckl_cmvu8ns4j0365mk01sjswa9rc -->
- [ ] استریم رویدادها با SSE و پخش دوباره بعد از رفرش (R6) <!-- rodo:ckl_cmvu8ns4x0367mk01rs3gca5t -->
- [ ] تأیید: دسته‌بندی ابزارها، canUseTool، صف تأیید در پنل (R10–R11) <!-- rodo:ckl_cmvu8ns5b0369mk01cphawpga -->
- [ ] تنظیم توکن بله و تلگرام در پنل، و اعلان و تأیید با دکمه (R12) <!-- rodo:ckl_cmvu8ns5w036bmk0145810kbi -->
- [ ] رابط دوزبانهٔ فارسی (راست‌به‌چپ) و انگلیسی <!-- rodo:ckl_cmvu8ns6a036dmk01pazit94w -->
- [ ] صفحهٔ مصرف و حالت «منتظر سقف اشتراک» با ادامهٔ خودکار (R13) <!-- rodo:ckl_cmvu8ns6q036fmk01hs8j5g4o -->
- [ ] مرورگر فایل فقط‌خواندنی و دانلود (R15) <!-- rodo:ckl_cmvu8ns75036hmk01hi8jbzua -->
- [ ] systemd، nginx و گواهی برای agent.roditeam.ir، پشتیبان روزانهٔ دیتابیس، snapshot کانتینر و سند استقرار (R16–R17) <!-- rodo:ckl_cmvu8ns7l036jmk01q5016fwr -->
- [ ] آزمون دستی سناریوی «لپ‌تاپ خاموش» از simple.md روی سرور <!-- rodo:ckl_cmvu8ns82036lmk015qxm8zs6 -->
