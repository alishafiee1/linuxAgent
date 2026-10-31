import type { Bot, BridgeDevice, BrowserStatus, ConnectorsStatus, MemoryFile, Routine, SharedPage, Skill, VaultItem } from "@linux-agent/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { api } from "./api";
import { IconClock, IconFolder, IconGlobe, IconPencil, IconPlay, IconPlus, IconShield, IconTerminal, IconTrash } from "./icons";
import { useT } from "./i18n";

type Msg = { ok: boolean; text: string } | null;

function useMsg(): [Msg, (fn: () => Promise<unknown>, okText?: string) => Promise<void>] {
  const { t } = useT();
  const [msg, setMsg] = useState<Msg>(null);
  const run = useCallback(
    async (fn: () => Promise<unknown>, okText: string = t.saved) => {
      setMsg(null);
      try {
        await fn();
        setMsg(okText ? { ok: true, text: okText } : null);
      } catch (e) {
        setMsg({ ok: false, text: (e as Error).message });
      }
    },
    [t.saved],
  );
  return [msg, run];
}

const Note = ({ msg }: { msg: Msg }) => (msg ? <div className={msg.ok ? "ok" : "err"}>{msg.text}</div> : null);

// --- routines
const emptyRoutine = { name: "", prompt: "", trigger: "cron" as "cron" | "webhook", cron: "0 8 * * *", timezone: "Asia/Tehran", notify: true };

export function RoutinesPage({ bots, activityTick }: { bots: Bot[]; activityTick: number }) {
  const { t } = useT();
  const [list, setList] = useState<Routine[]>([]);
  const [form, setForm] = useState({ ...emptyRoutine, botId: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [msg, run] = useMsg();
  const load = useCallback(() => api.get<Routine[]>("/api/routines").then(setList, () => {}), []);
  useEffect(() => void load(), [load, activityTick]);
  const botId = form.botId || bots[0]?.id || "";

  const reset = () => {
    setForm({ ...emptyRoutine, botId: "" });
    setEditing(null);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    setHookUrl("");
    void run(async () => {
      if (editing) {
        await api.patch(`/api/routines/${editing}`, { botId, name: form.name, prompt: form.prompt, cron: form.cron, timezone: form.timezone, notify: form.notify });
      } else {
        const r = await api.post<{ webhookToken: string | null }>("/api/routines", { ...form, botId, cron: form.trigger === "cron" ? form.cron : null });
        if (r.webhookToken) setHookUrl(`${location.origin}/hook/${r.webhookToken}`);
      }
      reset();
      await load();
    });
  };

  return (
    <div className="page">
      <h2>{t.routines}</h2>
      <p className="muted">{t.routinesHelp}</p>
      <form className="card section" onSubmit={save}>
        <h3>
          <IconClock size={16} />
          {editing ? t.edit : t.newRoutine}
        </h3>
        <div className="grid2">
          <label>
            {t.botName}
            <input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            {t.bot}
            <select value={botId} onChange={(e) => setForm({ ...form, botId: e.target.value })}>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {!editing && (
            <label>
              {t.trigger}
              <select value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value as "cron" | "webhook" })}>
                <option value="cron">{t.triggerCron}</option>
                <option value="webhook">{t.triggerWebhook}</option>
              </select>
            </label>
          )}
          {form.trigger === "cron" && (
            <>
              <label>
                {t.cron}
                <input dir="ltr" value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} required />
              </label>
              <label>
                {t.timezone}
                <input dir="ltr" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
              </label>
            </>
          )}
        </div>
        <label>
          {t.routinePrompt}
          <textarea rows={3} dir="auto" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} required />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} />
          {t.routineNotify}
        </label>
        <div className="row">
          <button className="primary" disabled={!botId}>
            {t.save}
          </button>
          {editing && (
            <button type="button" onClick={reset}>
              {t.cancel}
            </button>
          )}
        </div>
        <Note msg={msg} />
        {hookUrl && (
          <div className="help-box">
            <strong>{t.webhookOnce}</strong>
            <code dir="ltr" className="break">
              {hookUrl}
            </code>
          </div>
        )}
      </form>
      {list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.botName}</th>
                <th>{t.bot}</th>
                <th>{t.cron}</th>
                <th>{t.nextRun}</th>
                <th>{t.lastRun}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className={r.enabled ? "" : "muted"}>
                  <td dir="auto">{r.name}</td>
                  <td dir="auto">{r.botName}</td>
                  <td dir="ltr">{r.cron ?? t.triggerWebhook}</td>
                  <td>{r.nextRunAt ? new Date(r.nextRunAt).toLocaleString() : "—"}</td>
                  <td>
                    {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : "—"}
                    {r.lastRunState && ` · ${t.states[r.lastRunState] ?? r.lastRunState}`}
                  </td>
                  <td>
                    <span className="row nowrap">
                      <button className="ghost icon-btn" title={t.runNow} aria-label={t.runNow} onClick={() => void run(() => api.post(`/api/routines/${r.id}/run`).then(load), t.started)}>
                        <IconPlay size={14} className="icon-flip" />
                      </button>
                      <button className="ghost" onClick={() => void run(() => api.patch(`/api/routines/${r.id}`, { enabled: !r.enabled }).then(load), "")}>
                        {r.enabled ? t.disable : t.enable}
                      </button>
                      <button
                        className="ghost icon-btn"
                        title={t.edit}
                        aria-label={t.edit}
                        onClick={() => {
                          setEditing(r.id);
                          setForm({ name: r.name, prompt: r.prompt, trigger: r.trigger, cron: r.cron ?? "", timezone: r.timezone, notify: r.notify, botId: r.botId });
                        }}
                      >
                        <IconPencil size={14} />
                      </button>
                      <button
                        className="ghost icon-btn danger"
                        title={t.delete}
                        aria-label={t.delete}
                        onClick={() => {
                          if (confirm(`${r.name}\n\n${t.confirmDeleteItem}`)) void run(() => api.del(`/api/routines/${r.id}`).then(load), "");
                        }}
                      >
                        <IconTrash size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- skills and memory
