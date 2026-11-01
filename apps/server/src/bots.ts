import type { Bot, BotInput, Conversation } from "@linux-agent/shared";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db.js";
import { now } from "./db.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const MSG_BOT_BUSY = "این بات در حال کار است؛ اول اجرا را متوقف کنید.";

interface BotRow {
  id: string;
  name: string;
  slug: string;
  persona: string;
  model: string | null;
  allowed_tools: string | null;
  max_turns: number;
  max_minutes: number;
  browser: number;
  created_at: string;
}

const toBot = (r: BotRow): Bot => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  persona: r.persona,
  model: r.model,
  allowedTools: r.allowed_tools ? (JSON.parse(r.allowed_tools) as string[]) : null,
  maxTurns: r.max_turns,
  maxMinutes: r.max_minutes,
  browser: r.browser === 1,
  createdAt: r.created_at,
});

interface ConvRow {
  id: string;
  bot_id: string;
  title: string;
  engine_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export const toConversation = (r: ConvRow): Conversation => ({
  id: r.id,
  botId: r.bot_id,
  title: r.title,
  engineSessionId: r.engine_session_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return s || "bot";
}

function validate(input: BotInput, partial: boolean): void {
  if (!partial || input.name !== undefined) {
    const name = (input.name ?? "").trim();
    if (name.length < 1 || name.length > 40) throw new HttpError(400, "bad_name", "نام بات باید ۱ تا ۴۰ نویسه باشد.");
  }
  if (input.maxTurns !== undefined && (!Number.isInteger(input.maxTurns) || input.maxTurns < 1 || input.maxTurns > 500))
    throw new HttpError(400, "bad_max_turns", "سقف نوبت باید بین ۱ و ۵۰۰ باشد.");
  if (input.maxMinutes !== undefined && (!Number.isInteger(input.maxMinutes) || input.maxMinutes < 1 || input.maxMinutes > 1440))
    throw new HttpError(400, "bad_max_minutes", "سقف زمان باید بین ۱ و ۱۴۴۰ دقیقه باشد.");
}

export class BotService {
  constructor(
    private db: Db,
    private botsDir: string,
    /** Prefix that runs a program as the `agent` user. Empty = current user (dev). */
    private agentExec: string[] = [],
  ) {}

  /** The bots folder belongs to `agent`, so changes inside it run as that user. */
  private asAgent(script: string, ...args: string[]): void {
    const [bin, ...pre] = this.agentExec;
    const r = spawnSync(bin!, [...pre, "env", "sh", "-c", script, "sh", ...args], { stdio: "ignore", timeout: 15_000 });
    if (r.status !== 0) console.error(`[cwp] agent command failed: ${script}`);
  }

  list(): Bot[] {
    return (this.db.prepare("SELECT * FROM bots ORDER BY created_at").all() as BotRow[]).map(toBot);
  }

  get(id: string): Bot {
    const row = this.db.prepare("SELECT * FROM bots WHERE id = ?").get(id) as BotRow | undefined;
    if (!row) throw new HttpError(404, "not_found", "بات پیدا نشد.");
    return toBot(row);
  }

  botDir(bot: Bot): string {
    return join(this.botsDir, bot.slug);
  }

  create(input: BotInput): Bot {
    validate(input, false);
    const name = input.name.trim();
    if (this.db.prepare("SELECT 1 FROM bots WHERE name = ?").get(name))
      throw new HttpError(409, "name_taken", "باتی با این نام وجود دارد.");
    let slug = slugify(name);
    for (let i = 2; this.db.prepare("SELECT 1 FROM bots WHERE slug = ?").get(slug); i++) slug = `${slugify(name)}-${i}`;
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO bots (id, name, slug, persona, model, allowed_tools, max_turns, max_minutes, browser, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        slug,
        input.persona ?? "",
        input.model ?? null,
        input.allowedTools ? JSON.stringify(input.allowedTools) : null,
        input.maxTurns ?? 50,
        input.maxMinutes ?? 120,
        input.browser ? 1 : 0,
        now(),
      );
    const bot = this.get(id);
    this.ensureDir(bot);
    return bot;
  }

  /** The bot's own notes file (spec R3). Created once, then owned by the bot. */
  ensureDir(bot: Bot): void {
    const dir = this.botDir(bot);
    const initial = `# ${bot.name}\n\nیادداشت‌های این بات.\n`;
    if (this.agentExec.length > 0) {
      this.asAgent('mkdir -p "$1" && { [ -e "$1/CLAUDE.md" ] || printf %s "$2" > "$1/CLAUDE.md"; }', dir, initial);
      return;
    }
    try {
      mkdirSync(dir, { recursive: true });
      const notes = join(dir, "CLAUDE.md");
      if (!existsSync(notes)) writeFileSync(notes, initial);
    } catch {
      // Notes are optional; the run still works without them.
    }
  }

  update(id: string, input: Partial<BotInput>): Bot {
    validate(input as BotInput, true);
    const bot = this.get(id);
    const name = input.name?.trim() ?? bot.name;
    if (name !== bot.name && this.db.prepare("SELECT 1 FROM bots WHERE name = ? AND id != ?").get(name, id))
      throw new HttpError(409, "name_taken", "باتی با این نام وجود دارد.");
    this.db
      .prepare(
        `UPDATE bots SET name = ?, persona = ?, model = ?, allowed_tools = ?, max_turns = ?, max_minutes = ?, browser = ? WHERE id = ?`,
      )
      .run(
        name,
        input.persona ?? bot.persona,
        input.model !== undefined ? input.model : bot.model,
        input.allowedTools !== undefined
          ? input.allowedTools
            ? JSON.stringify(input.allowedTools)
            : null
          : bot.allowedTools
            ? JSON.stringify(bot.allowedTools)
            : null,
        input.maxTurns ?? bot.maxTurns,
        input.maxMinutes ?? bot.maxMinutes,
        (input.browser ?? bot.browser) ? 1 : 0,
        id,
      );
    return this.get(id);
  }

  hasActiveRun(id: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM runs r JOIN conversations c ON c.id = r.conversation_id
           WHERE c.bot_id = ? AND r.state IN ('queued','running','waiting_approval','waiting_limit') LIMIT 1`,
        )
        .get(id) !== undefined
    );
  }

  /** Spec R4 + edge case: refuse while a run of this bot is active. Removes only the bot's own folder. */
  delete(id: string): void {
    const bot = this.get(id);
    if (this.hasActiveRun(id)) throw new HttpError(409, "bot_busy", MSG_BOT_BUSY);
    this.db.prepare("DELETE FROM bots WHERE id = ?").run(id);
    if (this.agentExec.length > 0) {
      this.asAgent('rm -rf -- "$1"', this.botDir(bot));
      return;
    }
    try {
      rmSync(this.botDir(bot), { recursive: true, force: true });
    } catch {
      // Leftover folder is harmless; the workspace is never touched.
    }
  }

  conversations(botId: string): Conversation[] {
    this.get(botId);
    return (
      this.db.prepare("SELECT * FROM conversations WHERE bot_id = ? ORDER BY updated_at DESC").all(botId) as ConvRow[]
    ).map(toConversation);
  }

  createConversation(botId: string, title?: string): Conversation {
    this.get(botId);
    const id = randomUUID();
    const t = now();
    this.db
      .prepare("INSERT INTO conversations (id, bot_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, botId, (title ?? "").trim() || "گفت‌وگوی تازه", t, t);
    return this.conversation(id);
  }

  conversation(id: string): Conversation {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConvRow | undefined;
    if (!row) throw new HttpError(404, "not_found", "گفت‌وگو پیدا نشد.");
    return toConversation(row);
  }
}
