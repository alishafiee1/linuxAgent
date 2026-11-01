import type { BridgeCommand, BridgeDevice } from "@linux-agent/shared";
import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "./bots.js";
import type { Db } from "./db.js";
import { now } from "./db.js";
import { randomToken } from "./lib/crypto.js";

export const POLL_WAIT_MS = 25_000;
export const COMMAND_TIMEOUT_MS = 6 * 60_000;
const ONLINE_MS = 60_000;

interface Row {
  id: string;
  name: string;
  token_hash: string;
  folders: string;
  last_seen_at: string | null;
  created_at: string;
}

interface Pending {
  id: string;
  deviceId: string;
  command: BridgeCommand;
  resolve: (output: string) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  sent: boolean;
}

const hash = (t: string): string => createHash("sha256").update(t).digest("hex");

/**
 * Spec 006: the person's computer connects out to the panel and asks for work, so nothing on it is
 * exposed to the internet. The bridge itself enforces the folder list; the panel can only ask.
 */
export class BridgeService {
  private pending = new Map<string, Pending>();
  private waiters = new Map<string, () => void>();

  constructor(private db: Db) {}

  private view = (r: Row): BridgeDevice => ({
    id: r.id,
    name: r.name,
    folders: JSON.parse(r.folders) as string[],
    lastSeenAt: r.last_seen_at,
    online: r.last_seen_at !== null && Date.now() - Date.parse(r.last_seen_at) < ONLINE_MS,
    createdAt: r.created_at,
  });

  list(): BridgeDevice[] {
    return (this.db.prepare("SELECT * FROM bridge_devices ORDER BY created_at").all() as Row[]).map(this.view);
  }

  /** The token appears only in this answer. */
  create(name: string, folders: string[]): { device: BridgeDevice; token: string } {
    const clean = name.trim();
    if (!clean || clean.length > 60) throw new HttpError(400, "bad_name", "نام باید ۱ تا ۶۰ نویسه باشد.");
    if (!folders.length) throw new HttpError(400, "no_folders", "دست‌کم یک پوشه لازم است.");
    if (this.db.prepare("SELECT 1 FROM bridge_devices WHERE name = ?").get(clean)) throw new HttpError(409, "name_taken", "این نام وجود دارد.");
    const id = randomUUID();
    const token = randomToken();
    this.db.prepare("INSERT INTO bridge_devices (id, name, token_hash, folders, created_at) VALUES (?, ?, ?, ?, ?)").run(id, clean, hash(token), JSON.stringify(folders), now());
    return { device: this.view(this.db.prepare("SELECT * FROM bridge_devices WHERE id = ?").get(id) as Row), token };
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM bridge_devices WHERE id = ?").run(id);
    for (const p of this.pending.values()) if (p.deviceId === id) this.settle(p.id, new HttpError(404, "device_gone", "این دستگاه حذف شد."));
  }

  private byToken(token: string | undefined): Row {
    const r = token ? (this.db.prepare("SELECT * FROM bridge_devices WHERE token_hash = ?").get(hash(token)) as Row | undefined) : undefined;
    if (!r) throw new HttpError(401, "bad_token", "توکن نامعتبر است.");
    return r;
  }

  private settle(id: string, result: string | Error): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (result instanceof Error) p.reject(result);
    else p.resolve(result);
  }

  /** Sends one command to a device by name and waits for its answer. */
  send(deviceName: string, command: BridgeCommand): Promise<string> {
    const row = this.db.prepare("SELECT * FROM bridge_devices WHERE name = ?").get(deviceName) as Row | undefined;
    if (!row) throw new HttpError(404, "no_device", "این دستگاه تعریف نشده است.");
    if (!this.view(row).online) throw new HttpError(409, "offline", "این دستگاه الان خاموش یا قطع است.");
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => this.settle(id, new HttpError(504, "bridge_timeout", "دستگاه در مهلت جواب نداد.")), COMMAND_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { id, deviceId: row.id, command, resolve, reject, timer, sent: false });
      this.waiters.get(row.id)?.();
    });
  }

  /** Long poll from the device. Returns the next command, or null after the wait. */
  async poll(token: string | undefined, waitMs = POLL_WAIT_MS): Promise<{ id: string; command: BridgeCommand } | null> {
    const row = this.byToken(token);
    const seen = (): void => void this.db.prepare("UPDATE bridge_devices SET last_seen_at = ? WHERE id = ?").run(now(), row.id);
    seen();
    const next = (): Pending | undefined => [...this.pending.values()].find((p) => p.deviceId === row.id && !p.sent);
    if (!next()) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, waitMs);
        this.waiters.get(row.id)?.();
        this.waiters.set(row.id, () => {
          clearTimeout(t);
          resolve();
        });
      });
      this.waiters.delete(row.id);
      seen();
    }
    const p = next();
    if (!p) return null;
    p.sent = true;
    return { id: p.id, command: p.command };
  }

  result(token: string | undefined, id: string, ok: boolean, output: string): void {
    const row = this.byToken(token);
    const p = this.pending.get(id);
    if (!p || p.deviceId !== row.id) return;
    this.settle(id, ok ? output : new HttpError(502, "bridge_failed", output));
  }

  promptFor(): string {
    const devices = this.list();
    if (!devices.length) return "";
    return `The user's own computers, reachable with the desktop_* tools only while online, and only inside these folders:\n${devices.map((d) => `- ${d.name} (${d.online ? "online" : "offline"}): ${d.folders.join(", ")}`).join("\n")}`;
  }
}
