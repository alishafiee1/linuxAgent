import type { ApprovalChannel, RequestAnswer, RequestKind, RequestPayload, RequestState, UserRequest } from "@linux-agent/shared";
import { randomUUID } from "node:crypto";
import { HttpError } from "./bots.js";
import type { Db } from "./db.js";
import { now } from "./db.js";

export const REQUEST_TTL_MS = 24 * 3_600_000;
export const MAX_QUESTIONS = 6;
export const MAX_OPTIONS = 8;

interface Row {
  id: string;
  run_id: string;
  bot_id: string;
  bot_name: string;
  kind: RequestKind;
  payload: string;
  state: RequestState;
  answer: string | null;
  draft: string | null;
  channel: ApprovalChannel | null;
  created_at: string;
}

const SELECT = `SELECT q.*, b.id AS bot_id, b.name AS bot_name FROM user_requests q
  JOIN runs r ON r.id = q.run_id JOIN conversations c ON c.id = r.conversation_id JOIN bots b ON b.id = c.bot_id`;

const toRequest = (r: Row): UserRequest => ({
  id: r.id,
  runId: r.run_id,
  botId: r.bot_id,
  botName: r.bot_name,
  kind: r.kind,
  payload: JSON.parse(r.payload) as RequestPayload,
  state: r.state,
  answer: r.answer ? (JSON.parse(r.answer) as RequestAnswer) : null,
  channel: r.channel,
  createdAt: r.created_at,
});

export interface RequestListener {
  created(r: UserRequest): void;
  finished(r: UserRequest): void;
}

/**
 * Spec 007: what a bot needs from the person and cannot decide alone: answers, a connection, or a turn
 * in the live browser. The first answer from any channel wins. Secret values never pass through here.
 */
export class RequestService {
  private waiters = new Map<string, (r: UserRequest) => void>();
  private listeners: RequestListener[] = [];

  constructor(
    private db: Db,
    private ttlMs = REQUEST_TTL_MS,
  ) {}

  onChange(l: RequestListener): void {
    this.listeners.push(l);
  }

  get(id: string): UserRequest {
    const row = this.db.prepare(`${SELECT} WHERE q.id = ?`).get(id) as Row | undefined;
    if (!row) throw new HttpError(404, "not_found", "این درخواست پیدا نشد.");
    return toRequest(row);
  }

  pending(): UserRequest[] {
    return (this.db.prepare(`${SELECT} WHERE q.state = 'pending' ORDER BY q.created_at`).all() as Row[]).map(toRequest);
  }

  /** Resolves when answered, or with state cancelled or expired. */
  ask(runId: string, kind: RequestKind, payload: RequestPayload, signal: AbortSignal): { request: UserRequest; done: Promise<UserRequest> } {
    if (kind === "questions") {
      const q = (payload as { questions: { question: string; options: unknown[] }[] }).questions;
      if (!q.length || q.length > MAX_QUESTIONS) throw new HttpError(400, "bad_questions", `بین ۱ تا ${MAX_QUESTIONS} پرسش مجاز است.`);
      if (q.some((x) => x.options.length > MAX_OPTIONS)) throw new HttpError(400, "bad_options", `هر پرسش حداکثر ${MAX_OPTIONS} گزینه دارد.`);
    }
    const id = randomUUID();
    this.db.prepare("INSERT INTO user_requests (id, run_id, kind, payload, state, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").run(id, runId, kind, JSON.stringify(payload), now());
    const request = this.get(id);
    const stop = (): void => void this.finish(id, "cancelled", null, null);
    const timer = setTimeout(() => this.finish(id, "expired", null, null), this.ttlMs);
    timer.unref?.();
    const done = new Promise<UserRequest>((resolve) => {
      this.waiters.set(id, (r) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        resolve(r);
      });
    });
    for (const l of this.listeners) l.created(request);
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
    return { request, done };
  }

  answer(id: string, answer: RequestAnswer, channel: ApprovalChannel): UserRequest {
    const cur = this.get(id);
    if (cur.state !== "pending") throw new HttpError(409, "already_answered", "این درخواست قبلاً پاسخ گرفته است.");
    if (cur.kind === "questions") this.checkAnswers(cur, answer);
    return this.finish(id, "answered", answer, channel) ?? this.get(id);
  }

  private checkAnswers(r: UserRequest, a: RequestAnswer): void {
    const qs = (r.payload as { questions: { question: string }[] }).questions;
    for (const q of qs) if (!a.answers?.[q.question]?.some((x) => x.trim())) throw new HttpError(400, "unanswered", `به این پرسش جواب بدهید: ${q.question}`);
  }

  cancel(id: string): UserRequest {
    return this.finish(id, "cancelled", null, "panel") ?? this.get(id);
  }

  private finish(id: string, state: RequestState, answer: RequestAnswer | null, channel: ApprovalChannel | null): UserRequest | null {
    const changed = this.db.prepare("UPDATE user_requests SET state = ?, answer = ?, channel = ?, answered_at = ? WHERE id = ? AND state = 'pending'").run(state, answer ? JSON.stringify(answer) : null, channel, now(), id).changes;
    if (!changed) return null;
    const r = this.get(id);
    this.waiters.get(id)?.(r);
    this.waiters.delete(id);
    for (const l of this.listeners) l.finished(r);
    return r;
  }

  /** On boot nothing can be waiting any more. */
  expireAllPending(): void {
    this.db.prepare("UPDATE user_requests SET state = 'expired', answered_at = ? WHERE state = 'pending'").run(now());
  }

  // --- answering question by question from Bale and Telegram
  draft(id: string): Record<string, string[]> {
    const r = this.db.prepare("SELECT draft FROM user_requests WHERE id = ?").get(id) as { draft: string | null } | undefined;
    return r?.draft ? (JSON.parse(r.draft) as Record<string, string[]>) : {};
  }

  setDraft(id: string, draft: Record<string, string[]>): void {
    this.db.prepare("UPDATE user_requests SET draft = ? WHERE id = ?").run(JSON.stringify(draft), id);
  }
}
