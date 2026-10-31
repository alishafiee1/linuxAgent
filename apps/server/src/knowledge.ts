import type { Bot, MemoryFile, Skill, SkillInput } from "@linux-agent/shared";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HttpError, slugify, type BotService } from "./bots.js";

export const MEMORY_LIMIT = 100_000;
const PROMPT_MEMORY_LIMIT = 20_000;

/** Files under the agent's home belong to `agent`, so the panel changes them as that user. */
export class AgentFiles {
  constructor(private agentExec: string[] = []) {}

  read(path: string): string | null {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }

  write(path: string, content: string): void {
    if (this.agentExec.length === 0) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return;
    }
    const [bin, ...pre] = this.agentExec;
    const r = spawnSync(bin!, [...pre, "env", "sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", path], { input: content, timeout: 15_000 });
    if (r.status !== 0) throw new HttpError(500, "write_failed", "نوشتن فایل ناموفق بود.");
  }

  removeDir(path: string): void {
    if (this.agentExec.length === 0) {
      rmSync(path, { recursive: true, force: true });
      return;
    }
    const [bin, ...pre] = this.agentExec;
    const r = spawnSync(bin!, [...pre, "env", "rm", "-rf", "--", path], { timeout: 15_000 });
    if (r.status !== 0) throw new HttpError(500, "delete_failed", "حذف ناموفق بود.");
  }
}

function parseSkill(slug: string, text: string): Skill {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const field = (k: string): string => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(m?.[1] ?? "")?.[1]?.trim() ?? "";
  return { slug, name: field("name") || slug, description: field("description"), body: m ? (m[2] ?? "") : text };
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Spec 002: skills and shared memory are plain files under the agent's home.
 * Bots read and write them with their normal tools; the panel shows and edits the same files.
 */
export class KnowledgeService {
  private skillsDir: string;
  private sharedMemory: string;

  constructor(
    agentHome: string,
    private bots: BotService,
    private files: AgentFiles,
  ) {
    this.skillsDir = join(agentHome, "shared", "skills");
    this.sharedMemory = join(agentHome, "shared", "MEMORY.md");
  }

  listSkills(): Skill[] {
    let dirs: string[];
    try {
      dirs = readdirSync(this.skillsDir);
    } catch {
      return [];
    }
    const out: Skill[] = [];
    for (const slug of dirs.sort()) {
      const text = this.files.read(join(this.skillsDir, slug, "SKILL.md"));
      if (text !== null) out.push(parseSkill(slug, text));
    }
    return out;
  }

  private checkedSlug(slug: string): string {
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) throw new HttpError(404, "not_found", "مهارت پیدا نشد.");
    return slug;
  }

  saveSkill(input: SkillInput, slug?: string): Skill {
    const name = oneLine(input.name);
    const description = oneLine(input.description);
    if (!name || name.length > 80) throw new HttpError(400, "bad_name", "نام مهارت باید ۱ تا ۸۰ نویسه باشد.");
    if (!description || description.length > 300) throw new HttpError(400, "bad_description", "توضیح مهارت باید ۱ تا ۳۰۰ نویسه باشد.");
    if (input.body.length > MEMORY_LIMIT) throw new HttpError(400, "too_long", "متن مهارت خیلی بلند است.");
    let target = slug ? this.checkedSlug(slug) : slugify(name) === "bot" ? "skill" : slugify(name);
    if (!slug) {
      const taken = new Set(this.listSkills().map((s) => s.slug));
      const base = target;
      for (let i = 2; taken.has(target); i++) target = `${base}-${i}`;
    }
    this.files.write(join(this.skillsDir, target, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${input.body}`);
    return { slug: target, name, description, body: input.body };
  }

  deleteSkill(slug: string): void {
    this.files.removeDir(join(this.skillsDir, this.checkedSlug(slug)));
  }

  private memoryPath(scope: string): { path: string; label: string } {
    if (scope === "shared") return { path: this.sharedMemory, label: "حافظهٔ مشترک" };
    const bot = this.bots.get(scope);
    return { path: join(this.bots.botDir(bot), "CLAUDE.md"), label: bot.name };
  }

  listMemory(): MemoryFile[] {
    return ["shared", ...this.bots.list().map((b) => b.id)].map((scope) => this.readMemory(scope));
  }

  readMemory(scope: string): MemoryFile {
    const { path, label } = this.memoryPath(scope);
    return { scope, label, path, content: this.files.read(path) ?? "" };
  }

  writeMemory(scope: string, content: string): MemoryFile {
    if (content.length > MEMORY_LIMIT) throw new HttpError(400, "too_long", "متن حافظه خیلی بلند است.");
    const { path } = this.memoryPath(scope);
    this.files.write(path, content);
    return this.readMemory(scope);
  }

  promptFor(_bot: Bot): string {
    const shared = this.files.read(this.sharedMemory)?.slice(0, PROMPT_MEMORY_LIMIT) ?? "";
    const skills = this.listSkills();
    const parts = [
      `Shared memory file for all bots: ${this.sharedMemory}. Add facts every bot should know; keep it short.`,
      shared ? `Current shared memory:\n${shared}` : "",
      `Shared skills live in ${this.skillsDir}/<name>/SKILL.md, with name and description at the top. When the user teaches you a reusable way of working, save it there so every bot can use it.`,
      skills.length ? `Available skills. Read the file before doing work it covers:\n${skills.map((s) => `- ${s.name}: ${s.description} (${join(this.skillsDir, s.slug, "SKILL.md")})`).join("\n")}` : "",
    ];
    return parts.filter(Boolean).join("\n\n");
  }
}
