import type { PublicSettings, SettingsInput, UiLanguage } from "@linux-agent/shared";
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

  publicView(): PublicSettings {
    const lang = this.get("uiLanguage");
    return {
      defaultModel: this.defaultModel(),
      maxConcurrentRuns: this.maxConcurrentRuns(),
      uiLanguage: (lang === "en" ? "en" : "fa") satisfies UiLanguage,
      bale: { configured: this.channel("bale") !== null, chatId: this.get("bale.chatId") },
      telegram: { configured: this.channel("telegram") !== null, chatId: this.get("telegram.chatId") },
    };
  }

  apply(input: SettingsInput): void {
    if (input.defaultModel !== undefined) this.set("defaultModel", input.defaultModel.trim() || null);
    if (input.maxConcurrentRuns !== undefined) this.set("maxConcurrentRuns", String(input.maxConcurrentRuns));
    if (input.uiLanguage !== undefined) this.set("uiLanguage", input.uiLanguage);
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
