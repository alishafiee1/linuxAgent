import type { Bot, BrowserInput, BrowserStatus } from "@linux-agent/shared";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { HttpError, type BotService } from "../bots.js";
import type { McpStdioServer } from "../engine/types.js";
import type { VaultService } from "../vault.js";

export const MAX_BROWSERS = 2;
export const IDLE_MS = 15 * 60_000;
const VIEWPORT = { width: 1280, height: 800 };

const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Tab: { code: "Tab", vk: 9 },
  Backspace: { code: "Backspace", vk: 8 },
  Escape: { code: "Escape", vk: 27 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
};

export interface BrowserDeps {
  bots: BotService;
  vault: VaultService;
  agentHome: string;
  agentExec: string[];
  chromium: string;
  fetchFn?: typeof fetch;
}

interface Target {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

/** The Playwright MCP entry file. It runs as `agent`, so it has to stay world-readable under /opt/cwp. */
function playwrightMcpCli(): string | null {
  try {
    return join(dirname(createRequire(import.meta.url).resolve("@playwright/mcp/package.json")), "cli.js");
  } catch {
    return null;
  }
}

/**
 * Spec 003: each bot has its own Chromium profile, driven over the DevTools port on localhost.
 * It starts on demand, at most two at a time, and closes when idle. It runs as `agent`, so the panel
 * cannot signal it across sudo; it is closed with the browser's own close command instead.
 */
export class BrowserService {
  private lastUse = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private fetchFn: typeof fetch;

  constructor(private d: BrowserDeps) {
    this.fetchFn = d.fetchFn ?? fetch;
  }

  /** Stable per bot, so the MCP address is known before the browser exists. */
  port(bot: Bot): number {
    return 9300 + createHash("sha256").update(bot.id).digest().readUInt16BE(0) % 600;
  }

  mcpServers(bot: Bot): Record<string, McpStdioServer> {
    const cli = playwrightMcpCli();
    if (!bot.browser || !cli) return {};
    return { browser: { type: "stdio", command: process.execPath, args: [cli, "--cdp-endpoint", `http://127.0.0.1:${this.port(bot)}`] } };
  }

