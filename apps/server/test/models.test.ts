import { describe, expect, it } from "vitest";
import { BUILT_IN, ModelCatalogService } from "../src/models.js";
import type { EngineModel } from "../src/engine/types.js";
import { FakeEngine, ok, setup } from "./helpers.js";

const sdk: EngineModel[] = [
  { value: "default", displayName: "Default", description: "Sonnet 4.6 · everyday", supportedEffortLevels: ["low", "medium", "high", "max"] },
  { value: "opus", displayName: "Opus", description: "Opus 4.7 · most capable", supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
  { value: "haiku", displayName: "Haiku", description: "Haiku 4.5 · fastest" },
];

function make(listModels?: () => Promise<EngineModel[]>) {
  const t = setup(new FakeEngine(() => [ok()]));
  const engine = Object.assign(new FakeEngine(() => []), listModels ? { listModels } : {});
  return new ModelCatalogService(t.settings, engine, () => "2026-11-03T00:00:00.000Z");
}

describe("model list", () => {
  it("shows the built-in list until refreshed (R1)", () => {
    expect(make().get()).toEqual(BUILT_IN);
  });

  it("saves what Claude Code reports, with per-model effort levels (R2, R3)", async () => {
    const svc = make(async () => sdk);
    const c = await svc.refresh();
    expect(c.models.map((m) => m.id)).toEqual(["opus", "sonnet", "haiku"]);
    expect(c.models[0]!.efforts).toContain("xhigh");
    expect(c.models[2]!.efforts).toEqual([]);
    expect(c.models[1]!.version).toBe("Sonnet 4.6");
    expect(svc.get().updatedAt).toBe("2026-11-03T00:00:00.000Z");
  });

  it("keeps the saved list when a refresh fails (R4)", async () => {
    const t = setup(new FakeEngine(() => [ok()]));
    let fail = false;
    const engine = Object.assign(new FakeEngine(() => []), { listModels: async () => (fail ? Promise.reject(new Error("boom")) : sdk) });
    const svc = new ModelCatalogService(t.settings, engine);
    await svc.refresh();
    fail = true;
    await expect(svc.refresh()).rejects.toThrow();
    expect(svc.get().models.map((m) => m.id)).toContain("haiku");
  });
});
