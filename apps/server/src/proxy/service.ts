import type { ProxyConnection, ProxyNode, ProxyStatus } from "@linux-agent/shared";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { HttpError } from "../bots.js";
import type { SettingsStore } from "../settings.js";
import { buildSingBoxConfig, LinkError, parseLink, parseSubscription, type ParsedLink } from "./links.js";

export const MSG_NOT_ALLOWED_BY_KILLSWITCH =
  "این سرور پروکسی در kill switch میزبان مجاز نیست؛ اول روی میزبان deploy/proxy/allow-proxy.sh را اجرا کنید.";
export const POLL_MS = 15_000;
/** A slow proxy misses single probes, so only this many misses in a row count as disconnected. */
export const MAX_PROBE_MISSES = 3;
export const MAX_SAVED_LINKS = 20;
export const FAILOVER_COOLDOWN_MS = 10 * 60_000;
export const FAILOVER_WAIT_MS = 8_000;
/** While healthy the subscription is refreshed this often, because it cannot be fetched during an outage. */
export const SYNC_EVERY_MS = 6 * 3_600_000;
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
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
}

interface SavedLink {
  id: string;
  name: string;
  link: string;
  addedAt: string;
  /** Set on links that came from the subscription; only those are pruned by a sync. */
  source?: "subscription";
}

