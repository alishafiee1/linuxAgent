import type { Bot, Run, RunEndReason, RunState } from "@linux-agent/shared";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateTool } from "../approval/policy.js";
import { MSG_NOT_APPROVED, type ApprovalService } from "../approval/service.js";
import { HttpError, type BotService } from "../bots.js";
import type { Db } from "../db.js";
import { now } from "../db.js";
import type { Engine, EngineEvent, ToolDecision } from "../engine/types.js";
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
});

type AbortReason = "cancel" | "timeout" | "shutdown";

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
  clock?: () => number;
}

export class Orchestrator {
  private active = new Map<string, AbortController>();
  private limitTimers = new Map<string, NodeJS.Timeout>();
  private running: Promise<void>[] = [];
  private clock: () => number;

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
  submit(conversationId: string, prompt: string): Run {
    const conv = this.d.bots.conversation(conversationId);
    const text = prompt.trim();
    if (!text) throw new HttpError(400, "empty", "پیام خالی است.");
    const id = randomUUID();
    const t = now();
    this.d.db
      .prepare("INSERT INTO runs (id, conversation_id, prompt, state, created_at) VALUES (?, ?, ?, 'queued', ?)")
      .run(id, conv.id, text, t);
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
    const limited = this.d.db.prepare("SELECT id, limit_reset_at FROM runs WHERE state = 'waiting_limit'").all() as { id: string; limit_reset_at: string | null }[];
    for (const r of limited) this.armLimitTimer(r.id, r.limit_reset_at ? Date.parse(r.limit_reset_at) : this.clock());
    this.pump();
  }

  /** Starts queued runs FIFO while below the concurrency limit. */
  pump(): void {
    if (this.d.networkUp && !this.d.networkUp()) return;
    const max = this.d.settings.maxConcurrentRuns();
    while (this.active.size < max) {
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
      if (bot.allowedTools && !bot.allowedTools.includes(toolName) && !toolName.startsWith("mcp__"))
        return { allow: false, message: MSG_TOOL_NOT_ALLOWED };
      const policy = evaluateTool(toolName, input, this.d.agentHome);
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
  }
}
