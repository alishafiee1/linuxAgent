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
  const fmt = (n: number) => n.toLocaleString();
  return (
    <div className="page">
      <h2>{t.usage}</h2>
      {report.limit.waiting && (
        <div className="banner warn card" style={{ marginBottom: 12 }}>
          {t.limitBanner} {report.limit.resetAt ? <Stamp iso={report.limit.resetAt} locale={locale} /> : "?"}
        </div>
      )}
      <div className="card section">
        <h3>
          <IconGauge size={16} />
          {t.planLimits}
        </h3>
        {report.plan.length === 0 && <p className="muted">{t.planNone}</p>}
        {report.plan.map((l) => {
          const percent = l.utilization === null ? null : Math.min(100, Math.round(l.utilization * 100));
          return (
            <div key={l.type} className={`plan-limit ${l.status}`}>
              <div className="row">
                <strong>{t.planTypes[l.type] ?? l.type}</strong>
                <span className="spacer" />
                <span>{percent === null ? t.planNoFigure : <bdi dir="rtl">{`${percent.toLocaleString(locale)}٪`}</bdi>}</span>
              </div>
              {percent !== null && (
                <div className="upload-bar plan-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t.planTypes[l.type] ?? l.type}>
                  <span style={{ width: `${percent}%` }} />
                </div>
              )}
              <div className="muted plan-meta">
                {t.planStatus[l.status]}
                {l.resetsAt && (<> · {t.planResets}: <Stamp iso={l.resetsAt} locale={locale} /></>)}
                <> · {t.planReported}: <Stamp iso={l.reportedAt} locale={locale} /></>
              </div>
            </div>
          );
        })}
        <p className="muted plan-meta">{t.planHelp}</p>
        <p className="muted plan-meta">
          {t.panelTokens}: {t.fiveHours} {fmt(report.windows.fiveHours)} · {t.sevenDays} {fmt(report.windows.sevenDays)}
        </p>
      </div>
      {report.top.length > 0 && (
        <div className="card section">
          <h3>{t.topUsage}</h3>
          <p className="muted plan-meta">{t.topUsageHelp}</p>
          {report.top.map((u) => (
            <div key={u.conversationId} className="top-usage">
              <div className="row nowrap">
                <span className="upload-name" dir="auto" title={u.title}>
                  {u.title}
                </span>
                <span className="muted">{u.botName}</span>
                <bdi dir="rtl">{`${Math.round(u.share * 100).toLocaleString(locale)}٪`}</bdi>
              </div>
              <div className="upload-bar">
                <span style={{ width: `${Math.round(u.share * 100)}%` }} />
              </div>
            </div>
          ))}
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
                    <bdi dir="ltr">{e.name}</bdi>
                  </button>
                ) : (
                  <span dir="ltr">{e.name}</span>
                )}
              </td>
              <td className="num muted">{e.type === "file" ? <bdi dir="ltr">{`${(e.size / 1024).toFixed(1)} KB`}</bdi> : ""}</td>
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
      <PushPanel />
      <ProxyPanel proxy={proxy} onChanged={onSaved} />
      <DevicesSection />
    </div>
  );
}
