import type { SharedPage } from "@linux-agent/shared";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { HttpError } from "./bots.js";
import type { Db } from "./db.js";
import { now } from "./db.js";
import type { AgentFiles } from "./knowledge.js";
import { randomToken } from "./lib/crypto.js";

export const PAGE_LIMIT = 2_000_000;
/** Shared pages come from bots, so they run with no script and no way to reach the panel. */
export const PAGE_CSP = "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:; sandbox";

interface Row {
  id: string;
  bot_id: string | null;
  name: string;
  title: string;
  token: string | null;
  created_at: string;
  updated_at: string;
}

/** Spec 004: a bot writes a report as one HTML file; a secret link shows it to anyone holding the link. */
export class PageService {
  constructor(
    private db: Db,
    private files: AgentFiles,
    private workspaceDir: string,
    private publicBaseUrl: string,
  ) {}

  private view = (r: Row): SharedPage => ({
    id: r.id,
    botId: r.bot_id,
    name: r.name,
    title: r.title,
    url: r.token ? `${this.publicBaseUrl}/p/${r.token}` : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  private path(name: string): string {
    return join(this.workspaceDir, "pages", `${name}.html`);
  }

  private check(name: string, html: string): void {
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(name)) throw new HttpError(400, "bad_name", "نام صفحه فقط حرف کوچک انگلیسی، عدد و خط تیره می‌پذیرد.");
    if (Buffer.byteLength(html) > PAGE_LIMIT) throw new HttpError(400, "too_big", "صفحه خیلی بزرگ است.");
  }

  list(): SharedPage[] {
    return (this.db.prepare("SELECT * FROM pages ORDER BY updated_at DESC").all() as Row[]).map(this.view);
  }

  private byId(id: string): Row {
    const r = this.db.prepare("SELECT * FROM pages WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new HttpError(404, "not_found", "صفحه پیدا نشد.");
    return r;
  }

  publish(botId: string | null, name: string, title: string, html: string): SharedPage {
    this.check(name, html);
    if (this.db.prepare("SELECT 1 FROM pages WHERE name = ?").get(name)) throw new HttpError(409, "name_taken", "صفحه‌ای با این نام هست؛ برای تغییرش از update_page استفاده کن.");
    const id = randomUUID();
    const t = now();
    this.files.write(this.path(name), html);
    this.db.prepare("INSERT INTO pages (id, bot_id, name, title, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, botId, name, title.trim() || name, randomToken(24), t, t);
    return this.view(this.byId(id));
  }

  /** Changes content behind an existing link; it never makes a revoked page public again. */
  update(name: string, html: string, title?: string): SharedPage {
    this.check(name, html);
    const r = this.db.prepare("SELECT * FROM pages WHERE name = ?").get(name) as Row | undefined;
    if (!r) throw new HttpError(404, "not_found", "صفحه پیدا نشد.");
    this.files.write(this.path(name), html);
    this.db.prepare("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?").run(title?.trim() || r.title, now(), r.id);
    return this.view(this.byId(r.id));
  }

  setShared(id: string, shared: boolean): SharedPage {
    const r = this.byId(id);
    this.db.prepare("UPDATE pages SET token = ? WHERE id = ?").run(shared ? (r.token ?? randomToken(24)) : null, id);
    return this.view(this.byId(id));
  }

  delete(id: string): void {
    this.byId(id);
    this.db.prepare("DELETE FROM pages WHERE id = ?").run(id);
  }

  read(token: string): string | null {
    const r = this.db.prepare("SELECT name FROM pages WHERE token = ?").get(token) as { name: string } | undefined;
    return r ? this.files.read(this.path(r.name)) : null;
  }
}
