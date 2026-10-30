import type { Bot, Me, ProxyStatus, PublicSettings, UiLanguage } from "@linux-agent/shared";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { BotDialog } from "./BotDialog";
import { Chat } from "./Chat";
import { dictionaries, I18n, useT } from "./i18n";
import { ApprovalsPage, FilesPage, SettingsPage, UsagePage } from "./pages";

export interface Status {
  runs: { running: number; queued: number; waitingApproval: number; waitingLimit: number };
  pendingApprovals: number;
  proxy: ProxyStatus | null;
  lowDisk: boolean;
  lowDiskMessage: string | null;
}

type View = "chat" | "approvals" | "usage" | "files" | "settings";

function useLanguage(): [UiLanguage, (l: UiLanguage) => void] {
  const [lang, setLang] = useState<UiLanguage>(() => (localStorage.getItem("cwp.lang") === "en" ? "en" : "fa"));
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
    try {
      localStorage.setItem("cwp.lang", lang);
    } catch {
      // private mode
    }
  }, [lang]);
  return [lang, setLang];
}

export function App() {
  const [lang, setLang] = useLanguage();
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    api.get<Me>("/api/auth/me").then(setMe, () => setMe(null));
    const onUnauth = () => setMe(null);
    window.addEventListener("cwp:unauthorized", onUnauth);
    return () => window.removeEventListener("cwp:unauthorized", onUnauth);
  }, []);

  const ctx = useMemo(() => ({ t: dictionaries[lang], lang, setLang }), [lang, setLang]);
  return <I18n.Provider value={ctx}>{me === undefined ? null : me === null ? <Login onDone={setMe} /> : <Shell onLogout={() => setMe(null)} />}</I18n.Provider>;
}

function Login({ onDone }: { onDone: (m: Me) => void }) {
  const { t } = useT();
  const [form, setForm] = useState({ username: "", password: "", code: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onDone(await api.post<Me>("/api/auth/login", form));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1 style={{ margin: 0, fontSize: 20 }}>{t.appName}</h1>
        <label>
          {t.username}
          <input autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        </label>
        <label>
          {t.password}
          <input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </label>
        <label>
          {t.code}
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        </label>
        {error && <div className="err">{error}</div>}
        <button className="primary" disabled={busy}>
          {t.login}
        </button>
      </form>
    </div>
  );
}

function ProxyPill({ proxy }: { proxy: ProxyStatus | null }) {
  const { t } = useT();
  if (!proxy) return null;
  const cls = proxy.state === "connected" ? "good" : proxy.state === "disconnected" ? "bad" : "warn";
  return (
    <span className="pill" title={proxy.current ? `${proxy.current.scheme}://${proxy.current.host}:${proxy.current.port}` : ""}>
      <span className={`dot ${cls}`} />
      {t.proxy}: {t[proxy.state]}
      {proxy.state === "connected" && proxy.latencyMs !== null && ` · ${proxy.latencyMs} ${t.ms}`}
    </span>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { t, lang, setLang } = useT();
  const [view, setView] = useState<View>("chat");
  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [activityTick, setActivityTick] = useState(0);
  const [dialog, setDialog] = useState<{ bot: Bot | null } | null>(null);
  const [menu, setMenu] = useState<{ bot: Bot; x: number; y: number } | null>(null);

  const loadBots = useCallback(async () => {
    const list = await api.get<Bot[]>("/api/bots");
    setBots(list);
    setBotId((cur) => (cur && list.some((b) => b.id === cur) ? cur : (list[0]?.id ?? null)));
  }, []);
  const loadStatus = useCallback(() => api.get<Status>("/api/status").then(setStatus, () => {}), []);

  useEffect(() => {
    void loadBots();
    void loadStatus();
    api.get<PublicSettings>("/api/settings").then((s) => setLang(s.uiLanguage), () => {});
    const es = new EventSource("/api/activity/stream");
    es.onmessage = () => {
      setActivityTick((n) => n + 1);
      void loadStatus();
    };
    const poll = setInterval(loadStatus, 15_000);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [loadBots, loadStatus, setLang]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    onLogout();
  };

  const deleteBot = async (bot: Bot) => {
    if (!confirm(`${bot.name}\n\n${t.confirmDelete}`)) return;
    try {
      await api.del(`/api/bots/${bot.id}`);
      await loadBots();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const bot = bots.find((b) => b.id === botId) ?? null;
  const runs = status?.runs;

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">{t.appName}</span>
        <nav className="nav">
          {(["chat", "approvals", "usage", "files", "settings"] as View[]).map((v) => (
            <button key={v} className={`ghost ${view === v ? "active" : ""}`} onClick={() => setView(v)}>
              {t[v]}
              {v === "approvals" && status && status.pendingApprovals > 0 && ` (${status.pendingApprovals})`}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        {runs && (
          <span className="pill">
            {t.running}: {runs.running} · {t.queued}: {runs.queued}
          </span>
        )}
        {status && status.pendingApprovals > 0 && (
          <button className="pill" style={{ color: "var(--warn)" }} onClick={() => setView("approvals")}>
            <span className="dot warn" />
            {t.pending}: {status.pendingApprovals}
          </button>
        )}
        <ProxyPill proxy={status?.proxy ?? null} />
        <button
          className="ghost"
          onClick={() => {
            const next: UiLanguage = lang === "fa" ? "en" : "fa";
            setLang(next);
            void api.put("/api/settings", { uiLanguage: next }).catch(() => {});
          }}
        >
          {lang === "fa" ? "EN" : "فا"}
        </button>
        <button className="ghost" onClick={logout}>
          {t.logout}
        </button>
      </header>

      <aside className="sidebar">
        <h2>{t.bots}</h2>
        {bots.map((b) => (
          <button
            key={b.id}
            className={`bot-item ${b.id === botId && view === "chat" ? "active" : ""}`}
            onClick={() => {
              setBotId(b.id);
              setView("chat");
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ bot: b, x: e.clientX, y: e.clientY });
            }}
          >
            <span className="avatar">{b.name.slice(0, 1).toUpperCase()}</span>
            <span>{b.name}</span>
          </button>
        ))}
        <button onClick={() => setDialog({ bot: null })}>+ {t.newBot}</button>
      </aside>

      <main className="main">
        {status?.proxy?.state === "disconnected" && <div className="banner bad">{t.proxyDown}</div>}
        {status?.lowDiskMessage && <div className="banner warn">{status.lowDiskMessage}</div>}
        {view === "chat" &&
          (bot ? (
            <Chat key={bot.id} bot={bot} activityTick={activityTick} />
          ) : (
            <div className="empty">{bots.length ? t.pickBot : t.noBots}</div>
          ))}
        {view === "approvals" && <ApprovalsPage activityTick={activityTick} />}
        {view === "usage" && <UsagePage />}
        {view === "files" && <FilesPage />}
        {view === "settings" && <SettingsPage proxy={status?.proxy ?? null} onSaved={loadStatus} />}
      </main>

      {menu && (
        <div className="menu card" style={{ top: menu.y, left: menu.x }}>
          <button onClick={() => setDialog({ bot: menu.bot })}>{t.edit}</button>
          <button className="danger" onClick={() => void deleteBot(menu.bot)}>
            {t.delete}
          </button>
        </div>
      )}
      {dialog && (
        <BotDialog
          bot={dialog.bot}
          onClose={() => setDialog(null)}
          onSaved={async (b) => {
            setDialog(null);
            await loadBots();
            setBotId(b.id);
            setView("chat");
          }}
        />
      )}
    </div>
  );
}
