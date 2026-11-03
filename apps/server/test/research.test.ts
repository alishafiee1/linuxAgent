import { describe, expect, it } from "vitest";
import { RESEARCH_PROMPT } from "../src/runs/orchestrator.js";
import { FakeEngine, ok, setup } from "./helpers.js";

describe("deep research", () => {
  it("adds the research steps for the bot but shows only the typed text (R1, R2)", async () => {
    const engine = new FakeEngine(() => [ok()]);
    const t = setup(engine);
    const run = t.orchestrator.submit(t.conv.id, "قیمت طلا", { research: true });
    await t.orchestrator.idle();
    expect(engine.calls[0]!.prompt).toContain(RESEARCH_PROMPT);
    const user = t.events.page(run.id, 0).find((e) => e.type === "user")!;
    expect(user.payload).toEqual({ text: "قیمت طلا", research: true });
  });

  it("leaves a normal message untouched (R3)", async () => {
    const engine = new FakeEngine(() => [ok()]);
    const t = setup(engine);
    t.orchestrator.submit(t.conv.id, "سلام");
    await t.orchestrator.idle();
    expect(engine.calls[0]!.prompt).toBe("سلام");
  });
});
