import type { ProxyConnection, ProxyNode, ProxyStatus } from "@linux-agent/shared";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { useT } from "./i18n";
import { IconCheck, IconGlobe, IconPencil, IconPlus, IconTrash } from "./icons";

type Msg = { ok: boolean; text: string } | null;

/** Proxy settings: the saved connections (add, rename, remove, switch), why it is down, automatic switching and the subscription. */
export function ProxyPanel({ proxy, onChanged }: { proxy: ProxyStatus | null; onChanged: () => void }) {
  const { t, locale } = useT();
  const [list, setList] = useState<ProxyConnection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [sub, setSub] = useState("");
  const [nodes, setNodes] = useState<ProxyNode[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [hint, setHint] = useState<{ ip: string; port: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<ProxyConnection[]>("/api/proxy/connections").then(
      (l) => {
        setList(l);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, []);
  // The active link can change on its own (automatic switching), so the list follows the status.
  useEffect(load, [load, proxy?.current?.host, proxy?.current?.port, proxy?.connectionCount]);

  const run = async (fn: () => Promise<unknown>, okText: string | null = t.saved, forHint?: ProxyConnection) => {
    setBusy(true);
    setMsg(null);
    setHint(null);
    try {
      await fn();
      setMsg(okText ? { ok: true, text: okText } : null);
      load();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      if (e instanceof ApiError && e.code === "not_allowed" && forHint) setHint({ ip: forHint.ip ?? forHint.host, port: forHint.port });
    } finally {
      setBusy(false);
    }
  };

  const dot = proxy ? (proxy.state === "connected" ? "good" : proxy.state === "disconnected" ? "bad" : "warn") : "warn";
  const last = proxy?.failover.lastResult ?? null;
  const lastText = !last ? null : last.startsWith("switched:") ? t.proxyFailoverSwitched.replace("{name}", last.slice("switched:".length)) : t.proxyFailoverResults[last];

  return (
    <div className="card section proxy-panel">
      <h3>
        <IconGlobe size={16} />
        {t.proxy}
      </h3>

      {proxy && (
        <div className="proxy-status">
          <span className="pill">
            <span className={`dot ${dot}`} />
            {t[proxy.state]}
            {proxy.latencyMs !== null && proxy.state === "connected" && ` · ${proxy.latencyMs.toLocaleString(locale)} ${t.ms}`}
          </span>
          {proxy.state === "disconnected" && proxy.reason && <div className="err proxy-reason">{t.proxyReasons[proxy.reason]}</div>}
        </div>
      )}

      <h4 className="proxy-sub">
        {t.proxyConns}
        <span className="muted num">{list.length.toLocaleString(locale)}</span>
      </h4>
      {loaded && list.length === 0 && <div className="muted">{t.proxyConnsEmpty}</div>}
      <div className="conn-list">
        {list.map((c) => (
          <div key={c.id} className={`conn${c.active ? " active" : ""}`}>
            <div className="conn-main">
              {editing?.id === c.id ? (
                <form
                  className="row nowrap"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => api.patch(`/api/proxy/connections/${c.id}`, { name: editing.name }).then(() => setEditing(null)));
                  }}
                >
                  <input value={editing.name} maxLength={60} autoFocus onChange={(e) => setEditing({ id: c.id, name: e.target.value })} aria-label={t.proxyName} />
                  <button className="primary" disabled={busy || !editing.name.trim()}>
                    <IconCheck size={14} />
                    {t.save}
                  </button>
                  <button type="button" onClick={() => setEditing(null)}>
                    {t.cancel}
                  </button>
                </form>
              ) : (
                <div className="conn-title">
                  <strong className="conn-name">{c.name}</strong>
                  {c.active && <span className="conn-badge">{t.proxyActive}</span>}
                </div>
              )}
              <div className="conn-addr" dir="ltr">
                {c.scheme}://{c.host}:{c.port}
              </div>
            </div>
            {editing?.id !== c.id && (
              <div className="conn-actions">
                <button className={c.active ? "" : "primary"} disabled={busy || c.active} onClick={() => void run(() => api.post(`/api/proxy/connections/${c.id}/activate`), t.proxyActivated, c)}>
                  {t.proxyActivate}
                </button>
                <button className="ghost icon-btn" title={t.proxyRename} aria-label={t.proxyRename} disabled={busy} onClick={() => setEditing({ id: c.id, name: c.name })}>
                  <IconPencil size={15} />
                </button>
                <button
                  className="ghost icon-btn danger"
                  title={t.proxyRemove}
                  aria-label={t.proxyRemove}
                  disabled={busy || c.active}
                  onClick={() => {
                    if (confirm(`${c.name}\n\n${t.proxyDeleteConfirm}`)) void run(() => api.del(`/api/proxy/connections/${c.id}`));
                  }}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {msg && msg.text && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}
      {hint && (
        <div className="proxy-hint">
          <p>{t.proxyNotAllowed}</p>
          <pre dir="ltr">sh deploy/proxy/allow-proxy.sh {hint.ip} {hint.port}</pre>
        </div>
      )}

      <h4 className="proxy-sub">{t.proxyAddTitle}</h4>
      <label>
        {t.proxyLink}
        <textarea rows={2} dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} />
      </label>
      <label>
        {t.proxyName}
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" disabled={busy || !link.trim()} onClick={() => void run(() => api.post("/api/proxy/connections", { link, name: name.trim() || undefined }).then(() => (setLink(""), setName(""))))}>
          <IconPlus size={14} />
          {t.proxyAdd}
        </button>
        <span className="muted">{t.proxyAddHint}</span>
      </div>

      <h4 className="proxy-sub">{t.proxyFailover}</h4>
      <label className="check">
        <input type="checkbox" checked={proxy?.failover.enabled ?? false} disabled={busy || !proxy} onChange={(e) => void run(() => api.put("/api/proxy/failover", { enabled: e.target.checked }))} />
        {t.proxyFailoverHelp}
      </label>
      {lastText && <div className="muted">{lastText}</div>}

      <h4 className="proxy-sub">{t.subscription}</h4>
      <input dir="ltr" placeholder={proxy?.subscriptionUrlSet ? t.tokenKeep : "https://"} value={sub} onChange={(e) => setSub(e.target.value)} aria-label={t.subscription} />
      <div className="row">
        <button disabled={busy || !sub.trim()} onClick={() => void run(() => api.put("/api/proxy", { subscriptionUrl: sub }).then(() => setSub("")))}>
          {t.save}
        </button>
        <button disabled={busy || (!proxy?.subscriptionUrlSet && !sub)} onClick={() => void run(() => api.get<ProxyNode[]>("/api/proxy/subscription/nodes").then(setNodes), null)}>
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
    </div>
  );
}
