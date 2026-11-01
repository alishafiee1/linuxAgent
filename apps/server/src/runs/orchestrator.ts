import type { Bot, Question, RequestKind, RequestPayload, Run, RunEndReason, RunState, UserRequest } from "@linux-agent/shared";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateTool, type PolicyOptions } from "../approval/policy.js";
import { MSG_NOT_APPROVED, type ApprovalService } from "../approval/service.js";
import { HttpError, type BotService } from "../bots.js";
import type { Db } from "../db.js";
import { now } from "../db.js";
import type { Engine, EngineEvent, McpStdioServer, PanelTool, ToolDecision } from "../engine/types.js";
import type { RequestService } from "../requests.js";
import type { SettingsStore } from "../settings.js";
import type { EventStore } from "./events.js";

export const CONTINUE_PROMPT = "ادامه بده";
export const LIMIT_RETRY_MS = 30 * 60_000;
export const MSG_MAX_TURNS = "بات به سقف نوبت رسید.";
export const MSG_MAX_MINUTES = "بات به سقف زمان رسید.";
export const MSG_TOOL_NOT_ALLOWED = "این ابزار برای این بات مجاز نیست.";

interface RunRow {
  id: string;
  conversation_id: string;
  prompt: string;
  state: RunState;
  reason: RunEndReason;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_estimate_usd: number;
  limit_reset_at: string | null;
  parent_run_id: string | null;
  depth: number;
}

export const toRun = (r: RunRow): Run => ({
  id: r.id,
  conversationId: r.conversation_id,
  prompt: r.prompt,
  state: r.state,
  reason: r.reason,
  createdAt: r.created_at,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  turns: r.turns,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  costEstimateUsd: r.cost_estimate_usd,
  limitResetAt: r.limit_reset_at,
  parentRunId: r.parent_run_id,
  depth: r.depth,
});

export const MAX_MESSAGE_DEPTH = 6;
export const MAX_DELEGATION_DEPTH = 3;
export const MAX_DELEGATIONS_PER_ROOT = 10;

const TERMINAL: readonly RunState[] = ["done", "failed", "cancelled", "interrupted"];

type AbortReason = "cancel" | "timeout" | "shutdown";

export interface RunContext {
  run: Run;
  bot: Bot;
  signal: AbortSignal;
}

export interface OrchestratorDeps {
  db: Db;
  engine: Engine;
  bots: BotService;
  approvals: ApprovalService;
  events: EventStore;
  settings: SettingsStore;
  workspaceDir: string;
  agentHome: string;
  /** Spec R20: while false, queued runs wait. */
  networkUp?: () => boolean;
  /** Extra system prompt lines for a bot: shared memory, skills, connectors. */
  promptExtras?: (bot: Bot) => string;
  /** Tools offered to one run. */
  toolsFor?: (ctx: RunContext) => PanelTool[];
  mcpServersFor?: (bot: Bot) => Record<string, McpStdioServer>;
  policyOptions?: () => PolicyOptions;
  requests?: RequestService;
  clock?: () => number;
}

export class Orchestrator {
  private active = new Map<string, AbortController>();
  private limitTimers = new Map<string, NodeJS.Timeout>();
  private running: Promise<void>[] = [];
  private clock: () => number;
  /** Runs paused on a child run give up their slot, so a parent and child never deadlock at the limit. */
  private blocked = new Map<string, number>();
  private endListeners: ((run: Run) => void)[] = [];

  constructor(private d: OrchestratorDeps) {
    this.clock = d.clock ?? Date.now;
  }

  get(runId: string): Run {
    const row = this.d.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
    if (!row) throw new HttpError(404, "not_found", "اجرا پیدا نشد.");
    return toRun(row);
  }

  listForConversation(conversationId: string): Run[] {
    return (this.d.db.prepare("SELECT * FROM runs WHERE conversation_id = ? ORDER BY created_at").all(conversationId) as RunRow[]).map(toRun);
  }

