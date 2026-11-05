import type { FileEntry, ProxyStatus, PublicSettings, UsageReport } from "@linux-agent/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { IconArrowUp, IconBell, IconDownload, IconFolder, IconGauge, IconSliders } from "./icons";
import { useT } from "./i18n";
import { DevicesSection } from "./pagesExt";
import { ProxyPanel } from "./proxyPanel";
import { PushPanel } from "./pushPanel";

/** Plain words first; the exact input stays one click away for anyone who wants to check it. */
export function ApprovalDetails({ summary, toolName, input }: { summary?: string; toolName: string; input: unknown }) {
  const { t } = useT();
  const raw = JSON.stringify(input, null, 2);
  if (!summary) return <pre>{raw}</pre>;
  return (
    <>
      <div className="approval-summary" dir="auto">
        {summary}
      </div>
      <details className="approval-raw">
        <summary>{t.technicalDetails}</summary>
        <pre dir="ltr">
          {toolName} {raw}
        </pre>
      </details>
    </>
  );
}

export function UsagePage() {
  const { t, locale } = useT();
  const [report, setReport] = useState<UsageReport | null>(null);
  useEffect(() => {
    api.get<UsageReport>("/api/usage").then(setReport, () => {});
  }, []);
  if (!report) return null;
  const fmt = (n: number) => n.toLocaleString(locale);
  const pct = (n: number) => `${Math.round(n).toLocaleString(locale)}٪`;
  const maxCost = Math.max(0.0001, ...report.rows.map((r) => r.costEstimateUsd));
  return (
    <div className="page wide">
      <header className="pg-top">
        <div>
          <h2>{t.usage}</h2>
          <p>{t.usageHelp}</p>
        </div>
      </header>
      {report.limit.waiting && (
        <p className="info-banner warn">
          {t.limitBanner} {report.limit.resetAt ? <Stamp iso={report.limit.resetAt} locale={locale} /> : "?"}
        </p>
      )}
      <div className="usage-top">
        {report.plan.length === 0 && (
          <article className="card usage-card">
            <h3>
              <IconGauge size={16} />
              {t.planLimits}
            </h3>
            <p className="muted">{t.planNone}</p>
          </article>
        )}
        {report.plan.map((l) => {
          const percent = l.utilization === null ? null : Math.min(100, Math.round(l.utilization * 100));
          return (
            <article key={l.type} className={`card usage-card plan-limit ${l.status}`}>
              <div className="usage-card-head">
                <h3>
                  <IconGauge size={16} />
                  {t.planTypes[l.type] ?? l.type}
                </h3>
                <span className="usage-status">{t.planStatus[l.status]}</span>
              </div>
              <div className="usage-big">{percent === null ? t.planNoFigure : <bdi dir="rtl">{pct(percent)}</bdi>}</div>
              {percent !== null && (
                <div className="usage-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t.planTypes[l.type] ?? l.type}>
                  <span style={{ width: `${percent}%` }} />
                </div>
              )}
              <p className="muted usage-meta">
                {l.resetsAt && (
                  <>
                    {t.planResets}: <Stamp iso={l.resetsAt} locale={locale} />
                  </>
                )}
              </p>
            </article>
          );
        })}
      </div>
      <p className="muted usage-note">
        {t.planHelp} {t.panelTokens}: {t.fiveHours} {fmt(report.windows.fiveHours)} · {t.sevenDays} {fmt(report.windows.sevenDays)}
      </p>
      {report.top.length > 0 && (
        <article className="card usage-card">
          <h3>
            <IconGauge size={16} />
            {t.topUsage}
          </h3>
          <div className="usage-shares">
            {report.top.map((u) => (
              <div key={u.conversationId} className="usage-share">
                <div className="usage-share-head">
                  <b dir="auto" title={u.title}>
                    {u.title}
                  </b>
                  <span className="muted">{u.botName}</span>
                  <bdi dir="rtl">{pct(u.share * 100)}</bdi>
                </div>
                <div className="usage-bar">
                  <span style={{ width: `${Math.round(u.share * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
      )}
      {report.rows.length === 0 ? (
        <div className="empty">
          <div className="hub-emoji">📊</div>
          <p>{t.empty}</p>
        </div>
      ) : (
        <article className="card usage-card usage-table">
          <h3>{t.usageTable}</h3>
          <div className="table-wrap">
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
                    <td className="num">
                      <span className="cost-cell">
                        <span className="cost-bar">
                          <span style={{ width: `${(r.costEstimateUsd / maxCost) * 100}%` }} />
                        </span>
                        ${r.costEstimateUsd.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
      <p className="muted usage-note">
        {t.cost}: {t.estimateNote}
      </p>
    </div>
  );
}

export function FilesPage() {
  const { t, locale } = useT();
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
  const parts = path ? path.split("/") : [];
  return (
    <div className="page wide">
      <header className="pg-top">
        <div>
          <h2>{t.files}</h2>
          <p>{t.filesHelp}</p>
        </div>
        <select
          value={root}
          className="pg-select"
          onChange={(e) => {
            setRoot(e.target.value as "workspace" | "bots");
            setPath("");
          }}
        >
          <option value="workspace">{t.workspace}</option>
          <option value="bots">{t.botsFolder}</option>
        </select>
      </header>
      <nav className="crumbs" aria-label={t.files}>
        <button className="ghost" onClick={() => setPath("")}>
          <IconFolder size={14} />
          {root === "workspace" ? t.workspace : t.botsFolder}
        </button>
        {parts.map((seg, i) => (
          <span key={parts.slice(0, i + 1).join("/")} className="crumb">
            /
            <button className="ghost" onClick={() => setPath(parts.slice(0, i + 1).join("/"))}>
              <bdi dir="ltr">{seg}</bdi>
            </button>
          </span>
        ))}
      </nav>
      {error && <div className="err">{error}</div>}
      <div className="card files-list">
        {path && (
          <button className="files-row" onClick={() => setPath(up)}>
            <span className="files-icon">
              <IconArrowUp size={16} />
            </span>
            <span className="files-text">
              <b>{t.up}</b>
            </span>
          </button>
        )}
        {entries.length === 0 && !error && (
          <div className="empty slim">
            <p>{t.empty}</p>
          </div>
        )}
        {entries.map((e) =>
          e.type === "dir" ? (
            <button key={e.path} className="files-row" onClick={() => setPath(e.path)}>
              <span className="files-icon dir">
                <IconFolder size={18} />
              </span>
              <span className="files-text">
                <b>
                  <bdi dir="ltr">{e.name}</bdi>
                </b>
                <small>{new Date(e.mtime).toLocaleDateString(locale)}</small>
              </span>
            </button>
          ) : (
            <a key={e.path} className="files-row" href={`/api/files/download?root=${root}&path=${encodeURIComponent(e.path)}`}>
              <span className="files-icon">
                <IconDownload size={17} />
              </span>
              <span className="files-text">
                <b>
                  <bdi dir="ltr">{e.name}</bdi>
                </b>
                <small>
                  <bdi dir="ltr">{`${(e.size / 1024).toFixed(1)} KB`}</bdi> · {new Date(e.mtime).toLocaleDateString(locale)}
                </small>
              </span>
            </a>
          ),
        )}
      </div>
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

/** A date kept in one piece, so its numbers and separators do not flip inside right-to-left text. */
function Stamp({ iso, locale }: { iso: string; locale: string }) {
  return <bdi dir={locale.startsWith("fa") ? "rtl" : "ltr"}>{new Date(iso).toLocaleString(locale)}</bdi>;
}

export function SettingsPage({ proxy, onSaved }: { proxy: ProxyStatus | null; onSaved: () => void }) {
  const { t, setLang } = useT();
  const [s, setS] = useState<PublicSettings | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  const load = useCallback(() => api.get<PublicSettings>("/api/settings").then(setS, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!s) return error ? <div className="page err">{error}</div> : null;
  const saveGeneral = async () => {
    setMsg("");
    setError("");
    try {
      const next = await api.put<PublicSettings>("/api/settings", { defaultModel: s.defaultModel, maxConcurrentRuns: s.maxConcurrentRuns, uiLanguage: s.uiLanguage, browserClicksAuto: s.browserClicksAuto, learningEnabled: s.learningEnabled });
      setS(next);
      setLang(next.uiLanguage);
      setMsg(t.saved);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="page cols">
      <h2>{t.settings}</h2>
      <div className="col">
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
        <label className="check">
          <input type="checkbox" checked={s.browserClicksAuto} onChange={(e) => setS({ ...s, browserClicksAuto: e.target.checked })} />
          {t.browserClicksAuto}
        </label>
        <label className="check">
          <input type="checkbox" checked={s.learningEnabled} onChange={(e) => setS({ ...s, learningEnabled: e.target.checked })} />
          {t.learningEnabled}
        </label>
        <div className="row">
          <button className="primary" onClick={() => void saveGeneral()}>
            {t.save}
          </button>
          {msg && <span className="ok">{msg}</span>}
          {error && <span className="err">{error}</span>}
        </div>
      </div>
        <PushPanel />
        <DevicesSection />
      </div>
      <div className="col">
      <div className="card section">
        <div className="row">
          <h3>
            <IconBell size={16} />
            {t.notifications}
          </h3>
          <button className="help-btn" aria-label={t.notifyHelpLabel} aria-expanded={help} title={t.notifyHelpLabel} onClick={() => setHelp(!help)}>
            ?
          </button>
        </div>
        {help && (
          <div className="help-box">
            {t.notifyHelp.map((c) => (
              <div key={c.title}>
                <strong>{c.title}</strong>
                <ol>
                  {c.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
            <p className="muted">{t.notifyHelpToken}</p>
          </div>
        )}
        <ChannelForm name="bale" label={t.channels.bale!} current={s.bale} onSaved={load} />
        <hr style={{ border: 0, borderTop: "1px solid var(--border)", width: "100%" }} />
        <ChannelForm name="telegram" label={t.channels.telegram!} current={s.telegram} onSaved={load} />
      </div>
        <ProxyPanel proxy={proxy} onChanged={onSaved} />
      </div>
    </div>
  );
}
