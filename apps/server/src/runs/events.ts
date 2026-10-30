import type { RunEvent, RunEventType } from "@linux-agent/shared";
import { EventEmitter } from "node:events";
import type { Db } from "../db.js";
import { now } from "../db.js";

/** Activity is anything the top bar or lists care about: run state changes and approvals. */
export type Activity = { kind: "run"; runId: string; conversationId: string; state: string } | { kind: "approval"; approvalId: string; state: string };

/**
 * Spec R6: every event is written first, then broadcast. Readers replay by `seq` and then follow live,
 * so a reconnecting client neither loses nor duplicates events.
 */
export class EventStore {
  private seqs = new Map<string, number>();
  private bus = new EventEmitter();

  constructor(private db: Db) {
    this.bus.setMaxListeners(0);
  }

  append(runId: string, type: RunEventType, payload: unknown): RunEvent {
    let seq = this.seqs.get(runId);
    if (seq === undefined) {
      const row = this.db.prepare("SELECT MAX(seq) AS s FROM events WHERE run_id = ?").get(runId) as { s: number | null };
      seq = row.s ?? 0;
    }
    seq += 1;
    this.seqs.set(runId, seq);
    const ev: RunEvent = { runId, seq, type, payload, createdAt: now() };
    this.db
      .prepare("INSERT INTO events (run_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(runId, seq, type, JSON.stringify(payload ?? null), ev.createdAt);
    this.bus.emit(`run:${runId}`, ev);
    return ev;
  }

  /** Events with seq > after, oldest first, at most `limit`. */
  page(runId: string, after: number, limit = 1000): RunEvent[] {
    const rows = this.db
      .prepare("SELECT run_id, seq, type, payload, created_at FROM events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(runId, after, limit) as { run_id: string; seq: number; type: RunEventType; payload: string; created_at: string }[];
    return rows.map((r) => ({ runId: r.run_id, seq: r.seq, type: r.type, payload: JSON.parse(r.payload) as unknown, createdAt: r.created_at }));
  }

  subscribe(runId: string, fn: (ev: RunEvent) => void): () => void {
    this.bus.on(`run:${runId}`, fn);
    return () => this.bus.off(`run:${runId}`, fn);
  }

  activity(a: Activity): void {
    this.bus.emit("activity", a);
  }

  onActivity(fn: (a: Activity) => void): () => void {
    this.bus.on("activity", fn);
    return () => this.bus.off("activity", fn);
  }
}