  counts(): { running: number; queued: number; waitingApproval: number; waitingLimit: number } {
    const rows = this.d.db.prepare("SELECT state, COUNT(*) AS n FROM runs GROUP BY state").all() as { state: RunState; n: number }[];
    const n = (s: RunState): number => rows.find((r) => r.state === s)?.n ?? 0;
    return { running: n("running"), queued: n("queued"), waitingApproval: n("waiting_approval"), waitingLimit: n("waiting_limit") };
  }

  /** Spec R5: a message becomes a queued run. */
  submit(conversationId: string, prompt: string, opts: { parentRunId?: string; depth?: number } = {}): Run {
    const conv = this.d.bots.conversation(conversationId);
    const text = prompt.trim();
    if (!text) throw new HttpError(400, "empty", "پیام خالی است.");
    const id = randomUUID();
    const t = now();
    this.d.db
      .prepare("INSERT INTO runs (id, conversation_id, prompt, state, created_at, parent_run_id, depth) VALUES (?, ?, ?, 'queued', ?, ?, ?)")
      .run(id, conv.id, text, t, opts.parentRunId ?? null, opts.depth ?? 0);
    this.d.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(t, conv.id);
    this.d.events.append(id, "user", { text });
    this.d.events.append(id, "state", { state: "queued" });
    this.d.events.activity({ kind: "run", runId: id, conversationId: conv.id, state: "queued" });
    this.pump();
    return this.get(id);
  }

  /** Spec R7: only the user's Stop (or limits) ends a run. */
  cancel(runId: string): Run {
    const run = this.get(runId);
    const ctrl = this.active.get(runId);
    if (ctrl) {
      ctrl.abort("cancel" satisfies AbortReason);
      return run;
    }
    if (run.state === "queued" || run.state === "waiting_limit") {
      clearTimeout(this.limitTimers.get(runId));
      this.limitTimers.delete(runId);
      this.finish(runId, "cancelled", "cancelled");
    }
    return this.get(runId);
  }

  /** Spec R9: "Continue" after an interruption resumes the same session. */
  continueRun(runId: string): Run {
    const run = this.get(runId);
    if (!["interrupted", "failed", "cancelled"].includes(run.state))
      throw new HttpError(409, "not_resumable", "این اجرا قابل ادامه نیست.");
    return this.submit(run.conversationId, CONTINUE_PROMPT);
  }

  /** Spec R9: nothing survives a restart mid-run; waiting_limit timers are re-armed. */
  recover(): void {
    const stale = this.d.db.prepare("SELECT id, conversation_id FROM runs WHERE state IN ('running','waiting_approval')").all() as { id: string; conversation_id: string }[];
    for (const r of stale) this.finish(r.id, "interrupted", "restart");
    this.d.approvals.expireAllPending();
    this.d.requests?.expireAllPending();
    const limited = this.d.db.prepare("SELECT id, limit_reset_at FROM runs WHERE state = 'waiting_limit'").all() as { id: string; limit_reset_at: string | null }[];
    for (const r of limited) this.armLimitTimer(r.id, r.limit_reset_at ? Date.parse(r.limit_reset_at) : this.clock());
    this.pump();
  }

  /** Starts queued runs FIFO while below the concurrency limit. */
  pump(): void {
    if (this.d.networkUp && !this.d.networkUp()) return;
    const max = this.d.settings.maxConcurrentRuns();
    while (this.active.size - this.blocked.size < max) {
      const next = this.d.db.prepare("SELECT * FROM runs WHERE state = 'queued' ORDER BY created_at LIMIT 1").get() as RunRow | undefined;
      if (!next) return;
      const ctrl = new AbortController();
      this.active.set(next.id, ctrl);
      this.setState(next.id, "running", { started: next.started_at === null });
      const p = this.execute(toRun(next), ctrl).finally(() => {
        this.active.delete(next.id);
        this.running = this.running.filter((x) => x !== p);
        this.pump();
      });
      this.running.push(p);
    }
  }

