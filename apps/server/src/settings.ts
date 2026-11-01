import type { PlanLimit, PublicSettings, SettingsInput, UiLanguage } from "@linux-agent/shared";
import type { Db } from "./db.js";
import { decrypt, encrypt } from "./lib/crypto.js";

// Newest model Claude Code 2.1.112 may use; that version is pinned because the server CPU has no AVX.
export const DEFAULT_MODEL = "claude-opus-4-8";
export const DEFAULT_MAX_CONCURRENT_RUNS = 3;

/** Key/value settings. Keys ending in `.secret` are stored encrypted and never leave the server. */
export class SettingsStore {
  constructor(
    private db: Db,
    private masterKey: Buffer,
  ) {}

  get(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return null;
    return key.endsWith(".secret") ? decrypt(this.masterKey, row.value) : row.value;
  }

  set(key: string, value: string | null): void {
    if (value === null) {
      this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
      return;
    }
    const stored = key.endsWith(".secret") ? encrypt(this.masterKey, value) : value;
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, stored);
  }

  defaultModel(): string {
    return this.get("defaultModel") ?? DEFAULT_MODEL;
  }

  maxConcurrentRuns(): number {
    const n = Number(this.get("maxConcurrentRuns"));
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_CONCURRENT_RUNS;
  }

  channel(name: "bale" | "telegram"): { token: string; chatId: string } | null {
    const token = this.get(`${name}.token.secret`);
    const chatId = this.get(`${name}.chatId`);
    return token && chatId ? { token, chatId } : null;
  }

  /** Off by default: every click or typed text in a bot's browser asks first, because a click can submit a form. */
  browserClicksAuto(): boolean {
    return this.get("browserClicksAuto") === "1";
  }

  /** On unless turned off: a small nightly job keeps shared memory current. */
  learningEnabled(): boolean {
    return this.get("learningEnabled") !== "0";
  }

  keys(prefix: string): string[] {
    return (this.db.prepare("SELECT key FROM settings WHERE key LIKE ? ESCAPE '\\'").all(`${prefix.replace(/[\\%_]/g, "\\$&")}%`) as { key: string }[]).map((r) => r.key);
  }

  /** Keeps the engine's last word on each subscription limit, so the usage page can show it between runs. */
  savePlanLimit(ev: { status: PlanLimit["status"]; resetsAt: number | null; limitType?: string; utilization?: number | null }): void {
    if (!ev.limitType) return;
    const limit: PlanLimit = { type: ev.limitType, status: ev.status, utilization: ev.utilization ?? null, resetsAt: ev.resetsAt === null ? null : new Date(ev.resetsAt).toISOString(), reportedAt: new Date().toISOString() };
    this.set(`planLimit.${ev.limitType}`, JSON.stringify(limit));
  }

  /** A limit whose reset time has passed says nothing any more, so it is left out. */
  planLimits(nowMs = Date.now()): PlanLimit[] {
    return this.keys("planLimit.")
      .map((k) => JSON.parse(this.get(k)!) as PlanLimit)
      .filter((l) => !l.resetsAt || Date.parse(l.resetsAt) > nowMs)
      .sort((a, b) => a.type.localeCompare(b.type));
  }

  publicView(): PublicSettings {
    const lang = this.get("uiLanguage");
    return {
      defaultModel: this.defaultModel(),
      maxConcurrentRuns: this.maxConcurrentRuns(),
      uiLanguage: (lang === "en" ? "en" : "fa") satisfies UiLanguage,
      bale: { configured: this.channel("bale") !== null, chatId: this.get("bale.chatId") },
      telegram: { configured: this.channel("telegram") !== null, chatId: this.get("telegram.chatId") },
      browserClicksAuto: this.browserClicksAuto(),
      learningEnabled: this.learningEnabled(),
    };
  }

  apply(input: SettingsInput): void {
    if (input.defaultModel !== undefined) this.set("defaultModel", input.defaultModel.trim() || null);
    if (input.maxConcurrentRuns !== undefined) this.set("maxConcurrentRuns", String(input.maxConcurrentRuns));
    if (input.uiLanguage !== undefined) this.set("uiLanguage", input.uiLanguage);
    if (input.learningEnabled !== undefined) this.set("learningEnabled", input.learningEnabled ? "1" : "0");
    if (input.browserClicksAuto !== undefined) this.set("browserClicksAuto", input.browserClicksAuto ? "1" : "0");
    for (const name of ["bale", "telegram"] as const) {
      const ch = input[name];
      if (ch === undefined) continue;
      if (ch === null) {
        this.set(`${name}.token.secret`, null);
        this.set(`${name}.chatId`, null);
        continue;
      }
      if (ch.token !== undefined) this.set(`${name}.token.secret`, ch.token.trim() || null);
      if (ch.chatId !== undefined) this.set(`${name}.chatId`, ch.chatId.trim() || null);
    }
  }
}