/** The part of a link that identifies the server. The remark after # changes (usage figures), so it is left out. */
const linkKey = (l: string): string => l.trim().split("#")[0]!;

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
  private status: ProxyStatus = {
    state: "unknown",
    reason: null,
    latencyMs: null,
    current: null,
    subscriptionUrlSet: false,
    connectionCount: 0,
    failover: { enabled: false, lastAt: null, lastResult: null },
    subscriptionSync: { lastAt: null, lastResult: null },
    checkedAt: new Date(0).toISOString(),
  };
  private syncLast: { at: number | null; result: string | null } = { at: null, result: null };
  private syncing = false;
  private failoverLast: { at: number | null; result: string | null } = { at: null, result: null };
  private failing = false;
  private timer: NodeJS.Timeout | null = null;
  private listeners: ((s: ProxyStatus) => void)[] = [];
  private fetchFn: typeof fetch;
  private probeMisses = 0;

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
    return {
      ...this.status,
      current,
      subscriptionUrlSet: this.d.settings.get("proxy.subscription.secret") !== null,
      connectionCount: this.readSaved().length,
      failover: {
        enabled: this.failoverEnabled(),
        lastAt: this.failoverLast.at === null ? null : new Date(this.failoverLast.at).toISOString(),
        lastResult: this.failoverLast.result,
      },
      subscriptionSync: {
        lastAt: this.syncLast.at === null ? null : new Date(this.syncLast.at).toISOString(),
        lastResult: this.syncLast.result,
      },
    };
  }

  private now(): number {
    return (this.d.nowMs ?? Date.now)();
  }

  private pause(ms: number): Promise<void> {
    return (this.d.sleep ?? ((m: number) => new Promise<void>((r) => setTimeout(r, m))))(ms);
  }

  // --- saved connections (spec R1 to R6)

  private readSaved(): SavedLink[] {
    const raw = this.d.settings.get("proxy.links.secret");
    if (!raw) return [];
    try {
      const list = JSON.parse(raw) as SavedLink[];
      return Array.isArray(list) ? list.filter((s) => s && typeof s.link === "string") : [];
    } catch {
      return [];
    }
  }

  private writeSaved(list: SavedLink[]): void {
    this.d.settings.set("proxy.links.secret", list.length ? JSON.stringify(list) : null);
  }

  /** The link in use is always in the list, even when it was set before the list existed. */
  private syncActive(): SavedLink[] {
    const list = this.readSaved();
    const active = this.d.settings.get("proxy.link.secret")?.trim();
    if (active && !list.some((s) => s.link === active) && list.length < MAX_SAVED_LINKS) {
      try {
        const p = parseLink(active);
        list.push({ id: randomUUID(), name: (p.remark || p.host).slice(0, 60), link: active, addedAt: new Date(this.now()).toISOString() });
        this.writeSaved(list);
      } catch {
        // an unreadable active link stays out of the list
      }
    }
    return list;
  }

  async listConnections(): Promise<ProxyConnection[]> {
    const list = this.syncActive();
    const active = this.d.settings.get("proxy.link.secret")?.trim();
    const out: ProxyConnection[] = [];
    for (const s of list) {
      let p: ParsedLink;
      try {
        p = parseLink(s.link);
      } catch {
        continue;
      }
      const ip = await this.resolveHost(p.host).catch(() => null);
      out.push({ id: s.id, name: s.name, scheme: p.scheme, host: p.host, port: p.port, remark: p.remark, ip, active: s.link === active, fromSubscription: s.source === "subscription", addedAt: s.addedAt });
    }
    return out;
  }

  async addConnection(raw: string, name?: string): Promise<ProxyConnection[]> {
    let p: ParsedLink;
    try {
      p = parseLink(raw);
    } catch (e) {
      throw new HttpError(400, "bad_link", e instanceof LinkError ? `لینک نامعتبر است: ${e.message}` : "لینک نامعتبر است.");
    }
    const link = raw.trim();
    const list = this.syncActive();
    if (list.some((s) => s.link === link)) throw new HttpError(409, "duplicate", "این لینک قبلاً ذخیره شده است.");
    if (list.length >= MAX_SAVED_LINKS) throw new HttpError(409, "too_many", `بیشتر از ${MAX_SAVED_LINKS} اتصال ذخیره نمی‌شود.`);
    list.push({ id: randomUUID(), name: (name?.trim() || p.remark || p.host).slice(0, 60), link, addedAt: new Date(this.now()).toISOString() });
    this.writeSaved(list);
    return this.listConnections();
  }

  async renameConnection(id: string, name: string): Promise<ProxyConnection[]> {
    const list = this.syncActive();
    const item = list.find((s) => s.id === id);
    if (!item) throw new HttpError(404, "no_connection", "این اتصال پیدا نشد.");
    const clean = name.trim();
    if (!clean) throw new HttpError(400, "bad_name", "نام نباید خالی باشد.");
    item.name = clean.slice(0, 60);
    this.writeSaved(list);
    return this.listConnections();
  }

  async removeConnection(id: string): Promise<ProxyConnection[]> {
    const list = this.syncActive();
    const item = list.find((s) => s.id === id);
    if (!item) throw new HttpError(404, "no_connection", "این اتصال پیدا نشد.");
    if (item.link === this.d.settings.get("proxy.link.secret")?.trim())
      throw new HttpError(409, "active", "اتصال فعال را نمی‌شود حذف کرد؛ اول یکی دیگر را فعال کنید.");
    this.writeSaved(list.filter((s) => s.id !== id));
    return this.listConnections();
  }

  async activateConnection(id: string): Promise<ProxyStatus> {
    const item = this.syncActive().find((s) => s.id === id);
    if (!item) throw new HttpError(404, "no_connection", "این اتصال پیدا نشد.");
    return this.applyLink(item.link);
  }

  // --- subscription sync (spec 024 R1 to R4)

  /** Adds the subscription's links to the saved list and drops the ones it no longer has (never hand-added or active ones). */
  async syncSubscription(): Promise<ProxyConnection[]> {
    if (!this.d.settings.get("proxy.subscription.secret")) throw new HttpError(400, "no_subscription", "آدرس سابسکریپشن تنظیم نشده است.");
    this.syncLast.at = this.now();
    const fresh: { raw: string; p: ParsedLink }[] = [];
    try {
      const { raw } = await this.subscriptionLinks();
      for (const l of raw) {
        try {
          fresh.push({ raw: l.trim(), p: parseLink(l.trim()) });
        } catch {
          // a line that is not a usable link
        }
      }
      if (fresh.length === 0) throw new HttpError(502, "subscription_empty", "در سابسکریپشن اتصال قابل استفاده‌ای نبود.");
    } catch (e) {
      this.syncLast.result = "failed";
      throw e;
    }
    const active = this.d.settings.get("proxy.link.secret")?.trim();
    const keys = new Set(fresh.map((f) => linkKey(f.raw)));
    const before = this.syncActive();
    const next = before.filter((s) => s.source !== "subscription" || keys.has(linkKey(s.link)) || s.link === active);
    const removed = before.length - next.length;
    for (const s of next) {
      const f = s.source === "subscription" && s.link !== active ? fresh.find((x) => linkKey(x.raw) === linkKey(s.link)) : undefined;
      if (f) s.link = f.raw;
    }
    let added = 0;
    for (const f of fresh) {
      if (next.some((s) => linkKey(s.link) === linkKey(f.raw))) continue;
      if (next.length >= MAX_SAVED_LINKS) break;
      next.push({ id: randomUUID(), name: (f.p.remark || f.p.host).slice(0, 60), link: f.raw, addedAt: new Date(this.now()).toISOString(), source: "subscription" });
      added++;
    }
    this.writeSaved(next);
    this.syncLast.result = `ok:${added}:${removed}`;
    return this.listConnections();
  }

  private syncIsDue(): boolean {
    return this.syncLast.at === null || this.now() - this.syncLast.at > SYNC_EVERY_MS;
  }

  // --- failover (spec R8)

  failoverEnabled(): boolean {
    return this.d.settings.get("proxy.failover") === "1";
  }

  setFailover(enabled: boolean): ProxyStatus {
    this.d.settings.set("proxy.failover", enabled ? "1" : null);
    return this.current();
  }

  private async probeOnce(): Promise<boolean> {
    try {
      const { proxies } = await this.clash<{ proxies: Record<string, { type: string }> }>("/proxies");
      const name = Object.keys(proxies).find((k) => PROXY_TYPES.has(proxies[k]!.type));
      if (!name) return false;
      await this.clash(`/proxies/${encodeURIComponent(name)}/delay?timeout=10000&url=${encodeURIComponent("https://www.gstatic.com/generate_204")}`);
      return true;
    } catch {
      return false;
    }
  }

  /** Tries every other saved link in order and stops at the first that answers. A link the kill switch does not allow is skipped. */
  async failover(): Promise<void> {
    if (this.failing) return;
    this.failing = true;
    this.failoverLast.at = this.now();
    let result = "no_other_connection";
    try {
      // The subscription may have a newer address. It often cannot be reached while the proxy is down, and that is fine.
      if (this.d.settings.get("proxy.subscription.secret")) await this.syncSubscription().catch(() => {});
      const active = this.d.settings.get("proxy.link.secret")?.trim();
      const others = this.syncActive().filter((s) => s.link !== active);
      if (others.length) result = "none_worked";
      for (const s of others) {
        try {
          await this.applyLink(s.link);
        } catch {
          continue;
        }
        await this.pause(FAILOVER_WAIT_MS);
        if (await this.probeOnce()) {
          result = `switched:${s.name}`;
          this.probeMisses = 0;
          break;
        }
      }
    } finally {
      this.failoverLast.result = result;
      this.failing = false;
    }
    await this.check();
    for (const l of this.listeners) l(this.current());
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
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`clash ${res.status}`);
    return (await res.json()) as T;
  }

  /** Spec R20: connected (with latency), disconnected, or connecting. */
  async check(): Promise<ProxyStatus> {
    const prev = this.status.state;
    let state: ProxyStatus["state"];
    let latencyMs: number | null = null;
    let reason: ProxyStatus["reason"] = null;
    try {
      const { proxies } = await this.clash<{ proxies: Record<string, { type: string }> }>("/proxies");
      const name = Object.keys(proxies).find((k) => PROXY_TYPES.has(proxies[k]!.type));
      if (!name) throw new Error("no proxy outbound");
      try {
        const r = await this.clash<{ delay: number }>(`/proxies/${encodeURIComponent(name)}/delay?timeout=10000&url=${encodeURIComponent("https://www.gstatic.com/generate_204")}`);
        state = "connected";
        latencyMs = r.delay;
        this.probeMisses = 0;
      } catch {
        this.probeMisses++;
        state = this.probeMisses >= MAX_PROBE_MISSES ? "disconnected" : prev;
        latencyMs = this.status.latencyMs;
        reason = "server_unreachable";
      }
    } catch {
      // sing-box itself is not answering: restarting (connecting) or down.
      state = prev === "connected" || prev === "connecting" ? "connecting" : "disconnected";
      if (this.status.state === "unknown") state = "unknown";
      reason = "engine_down";
    }
    this.status = { ...this.status, state, reason, latencyMs, checkedAt: new Date().toISOString() };
    if (state !== prev) for (const l of this.listeners) l(this.current());
    if (state === "connected" && this.failoverEnabled() && this.d.settings.get("proxy.subscription.secret") && this.syncIsDue() && !this.syncing) {
      this.syncing = true;
      void this.syncSubscription()
        .catch(() => {})
        .finally(() => (this.syncing = false));
    }
    const due = this.failoverLast.at === null || this.now() - this.failoverLast.at > FAILOVER_COOLDOWN_MS;
    if (state === "disconnected" && reason === "server_unreachable" && this.failoverEnabled() && due && !this.failing) void this.failover();
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
    this.syncActive();
    this.status = { ...this.status, state: "connecting", reason: null };
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