export function KnowledgePage() {
  const { t } = useT();
  const [memory, setMemory] = useState<MemoryFile[]>([]);
  const [scope, setScope] = useState("shared");
  const [text, setText] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skill, setSkill] = useState<{ slug: string | null; name: string; description: string; body: string } | null>(null);
  const [memMsg, runMem] = useMsg();
  const [skillMsg, runSkill] = useMsg();
  const loadSkills = useCallback(() => api.get<Skill[]>("/api/skills").then(setSkills, () => {}), []);
  useEffect(() => {
    void api.get<MemoryFile[]>("/api/memory").then(setMemory, () => {});
    void loadSkills();
  }, [loadSkills]);
  useEffect(() => {
    setText(memory.find((m) => m.scope === scope)?.content ?? "");
  }, [memory, scope]);

  return (
    <div className="page">
      <h2>{t.knowledge}</h2>
      <div className="card section">
        <h3>{t.memory}</h3>
        <p className="muted">{t.memoryHelp}</p>
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          {memory.map((m) => (
            <option key={m.scope} value={m.scope}>
              {m.scope === "shared" ? t.sharedMemory : m.label}
            </option>
          ))}
        </select>
        <textarea rows={10} dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <button
            className="primary"
            onClick={() =>
              void runMem(async () => {
                const saved = await api.put<MemoryFile>(`/api/memory/${scope}`, { content: text });
                setMemory((cur) => cur.map((m) => (m.scope === scope ? saved : m)));
              })
            }
          >
            {t.save}
          </button>
          <Note msg={memMsg} />
        </div>
      </div>
      <div className="card section">
        <div className="row">
          <h3>{t.skills}</h3>
          <span className="spacer" />
          <button onClick={() => setSkill({ slug: null, name: "", description: "", body: "" })}>
            <IconPlus size={14} />
            {t.newSkill}
          </button>
        </div>
        <p className="muted">{t.skillsHelp}</p>
        {skills.length === 0 && !skill && <div className="muted">{t.empty}</div>}
        {skills.map((s) => (
          <div key={s.slug} className="row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong dir="auto">{s.name}</strong>
              <div className="muted" dir="auto">
                {s.description}
              </div>
            </div>
            <button className="ghost icon-btn" title={t.edit} aria-label={t.edit} onClick={() => setSkill({ slug: s.slug, name: s.name, description: s.description, body: s.body })}>
              <IconPencil size={14} />
            </button>
            <button
              className="ghost icon-btn danger"
              title={t.delete}
              aria-label={t.delete}
              onClick={() => {
                if (confirm(`${s.name}\n\n${t.confirmDeleteItem}`)) void runSkill(() => api.del(`/api/skills/${s.slug}`).then(loadSkills), "");
              }}
            >
              <IconTrash size={14} />
            </button>
          </div>
        ))}
        {skill && (
          <form
            style={{ display: "grid", gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              void runSkill(async () => {
                const body = { name: skill.name, description: skill.description, body: skill.body };
                if (skill.slug) await api.put(`/api/skills/${skill.slug}`, body);
                else await api.post("/api/skills", body);
                setSkill(null);
                await loadSkills();
              });
            }}
          >
            <label>
              {t.botName}
              <input value={skill.name} maxLength={80} onChange={(e) => setSkill({ ...skill, name: e.target.value })} required />
            </label>
            <label>
              {t.skillDescription}
              <input value={skill.description} maxLength={300} onChange={(e) => setSkill({ ...skill, description: e.target.value })} required />
            </label>
            <label>
              {t.skillBody}
              <textarea rows={8} dir="auto" value={skill.body} onChange={(e) => setSkill({ ...skill, body: e.target.value })} />
            </label>
            <div className="row">
              <button className="primary">{t.save}</button>
              <button type="button" onClick={() => setSkill(null)}>
                {t.cancel}
              </button>
            </div>
          </form>
        )}
        <Note msg={skillMsg} />
      </div>
    </div>
  );
}

