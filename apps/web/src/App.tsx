import type { Bot, Me, ProxyStatus, PublicSettings, UiLanguage } from "@linux-agent/shared";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ApprovalBadge, usePending } from "./approvalPop";
import { api, ApiError } from "./api";
import { BotAvatar } from "./avatars";
import { BotDialog } from "./BotDialog";
import { Chat } from "./Chat";
import { ConnectionsPage } from "./connections";
import { IconActivity, IconBot, IconChat, IconChevronDown, IconClock, IconFolder, IconGauge, IconGlobe, IconInbox, IconLink, IconMenu, IconMoon, IconPencil, IconPlus, IconShield, IconSliders, IconSun, IconTerminal, IconTrash, IconX, type IconProps } from "./icons";
import { dictionaries, I18n, useT } from "./i18n";
import { FilesPage, SettingsPage, UsagePage } from "./pages";
import { BrowserPage, KnowledgePage, SharedPagesPage, VaultPage } from "./pagesExt";
import { RoutinesPage } from "./routines";

export interface Status {
  runs: { running: number; queued: number; waitingApproval: number; waitingLimit: number };
  pendingApprovals: number;
  proxy: ProxyStatus | null;
  lowDisk: boolean;
  lowDiskMessage: string | null;
}

type View = "chat" | "connections" | "routines" | "knowledge" | "browser" | "vault" | "pages" | "usage" | "files" | "settings";

/** Desktop shows all of them in the side list. The phone bar keeps the four used most; the rest sit under "more". */
const VIEWS: View[] = ["chat", "routines", "connections", "knowledge", "browser", "vault", "pages", "usage", "files", "settings"];
const PHONE_BAR: View[] = ["chat", "routines", "files", "settings"];

