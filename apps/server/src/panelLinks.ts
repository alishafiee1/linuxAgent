/** Pages of the panel a bot can send the person to. The path is what follows `#/` in the address. */
export const PANEL_PAGES: { path: string; name: string; what: string }[] = [
  { path: "chat", name: "چت", what: "گفت‌وگو با بات‌ها" },
  { path: "routines", name: "روتین‌ها", what: "کارهای زمان‌بندی‌شده" },
  { path: "connections", name: "اتصال‌ها", what: "وصل کردن سرویس‌ها و گذاشتن کلید" },
  { path: "knowledge", name: "حافظه", what: "حافظه و مهارت‌ها" },
  { path: "browser", name: "مرورگر", what: "مرورگر زنده و گاوصندوق رمزها" },
  { path: "pages", name: "صفحه‌ها", what: "گزارش‌های منتشرشده با لینک" },
  { path: "usage", name: "مصرف", what: "مصرف و سقف اشتراک" },
  { path: "files", name: "فایل‌ها", what: "فایل‌های بات‌ها" },
  { path: "settings", name: "تنظیمات", what: "اعلان‌ها، پروکسی و تنظیمات کلی" },
];

/** Extra system prompt lines: how a bot hands the person a clickable link to a panel page. */
export function panelLinksPrompt(): string {
  const list = PANEL_PAGES.map((p) => `- [${p.name}](#/${p.path}): ${p.what}`).join("\n");
  return [
    "When the person needs another page of this panel (to add a key, change a setting, see usage...), do not just name the page: give a clickable Markdown link written exactly like the ones below. It opens inside the panel.",
    list,
    "A chat with a bot can be linked as [text](#/chat/<bot id>/<conversation id>).",
  ].join("\n");
}