// --- browser and vault
function LiveBrowser({ botId, vault }: { botId: string; vault: VaultItem[] }) {
  const { t } = useT();
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [frame, setFrame] = useState(0);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [item, setItem] = useState("");
  const [msg, run] = useMsg();
  const img = useRef<HTMLImageElement>(null);

  const load = useCallback(() => api.get<BrowserStatus>(`/api/browser/${botId}`).then(setStatus, () => {}), [botId]);
  useEffect(() => {
    void load();
    const poll = setInterval(() => {
      void load();
      if (document.visibilityState === "visible") setFrame((n) => n + 1);
    }, 1500);
    return () => clearInterval(poll);
  }, [load]);

  const send = (input: unknown) => void run(() => api.post(`/api/browser/${botId}/input`, input), "");
  const point = (e: MouseEvent<HTMLImageElement> | WheelEvent<HTMLImageElement>) => {
    const el = img.current!;
    const r = el.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * el.naturalWidth), y: Math.round(((e.clientY - r.top) / r.height) * el.naturalHeight) };
  };
  const onKey = (e: KeyboardEvent<HTMLImageElement>) => {
    if (["Enter", "Tab", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      send({ type: "key", key: e.key });
    }
  };

  if (!status) return null;
  if (!status.running)
    return (
      <div className="row">
        <span className="muted">{t.browserClosed}</span>
        <button className="primary" onClick={() => void run(() => api.post(`/api/browser/${botId}/open`).then(load), "")}>
          {t.browserOpen}
        </button>
        <Note msg={msg} />
      </div>
    );
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) send({ type: "navigate", url: url.trim() });
        }}
      >
        <input dir="ltr" style={{ flex: 1 }} placeholder={status.url ?? "https://"} value={url} onChange={(e) => setUrl(e.target.value)} />
        <button>{t.go}</button>
        <button type="button" className="danger" onClick={() => void run(() => api.post(`/api/browser/${botId}/close`).then(load), "")}>
          {t.browserClose}
        </button>
      </form>
      <div className="muted" dir="ltr" style={{ textAlign: "start", overflowWrap: "anywhere" }}>
        {status.title} — {status.url}
      </div>
      <img
        ref={img}
        className="browser-frame"
        tabIndex={0}
        alt={status.title ?? ""}
        src={`/api/browser/${botId}/screenshot?f=${frame}`}
        onClick={(e) => send({ type: "click", ...point(e) })}
        onWheel={(e) => send({ type: "scroll", ...point(e), deltaY: e.deltaY })}
        onKeyDown={onKey}
      />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text) send({ type: "text", text });
          setText("");
        }}
      >
        <input dir="auto" style={{ flex: 1 }} autoComplete="off" placeholder={t.browserType} value={text} onChange={(e) => setText(e.target.value)} />
        <button>{t.send}</button>
        <button type="button" onClick={() => send({ type: "key", key: "Enter" })}>
          Enter
        </button>
      </form>
      {vault.length > 0 && (
        <div className="row">
          <IconShield size={15} />
          <select value={item} style={{ width: "auto" }} onChange={(e) => setItem(e.target.value)}>
            <option value="">{t.vaultPick}</option>
            {vault.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button disabled={!item} onClick={() => void run(() => api.post(`/api/browser/${botId}/fill`, { itemId: item, field: "username" }), t.filled)}>
            {t.fillUsername}
          </button>
          <button disabled={!item} onClick={() => void run(() => api.post(`/api/browser/${botId}/fill`, { itemId: item, field: "password" }), t.filled)}>
            {t.fillPassword}
          </button>
        </div>
      )}
      <Note msg={msg} />
    </div>
  );
}

