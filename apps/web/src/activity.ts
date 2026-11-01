import type { RunEvent } from "@linux-agent/shared";
import type { Dict } from "./i18n";

const baseName = (p: unknown): string => String(p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";

type Input = Record<string, unknown>;

/** Says what a tool is doing in plain words. Unknown tools still get their name. */
function describe(name: string, input: Input, t: Dict): string {
  const short = name.replace(/^mcp__[a-z]+__/, "");
  const a = t.activity;
  switch (short) {
    case "Read":
    case "NotebookRead":
      return `${a.reading} ${baseName(input.file_path ?? input.notebook_path)}`.trim();
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `${a.writing} ${baseName(input.file_path ?? input.notebook_path)}`.trim();
    case "Grep":
    case "Glob":
    case "LS":
      return a.searchingFiles;
    case "Bash":
      return input.description ? `${a.running}: ${String(input.description)}` : a.running;
    case "WebSearch":
      return input.query ? `${a.searchingWeb}: ${String(input.query)}` : a.searchingWeb;
    case "WebFetch":
      return a.readingWeb;
    case "Task":
    case "Agent":
      return a.helper;
    case "TodoWrite":
      return a.planning;
    case "ToolSearch":
      return a.preparing;
    case "delegate_to_bot":
      return `${a.waitingBot} ${String(input.bot ?? "")}`.trim();
    case "send_message_to_bot":
      return `${a.messaging} ${String(input.bot ?? "")}`.trim();
    case "call_api":
      return `${a.callingService} ${String(input.connection ?? "")}`.trim();
    case "send_file":
      return `${a.sendingFile} ${baseName(input.path)}`.trim();
    case "publish_page":
    case "update_page":
      return a.publishing;
    default:
      if (short.startsWith("browser_") || short === "open_browser") return a.browsing;
      if (short.startsWith("gmail_")) return a.email;
      if (short.startsWith("calendar_")) return a.calendar;
      if (short.startsWith("github_")) return a.github;
      if (short.startsWith("desktop_")) return a.desktop;
      return `${a.usingTool} ${short}`;
  }
}

/**
 * What the bot is doing right now, read from the run's events. The engine reports whole steps, not
 * each word, so between steps the honest answer is that the model is thinking.
 */
export function currentActivity(events: RunEvent[], t: Dict): { text: string; steps: number } {
  const done = new Set<string>();
  let steps = 0;
  let open: { name: string; input: Input } | null = null;
  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    if (e.type === "tool_result") done.add(String(p.toolUseId));
    if (e.type === "tool_use") steps++;
  }
  for (const e of events) {
    if (e.type !== "tool_use") continue;
    const p = e.payload as { id: string; name: string; input: Input };
    if (!done.has(p.id)) open = { name: p.name, input: p.input ?? {} };
  }
  return { text: open ? describe(open.name, open.input, t) : t.activity.thinking, steps };
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number): string => String(n).padStart(2, "0");
  return h ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
