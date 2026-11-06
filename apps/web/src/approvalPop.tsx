import type { Approval } from "@linux-agent/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { FloatingMenu } from "./popover";
import { IconCheck, IconShield, IconX } from "./icons";
import { useT } from "./i18n";
import { ApprovalDetails } from "./pages";

/** Pending approvals grouped by bot id; reloads whenever the activity stream ticks. */
export function usePending(activityTick: number): { byBot: Record<string, Approval[]>; reload: () => void } {
  const [list, setList] = useState<Approval[]>([]);
  const reload = useCallback(() => {
    api.get<Approval[]>("/api/approvals?state=pending").then(setList, () => {});
  }, []);
  useEffect(reload, [reload, activityTick]);
  const byBot: Record<string, Approval[]> = {};
  for (const a of list) (byBot[a.botId] ??= []).push(a);
  return { byBot, reload };
}

/** The orange count on a bot's avatar. Click opens the decision menu right there. */
export function ApprovalBadge({ items, onChanged, onOpenPage }: { items: Approval[]; onChanged: () => void; onOpenPage: () => void }) {
  const { t, locale } = useT();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const n = items.length;

  useEffect(() => {
    if (n === 0) setAnchor(null);
  }, [n]);

  if (n === 0) return null;
  const label = t.approvalsWaiting.replace("{n}", n.toLocaleString(locale));

  const decide = async (id: string, allow: boolean) => {
    setError("");
    try {
      await api.post(`/api/approvals/${id}/decide`, { allow });
    } catch (e) {
      setError((e as Error).message);
    }
    onChanged();
  };

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        className="av-alert"
        aria-label={label}
        aria-haspopup="dialog"
        data-testid="approval-badge"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setAnchor(e.currentTarget);
          }
        }}
      >
        {n.toLocaleString(locale)}
      </span>
      {anchor && (
        <FloatingMenu anchor={anchor} label={label} onClose={() => setAnchor(null)}>
          <h4 className="pop-title">
            <IconShield size={16} />
            {label}
          </h4>
          {error && <div className="err">{error}</div>}
          {items.map((a) => (
            <div key={a.id} className="ap-card">
              <div className="ap-reason">{a.reason}</div>
              <ApprovalDetails summary={a.summary} toolName={a.toolName} input={a.input} />
              <div className="row ap-actions">
                <button className="primary" onClick={() => void decide(a.id, true)}>
                  <IconCheck size={15} />
                  {t.allow}
                </button>
                <button className="danger" onClick={() => void decide(a.id, false)}>
                  <IconX size={15} />
                  {t.deny}
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="ghost pop-link"
            onClick={() => {
              setAnchor(null);
              onOpenPage();
            }}
          >
            {t.approvalsAllPage}
          </button>
        </FloatingMenu>
      )}
    </>
  );
}
