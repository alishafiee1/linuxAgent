import { hash, verify } from "@node-rs/argon2";
import { authenticator } from "otplib";
import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import { now } from "../db.js";
import { decrypt, encrypt, randomToken } from "../lib/crypto.js";

export const SESSION_DAYS = 7;
export const LOCK_FAILURES = 5;
export const LOCK_WINDOW_MS = 15 * 60_000;

export const MSG_LOCKED = "ورود موقتاً قفل شد؛ ۱۵ دقیقهٔ دیگر دوباره امتحان کنید.";
export const MSG_BAD_LOGIN = "نام کاربری، رمز یا کد اشتباه است.";

authenticator.options = { window: 1 };

export type LoginResult = { ok: true; sessionId: string; expiresAt: Date } | { ok: false; locked: boolean };

export class AuthService {
  constructor(
    private db: Db,
    private masterKey: Buffer,
    private clock: () => number = Date.now,
  ) {}

  hasUser(): boolean {
    return this.db.prepare("SELECT 1 FROM users LIMIT 1").get() !== undefined;
  }

  /** Spec R2: only one user, created from the server CLI. Returns the TOTP otpauth URL. */
  async createUser(username: string, password: string): Promise<{ otpauthUrl: string; secret: string }> {
    if (this.hasUser()) throw new Error("a user already exists");
    if (password.length < 12) throw new Error("password must be at least 12 characters");
    const secret = authenticator.generateSecret();
    this.db
      .prepare("INSERT INTO users (id, username, password_hash, totp_secret_enc, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), username, await hash(password), encrypt(this.masterKey, secret), now());
    return { otpauthUrl: authenticator.keyuri(username, "linuxAgent", secret), secret };
  }

  isLocked(): boolean {
    const since = new Date(this.clock() - LOCK_WINDOW_MS).toISOString();
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE at >= ?").get(since) as { n: number };
    return row.n >= LOCK_FAILURES;
  }

  async login(username: string, password: string, code: string): Promise<LoginResult> {
    if (this.isLocked()) return { ok: false, locked: true };
    const user = this.db
      .prepare("SELECT id, password_hash, totp_secret_enc FROM users WHERE username = ?")
      .get(username) as { id: string; password_hash: string; totp_secret_enc: string } | undefined;
    let ok = false;
    if (user && (await verify(user.password_hash, password))) {
      const secret = decrypt(this.masterKey, user.totp_secret_enc);
      ok = authenticator.check(code.trim(), secret);
    }
    if (!user || !ok) {
      this.db.prepare("INSERT INTO login_failures (at) VALUES (?)").run(new Date(this.clock()).toISOString());
      return { ok: false, locked: this.isLocked() };
    }
    this.db.prepare("DELETE FROM login_failures").run();
    const sessionId = randomToken();
    const expiresAt = new Date(this.clock() + SESSION_DAYS * 86_400_000);
    this.db
      .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .run(sessionId, user.id, expiresAt.toISOString());
    return { ok: true, sessionId, expiresAt };
  }

  sessionUser(sessionId: string | undefined): { username: string } | null {
    if (!sessionId) return null;
    const row = this.db
      .prepare("SELECT u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?")
      .get(sessionId) as { username: string; expires_at: string } | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= this.clock()) {
      this.logout(sessionId);
      return null;
    }
    return { username: row.username };
  }

  logout(sessionId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
}
