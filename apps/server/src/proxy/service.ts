import type { ProxyNode, ProxyStatus } from "@linux-agent/shared";
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { HttpError } from "../bots.js";
import type { SettingsStore } from "../settings.js";
import { buildSingBoxConfig, LinkError, parseLink, parseSubscription, type ParsedLink } from "./links.js";

export const MSG_NOT_ALLOWED_BY_KILLSWITCH =
  "این سرور پروکسی در kill switch میزبان مجاز نیست؛ اول روی میزبان deploy/proxy/allow-proxy.sh را اجرا کنید.";
export const POLL_MS = 15_000;
const PROXY_TYPES = new Set(["VLESS", "VMess", "Trojan", "Shadowsocks", "vless", "vmess", "trojan", "shadowsocks"]);

export interface ProxyDeps {
  settings: SettingsStore;
  clashApiUrl: string;
  clashSecretPath: string;
  /** Root helper command; empty disables applying (dev). Exit 3 = server not allowed by the host kill switch. */
  applyCommand: string[];
  fetchFn?: typeof fetch;
  resolve?: (host: string) => Promise<string>;
  runHelper?: (cmd: string[], stdin: string) => Promise<{ code: number; stderr: string }>;
}

function runProcess(cmd: string[], stdin: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd;
    const child = spawn(bin!, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ code: 127, stderr: e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.stdin.end(stdin);
  });
}

function summary(l: ParsedLink): ProxyStatus["current"] {
  return { scheme: l.scheme, host: l.host, port: l.port, remark: l.remark };
}

export class ProxyService {
  private status: ProxyStatus = { state: "unknown", latencyMs: null, current: null, subscriptionUrlSet: false, checkedAt: new Date(0).toISOString() };
  private timer: NodeJS.Timeout | null = null;
  private listeners: ((s: ProxyStatus) => void)[] = [];
  private fetchFn: typeof fetch;

  constructor(private d: ProxyDeps) {
    this.fetchFn = d.fetchFn ?? fetch;
  }

  onChange(fn: (s: ProxyStatus) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** Unknown counts as up so a missing clash API (dev) never blocks runs. */
  isUp(): boolean {
    return this.status.state !== "disconnected";
  }

  current(): ProxyStatus {
    const link = this.d.settings.get("proxy.link.secret");
    let current: ProxyStatus["current"] = null;
    if (link) {
      try {
        current = summary(parseLink(link));
      } catch {
        current = null;
      }
    }
    return { ...this.status, current, subscriptionUrlSet: this.d.settings.get("proxy.subscription.secret") !== null };
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private secret(): string {
    try {
      return readFileSync(this.d.clashSecretPath, "utf8").trim();
    } catch {
      return "";
    }
  }

  private async clash<T>(path: string): Promise<T> {
    const secret = this.secret();
    const res = await this.fetchFn(`${this.d.clashApiUrl}${path}`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`clash ${res.status}`);
    return (await res.json()) as T;
  }

  /** Spec R20: connected (with latency), disconnected, or connecting. */
  async check(): Promise<ProxyStatus> {
    const prev = this.status.state;
    let state: ProxyStatus["state"];
    let latencyMs: number | null = null;
    try {
      const { proxies } = await this.clash<{ proxies: Record<string, { type: string }> }>("/proxies");
      const name = Object.keys(proxies).find((k) => PROXY_TYPES.has(proxies[k]!.type));
      if (!name) throw new Error("no proxy outbound");
      try {
        const r = await this.clash<{ delay: number }>(`/proxies/${encodeURIComponent(name)}/delay?timeout=5000&url=${encodeURIComponent("https://www.gstatic.com/generate_204")}`);
        state = "connected";
        latencyMs = r.delay;
      } catch {
        state = "disconnected";
      }
    } catch {
      // sing-box itself is not answering: restarting (connecting) or down.
      state = prev === "connected" || prev === "connecting" ? "connecting" : "disconnected";
      if (this.status.state === "unknown") state = "unknown";
    }
    this.status = { ...this.status, state, latencyMs, checkedAt: new Date().toISOString() };
    if (state !== prev) for (const l of this.listeners) l(this.current());
    return this.current();
  }

  private async resolveHost(host: string): Promise<string> {
    if (isIP(host)) return host;
    if (this.d.resolve) return this.d.resolve(host);
    return (await lookup(host, { family: 4 })).address;
  }

  /** Spec R19: validate, pin the server IP, hand the config to the root helper; on failure the old config stays. */
  async applyLink(raw: string): Promise<ProxyStatus> {
    let link: ParsedLink;
    try {
      link = parseLink(raw);
    } catch (e) {
      throw new HttpError(400, "bad_link", e instanceof LinkError ? `لینک نامعتبر است: ${e.message}` : "لینک نامعتبر است.");
    }
    if (this.d.applyCommand.length === 0) throw new HttpError(501, "apply_disabled", "اعمال پروکسی روی این سرور فعال نیست.");
    const ip = await this.resolveHost(link.host).catch(() => {
      throw new HttpError(400, "resolve_failed", `نام ${link.host} پیدا نشد.`);
    });
    const config = JSON.stringify(buildSingBoxConfig(link, ip), null, 2);
    const run = this.d.runHelper ?? runProcess;
    const r = await run([...this.d.applyCommand, ip, String(link.port)], config);
    if (r.code === 3) throw new HttpError(409, "not_allowed", MSG_NOT_ALLOWED_BY_KILLSWITCH);
    if (r.code !== 0) throw new HttpError(500, "apply_failed", `اعمال کانفیگ ناموفق بود: ${r.stderr.trim().slice(0, 300)}`);
    this.d.settings.set("proxy.link.secret", raw.trim());
    this.status = { ...this.status, state: "connecting" };
    for (const l of this.listeners) l(this.current());
    setTimeout(() => void this.check(), 3000).unref?.();
    return this.current();
  }

  setSubscription(url: string | null): void {
    if (url !== null && !/^https?:\/\//.test(url.trim())) throw new HttpError(400, "bad_url", "آدرس سابسکریپشن باید با http یا https شروع شود.");
    this.d.settings.set("proxy.subscription.secret", url?.trim() || null);
  }

  private async subscriptionLinks(): Promise<{ raw: string[]; parsed: ParsedLink[] }> {
    const url = this.d.settings.get("proxy.subscription.secret");
    if (!url) throw new HttpError(400, "no_subscription", "آدرس سابسکریپشن تنظیم نشده است.");
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(15_000) }).catch(() => {
      throw new HttpError(502, "subscription_fetch", "دریافت سابسکریپشن ناموفق بود.");
    });
    const body = await res.text();
    const text = body.includes("://") ? body : Buffer.from(body.trim(), "base64").toString("utf8");
    const raw = text.split(/\r?\n/).filter((l) => l.includes("://"));
    const parsed = parseSubscription(body);
    return { raw, parsed };
  }

  async subscriptionNodes(): Promise<ProxyNode[]> {
    const { parsed } = await this.subscriptionLinks();
    return parsed.map((l, index) => ({ index, scheme: l.scheme, host: l.host, port: l.port, remark: l.remark }));
  }

  async selectSubscriptionNode(index: number): Promise<ProxyStatus> {
    const { raw } = await this.subscriptionLinks();
    const ok = raw.filter((l) => {
      try {
        parseLink(l);
        return true;
      } catch {
        return false;
      }
    });
    const chosen = ok[index];
    if (!chosen) throw new HttpError(404, "no_node", "این گزینه در سابسکریپشن نیست.");
    return this.applyLink(chosen);
  }
}
