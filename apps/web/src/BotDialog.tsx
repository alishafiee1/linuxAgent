import type { Bot, BotInput } from "@linux-agent/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { useT } from "./i18n";

export function BotDialog({ bot, onClose, onSaved }: { bot: Bot | null; onClose: () => void; onSaved: (b: Bot) => void }) {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState({
    name: bot?.name ?? "",
    persona: bot?.persona ?? "",
    model: bot?.model ?? "",
    maxTurns: bot?.maxTurns ?? 50,
    maxMinutes: bot?.maxMinutes ?? 120,
    browser: bot?.browser ?? false,
  });
  const [error, setError] = useState("");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

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
    <dialog ref={ref} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>{bot ? `${t.edit}: ${bot.name}` : t.newBot}</h3>
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
          <input dir="ltr" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        </label>
        <div className="grid2">
          <label>
            {t.maxTurns}
            <input type="number" min={1} max={500} value={form.maxTurns} onChange={(e) => setForm({ ...form, maxTurns: Number(e.target.value) })} />
          </label>
          <label>
            {t.maxMinutes}
            <input type="number" min={1} max={1440} value={form.maxMinutes} onChange={(e) => setForm({ ...form, maxMinutes: Number(e.target.value) })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.browser} onChange={(e) => setForm({ ...form, browser: e.target.checked })} />
          {t.browserEnabled}
        </label>
        {error && <div className="err">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={() => ref.current?.close()}>
            {t.cancel}
          </button>
          <button className="primary">{t.save}</button>
        </div>
      </form>
    </dialog>
  );
}
