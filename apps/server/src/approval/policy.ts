import { isAbsolute, normalize, resolve } from "node:path";

// Spec R10: what runs without a human. Everything not auto-allowed here needs an approval.

const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "Task",
  "Agent",
  "NotebookRead",
  "BashOutput",
  "ToolSearch",
]);

const FILE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Bash commands matching any of these need approval. Each has a short Persian label shown to the user. */
export const BASH_APPROVAL_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\brm\s+(-[a-zA-Z]*[rRf][a-zA-Z]*\b|--recursive|--force)/, label: "پاک کردن با rm -r/-f" },
  { re: /\bgit\s+push\b/, label: "git push" },
  { re: /\bgit\s+reset\s+--hard\b/, label: "git reset --hard" },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, label: "git clean -f" },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, label: "اجرای اسکریپت دانلودی" },
  { re: /(^|[;&|]\s*|\s)(sudo|su|doas)\s/, label: "sudo/su" },
  { re: /\b(apt|apt-get|dpkg|snap)\b/, label: "نصب یا حذف بسته" },
  { re: /\b(npm|pnpm|yarn)\s+publish\b/, label: "انتشار بسته" },
  { re: /\b(ssh|scp|sftp)\b/, label: "اتصال به سرور دیگر" },
  { re: /\brsync\b.*\S+@\S+:/, label: "rsync به سرور دیگر" },
  { re: /\b(systemctl|service|journalctl\s+--vacuum)\b/, label: "مدیریت سرویس‌ها" },
  { re: /\b(shutdown|reboot|poweroff|halt)\b/, label: "خاموش یا ری‌استارت" },
  { re: /\b(mkfs|fdisk|parted|dd)\b/, label: "کار با دیسک" },
  { re: /\bcrontab\b/, label: "تغییر cron" },
  { re: /\b(iptables|nft|ip\s+route|ip\s+rule|sing-box)\b/, label: "تغییر شبکه" },
  { re: /\b(incus|lxc|docker|podman)\b/, label: "کانتینرها" },
  { re: /\bkill(all)?\s+-9\b/, label: "kill -9" },
  { re: /\bchmod\s+-R\b|\bchown\b/, label: "تغییر دسترسی فایل‌ها" },
];

// Panel tools. Anything not listed here asks first, including tools added later.
const PANEL_AUTO = new Set([
  "delegate_to_bot",
  "send_message_to_bot",
  "ask_user",
  "request_connection",
  "request_browser_takeover",
  "list_connections",
  "open_browser",
  "update_page",
  "gmail_search",
  "gmail_read",
  "calendar_list",
  "github_list_issues",
  "github_list_pulls",
  "desktop_devices",
]);

const PANEL_REASONS: Record<string, string> = {
  publish_page: "انتشار صفحهٔ عمومی",
  gmail_send: "ارسال ایمیل",
  calendar_create: "ساخت رویداد در تقویم",
  github_create_issue: "ساخت issue در GitHub",
  github_comment: "نوشتن نظر در GitHub",
  desktop_list: "دیدن پوشه روی کامپیوتر شخصی",
  desktop_read: "خواندن فایل از کامپیوتر شخصی",
  desktop_write: "نوشتن فایل روی کامپیوتر شخصی",
  desktop_run: "اجرای دستور روی کامپیوتر شخصی",
};

// Looking at a page is safe; a click or typed text can submit a form, so those follow the setting.
const BROWSER_READ = new Set([
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_wait_for",
  "browser_tabs",
  "browser_console_messages",
  "browser_network_requests",
  "browser_resize",
  "browser_close",
]);
const BROWSER_INTERACT = new Set(["browser_click", "browser_type", "browser_hover", "browser_press_key", "browser_select_option", "browser_fill_form", "browser_drag", "browser_handle_dialog"]);

export interface PolicyOptions {
  browserClicksAuto?: boolean;
}

export type PolicyResult = { auto: true } | { auto: false; reason: string };

function insideAllowedRoot(path: string, roots: string[]): boolean {
  if (!isAbsolute(path)) return false;
  const p = normalize(resolve(path));
  return roots.some((root) => p === root || p.startsWith(root.endsWith("/") ? root : `${root}/`));
}

/** Writes in the shell that target an absolute path outside the allowed roots: `> /x`, `>> /x`, `tee /x`, `cp/mv ... /x`. */
function bashWritesOutside(command: string, roots: string[]): string | null {
  const targets: string[] = [];
  for (const m of command.matchAll(/(?:>>?|\btee\s+(?:-a\s+)?)\s*("?)(\/[^\s"';|&]+)\1/g)) if (m[2]) targets.push(m[2]);
  for (const m of command.matchAll(/\b(?:cp|mv|install|ln)\s+(?:-\S+\s+)*\S+\s+(\/[^\s;|&]+)/g)) if (m[1]) targets.push(m[1]);
  const writable = [...roots, "/tmp", "/dev/null", "/dev/stdout", "/dev/stderr"];
  return targets.find((t) => !insideAllowedRoot(t, writable)) ?? null;
}

export function evaluateTool(toolName: string, input: Record<string, unknown>, agentHome: string, opts: PolicyOptions = {}): PolicyResult {
  if (READ_ONLY_TOOLS.has(toolName)) return { auto: true };

  if (FILE_WRITE_TOOLS.has(toolName)) {
    const path = String(input.file_path ?? input.notebook_path ?? "");
    if (insideAllowedRoot(path, [agentHome])) return { auto: true };
    return { auto: false, reason: `نوشتن بیرون از ${agentHome}: ${path || "?"}` };
  }

  if (toolName === "Bash") {
    const command = String(input.command ?? "");
    const hit = BASH_APPROVAL_PATTERNS.find((p) => p.re.test(command));
    if (hit) return { auto: false, reason: hit.label };
    const outside = bashWritesOutside(command, [agentHome]);
    if (outside) return { auto: false, reason: `نوشتن بیرون از ${agentHome}: ${outside}` };
    return { auto: true };
  }

  if (toolName.startsWith("mcp__cwp__")) {
    const name = toolName.slice("mcp__cwp__".length);
    if (name === "call_api") {
      const method = String(input.method ?? "GET").toUpperCase();
      if (method === "GET" || method === "HEAD") return { auto: true };
      return { auto: false, reason: `تغییر در ${String(input.connection ?? "سرویس بیرونی")}: ${method} ${String(input.path ?? "")}` };
    }
    return PANEL_AUTO.has(name) ? { auto: true } : { auto: false, reason: PANEL_REASONS[name] ?? `ابزار ${name}` };
  }

  if (toolName.startsWith("mcp__browser__")) {
    const name = toolName.slice("mcp__browser__".length);
    if (BROWSER_READ.has(name)) return { auto: true };
    if (BROWSER_INTERACT.has(name)) return opts.browserClicksAuto ? { auto: true } : { auto: false, reason: "کلیک یا تایپ در مرورگر" };
    return { auto: false, reason: `ابزار مرورگر: ${name}` };
  }

  if (toolName.startsWith("mcp__")) return { auto: false, reason: "ابزار سرویس بیرونی (MCP)" };
  return { auto: false, reason: `ابزار ${toolName}` };
}
