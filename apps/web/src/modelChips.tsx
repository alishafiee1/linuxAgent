import { EFFORT_LEVELS, MODEL_CHOICES, type Bot, type BotInput, type Effort } from "@linux-agent/shared";
import { useState, type FormEvent } from "react";
import { api } from "./api";
import { IconCheck, IconChevronDown, IconCpu, IconSliders } from "./icons";
import { useT } from "./i18n";
import { FloatingMenu } from "./popover";

type Open = { kind: "model" | "effort"; anchor: HTMLElement } | null;

const modelName = (id: string | null, fallback: string): string => (id ? (MODEL_CHOICES.find((m) => m.id === id)?.name ?? id) : fallback);

/** Model and effort of one bot, changed right above the composer. Every change is saved at once and applies from the next message. */
export function ModelChips({ bot, onChanged }: { bot: Bot; onChanged: (b: Bot) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState<Open>(null);
  const [other, setOther] = useState("");
  const [error, setError] = useState("");

  const save = async (patch: Partial<BotInput>) => {
    setError("");
    try {
      onChanged(await api.patch<Bot>(`/api/bots/${bot.id}`, patch));
      setOpen(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const custom = bot.model !== null && !MODEL_CHOICES.some((m) => m.id === bot.model);
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
          {modelName(bot.model, t.modelDefault)}
        </span>
        <IconChevronDown size={12} />
      </button>
      <button type="button" className="chip" aria-haspopup="dialog" onClick={(e) => setOpen({ kind: "effort", anchor: e.currentTarget })}>
        <IconSliders size={14} />
        {t.effortChip}: <span className="chip-val">{bot.effort ? t.efforts[bot.effort] : t.effortDefault}</span>
        <IconChevronDown size={12} />
      </button>

      {open?.kind === "model" && (
        <FloatingMenu anchor={open.anchor} label={t.modelMenuTitle} onClose={() => setOpen(null)}>
          <h4 className="pop-title">{t.modelMenuTitle}</h4>
          {error && <div className="err">{error}</div>}
          <button type="button" className={`opt${bot.model === null ? " on" : ""}`} onClick={() => void save({ model: null })}>
            <span>
              <b>{t.modelDefault}</b>
              <small>{t.modelDefaultHint}</small>
            </span>
            <span className="tick">{bot.model === null && <IconCheck size={12} />}</span>
          </button>
          {MODEL_CHOICES.map((m) => (
            <button key={m.id} type="button" className={`opt${bot.model === m.id ? " on" : ""}`} onClick={() => void save({ model: m.id })}>
              <span>
                <b>
                  <bdi dir="ltr">{m.name}</bdi>
                </b>
                <small>{t.modelHints[m.id]}</small>
              </span>
              <span className="tick">{bot.model === m.id && <IconCheck size={12} />}</span>
            </button>
          ))}
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
            {([null, ...EFFORT_LEVELS] as (Effort | null)[]).map((lv) => (
              <button key={lv ?? "default"} type="button" role="radio" aria-checked={bot.effort === lv} className={bot.effort === lv ? "on" : ""} onClick={() => void save({ effort: lv })}>
                {lv ? t.efforts[lv] : t.effortDefault}
              </button>
            ))}
          </div>
        </FloatingMenu>
      )}
    </div>
  );
}
