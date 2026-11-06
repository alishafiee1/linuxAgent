import { AVATAR_COUNT, type Bot, type BotInput } from "@linux-agent/shared";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "./api";
import { BotAvatar, avatarSrc } from "./avatars";
import { IconRefresh } from "./icons";
import { useT } from "./i18n";

const randomAvatar = (): number => 1 + Math.floor(Math.random() * AVATAR_COUNT);
const pick = (n: number, keep: number): number[] => {
  const out = new Set<number>([keep]);
  while (out.size < n) out.add(randomAvatar());
  return [...out];
};

/** Make or change a bot. It covers the main area like a page, so there is room for every setting. */
export function BotPage({ bot, onClose, onSaved }: { bot: Bot | null; onClose: () => void; onSaved: (b: Bot) => void }) {
  const { t, locale } = useT();
  const [form, setForm] = useState({
    name: bot?.name ?? "",
    persona: bot?.persona ?? "",
    model: bot?.model ?? "",
    avatar: bot?.avatar ?? randomAvatar(),
    maxTurns: bot?.maxTurns ?? 50,
    maxMinutes: bot?.maxMinutes ?? 120,
    browser: bot?.browser ?? false,
  });
  const [choices, setChoices] = useState(() => pick(12, form.avatar));
  const [error, setError] = useState("");
  const n = (v: number): string => v.toLocaleString(locale);
  const preview = useMemo(() => ({ avatar: form.avatar, name: form.name }), [form.avatar, form.name]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: BotInput = { ...form, model: form.model.trim() || null };
    try {
      onSaved(bot ? await api.patch<Bot>(`/api/bots/${bot.id}`, body) : await api.post<Bot>("/api/bots", body));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="page cols bot-page">
      <header className="pg-top">
        <div>
          <h2>{bot ? `${t.edit}: ${bot.name}` : t.newBot}</h2>
          <p>{t.botPageHelp}</p>
        </div>
      </header>
      <form onSubmit={submit} className="bot-form">
        <div className="col">
          <div className="card section">
            <label>
              {t.botName}
              <input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </label>
            <label>
              {t.persona}
              <textarea rows={4} value={form.persona} onChange={(e) => setForm({ ...form, persona: e.target.value })} />
            </label>
            <label>
              {t.model}
              <input dir="ltr" value={form.model} placeholder={t.modelDefault} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </label>
          </div>
          <div className="card section">
            <div className="row">
              <h3>{t.avatarTitle}</h3>
              <span className="spacer" />
              <button type="button" onClick={() => setChoices(pick(12, form.avatar))}>
                <IconRefresh size={14} />
                {t.newAvatar}
              </button>
            </div>
            <div className="avatar-grid">
              {choices.map((a) => (
                <button key={a} type="button" className={a === form.avatar ? "on" : ""} aria-pressed={a === form.avatar} onClick={() => setForm({ ...form, avatar: a })}>
                  <img src={avatarSrc(a)} alt="" draggable={false} />
                </button>
              ))}
            </div>
            <div className="avatar-preview">
              <BotAvatar bot={preview} size="lg" />
              <div>
                <strong>{form.name || t.botNamePreview}</strong>
                <p className="muted">{form.persona.split("\n")[0] || t.botRolePreview}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card section">
            <h3>{t.botLimits}</h3>
            <label>
              <span className="range-head">
                {t.maxTurns}
                <b>{n(form.maxTurns)}</b>
              </span>
              <input type="range" min={1} max={500} value={form.maxTurns} onChange={(e) => setForm({ ...form, maxTurns: Number(e.target.value) })} />
            </label>
            <label>
              <span className="range-head">
                {t.maxMinutes}
                <b>{n(form.maxMinutes)}</b>
              </span>
              <input type="range" min={1} max={1440} value={form.maxMinutes} onChange={(e) => setForm({ ...form, maxMinutes: Number(e.target.value) })} />
            </label>
          </div>
          <div className="card section">
            <label className="check">
              <input type="checkbox" checked={form.browser} onChange={(e) => setForm({ ...form, browser: e.target.checked })} />
              <span>
                <b>{t.browserEnabled}</b>
              </span>
            </label>
          </div>
          {error && <div className="err">{error}</div>}
          <div className="bot-actions">
            <button className="primary">{bot ? t.save : t.botCreate}</button>
            <button type="button" onClick={onClose}>
              {t.cancel}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
