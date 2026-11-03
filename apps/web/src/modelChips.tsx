import { MODEL_CHOICES, type Bot, type BotInput, type Effort, type ModelCatalog } from "@linux-agent/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "./api";
import { IconCheck, IconChevronDown, IconCpu, IconRefresh, IconSliders } from "./icons";
import { useT } from "./i18n";
import { FloatingMenu } from "./popover";

type Open = { kind: "model" | "effort"; anchor: HTMLElement } | null;

const FALLBACK: ModelCatalog = {
  models: MODEL_CHOICES.map((m) => ({ id: m.id, name: m.name, version: "", description: "", efforts: ["low", "medium", "high", "max"] })),
  defaultEfforts: ["low", "medium", "high", "max"],
  updatedAt: null,
};

/** Model and effort of one bot, changed right above the composer. Every change is saved at once and applies from the next message. */
export function ModelChips({ bot, onChanged, extra }: { bot: Bot; onChanged: (b: Bot) => void; extra?: ReactNode }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState<Open>(null);
  const [other, setOther] = useState("");
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<ModelCatalog>(FALLBACK);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    api.get<ModelCatalog>("/api/models").then(setCatalog, () => {});
  }, []);
  const refresh = async () => {
    setError("");
    setRefreshing(true);
    try {
      setCatalog(await api.post<ModelCatalog>("/api/models/refresh"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const nameOf = (id: string | null): string => (id ? (catalog.models.find((m) => m.id === id)?.name ?? id) : t.modelDefault);
  // A model without an effort setting (Haiku) hides the chip; the default model uses the panel default's levels.
  const efforts: Effort[] = bot.model === null ? catalog.defaultEfforts : (catalog.models.find((m) => m.id === bot.model)?.efforts ?? catalog.defaultEfforts);
  const pickModel = (model: string | null) => {
    const next = model === null ? catalog.defaultEfforts : (catalog.models.find((m) => m.id === model)?.efforts ?? catalog.defaultEfforts);
    void save({ model, ...(bot.effort && !next.includes(bot.effort) ? { effort: null } : {}) });
  };

  const save = async (patch: Partial<BotInput>) => {
    setError("");
    try {
      onChanged(await api.patch<Bot>(`/api/bots/${bot.id}`, patch));
      setOpen(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const custom = bot.model !== null && !catalog.models.some((m) => m.id === bot.model);
  const submitOther = (e: FormEvent) => {
    e.preventDefault();
    if (other.trim()) void save({ model: other.trim() });
  };

  return (
    <div className="tune" data-testid="model-chips">
      <button type="button" className="chip" aria-haspopup="dialog" onClick={(e) => setOpen({ kind: "model", anchor: e.currentTarget })}>
        <IconCpu size={14} />
        {t.modelChip}:{" "}
        <span className="chip-val" dir="ltr">
          {nameOf(bot.model)}
        </span>
        <IconChevronDown size={12} />
      </button>
      {efforts.length > 0 && (
        <button type="button" className="chip" aria-haspopup="dialog" onClick={(e) => setOpen({ kind: "effort", anchor: e.currentTarget })}>
          <IconSliders size={14} />
          {t.effortChip}: <span className="chip-val">{bot.effort && efforts.includes(bot.effort) ? t.efforts[bot.effort] : t.effortDefault}</span>
          <IconChevronDown size={12} />
        </button>
      )}

      {open?.kind === "model" && (
        <FloatingMenu anchor={open.anchor} label={t.modelMenuTitle} onClose={() => setOpen(null)}>
          <h4 className="pop-title">{t.modelMenuTitle}</h4>
          {error && <div className="err">{error}</div>}
          <button type="button" className={`opt${bot.model === null ? " on" : ""}`} onClick={() => pickModel(null)}>
            <span>
              <b>{t.modelDefault}</b>
              <small>{t.modelDefaultHint}</small>
            </span>
            <span className="tick">{bot.model === null && <IconCheck size={12} />}</span>
          </button>
          {catalog.models.map((m) => (
            <button key={m.id} type="button" className={`opt${bot.model === m.id ? " on" : ""}`} onClick={() => pickModel(m.id)}>
              <span>
                <b>
                  <bdi dir="ltr">{m.name}</bdi>
                </b>
                <small>
                  {t.modelHints[m.id] ?? m.description}
                  {m.version && (
                    <>
                      {" · "}
                      <bdi dir="ltr">{m.version}</bdi>
                    </>
                  )}
                </small>
              </span>
              <span className="tick">{bot.model === m.id && <IconCheck size={12} />}</span>
            </button>
          ))}
          <div className="opt-refresh">
            <button type="button" disabled={refreshing} onClick={() => void refresh()}>
              <IconRefresh size={13} />
              {refreshing ? t.modelRefreshing : t.modelRefresh}
            </button>
            <small>{catalog.updatedAt ? `${t.modelUpdated}: ${new Date(catalog.updatedAt).toLocaleDateString(locale)}` : t.modelNotRefreshed}</small>
          </div>
          <form className="opt-other" onSubmit={submitOther}>
            <label>
              {t.modelOther}
              <input dir="ltr" value={other || (custom ? (bot.model ?? "") : "")} placeholder={t.modelOtherHint} maxLength={100} onChange={(e) => setOther(e.target.value)} />
            </label>
            <button className="primary" disabled={!other.trim()}>
              {t.save}
            </button>
          </form>
        </FloatingMenu>
      )}

      {open?.kind === "effort" && (
        <FloatingMenu anchor={open.anchor} label={t.effortMenuTitle} onClose={() => setOpen(null)}>
          <h4 className="pop-title">{t.effortMenuTitle}</h4>
          <p className="pop-note">{t.effortHelp}</p>
          {error && <div className="err">{error}</div>}
          <div className="seg" role="radiogroup" aria-label={t.effortMenuTitle}>
            {([null, ...efforts] as (Effort | null)[]).map((lv) => (
              <button key={lv ?? "default"} type="button" role="radio" aria-checked={bot.effort === lv} className={bot.effort === lv ? "on" : ""} onClick={() => void save({ effort: lv })}>
                {lv ? t.efforts[lv] : t.effortDefault}
              </button>
            ))}
          </div>
        </FloatingMenu>
      )}
      {extra}
    </div>
  );
}
