import { EFFORT_LEVELS, MODEL_CHOICES, type Effort, type ModelCatalog, type ModelOption } from "@linux-agent/shared";
import type { Engine, EngineModel } from "./engine/types.js";
import { HttpError } from "./bots.js";
import type { SettingsStore } from "./settings.js";

const KEY = "models.catalog";
const STANDARD: Effort[] = ["low", "medium", "high", "max"];

const levels = (list: string[] | undefined): Effort[] => (list ?? []).filter((l): l is Effort => (EFFORT_LEVELS as readonly string[]).includes(l));

/** The built-in list, used until the user refreshes once. */
export const BUILT_IN: ModelCatalog = {
  models: MODEL_CHOICES.map((m) => ({ id: m.id, name: m.name, version: "", description: "", efforts: STANDARD })),
  defaultEfforts: STANDARD,
  updatedAt: null,
};

/** Spec: the model list is read from Claude Code only when the user presses refresh, and saved for every other time. */
export class ModelCatalogService {
  constructor(
    private settings: SettingsStore,
    private engine: Engine,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  get(): ModelCatalog {
    const raw = this.settings.get(KEY);
    if (!raw) return BUILT_IN;
    try {
      const c = JSON.parse(raw) as ModelCatalog;
      return Array.isArray(c.models) && c.models.length ? c : BUILT_IN;
    } catch {
      return BUILT_IN;
    }
  }

  async refresh(): Promise<ModelCatalog> {
    if (!this.engine.listModels) throw new HttpError(501, "unsupported", "این موتور فهرست مدل‌ها را نمی‌دهد.");
    let found: EngineModel[];
    try {
      found = await this.engine.listModels();
    } catch (e) {
      throw new HttpError(502, "models_failed", `گرفتن فهرست مدل‌ها ناموفق بود: ${(e as Error).message}`);
    }
    const def = found.find((m) => m.value === "default");
    const defaultEfforts = levels(def?.supportedEffortLevels);
    const models: ModelOption[] = found
      .filter((m) => m.value !== "default")
      .map((m) => ({ id: m.value, name: m.displayName, version: m.description.split(" · ")[0] ?? "", description: m.description, efforts: levels(m.supportedEffortLevels) }));
    // "sonnet" is what Claude Code calls its default, so it has no row of its own.
    if (!models.some((m) => m.id === "sonnet")) models.splice(1, 0, { id: "sonnet", name: "Sonnet", version: def?.description.split(" · ")[0] ?? "", description: "", efforts: defaultEfforts.length ? defaultEfforts : STANDARD });
    if (models.length < 2) throw new HttpError(502, "models_failed", "فهرست مدل‌ها خالی برگشت.");
    const catalog: ModelCatalog = { models, defaultEfforts: defaultEfforts.length ? defaultEfforts : STANDARD, updatedAt: this.now() };
    this.settings.set(KEY, JSON.stringify(catalog));
    return catalog;
  }
}
