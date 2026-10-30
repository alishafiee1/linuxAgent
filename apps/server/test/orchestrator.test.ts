import { describe, expect, it, vi } from "vitest";
import { MSG_NOT_APPROVED } from "../src/approval/service.js";
import { MSG_BOT_BUSY } from "../src/bots.js";
import { CONTINUE_PROMPT, MSG_MAX_TURNS } from "../src/runs/orchestrator.js";
import { deferred, FakeEngine, ok, setup, tick } from "./helpers.js";

describe("orchestrator", () => {
  it("runs a message to done and stores events in order (R5, R6)", async () => {
    const engine = new FakeEngine(() => [{ kind: "session", sessionId: "s1" }, { kind: "text", text: "hi" }, ok(3)]);
    const t = setup(engine);
    const run = t.orchestrator.submit(t.conv.id, "hello");
    await t.orchestrator.idle();
    const done = t.orchestrator.get(run.id);
    expect(done.state).toBe("done");
    expect(done.turns).toBe(3);
    expect(t.bots.conversation(t.conv.id).engineSessionId).toBe("s1");
    const evs = t.events.page(run.id, 0);
    expect(evs.map((e) => e.seq)).toEqual(evs.map((_, i) => i + 1));
    expect(evs.map((e) => e.type)).toContain("assistant_text");
  });

  it("resumes the conversation's session on the next message (R9)", async () => {
    const engine = new FakeEngine(() => [{ kind: "session", sessionId: "s1" }, ok()]);
    const t = setup(engine);
    t.orchestrator.submit(t.conv.id, "one");
    await t.orchestrator.idle();
    t.orchestrator.submit(t.conv.id, "two");
    await t.orchestrator.idle();
    expect(engine.calls[0]!.sessionId).toBeNull();
    expect(engine.calls[1]!.sessionId).toBe("s1");
  });

  it("respects the concurrency limit (R5)", async () => {
    const gate = deferred();
    const engine = new FakeEngine(() => [{ wait: gate.promise }, ok()]);
    const t = setup(engine, { maxConcurrent: 2 });
    const c2 = t.bots.createConversation(t.bot.id);
    const c3 = t.bots.createConversation(t.bot.id);
    t.orchestrator.submit(t.conv.id, "a");
    t.orchestrator.submit(c2.id, "b");
    const third = t.orchestrator.submit(c3.id, "c");
    await tick();
    expect(t.orchestrator.counts()).toMatchObject({ running: 2, queued: 1 });
    expect(t.orchestrator.get(third.id).state).toBe("queued");
    gate.resolve();
    await t.orchestrator.idle();
    expect(t.orchestrator.get(third.id).state).toBe("done");
  });

  it("auto-allows safe tools and waits for approval on risky ones (R10, R11)", async () => {
    const engine = new FakeEngine(() => [
      { gate: "Read", input: { file_path: "/etc/passwd" } },
      { gate: "Bash", input: { command: "ls -la" } },
      { gate: "Bash", input: { command: "git push origin main" } },
      ok(),
    ]);
    const t = setup(engine);
    const run = t.orchestrator.submit(t.conv.id, "go");
    await tick(10);
    expect(t.orchestrator.get(run.id).state).toBe("waiting_approval");
    const [pending] = t.approvals.list("pending");
    expect(pending?.toolName).toBe("Bash");
    expect(t.approvals.decide(pending!.id, true, "telegram").ok).toBe(true);
    expect(t.approvals.decide(pending!.id, false, "panel").ok).toBe(false); // first answer wins
    await t.orchestrator.idle();
    expect(engine.decisions).toEqual([
      { tool: "Read", allow: true },
      { tool: "Bash", allow: true },
      { tool: "Bash", allow: true },
    ]);
    expect(t.orchestrator.get(run.id).state).toBe("done");
    expect(t.approvals.get(pending!.id)?.decidedByChannel).toBe("telegram");
  });

  it("denies with the Persian message when the user rejects", async () => {
    let message = "";
    const engine = new FakeEngine(() => [ok()]);
    engine.start = async function* (o) {
      const d = await o.canUseTool("Bash", { command: "rm -rf /home/agent/workspace/x" }, o.abortController.signal);
      if (!d.allow) message = d.message;
      yield ok();
    };
    const t = setup(engine);
    t.orchestrator.submit(t.conv.id, "go");
    await tick(10);
    t.approvals.decide(t.approvals.list("pending")[0]!.id, false, "panel");
    await t.orchestrator.idle();
    expect(message).toBe(MSG_NOT_APPROVED);
  });

  it("stops at max turns with the right message (R8)", async () => {
    const engine = new FakeEngine(() => [{ kind: "result", ok: false, subtype: "error_max_turns", turns: 50, inputTokens: 0, outputTokens: 0, costUsd: 0, text: null, errorKind: "error_max_turns" }]);
    const t = setup(engine);
    const run = t.orchestrator.submit(t.conv.id, "go");
    await t.orchestrator.idle();
    const r = t.orchestrator.get(run.id);
    expect(r).toMatchObject({ state: "failed", reason: "max_turns" });
    expect(t.events.page(run.id, 0).some((e) => (e.payload as { message?: string }).message === MSG_MAX_TURNS)).toBe(true);
  });

  it("cancel stops a running run (R7)", async () => {
    const engine = new FakeEngine(() => [{ wait: new Promise(() => {}) }]);
    const t = setup(engine);
    const run = t.orchestrator.submit(t.conv.id, "go");
    await tick();
    t.orchestrator.cancel(run.id);
    await t.orchestrator.idle();
    expect(t.orchestrator.get(run.id)).toMatchObject({ state: "cancelled", reason: "cancelled" });
  });

  it("pauses on a subscription limit and resumes with 'continue' after reset (R13)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const engine = new FakeEngine((n) =>
        n === 0
          ? [{ kind: "session", sessionId: "s1" }, { kind: "rate_limit", status: "rejected", resetsAt: Date.now() + 60_000 }, { kind: "result", ok: false, subtype: "error_during_execution", turns: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, text: null, errorKind: "error_during_execution" }]
          : [ok()],
      );
      const t = setup(engine);
      const run = t.orchestrator.submit(t.conv.id, "long task");
      await vi.advanceTimersByTimeAsync(1);
      await t.orchestrator.idle();
      expect(t.orchestrator.get(run.id).state).toBe("waiting_limit");
      expect(t.orchestrator.get(run.id).limitResetAt).not.toBeNull();
      await vi.advanceTimersByTimeAsync(61_000);
      await t.orchestrator.idle();
      expect(t.orchestrator.get(run.id).state).toBe("done");
      expect(engine.calls[1]!.prompt).toBe(CONTINUE_PROMPT);
      expect(engine.calls[1]!.sessionId).toBe("s1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks running runs interrupted on restart and continue resumes (R9)", async () => {
    const engine = new FakeEngine(() => [ok()]);
    const t = setup(engine);
    const run = t.orchestrator.submit(t.conv.id, "x");
    await t.orchestrator.idle();
    t.db.prepare("UPDATE runs SET state = 'running' WHERE id = ?").run(run.id);
    t.orchestrator.recover();
    expect(t.orchestrator.get(run.id)).toMatchObject({ state: "interrupted", reason: "restart" });
    const next = t.orchestrator.continueRun(run.id);
    await t.orchestrator.idle();
    expect(next.prompt).toBe(CONTINUE_PROMPT);
    expect(t.orchestrator.get(next.id).state).toBe("done");
  });

  it("keeps runs queued while the network is down (R20)", async () => {
    let up = false;
    const engine = new FakeEngine(() => [ok()]);
    const t = setup(engine, { networkUp: () => up });
    const run = t.orchestrator.submit(t.conv.id, "x");
    await tick();
    expect(t.orchestrator.get(run.id).state).toBe("queued");
    up = true;
    t.orchestrator.pump();
    await t.orchestrator.idle();
    expect(t.orchestrator.get(run.id).state).toBe("done");
  });

  it("refuses to delete a busy bot (edge case)", async () => {
    const engine = new FakeEngine(() => [{ wait: new Promise(() => {}) }]);
    const t = setup(engine);
    const run = t.orchestrator.submit(t.conv.id, "x");
    await tick();
    expect(() => t.bots.delete(t.bot.id)).toThrow(MSG_BOT_BUSY);
    t.orchestrator.cancel(run.id);
    await t.orchestrator.idle();
    t.bots.delete(t.bot.id);
    expect(t.bots.list()).toHaveLength(0);
  });
});
