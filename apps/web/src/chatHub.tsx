import type { Approval, Bot, Conversation } from "@linux-agent/shared";
import { useEffect, useState } from "react";
import { api } from "./api";
import { BotAvatar } from "./avatars";
import { IconChevronDown, IconPlus } from "./icons";
import { useT } from "./i18n";

interface RecentChat extends Conversation {
  bot: Bot;
}

/** The chat start page: one card per bot, then the latest conversations. */
export function ChatHub({ bots, pending, onOpen, onNew }: { bots: Bot[]; pending: Record<string, Approval[]>; onOpen: (botId: string, conversationId?: string) => void; onNew: () => void }) {
  const { t, locale } = useT();
  const [recent, setRecent] = useState<RecentChat[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all(bots.map((bot) => api.get<Conversation[]>(`/api/bots/${bot.id}/conversations`).then((list) => list.map((c) => ({ ...c, bot })), () => [] as RecentChat[]))).then((all) => {
      if (live) setRecent(all.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6));
    });
    return () => {
      live = false;
    };
  }, [bots]);

  const n = (v: number): string => v.toLocaleString(locale);
  return (
    <div className="page hub">
      <header className="hub-top">
        <div>
          <h2>{t.chat}</h2>
          <p>{t.hubHelp}</p>
        </div>
        <button onClick={onNew}>
          <IconPlus size={15} />
          {t.newBot}
        </button>
      </header>

      {bots.length === 0 ? (
        <div className="empty hub-empty">
          <div className="hub-emoji">🤖</div>
          <strong>{t.hubEmptyTitle}</strong>
          <p>{t.hubEmptyText}</p>
          <button className="primary" onClick={onNew}>
            <IconPlus size={15} />
            {t.hubFirstBot}
          </button>
        </div>
      ) : (
        <div className="hub-grid">
          {bots.map((b) => {
            const waiting = pending[b.id]?.length ?? 0;
            return (
              <article key={b.id} className="card hub-card">
                <div className="hub-card-head">
                  <BotAvatar bot={b} size="lg" />
                  <div className="hub-card-text">
                    <div className="hub-name">
                      <h3>{b.name}</h3>
                      <span className={`hub-pill ${waiting ? "warn" : "good"}`}>{waiting ? `${n(waiting)} ${t.hubWaiting}` : t.hubReady}</span>
                    </div>
                    <p className="hub-role">{b.persona.split("\n")[0] || "—"}</p>
                    <p className="hub-meta">
                      {t.modelChip} <bdi dir="ltr">{b.model ?? t.modelDefault}</bdi>
                      {b.effort ? ` · ${t.effortChip} ${t.efforts[b.effort]}` : ""}
                      {b.browser ? ` · ${t.hubBrowser}` : ""}
                    </p>
                  </div>
                </div>
                <button className="primary hub-open" onClick={() => onOpen(b.id)}>
                  {t.hubOpen.replace("{name}", b.name)}
                  <IconChevronDown size={15} className="hub-chev" />
                </button>
              </article>
            );
          })}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <h3 className="hub-sub">{t.hubRecent}</h3>
          <div className="hub-recent">
            {recent.map((c) => (
              <button key={c.id} className="hub-row" onClick={() => onOpen(c.bot.id, c.id)}>
                <BotAvatar bot={c.bot} size="sm" />
                <span className="hub-row-text">
                  <b dir="auto">{c.title}</b>
                  <small>
                    {c.bot.name} · {new Date(c.updatedAt).toLocaleDateString(locale)}
                  </small>
                </span>
                <IconChevronDown size={15} className="hub-chev" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
