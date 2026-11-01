// Says in plain words what a tool is about to do, for approval cards and for Bale and Telegram.

const LIMIT = 700;
const cut = (s: string, n = LIMIT): string => (s.length > n ? `${s.slice(0, n)}…` : s);
/** Keeps a path or command in one piece inside right-to-left text. */
const ltr = (s: string): string => `⁦${s}⁩`;

function bodyLines(body: unknown): string[] {
  if (typeof body !== "string" || !body.trim()) return [];
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return Object.entries(parsed).map(([k, v]) => `${k}: ${cut(typeof v === "string" ? v : JSON.stringify(v), 400)}`);
  } catch {
    // not JSON: show it as text
  }
  return [cut(body)];
}

function genericLines(input: Record<string, unknown>): string[] {
  return Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${cut(typeof v === "string" ? v : JSON.stringify(v), 300)}`);
}

export function describeTool(toolName: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = toolName.replace(/^mcp__[a-z]+__/, "");
  switch (name) {
    case "Bash":
      return [i.description ? String(i.description) : "", "دستور:", ltr(cut(String(i.command ?? "")))].filter(Boolean).join("\n");
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `فایل: ${ltr(String(i.file_path ?? i.notebook_path ?? "?"))}`;
    case "call_api":
      return [`سرویس: ${String(i.connection ?? "?")}`, `درخواست: ${ltr(`${String(i.method ?? "GET")} ${String(i.path ?? "")}`)}`, ...bodyLines(i.body)].join("\n");
    case "gmail_send":
      return [`به: ${ltr(String(i.to ?? ""))}`, `موضوع: ${String(i.subject ?? "")}`, "", cut(String(i.body ?? ""))].join("\n");
    case "calendar_create":
      return [`رویداد: ${String(i.summary ?? "")}`, `از: ${ltr(String(i.start ?? ""))}`, `تا: ${ltr(String(i.end ?? ""))}`].join("\n");
    case "github_create_issue":
      return [`مخزن: ${ltr(String(i.repo ?? ""))}`, `عنوان: ${String(i.title ?? "")}`, "", cut(String(i.body ?? ""))].join("\n");
    case "github_comment":
      return [`مخزن: ${ltr(String(i.repo ?? ""))} #${String(i.number ?? "")}`, "", cut(String(i.body ?? ""))].join("\n");
    case "create_routine":
      return [`نام: ${String(i.name ?? "")}`, `زمان‌بندی: ${ltr(String(i.cron ?? ""))} (${ltr(String(i.timezone ?? "Asia/Tehran"))})`, `بات: ${String(i.bot ?? "همین بات")}`, `ارسال به: ${Array.isArray(i.deliver) ? i.deliver.join("، ") || "هیچ‌جا" : "بله و تلگرام"}`, "", "کار:", cut(String(i.prompt ?? ""))].join("\n");
    case "publish_page":
      return [`عنوان: ${String(i.title ?? "")}`, `نام: ${ltr(String(i.name ?? ""))}`, `حجم: ${String(i.html ?? "").length} نویسه`].join("\n");
    case "desktop_run":
      return [`دستگاه: ${String(i.device ?? "")}`, `پوشه: ${ltr(String(i.cwd ?? ""))}`, "دستور:", ltr(cut(String(i.command ?? "")))].join("\n");
    case "desktop_read":
    case "desktop_list":
      return [`دستگاه: ${String(i.device ?? "")}`, `مسیر: ${ltr(String(i.path ?? ""))}`].join("\n");
    case "desktop_write":
      return [`دستگاه: ${String(i.device ?? "")}`, `مسیر: ${ltr(String(i.path ?? ""))}`, "", cut(String(i.content ?? ""))].join("\n");
    default:
      return genericLines(i).join("\n");
  }
}
