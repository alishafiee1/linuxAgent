import type { ConnectionPayload, PlatformCategory, PlatformInfo } from "@linux-agent/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { IconCheck, IconGlobe, IconPlus, IconX } from "./icons";
import { useT } from "./i18n";

const CATEGORIES: PlatformCategory[] = ["communication", "code", "work", "ai", "custom"];

/** Enters a key, saves it encrypted, then tries it, so a wrong key shows up at once. */
export function ConnectForm({ platform, onConnected }: { platform: PlatformInfo; onConnected: () => void }) {
  const { t } = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const google = platform.kind === "google";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.put(`/api/platforms/${platform.id}`, { values });
      setValues({});
      if (google) {
        const { url } = await api.post<{ url: string }>("/api/connectors/google/start");
        window.open(url, "_blank", "noopener");
        setMsg({ ok: true, text: t.googleOpened });
        return;
      }
      if (platform.testable) {
        const r = await api.post<{ ok: boolean; message: string }>(`/api/platforms/${platform.id}/test`);
        setMsg({ ok: r.ok, text: r.message });
        if (!r.ok) return;
      }
      onConnected();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="q-form" autoComplete="off" onSubmit={(e) => void submit(e)}>
      {platform.steps.length > 0 && (
        <ol className="connect-steps">
          {platform.steps.map((s) => (
            <li key={s} dir="auto">
              {s}
            </li>
          ))}
        </ol>
      )}
      {platform.helpUrl && (
        <a className="dl" href={platform.helpUrl} target="_blank" rel="noopener noreferrer">
          {t.getKeyHere}
        </a>
      )}
      {platform.redirectUri && (
        <code dir="ltr" className="break">
          {platform.redirectUri}
        </code>
      )}
      {platform.fields.map((f) => (
        <label key={f.key}>
          {f.label}
          <input
            dir="ltr"
            type={f.secret ? "password" : "text"}
            autoComplete={f.secret ? "new-password" : "off"}
            placeholder={platform.connected && f.secret ? t.tokenKeep : (platform.values[f.key] ?? "")}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <div className="row">
        <button className="primary" disabled={busy}>
          {google ? t.googleConnect : t.saveAndTest}
        </button>
        {msg && <span className={msg.ok ? "ok" : "err"}>{msg.text}</span>}
      </div>
    </form>
  );
}

export function CustomForm({ initial, onConnected }: { initial?: Partial<ConnectionPayload>; onConnected: () => void }) {
  const { t } = useT();
  const [form, setForm] = useState({ name: initial?.name ?? "", baseUrl: initial?.baseUrl ?? "", header: initial?.header ?? "authorization", template: initial?.template ?? "Bearer {token}", token: "" });
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/api/platforms/custom", form);
      setForm({ ...form, token: "" });
      onConnected();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="q-form" autoComplete="off" onSubmit={(e) => void submit(e)}>
      <div className="grid2">
        <label>
          {t.botName}
          <input value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          {t.apiAddress}
          <input dir="ltr" placeholder="https://api.example.com" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} required />
        </label>
        <label>
          {t.apiHeader}
          <input dir="ltr" value={form.header} onChange={(e) => setForm({ ...form, header: e.target.value })} />
        </label>
        <label>
          {t.apiTemplate}
          <input dir="ltr" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })} />
        </label>
      </div>
      <label>
        {t.token}
        <input type="password" dir="ltr" autoComplete="new-password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} required />
      </label>
      {error && <div className="err">{error}</div>}
      <div className="row">
        <button className="primary">{t.save}</button>
      </div>
    </form>
  );
}

export function ConnectionsPage() {
  const { t } = useT();
  const [list, setList] = useState<PlatformInfo[]>([]);
  const [open, setOpen] = useState<PlatformInfo | "custom" | null>(null);
  const [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(() => api.get<PlatformInfo[]>("/api/platforms").then(setList, () => {}), []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const shown = list.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const done = () => {
    setOpen(null);
    void load();
  };
  return (
    <div className="page">
      <div className="row">
        <h2 style={{ margin: 0 }}>{t.connections}</h2>
        <span className="spacer" />
        <button onClick={() => setOpen("custom")}>
          <IconPlus size={14} />
          {t.addCustom}
        </button>
      </div>
      <p className="muted">{t.connectionsHelp}</p>
      <input dir="auto" placeholder={t.searchPlatforms} aria-label={t.searchPlatforms} value={search} onChange={(e) => setSearch(e.target.value)} />
      {CATEGORIES.map((c) => {
        const items = shown.filter((p) => p.category === c);
        if (!items.length) return null;
        return (
          <section key={c} style={{ marginTop: 18 }}>
            <h3 className="platform-group">{t.platformCategories[c]}</h3>
            <div className="platform-grid">
              {items.map((p) => (
                <div key={p.id} className="platform card">
                  <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                  <strong dir="auto">{p.name}</strong>
                  <span className="spacer" />
                  {p.connected ? (
                    <>
                      <span className="ok connected-mark">
                        <IconCheck size={14} />
                        {t.connected}
                      </span>
                      <button
                        className="ghost icon-btn"
                        title={t.disconnect}
                        aria-label={`${t.disconnect}: ${p.name}`}
                        onClick={() => {
                          if (confirm(`${p.name}\n\n${t.confirmDisconnect}`)) void api.del(`/api/platforms/${p.id}`).then(load, () => {});
                        }}
                      >
                        <IconX size={14} />
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setOpen(p)}>{t.connect}</button>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <dialog ref={dialog} onClose={() => setOpen(null)}>
        {open && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="row">
              <IconGlobe size={16} />
              <h3 style={{ margin: 0 }}>{open === "custom" ? t.addCustom : open.name}</h3>
              <span className="spacer" />
              <button className="ghost icon-btn" aria-label={t.cancel} onClick={() => setOpen(null)}>
                <IconX size={15} />
              </button>
            </div>
            {open === "custom" ? <CustomForm onConnected={done} /> : <ConnectForm platform={open} onConnected={done} />}
            <p className="muted secret-note">{t.secretNote}</p>
          </div>
        )}
      </dialog>
    </div>
  );
}
