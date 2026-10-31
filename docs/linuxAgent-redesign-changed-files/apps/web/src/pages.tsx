import type { Approval, FileEntry, ProxyNode, ProxyStatus, PublicSettings, UsageReport } from "@linux-agent/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { IconArrowUp, IconBell, IconCheck, IconDownload, IconFolder, IconGauge, IconGlobe, IconInbox, IconShield, IconSliders, IconX } from "./icons";
import { useT } from "./i18n";

export function ApprovalsPage({ activityTick }: { activityTick: number }) {
  const { t } = useT();
  const [list, setList] = useState<Approval[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(() => api.get<Approval[]>("/api/approvals").then(setList, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load, activityTick]);
  const decide = async (id: string, allow: boolean) => {
    try {
      await api.post(`/api/approvals/${id}/decide`, { allow });
    } catch (e) {
      setError((e as Error).message);
    }
    void load();
  };
  const pending = list.filter((a) => a.state === "pending");
  const past = list.filter((a) => a.state !== "pending").slice(0, 50);
  return (
    <div className="page">
      <h2>{t.approvals}</h2>
      {error && <div className="err">{error}</div>}
      {pending.length === 0 && (
        <div className="empty">
          <IconInbox size={30} />
          <p>{t.noPending}</p>
        </div>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {pending.map((a) => (
          <div key={a.id} className="approval" role="alert">
            <div className="approval-head">
              <span className="approval-ic">
                <IconShield size={18} />
              </span>
              <strong>{a.botName}</strong>
              <span className="muted">· {a.reason}</span>
              <span className="spacer" />
              <span className="muted">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
            <pre>
              {a.toolName} {JSON.stringify(a.input, null, 2)}
            </pre>
            <div className="row approval-actions">
              <button className="primary" onClick={() => void decide(a.id, true)}>
                <IconCheck size={16} />
                {t.allow}
              </button>
              <button className="danger" onClick={() => void decide(a.id, false)}>
                <IconX size={16} />
                {t.deny}
              </button>
            </div>
          </div>
        ))}
      </div>
      {past.length > 0 && (
        <table style={{ marginTop: 24 }}>
          <tbody>
            {past.map((a) => (
              <tr key={a.id}>
                <td>{a.botName}</td>
                <td>
                  <code>{a.toolName}</code>
                </td>
                <td>{a.reason}</td>
                <td>
                  {t.approvalStates[a.state]} {a.decidedByChannel ? `(${t.channels[a.decidedByChannel]})` : ""}
                </td>
                <td className="muted">{a.decidedAt ? new Date(a.decidedAt).toLocaleString() : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function UsagePage() {
  const { t } = useT();
  const [report, setReport] = useState<UsageReport | null>(null);
  useEffect(() => {
    api.get<UsageReport>("/api/usage").then(setReport, () => {});
  }, []);
  if (!report) return null;
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div className="page">
      <h2>{t.usage}</h2>
      {report.limit.waiting && (
        <div className="banner warn card" style={{ marginBottom: 12 }}>
          {t.limitBanner} {report.limit.resetAt ? new Date(report.limit.resetAt).toLocaleString() : "?"}
        </div>
      )}
      {report.rows.length === 0 ? (
        <div className="empty">
          <IconGauge size={30} />
          <p>{t.empty}</p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t.day}</th>
              <th>{t.bot}</th>
              <th>{t.runs}</th>
              <th>{t.inputTokens}</th>
              <th>{t.outputTokens}</th>
              <th title={t.estimateNote}>{t.cost}</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={`${r.day}-${r.botId}`}>
                <td>{r.day}</td>
                <td>{r.botName}</td>
                <td className="num">{fmt(r.runs)}</td>
                <td className="num">{fmt(r.inputTokens)}</td>
                <td className="num">{fmt(r.outputTokens)}</td>
                <td className="num">${r.costEstimateUsd.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        {t.cost}: {t.estimateNote}
      </p>
    </div>
  );
}

export function FilesPage() {
  const { t } = useT();
  const [root, setRoot] = useState<"workspace" | "bots">("workspace");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    api.get<FileEntry[]>(`/api/files?root=${root}&path=${encodeURIComponent(path)}`).then(setEntries, (e: Error) => {
      setEntries([]);
      setError(e.message);
    });
  }, [root, path]);
  const up = path.split("/").slice(0, -1).join("/");
  return (
    <div className="page">
      <div className="row">
        <h2 style={{ margin: 0 }}>{t.files}</h2>
        <span className="spacer" />
        <select
          value={root}
          style={{ width: "auto" }}
          onChange={(e) => {
            setRoot(e.target.value as "workspace" | "bots");
            setPath("");
          }}
        >
          <option value="workspace">{t.workspace}</option>
          <option value="bots">{t.botsFolder}</option>
        </select>
      </div>
      <p className="muted" dir="ltr" style={{ textAlign: "start" }}>
        /{path}
      </p>
      {error && <div className="err">{error}</div>}
      <table>
        <tbody>
          {path && (
            <tr>
              <td colSpan={3}>
                <button className="ghost" onClick={() => setPath(up)}>
                  <IconArrowUp size={14} />
                  {t.up}
                </button>
              </td>
            </tr>
          )}
          {entries.length === 0 && !error && (
            <tr>
              <td colSpan={3}>
                <div className="empty slim">
                  <IconFolder size={26} />
                  <p>{t.empty}</p>
                </div>
              </td>
            </tr>
          )}
          {entries.map((e) => (
            <tr key={e.path}>
              <td>
                {e.type === "dir" ? (
                  <button className="ghost" onClick={() => setPath(e.path)}>
                    <IconFolder size={15} />
                    {e.name}
                  </button>
                ) : (
                  <span dir="ltr">{e.name}</span>
                )}
              </td>
              <td className="num muted">{e.type === "file" ? `${(e.size / 1024).toFixed(1)} KB` : ""}</td>
              <td>
                {e.type === "file" && (
                  <a className="dl" href={`/api/files/download?root=${root}&path=${encodeURIComponent(e.path)}`}>
                    <IconDownload size={14} />
                    {t.download}
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChannelForm({ name, label, current, onSaved }: { name: "bale" | "telegram"; label: string; current: PublicSettings["bale"]; onSaved: () => void }) {
  const { t } = useT();
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(current.chatId ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    try {
      await api.put("/api/settings", { [name]: { ...(token ? { token } : {}), chatId } });
      setToken("");
      setMsg({ ok: true, text: t.saved });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const test = async () => {
    try {
      await api.post(`/api/settings/notify/${name}/test`);
      setMsg({ ok: true, text: t.sent });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="row">
        <strong>{label}</strong>
        <span className="pill">
          <span className={`dot ${current.configured ? "good" : ""}`} />
          {current.configured ? t.configured : t.notConfigured}
        </span>
      </div>
      <div className="grid2">
        <label>
          {t.token}
          <input type="password" dir="ltr" autoComplete="off" placeholder={current.configured ? t.tokenKeep : ""} value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <label>
          {t.chatId}
          <input dir="ltr" value={chatId} onChange={(e) => setChatId(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <button className="primary" onClick={() => void save()}>
          {t.save}
        </button>
        <button disabled={!current.configured} onClick={() => void test()}>
          {t.test}
        </button>
        {msg && <span className={msg.ok ? "ok" : "err"}>{msg.text}</span>}
      </div>
    </div>
  );
}

function ProxySection({ proxy, onChanged }: { proxy: ProxyStatus | null; onChanged: () => void }) {
  const { t } = useT();
  const [link, setLink] = useState("");
  const [sub, setSub] = useState("");
  const [nodes, setNodes] = useState<ProxyNode[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, okText = t.saved) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card section">
      <h3>
        <IconGlobe size={16} />
        {t.proxy}
      </h3>
      {proxy && (
        <div className="row">
          <span className="pill">
            <span className={`dot ${proxy.state === "connected" ? "good" : proxy.state === "disconnected" ? "bad" : "warn"}`} />
            {t[proxy.state]}
            {proxy.latencyMs !== null && proxy.state === "connected" && ` · ${proxy.latencyMs} ${t.ms}`}
          </span>
          {proxy.current && (
            <span className="muted" dir="ltr">
              {t.current}: {proxy.current.scheme}://{proxy.current.host}:{proxy.current.port} {proxy.current.remark}
            </span>
          )}
        </div>
      )}
      <label>
        {t.proxyLink}
        <textarea rows={2} dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" disabled={busy || !link.trim()} onClick={() => void run(() => api.put("/api/proxy", { link }).then(() => setLink("")))}>
          {t.apply}
        </button>
      </div>
      <label>
        {t.subscription}
        <input dir="ltr" placeholder={proxy?.subscriptionUrlSet ? t.tokenKeep : "https://"} value={sub} onChange={(e) => setSub(e.target.value)} />
      </label>
      <div className="row">
        <button disabled={busy || !sub.trim()} onClick={() => void run(() => api.put("/api/proxy", { subscriptionUrl: sub }).then(() => setSub("")))}>
          {t.save}
        </button>
        <button disabled={busy || (!proxy?.subscriptionUrlSet && !sub)} onClick={() => void run(() => api.get<ProxyNode[]>("/api/proxy/subscription/nodes").then(setNodes), "")}>
          {t.loadNodes}
        </button>
      </div>
      {nodes && (
        <table>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.index}>
                <td>{n.remark}</td>
                <td dir="ltr">
                  {n.scheme}://{n.host}:{n.port}
                </td>
                <td>
                  <button disabled={busy} onClick={() => void run(() => api.post("/api/proxy/select", { index: n.index }))}>
                    {t.use}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {msg && msg.text && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}
    </div>
  );
}

export function SettingsPage({ proxy, onSaved }: { proxy: ProxyStatus | null; onSaved: () => void }) {
  const { t, setLang } = useT();
  const [s, setS] = useState<PublicSettings | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api.get<PublicSettings>("/api/settings").then(setS, () => {}), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!s) return null;
  const saveGeneral = async () => {
    const next = await api.put<PublicSettings>("/api/settings", { defaultModel: s.defaultModel, maxConcurrentRuns: s.maxConcurrentRuns, uiLanguage: s.uiLanguage });
    setS(next);
    setLang(next.uiLanguage);
    setMsg(t.saved);
  };
  return (
    <div className="page">
      <h2>{t.settings}</h2>
      <div className="card section">
        <h3>
          <IconSliders size={16} />
          {t.general}
        </h3>
        <div className="grid2">
          <label>
            {t.defaultModel}
            <input dir="ltr" value={s.defaultModel} onChange={(e) => setS({ ...s, defaultModel: e.target.value })} />
          </label>
          <label>
            {t.maxConcurrent}
            <input type="number" min={1} max={10} value={s.maxConcurrentRuns} onChange={(e) => setS({ ...s, maxConcurrentRuns: Number(e.target.value) })} />
          </label>
          <label>
            {t.language}
            <select value={s.uiLanguage} onChange={(e) => setS({ ...s, uiLanguage: e.target.value as "fa" | "en" })}>
              <option value="fa">فارسی</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
        <div className="row">
          <button className="primary" onClick={() => void saveGeneral()}>
            {t.save}
          </button>
          {msg && <span className="ok">{msg}</span>}
        </div>
      </div>
      <div className="card section">
        <h3>
          <IconBell size={16} />
          {t.notifications}
        </h3>
        <ChannelForm name="bale" label={t.channels.bale!} current={s.bale} onSaved={load} />
        <hr style={{ border: 0, borderTop: "1px solid var(--border)", width: "100%" }} />
        <ChannelForm name="telegram" label={t.channels.telegram!} current={s.telegram} onSaved={load} />
      </div>
      <ProxySection proxy={proxy} onChanged={onSaved} />
    </div>
  );
}
