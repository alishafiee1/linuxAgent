import type { Approval, ApprovalChannel } from "@linux-agent/shared";
import { MSG_ALREADY_DECIDED, type ApprovalService } from "../approval/service.js";
import type { Db } from "../db.js";
import type { SettingsStore } from "../settings.js";

export type ChannelName = "bale" | "telegram";

const API_BASE: Record<ChannelName, string> = {
  bale: "https://tapi.bale.ai/bot",
  telegram: "https://api.telegram.org/bot",
};

export const MSG_TEST = "پیام آزمایشی";

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ json(): Promise<unknown> }>;

interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface Update {
  update_id: number;
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number | string } } };
}

/** Minimal Bot API client. Bale implements the same methods as Telegram. */
export class BotApi {
  constructor(
    private channel: ChannelName,
    private token: string,
    private fetchFn: FetchLike,
  ) {}

  async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchFn(`${API_BASE[this.channel]}${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = (await res.json()) as BotApiResponse<T>;
    if (!data.ok) throw new Error(`${this.channel} ${method}: ${data.description ?? "error"}`);
    return data.result as T;
  }
}

function approvalText(a: Approval): string {
  const input = JSON.stringify(a.input, null, 1) ?? "";
  return [`درخواست تأیید از بات «${a.botName}»`, `کار: ${a.reason}`, `ابزار: ${a.toolName}`, "", input.length > 900 ? `${input.slice(0, 900)}…` : input].join("\n");
}

function decisionLine(a: Approval): string {
  const via: Record<ApprovalChannel, string> = { panel: "پنل", bale: "بله", telegram: "تلگرام", timeout: "پایان مهلت" };
  const what = a.state === "allowed" ? "اجازه داده شد" : a.state === "denied" ? "رد شد" : "منقضی شد";
  return `${what} (${a.decidedByChannel ? via[a.decidedByChannel] : "?"})`;
}

/**
 * Spec R12: approval messages with buttons on Bale and Telegram, answered by long polling
 * (no inbound webhook needed). Only callbacks from the configured chat count.
 */
export class Notifier {
  private loops = new Map<ChannelName, AbortController>();

  constructor(
    private db: Db,
    private settings: SettingsStore,
    private approvals: ApprovalService,
    private fetchFn: FetchLike = fetch as unknown as FetchLike,
    private log: (msg: string) => void = () => {},
  ) {
    approvals.onChange({
      created: (a) => void this.sendApproval(a),
      decided: (a) => void this.markDecided(a),
    });
  }

  private api(name: ChannelName): { api: BotApi; chatId: string } | null {
    const ch = this.settings.channel(name);
    return ch ? { api: new BotApi(name, ch.token, this.fetchFn), chatId: ch.chatId } : null;
  }

  /** (Re)starts polling for every configured channel. Call after settings change. */
  reload(): void {
    this.stop();
    for (const name of ["bale", "telegram"] as const) {
      const c = this.api(name);
      if (!c) continue;
      const ctrl = new AbortController();
      this.loops.set(name, ctrl);
      void this.poll(name, c.api, c.chatId, ctrl.signal);
    }
  }

  stop(): void {
    for (const c of this.loops.values()) c.abort();
    this.loops.clear();
  }

  async test(name: ChannelName): Promise<void> {
    const c = this.api(name);
    if (!c) throw new Error("not configured");
    await c.api.call("sendMessage", { chat_id: c.chatId, text: MSG_TEST });
  }

  private async sendApproval(a: Approval): Promise<void> {
    for (const name of ["bale", "telegram"] as const) {
      const c = this.api(name);
      if (!c) continue;
      try {
        const msg = await c.api.call<{ message_id: number }>("sendMessage", {
          chat_id: c.chatId,
          text: approvalText(a),
          reply_markup: {
            inline_keyboard: [
              [
                { text: "اجازه", callback_data: `ap:${a.id}:1` },
                { text: "رد", callback_data: `ap:${a.id}:0` },
              ],
            ],
          },
        });
        this.db
          .prepare("INSERT INTO approval_messages (approval_id, channel, chat_id, message_id) VALUES (?, ?, ?, ?)")
          .run(a.id, name, c.chatId, String(msg.message_id));
      } catch (e) {
        this.log(`notify ${name} failed: ${(e as Error).message}`);
      }
    }
  }

  private async markDecided(a: Approval): Promise<void> {
    const rows = this.db.prepare("SELECT channel, chat_id, message_id FROM approval_messages WHERE approval_id = ?").all(a.id) as {
      channel: ChannelName;
      chat_id: string;
      message_id: string;
    }[];
    for (const r of rows) {
      const c = this.api(r.channel);
      if (!c) continue;
      try {
        await c.api.call("editMessageText", { chat_id: r.chat_id, message_id: Number(r.message_id), text: `${approvalText(a)}\n\n${decisionLine(a)}` });
      } catch (e) {
        this.log(`edit ${r.channel} failed: ${(e as Error).message}`);
      }
    }
  }

  /** Handles one update. Exported shape for tests via `handleUpdate`. */
  async handleUpdate(name: ChannelName, api: BotApi, chatId: string, u: Update): Promise<void> {
    const cb = u.callback_query;
    if (!cb?.data) return;
    if (String(cb.message?.chat.id) !== String(chatId)) {
      await api.call("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => {});
      return;
    }
    const m = /^ap:([0-9a-f-]{36}):([01])$/.exec(cb.data);
    if (!m) return;
    const result = this.approvals.decide(m[1]!, m[2] === "1", name);
    await api
      .call("answerCallbackQuery", { callback_query_id: cb.id, text: result.ok ? decisionLine(result.approval) : MSG_ALREADY_DECIDED })
      .catch(() => {});
  }

  private async poll(name: ChannelName, api: BotApi, chatId: string, signal: AbortSignal): Promise<void> {
    let offset = 0;
    await api.call("deleteWebhook", {}).catch(() => {});
    while (!signal.aborted) {
      try {
        const updates = await api.call<Update[]>("getUpdates", { offset, timeout: 30, allowed_updates: ["callback_query"] }, signal);
        for (const u of updates) {
          offset = u.update_id + 1;
          await this.handleUpdate(name, api, chatId, u);
        }
      } catch (e) {
        if (signal.aborted) return;
        this.log(`poll ${name}: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}