export function BrowserPage({ bots }: { bots: Bot[] }) {
  const { t } = useT();
  const capable = bots.filter((b) => b.browser);
  const [botId, setBotId] = useState("");
  const [vault, setVault] = useState<VaultItem[]>([]);
  const [form, setForm] = useState({ name: "", username: "", secret: "", site: "" });
  const [msg, run] = useMsg();
  const loadVault = useCallback(() => api.get<VaultItem[]>("/api/vault").then(setVault, () => {}), []);
  useEffect(() => void loadVault(), [loadVault]);
  const current = capable.find((b) => b.id === botId)?.id ?? capable[0]?.id ?? "";

  return (
    <div className="page">
      <h2>{t.browser}</h2>
      <div className="card section">
        <h3>
          <IconGlobe size={16} />
          {t.browserLive}
        </h3>
        {capable.length === 0 ? (
          <p className="muted">{t.browserNoBots}</p>
        ) : (
          <>
            <select value={current} onChange={(e) => setBotId(e.target.value)}>
              {capable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <LiveBrowser key={current} botId={current} vault={vault} />
          </>
        )}
      </div>
      <div className="card section">
        <h3>
          <IconShield size={16} />
          {t.vault}
        </h3>
        <p className="muted">{t.vaultHelp}</p>
        {vault.map((v) => (
          <div key={v.id} className="row">
            <strong dir="auto">{v.name}</strong>
            <span className="muted" dir="ltr">
              {v.username ?? ""} {v.site ?? ""}
            </span>
            <span className="spacer" />
            <button
              className="ghost icon-btn danger"
              title={t.delete}
              aria-label={t.delete}
              onClick={() => {
                if (confirm(`${v.name}\n\n${t.confirmDeleteItem}`)) void run(() => api.del(`/api/vault/${v.id}`).then(loadVault), "");
              }}
            >
              <IconTrash size={14} />
            </button>
          </div>
        ))}
        <form
          style={{ display: "grid", gap: 10 }}
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.post("/api/vault", form);
              setForm({ name: "", username: "", secret: "", site: "" });
              await loadVault();
            });
          }}
        >
          <div className="grid2">
            <label>
              {t.botName}
              <input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              {t.username}
              <input dir="ltr" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </label>
            <label>
              {t.password}
              <input type="password" dir="ltr" autoComplete="new-password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} required />
            </label>
            <label>
              {t.vaultSite}
              <input dir="ltr" placeholder="https://example.com" value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <button className="primary">{t.save}</button>
          </div>
        </form>
        <Note msg={msg} />
      </div>
    </div>
  );
}

