import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

// Append-only: never edit a shipped migration, add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    totp_secret_enc TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE login_failures (
    at TEXT NOT NULL
  );
  CREATE TABLE bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    persona TEXT NOT NULL DEFAULT '',
    model TEXT,
    allowed_tools TEXT,
    max_turns INTEGER NOT NULL DEFAULT 50,
    max_minutes INTEGER NOT NULL DEFAULT 120,
    created_at TEXT NOT NULL
  );
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    engine_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    state TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    turns INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_estimate_usd REAL NOT NULL DEFAULT 0,
    limit_reset_at TEXT
  );
  CREATE INDEX runs_state ON runs(state);
  CREATE INDEX runs_conversation ON runs(conversation_id);
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (run_id, seq)
  );
  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    input TEXT NOT NULL,
    reason TEXT NOT NULL,
    state TEXT NOT NULL,
    decided_by_channel TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX approvals_state ON approvals(state);
  CREATE TABLE approval_messages (
    approval_id TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    message_id TEXT NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL;
  ALTER TABLE runs ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE bots ADD COLUMN browser INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE routines (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    trigger TEXT NOT NULL,
    cron TEXT,
    timezone TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    notify INTEGER NOT NULL DEFAULT 1,
    webhook_hash TEXT UNIQUE,
    next_run_at TEXT,
    last_run_at TEXT,
    last_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX routines_due ON routines(enabled, next_run_at);
  CREATE TABLE vault_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    username TEXT,
    secret_enc TEXT NOT NULL,
    site TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE pages (
    id TEXT PRIMARY KEY,
    bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
    name TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    token TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE bridge_devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL UNIQUE,
    folders TEXT NOT NULL,
    last_seen_at TEXT,
    created_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE user_requests (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    state TEXT NOT NULL,
    answer TEXT,
    draft TEXT,
    channel TEXT,
    created_at TEXT NOT NULL,
    answered_at TEXT
  );
  CREATE INDEX user_requests_state ON user_requests(state);
  CREATE TABLE request_messages (
    request_id TEXT NOT NULL REFERENCES user_requests(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    question_index INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE routines ADD COLUMN created_by TEXT;
  ALTER TABLE routines ADD COLUMN deliver TEXT NOT NULL DEFAULT '["bale","telegram"]';
  UPDATE routines SET deliver = '[]' WHERE notify = 0;
  `,
];

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export const now = (): string => new Date().toISOString();
