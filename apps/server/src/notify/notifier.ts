import type { Approval, ApprovalChannel, BrowserPayload, ConnectionPayload, QuestionsPayload, UserRequest } from "@linux-agent/shared";
import { MSG_ALREADY_DECIDED, type ApprovalService } from "../approval/service.js";
import type { Db } from "../db.js";
import type { RequestService } from "../requests.js";
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
  message?: { text?: string; chat: { id: number | string } };
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
  return [`بات «${a.botName}» اجازه می‌خواهد`, `کار: ${a.reason}`, "", a.summary].join("\n");
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
  private requests: RequestService | null = null;
  private baseUrl = "";
  /** A channel waiting for free text after someone pressed the "other" button. */
  private awaitingText = new Map<ChannelName, { id: string; index: number }>();

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

  attachRequests(requests: RequestService, baseUrl: string): void {
    this.requests = requests;
    this.baseUrl = baseUrl;
    requests.onChange({
      created: (r) => void this.sendRequest(r),
      finished: (r) => void this.closeRequest(r),
    });
  }

  private questionText(r: UserRequest, index: number): string {
    const q = (r.payload as QuestionsPayload).questions[index]!;
    const details = q.options.filter((o) => o.description).map((o) => `• ${o.label}: ${o.description}`);
    return [`بات «${r.botName}» می‌پرسد:`, q.question, ...(q.multiSelect ? ["(چند گزینه را می‌توانید انتخاب کنید)"] : []), ...(details.length ? ["", ...details] : [])].join("\n");
  }

  private questionKeyboard(r: UserRequest, index: number): { inline_keyboard: { text: string; callback_data: string }[][] } {
    const q = (r.payload as QuestionsPayload).questions[index]!;
    const chosen = this.requests!.draft(r.id)[q.question] ?? [];
    const rows = q.options.map((o, i) => [{ text: `${chosen.includes(o.label) ? "✓ " : ""}${o.label}`.slice(0, 60), callback_data: `rq:${r.id}:${index}:${i}` }]);
    rows.push([{ text: "سایر (نوشتن)", callback_data: `rq:${r.id}:${index}:o` }]);
    if (q.multiSelect) rows.push([{ text: "تأیید این پرسش", callback_data: `rq:${r.id}:${index}:d` }]);
    return { inline_keyboard: rows };
  }

  private async sendRequest(r: UserRequest): Promise<void> {
    for (const name of ["bale", "telegram"] as const) {
      const c = this.api(name);
      if (!c) continue;
      try {
        if (r.kind === "questions") {
          const qs = (r.payload as QuestionsPayload).questions;
          for (let i = 0; i < qs.length; i++) {
            const msg = await c.api.call<{ message_id: number }>("sendMessage", { chat_id: c.chatId, text: this.questionText(r, i), reply_markup: this.questionKeyboard(r, i) });
            this.saveMessage(r.id, name, c.chatId, msg.message_id, i);
          }
          continue;
        }
        const open = { text: "باز کردن پنل", url: `${this.baseUrl}/?inbox=1` };
        const text =
          r.kind === "connection"
            ? `بات «${r.botName}» به اتصال نیاز دارد: ${(r.payload as ConnectionPayload).platform ?? (r.payload as ConnectionPayload).name}\n${(r.payload as ConnectionPayload).reason}\n\nکلید را فقط در پنل وارد کنید، نه در این گفت‌وگو.`
            : `بات «${r.botName}» مرورگرش را به شما سپرده است:\n${(r.payload as BrowserPayload).reason}`;
        const buttons = r.kind === "browser" ? [[open], [{ text: "انجام شد، ادامه بده", callback_data: `rq:${r.id}:0:f` }]] : [[open]];
        const msg = await c.api.call<{ message_id: number }>("sendMessage", { chat_id: c.chatId, text, reply_markup: { inline_keyboard: buttons } });
        this.saveMessage(r.id, name, c.chatId, msg.message_id, 0);
      } catch (e) {
        this.log(`request ${name} failed: ${(e as Error).message}`);
      }
    }
  }

  private saveMessage(id: string, channel: ChannelName, chatId: string, messageId: number, index: number): void {
    this.db.prepare("INSERT INTO request_messages (request_id, channel, chat_id, message_id, question_index) VALUES (?, ?, ?, ?, ?)").run(id, channel, chatId, String(messageId), index);
  }

  private async closeRequest(r: UserRequest): Promise<void> {
    for (const [channel, wait] of this.awaitingText) if (wait.id === r.id) this.awaitingText.delete(channel);
    const rows = this.db.prepare("SELECT channel, chat_id, message_id, question_index FROM request_messages WHERE request_id = ?").all(r.id) as { channel: ChannelName; chat_id: string; message_id: string; question_index: number }[];
    for (const row of rows) {
      const c = this.api(row.channel);
      if (!c) continue;
      let line = r.state === "answered" ? "انجام شد" : r.state === "cancelled" ? "لغو شد" : "منقضی شد";
      let text = r.kind === "questions" ? this.questionText(r, row.question_index) : "درخواست بات";
      if (r.kind === "questions" && r.state === "answered") {
        const q = (r.payload as QuestionsPayload).questions[row.question_index]!;
        line = `پاسخ: ${(r.answer?.answers?.[q.question] ?? []).join("، ")}`;
        text = q.question;
      }
      await c.api.call("editMessageText", { chat_id: row.chat_id, message_id: Number(row.message_id), text: `${text}\n\n${line}` }).catch((e: Error) => this.log(`edit ${row.channel} failed: ${e.message}`));
    }
  }

  private async refreshKeyboard(r: UserRequest, channel: ChannelName, index: number): Promise<void> {
    const c = this.api(channel);
    const row = this.db.prepare("SELECT chat_id, message_id FROM request_messages WHERE request_id = ? AND channel = ? AND question_index = ?").get(r.id, channel, index) as { chat_id: string; message_id: string } | undefined;
    if (!c || !row) return;
    await c.api.call("editMessageReplyMarkup", { chat_id: row.chat_id, message_id: Number(row.message_id), reply_markup: this.questionKeyboard(r, index) }).catch(() => {});
  }

  /** Records one choice. The whole request is answered once every question has one. */
  private settleDraft(r: UserRequest, channel: ChannelName): void {
    const qs = (r.payload as QuestionsPayload).questions;
    const draft = this.requests!.draft(r.id);
    const confirmed = draft["__confirmed"] ?? [];
    const complete = qs.every((q) => draft[q.question]?.length && (!q.multiSelect || confirmed.includes(q.question)));
    if (!complete) return;
    const answers = Object.fromEntries(Object.entries(draft).filter(([k]) => k !== "__confirmed"));
    this.requests!.answer(r.id, { answers }, channel);
  }

  private async handleRequestButton(name: ChannelName, api: BotApi, callbackId: string, id: string, index: number, action: string): Promise<void> {
    const reply = (text?: string): Promise<unknown> => api.call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) }).catch(() => {});
    if (!this.requests) return void (await reply());
    let r: UserRequest;
    try {
      r = this.requests.get(id);
    } catch {
      return void (await reply("پیدا نشد"));
    }
    if (r.state !== "pending") return void (await reply(MSG_ALREADY_DECIDED));
    if (action === "f") {
      this.requests.answer(id, { done: true }, name);
      return void (await reply("ادامه می‌دهد"));
    }
    const q = (r.payload as QuestionsPayload).questions?.[index];
    if (!q) return void (await reply());
    if (action === "o") {
      this.awaitingText.set(name, { id, index });
      return void (await reply("جواب را همین‌جا بنویسید و بفرستید"));
    }
    const draft = this.requests.draft(id);
    if (action === "d") {
      if (!draft[q.question]?.length) return void (await reply("اول یک گزینه را انتخاب کنید"));
      draft["__confirmed"] = [...(draft["__confirmed"] ?? []), q.question];
    } else {
      const label = q.options[Number(action)]?.label;
      if (!label) return void (await reply());
      const cur = draft[q.question] ?? [];
      draft[q.question] = q.multiSelect ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label];
    }
    this.requests.setDraft(id, draft);
    await reply("ثبت شد");
    await this.refreshKeyboard(r, name, index);
    this.settleDraft(r, name);
  }

  private async handleText(name: ChannelName, text: string): Promise<void> {
    const wait = this.awaitingText.get(name);
    if (!wait || !this.requests) return;
    this.awaitingText.delete(name);
    const r = this.requests.get(wait.id);
    if (r.state !== "pending") return;
    const q = (r.payload as QuestionsPayload).questions[wait.index];
    if (!q) return;
    const draft = this.requests.draft(wait.id);
    draft[q.question] = [text.slice(0, 2000)];
    if (q.multiSelect) draft["__confirmed"] = [...(draft["__confirmed"] ?? []), q.question];
    this.requests.setDraft(wait.id, draft);
    this.settleDraft(r, name);
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

  /** A plain message to every configured channel. One failing channel does not stop the other. */
  async notify(text: string): Promise<void> {
    for (const name of ["bale", "telegram"] as const) {
      const c = this.api(name);
      if (!c) continue;
      await c.api.call("sendMessage", { chat_id: c.chatId, text }).catch((e: Error) => this.log(`notify ${name} failed: ${e.message}`));
    }
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
    if (u.message?.text && String(u.message.chat.id) === String(chatId)) {
      await this.handleText(name, u.message.text);
      return;
    }
    const cb = u.callback_query;
    if (!cb?.data) return;
    if (String(cb.message?.chat.id) !== String(chatId)) {
      await api.call("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => {});
      return;
    }
    const rq = /^rq:([0-9a-f-]{36}):(\d+):(\d+|[odf])$/.exec(cb.data);
    if (rq) {
      await this.handleRequestButton(name, api, cb.id, rq[1]!, Number(rq[2]), rq[3]!);
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
    let delay = 5000;
    await api.call("deleteWebhook", {}).catch(() => {});
    while (!signal.aborted) {
      try {
        const updates = await api.call<Update[]>("getUpdates", { offset, timeout: 30, allowed_updates: ["callback_query", "message"] }, signal);
        for (const u of updates) {
          offset = u.update_id + 1;
          await this.handleUpdate(name, api, chatId, u);
        }
        delay = 5000;
      } catch (e) {
        if (signal.aborted) return;
        this.log(`poll ${name}: ${(e as Error).message}`);
        // A wrong token fails instantly and forever, so back off instead of hammering the API.
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 300_000);
      }
    }
  }
}