// --- shared pages
export function SharedPagesPage() {
  const { t } = useT();
  const [list, setList] = useState<SharedPage[]>([]);
  const [msg, run] = useMsg();
  const load = useCallback(() => api.get<SharedPage[]>("/api/pages").then(setList, () => {}), []);
  useEffect(() => void load(), [load]);
  return (
    <div className="page">
      <h2>{t.pages}</h2>
      <p className="muted">{t.pagesHelp}</p>
      <Note msg={msg} />
      {list.length === 0 ? (
        <div className="empty">
          <IconFolder size={30} />
          <p>{t.empty}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td dir="auto">{p.title}</td>
                  <td>
                    {p.url ? (
                      <a dir="ltr" href={p.url} target="_blank" rel="noopener noreferrer">
                        {t.openLink}
                      </a>
                    ) : (
                      <span className="muted">{t.notShared}</span>
                    )}
                  </td>
                  <td className="muted">{new Date(p.updatedAt).toLocaleString()}</td>
                  <td>
                    <span className="row nowrap">
                      <button className="ghost" onClick={() => void run(() => api.post(`/api/pages/${p.id}/share`, { shared: !p.url }).then(load), "")}>
                        {p.url ? t.stopSharing : t.share}
                      </button>
                      <button
                        className="ghost icon-btn danger"
                        title={t.delete}
                        aria-label={t.delete}
                        onClick={() => {
                          if (confirm(`${p.title}\n\n${t.confirmDeleteItem}`)) void run(() => api.del(`/api/pages/${p.id}`).then(load), "");
                        }}
                      >
                        <IconTrash size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- settings sections
export function ConnectorsSection() {
  const { t } = useT();
  const [s, setS] = useState<ConnectorsStatus | null>(null);
  const [form, setForm] = useState({ githubToken: "", googleClientId: "", googleClientSecret: "" });
  const [msg, run] = useMsg();
  const load = useCallback(() => api.get<ConnectorsStatus>("/api/connectors").then(setS, () => {}), []);
  useEffect(() => void load(), [load]);
  if (!s) return null;
  const save = (body: Record<string, string>) =>
    void run(async () => {
      setS(await api.put<ConnectorsStatus>("/api/connectors", body));
      setForm({ githubToken: "", googleClientId: "", googleClientSecret: "" });
    });
  return (
    <div className="card section">
      <h3>
        <IconGlobe size={16} />
        {t.connectors}
      </h3>
      <p className="muted">{t.connectorsHelp}</p>
      <div className="row">
        <strong>GitHub</strong>
        <span className="pill">
          <span className={`dot ${s.github.configured ? "good" : ""}`} />
          {s.github.configured ? t.configured : t.notConfigured}
        </span>
      </div>
      <label>
        {t.githubToken}
        <input type="password" dir="ltr" autoComplete="off" placeholder={s.github.configured ? t.tokenKeep : ""} value={form.githubToken} onChange={(e) => setForm({ ...form, githubToken: e.target.value })} />
      </label>
      <div className="row">
        <button className="primary" disabled={!form.githubToken.trim()} onClick={() => save({ githubToken: form.githubToken })}>
          {t.save}
        </button>
      </div>
      <hr style={{ border: 0, borderTop: "1px solid var(--border)", width: "100%" }} />
      <div className="row">
        <strong>Google (Gmail, Calendar)</strong>
        <span className="pill">
          <span className={`dot ${s.google.connected ? "good" : ""}`} />
          {s.google.connected ? t.connected : t.notConfigured}
        </span>
      </div>
      <p className="muted">{t.googleHelp}</p>
      <code dir="ltr" className="break">
        {s.google.redirectUri}
      </code>
      <div className="grid2">
        <label>
          Client ID
          <input dir="ltr" autoComplete="off" placeholder={s.google.clientConfigured ? t.tokenKeep : ""} value={form.googleClientId} onChange={(e) => setForm({ ...form, googleClientId: e.target.value })} />
        </label>
        <label>
          Client Secret
          <input type="password" dir="ltr" autoComplete="off" placeholder={s.google.clientConfigured ? t.tokenKeep : ""} value={form.googleClientSecret} onChange={(e) => setForm({ ...form, googleClientSecret: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <button className="primary" disabled={!form.googleClientId.trim() || !form.googleClientSecret.trim()} onClick={() => save({ googleClientId: form.googleClientId, googleClientSecret: form.googleClientSecret })}>
          {t.save}
        </button>
        <button
          disabled={!s.google.clientConfigured}
          onClick={() =>
            void run(async () => {
              const { url } = await api.post<{ url: string }>("/api/connectors/google/start");
              window.open(url, "_blank", "noopener");
            }, "")
          }
        >
          {t.googleConnect}
        </button>
        {s.google.connected && (
          <button className="danger" onClick={() => void run(() => api.post<ConnectorsStatus>("/api/connectors/google/disconnect").then(setS), "")}>
            {t.disconnect}
          </button>
        )}
      </div>
      <Note msg={msg} />
    </div>
  );
}

export function DevicesSection() {
  const { t } = useT();
  const [list, setList] = useState<BridgeDevice[]>([]);
  const [form, setForm] = useState({ name: "", folders: "" });
  const [created, setCreated] = useState<{ token: string; folders: string[] } | null>(null);
  const [msg, run] = useMsg();
  const load = useCallback(() => api.get<BridgeDevice[]>("/api/bridge/devices").then(setList, () => {}), []);
  useEffect(() => void load(), [load]);
  return (
    <div className="card section">
      <h3>
        <IconTerminal size={16} />
        {t.devices}
      </h3>
      <p className="muted">{t.devicesHelp}</p>
      {list.map((d) => (
        <div key={d.id} className="row">
          <span className={`dot ${d.online ? "good" : ""}`} />
          <strong dir="auto">{d.name}</strong>
          <span className="muted" dir="ltr">
            {d.folders.join(", ")}
          </span>
          <span className="spacer" />
          <button
            className="ghost icon-btn danger"
            title={t.delete}
            aria-label={t.delete}
            onClick={() => {
              if (confirm(`${d.name}\n\n${t.confirmDeleteItem}`)) void run(() => api.del(`/api/bridge/devices/${d.id}`).then(load), "");
            }}
          >
            <IconTrash size={14} />
          </button>
        </div>
      ))}
      <form
        style={{ display: "grid", gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          const folders = form.folders.split("\n").map((f) => f.trim()).filter(Boolean);
          void run(async () => {
            const r = await api.post<{ token: string }>("/api/bridge/devices", { name: form.name, folders });
            setCreated({ token: r.token, folders });
            setForm({ name: "", folders: "" });
            await load();
          }, "");
        }}
      >
        <label>
          {t.botName}
          <input value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          {t.deviceFolders}
          <textarea rows={2} dir="ltr" value={form.folders} onChange={(e) => setForm({ ...form, folders: e.target.value })} required />
        </label>
        <div className="row">
          <button className="primary">{t.save}</button>
        </div>
      </form>
      {created && (
        <div className="help-box">
          <strong>{t.deviceOnce}</strong>
          <pre dir="ltr">{`set CWP_BRIDGE_TOKEN=${created.token}\nnode bridge.mjs --url ${location.origin} ${created.folders.map((f) => `--folder "${f}"`).join(" ")}`}</pre>
        </div>
      )}
      <Note msg={msg} />
    </div>
  );
}
