import type { ChatFile } from "@linux-agent/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { IconDownload, IconFolder, IconX } from "./icons";
import { useT } from "./i18n";

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  sent: number;
  status: "uploading" | "done" | "error";
  error?: string;
  id?: string;
}

/** The marks keep "3.0 MB" in order inside right-to-left text. */
export const formatSize = (n: number): string => `⁦${n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`}⁩`;

const CHUNK_RETRIES = 3;

/** Uploads in pieces: progress is real, cancel is instant, and a lost piece is sent again. */
export function useUploads() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const files = useRef(new Map<string, { file: File; abort: AbortController }>());
  const patch = useCallback((key: string, p: Partial<UploadItem>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i))), []);

  const run = useCallback(
    async (key: string, file: File) => {
      const abort = new AbortController();
      files.current.set(key, { file, abort });
      patch(key, { status: "uploading", sent: 0, error: undefined });
      let id: string | undefined;
      try {
        const start = await api.post<{ id: string; chunkBytes: number }>("/api/uploads", { name: file.name, size: file.size });
        id = start.id;
        patch(key, { id });
        for (let index = 0, at = 0; at < file.size; index++, at += start.chunkBytes) {
          for (let attempt = 1; ; attempt++) {
            try {
              const res = await fetch(`/api/uploads/${id}/chunks/${index}`, {
                method: "PUT",
                headers: { "x-cwp": "1", "content-type": "application/octet-stream" },
                body: file.slice(at, at + start.chunkBytes),
                signal: abort.signal,
              });
              if (res.ok) break;
              const body = (await res.json().catch(() => ({}))) as { message?: string };
              throw Object.assign(new Error(body.message ?? res.statusText), { final: res.status < 500 });
            } catch (e) {
              if (abort.signal.aborted || (e as { final?: boolean }).final || attempt >= CHUNK_RETRIES) throw e;
              await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
          }
          patch(key, { sent: Math.min(file.size, at + start.chunkBytes) });
        }
        await api.post(`/api/uploads/${id}/finish`);
        patch(key, { status: "done", sent: file.size });
      } catch (e) {
        if (abort.signal.aborted) return;
        patch(key, { status: "error", error: (e as Error).message });
      }
    },
    [patch],
  );

  const add = useCallback(
    (list: Iterable<File>) => {
      for (const file of list) {
        const key = crypto.randomUUID();
        setItems((cur) => [...cur, { key, name: file.name || "pasted-file", size: file.size, sent: 0, status: "uploading" }]);
        void run(key, file);
      }
    },
    [run],
  );

  /** Stops an upload if it is running, and deletes what reached the server. */
  const remove = useCallback((item: UploadItem) => {
    files.current.get(item.key)?.abort.abort();
    files.current.delete(item.key);
    setItems((cur) => cur.filter((i) => i.key !== item.key));
    if (item.id) void api.del(`/api/uploads/${item.id}`).catch(() => {});
  }, []);

  const retry = useCallback(
    (item: UploadItem) => {
      const f = files.current.get(item.key);
      if (!f) return;
      if (item.id) void api.del(`/api/uploads/${item.id}`).catch(() => {});
      void run(item.key, f.file);
    },
    [run],
  );

  const clear = useCallback(() => {
    files.current.clear();
    setItems([]);
  }, []);

  return { items, add, remove, retry, clear, busy: items.some((i) => i.status === "uploading"), ready: items.filter((i) => i.status === "done").map((i) => i.id!) };
}

export function UploadTray({ items, onRemove, onRetry }: { items: UploadItem[]; onRemove: (i: UploadItem) => void; onRetry: (i: UploadItem) => void }) {
  const { t } = useT();
  if (!items.length) return null;
  return (
    <div className="upload-tray">
      {items.map((i) => {
        const percent = i.size ? Math.round((i.sent / i.size) * 100) : 100;
        return (
          <div key={i.key} className={`upload-item ${i.status}`}>
            <IconFolder size={15} />
            <div className="upload-main">
              <div className="upload-name" dir="auto" title={i.name}>
                {i.name}
              </div>
              {i.status === "uploading" && (
                <div className="upload-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={i.name}>
                  <span style={{ width: `${percent}%` }} />
                </div>
              )}
              <div className="upload-meta">{i.status === "error" ? <span className="err">{i.error}</span> : i.status === "done" ? `${formatSize(i.size)} · ${t.uploadReady}` : `${formatSize(i.sent)} / ${formatSize(i.size)} · ${percent}%`}</div>
            </div>
            {i.status === "error" && (
              <button type="button" className="ghost" onClick={() => onRetry(i)}>
                {t.uploadRetry}
              </button>
            )}
            <button type="button" className="ghost icon-btn" title={i.status === "uploading" ? t.cancel : t.delete} aria-label={`${i.status === "uploading" ? t.cancel : t.delete}: ${i.name}`} onClick={() => onRemove(i)}>
              <IconX size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Warns before leaving while something is still going up. */
export function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [active]);
}

const INLINE = /\.(png|jpe?g|gif|webp|mp3|ogg|wav|m4a|mp4|webm)$/i;

export function FileCard({ file, caption }: { file: ChatFile; caption?: string }) {
  const { t } = useT();
  const q = `root=${file.root}&path=${encodeURIComponent(file.path)}`;
  const preview = INLINE.test(file.name) ? `/api/files/download?${q}&inline=1` : null;
  return (
    <div className="file-card">
      {caption && (
        <div dir="auto" className="file-caption">
          {caption}
        </div>
      )}
      {preview && /\.(png|jpe?g|gif|webp)$/i.test(file.name) && <img src={preview} alt={file.name} loading="lazy" />}
      {preview && /\.(mp3|ogg|wav|m4a)$/i.test(file.name) && <audio src={preview} controls preload="none" />}
      {preview && /\.(mp4|webm)$/i.test(file.name) && <video src={preview} controls preload="none" />}
      <div className="file-row">
        <IconFolder size={15} />
        <span className="upload-name" dir="auto" title={file.name}>
          {file.name}
        </span>
        <span className="muted" dir="ltr">
          {formatSize(file.size)}
        </span>
        <a className="dl" href={`/api/files/download?${q}`} download={file.name}>
          <IconDownload size={14} />
          {t.download}
        </a>
      </div>
    </div>
  );
}
