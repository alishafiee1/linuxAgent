import type { Approval, ApprovalChannel, ApprovalState } from "@linux-agent/shared";
import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import { now } from "../db.js";
import { describeTool } from "./describe.js";

export const APPROVAL_TTL_MS = 24 * 3_600_000;
export const MSG_NOT_APPROVED = "کاربر این کار را تأیید نکرد.";
export const MSG_ALREADY_DECIDED = "قبلاً تصمیم گرفته شده است.";

interface ApprovalRow {
  id: string;
  run_id: string;
  tool_name: string;
  input: string;
  reason: string;
  state: ApprovalState;
  decided_by_channel: ApprovalChannel | null;
  created_at: string;
  decided_at: string | null;
  bot_name: string;
}

const toApproval = (r: ApprovalRow): Approval => ({
  id: r.id,
  runId: r.run_id,
  botName: r.bot_name,
  toolName: r.tool_name,
  input: JSON.parse(r.input) as unknown,
  summary: describeTool(r.tool_name, JSON.parse(r.input)),
  reason: r.reason,
  state: r.state,
  decidedByChannel: r.decided_by_channel,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

const SELECT = `SELECT a.*, b.name AS bot_name FROM approvals a
  JOIN runs r ON r.id = a.run_id JOIN conversations c ON c.id = r.conversation_id JOIN bots b ON b.id = c.bot_id`;

export interface ApprovalListener {
  created(a: Approval): void;
  decided(a: Approval): void;
}

export type DecideResult = { ok: true; approval: Approval } | { ok: false; approval: Approval | null };

export class ApprovalService {
  private waiters = new Map<string, (allowed: boolean) => void>();
  private listeners: ApprovalListener[] = [];

  constructor(
    private db: Db,
    private ttlMs = APPROVAL_TTL_MS,
  ) {}

  onChange(l: ApprovalListener): void {
    this.listeners.push(l);
  }

  get(id: string): Approval | null {
    const row = this.db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as ApprovalRow | undefined;
    return row ? toApproval(row) : null;
  }

  list(state?: ApprovalState): Approval[] {
    const rows = state
      ? (this.db.prepare(`${SELECT} WHERE a.state = ? ORDER BY a.created_at`).all(state) as ApprovalRow[])
      : (this.db.prepare(`${SELECT} ORDER BY a.created_at DESC LIMIT 200`).all() as ApprovalRow[]);
    return rows.map(toApproval);
  }

  /** Creates a pending approval and resolves when it is decided, expires, or `signal` aborts (→ denied). */
  request(runId: string, toolName: string, input: unknown, reason: string, signal: AbortSignal): { approval: Approval; decision: Promise<boolean> } {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO approvals (id, run_id, tool_name, input, reason, state, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
      .run(id, runId, toolName, JSON.stringify(input ?? null), reason, now());
    const approval = this.get(id)!;
    const expire = (): void => {
      this.finish(id, false, "timeout", "expired");
    };
    const timer = setTimeout(expire, this.ttlMs);
    timer.unref?.();
    const decision = new Promise<boolean>((resolve) => {
      this.waiters.set(id, (allowed) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", expire);
        resolve(allowed);
      });
    });
    for (const l of this.listeners) l.created(approval);
    if (signal.aborted) expire();
    else signal.addEventListener("abort", expire, { once: true });
    return { approval, decision };
  }

  /** First answer wins (spec R11, edge case). */
  decide(id: string, allow: boolean, channel: ApprovalChannel): DecideResult {
    const current = this.get(id);
    if (!current || current.state !== "pending") return { ok: false, approval: current };
    const approval = this.finish(id, allow, channel, allow ? "allowed" : "denied");
    return approval ? { ok: true, approval } : { ok: false, approval: this.get(id) };
  }

  private finish(id: string, allow: boolean, channel: ApprovalChannel, state: ApprovalState): Approval | null {
    const changed = this.db
      .prepare("UPDATE approvals SET state = ?, decided_by_channel = ?, decided_at = ? WHERE id = ? AND state = 'pending'")
      .run(state, channel, now(), id).changes;
    if (changed === 0) return null;
    const approval = this.get(id)!;
    this.waiters.get(id)?.(allow);
    this.waiters.delete(id);
    for (const l of this.listeners) l.decided(approval);
    return approval;
  }

  /** On boot nothing can be waiting any more (spec R9). */
  expireAllPending(): void {
    this.db.prepare("UPDATE approvals SET state = 'expired', decided_by_channel = 'timeout', decided_at = ? WHERE state = 'pending'").run(now());
  }
}
