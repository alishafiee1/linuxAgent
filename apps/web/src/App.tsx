import type { Bot, Me, ProxyStatus, PublicSettings, UiLanguage } from "@linux-agent/shared";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { BotDialog } from "./BotDialog";
import { Chat } from "./Chat";
import { IconActivity, IconBot, IconChat, IconClock, IconFolder, IconGauge, IconGlobe, IconInbox, IconMenu, IconPencil, IconPlus, IconShield, IconSliders, IconTerminal, IconTrash, type IconProps } from "./icons";
import { dictionaries, I18n, useT } from "./i18n";
import { ApprovalsPage, FilesPage, SettingsPage, UsagePage } from "./pages";
import { BrowserPage, KnowledgePage, RoutinesPage, SharedPagesPage } from "./pagesExt";

export interface Status {
  runs: { running: number; queued: number; waitingApproval: number; waitingLimit: number };
  pendingApprovals: number;
  proxy: ProxyStatus | null;
  lowDisk: boolean;
  lowDiskMessage: string | null;
}

type View = "chat" | "approvals" | "routines" | "knowledge" | "browser" | "pages" | "usage" | "files" | "settings";

const NAV_ICONS: Record<View, (p: IconProps) => ReturnType<typeof IconChat>> = {
  chat: IconChat,
  approvals: IconShield,
  routines: IconClock,
  knowledge: IconBot,
  browser: IconGlobe,
  pages: IconInbox,
  usage: IconGauge,
  files: IconFolder,
  settings: IconSliders,
};

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
  return <I18n.Provider value={ctx}>{me === undefined ? <div className="empty">…</div> : me === null ? <Login onDone={setMe} /> : <Shell onLogout={() => setMe(null)} />}</I18n.Provider>;
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
        <div className="login-head">
          <span className="brand-mark lg">
            <IconTerminal size={22} />
          </span>
          <h1>{t.appName}</h1>
        </div>
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
      <IconGlobe size={13} />
      {t.proxy}: {t[proxy.state]}
      {proxy.state === "connected" && proxy.latencyMs !== null && ` · ${proxy.latencyMs} ${t.ms}`}
    </span>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { t, lang, setLang } = useT();
  const [view, setView] = useState<View>("chat");
  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("cwp.bot");
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<Status | null>(null);
  const [activityTick, setActivityTick] = useState(0);
  const [dialog, setDialog] = useState<{ bot: Bot | null } | null>(null);
  const [menu, setMenu] = useState<{ bot: Bot; x: number; y: number } | null>(null);
  const [drawer, setDrawer] = useState(false);

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

  useEffect(() => {
    try {
      if (botId) localStorage.setItem("cwp.bot", botId);
    } catch {
      // private mode
    }
  }, [botId]);

  const bot = bots.find((b) => b.id === botId) ?? null;
  const runs = status?.runs;

  return (
    <div className="layout">
      <header className="topbar">
        <button className="ghost icon-btn menu-btn" aria-label={t.menu} onClick={() => setDrawer(true)}>
          <IconMenu size={19} />
        </button>
        <span className="brand">
          <span className="brand-mark">
            <IconTerminal size={14} />
          </span>
          {t.appName}
        </span>
        <nav className="nav">
          {(["chat", "approvals", "routines", "knowledge", "browser", "pages", "usage", "files", "settings"] as View[]).map((v) => {
            const NavIcon = NAV_ICONS[v];
            return (
              <button key={v} className={`ghost ${view === v ? "active" : ""}`} onClick={() => setView(v)}>
                <NavIcon size={15} />
                <span>{v === "knowledge" ? t.navKnowledge : v === "browser" ? t.navBrowser : t[v]}</span>
                {v === "approvals" && status && status.pendingApprovals > 0 && ` (${status.pendingApprovals})`}
              </button>
            );
          })}
        </nav>
        <span className="spacer" />
        {runs && (
          <span className="pill runs-pill">
            <IconActivity size={13} />
            {t.running}: {runs.running} · {t.queued}: {runs.queued}
          </span>
        )}
        {status && status.pendingApprovals > 0 && (
          <button className="pill warn-pill" onClick={() => setView("approvals")}>
            <span className="dot warn" />
            <IconShield size={13} />
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

      <div className={`scrim${drawer ? " show" : ""}`} onClick={() => setDrawer(false)} />
      <aside className={`sidebar${drawer ? " open" : ""}`}>
        <h2>{t.bots}</h2>
        {bots.map((b) => (
          <div key={b.id} className="bot-row">
            <button
              className={`bot-item ${b.id === botId && view === "chat" ? "active" : ""}`}
              onClick={() => {
                setBotId(b.id);
                setView("chat");
                setDrawer(false);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ bot: b, x: e.clientX, y: e.clientY });
              }}
            >
              <span className="avatar">{b.name.slice(0, 1).toUpperCase()}</span>
              <span className="bot-name">{b.name}</span>
            </button>
            <button
              className="ghost bot-more"
              aria-label={`${t.edit}: ${b.name}`}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ bot: b, x: r.left, y: r.bottom });
              }}
            >
              ⋯
            </button>
          </div>
        ))}
        <button className="add-bot" onClick={() => setDialog({ bot: null })}>
          <IconPlus size={15} />
          {t.newBot}
        </button>
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
        {view === "routines" && <RoutinesPage bots={bots} activityTick={activityTick} />}
        {view === "knowledge" && <KnowledgePage />}
        {view === "browser" && <BrowserPage bots={bots} />}
        {view === "pages" && <SharedPagesPage />}
        {view === "usage" && <UsagePage />}
        {view === "files" && <FilesPage />}
        {view === "settings" && <SettingsPage proxy={status?.proxy ?? null} onSaved={loadStatus} />}
      </main>

      {menu && (
        <div className="menu card" style={{ top: menu.y, left: Math.max(8, Math.min(menu.x, window.innerWidth - 178)) }}>
          <button onClick={() => setDialog({ bot: menu.bot })}>
            <IconPencil size={15} />
            {t.edit}
          </button>
          <button className="danger" onClick={() => void deleteBot(menu.bot)}>
            <IconTrash size={15} />
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