/** `#/settings`, or `#/chat/<bot id>/<conversation id>`: the address of a panel page, so a bot or a message can link to it. */
function parseHash(): { view: View; bot: string | null; conversation: string | null } | null {
  const [page, bot, conversation] = location.hash.replace(/^#\/?/, "").split("/");
  const view = VIEWS.find((v) => v === page);
  return view ? { view, bot: bot || null, conversation: conversation || null } : null;
}

const NAV_ICONS: Record<View, (p: IconProps) => ReturnType<typeof IconChat>> = {
  chat: IconChat,
  connections: IconLink,
  routines: IconClock,
  knowledge: IconBot,
  browser: IconGlobe,
  vault: IconShield,
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

type Theme = "light" | "dark";

/** Follows the system until the user picks one; the pick is kept in this browser only. */
function useTheme(): [Theme, () => void] {
  const system = () => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("cwp.theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // private mode
    }
    return system();
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("cwp.theme", next);
    } catch {
      // private mode
    }
  };
  return [theme, toggle];
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
          <p className="login-sub">{t.loginSub}</p>
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
  // A link in a Bale or Telegram message opens the page that holds the waiting card.
  const [view, setView] = useState<View>(() => parseHash()?.view ?? "chat");
  const [more, setMore] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(() => {
    try {
      return localStorage.getItem("cwp.pages") !== "0";
    } catch {
      return true;
    }
  });
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
  const [openConversation, setOpenConversation] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();
  const { byBot, reload: reloadPending } = usePending(activityTick);

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
  useEffect(() => {
    try {
      localStorage.setItem("cwp.pages", pagesOpen ? "1" : "0");
    } catch {
      // private mode
    }
  }, [pagesOpen]);
  // The address bar follows the page, and a pasted or clicked panel link moves the page.
  useEffect(() => {
    const want = `#/${view}`;
    if (!location.hash.startsWith(want)) history.pushState(null, "", want);
  }, [view]);
  useEffect(() => {
    const onHash = () => {
      const h = parseHash();
      if (!h) return;
      setView(h.view);
      if (h.bot) setBotId(h.bot);
      setOpenConversation(h.conversation);
      setMore(false);
      setDrawer(false);
    };
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const label = (v: View): string => (v === "knowledge" ? t.navKnowledge : v === "browser" ? t.navBrowser : v === "vault" ? t.vault : t[v]);
  const go = (v: View) => {
    setView(v);
    setMore(false);
  };
  // A bot waiting for an answer: its chat is where the question and the buttons are.
  const openPending = () => {
    const id = Object.keys(byBot).find((k) => (byBot[k]?.length ?? 0) > 0);
    if (id) {
      setBotId(id);
      setOpenConversation(null);
    }
    go("chat");
  };
  const toggleLang = () => {
    const next: UiLanguage = lang === "fa" ? "en" : "fa";
    setLang(next);
    void api.put("/api/settings", { uiLanguage: next }).catch(() => {});
  };

  return (
    <div className={`layout${pagesOpen ? " rail-open" : ""}`}>
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
        <span className="spacer" />
        {runs && (
          <span className="pill runs-pill">
            <IconActivity size={13} />
            {t.running}: {runs.running} · {t.queued}: {runs.queued}
          </span>
        )}
        {status && status.pendingApprovals > 0 && (
          <button className="pill warn-pill" onClick={openPending}>
            <span className="dot warn" />
            <IconShield size={13} />
            {t.pending}: {status.pendingApprovals}
          </button>
        )}
        <ProxyPill proxy={status?.proxy ?? null} />
        <button className="ghost icon-btn" aria-label={t.themeToggle} title={t.themeToggle} onClick={toggleTheme}>
          {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
        <button className="ghost desk-only" onClick={toggleLang}>
          {lang === "fa" ? "EN" : "فا"}
        </button>
        <button className="ghost desk-only" onClick={logout}>
          {t.logout}
        </button>
      </header>

      <div className={`scrim${drawer ? " show" : ""}`} onClick={() => setDrawer(false)} />
      <aside className="rail" aria-label={t.menu}>
        <span className="brand rail-brand">
          <span className="brand-mark">
            <IconTerminal size={14} />
          </span>
          <span className="rail-label">{t.appName}</span>
        </span>
        <nav className="side-nav" aria-label={t.navPages}>
          {VIEWS.map((v) => {
            const NavIcon = NAV_ICONS[v];
            return (
              <button key={v} className={view === v ? "active" : ""} aria-current={view === v ? "page" : undefined} title={pagesOpen ? undefined : label(v)} onClick={() => go(v)}>
                <NavIcon size={19} />
                <span className="rail-label">{label(v)}</span>
              </button>
            );
          })}
        </nav>
        <button className="rail-toggle" aria-expanded={pagesOpen} aria-label={pagesOpen ? t.railCollapse : t.railExpand} title={pagesOpen ? t.railCollapse : t.railExpand} onClick={() => setPagesOpen(!pagesOpen)}>
          <IconChevronDown size={16} />
        </button>
      </aside>
      <aside className={`sidebar${drawer ? " open" : ""}`}>
        <div className="bots-head">
          <h2>{t.bots}</h2>
          <span className="bots-count">{bots.length.toLocaleString(lang === "fa" ? "fa-IR" : "en")}</span>
          <button className="ghost icon-btn" aria-label={t.newBot} title={t.newBot} onClick={() => setDialog({ bot: null })}>
            <IconPlus size={16} />
          </button>
        </div>
        {bots.map((b) => (
          <div key={b.id} className="bot-row">
            <button
              className={`bot-item ${b.id === botId && view === "chat" ? "active" : ""}`}
              onClick={() => {
                setBotId(b.id);
                setOpenConversation(null);
                setView("chat");
                setDrawer(false);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ bot: b, x: e.clientX, y: e.clientY });
              }}
            >
              <BotAvatar
                bot={b}
                busy={(byBot[b.id]?.length ?? 0) > 0}
                badge={<ApprovalBadge items={byBot[b.id] ?? []} onChanged={() => { reloadPending(); void loadStatus(); }} onOpenPage={() => { setBotId(b.id); setOpenConversation(null); go("chat"); setDrawer(false); }} />}
              />
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
        {status?.proxy?.state === "disconnected" && (
          <div className="banner bad">
            {t.proxyDown}
            {status.proxy.reason && ` ${t.proxyReasons[status.proxy.reason]}`}
          </div>
        )}
        {status?.lowDiskMessage && <div className="banner warn">{status.lowDiskMessage}</div>}
        {view === "chat" &&
          (bot ? (
            <Chat
              key={bot.id}
              bot={bot}
              activityTick={activityTick}
              initialConversation={openConversation}
              onBotChanged={() => void loadBots()}
              headBadge={<ApprovalBadge items={byBot[bot.id] ?? []} onChanged={() => { reloadPending(); void loadStatus(); }} onOpenPage={() => go("chat")} />}
            />
          ) : (
            <div className="empty">{bots.length ? t.pickBot : t.noBots}</div>
          ))}
        {view === "connections" && <ConnectionsPage />}
        {view === "routines" && <RoutinesPage
            bots={bots}
            activityTick={activityTick}
            onOpenConversation={(id, conversationId) => {
              setBotId(id);
              setOpenConversation(conversationId);
              setView("chat");
            }}
          />}
        {view === "knowledge" && <KnowledgePage />}
        {view === "browser" && <BrowserPage bots={bots} />}
        {view === "vault" && <VaultPage />}
        {view === "pages" && <SharedPagesPage />}
        {view === "usage" && <UsagePage />}
        {view === "files" && <FilesPage />}
        {view === "settings" && <SettingsPage proxy={status?.proxy ?? null} onSaved={loadStatus} />}
      </main>

      <nav className="bottom-nav" aria-label={t.menu}>
        {PHONE_BAR.map((v) => {
          const NavIcon = NAV_ICONS[v];
          return (
            <button key={v} className={view === v ? "active" : ""} aria-current={view === v ? "page" : undefined} onClick={() => go(v)}>
              <NavIcon size={21} />
              <span>{label(v)}</span>
            </button>
          );
        })}
        <button className={more || !PHONE_BAR.includes(view) ? "active" : ""} aria-expanded={more} onClick={() => setMore(!more)}>
          <IconMenu size={21} />
          <span>{t.more}</span>
        </button>
      </nav>
      {more && (
        <>
          <div className="sheet-scrim" onClick={() => setMore(false)} />
          <div className="sheet" role="dialog" aria-label={t.more}>
            <div className="sheet-head">
              <strong>{t.more}</strong>
              <button className="ghost icon-btn" aria-label={t.closeMenu} onClick={() => setMore(false)}>
                <IconX size={17} />
              </button>
            </div>
            <div className="sheet-grid">
              {VIEWS.filter((v) => !PHONE_BAR.includes(v)).map((v) => {
                const NavIcon = NAV_ICONS[v];
                return (
                  <button key={v} className={view === v ? "active" : ""} onClick={() => go(v)}>
                    <NavIcon size={22} />
                    <span>{label(v)}</span>
                  </button>
                );
              })}
            </div>
            <div className="sheet-foot">
              <button onClick={toggleLang}>{lang === "fa" ? "English" : "فارسی"}</button>
              <button className="danger" onClick={logout}>
                {t.logout}
              </button>
            </div>
          </div>
        </>
      )}

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
