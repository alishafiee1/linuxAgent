import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalService } from "../src/approval/service.js";
import { BotService } from "../src/bots.js";
import { openDb, type Db } from "../src/db.js";
import type { Engine, EngineEvent, EngineStartOptions } from "../src/engine/types.js";
import { EventStore } from "../src/runs/events.js";
import { Orchestrator } from "../src/runs/orchestrator.js";
import { SettingsStore } from "../src/settings.js";

export const KEY = Buffer.alloc(32, 7);

/** A scripted engine: each step yields events or asks the tool gate. */
export type Step = EngineEvent | { gate: string; input: Record<string, unknown> } | { wait: Promise<void> } | { throw: Error };

export class FakeEngine implements Engine {
  readonly name = "fake";
  calls: EngineStartOptions[] = [];
  decisions: { tool: string; allow: boolean }[] = [];
  constructor(public script: (call: number) => Step[]) {}

  async *start(o: EngineStartOptions): AsyncIterable<EngineEvent> {
    const n = this.calls.push(o) - 1;
    for (const step of this.script(n)) {
      if (o.abortController.signal.aborted) throw new Error("aborted");
      if ("gate" in step) {
        const d = await o.canUseTool(step.gate, step.input, o.abortController.signal);
        this.decisions.push({ tool: step.gate, allow: d.allow });
      } else if ("wait" in step) {
        await Promise.race([
          step.wait,
          new Promise((_, rej) => o.abortController.signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true })),
        ]);
      } else if ("throw" in step) throw step.throw;
      else yield step;
    }
  }
}

export const ok = (turns = 1): EngineEvent => ({ kind: "result", ok: true, subtype: "success", turns, inputTokens: 10, outputTokens: 5, costUsd: 0.01, text: "done", errorKind: null });

export function setup(engine: Engine, opts: { networkUp?: () => boolean; maxConcurrent?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cwp-"));
  const db: Db = openDb(":memory:");
  const settings = new SettingsStore(db, KEY);
  if (opts.maxConcurrent) settings.set("maxConcurrentRuns", String(opts.maxConcurrent));
  const bots = new BotService(db, join(dir, "bots"));
  const approvals = new ApprovalService(db);
  const events = new EventStore(db);
  const orchestrator = new Orchestrator({
    db,
    engine,
    bots,
    approvals,
    events,
    settings,
    workspaceDir: join(dir, "workspace"),
    agentHome: dir,
    networkUp: opts.networkUp,
  });
  const bot = bots.create({ name: "Coder" });
  const conv = bots.createConversation(bot.id);
  return { dir, db, settings, bots, approvals, events, orchestrator, bot, conv };
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