  onRunEnd(fn: (run: Run) => void): () => void {
    this.endListeners.push(fn);
    return () => {
      this.endListeners = this.endListeners.filter((l) => l !== fn);
    };
  }

  /**
   * Spec 005: a bot hands a task to another bot and waits for its answer. Limits stop runaway chains:
   * depth, total per top-level run, and never back to a bot already in the chain.
   */
  async delegate(parent: Run, targetBotId: string, task: string, signal: AbortSignal): Promise<string> {
    const depth = parent.depth + 1;
    if (depth > MAX_DELEGATION_DEPTH) throw new HttpError(409, "too_deep", `بیش از ${MAX_DELEGATION_DEPTH} سطح سپردن کار مجاز نیست.`);
    const chain = this.ancestors(parent);
    const root = chain[chain.length - 1]!;
    if (chain.some((r) => this.d.bots.conversation(r.conversationId).botId === targetBotId)) throw new HttpError(409, "cycle", "این بات همین حالا در زنجیرهٔ این کار است.");
    const { n } = this.d.db
      .prepare("WITH RECURSIVE tree(id) AS (SELECT id FROM runs WHERE id = ? UNION ALL SELECT r.id FROM runs r JOIN tree ON r.parent_run_id = tree.id) SELECT COUNT(*) - 1 AS n FROM tree")
      .get(root.id) as { n: number };
    if (n >= MAX_DELEGATIONS_PER_ROOT) throw new HttpError(409, "too_many", `سقف ${MAX_DELEGATIONS_PER_ROOT} کار سپرده‌شده پر شده است.`);
    const from = this.d.bots.get(this.d.bots.conversation(parent.conversationId).botId);
    const target = this.d.bots.get(targetBotId);
    const conv = this.d.bots.createConversation(targetBotId, `از ${from.name}: ${task.slice(0, 50)}`);
    this.blocked.set(parent.id, (this.blocked.get(parent.id) ?? 0) + 1);
    const child = this.submit(conv.id, task, { parentRunId: parent.id, depth });
    this.d.events.append(parent.id, "notice", { delegated: { runId: child.id, conversationId: conv.id, botName: target.name } });
    const onAbort = (): void => void this.cancel(child.id);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const done = await new Promise<Run>((resolve) => {
        const off = this.onRunEnd((r) => {
          if (r.id !== child.id) return;
          off();
          resolve(r);
        });
        const cur = this.get(child.id);
        if (TERMINAL.includes(cur.state)) {
          off();
          resolve(cur);
        }
      });
      if (done.state !== "done") return `بات ${target.name} کار را تمام نکرد (وضعیت: ${done.state}).`;
      return this.resultText(done.id) ?? "(بدون متن)";
    } finally {
      signal.removeEventListener("abort", onAbort);
      const left = (this.blocked.get(parent.id) ?? 1) - 1;
      if (left > 0) this.blocked.set(parent.id, left);
      else this.blocked.delete(parent.id);
    }
  }

  /**
   * Spec 009: a message to another bot does not wait. Each pair of bots keeps one conversation, so the
   * other side remembers it, and a reply is simply another message. Depth and the per-task total stop loops.
   */
  sendToBot(parent: Run, targetBotId: string, message: string): Run {
    const depth = parent.depth + 1;
    if (depth > MAX_MESSAGE_DEPTH) throw new HttpError(409, "too_deep", "این رشته پیام خیلی بلند شد؛ نتیجه را به کاربر بگو.");
    const root = this.ancestors(parent).at(-1)!;
    const { n } = this.d.db
      .prepare("WITH RECURSIVE tree(id) AS (SELECT id FROM runs WHERE id = ? UNION ALL SELECT r.id FROM runs r JOIN tree ON r.parent_run_id = tree.id) SELECT COUNT(*) - 1 AS n FROM tree")
      .get(root.id) as { n: number };
    if (n >= MAX_DELEGATIONS_PER_ROOT) throw new HttpError(409, "too_many", `سقف ${MAX_DELEGATIONS_PER_ROOT} پیام بین بات‌ها در این کار پر شده است.`);
    const from = this.d.bots.get(this.d.bots.conversation(parent.conversationId).botId);
    const target = this.d.bots.get(targetBotId);
    if (from.id === target.id) throw new HttpError(409, "self", "بات نمی‌تواند به خودش پیام بدهد.");
    const title = `پیام از ${from.name}`;
    const conv = this.d.bots.conversations(target.id).find((c) => c.title === title) ?? this.d.bots.createConversation(target.id, title);
    const child = this.submit(conv.id, `Message from the bot "${from.name}". To reply, use send_message_to_bot. If it needs no reply, finish without sending one.\n\n${message}`, { parentRunId: parent.id, depth });
    this.d.events.append(parent.id, "notice", { messaged: { runId: child.id, conversationId: conv.id, botName: target.name } });
    return child;
  }

  /** Pauses a run on something only the person can give. The answer comes from any channel. */
  async askUser(run: Run, kind: RequestKind, payload: RequestPayload, signal: AbortSignal): Promise<UserRequest> {
    if (!this.d.requests) throw new HttpError(501, "disabled", "این امکان فعال نیست.");
    const { request, done } = this.d.requests.ask(run.id, kind, payload, signal);
    this.d.events.append(run.id, "request", { requestId: request.id, kind, payload, state: "pending" });
    this.setState(run.id, "waiting_approval");
    const final = await done;
    this.d.events.append(run.id, "request", { requestId: request.id, kind, state: final.state, answer: final.answer, channel: final.channel });
    if (!signal.aborted) this.setState(run.id, "running");
    return final;
  }

  private ancestors(run: Run): Run[] {
    const out = [run];
    for (let cur = run; cur.parentRunId; ) {
      cur = this.get(cur.parentRunId);
      out.push(cur);
    }
    return out;
  }

  /** The final answer of a finished run, for notifications and delegation. */
  resultText(runId: string): string | null {
    const rows = this.d.db.prepare("SELECT payload FROM events WHERE run_id = ? AND type IN ('result','assistant_text') ORDER BY seq DESC LIMIT 5").all(runId) as { payload: string }[];
    for (const r of rows) {
      const p = JSON.parse(r.payload) as { text?: string | null };
      if (p.text) return p.text;
    }
    return null;
  }

  /** Waits for all in-flight runs (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.running.length) await Promise.allSettled(this.running);
  }

  async shutdown(): Promise<void> {
    for (const ctrl of this.active.values()) ctrl.abort("shutdown" satisfies AbortReason);
    for (const t of this.limitTimers.values()) clearTimeout(t);
    await this.idle();
  }

  private systemPromptFor(bot: Bot): string {
    const notesPath = join(this.d.bots.botDir(bot), "CLAUDE.md");
    let notes = "";
    try {
      notes = readFileSync(notesPath, "utf8").slice(0, 20_000);
    } catch {
      // first run: the file does not exist yet
    }
    return [
      `You are the bot "${bot.name}" in the user's personal linuxAgent panel. Reply in the user's language.`,
      bot.persona ? `Your role and personality:\n${bot.persona}` : "",
      `Shared workspace (shared with other bots): ${this.d.workspaceDir}`,
      `Your own notes file: ${notesPath}. Keep it short and update it when you learn something worth remembering.`,
      notes ? `Current contents of your notes file:\n${notes}` : "",
      this.d.promptExtras?.(bot) ?? "",
      "Sensitive actions (deleting, pushing, sending, installing, anything outside your home folder) pause for the user's approval. If an action is not approved, do not try to get around it.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private async execute(run: Run, ctrl: AbortController): Promise<void> {
    const conv = this.d.bots.conversation(run.conversationId);
    const bot = this.d.bots.get(conv.botId);
    this.d.bots.ensureDir(bot);
    const timer = setTimeout(() => ctrl.abort("timeout" satisfies AbortReason), bot.maxMinutes * 60_000);
    timer.unref?.();
    let rateLimitedUntil: number | null = null;
    let sawRejection = false;
    let finished = false;

    const gate = async (toolName: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolDecision> => {
      // Claude's own question tool becomes the same multiple-choice card as ask_user.
      if (toolName === "AskUserQuestion" && this.d.requests) {
        const questions = (input.questions ?? []) as Question[];
        const final = await this.askUser(run, "questions", { questions }, signal);
        if (final.state !== "answered") return { allow: false, message: "کاربر به این پرسش جواب نداد." };
        const answers = Object.fromEntries(Object.entries(final.answer?.answers ?? {}).map(([q, a]) => [q, a.join(", ")]));
        return { allow: true, updatedInput: { ...input, answers } };
      }
      if (bot.allowedTools && !bot.allowedTools.includes(toolName) && !toolName.startsWith("mcp__"))
        return { allow: false, message: MSG_TOOL_NOT_ALLOWED };
      const policy = evaluateTool(toolName, input, this.d.agentHome, this.d.policyOptions?.());
      if (policy.auto) return { allow: true };
      const { approval, decision } = this.d.approvals.request(run.id, toolName, input, policy.reason, signal);
      this.d.events.append(run.id, "approval", { approvalId: approval.id, toolName, input, reason: policy.reason, state: "pending" });
      this.setState(run.id, "waiting_approval");
      const allowed = await decision;
      const final = this.d.approvals.get(approval.id);
      this.d.events.append(run.id, "approval", { approvalId: approval.id, toolName, state: final?.state, channel: final?.decidedByChannel });
      if (!ctrl.signal.aborted) this.setState(run.id, "running");
      return allowed ? { allow: true } : { allow: false, message: MSG_NOT_APPROVED };
    };

    // A run re-queued after a limit pause (or a manual continue) resumes the session instead of repeating the prompt.
    const prompt = run.startedAt !== null ? CONTINUE_PROMPT : run.prompt;

    try {
      const stream = this.d.engine.start({
        prompt,
        sessionId: conv.engineSessionId,
        cwd: this.d.workspaceDir,
        additionalDirectories: [this.d.bots.botDir(bot)],
        systemPromptAppend: this.systemPromptFor(bot),
        model: bot.model ?? this.d.settings.defaultModel(),
        allowedTools: bot.allowedTools,
        maxTurns: bot.maxTurns,
        canUseTool: gate,
        panelTools: this.d.toolsFor?.({ run, bot, signal: ctrl.signal }),
        mcpServers: this.d.mcpServersFor?.(bot),
        abortController: ctrl,
      });
      for await (const ev of stream) {
        this.handle(run.id, conv.id, ev);
        if (ev.kind === "rate_limit" && ev.status === "rejected") {
          sawRejection = true;
          rateLimitedUntil = ev.resetsAt;
        }
        if (ev.kind === "result") {
          finished = true;
          if (ev.ok) this.finish(run.id, "done", null);
          else if (ev.subtype === "error_max_turns") this.finish(run.id, "failed", "max_turns", MSG_MAX_TURNS);
          else if (sawRejection || ev.errorKind === "rate_limit") this.pauseForLimit(run.id, rateLimitedUntil);
          else this.finish(run.id, "failed", "engine_error", ev.text ?? ev.subtype);
        }
      }
      if (!finished) this.endAfterAbortOrError(run.id, ctrl, sawRejection, rateLimitedUntil, null);
    } catch (err) {
      if (!finished) this.endAfterAbortOrError(run.id, ctrl, sawRejection, rateLimitedUntil, err);
    } finally {
      clearTimeout(timer);
    }
  }

  private endAfterAbortOrError(runId: string, ctrl: AbortController, limited: boolean, until: number | null, err: unknown): void {
    const reason = ctrl.signal.aborted ? (ctrl.signal.reason as AbortReason) : null;
    if (reason === "cancel") this.finish(runId, "cancelled", "cancelled");
    else if (reason === "timeout") this.finish(runId, "failed", "max_minutes", MSG_MAX_MINUTES);
    else if (reason === "shutdown") this.finish(runId, "interrupted", "restart");
    else if (limited) this.pauseForLimit(runId, until);
    else {
      const message = err instanceof Error ? err.message : err ? String(err) : "engine stopped without a result";
      this.d.events.append(runId, "error", { message });
      this.finish(runId, "failed", "engine_error", message);
    }
  }

  private handle(runId: string, conversationId: string, ev: EngineEvent): void {
    switch (ev.kind) {
      case "session":
        this.d.db.prepare("UPDATE conversations SET engine_session_id = ?, updated_at = ? WHERE id = ?").run(ev.sessionId, now(), conversationId);
        break;
      case "text":
        this.d.events.append(runId, "assistant_text", { text: ev.text });
        break;
      case "tool_use":
        this.d.events.append(runId, "tool_use", { id: ev.id, name: ev.name, input: ev.input });
        break;
      case "tool_result":
        this.d.events.append(runId, "tool_result", { toolUseId: ev.toolUseId, content: ev.content, isError: ev.isError });
        break;
      case "rate_limit":
        if (ev.status !== "allowed") this.d.events.append(runId, "notice", { rateLimit: ev.status, resetsAt: ev.resetsAt });
        break;
      case "result":
        this.d.db
          .prepare("UPDATE runs SET turns = turns + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cost_estimate_usd = cost_estimate_usd + ? WHERE id = ?")
          .run(ev.turns, ev.inputTokens, ev.outputTokens, ev.costUsd, runId);
        this.d.events.append(runId, "result", ev);
        break;
    }
  }

  /** Spec R13: pause and re-queue after the reset time (or 30 minutes if unknown). */
  private pauseForLimit(runId: string, resetsAt: number | null): void {
    const at = resetsAt ?? this.clock() + LIMIT_RETRY_MS;
    this.d.db.prepare("UPDATE runs SET limit_reset_at = ? WHERE id = ?").run(new Date(at).toISOString(), runId);
    this.setState(runId, "waiting_limit");
    this.armLimitTimer(runId, at);
  }

  private armLimitTimer(runId: string, at: number): void {
    clearTimeout(this.limitTimers.get(runId));
    const t = setTimeout(() => {
      this.limitTimers.delete(runId);
      const run = this.get(runId);
      if (run.state !== "waiting_limit") return;
      this.setState(runId, "queued");
      this.pump();
    }, Math.max(0, at - this.clock()));
    t.unref?.();
    this.limitTimers.set(runId, t);
  }

  private setState(runId: string, state: RunState, opts: { started?: boolean } = {}): void {
    if (opts.started) this.d.db.prepare("UPDATE runs SET state = ?, started_at = ? WHERE id = ?").run(state, now(), runId);
    else this.d.db.prepare("UPDATE runs SET state = ? WHERE id = ?").run(state, runId);
    const run = this.get(runId);
    this.d.events.append(runId, "state", { state, limitResetAt: run.limitResetAt });
    this.d.events.activity({ kind: "run", runId, conversationId: run.conversationId, state });
  }

  private finish(runId: string, state: RunState, reason: RunEndReason, message?: string): void {
    this.d.db.prepare("UPDATE runs SET state = ?, reason = ?, ended_at = ? WHERE id = ?").run(state, reason, now(), runId);
    const run = this.get(runId);
    this.d.events.append(runId, "state", { state, reason, message: message ?? null });
    this.d.events.activity({ kind: "run", runId, conversationId: run.conversationId, state });
    for (const l of this.endListeners) l(run);
  }
}
