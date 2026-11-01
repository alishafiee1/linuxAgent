import type { ChatFile } from "@linux-agent/shared";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { HttpError } from "./bots.js";
import type { AgentFiles } from "./knowledge.js";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Smaller than nginx's body limit, so no server setting has to change. */
export const CHUNK_BYTES = 1024 * 1024;
const STALE_MS = 24 * 3_600_000;

interface Upload {
  id: string;
  name: string;
  size: number;
  received: number;
  nextIndex: number;
  temp: string;
  finished: ChatFile | null;
  touched: number;
}

/** Keeps a name readable but never lets it become a path or hide its real extension. */
export function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const base = basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "").trim();
  const clean = base.replace(/^\.+/, "").slice(-120);
  return clean || "file";
}

/**
 * Spec 014: files go up in small pieces, so a slow link shows progress, can be cancelled, and survives
 * the proxy's body limit. A finished file lands in the shared workspace, where bots can read it.
 */
export class UploadService {
  private uploads = new Map<string, Upload>();

  constructor(
    private tempDir: string,
    private files: AgentFiles,
    private workspaceDir: string,
    private botsDir: string,
  ) {}

  private get(id: string): Upload {
    const u = this.uploads.get(id);
    if (!u) throw new HttpError(404, "no_upload", "این فایل پیدا نشد؛ دوباره آپلود کنید.");
    u.touched = Date.now();
    return u;
  }

  private sweep(): void {
    const cutoff = Date.now() - STALE_MS;
    for (const u of this.uploads.values()) if (u.touched < cutoff) this.drop(u);
  }

  private drop(u: Upload): void {
    rmSync(u.temp, { force: true });
    this.uploads.delete(u.id);
  }

  start(name: string, size: number): { id: string; chunkBytes: number } {
    this.sweep();
    if (!Number.isInteger(size) || size < 0) throw new HttpError(400, "bad_size", "اندازهٔ فایل نامعتبر است.");
    if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, "too_big", `حداکثر اندازهٔ فایل ${MAX_UPLOAD_BYTES / 1024 / 1024} مگابایت است.`);
    mkdirSync(this.tempDir, { recursive: true });
    const id = randomUUID();
    const temp = join(this.tempDir, id);
    writeFileSync(temp, "");
    this.uploads.set(id, { id, name: safeName(name), size, received: 0, nextIndex: 0, temp, finished: null, touched: Date.now() });
    return { id, chunkBytes: CHUNK_BYTES };
  }

  /** A piece sent twice after a lost reply is accepted once. */
  chunk(id: string, index: number, data: Buffer): { received: number } {
    const u = this.get(id);
    if (index < u.nextIndex) return { received: u.received };
    if (index !== u.nextIndex) throw new HttpError(409, "bad_chunk", "ترتیب قطعه‌ها به‌هم خورد.");
    if (u.received + data.length > u.size) throw new HttpError(400, "too_much", "فایل از اندازهٔ اعلام‌شده بزرگ‌تر است.");
    appendFileSync(u.temp, data);
    u.received += data.length;
    u.nextIndex++;
    return { received: u.received };
  }

  finish(id: string): ChatFile {
    const u = this.get(id);
    if (u.finished) return u.finished;
    if (u.received !== u.size) throw new HttpError(409, "incomplete", "فایل کامل نرسیده است.");
    const path = join(this.workspaceDir, "uploads", id.slice(0, 8), u.name);
    this.files.write(path, readFileSync(u.temp));
    rmSync(u.temp, { force: true });
    u.finished = { name: u.name, size: u.size, root: "workspace", path: relative(this.workspaceDir, path).split(sep).join("/"), absolutePath: path };
    return u.finished;
  }

  /** Cancels an upload, or removes a finished file the person changed their mind about. */
  remove(id: string): void {
    const u = this.get(id);
    if (u.finished) this.files.removeDir(join(this.workspaceDir, "uploads", id.slice(0, 8)));
    this.drop(u);
  }

  /** Hands finished files to a message. After this they stay in the workspace. */
  take(ids: string[]): ChatFile[] {
    const out = ids.map((id) => {
      const u = this.get(id);
      if (!u.finished) throw new HttpError(409, "incomplete", `«${u.name}» هنوز کامل نشده است.`);
      return u.finished;
    });
    for (const id of ids) this.uploads.delete(id);
    return out;
  }

  /** A file a bot wants to give the person. Links cannot lead outside the folders the panel serves. */
  locate(path: string): ChatFile {
    const target = resolve(this.workspaceDir, path);
    let real: string;
    try {
      real = realpathSync(target);
    } catch {
      throw new HttpError(404, "no_file", `این فایل پیدا نشد: ${path}`);
    }
    for (const [root, dir] of [["workspace", this.workspaceDir], ["bots", this.botsDir]] as const) {
      const realRoot = realpathSync(dir);
      if (real.startsWith(realRoot + sep)) {
        const s = statSync(real);
        if (!s.isFile()) throw new HttpError(400, "not_file", "این مسیر فایل نیست.");
        return { name: basename(real), size: s.size, root, path: relative(realRoot, real).split(sep).join("/"), absolutePath: real };
      }
    }
    throw new HttpError(403, "outside", "فقط فایل‌های فضای کار یا پوشهٔ بات را می‌توان فرستاد؛ اول فایل را به فضای کار کپی کن.");
  }
}
