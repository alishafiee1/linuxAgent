import type { VaultInput, VaultItem } from "@linux-agent/shared";
import { randomUUID } from "node:crypto";
import { HttpError } from "./bots.js";
import type { Db } from "./db.js";
import { now } from "./db.js";
import { decrypt, encrypt } from "./lib/crypto.js";

interface Row {
  id: string;
  name: string;
  username: string | null;
  secret_enc: string;
  site: string | null;
  created_at: string;
}

const toItem = (r: Row): VaultItem => ({ id: r.id, name: r.name, username: r.username, site: r.site, createdAt: r.created_at });

function origin(site: string | null | undefined): string | null {
  if (!site?.trim()) return null;
  try {
    const u = new URL(site.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    return u.origin;
  } catch {
    throw new HttpError(400, "bad_site", "آدرس سایت نامعتبر است؛ مثل https://example.com بنویسید.");
  }
}

/**
 * Spec 003: passwords are stored encrypted. No API returns a value: names go to the panel and to bots,
 * and the value only ever leaves through `reveal` into a page the person is filling in the live browser.
 */
export class VaultService {
  constructor(
    private db: Db,
    private masterKey: Buffer,
  ) {}

  list(): VaultItem[] {
    return (this.db.prepare("SELECT * FROM vault_items ORDER BY name").all() as Row[]).map(toItem);
  }

  private row(id: string): Row {
    const r = this.db.prepare("SELECT * FROM vault_items WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new HttpError(404, "not_found", "این مورد در گاوصندوق نیست.");
    return r;
  }

  create(input: VaultInput): VaultItem {
    const name = input.name.trim();
    if (!name || name.length > 80) throw new HttpError(400, "bad_name", "نام باید ۱ تا ۸۰ نویسه باشد.");
    if (!input.secret) throw new HttpError(400, "no_secret", "رمز خالی است.");
    if (this.db.prepare("SELECT 1 FROM vault_items WHERE name = ?").get(name)) throw new HttpError(409, "name_taken", "این نام وجود دارد.");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO vault_items (id, name, username, secret_enc, site, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, name, input.username?.trim() || null, encrypt(this.masterKey, input.secret), origin(input.site), now());
    return toItem(this.row(id));
  }

  update(id: string, input: Partial<VaultInput>): VaultItem {
    const r = this.row(id);
    const name = input.name?.trim() ?? r.name;
    if (!name || name.length > 80) throw new HttpError(400, "bad_name", "نام باید ۱ تا ۸۰ نویسه باشد.");
    if (name !== r.name && this.db.prepare("SELECT 1 FROM vault_items WHERE name = ?").get(name)) throw new HttpError(409, "name_taken", "این نام وجود دارد.");
    this.db
      .prepare("UPDATE vault_items SET name = ?, username = ?, secret_enc = ?, site = ? WHERE id = ?")
      .run(
        name,
        input.username !== undefined ? input.username?.trim() || null : r.username,
        input.secret ? encrypt(this.masterKey, input.secret) : r.secret_enc,
        input.site !== undefined ? origin(input.site) : r.site,
        id,
      );
    return toItem(this.row(id));
  }

  delete(id: string): void {
    this.row(id);
    this.db.prepare("DELETE FROM vault_items WHERE id = ?").run(id);
  }

  /** Refuses another origin, so a look-alike page cannot receive the password. */
  reveal(id: string, field: "username" | "password", pageUrl: string | null): string {
    const r = this.row(id);
    if (r.site) {
      let pageOrigin: string | null = null;
      try {
        pageOrigin = pageUrl ? new URL(pageUrl).origin : null;
      } catch {
        // an unparsable address never matches
      }
      if (pageOrigin !== r.site) throw new HttpError(409, "wrong_site", `این رمز فقط برای ${r.site} است.`);
    }
    if (field === "username") {
      if (!r.username) throw new HttpError(400, "no_username", "نام کاربری ذخیره نشده است.");
      return r.username;
    }
    return decrypt(this.masterKey, r.secret_enc);
  }

  promptNames(): string {
    const names = this.list().map((i) => i.name);
    const base = "Passwords are kept in the panel's vault and you never see them. When a site needs a login, open the page, then ask the user to sign in from the panel's live browser view, and continue after they confirm. Never ask the user to paste a password in chat.";
    return names.length ? `${base}\nVault entries the user can choose from: ${names.join(", ")}` : base;
  }
}