  private async alive(port: number): Promise<boolean> {
    try {
      const r = await this.fetchFn(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  private async targets(bot: Bot): Promise<Target[]> {
    const r = await this.fetchFn(`http://127.0.0.1:${this.port(bot)}/json/list`, { signal: AbortSignal.timeout(5000) });
    return ((await r.json()) as Target[]).filter((t) => t.type === "page");
  }

  async status(botId: string): Promise<BrowserStatus> {
    const bot = this.d.bots.get(botId);
    if (!(await this.alive(this.port(bot)))) return { botId, running: false, url: null, title: null };
    const page = (await this.targets(bot).catch(() => []))[0];
    return { botId, running: true, url: page?.url ?? null, title: page?.title ?? null };
  }

  async open(botId: string): Promise<BrowserStatus> {
    const bot = this.d.bots.get(botId);
    const port = this.port(bot);
    this.lastUse.set(bot.id, Date.now());
    if (await this.alive(port)) return this.status(botId);
    let running = 0;
    for (const b of this.d.bots.list()) if (b.id !== bot.id && (await this.alive(this.port(b)))) running++;
    if (running >= MAX_BROWSERS) throw new HttpError(409, "too_many_browsers", `حداکثر ${MAX_BROWSERS} مرورگر هم‌زمان باز می‌شود؛ اول یکی را ببندید.`);
    const args = [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${join(this.d.agentHome, "browser", bot.slug)}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ];
    const [bin, ...pre] = this.d.agentExec.length ? [...this.d.agentExec, "env", this.d.chromium] : [this.d.chromium];
    const child = spawn(bin!, [...pre, ...args], { stdio: "ignore", detached: true });
    child.on("error", (e) => console.error(`[cwp] chromium: ${e.message}`));
    child.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await this.alive(port)) return this.status(botId);
    }
    throw new HttpError(502, "browser_failed", "مرورگر باز نشد.");
  }

  async close(botId: string): Promise<void> {
    const bot = this.d.bots.get(botId);
    const port = this.port(bot);
    this.lastUse.delete(bot.id);
    if (!(await this.alive(port))) return;
    const version = (await (await this.fetchFn(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
    await cdp(version.webSocketDebuggerUrl, [{ method: "Browser.close" }]).catch(() => {});
  }

  /** One short-lived DevTools connection per action: the panel keeps no socket open between polls. */
  private async page(botId: string, calls: { method: string; params?: unknown }[]): Promise<unknown[]> {
    const bot = this.d.bots.get(botId);
    this.lastUse.set(bot.id, Date.now());
    if (!(await this.alive(this.port(bot)))) throw new HttpError(409, "browser_closed", "مرورگر این بات بسته است.");
    const target = (await this.targets(bot))[0];
    if (!target) throw new HttpError(409, "no_page", "صفحه‌ای باز نیست.");
    return cdp(target.webSocketDebuggerUrl, calls);
  }

  async screenshot(botId: string): Promise<Buffer> {
    const [r] = (await this.page(botId, [{ method: "Page.captureScreenshot", params: { format: "jpeg", quality: 60 } }])) as [{ data: string }];
    return Buffer.from(r.data, "base64");
  }

  /** Coordinates are in page pixels of the screenshot. */
  async input(botId: string, i: BrowserInput): Promise<void> {
    switch (i.type) {
      case "click": {
        const base = { x: i.x, y: i.y, button: "left", clickCount: 1 };
        await this.page(botId, [
          // Without this a headless page ignores the focus change of its first click.
          { method: "Page.bringToFront" },
          { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: i.x, y: i.y } },
          { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", ...base } },
          { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", ...base } },
        ]);
        return;
      }
      case "scroll":
        await this.page(botId, [{ method: "Input.dispatchMouseEvent", params: { type: "mouseWheel", x: i.x, y: i.y, deltaX: 0, deltaY: i.deltaY } }]);
        return;
      case "text":
        await this.page(botId, [{ method: "Input.insertText", params: { text: i.text } }]);
        return;
      case "key": {
        const k = KEYS[i.key];
        if (!k) throw new HttpError(400, "bad_key", "این کلید پشتیبانی نمی‌شود.");
        const base = { key: i.key, code: k.code, windowsVirtualKeyCode: k.vk };
        await this.page(botId, [
          { method: "Input.dispatchKeyEvent", params: { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text } : {}) } },
          { method: "Input.dispatchKeyEvent", params: { type: "keyUp", ...base } },
        ]);
        return;
      }
      case "navigate": {
        if (!/^https?:\/\//i.test(i.url)) throw new HttpError(400, "bad_url", "آدرس باید با http یا https شروع شود.");
        await this.page(botId, [{ method: "Page.navigate", params: { url: i.url } }]);
        return;
      }
    }
  }

  /**
   * Types a vault value into the focused field of the live page. Only the person's own panel session
   * reaches this: there is no bot tool for it. The value is never logged or stored as a run event.
   */
  async fillFromVault(botId: string, itemId: string, field: "username" | "password"): Promise<void> {
    const status = await this.status(botId);
    if (!status.running) throw new HttpError(409, "browser_closed", "مرورگر این بات بسته است.");
    const value = this.d.vault.reveal(itemId, field, status.url);
    const [focus] = (await this.page(botId, [{ method: "Runtime.evaluate", params: { expression: "(document.activeElement && document.activeElement.tagName + ':' + (document.activeElement.type || ''))", returnByValue: true } }])) as [{ result: { value?: string } }];
    const active = focus.result.value ?? "";
    // A password only goes into a masked field, where a bot's page reading does not show it as text.
    const allowed = field === "password" ? /^INPUT:password$/ : /^(INPUT|TEXTAREA):/;
    if (!allowed.test(active)) throw new HttpError(409, "no_field", field === "password" ? "اول روی فیلد رمز کلیک کنید." : "اول روی فیلد نام کاربری کلیک کنید.");
    await this.page(botId, [{ method: "Input.insertText", params: { text: value } }]);
  }

  start(): void {
    this.timer = setInterval(() => {
      const cutoff = Date.now() - IDLE_MS;
      for (const [botId, at] of this.lastUse) if (at < cutoff) void this.close(botId).catch(() => {});
    }, 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Runs DevTools commands in order over one WebSocket and returns their results. */
export function cdp(url: string, calls: { method: string; params?: unknown }[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const results: unknown[] = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new HttpError(504, "browser_timeout", "مرورگر جواب نداد."));
    }, 20_000);
    const finish = (err?: Error): void => {
      clearTimeout(timer);
      ws.close();
      if (err) reject(err);
      else resolve(results);
    };
    const send = (i: number): void => {
      ws.send(JSON.stringify({ id: i + 1, method: calls[i]!.method, params: calls[i]!.params ?? {} }));
    };
    ws.onopen = () => send(0);
    ws.onerror = () => finish(new HttpError(502, "browser_error", "اتصال به مرورگر ناموفق بود."));
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id === undefined) return;
      if (msg.error) return finish(new HttpError(502, "browser_error", msg.error.message));
      results.push(msg.result);
      if (results.length === calls.length) finish();
      else send(results.length);
    };
  });
}
